import { NextRequest } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

async function findTarget(username: string) {
  const [user] = await getDb()`
    SELECT id FROM users WHERE lower(username) = ${username.toLowerCase()} AND deleted_at IS NULL LIMIT 1
  `;
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "کاربر پیدا نشد.");
  return user.id as string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { username } = await params;
    const targetId = await findTarget(username);
    if (targetId === session.user.id) throw new AppError(400, "SELF_BLOCK", "نمی‌توانید خودتان را مسدود کنید.");
    await getDb()`
      INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${session.user.id}, ${targetId})
      ON CONFLICT (blocker_id, blocked_id) DO NOTHING
    `;
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { username } = await params;
    const targetId = await findTarget(username);
    await getDb()`DELETE FROM user_blocks WHERE blocker_id = ${session.user.id} AND blocked_id = ${targetId}`;
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
