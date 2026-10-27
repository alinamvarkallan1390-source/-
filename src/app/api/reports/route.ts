import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().trim().min(3).max(24).optional(),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().regex(/^\d{1,18}$/).optional(),
  reason: z.string().trim().min(5).max(1000),
}).refine((value) => value.username || value.conversationId || value.messageId, { message: "A report target is required" });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, schema);
    const sql = getDb();
    let reportedUserId: string | null = null;
    if (data.username) {
      const [target] = await sql`SELECT id FROM users WHERE lower(username) = ${data.username.toLowerCase()} AND deleted_at IS NULL LIMIT 1`;
      if (!target) throw new AppError(404, "REPORT_TARGET_NOT_FOUND", "کاربر پیدا نشد.");
      if (target.id === session.user.id) throw new AppError(400, "SELF_REPORT", "نمی‌توانید حساب خودتان را گزارش کنید.");
      reportedUserId = target.id;
    }

    if (data.conversationId) {
      const [member] = await sql`SELECT 1 FROM conversation_members WHERE conversation_id = ${data.conversationId} AND user_id = ${session.user.id}`;
      if (!member) throw new AppError(404, "REPORT_TARGET_NOT_FOUND", "مورد گزارش در دسترس نیست.");
    }
    if (data.messageId) {
      const [message] = await sql`
        SELECT m.conversation_id FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
        WHERE m.id = ${data.messageId}::bigint AND cm.user_id = ${session.user.id} LIMIT 1
      `;
      if (!message) throw new AppError(404, "REPORT_TARGET_NOT_FOUND", "مورد گزارش در دسترس نیست.");
    }

    await sql`
      INSERT INTO reports (reporter_id, reported_user_id, conversation_id, message_id, reason)
      VALUES (${session.user.id}, ${reportedUserId}, ${data.conversationId ?? null}, ${data.messageId ?? null}, ${data.reason})
    `;
    return noStoreJson({ success: true, message: "گزارش ثبت شد." }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
