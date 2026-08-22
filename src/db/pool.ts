import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (error) => {
    console.error(`Unexpected idle PostgreSQL connection error: ${error.message}`);
  });

  return pool;
}
