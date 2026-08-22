import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a 17-20 digit Discord ID");

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  COMMAND_CHANNEL_ID: snowflake,
  ORDER_LOG_CHANNEL_ID: snowflake,
  PRIVATE_CATEGORY_ID: snowflake,
  CURATOR_ROLE_ID: snowflake,
  CLIENT_ROLE_ID: snowflake,
  EGIRL_ROLE_ID: snowflake,
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  TEST_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const missingOrInvalid = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n  - ");

    throw new Error(`Missing or invalid required settings:\n  - ${missingOrInvalid}`);
  }

  return result.data;
}
