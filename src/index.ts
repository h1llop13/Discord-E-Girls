import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`Configuration loaded for Discord server ${config.DISCORD_GUILD_ID}.`);
  console.log("Discord startup will be enabled in the Discord integration stage.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
