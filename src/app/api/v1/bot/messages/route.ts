import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedBot } from "@/lib/bot-auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson, readJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(5000),
  clientRequestId: z.string().uuid().optional(),
  replyToId: z.string().regex(/^\d{1,18}$/).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const bot = await getAuthenticatedBot(request);
    const sql = getDb();
    await enforceRateLimit(sql, `bot:${bot.id}:send`, 30, 60);
    const body = await readJson(request, schema);
    const idempotencyHeader = request.headers.get("idempotency-key");
    const clientRequestId = body.clientRequestId ?? idempotencyHeader;
    if (!clientRequestId || !z.string().uuid().safeParse(clientRequestId).success) {
      throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "یک UUID در clientRequestId یا Idempotency-Key لازم است.");
    }

    const [membership] = await sql`
      SELECT c.type, bcm.added_by, cm.role AS added_by_role
      FROM bot_conversation_members bcm
      JOIN conversations c ON c.id = bcm.conversation_id
      LEFT JOIN conversation_members cm ON cm.conversation_id = bcm.conversation_id AND cm.user_id = bcm.added_by
      WHERE bcm.bot_id = ${bot.id} AND bcm.conversation_id = ${body.conversationId}
      LIMIT 1
    `;
    if (!membership || !membership.added_by_role) throw new AppError(403, "BOT_NOT_IN_CONVERSATION", "عضویت ربات در این گفتگو معتبر نیست.");
    if (membership.type === "channel" && !["owner", "admin"].includes(membership.added_by_role)) {
      throw new AppError(403, "CHANNEL_READ_ONLY", "ربات اجازهٔ ارسال به این کانال را ندارد.");
    }
    if (body.replyToId) {
      const [parent] = await sql`SELECT id FROM messages WHERE id = ${body.replyToId}::bigint AND conversation_id = ${body.conversationId} AND deleted_at IS NULL`;
      if (!parent) throw new AppError(404, "REPLY_NOT_FOUND", "پیامی که به آن پاسخ می‌دهید پیدا نشد.");
    }

    const result = await sql.begin(async (transaction) => {
      const [created] = await transaction`
        INSERT INTO messages (conversation_id, sender_bot_id, sender_name_snapshot, content, reply_to_id, client_request_id)
        VALUES (${body.conversationId}, ${bot.id}, ${bot.name}, ${body.text}, ${body.replyToId ?? null}::bigint, ${clientRequestId})
        ON CONFLICT (sender_bot_id, conversation_id, client_request_id) WHERE sender_bot_id IS NOT NULL AND client_request_id IS NOT NULL
        DO NOTHING
        RETURNING id, content, created_at
      `;
      let message = created;
      if (!message) {
        const [existing] = await transaction`
          SELECT id, content, created_at FROM messages
          WHERE sender_bot_id = ${bot.id} AND conversation_id = ${body.conversationId} AND client_request_id = ${clientRequestId}
          LIMIT 1
        `;
        if (!existing || existing.content !== body.text) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "شناسهٔ ارسال برای پیام دیگری استفاده شده است.");
        message = existing;
      } else {
        await transaction`UPDATE conversations SET updated_at = now() WHERE id = ${body.conversationId}`;
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
              'sender_bot', ${JSON.stringify({ id: bot.id, username: bot.username, name: bot.name })}::jsonb,
              'text', m.content,
              'created_at', m.created_at
            )
          FROM messages m
          JOIN bot_conversation_members bcm ON bcm.conversation_id = m.conversation_id
          JOIN conversation_members added_by ON added_by.conversation_id = bcm.conversation_id AND added_by.user_id = bcm.added_by
          JOIN bots other_bot ON other_bot.id = bcm.bot_id AND other_bot.active = true AND other_bot.deleted_at IS NULL
          WHERE m.id = ${created.id} AND bcm.bot_id <> ${bot.id}
          ON CONFLICT (bot_id, event_key) DO NOTHING
        `;
      }
      return message;
    });

    return noStoreJson({ ok: true, result: {
      message_id: String(result.id),
      conversation_id: body.conversationId,
      text: result.content,
      created_at: new Date(result.created_at).toISOString(),
      idempotency_key: clientRequestId,
    } }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
