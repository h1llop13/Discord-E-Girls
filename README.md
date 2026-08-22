# Discord E-Girls Bot

TypeScript Discord bot for activating purchase codes and managing private voice orders.

## Requirements

- macOS
- Node.js 22 or newer
- PostgreSQL 16 or newer (needed from stage 2 onward)

## Initial setup on Mac

1. Install Node.js with Homebrew if it is not already installed:

   ```bash
   brew install node
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create local configuration and replace every placeholder with a local value:

   ```bash
   cp .env.example .env
   ```

   Never commit `.env` or send the Discord token to anyone.

## Commands

```bash
npm run dev       # run in development mode
npm run build     # compile TypeScript into dist/
npm run check     # type-check without writing files
npm run test      # run automated tests once
npm start         # run the compiled app
```

Startup stops with a list of missing or invalid environment variables when configuration is incomplete.

## PostgreSQL and the first codes

Install and start PostgreSQL, then create a local role and an empty database:

```bash
brew install postgresql@16
brew services start postgresql@16
createuser --pwprompt discord_bot
createdb --owner=discord_bot discord_bot
```

Set the matching password in the local `.env` only:

```dotenv
DATABASE_URL=postgresql://discord_bot:YOUR_PASSWORD@localhost:5432/discord_bot
```

Create/update the schema and generate the first private CSV containing 100 codes:

```bash
npm run db:migrate
npm run codes:generate -- --count 100
```

The CSV is written with owner-only permissions below `codes/`. That directory is intentionally ignored by Git.

## Discord application setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application, and open its **Bot** page.
2. Create/reset the bot token and paste it only into `DISCORD_TOKEN` in your local `.env`.
3. On the Bot page enable **Server Members Intent** and **Message Content Intent**.
4. In **OAuth2 → URL Generator**, select the `bot` and `applications.commands` scopes. Grant the bot these server permissions: View Channels, Send Messages, Manage Messages, Manage Roles, Manage Channels, Connect, Speak, and Move Members.
5. Open the generated URL and invite the bot to the intended server. Place its bot role above `🛒 Клиент` so it can grant and remove that role.
6. Enable Developer Mode in Discord (**User Settings → Advanced**). Right-click the server, channels, category, and roles to copy their IDs into `.env`.

The bot registers `/bot-status` only in `DISCORD_GUILD_ID`. It ignores messages and interactions from every other server. The command is accepted only from a member with `CURATOR_ROLE_ID` (`👑 Куратор`).

Run the bot after the database migration:

```bash
npm run build
npm start
```

Successful startup prints the bot account and configured server to the console. Never paste the token into chat, source code, logs, or Git.

## Timer modes

`TEST_MODE=false` uses the production schedule: 60 minutes waiting for a conversation to start, a 60-minute active order, a warning 10 minutes before closing, and room deletion 5 minutes after entry is locked.

For manual testing set `TEST_MODE=true`: waiting and active order time are 2 minutes, the warning is sent 1 minute before closing, and deletion happens 1 minute after closing. Timers and joined E-Girl participants are stored in PostgreSQL and continue after a bot restart.
