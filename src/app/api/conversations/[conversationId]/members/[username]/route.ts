import { NextRequest } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ conversationId: string; username: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId, username } = await params;
    const access = await requireConversationMember(conversationId, session.user.id);
    if (access.type === "direct") throw new AppError(400, "DIRECT_MEMBERSHIP", "مدیریت اعضای گفتگوی خصوصی پشتیبانی نمی‌شود.");
    const [target] = await getDb()`
      SELECT cm.user_id, cm.role
      FROM conversation_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ${conversationId} AND lower(u.username) = ${username.toLowerCase()} AND u.deleted_at IS NULL
      LIMIT 1
    `;
    if (!target) throw new AppError(404, "MEMBER_NOT_FOUND", "عضو پیدا نشد.");
    const isSelf = target.user_id === session.user.id;
    if (!isSelf) {
      if (!["owner", "admin"].includes(access.role)) throw new AppError(403, "FORBIDDEN", "فقط مدیران می‌توانند عضو دیگری را حذف کنند.");
      if (target.role === "owner") throw new AppError(403, "OWNER_PROTECTED", "مالک را نمی‌توان از گفتگو حذف کرد.");
      if (access.role === "admin" && target.role === "admin") throw new AppError(403, "FORBIDDEN", "مدیر نمی‌تواند مدیر دیگری را حذف کند.");
    } else if (target.role === "owner") {
      const [others] = await getDb()`
        SELECT count(*)::int AS count FROM conversation_members WHERE conversation_id = ${conversationId} AND user_id <> ${session.user.id}
      `;
      if (Number(others.count) > 0) throw new AppError(409, "TRANSFER_OWNERSHIP_FIRST", "پیش از خروج، مالکیت گفتگو را منتقل کنید.");
    }
    const sql = getDb();
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'conversation.member_removed', 'conversation', ${conversationId}, ${JSON.stringify({ userId: target.user_id, selfLeave: isSelf })}::jsonb)
      `;
      if (isSelf && target.role === "owner") {
        await transaction`DELETE FROM conversations WHERE id = ${conversationId}`;
        return;
      }
      await transaction`
        DELETE FROM bot_events e
        WHERE e.conversation_id = ${conversationId}
          AND e.bot_id IN (
            SELECT bcm.bot_id
            FROM bot_conversation_members bcm
            WHERE bcm.conversation_id = ${conversationId}
              AND (bcm.added_by = ${target.user_id}
                OR EXISTS (SELECT 1 FROM bots b WHERE b.id = bcm.bot_id AND b.owner_id = ${target.user_id}))
          )
      `;
      await transaction`
        DELETE FROM bot_conversation_members bcm
        WHERE bcm.conversation_id = ${conversationId}
          AND (bcm.added_by = ${target.user_id}
            OR EXISTS (SELECT 1 FROM bots b WHERE b.id = bcm.bot_id AND b.owner_id = ${target.user_id}))
      `;
      await transaction`DELETE FROM conversation_members WHERE conversation_id = ${conversationId} AND user_id = ${target.user_id}`;
    });
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
