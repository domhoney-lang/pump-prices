Changelog:
- Interactive UK fuel-price map with colour-coded markers for unleaded and diesel.
- Location search, geolocation focus, and station detail drawer for nearby stations.
- Manual sync, protected `/api/sync` endpoint, GitHub Actions scheduling, and Lambda backfill support.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment

Set these values before syncing live data:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`
- `CRON_SECRET` for the scheduled sync endpoint

## Syncing Fuel Data

- Use the in-app `Initial sync` or `Refresh` button to run a manual import.
- For scheduled imports, call `/api/sync` with either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
- For a one-off full price backfill, run `npm run sync:fuel-data -- --mode=full-price-backfill`.
- For an online-only one-off backfill through AWS Lambda, invoke the worker with `{"mode":"full-price-backfill"}`.

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
- `DATABASE_URL`
- `DIRECT_URL`
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`

GitHub repository variable required for Lambda deployment:

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
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` if you plan to use admin Supabase access
- `FUEL_FINDER_CLIENT_ID`
- `FUEL_FINDER_CLIENT_SECRET`
- `CRON_SECRET`

The included `vercel.json` schedules `/api/sync` every 30 minutes. The route accepts both `GET` and `POST`, and `CRON_SECRET` is used to authorize those requests.
