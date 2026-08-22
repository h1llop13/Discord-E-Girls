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
