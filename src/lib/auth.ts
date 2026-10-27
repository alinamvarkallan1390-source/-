import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/security";

export const SESSION_COOKIE = "ravan_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  role: "member" | "admin" | "moderator";
  profilePublic: boolean;
  createdAt: string;
};

export type AuthenticatedSession = {
  user: PublicUser;
  sessionId: string;
};

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const piece of cookieHeader.split(";")) {
    const [key, ...valueParts] = piece.trim().split("=");
    if (key === name) {
      const value = valueParts.join("=");
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export async function getAuthenticatedSession(request: Request): Promise<AuthenticatedSession> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 200) {
    throw new AppError(401, "UNAUTHENTICATED", "برای ادامه وارد حساب شوید.");
  }

  const sql = getDb();
  const [row] = await sql`
    SELECT
      s.id AS session_id,
      s.last_seen_at,
      u.id,
      u.username,
      u.display_name,
      u.bio,
      u.avatar_url,
      u.role,
      u.profile_public,
      u.created_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.deleted_at IS NULL
    LIMIT 1
  `;

  if (!row) throw new AppError(401, "UNAUTHENTICATED", "نشست معتبر نیست؛ دوباره وارد شوید.");

  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > 5 * 60 * 1000) {
    await sql`UPDATE auth_sessions SET last_seen_at = now() WHERE id = ${row.session_id} AND revoked_at IS NULL`;
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: row.avatar_url,
      role: row.role,
      profilePublic: row.profile_public,
      createdAt: new Date(row.created_at).toISOString(),
    },
  };
}

export async function createSession(userId: string, request: Request): Promise<string> {
  const token = randomToken(32);
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
  await getDb()`
    INSERT INTO auth_sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (${userId}, ${sha256(token)}, ${userAgent}, now() + (${SESSION_TTL_SECONDS} * interval '1 second'))
  `;
  return token;
}
