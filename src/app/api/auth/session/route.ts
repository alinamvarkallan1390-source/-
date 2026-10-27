import { AppError } from "@/lib/errors";
import { apiError, noStoreJson } from "@/lib/http";
import { getAuthenticatedSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedSession(request);
    return noStoreJson({ user: session.user });
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return noStoreJson({ user: null });
    return apiError(error);
  }
}
