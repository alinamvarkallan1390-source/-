import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ status: "setup_required", database: "not_configured", email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    await getDb()`SELECT 1 AS healthy`;
    return NextResponse.json({ status: "ok", database: "connected", email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable", email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
