import { NextRequest, NextResponse } from "next/server";

import { confirmCleanverseMint, listCleanverseSubscriptions } from "@/lib/cleanverse/subscription";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const configured = process.env.SUBSCRIPTION_ADMIN_API_TOKEN?.trim();
  if (!configured) return true;
  return request.headers.get("authorization") === `Bearer ${configured}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ subscriptions: listCleanverseSubscriptions() });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { referenceId?: string; mintTxHash?: string };
  const result = await confirmCleanverseMint(body.referenceId?.trim() ?? "", body.mintTxHash?.trim() ?? "");
  return NextResponse.json(result.body, { status: result.status });
}