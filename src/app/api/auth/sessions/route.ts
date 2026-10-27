import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const current = await getAuthenticatedSession(request);
    const sessions = await getDb()`
      SELECT id, user_agent, created_at, last_seen_at, expires_at, (id = ${current.sessionId}) AS current
      FROM auth_sessions
      WHERE user_id = ${current.user.id} AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen_at DESC
      LIMIT 30
    `;
    return noStoreJson({ sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.user_agent,
      createdAt: new Date(session.created_at).toISOString(),
      lastSeenAt: new Date(session.last_seen_at).toISOString(),
      expiresAt: new Date(session.expires_at).toISOString(),
      current: session.current,
    })) });
  } catch (error) {
    return apiError(error);
  }
}
