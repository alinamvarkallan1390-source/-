import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ conversationId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { conversationId } = await readJson(request, schema);
    const [conversation] = await getDb()`
      SELECT id FROM conversations WHERE id = ${conversationId} AND is_public = true AND type IN ('group', 'channel')
    `;
    if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "گفتگوی عمومی پیدا نشد.");
    const [result] = await getDb()`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (${conversationId}, ${session.user.id}, 'member')
      ON CONFLICT (conversation_id, user_id) DO NOTHING
      RETURNING user_id
    `;
    return noStoreJson({ success: true, joined: Boolean(result) }, { status: result ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
