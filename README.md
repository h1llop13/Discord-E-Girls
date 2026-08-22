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
