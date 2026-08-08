import { NextRequest, NextResponse } from "next/server";
import { erc20Abi, formatUnits } from "viem";
import { sepolia } from "viem/chains";

import { publicClient, targetChain, targetExplorerUrl } from "@/lib/chain";
import { couponDistributionConfigFromEnv, listCouponDistributions } from "@/lib/cleanverse/coupon-distribution";
import { listCleanverseSubscriptions } from "@/lib/cleanverse/subscription";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const configured = process.env.SUBSCRIPTION_ADMIN_API_TOKEN?.trim();
  return !configured || request.headers.get("authorization") === `Bearer ${configured}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (targetChain.id !== sepolia.id) {
      return NextResponse.json({ error: "Coupon distribution requires the Sepolia network" }, { status: 409 });
    }
    const config = couponDistributionConfigFromEnv();
    const distributions = listCouponDistributions();
    const eligible = listCleanverseSubscriptions().filter((record) =>
      record.paymentStatus === "Confirmed" && record.mintStatus === "Minted");
    const unique = Array.from(new Map(eligible.map((record) => [
      `${record.issuanceId}:${record.walletAddress.toLowerCase()}`,
      record,
    ])).values());
    const investors = await Promise.all(unique.map(async (record) => {
      try {
        const [balance, decimals] = await Promise.all([
          publicClient.readContract({ address: record.atokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [record.walletAddress] }),
          publicClient.readContract({ address: record.atokenAddress, abi: erc20Abi, functionName: "decimals" }),
        ]);
        const distribution = distributions.find((item) =>
          item.issuanceId === record.issuanceId
          && item.couponId === config.couponId
          && item.investorAddress.toLowerCase() === record.walletAddress.toLowerCase());
        return {
          referenceId: record.referenceId,
          issuanceId: record.issuanceId,
          assetName: record.assetName,
          investorAddress: record.walletAddress,
          atokenAddress: record.atokenAddress,
          tokenBalance: balance.toString(),
          tokenBalanceFormatted: formatUnits(balance, decimals),
          atokenDecimals: decimals,
          distribution: distribution ?? null,
        };
      } catch {
        return null;
      }
    }));
    return NextResponse.json({
      chain: { id: targetChain.id, name: targetChain.name, explorerUrl: targetExplorerUrl },
      coupon: { id: config.couponId, amountPerToken: config.amountPerToken, currency: "ETH" },
      investors: investors.filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load coupon queue" }, { status: 503 });
  }
}