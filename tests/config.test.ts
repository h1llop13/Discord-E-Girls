import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnvironment: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: "test-token",
  DISCORD_APPLICATION_ID: "12345678901234567",
  DISCORD_GUILD_ID: "12345678901234568",
  COMMAND_CHANNEL_ID: "12345678901234569",
  ORDER_LOG_CHANNEL_ID: "12345678901234570",
  PRIVATE_CATEGORY_ID: "12345678901234571",
  CURATOR_ROLE_ID: "12345678901234572",
  CLIENT_ROLE_ID: "12345678901234573",
  EGIRL_ROLE_ID: "12345678901234574",
  DATABASE_URL: "postgresql://user:password@localhost:5432/bot",
  TEST_MODE: "false",
};

describe("loadConfig", () => {
  it("parses a complete environment", () => {
    expect(loadConfig(validEnvironment)).toMatchObject({
      DISCORD_GUILD_ID: "12345678901234568",
      TEST_MODE: false,
    });
  });

  it("reports all missing settings in one error", () => {
    expect(() => loadConfig({})).toThrow(/DISCORD_TOKEN/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects malformed Discord IDs", () => {
    expect(() => loadConfig({ ...validEnvironment, DISCORD_GUILD_ID: "not-an-id" })).toThrow(
      /DISCORD_GUILD_ID/,
    );
  });
});
