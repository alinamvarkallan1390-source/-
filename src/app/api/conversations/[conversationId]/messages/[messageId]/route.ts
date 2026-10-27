import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const contentSchema = z.object({ content: z.string().trim().min(1).max(5000) });
const uuidSchema = z.string().uuid();
const messageIdSchema = z.string().regex(/^\d{1,18}$/);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ conversationId: string; messageId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId, messageId } = await params;
    if (!uuidSchema.safeParse(conversationId).success || !messageIdSchema.safeParse(messageId).success) {
      throw new AppError(404, "MESSAGE_NOT_FOUND", "پیام پیدا نشد.");
    }
    const access = await requireConversationMember(conversationId, session.user.id);
    const { content } = await readJson(request, contentSchema);
    const [message] = await getDb()`
      UPDATE messages
      SET content = ${content}, edited_at = now()
      WHERE id = ${messageId}::bigint
        AND conversation_id = ${conversationId}
        AND sender_id = ${session.user.id}
        AND deleted_at IS NULL
        AND created_at > now() - interval '15 minutes'
      RETURNING id, content, edited_at
    `;
    if (!message) {
      const [exists] = await getDb()`SELECT id FROM messages WHERE id = ${messageId}::bigint AND conversation_id = ${conversationId}`;
      if (!exists) throw new AppError(404, "MESSAGE_NOT_FOUND", "پیام پیدا نشد.");
      if (access.role !== "admin" && access.role !== "owner") throw new AppError(403, "MESSAGE_EDIT_FORBIDDEN", "فقط نویسنده می‌تواند این پیام را ویرایش کند.");
      throw new AppError(403, "MESSAGE_EDIT_EXPIRED", "مهلت ویرایش این پیام پایان یافته است.");
    }
    return noStoreJson({ message: { id: String(message.id), content: message.content, editedAt: new Date(message.edited_at).toISOString() } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ conversationId: string; messageId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId, messageId } = await params;
    if (!uuidSchema.safeParse(conversationId).success || !messageIdSchema.safeParse(messageId).success) {
      throw new AppError(404, "MESSAGE_NOT_FOUND", "پیام پیدا نشد.");
    }
    const access = await requireConversationMember(conversationId, session.user.id);
    const mayModerate = ["owner", "admin"].includes(access.role);
    const [message] = await getDb()`
      UPDATE messages
      SET deleted_at = COALESCE(deleted_at, now()), content = ''
      WHERE id = ${messageId}::bigint
        AND conversation_id = ${conversationId}
        AND (sender_id = ${session.user.id} OR ${mayModerate})
      RETURNING id
    `;
    if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND", "پیام پیدا نشد یا اجازهٔ حذف آن را ندارید.");
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
