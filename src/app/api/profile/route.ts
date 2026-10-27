import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  displayName: z.string().trim().min(1).max(64),
  bio: z.string().trim().max(280),
  profilePublic: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, schema);
    const [user] = await getDb()`
      UPDATE users
      SET display_name = ${data.displayName}, bio = ${data.bio}, profile_public = ${data.profilePublic}, updated_at = now()
      WHERE id = ${session.user.id} AND deleted_at IS NULL
      RETURNING id, username, display_name, bio, avatar_url, role, profile_public, created_at
    `;
    await getDb()`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata)
      VALUES (${session.user.id}, 'profile.updated', 'user', ${session.user.id}, '{}'::jsonb)
    `;
    return noStoreJson({ user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      bio: user.bio,
      avatarUrl: user.avatar_url,
      role: user.role,
      profilePublic: user.profile_public,
      createdAt: new Date(user.created_at).toISOString(),
    } });
  } catch (error) {
    return apiError(error);
  }
}
