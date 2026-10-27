import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const addSchema = z.object({ username: z.string().trim().toLowerCase().min(3).max(24).regex(/^[a-z0-9_]+$/) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    if (!z.string().uuid().safeParse(conversationId).success) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگو پیدا نشد.");
    await requireConversationMember(conversationId, session.user.id);
    const members = await getDb()`
      SELECT u.id, u.username, u.display_name, cm.role, cm.joined_at
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
      WHERE cm.conversation_id = ${conversationId}
      ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, cm.joined_at
      LIMIT 200
    `;
    return noStoreJson({ members: members.map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.display_name,
      role: member.role,
      joinedAt: new Date(member.joined_at).toISOString(),
    })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    const access = await requireConversationMember(conversationId, session.user.id);
    if (access.type === "direct") throw new AppError(400, "DIRECT_MEMBERSHIP", "عضو جدید را نمی‌توان به گفتگوی خصوصی افزود.");
    if (!["owner", "admin"].includes(access.role)) throw new AppError(403, "FORBIDDEN", "فقط مدیران گفتگو می‌توانند عضو اضافه کنند.");
    const { username } = await readJson(request, addSchema);
    const sql = getDb();
    const [user] = await sql`SELECT id FROM users WHERE lower(username) = ${username} AND deleted_at IS NULL LIMIT 1`;
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "کاربر پیدا نشد.");
    const [added] = await sql`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (${conversationId}, ${user.id}, 'member')
      ON CONFLICT (conversation_id, user_id) DO NOTHING
      RETURNING user_id
    `;
    if (added) {
      await sql`
        INSERT INTO notifications (user_id, kind, payload)
        VALUES (${user.id}, 'conversation.added', ${JSON.stringify({ conversationId, title: access.title })}::jsonb)
      `;
      await sql`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'conversation.member_added', 'conversation', ${conversationId}, ${JSON.stringify({ userId: user.id })}::jsonb)
      `;
    }
    return noStoreJson({ success: true, added: Boolean(added) }, { status: added ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
