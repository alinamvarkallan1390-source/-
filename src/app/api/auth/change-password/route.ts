import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, schema);
    const sql = getDb();
    const [user] = await sql`SELECT password_hash FROM users WHERE id = ${session.user.id} AND deleted_at IS NULL`;
    if (!user || !(await verifyPassword(data.currentPassword, user.password_hash))) {
      throw new AppError(403, "PASSWORD_REJECTED", "رمز فعلی درست نیست.");
    }
    const passwordHash = await hashPassword(data.newPassword);
    await sql.begin(async (transaction) => {
      await transaction`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${session.user.id}`;
      await transaction`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${session.user.id} AND id <> ${session.sessionId} AND revoked_at IS NULL`;
    });
    return noStoreJson({ success: true, message: "رمز عبور تغییر کرد؛ نشست‌های دیگر بسته شدند." });
  } catch (error) {
    return apiError(error);
  }
}
