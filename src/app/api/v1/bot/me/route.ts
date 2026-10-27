import { getAuthenticatedBot } from "@/lib/bot-auth";
import { getDb } from "@/lib/db";
import { apiError, noStoreJson } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const bot = await getAuthenticatedBot(request);
    await enforceRateLimit(getDb(), `bot:${bot.id}:read`, 120, 60);
    const [stats] = await getDb()`
      SELECT
        (SELECT count(*)::int FROM bot_conversation_members WHERE bot_id = ${bot.id}) AS conversations,
        (SELECT count(*)::int FROM bot_events WHERE bot_id = ${bot.id}) AS events
    `;
    return noStoreJson({ ok: true, result: {
      id: bot.id,
      username: bot.username,
      name: bot.name,
      conversations: Number(stats.conversations),
      events: Number(stats.events),
    } });
  } catch (error) {
    return apiError(error);
  }
}
