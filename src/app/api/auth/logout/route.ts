import { AppError } from "@/lib/errors";
import { getDb } from "@/lib/db";
import { getAuthenticatedSession } from "@/lib/auth";
import { apiError, assertSameOrigin, noStoreJson } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    try {
      const session = await getAuthenticatedSession(request);
      await getDb()`UPDATE auth_sessions SET revoked_at = now() WHERE id = ${session.sessionId} AND revoked_at IS NULL`;
    } catch (error) {
      if (!(error instanceof AppError) || (error.status !== 401 && error.status !== 503)) throw error;
    }
    const response = noStoreJson({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
