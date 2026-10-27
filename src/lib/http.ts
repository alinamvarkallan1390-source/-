import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(415, "JSON_REQUIRED", "درخواست باید با قالب JSON ارسال شود.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
    throw new AppError(413, "BODY_TOO_LARGE", "حجم درخواست بیش از حد مجاز است.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError(400, "INVALID_JSON", "قالب درخواست معتبر نیست.");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "INVALID_REQUEST", "اطلاعات واردشده معتبر نیست.");
  }
  return result.data;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError(403, "ORIGIN_REJECTED", "مبدأ درخواست معتبر نیست.");
  }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expectedProtocol = forwardedProto ? `${forwardedProto}:` : requestUrl.protocol;

  if (originUrl.host.toLowerCase() !== expectedHost.toLowerCase() || originUrl.protocol !== expectedProtocol) {
    throw new AppError(403, "ORIGIN_REJECTED", "مبدأ درخواست با این نشست سازگار نیست.");
  }
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const databaseCode = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (databaseCode === "23505") {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "این شناسه از قبل استفاده شده است." } },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  console.error("api_request_failed", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "درخواست انجام نشد؛ دوباره تلاش کنید." } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function noStoreJson(data: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
