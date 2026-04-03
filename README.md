This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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
- For scheduled imports, call `POST /api/sync` with either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.

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

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
