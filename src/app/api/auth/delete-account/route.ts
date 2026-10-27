import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, assertSameOrigin, noStoreJson, readJson } from "@/lib/http";
import { randomToken, hashPassword, verifyPassword } from "@/lib/security";
import { clearSessionCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1).max(128), confirmation: z.literal("DELETE") });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthenticatedSession(request);
    const data = await readJson(request, schema);
    const sql = getDb();
    const [user] = await sql`SELECT password_hash FROM users WHERE id = ${session.user.id} AND deleted_at IS NULL`;
    if (!user || !(await verifyPassword(data.password, user.password_hash))) {
      throw new AppError(403, "PASSWORD_REJECTED", "رمز عبور درست نیست.");
    }

    const replacementHash = await hashPassword(randomToken(48));
    const anonUsername = `deleted_${session.user.id.replaceAll("-", "").slice(0, 16)}`;
    await sql.begin(async (transaction) => {
      await transaction`DELETE FROM auth_sessions WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM email_verification_tokens WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM password_reset_tokens WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM bot_events WHERE payload->>'sender_id' = ${session.user.id}`;
      await transaction`UPDATE messages SET sender_id = NULL, sender_name_snapshot = 'کاربر حذف‌شده' WHERE sender_id = ${session.user.id}`;
      await transaction`
        UPDATE conversation_members AS successor
        SET role = 'owner'
        FROM (
          SELECT departing.conversation_id, (
            SELECT candidate.user_id
            FROM conversation_members candidate
            WHERE candidate.conversation_id = departing.conversation_id
              AND candidate.user_id <> ${session.user.id}
            ORDER BY CASE WHEN candidate.role = 'admin' THEN 0 ELSE 1 END, candidate.joined_at, candidate.user_id
            LIMIT 1
          ) AS successor_id
          FROM conversation_members departing
          WHERE departing.user_id = ${session.user.id} AND departing.role = 'owner'
        ) AS departures
        WHERE successor.conversation_id = departures.conversation_id
          AND successor.user_id = departures.successor_id
      `;
      await transaction`
        DELETE FROM conversations conversation
        USING conversation_members departing
        WHERE conversation.id = departing.conversation_id
          AND departing.user_id = ${session.user.id}
          AND departing.role = 'owner'
          AND NOT EXISTS (
            SELECT 1 FROM conversation_members other_member
            WHERE other_member.conversation_id = conversation.id
              AND other_member.user_id <> ${session.user.id}
          )
      `;
      await transaction`
        DELETE FROM bot_events event
        WHERE EXISTS (
          SELECT 1
          FROM bot_conversation_members bcm
          WHERE bcm.bot_id = event.bot_id
            AND bcm.conversation_id = event.conversation_id
            AND (bcm.added_by = ${session.user.id}
              OR EXISTS (SELECT 1 FROM bots b WHERE b.id = bcm.bot_id AND b.owner_id = ${session.user.id}))
        )
      `;
      await transaction`
        DELETE FROM bot_conversation_members bcm
        WHERE bcm.added_by = ${session.user.id}
          OR EXISTS (SELECT 1 FROM bots b WHERE b.id = bcm.bot_id AND b.owner_id = ${session.user.id})
      `;
      await transaction`DELETE FROM conversation_members WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM bots WHERE owner_id = ${session.user.id}`;
      await transaction`DELETE FROM user_blocks WHERE blocker_id = ${session.user.id} OR blocked_id = ${session.user.id}`;
      await transaction`DELETE FROM saved_messages WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM message_read_states WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM message_reactions WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM drafts WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM notifications WHERE user_id = ${session.user.id}`;
      await transaction`DELETE FROM reports WHERE reporter_id = ${session.user.id}`;
      await transaction`UPDATE reports SET reported_user_id = NULL WHERE reported_user_id = ${session.user.id}`;
      await transaction`UPDATE message_attachments SET owner_id = NULL WHERE owner_id = ${session.user.id}`;
      await transaction`UPDATE conversation_invites SET created_by = NULL WHERE created_by = ${session.user.id}`;
      await transaction`UPDATE audit_logs SET actor_id = NULL WHERE actor_id = ${session.user.id}`;
      await transaction`
        UPDATE users SET
          username = ${anonUsername},
          email = ${`deleted+${session.user.id.replaceAll("-", "")}@deleted.invalid`},
          password_hash = ${replacementHash},
          display_name = 'کاربر حذف‌شده',
          bio = '',
          avatar_url = NULL,
          profile_public = false,
          email_verified_at = NULL,
          deleted_at = now(),
          updated_at = now()
        WHERE id = ${session.user.id}
      `;
    });

    const response = noStoreJson({ success: true, message: "حساب حذف و اطلاعات شناسایی‌کننده ناشناس شد." });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiError(error);
  }
}
