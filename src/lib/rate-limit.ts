import type postgres from "postgres";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/security";

export function rateLimitKey(request: Request, action: string, identity = ""): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
  const client = forwarded.slice(0, 128);
  return `${action}:${client}:${identity.toLocaleLowerCase("en-US").slice(0, 160)}`;
}

export async function enforceRateLimit(
  sql: ReturnType<typeof postgres>,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const bucket = sha256(key);
  const [row] = await sql`
    INSERT INTO rate_limit_buckets (bucket_key, window_started_at, hits, updated_at)
    VALUES (${bucket}, now(), 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET
      hits = CASE
        WHEN rate_limit_buckets.window_started_at <= now() - (${windowSeconds} * interval '1 second') THEN 1
        ELSE rate_limit_buckets.hits + 1
      END,
      window_started_at = CASE
        WHEN rate_limit_buckets.window_started_at <= now() - (${windowSeconds} * interval '1 second') THEN now()
        ELSE rate_limit_buckets.window_started_at
      END,
      updated_at = now()
    RETURNING hits
  `;

  if (Number(row?.hits ?? limit + 1) > limit) {
    throw new AppError(429, "RATE_LIMITED", "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.");
  }
}
