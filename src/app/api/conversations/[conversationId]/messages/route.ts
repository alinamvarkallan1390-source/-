import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  clientRequestId: z.string().uuid(),
  replyToId: z.string().regex(/^\d{1,18}$/).optional(),
});

const uuidSchema = z.string().uuid();

function serializeMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    content: row.deleted_at ? "این پیام حذف شده است" : row.content,
    deleted: Boolean(row.deleted_at),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    editedAt: row.edited_at ? new Date(row.edited_at as string | Date).toISOString() : null,
    replyTo: row.reply_to ? {
      id: String((row.reply_to as Record<string, unknown>).id),
      content: (row.reply_to as Record<string, unknown>).content,
      senderName: (row.reply_to as Record<string, unknown>).sender_name,
    } : null,
    sender: {
      id: row.sender_id ?? row.sender_bot_id ?? null,
      username: row.sender_username ?? row.bot_username ?? null,
      displayName: row.sender_display_name ?? row.bot_name ?? row.sender_name_snapshot ?? "کاربر حذف‌شده",
      isBot: Boolean(row.sender_bot_id),
    },
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    if (!uuidSchema.safeParse(conversationId).success) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگو پیدا نشد.");
    await requireConversationMember(conversationId, session.user.id);

    const beforeParam = request.nextUrl.searchParams.get("before");
    if (beforeParam && !/^\d{1,18}$/.test(beforeParam)) throw new AppError(400, "INVALID_CURSOR", "نشانگر صفحه معتبر نیست.");
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100) : 50;
    const sql = getDb();
    const rows = await sql`
      SELECT
        m.id,
        m.content,
        m.created_at,
        m.edited_at,
        m.deleted_at,
        m.sender_id,
        m.sender_bot_id,
        m.sender_name_snapshot,
        u.username AS sender_username,
        u.display_name AS sender_display_name,
        b.username AS bot_username,
        b.name AS bot_name,
        CASE WHEN reply.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', reply.id::text,
          'content', CASE
            WHEN reply.deleted_at IS NOT NULL THEN 'این پیام حذف شده است'
            WHEN EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = ${session.user.id} AND blocked_id = reply.sender_id) THEN 'پیام پنهان‌شده'
            ELSE left(reply.content, 180)
          END,
          'sender_name', CASE
            WHEN EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = ${session.user.id} AND blocked_id = reply.sender_id) THEN 'کاربر مسدودشده'
            ELSE COALESCE(NULLIF(reply_user.display_name, ''), NULLIF(reply_bot.name, ''), reply.sender_name_snapshot, 'کاربر حذف‌شده')
          END
        ) END AS reply_to
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id AND u.deleted_at IS NULL
      LEFT JOIN bots b ON b.id = m.sender_bot_id AND b.deleted_at IS NULL
      LEFT JOIN messages reply ON reply.id = m.reply_to_id
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id AND reply_user.deleted_at IS NULL
      LEFT JOIN bots reply_bot ON reply_bot.id = reply.sender_bot_id AND reply_bot.deleted_at IS NULL
      WHERE m.conversation_id = ${conversationId}
        AND (${beforeParam}::bigint IS NULL OR m.id < ${beforeParam}::bigint)
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks blocked
          WHERE blocked.blocker_id = ${session.user.id} AND blocked.blocked_id = m.sender_id
        )
      ORDER BY m.id DESC
      LIMIT ${limit}
    `;
    await sql`UPDATE conversation_members SET last_read_at = now() WHERE conversation_id = ${conversationId} AND user_id = ${session.user.id}`;
    const messages = rows.reverse().map((row) => serializeMessage(row));
    return noStoreJson({ messages, hasMore: rows.length === limit, nextBefore: rows.length ? String(rows[0].id) : null });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    if (!uuidSchema.safeParse(conversationId).success) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگو پیدا نشد.");
    const data = await readJson(request, sendSchema);
    const access = await requireConversationMember(conversationId, session.user.id);
    if (access.type === "channel" && !["owner", "admin"].includes(access.role)) {
      throw new AppError(403, "CHANNEL_READ_ONLY", "در این کانال فقط مدیران می‌توانند پیام بفرستند.");
    }
    const sql = getDb();

    if (data.replyToId) {
      const [parent] = await sql`SELECT id FROM messages WHERE id = ${data.replyToId}::bigint AND conversation_id = ${conversationId} AND deleted_at IS NULL`;
      if (!parent) throw new AppError(404, "REPLY_NOT_FOUND", "پیامی که به آن پاسخ می‌دهید پیدا نشد.");
    }

    const result = await sql.begin(async (transaction) => {
      const [created] = await transaction`
        INSERT INTO messages (conversation_id, sender_id, sender_name_snapshot, content, reply_to_id, client_request_id)
        VALUES (${conversationId}, ${session.user.id}, ${session.user.displayName}, ${data.text}, ${data.replyToId ?? null}::bigint, ${data.clientRequestId})
        ON CONFLICT (sender_id, conversation_id, client_request_id) WHERE sender_id IS NOT NULL AND client_request_id IS NOT NULL
        DO NOTHING
        RETURNING id, content, created_at, edited_at, deleted_at, sender_id, sender_bot_id, sender_name_snapshot, reply_to_id
      `;

      let message = created;
      if (!message) {
        const [existing] = await transaction`
          SELECT id, content, created_at, edited_at, deleted_at, sender_id, sender_bot_id, sender_name_snapshot, reply_to_id
          FROM messages
          WHERE sender_id = ${session.user.id} AND conversation_id = ${conversationId} AND client_request_id = ${data.clientRequestId}
          LIMIT 1
        `;
        if (!existing || existing.content !== data.text) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "شناسهٔ ارسال قبلاً برای پیام دیگری استفاده شده است.");
        message = existing;
      } else {
        await transaction`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`;
        await transaction`
          INSERT INTO bot_events (bot_id, conversation_id, event_key, event_type, payload)
          SELECT
            bcm.bot_id,
            bcm.conversation_id,
            'message:' || m.id::text,
            'message',
            jsonb_build_object(
              'message_id', m.id::text,
              'conversation_id', m.conversation_id,
              'sender_id', m.sender_id,
              'sender_username', u.username,
              'sender_name', u.display_name,
              'text', m.content,
              'created_at', m.created_at
            )
          FROM messages m
          JOIN bot_conversation_members bcm ON bcm.conversation_id = m.conversation_id
          JOIN conversation_members added_by ON added_by.conversation_id = bcm.conversation_id AND added_by.user_id = bcm.added_by
          JOIN bots bot ON bot.id = bcm.bot_id AND bot.active = true AND bot.deleted_at IS NULL
          LEFT JOIN users u ON u.id = m.sender_id AND u.deleted_at IS NULL
          WHERE m.id = ${created.id} AND m.sender_id IS NOT NULL
          ON CONFLICT (bot_id, event_key) DO NOTHING
        `;
      }

      const [sender] = await transaction`
        SELECT u.username, u.display_name
        FROM users u WHERE u.id = ${session.user.id}
      `;
      return {
        ...message,
        sender_id: session.user.id,
        sender_username: sender.username,
        sender_display_name: sender.display_name,
      };
    });

    return noStoreJson({ message: serializeMessage(result) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
