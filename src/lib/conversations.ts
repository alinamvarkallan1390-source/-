import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type ConversationAccess = {
  id: string;
  type: "direct" | "group" | "channel";
  title: string | null;
  role: "owner" | "admin" | "member";
};

export async function requireConversationMember(conversationId: string, userId: string): Promise<ConversationAccess> {
  const sql = getDb();
  const [conversation] = await sql`
    SELECT c.id, c.type, c.title, cm.role
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ${conversationId} AND cm.user_id = ${userId}
    LIMIT 1
  `;
  if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگو پیدا نشد.");

  if (conversation.type === "direct") {
    const [blocked] = await sql`
      SELECT 1
      FROM conversation_members other_member
      JOIN user_blocks b ON
        (b.blocker_id = ${userId} AND b.blocked_id = other_member.user_id)
        OR (b.blocker_id = other_member.user_id AND b.blocked_id = ${userId})
      WHERE other_member.conversation_id = ${conversationId}
        AND other_member.user_id <> ${userId}
      LIMIT 1
    `;
    if (blocked) throw new AppError(403, "CONVERSATION_BLOCKED", "این گفتگوی خصوصی در دسترس نیست.");
  }

  return conversation as ConversationAccess;
}
