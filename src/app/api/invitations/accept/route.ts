import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { sha256 } from "@/lib/security";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(24).max(200) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { token } = await readJson(request, schema);
    const result = await getDb().begin(async (transaction) => {
      const [invite] = await transaction`
        SELECT i.id, i.conversation_id, i.max_uses, i.use_count, c.title, c.type
        FROM conversation_invites i
        JOIN conversations c ON c.id = i.conversation_id
        WHERE i.token_hash = ${sha256(token)}
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
          AND i.use_count < i.max_uses
        FOR UPDATE OF i
      `;
      if (!invite) throw new AppError(404, "INVITE_INVALID", "لینک دعوت منقضی، لغو یا نامعتبر است.");
      if (invite.type === "direct") throw new AppError(400, "INVITE_INVALID", "این گفتگو از طریق لینک قابل پیوستن نیست.");
      const [alreadyMember] = await transaction`
        SELECT 1 FROM conversation_members WHERE conversation_id = ${invite.conversation_id} AND user_id = ${session.user.id}
      `;
      if (!alreadyMember) {
        await transaction`
          INSERT INTO conversation_members (conversation_id, user_id, role)
          VALUES (${invite.conversation_id}, ${session.user.id}, 'member')
          ON CONFLICT (conversation_id, user_id) DO NOTHING
        `;
        await transaction`UPDATE conversation_invites SET use_count = use_count + 1 WHERE id = ${invite.id}`;
      }
      return { conversationId: invite.conversation_id, title: invite.title, alreadyMember: Boolean(alreadyMember) };
    });
    return noStoreJson({ ...result, success: true });
  } catch (error) {
    return apiError(error);
  }
}
