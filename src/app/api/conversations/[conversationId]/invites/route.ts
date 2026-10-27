import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ expiresInHours: z.number().int().min(1).max(168).default(72), maxUses: z.number().int().min(1).max(100).default(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    const access = await requireConversationMember(conversationId, session.user.id);
    if (access.type === "direct") throw new AppError(400, "INVITE_UNSUPPORTED", "لینک دعوت فقط برای گروه و کانال است.");
    if (!["owner", "admin"].includes(access.role)) throw new AppError(403, "FORBIDDEN", "فقط مدیران می‌توانند لینک دعوت بسازند.");
    const data = await readJson(request, schema);
    const token = randomToken();
    await getDb()`
      INSERT INTO conversation_invites (conversation_id, created_by, token_hash, expires_at, max_uses)
      VALUES (${conversationId}, ${session.user.id}, ${sha256(token)}, now() + (${data.expiresInHours} * interval '1 hour'), ${data.maxUses})
    `;
    return noStoreJson({ inviteToken: token, invitePath: `/invite/${token}`, expiresInHours: data.expiresInHours, maxUses: data.maxUses }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
