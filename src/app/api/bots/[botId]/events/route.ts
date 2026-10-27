import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const [bot] = await getDb()`SELECT id FROM bots WHERE id = ${botId} AND owner_id = ${session.user.id} AND deleted_at IS NULL`;
    if (!bot) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const events = await getDb()`
      SELECT event.id::text, event.event_type, event.created_at, event.delivered_at, event.attempts
      FROM bot_events event
      WHERE event.bot_id = ${botId}
        AND EXISTS (
          SELECT 1
          FROM bot_conversation_members bcm
          JOIN conversation_members added_by ON added_by.conversation_id = bcm.conversation_id AND added_by.user_id = bcm.added_by
          WHERE bcm.bot_id = event.bot_id AND bcm.conversation_id = event.conversation_id
        )
      ORDER BY event.id DESC LIMIT 100
    `;
    return noStoreJson({ events: events.map((event) => ({
      updateId: event.id,
      type: event.event_type,
      createdAt: new Date(event.created_at).toISOString(),
      deliveredAt: event.delivered_at ? new Date(event.delivered_at).toISOString() : null,
      attempts: Number(event.attempts),
    })) });
  } catch (error) {
    return apiError(error);
  }
}
