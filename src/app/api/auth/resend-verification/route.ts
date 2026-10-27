import { z } from "zod";
import { getDb } from "@/lib/db";
import { emailIsConfigured, sendVerificationEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { randomToken, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ identifier: z.string().trim().toLowerCase().min(3).max(254) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { identifier } = await readJson(request, schema);
    if (!emailIsConfigured()) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "سرویس ایمیل پیکربندی نشده است.");
    const sql = getDb();
    await enforceRateLimit(sql, rateLimitKey(request, "verify-resend", identifier), 3, 3600);
    const [user] = await sql`
      SELECT id, email FROM users
      WHERE (lower(email) = ${identifier} OR lower(username) = ${identifier})
        AND email_verified_at IS NULL AND deleted_at IS NULL
      LIMIT 1
    `;
    if (user) {
      const token = randomToken();
      await sql`UPDATE email_verification_tokens SET consumed_at = now() WHERE user_id = ${user.id} AND consumed_at IS NULL`;
      await sql`
        INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${sha256(token)}, now() + interval '24 hours')
      `;
      await sendVerificationEmail(user.email, token);
    }
    return noStoreJson({ success: true, message: "اگر حسابی با این شناسه نیاز به تأیید داشته باشد، پیوند تازه ارسال می‌شود." });
  } catch (error) {
    return apiError(error);
  }
}
