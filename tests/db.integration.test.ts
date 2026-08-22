import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateCode } from "../src/codes/generator.js";
import { CodeRepository } from "../src/db/code-repository.js";
import { runMigrations } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("PostgreSQL code activation", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused");
  const repository = new CodeRepository(pool);
  let code: string;

  beforeAll(async () => {
    await runMigrations(pool);
    code = generateCode();
    await repository.insertCodes([code]);
  });

  afterAll(async () => {
    if (code) await pool.query("DELETE FROM purchase_codes WHERE code = $1", [code]);
    await pool.end();
  });

  it("lets only one of two simultaneous attempts consume a code", async () => {
    const results = await Promise.all([
      repository.consume(code, "12345678901234567"),
      repository.consume(code, "12345678901234568"),
    ]);

    expect(results.sort()).toEqual(["consumed", "used"]);
    expect(await repository.status(code)).toBe("used");
  });
});
