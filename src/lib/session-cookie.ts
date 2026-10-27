import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth";

const commonOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    ...commonOptions,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    ...commonOptions,
    maxAge: 0,
    expires: new Date(0),
  });
}
