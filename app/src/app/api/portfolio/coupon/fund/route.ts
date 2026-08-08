import { NextRequest, NextResponse } from "next/server";
import { publicClient, getWalletClient, HARBOUR_RWA_TOKEN_ABI, tokenAddress } from "@/lib/chain";

const ERC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// 27.5 USDY per HIBT token (18 decimals), matching the demo schedule
const DEMO_AMOUNT_PER_TOKEN = 27500000000000000000n;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const assetId = body.assetId as `0x${string}` | undefined;
    const index = body.index as number | undefined;
    const investorWallet = body.wallet as `0x${string}` | undefined;

    if (!assetId || !/^0x[0-9a-fA-F]{64}$/.test(assetId)) {
      return NextResponse.json({ error: "Valid assetId is required" }, { status: 400 });
    }

    if (!Number.isInteger(index) || Number(index) < 0) {
      return NextResponse.json({ error: "Valid coupon index is required" }, { status: 400 });
    }

    if (!investorWallet || !/^0x[0-9a-fA-F]{40}$/.test(investorWallet)) {
      return NextResponse.json({ error: "Valid investor wallet address is required" }, { status: 400 });
    }

    const couponTokenAddr = (process.env.NEXT_PUBLIC_USDY_ADDRESS ?? process.env.USDY_ADDRESS ?? "") as `0x${string}`;
    if (!couponTokenAddr || !/^0x[0-9a-fA-F]{40}$/.test(couponTokenAddr)) {
      return NextResponse.json({ error: "USDY_ADDRESS not configured" }, { status: 500 });
    }

    const tokenAddr = tokenAddress();
    if (tokenAddr === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json({ error: "NEXT_PUBLIC_HARBOUR_RWA_TOKEN_ADDRESS not configured" }, { status: 500 });
    }

    const walletClient = getWalletClient();

    // Read investor's HIBT balance to calculate their coupon payout
    const investorBalance = await publicClient.readContract({
      address: tokenAddr,
      abi: HARBOUR_RWA_TOKEN_ABI,
      functionName: "balanceOf",
      args: [investorWallet],
    }) as bigint;

    if (investorBalance === 0n) {
      return NextResponse.json({ error: "Investor holds no HIBT tokens" }, { status: 422 });
    }

    // payout = amountPerToken * investorBalance / 1e18
    const payout = (DEMO_AMOUNT_PER_TOKEN * investorBalance) / (10n ** 18n);
    if (payout === 0n) {
      return NextResponse.json({ error: "Calculated payout is zero" }, { status: 422 });
    }

    const gasPrice = await publicClient.getGasPrice();
    const safeGasPrice = gasPrice * 2n;

    // Issuer pushes USDY directly to investor wallet (no contract pool needed)
    const txHash = await walletClient.writeContract({
      address: couponTokenAddr,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [investorWallet, payout],
      maxFeePerGas: safeGasPrice,
      maxPriorityFeePerGas: safeGasPrice,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

    return NextResponse.json({
      ok: true,
      assetId,
      index,
      investorWallet,
      payout: payout.toString(),
      txHash,
      explorerUrl: `https://testnet.cspr.live/deploy/${txHash}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fund coupon";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}