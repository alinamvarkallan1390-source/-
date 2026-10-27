import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";
import { normalizePersianSearch } from "@/lib/search";

export const dynamic = "force-dynamic";

function optionalDate(value: string | null, name: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, "INVALID_FILTER", `فیلتر ${name} معتبر نیست.`);
  return date;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthenticatedSession(request);
    const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
    const exact = rawQuery.length >= 2 && rawQuery.startsWith('"') && rawQuery.endsWith('"');
    const query = exact ? rawQuery.slice(1, -1) : rawQuery;
    if (query.trim().length < 2 || query.length > 160) {
      throw new AppError(400, "INVALID_QUERY", "عبارت جست‌وجو باید بین ۲ تا ۱۶۰ نویسه باشد.");
    }

    const normalizedQuery = normalizePersianSearch(query);
    if (normalizedQuery.length < 2) throw new AppError(400, "INVALID_QUERY", "عبارت جست‌وجو پس از یکسان‌سازی کوتاه است.");

    const conversationParam = request.nextUrl.searchParams.get("conversationId");
    const conversationId = conversationParam && z.string().uuid().safeParse(conversationParam).success ? conversationParam : null;
    if (conversationParam && !conversationId) throw new AppError(400, "INVALID_FILTER", "شناسهٔ گفتگو معتبر نیست.");
    const from = optionalDate(request.nextUrl.searchParams.get("from"), "از تاریخ");
    const to = optionalDate(request.nextUrl.searchParams.get("to"), "تا تاریخ");
    if (from && to && from > to) throw new AppError(400, "INVALID_FILTER", "بازهٔ زمانی معتبر نیست.");
    const senderUsername = request.nextUrl.searchParams.get("sender")?.trim().toLowerCase() ?? null;
    if (senderUsername && !/^[a-z0-9_]{3,24}$/.test(senderUsername)) {
      throw new AppError(400, "INVALID_FILTER", "نام کاربری فرستنده معتبر نیست.");
    }

    const sql = getDb();
    const [sender] = senderUsername
      ? await sql`SELECT id FROM users WHERE lower(username) = ${senderUsername} AND deleted_at IS NULL LIMIT 1`
      : [null];
    const messages = senderUsername && !sender ? [] : await sql`
      SELECT
        m.id::text AS id,
        m.conversation_id,
        c.type AS conversation_type,
        COALESCE(c.title, peer.display_name, 'گفتگوی خصوصی') AS conversation_title,
        m.content,
        m.created_at,
        u.username AS sender_username,
        COALESCE(u.display_name, m.sender_name_snapshot, 'کاربر حذف‌شده') AS sender_name,
        ts_rank_cd(m.search_vector, plainto_tsquery('simple', search_normalize(${normalizedQuery}))) AS rank
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ${session.user.id}
      LEFT JOIN users u ON u.id = m.sender_id AND u.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT other_user.display_name
        FROM conversation_members other_member
        JOIN users other_user ON other_user.id = other_member.user_id AND other_user.deleted_at IS NULL
        WHERE other_member.conversation_id = c.id AND other_member.user_id <> ${session.user.id}
        LIMIT 1
      ) peer ON c.type = 'direct'
      WHERE m.deleted_at IS NULL
        AND (${conversationId}::uuid IS NULL OR c.id = ${conversationId}::uuid)
        AND (${sender?.id ?? null}::uuid IS NULL OR m.sender_id = ${sender?.id ?? null}::uuid)
        AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR m.created_at <= ${to}::timestamptz)
        AND (
          (${exact} AND strpos(search_normalize(m.content), ${normalizedQuery}) > 0)
          OR (NOT ${exact} AND (
            m.search_vector @@ plainto_tsquery('simple', search_normalize(${normalizedQuery}))
            OR strpos(search_normalize(m.content), ${normalizedQuery}) > 0
          ))
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks blocked
          WHERE blocked.blocker_id = ${session.user.id} AND blocked.blocked_id = m.sender_id
        )
        AND NOT (
          c.type = 'direct' AND EXISTS (
            SELECT 1
            FROM conversation_members other_member
            JOIN user_blocks b ON
              (b.blocker_id = ${session.user.id} AND b.blocked_id = other_member.user_id)
              OR (b.blocker_id = other_member.user_id AND b.blocked_id = ${session.user.id})
            WHERE other_member.conversation_id = c.id AND other_member.user_id <> ${session.user.id}
          )
        )
      ORDER BY rank DESC, m.created_at DESC, m.id DESC
      LIMIT 40
    `;

    const people = await sql`
      SELECT u.id, u.username, u.display_name, u.bio
      FROM users u
      WHERE u.deleted_at IS NULL AND u.profile_public = true
        AND (
          strpos(search_normalize(u.username), ${normalizedQuery}) > 0
          OR strpos(search_normalize(u.display_name), ${normalizedQuery}) > 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${session.user.id} AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = ${session.user.id})
        )
      ORDER BY CASE WHEN lower(u.username) = lower(${query}) THEN 0 ELSE 1 END, u.username
      LIMIT 15
    `;

    const publicConversations = await sql`
      SELECT c.id, c.type, c.title, c.username, c.is_public
      FROM conversations c
      WHERE c.is_public = true
        AND c.type IN ('group', 'channel')
        AND (
          strpos(search_normalize(COALESCE(c.title, '')), ${normalizedQuery}) > 0
          OR strpos(search_normalize(COALESCE(c.username, '')), ${normalizedQuery}) > 0
        )
        AND NOT EXISTS (SELECT 1 FROM conversation_members mine WHERE mine.conversation_id = c.id AND mine.user_id = ${session.user.id})
      ORDER BY lower(c.title), c.created_at DESC
      LIMIT 15
    `;

    return noStoreJson({
      query,
      exact,
      messages: messages.map((item) => ({
        id: String(item.id),
        conversationId: item.conversation_id,
        conversationType: item.conversation_type,
        conversationTitle: item.conversation_title,
        content: item.content,
        createdAt: new Date(item.created_at).toISOString(),
        senderUsername: item.sender_username,
        senderName: item.sender_name,
        rank: Number(item.rank),
      })),
      people: people.map((person) => ({ id: person.id, username: person.username, displayName: person.display_name, bio: person.bio })),
      publicConversations: publicConversations.map((conversation) => ({
        id: conversation.id,
        type: conversation.type,
        title: conversation.title,
        username: conversation.username,
        isPublic: conversation.is_public,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
