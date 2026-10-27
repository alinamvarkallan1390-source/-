export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError("اتصال برقرار نشد. اینترنت را بررسی و دوباره تلاش کنید.", 0, "NETWORK_ERROR");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiClientError(
      error?.message ?? `درخواست انجام نشد (${response.status}).`,
      response.status,
      error?.code ?? "REQUEST_FAILED",
    );
  }
  return payload as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "خطایی رخ داد؛ دوباره تلاش کنید.";
}
