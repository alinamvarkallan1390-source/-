import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { requireConversationMember } from "@/lib/conversations";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ muted: z.boolean().optional(), archived: z.boolean().optional() })
  .refine((value) => value.muted !== undefined || value.archived !== undefined);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await params;
    if (!z.string().uuid().safeParse(conversationId).success) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگو پیدا نشد.");
    await requireConversationMember(conversationId, session.user.id);
    const changes = await readJson(request, schema);
    const [member] = await getDb()`
      UPDATE conversation_members SET
        muted = COALESCE(${changes.muted ?? null}, muted),
        archived = COALESCE(${changes.archived ?? null}, archived)
      WHERE conversation_id = ${conversationId} AND user_id = ${session.user.id}
      RETURNING muted, archived
    `;
    return noStoreJson({ muted: member.muted, archived: member.archived });
  } catch (error) {
    return apiError(error);
  }
}
