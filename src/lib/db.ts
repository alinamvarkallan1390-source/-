import postgres from "postgres";
import { AppError } from "@/lib/errors";

type DatabaseClient = ReturnType<typeof postgres>;

declare global {
  // Reuse a small pool across warm serverless invocations without connecting during build.
  var __ravanDatabase: DatabaseClient | undefined;
}

export function getDb(): DatabaseClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new AppError(503, "DATABASE_NOT_CONFIGURED", "پایگاه داده هنوز پیکربندی نشده است.");
  }

  if (!globalThis.__ravanDatabase) {
    globalThis.__ravanDatabase = postgres(connectionString, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
      prepare: false,
      onnotice: () => undefined,
    });
  }
  return globalThis.__ravanDatabase;
}
