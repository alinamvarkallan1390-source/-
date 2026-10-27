import { z } from "zod";
import { createSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { sha256 } from "@/lib/security";
import { setSessionCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(24).max(200) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { token } = await readJson(request, schema);
    const sql = getDb();
    const [user] = await sql.begin(async (transaction) => {
      const [record] = await transaction`
        SELECT id, user_id FROM email_verification_tokens
        WHERE token_hash = ${sha256(token)} AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE
      `;
      if (!record) throw new AppError(400, "TOKEN_INVALID", "پیوند تأیید منقضی یا نامعتبر است.");
      await transaction`UPDATE email_verification_tokens SET consumed_at = now() WHERE id = ${record.id}`;
      const [verified] = await transaction`
        UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = ${record.user_id} AND deleted_at IS NULL
        RETURNING id, username, display_name, bio, avatar_url, role, profile_public, created_at
      `;
      if (!verified) throw new AppError(400, "TOKEN_INVALID", "این حساب دیگر در دسترس نیست.");
      return [verified];
    });

    const sessionToken = await createSession(user.id, request);
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
    setSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
