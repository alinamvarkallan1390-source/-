import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    if (!['admin', 'moderator'].includes(session.user.role)) {
      throw new AppError(403, "FORBIDDEN", "این بخش فقط برای مدیران مجاز است.");
    }
    const sql = getDb();
    const [stats] = await sql`
      SELECT
        (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND created_at > now() - interval '24 hours') AS new_users_24h,
        (SELECT count(*)::int FROM conversations) AS conversations,
        (SELECT count(*)::int FROM messages WHERE deleted_at IS NULL AND created_at > now() - interval '24 hours') AS messages_24h,
        (SELECT count(*)::int FROM bots WHERE deleted_at IS NULL) AS bots,
        (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports
    `;
    return noStoreJson({ stats });
  } catch (error) {
    return apiError(error);
  }
}
