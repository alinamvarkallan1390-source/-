import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(28).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(280).default(""),
});

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    const bots = await getDb()`
      SELECT
        b.id, b.username, b.name, b.description, b.active, b.created_at, b.updated_at,
        (SELECT count(*)::int FROM bot_conversation_members bcm WHERE bcm.bot_id = b.id) AS conversations_count,
        COALESCE((SELECT json_agg(bcm.conversation_id::text ORDER BY bcm.added_at) FROM bot_conversation_members bcm WHERE bcm.bot_id = b.id), '[]'::json) AS conversation_ids,
        (SELECT count(*)::int FROM bot_events e WHERE e.bot_id = b.id) AS events_count,
        (SELECT max(t.last_used_at) FROM bot_tokens t WHERE t.bot_id = b.id AND t.revoked_at IS NULL) AS last_used_at,
        EXISTS (SELECT 1 FROM bot_tokens t WHERE t.bot_id = b.id AND t.revoked_at IS NULL) AS has_active_token
      FROM bots b
      WHERE b.owner_id = ${session.user.id} AND b.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT 50
    `;
    return noStoreJson({ bots: bots.map((bot) => ({
      id: bot.id,
      username: bot.username,
      name: bot.name,
      description: bot.description,
      active: bot.active,
      createdAt: new Date(bot.created_at).toISOString(),
      updatedAt: new Date(bot.updated_at).toISOString(),
      conversationsCount: Number(bot.conversations_count),
      conversationIds: bot.conversation_ids as string[],
      eventsCount: Number(bot.events_count),
      lastUsedAt: bot.last_used_at ? new Date(bot.last_used_at).toISOString() : null,
      hasActiveToken: bot.has_active_token,
    })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, schema);
    const sql = getDb();
    const result = await sql.begin(async (transaction) => {
      const [bot] = await transaction`
        INSERT INTO bots (owner_id, username, name, description)
        VALUES (${session.user.id}, ${data.username}, ${data.name}, ${data.description})
        RETURNING id, username, name, description, active, created_at
      `;
      const token = `rvn_${bot.id.replaceAll("-", "")}_${randomToken(32)}`;
      await transaction`INSERT INTO bot_tokens (bot_id, token_hash) VALUES (${bot.id}, ${sha256(token)})`;
      await transaction`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'bot.created', 'bot', ${bot.id}, '{}'::jsonb)
      `;
      return { bot, token };
    });
    return noStoreJson({
      bot: {
        id: result.bot.id,
        username: result.bot.username,
        name: result.bot.name,
        description: result.bot.description,
        active: result.bot.active,
        createdAt: new Date(result.bot.created_at).toISOString(),
      },
      token: result.token,
      warning: "این توکن فقط همین بار نمایش داده می‌شود. آن را در متغیر محیطی برنامهٔ خود ذخیره کنید.",
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
