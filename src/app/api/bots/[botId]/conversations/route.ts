import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { requireConversationMember } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ conversationId: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const { conversationId } = await readJson(request, schema);
    const sql = getDb();
    const [bot] = await sql`SELECT id FROM bots WHERE id = ${botId} AND owner_id = ${session.user.id} AND active = true AND deleted_at IS NULL`;
    if (!bot) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد یا غیرفعال است.");
    const conversation = await requireConversationMember(conversationId, session.user.id);
    if (conversation.type === "channel" && !["owner", "admin"].includes(conversation.role)) {
      throw new AppError(403, "FORBIDDEN", "برای افزودن ربات به کانال باید مدیر باشید.");
    }
    const [membership] = await sql`
      INSERT INTO bot_conversation_members (bot_id, conversation_id, added_by)
      VALUES (${botId}, ${conversationId}, ${session.user.id})
      ON CONFLICT (bot_id, conversation_id) DO NOTHING
      RETURNING bot_id
    `;
    return noStoreJson({ success: true, attached: Boolean(membership) }, { status: membership ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const { botId } = await params;
    if (!z.string().uuid().safeParse(botId).success) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    const { conversationId } = await readJson(request, schema);
    const sql = getDb();
    const [bot] = await sql`SELECT id FROM bots WHERE id = ${botId} AND owner_id = ${session.user.id} AND deleted_at IS NULL`;
    if (!bot) throw new AppError(404, "BOT_NOT_FOUND", "ربات پیدا نشد.");
    await sql.begin(async (transaction) => {
      await transaction`DELETE FROM bot_events WHERE bot_id = ${botId} AND conversation_id = ${conversationId}`;
      await transaction`DELETE FROM bot_conversation_members WHERE bot_id = ${botId} AND conversation_id = ${conversationId}`;
    });
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
