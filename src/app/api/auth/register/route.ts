import { z } from "zod";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emailIsConfigured, sendVerificationEmail } from "@/lib/email";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { enforceRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { randomToken, sha256, hashPassword } from "@/lib/security";
import { setSessionCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(24).regex(/^[a-z0-9_]+$/),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const data = await readJson(request, schema);
    const sql = getDb();
    await enforceRateLimit(sql, rateLimitKey(request, "register"), 8, 3600);
    const requiresVerification = emailIsConfigured();
    const passwordHash = await hashPassword(data.password);
    const [user] = await sql`
      INSERT INTO users (username, email, password_hash, display_name)
      VALUES (${data.username}, ${data.email}, ${passwordHash}, ${data.displayName})
      RETURNING id, username, display_name, bio, avatar_url, role, profile_public, created_at
    `;

    if (requiresVerification) {
      const token = randomToken();
      await sql`
        INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
        VALUES (${user.id}, ${sha256(token)}, now() + interval '24 hours')
      `;
      await sendVerificationEmail(data.email, token);
      return noStoreJson({ requiresEmailVerification: true, message: "برای فعال‌سازی حساب، پیوند تأیید را از ایمیل خود باز کنید." }, { status: 201 });
    }

    const token = await createSession(user.id, request);
    const response = noStoreJson({
      requiresEmailVerification: false,
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
    }, { status: 201 });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
