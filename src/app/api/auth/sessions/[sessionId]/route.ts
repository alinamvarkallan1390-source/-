import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await getAuthenticatedSession(request);
    const { sessionId } = await params;
    if (!uuidSchema.safeParse(sessionId).success) throw new AppError(400, "INVALID_SESSION", "شناسهٔ نشست معتبر نیست.");
    if (sessionId === current.sessionId) throw new AppError(400, "CURRENT_SESSION", "برای خروج از نشست فعلی از دکمهٔ خروج استفاده کنید.");
    const result = await getDb()`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE id = ${sessionId} AND user_id = ${current.user.id} AND revoked_at IS NULL
      RETURNING id
    `;
    if (result.count === 0) throw new AppError(404, "SESSION_NOT_FOUND", "نشست پیدا نشد.");
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
