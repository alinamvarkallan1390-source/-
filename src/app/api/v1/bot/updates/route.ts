import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedBot } from "@/lib/bot-auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const cursorSchema = z.string().regex(/^\d{1,18}$/).default("0");

export async function GET(request: NextRequest) {
  try {
    const bot = await getAuthenticatedBot(request);
    const rawOffset = request.nextUrl.searchParams.get("offset") ?? "0";
    const parsedOffset = cursorSchema.safeParse(rawOffset);
    if (!parsedOffset.success || BigInt(rawOffset) > 9_223_372_036_854_775_807n) {
      throw new AppError(400, "INVALID_OFFSET", "نشانگر رویداد معتبر نیست.");
    }
    const offset = parsedOffset.data;
    const sql = getDb();
    await enforceRateLimit(sql, `bot:${bot.id}:updates`, 120, 60);
    const events = await sql`
      SELECT id::text, event_key, event_type, payload, created_at
      FROM bot_events e
      WHERE e.bot_id = ${bot.id} AND e.id > ${offset}::bigint
        AND EXISTS (
          SELECT 1
          FROM bot_conversation_members bcm
          JOIN conversation_members added_by ON added_by.conversation_id = bcm.conversation_id AND added_by.user_id = bcm.added_by
          WHERE bcm.bot_id = e.bot_id AND bcm.conversation_id = e.conversation_id
        )
      ORDER BY e.id ASC
      LIMIT 100
    `;
    if (events.length) {
      const lastId = events[events.length - 1].id;
      await sql`
        UPDATE bot_events
        SET delivered_at = COALESCE(delivered_at, now()), attempts = attempts + 1
        WHERE bot_id = ${bot.id} AND id > ${offset}::bigint AND id <= ${lastId}::bigint
          AND EXISTS (
            SELECT 1
            FROM bot_conversation_members bcm
            JOIN conversation_members added_by ON added_by.conversation_id = bcm.conversation_id AND added_by.user_id = bcm.added_by
            WHERE bcm.bot_id = bot_events.bot_id AND bcm.conversation_id = bot_events.conversation_id
          )
      `;
    }
    return noStoreJson({ ok: true, result: events.map((event) => ({
      update_id: String(event.id),
      type: event.event_type,
      event_key: event.event_key,
      created_at: new Date(event.created_at).toISOString(),
      data: event.payload,
    })) });
  } catch (error) {
    return apiError(error);
  }
}
