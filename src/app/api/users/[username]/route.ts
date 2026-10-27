import { NextRequest } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  try {
    const { username } = await params;
    const sql = getDb();
    let viewerId: string | null = null;
    try {
      viewerId = (await getAuthenticatedSession(request)).user.id;
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 401) throw error;
    }

    const [profile] = await sql`
      SELECT u.id, u.username, u.display_name, u.bio, u.created_at
      FROM users u
      WHERE lower(u.username) = ${username.toLowerCase()}
        AND u.deleted_at IS NULL
        AND u.profile_public = true
        AND (${viewerId}::uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${viewerId}::uuid AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ${viewerId}::uuid)
        ))
      LIMIT 1
    `;
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "این پروفایل عمومی در دسترس نیست.");
    return noStoreJson({ profile: {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      bio: profile.bio,
      createdAt: new Date(profile.created_at).toISOString(),
    } });
  } catch (error) {
    return apiError(error);
  }
}
