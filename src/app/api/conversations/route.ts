import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const usernameSchema = z.string().trim().toLowerCase().min(3).max(24).regex(/^[a-z0-9_]+$/);
const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("direct"), username: usernameSchema }),
  z.object({
    type: z.enum(["group", "channel"]),
    title: z.string().trim().min(1).max(80),
    username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9_]+$/).optional(),
    isPublic: z.boolean().default(false),
    members: z.array(usernameSchema).max(30).default([]),
  }),
]);

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    const conversations = await getDb()`
      SELECT
        c.id,
        c.type,
        c.title,
        c.username,
        c.is_public,
        c.updated_at,
        cm.role,
        cm.muted,
        cm.archived,
        CASE WHEN c.type = 'direct' THEN (
          SELECT jsonb_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name)
          FROM conversation_members other_member
          JOIN users u ON u.id = other_member.user_id
          WHERE other_member.conversation_id = c.id AND other_member.user_id <> ${session.user.id}
            AND u.deleted_at IS NULL
          LIMIT 1
        ) ELSE NULL END AS peer,
        (
          SELECT jsonb_build_object(
            'id', m.id::text,
            'content', CASE WHEN m.deleted_at IS NULL THEN m.content ELSE 'این پیام حذف شده است' END,
            'createdAt', m.created_at,
            'senderName', COALESCE(NULLIF(u.display_name, ''), NULLIF(b.name, ''), m.sender_name_snapshot, 'کاربر حذف‌شده')
          )
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_id AND u.deleted_at IS NULL
          LEFT JOIN bots b ON b.id = m.sender_bot_id AND b.deleted_at IS NULL
          WHERE m.conversation_id = c.id
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks blocked
              WHERE blocked.blocker_id = ${session.user.id} AND blocked.blocked_id = m.sender_id
            )
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT count(*)::int
          FROM messages unread
          WHERE unread.conversation_id = c.id
            AND unread.deleted_at IS NULL
            AND unread.created_at > COALESCE(cm.last_read_at, '-infinity'::timestamptz)
            AND (unread.sender_id IS DISTINCT FROM ${session.user.id})
            AND NOT EXISTS (
              SELECT 1 FROM user_blocks blocked
              WHERE blocked.blocker_id = ${session.user.id} AND blocked.blocked_id = unread.sender_id
            )
        ) AS unread_count
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.user_id = ${session.user.id}
        AND cm.archived = false
        AND NOT (
          c.type = 'direct' AND EXISTS (
            SELECT 1
            FROM conversation_members other_member
            JOIN user_blocks b ON
              (b.blocker_id = ${session.user.id} AND b.blocked_id = other_member.user_id)
              OR (b.blocker_id = other_member.user_id AND b.blocked_id = ${session.user.id})
            WHERE other_member.conversation_id = c.id AND other_member.user_id <> ${session.user.id}
          )
        )
      ORDER BY COALESCE((SELECT max(m.id) FROM messages m WHERE m.conversation_id = c.id), 0) DESC, c.updated_at DESC
      LIMIT 100
    `;
    return noStoreJson({ conversations: conversations.map((conversation) => ({
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      username: conversation.username,
      isPublic: conversation.is_public,
      updatedAt: new Date(conversation.updated_at).toISOString(),
      role: conversation.role,
      muted: conversation.muted,
      peer: conversation.peer,
      lastMessage: conversation.last_message,
      unreadCount: Number(conversation.unread_count),
    })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, createSchema);
    const sql = getDb();

    if (data.type === "direct") {
      const [target] = await sql`
        SELECT id FROM users
        WHERE lower(username) = ${data.username} AND deleted_at IS NULL AND profile_public = true AND id <> ${session.user.id}
        LIMIT 1
      `;
      if (!target) throw new AppError(404, "USER_NOT_FOUND", "کاربر پیدا نشد.");
      const [blocked] = await sql`
        SELECT 1 FROM user_blocks
        WHERE (blocker_id = ${session.user.id} AND blocked_id = ${target.id})
           OR (blocker_id = ${target.id} AND blocked_id = ${session.user.id})
        LIMIT 1
      `;
      if (blocked) throw new AppError(403, "USER_BLOCKED", "این گفتگو به‌دلیل تنظیمات حریم خصوصی در دسترس نیست.");

      const directKey = [session.user.id, target.id].sort().join(":");
      const conversation = await sql.begin(async (transaction) => {
        const [created] = await transaction`
          INSERT INTO conversations (type, creator_id, direct_key)
          VALUES ('direct', ${session.user.id}, ${directKey})
          ON CONFLICT (direct_key) DO UPDATE SET updated_at = conversations.updated_at
          RETURNING id
        `;
        await transaction`
          INSERT INTO conversation_members (conversation_id, user_id, role)
          VALUES (${created.id}, ${session.user.id}, 'member'), (${created.id}, ${target.id}, 'member')
          ON CONFLICT (conversation_id, user_id) DO NOTHING
        `;
        return created;
      });
      return noStoreJson({ conversationId: conversation.id, type: "direct" }, { status: 201 });
    }

    if (data.type === "channel" && data.isPublic && !data.username) {
      throw new AppError(400, "USERNAME_REQUIRED", "برای کانال عمومی یک نام کاربری یکتا انتخاب کنید.");
    }
    if (data.type === "group" && data.username) {
      throw new AppError(400, "GROUP_USERNAME_UNSUPPORTED", "نام کاربری عمومی فقط برای کانال‌ها در این نسخه پشتیبانی می‌شود.");
    }

    const requestedMembers = [...new Set(data.members)].filter((username) => username !== session.user.username.toLowerCase());
    const memberRows = requestedMembers.length
      ? await sql`SELECT id, username FROM users WHERE lower(username) = ANY(${requestedMembers}) AND deleted_at IS NULL`
      : [];
    if (memberRows.length !== requestedMembers.length) {
      throw new AppError(400, "MEMBER_NOT_FOUND", "یکی از نام‌های کاربری اولیه پیدا نشد.");
    }

    const conversation = await sql.begin(async (transaction) => {
      const [created] = await transaction`
        INSERT INTO conversations (type, title, username, is_public, creator_id)
        VALUES (
          ${data.type},
          ${data.title},
          ${data.type === "channel" ? (data.username ?? null) : null},
          ${data.type === "channel" && data.isPublic},
          ${session.user.id}
        )
        RETURNING id, type
      `;
      await transaction`
        INSERT INTO conversation_members (conversation_id, user_id, role)
        VALUES (${created.id}, ${session.user.id}, 'owner')
      `;
      for (const member of memberRows) {
        await transaction`
          INSERT INTO conversation_members (conversation_id, user_id, role)
          VALUES (${created.id}, ${member.id}, 'member')
          ON CONFLICT (conversation_id, user_id) DO NOTHING
        `;
      }
      await transaction`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'conversation.created', 'conversation', ${created.id}, ${JSON.stringify({ type: data.type })}::jsonb)
      `;
      return created;
    });

    return noStoreJson({ conversationId: conversation.id, type: conversation.type }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
