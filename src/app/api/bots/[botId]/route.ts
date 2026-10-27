import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(280).optional(),
  active: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined || value.active !== undefined);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const changes = await readJson(request, schema);
    const [bot] = await getDb()`
      UPDATE bots SET
        name = COALESCE(${changes.name ?? null}, name),
        description = COALESCE(${changes.description ?? null}, description),
        active = COALESCE(${changes.active ?? null}, active),
        updated_at = now()
      WHERE id = ${botId} AND owner_id = ${session.user.id} AND deleted_at IS NULL
      RETURNING id, username, name, description, active, updated_at
    `;
    if (!bot) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    if (changes.active === false) await getDb()`UPDATE bot_tokens SET revoked_at = now() WHERE bot_id = ${botId} AND revoked_at IS NULL`;
    await getDb()`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
      VALUES (${session.user.id}, 'bot.updated', 'bot', ${botId}, ${JSON.stringify({ active: changes.active ?? null })}::jsonb)
    `;
    return noStoreJson({ bot: {
      id: bot.id,
      username: bot.username,
      name: bot.name,
      description: bot.description,
      active: bot.active,
      updatedAt: new Date(bot.updated_at).toISOString(),
    } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const changed = await getDb().begin(async (transaction) => {
      const [bot] = await transaction`
        UPDATE bots SET active = false, deleted_at = now(), updated_at = now()
        WHERE id = ${botId} AND owner_id = ${session.user.id} AND deleted_at IS NULL
        RETURNING id
      `;
      if (!bot) return false;
      await transaction`UPDATE bot_tokens SET revoked_at = now() WHERE bot_id = ${botId} AND revoked_at IS NULL`;
      await transaction`DELETE FROM bot_events WHERE bot_id = ${botId}`;
      await transaction`DELETE FROM bot_conversation_members WHERE bot_id = ${botId}`;
      await transaction`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'bot.deleted', 'bot', ${botId}, '{}'::jsonb)
      `;
      return true;
    });
    if (!changed) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
