import { NextRequest, NextResponse } from "next/server";
import { erc20Abi, getAddress, isAddress, zeroHash, type Address } from "viem";
import { sepolia } from "viem/chains";

import { publicClient, targetChain } from "@/lib/chain";
import { couponDistributionConfigFromEnv, reserveCouponDistribution } from "@/lib/cleanverse/coupon-distribution";
import { listCleanverseSubscriptions } from "@/lib/cleanverse/subscription";

export const runtime = "nodejs";

const ACCESS_CONTROL_ABI = [
  { type: "function", name: "DEFAULT_ADMIN_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32", name: "role" }, { type: "address", name: "account" }], outputs: [{ type: "bool" }] },
] as const;

export async function POST(request: NextRequest) {
  try {
    if (targetChain.id !== sepolia.id) {
      return NextResponse.json({ error: "Coupon distribution requires the Sepolia network" }, { status: 409 });
    }
    const body = await request.json() as { issuanceId?: string; investorAddress?: string; issuerAddress?: string };
    if (!body.issuanceId?.trim()) return NextResponse.json({ error: "Issuance ID is required" }, { status: 400 });
    if (!isAddress(body.investorAddress ?? "") || !isAddress(body.issuerAddress ?? "")) {
      return NextResponse.json({ error: "Valid issuer and investor addresses are required" }, { status: 400 });
    }
    const investorAddress = getAddress(body.investorAddress as Address);
    const issuerAddress = getAddress(body.issuerAddress as Address);
    const subscription = listCleanverseSubscriptions().find((record) =>
      record.issuanceId === body.issuanceId?.trim()
      && record.walletAddress.toLowerCase() === investorAddress.toLowerCase()
      && record.paymentStatus === "Confirmed"
      && record.mintStatus === "Minted");
    if (!subscription) return NextResponse.json({ error: "A paid and minted subscription was not found" }, { status: 404 });

    const [adminRole, balance, atokenDecimals] = await Promise.all([
      publicClient.readContract({ address: subscription.atokenAddress, abi: ACCESS_CONTROL_ABI, functionName: "DEFAULT_ADMIN_ROLE" }).catch(() => zeroHash),
      publicClient.readContract({ address: subscription.atokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [investorAddress] }),
      publicClient.readContract({ address: subscription.atokenAddress, abi: erc20Abi, functionName: "decimals" }),
    ]);
    const hasAdminRole = await publicClient.readContract({
      address: subscription.atokenAddress,
      abi: ACCESS_CONTROL_ABI,
      functionName: "hasRole",
      args: [adminRole, issuerAddress],
    });
    if (!hasAdminRole) return NextResponse.json({ error: "Connected wallet is not an administrator of this A-Token" }, { status: 403 });

    const config = couponDistributionConfigFromEnv();
    const record = reserveCouponDistribution({
      issuanceId: subscription.issuanceId,
      couponId: config.couponId,
      issuerAddress,
      investorAddress,
      atokenAddress: subscription.atokenAddress,
      tokenBalance: balance,
      atokenDecimals,
      amountPerToken: config.amountPerToken,
    });
    return NextResponse.json({
      reservationId: record.id,
      chainId: targetChain.id,
      recipient: record.investorAddress,
      amount: record.amount,
      reservedUntil: record.reservedUntil,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare coupon distribution";
    const status = /already|zero|positive/.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}