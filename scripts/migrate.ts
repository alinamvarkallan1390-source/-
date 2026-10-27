import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let dollarTag: string | null = null;
  let lineComment = false;
  let blockDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockDepth > 0) {
      current += char;
      if (char === "/" && next === "*") {
        current += next;
        index += 1;
        blockDepth += 1;
      } else if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockDepth -= 1;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote === "single") {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (quote === "double") {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      current += "--";
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      current += "/*";
      index += 1;
      blockDepth = 1;
      continue;
    }
    if (char === "'") {
      current += char;
      quote = "single";
      continue;
    }
    if (char === '"') {
      current += char;
      quote = "double";
      continue;
    }
    if (char === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quote || dollarTag || blockDepth > 0) {
    throw new Error("A SQL migration has an unterminated string, dollar-quote, or comment.");
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Copy .env.example and configure a PostgreSQL connection first.");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
  });

  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;

    const directory = path.join(process.cwd(), "migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    if (files.length === 0) throw new Error("No SQL migration files were found.");

    for (const file of files) {
      const [alreadyApplied] = await sql`SELECT version FROM schema_migrations WHERE version = ${file}`;
      if (alreadyApplied) {
        console.info(`skip ${file} (already applied)`);
        continue;
      }

      const source = await readFile(path.join(directory, file), "utf8");
      const statements = splitSqlStatements(source);
      await sql.begin(async (transaction) => {
        const [alreadyAppliedInTransaction] = await transaction`SELECT version FROM schema_migrations WHERE version = ${file} FOR UPDATE`;
        if (alreadyAppliedInTransaction) return;
        for (const statement of statements) await transaction.unsafe(statement);
        await transaction`INSERT INTO schema_migrations (version) VALUES (${file})`;
      });
      console.info(`applied ${file} (${statements.length} statements)`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error";
  console.error(`Migration stopped: ${message}`);
  process.exitCode = 1;
});
