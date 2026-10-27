import { z } from "zod";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emailIsConfigured } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/security";
import { setSessionCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJson(request, schema);
    const identifier = data.identifier.toLowerCase();
    const sql = getDb();
    await Promise.all([
      enforceRateLimit(sql, rateLimitKey(request, "login", identifier), 10, 900),
      enforceRateLimit(sql, rateLimitKey(request, "login-ip"), 30, 900),
    ]);

    const [user] = await sql`
      SELECT id, username, email, password_hash, display_name, bio, avatar_url, role, profile_public, created_at, email_verified_at
      FROM users
      WHERE (lower(email) = ${identifier} OR lower(username) = ${identifier})
        AND deleted_at IS NULL
      LIMIT 1
    `;

    const validPassword = user
      ? await verifyPassword(data.password, user.password_hash)
      : await hashPassword(data.password).then(() => false);
    if (!user || !validPassword) {
      throw new AppError(401, "INVALID_CREDENTIALS", "نام کاربری یا رمز عبور درست نیست.");
    }
    if (emailIsConfigured() && !user.email_verified_at) {
      throw new AppError(403, "EMAIL_NOT_VERIFIED", "ابتدا نشانی ایمیل خود را تأیید کنید.");
    }

    const token = await createSession(user.id, request);
    const response = noStoreJson({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        role: user.role,
        profilePublic: user.profile_public,
        createdAt: new Date(user.created_at).toISOString(),
      },
    });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
