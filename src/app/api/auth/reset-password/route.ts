import { z } from "zod";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { hashPassword, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(24).max(200), password: z.string().min(12).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { token, password } = await readJson(request, schema);
    const passwordHash = await hashPassword(password);
    const sql = getDb();
    await sql.begin(async (transaction) => {
      const [record] = await transaction`
        SELECT id, user_id FROM password_reset_tokens
        WHERE token_hash = ${sha256(token)} AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE
      `;
      if (!record) throw new AppError(400, "TOKEN_INVALID", "پیوند بازیابی منقضی یا نامعتبر است.");
      const [updated] = await transaction`
        UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
        WHERE id = ${record.user_id} AND deleted_at IS NULL RETURNING id
      `;
      if (!updated) throw new AppError(400, "TOKEN_INVALID", "این حساب دیگر در دسترس نیست.");
      await transaction`UPDATE password_reset_tokens SET consumed_at = now() WHERE id = ${record.id}`;
      await transaction`UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = ${record.user_id} AND consumed_at IS NULL`;
      await transaction`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = ${record.user_id} AND revoked_at IS NULL`;
    });
    return noStoreJson({ success: true, message: "رمز عبور تغییر کرد؛ اکنون با رمز تازه وارد شوید." });
  } catch (error) {
    return apiError(error);
  }
}
