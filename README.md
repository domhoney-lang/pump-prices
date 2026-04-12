Changelog:
- Removed the public manual sync path so imports stay on protected scheduled and worker flows.
- Added drawer freshness labels for unleaded and diesel using the latest recorded timestamp.
- Added structured sync logging plus production cleanup for search and deployment readiness.

## Local Development

THIS APP DOES NOT RUN SAFELY ON LOCAL

## Environment Safety

Before running any Prisma or sync command locally, confirm `DATABASE_URL` and `DIRECT_URL` point at your local Prisma dev database.

Keep `npx prisma db push`, `npm run sync:fuel-data`, and `npm run sync:fuel-data -- --mode=full-price-backfill` pointed at a local database unless you are intentionally running them in a hosted environment.

### Quick Start

Use this flow if you want to run the app entirely on your machine with a local Prisma dev database.

1. Install dependencies:

```bash
npm install
```

2. Create your local env file if you do not already have one:

```bash
cp .env.example .env.local
```

If `.env.local` already exists, open it and verify both `DATABASE_URL` and `DIRECT_URL` still point to `localhost` before continuing.

3. Start a local Prisma dev database:

```bash
npx prisma dev -d --name pump-prices-local
```

That command prints a local Postgres connection string such as:

```bash
postgresql://postgres:postgres@localhost:51218/postgres?sslmode=disable
```

4. Put that local connection string into `DATABASE_URL` and `DIRECT_URL` in `.env.local`.

Example:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:51218/postgres?sslmode=disable&pgbouncer=true&statement_cache_size=0"
DIRECT_URL="postgresql://postgres:postgres@localhost:51218/postgres?sslmode=disable"
LOCATIONIQ_API_KEY=""
```

Do not continue until both values point to `localhost` or `127.0.0.1`.

5. Push the Prisma schema into the local database:

```bash
env DATABASE_URL="postgresql://postgres:postgres@localhost:51218/postgres?sslmode=disable" \
DIRECT_URL="postgresql://postgres:postgres@localhost:51218/postgres?sslmode=disable" \
npx prisma db push
```

6. Run a one-time full local data backfill so the map has prices:

```bash
npm run sync:fuel-data -- --mode=full-price-backfill
```

Only run this command against a local dev database unless you have explicitly chosen a hosted environment for the backfill.

7. Start the Next.js app:

```bash
npm run dev
```

8. Open [http://localhost:3000](http://localhost:3000).

### Day-To-Day Local Run Flow

After the first setup, the normal local workflow is:

1. Start the Prisma dev database:

```bash
npx prisma dev -d --name pump-prices-local
```

2. Start the app:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000).

4. Pull fresh fuel prices when needed:

```bash
npm run sync:fuel-data
```

This command writes to whichever database `DATABASE_URL` targets. Re-check `.env.local` first if you have recently copied secrets or switched environments.

If the map loads but many markers show `N/A`, your local database probably has station records without current prices yet. Run the full backfill again:


### Starting The App Locally

If local setup has already been completed and `.env.local` points at your local Prisma database, starting the app is just:

```bash
npm run dev
```

Then visit [http://localhost:3000](http://localhost:3000).

If port `3000` is already in use, Next.js will either prompt for another port or you can choose one explicitly:

```bash
npm run dev -- --port 3001
```

## Environment

Set these values before syncing live data:

- `DATABASE_URL`
- `DIRECT_URL`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`
- `LOCATIONIQ_API_KEY` for location search
- `CRON_SECRET` for the scheduled sync endpoint

For local development, `DATABASE_URL` and `DIRECT_URL` can point to the local Prisma dev database instead of a hosted Postgres instance.

Optional only if you wire Supabase features back into the app:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Syncing Fuel Data

- For scheduled imports, call `/api/sync` with either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
- For a one-off full price backfill, run `npm run sync:fuel-data -- --mode=full-price-backfill`.
- For an online-only one-off backfill through AWS Lambda, invoke the worker with `{"mode":"full-price-backfill"}`.
- Treat `full-price-backfill` as a repair operation, not a routine sync.
- Before running any sync manually, print or inspect `DATABASE_URL` and make sure you know which database you are about to modify.
- Sync imports normalize mixed-unit prices before writing to the database. Pound-style values such as `1.549` are converted to `154.9`, and missing-decimal values such as `1819` are converted to `181.9`. Implausible prices are skipped and counted in sync logs.
- To repair existing mixed-unit rows already stored in the database, run `npm run repair:price-units` for a dry run, then `npm run repair:price-units -- --apply` to persist the fixes.

## Freshness Labels

The station drawer classifies unleaded and diesel price timestamps using these bands:

- `Fresh`: under 24 hours old
- `Still good`: 24 to 48 hours old
- `Stale`: over 48 hours old

## GitHub Actions Scheduler

The repository includes `.github/workflows/sync-fuel-data.yml`, which runs the sync job directly every 30 minutes and also supports manual runs from the Actions tab.

Set these repository secrets before enabling it:

- `DATABASE_URL`
- `DIRECT_URL`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`

## AWS Lambda Worker

The repository also includes `.github/workflows/deploy-lambda-worker.yml` to deploy a UK-hosted Lambda sync worker to AWS London (`eu-west-2`).

GitHub secrets required for Lambda deployment:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `CRON_SECRET`
- `DATABASE_URL`
- `DIRECT_URL`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`

GitHub repository variable required for Lambda deployment:

- `APP_URL`
- `LAMBDA_FUNCTION_NAME`

The Lambda bundle is built from `src/lambda/sync-fuel-data.ts` using:

```bash
npm run build:lambda
```

Example one-off Lambda backfill invoke:

```bash
aws lambda invoke \
  --region eu-west-2 \
  --function-name pump-prices-sync \
  --payload '{"mode":"full-price-backfill"}' \
  response.json
```

The deploy workflow also enforces production-oriented Lambda settings:

- `APP_URL` so the worker can notify the Next app to revalidate cached national averages
- `CRON_SECRET` so the worker can authenticate that revalidation call
- `NODE_ENV=production`
- `nodejs20.x` runtime
- `sync-fuel-data.handler` handler
- `1024 MB` memory
- `600s` timeout
- `512 MB` ephemeral storage

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Set these Vercel environment variables before the first production build:

- `DATABASE_URL`
- `DIRECT_URL`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`
- `LOCATIONIQ_API_KEY`
- `CRON_SECRET`

Optional only if you later enable Supabase-backed features:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The included `vercel.json` schedules `/api/sync` every 30 minutes. The route accepts both `GET` and `POST`, and `CRON_SECRET` is used to authorize those requests. Keep in mind the sync route still does real work, so confirm your Vercel function duration limits are high enough for your dataset or keep scheduled syncs on GitHub Actions or Lambda.
