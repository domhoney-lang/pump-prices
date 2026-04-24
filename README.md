Changelog:
- Removed the public manual sync path so imports stay on protected scheduled and worker flows.
- Added drawer freshness labels for unleaded and diesel using the latest recorded timestamp.
- Added structured sync logging plus production cleanup for search and deployment readiness.

## Local Development

This app can be reviewed safely on your machine, but only if you keep both local env files pointed at a local Prisma dev database.

## Environment Safety

Before running any Prisma or sync command locally, confirm both `.env` and `.env.local` point at your local Prisma dev database.

- Prisma CLI reads `.env`.
- Next.js runtime reads `.env.local`.
- `.env.example` is a useful template, but its database entries are hosted-shaped placeholders. Do not blindly copy those URLs into local review env files.

Keep `npx prisma db push`, `npm run sync:fuel-data`, and `npm run sync:fuel-data -- --mode=full-price-backfill` pointed at a local database unless you are intentionally running them in a hosted environment.

### Quick Start

Use this flow if you want to review the app locally without touching the hosted database.

1. Install dependencies:

```bash
npm install
```

2. Create your local env file if you do not already have one:

```bash
cp .env.example .env.local
```

If `.env.local` already exists, open it and verify it does not contain a hosted production or staging database URL before continuing.

3. Start a local Prisma dev database:

```bash
npx prisma dev -d --name pump-prices-local
```

4. Ask Prisma for the local connection URLs:

```bash
npx prisma dev ls
```

Copy these two values from the `pump-prices-local` entry:

- `DATABASE_URL`: the `prisma+postgres://localhost:...` URL for Prisma ORM and app runtime
- `TCP`: the raw `postgresql://...` URL for direct Postgres access

5. Put those local values into both `.env` and `.env.local`.

Use this shape:

```env
# Prisma ORM / app runtime
DATABASE_URL="prisma+postgres://localhost:51220/?api_key=..."

# Direct Postgres access for Prisma schema commands
DIRECT_URL="postgresql://postgres:postgres@localhost:51218/template1?sslmode=disable&connection_limit=10&connect_timeout=0&max_idle_connection_lifetime=0&pool_timeout=0&socket_timeout=0"
```

Keep `.env` and `.env.local` aligned for local review.

Do not continue until both files point only to `localhost` or `127.0.0.1`.

6. If this is a brand-new local database, push the schema into it:

```bash
npx prisma db push
```

If Prisma complains about prepared statements on a fresh local Prisma dev server, temporarily set `.env`'s `DATABASE_URL` to the raw `postgresql://...` TCP URL from `npx prisma dev ls`, run `npx prisma db push`, then switch `.env` back to the `prisma+postgres://...` URL before starting the app.

7. If you want real data in the local map, run a one-time local backfill:

```bash
npm run sync:fuel-data -- --mode=full-price-backfill
```

Only run this command against a local dev database unless you have explicitly chosen a hosted environment for the backfill.

8. Start the app.

This repo currently runs more reliably locally with webpack than Turbopack:

```bash
npm run dev:local
```

9. Open [http://127.0.0.1:3002](http://127.0.0.1:3002).

### Day-To-Day Local Run Flow

After the first setup, the normal local workflow is:

1. Start the Prisma dev database:

```bash
npx prisma dev -d --name pump-prices-local
```

2. Start the app:

```bash
npm run dev:local
```

3. Open [http://127.0.0.1:3002](http://127.0.0.1:3002).

4. Pull fresh fuel prices when needed:

```bash
npm run sync:fuel-data
```

This command writes to whichever database `DATABASE_URL` targets. Re-check `.env.local` first if you have recently copied secrets or switched environments.

If the map loads but many markers show `N/A`, your local database probably has station records without current prices yet. Run the full backfill again:

```bash
npm run sync:fuel-data -- --mode=full-price-backfill
```

### Starting The App Locally

If local setup has already been completed and both `.env` and `.env.local` point at your local Prisma database, starting the app is just:

```bash
npx prisma dev -d --name pump-prices-local
npm run dev:local
```

Then visit [http://127.0.0.1:3002](http://127.0.0.1:3002).

If port `3002` is already in use, choose another port explicitly:

```bash
npm run dev:local -- --port 3003
```

### Local Review Rules

- Keep `.env` and `.env.local` local-only. This repository ignores `.env*`; do not commit them.
- Do not point local Prisma commands at the hosted database unless you have deliberately chosen to work against hosted infrastructure.
- Do not use local review to trigger production syncs. The protected `/api/sync` route and hosted schedulers are the intended production paths.
- If local startup fails under Turbopack, use the webpack command above.

## Production Handoff Checklist

Use this checklist before merging or deploying code intended for production.

1. Verify the change locally first:

```bash
npm run lint
npm run dev:local
```

2. If the change affects Prisma schema, sync, or pricing logic, test it against the local Prisma dev database before touching any hosted environment.

3. Never commit `.env`, `.env.local`, or other secrets. Production configuration belongs in hosted secret stores, not in git.

4. If the change introduces or renames environment variables, update the relevant production configuration:

- Vercel project env vars for the Next.js app
- GitHub Actions repository secrets for scheduled sync jobs
- AWS / GitHub secrets and variables for the Lambda worker

5. Before any production sync or repair command, confirm hosted `DATABASE_URL` and `DIRECT_URL` point at the intended production database, not your local Prisma dev instance.

6. If the change affects scheduled syncs or cache revalidation, verify these production paths still have the secrets they need:

- `/api/sync`
- `/api/internal/revalidate-national-benchmark`
- GitHub Actions scheduler
- Lambda worker deployment

7. Commit and push only application code, config, and docs. Hosted deployments should pick up secrets from Vercel, GitHub Actions, and AWS, not from files in this repo.

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

- `Fresh`: under 2 days old
- `Still good`: 2 to 6 days old
- `Stale`: over 6 days old

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
