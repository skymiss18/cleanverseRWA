import { NextRequest, NextResponse } from "next/server";

import { findLatestATokenApplicationForIssuance } from "@/lib/cleanverse/atoken-store";
import { getCleanverseClient } from "@/lib/cleanverse/client";
import { evaluateCleanverseEligibility } from "@/lib/cleanverse/eligibility";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const issuanceId = req.nextUrl.searchParams.get("issuanceId")?.trim() ?? "";
  const walletAddress = req.nextUrl.searchParams.get("walletAddress")?.trim() ?? "";
  if (!issuanceId) return NextResponse.json({ error: "issuanceId is required" }, { status: 400 });
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return NextResponse.json({ error: "A valid Ethereum walletAddress is required" }, { status: 400 });

  const decision = await evaluateCleanverseEligibility({
    client: getCleanverseClient(),
    application: findLatestATokenApplicationForIssuance(issuanceId),
    issuanceId,
    walletAddress,
  });
  return NextResponse.json(decision, { status: decision.eligible ? 200 : 422 });
}