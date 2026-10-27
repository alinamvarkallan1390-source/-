import { z } from "zod";
import { getDb } from "@/lib/db";
import { emailIsConfigured, sendPasswordResetEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { email } = await readJson(request, schema);
    if (!emailIsConfigured()) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "بازیابی رمز تا زمان پیکربندی سرویس ایمیل در دسترس نیست.");
    const sql = getDb();
    await Promise.all([
      enforceRateLimit(sql, rateLimitKey(request, "password-reset", email), 3, 3600),
      enforceRateLimit(sql, rateLimitKey(request, "password-reset-ip"), 8, 3600),
    ]);
    const [user] = await sql`SELECT id, email FROM users WHERE lower(email) = ${email} AND deleted_at IS NULL LIMIT 1`;
    if (user) {
      const token = randomToken();
      await sql`UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = ${user.id} AND consumed_at IS NULL`;
      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${sha256(token)}, now() + interval '30 minutes')
      `;
      await sendPasswordResetEmail(user.email, token);
    }
    return noStoreJson({ success: true, message: "اگر حسابی با این ایمیل وجود داشته باشد، دستور بازیابی ارسال می‌شود." });
  } catch (error) {
    return apiError(error);
  }
}
