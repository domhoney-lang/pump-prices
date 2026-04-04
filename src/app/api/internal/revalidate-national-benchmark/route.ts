import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { NATIONAL_PRICE_BENCHMARK_TAG } from "@/lib/cache-tags";

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

export async function POST(request: NextRequest) {
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

  revalidateTag(NATIONAL_PRICE_BENCHMARK_TAG, "max");

  return NextResponse.json({ success: true });
}
