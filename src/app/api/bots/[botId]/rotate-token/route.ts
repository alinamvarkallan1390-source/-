import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const result = await getDb().begin(async (transaction) => {
      const [bot] = await transaction`SELECT id FROM bots WHERE id = ${botId} AND owner_id = ${session.user.id} AND deleted_at IS NULL FOR UPDATE`;
      if (!bot) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
      const token = `rvn_${bot.id.replaceAll("-", "")}_${randomToken(32)}`;
      await transaction`UPDATE bot_tokens SET revoked_at = now() WHERE bot_id = ${botId} AND revoked_at IS NULL`;
      await transaction`INSERT INTO bot_tokens (bot_id, token_hash) VALUES (${botId}, ${sha256(token)})`;
      await transaction`
        INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
        VALUES (${session.user.id}, 'bot.token_rotated', 'bot', ${botId}, '{}'::jsonb)
      `;
      return token;
    });
    return noStoreJson({ token: result, warning: "توکن قبلی فوراً لغو شد؛ توکن تازه فقط همین بار نمایش داده می‌شود." });
  } catch (error) {
    return apiError(error);
  }
}
