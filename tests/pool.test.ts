import { afterEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/pool.js";

describe("PostgreSQL pool", () => {
  afterEach(() => vi.restoreAllMocks());

  it("handles an idle connection error without crashing the process", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = createPool("postgresql://unused@127.0.0.1:1/unused");

    expect(() => pool.emit("error", new Error("connection restarted"))).not.toThrow();
    expect(errorLog).toHaveBeenCalledWith("Unexpected idle PostgreSQL connection error: connection restarted");

    await pool.end();
  });
});
