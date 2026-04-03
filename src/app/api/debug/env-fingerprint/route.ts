import { createHash } from "crypto";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return {
      ok: false,
      status: 500,
      message: "CRON_SECRET is not configured.",
    } as const;
  }

  const authorizationHeader = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  const bearerSecret = authorizationHeader?.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : null;

  const providedSecret = bearerSecret ?? headerSecret;

  if (providedSecret !== configuredSecret) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized.",
    } as const;
  }

  return { ok: true } as const;
}

function fingerprint(value: string | undefined) {
  if (!value) {
    return {
      present: false,
      length: 0,
      sha256: null,
      hasLeadingWhitespace: false,
      hasTrailingWhitespace: false,
    };
  }

  return {
    present: true,
    length: value.length,
    sha256: createHash("sha256").update(value).digest("hex"),
    hasLeadingWhitespace: value.trimStart() !== value,
    hasTrailingWhitespace: value.trimEnd() !== value,
  };
}

export async function GET(request: NextRequest) {
  const authorization = isAuthorized(request);

  if (!authorization.ok) {
    return NextResponse.json(
      {
        success: false,
        error: authorization.message,
      },
      { status: authorization.status },
    );
  }

  return NextResponse.json({
    success: true,
    deployment: {
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelUrl: process.env.VERCEL_URL ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
    env: {
      FUEL_FINDER_CLIENT_ID: fingerprint(process.env.FUEL_FINDER_CLIENT_ID),
      FUEL_FINDER_CLIENT_SECRET: fingerprint(process.env.FUEL_FINDER_CLIENT_SECRET),
      CRON_SECRET: fingerprint(process.env.CRON_SECRET),
      DATABASE_URL: fingerprint(process.env.DATABASE_URL),
      DIRECT_URL: fingerprint(process.env.DIRECT_URL),
    },
  });
}
