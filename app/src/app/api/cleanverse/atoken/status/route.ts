import { NextRequest, NextResponse } from "next/server";

import { queryATokenApplyStatus } from "@/lib/cleanverse/atoken";
import { findATokenApplicationByRequestId, upsertATokenApplication } from "@/lib/cleanverse/atoken-store";
import { getCleanverseClient } from "@/lib/cleanverse/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const requestId = req.nextUrl.searchParams.get("requestId")?.trim() ?? "";
    const existing = findATokenApplicationByRequestId(requestId);
    if (!existing) return NextResponse.json({ error: "A-Token application not found" }, { status: 404 });

    const status = await queryATokenApplyStatus(getCleanverseClient(), requestId);
    if (status.chain !== existing.chain) {
      return NextResponse.json({ error: "Cleanverse returned a mismatched application chain" }, { status: 502 });
    }

    const subscriptionOpen = status.applyStatus === "ISSUED" && Boolean(status.atokenAddress);
    const updated = upsertATokenApplication({
      ...existing,
      applyStatus: status.applyStatus,
      subscriptionOpen,
      atokenAddress: status.atokenAddress,
      txHash: status.txHash,
      rejectReason: status.rejectReason,
      issueErrorMsg: status.issueErrorMsg,
      lastSyncedAt: new Date().toISOString(),
    });
    return NextResponse.json({ application: updated, terminal: ["ISSUED", "REJECTED", "ISSUE_FAILED"].includes(updated.applyStatus) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A-Token status sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}