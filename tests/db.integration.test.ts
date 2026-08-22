import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateCode } from "../src/codes/generator.js";
import { CodeRepository } from "../src/db/code-repository.js";
import { runMigrations } from "../src/db/migrate.js";
import { OrderRepository } from "../src/db/order-repository.js";
import { createPool } from "../src/db/pool.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("PostgreSQL code activation", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused");
  const repository = new CodeRepository(pool);
  const orders = new OrderRepository(pool);
  let code: string;
  let orderCode: string;

  beforeAll(async () => {
    await runMigrations(pool);
    code = generateCode();
    orderCode = generateCode();
    await repository.insertCodes([code, orderCode]);
  });

  afterAll(async () => {
    const codes = [code, orderCode].filter(Boolean);
    await pool.query("DELETE FROM orders WHERE code_id IN (SELECT id FROM purchase_codes WHERE code = ANY($1::text[]))", [codes]);
    await pool.query("DELETE FROM purchase_codes WHERE code = ANY($1::text[])", [codes]);
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

  it("creates only one order for simultaneous activations", async () => {
    const results = await Promise.all([
      orders.activateCode(orderCode, "12345678901234567", "12345678901234569"),
      orders.activateCode(orderCode, "12345678901234567", "12345678901234570"),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["activated", "used"]);

    const count = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM orders o JOIN purchase_codes c ON c.id = o.code_id WHERE c.code = $1",
      [orderCode],
    );
    expect(count.rows[0]?.count).toBe("1");
  });
});
