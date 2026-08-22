import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDatabaseUrl } from "../config.js";
import { CodeRepository } from "../db/code-repository.js";
import { createPool } from "../db/pool.js";
import { CodeBatchService } from "./code-batch-service.js";
import { codesToCsv } from "./csv.js";

function readCount(arguments_: readonly string[]): number {
  const countIndex = arguments_.findIndex((value) => value === "--count" || value === "-n");
  const raw = countIndex >= 0 ? arguments_[countIndex + 1] : "100";
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error("Use --count with an integer from 1 to 10000.");
  }
  return count;
}

async function main(): Promise<void> {
  const count = readCount(process.argv.slice(2));
  const pool = createPool(loadDatabaseUrl());
  try {
    const codes = await new CodeBatchService(new CodeRepository(pool)).generate(count);
    const directory = path.resolve("codes");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = `codes-${new Date().toISOString().replaceAll(":", "-")}.csv`;
    const outputPath = path.join(directory, filename);
    await writeFile(outputPath, codesToCsv(codes), { encoding: "utf8", mode: 0o600 });
    console.log(`Generated ${codes.length} codes. CSV: ${outputPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
