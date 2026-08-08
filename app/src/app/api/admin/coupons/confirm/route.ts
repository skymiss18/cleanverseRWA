import { NextRequest, NextResponse } from "next/server";
import { isHash, type Hash } from "viem";

import { publicClient, targetExplorerUrl } from "@/lib/chain";
import {
  couponDistributionConfigFromEnv,
  findCouponDistribution,
  listCouponDistributions,
  updateCouponDistribution,
  verifyCouponTransfer,
} from "@/lib/cleanverse/coupon-distribution";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { reservationId?: string; txHash?: string };
    if (!body.reservationId?.trim() || !isHash(body.txHash ?? "")) {
      return NextResponse.json({ error: "Reservation ID and valid transaction hash are required" }, { status: 400 });
    }
    const record = findCouponDistribution(body.reservationId.trim());
    if (!record) return NextResponse.json({ error: "Coupon distribution reservation was not found" }, { status: 404 });
    if (record.status === "Confirmed") return NextResponse.json({ distribution: record });
    const reused = listCouponDistributions().find((item) =>
      item.id !== record.id && item.txHash?.toLowerCase() === body.txHash?.toLowerCase());
    if (reused) return NextResponse.json({ error: "Transaction hash has already confirmed another coupon distribution" }, { status: 409 });

    const config = couponDistributionConfigFromEnv();
    const verification = await verifyCouponTransfer({
      client: publicClient,
      transactionHash: body.txHash as Hash,
      issuerAddress: record.issuerAddress,
      investorAddress: record.investorAddress,
      expectedAmount: BigInt(record.amount),
      minimumConfirmations: config.minimumConfirmations,
    });
    if (!verification.ok) {
      if (!verification.pending) {
        updateCouponDistribution(record.id, { status: "Failed", txHash: body.txHash as Hash, failureReason: verification.reason });
      }
      return NextResponse.json({ accepted: false, pending: verification.pending, message: verification.reason }, { status: verification.pending ? 202 : 422 });
    }
    const confirmedAt = new Date().toISOString();
    const distribution = updateCouponDistribution(record.id, {
      status: "Confirmed",
      txHash: body.txHash as Hash,
      blockNumber: verification.blockNumber.toString(),
      confirmedAt,
    });
    return NextResponse.json({
      accepted: true,
      distribution,
      explorerUrl: `${targetExplorerUrl}/tx/${body.txHash}`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to confirm coupon distribution" }, { status: 500 });
  }
}