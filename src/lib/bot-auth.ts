import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/security";

export type AuthenticatedBot = {
  id: string;
  ownerId: string;
  username: string;
  name: string;
};

export async function getAuthenticatedBot(request: Request): Promise<AuthenticatedBot> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(rvn_([a-f0-9]{32})_[A-Za-z0-9_-]{40,60})$/i);
  if (!match) throw new AppError(401, "BOT_TOKEN_INVALID", "توکن ربات معتبر نیست.");
  const token = match[1];
  const botId = match[2].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase();
  const [row] = await getDb()`
    SELECT b.id, b.owner_id, b.username, b.name
    FROM bot_tokens t
    JOIN bots b ON b.id = t.bot_id
    WHERE b.id = ${botId}::uuid
      AND t.token_hash = ${sha256(token)}
      AND t.revoked_at IS NULL
      AND b.active = true
      AND b.deleted_at IS NULL
    LIMIT 1
  `;
  if (!row) throw new AppError(401, "BOT_TOKEN_INVALID", "توکن ربات معتبر نیست یا لغو شده است.");
  await getDb()`UPDATE bot_tokens SET last_used_at = now() WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL`;
  return { id: row.id, ownerId: row.owner_id, username: row.username, name: row.name };
}
