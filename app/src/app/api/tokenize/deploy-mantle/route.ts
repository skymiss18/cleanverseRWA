import { NextRequest, NextResponse } from "next/server";
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";
import { publicClient, getWalletClient, tokenAddress, HARBOUR_RWA_TOKEN_ABI } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 300;

const ASSET_TYPE_MAP: Record<string, number> = {
  Bond: 0,
  GreenBond: 1,
  REIT: 2,
  TradeReceivable: 3,
};

// POST /api/tokenize/deploy-mantle (compatibility route)
// Body: { id, assetName, assetType, issuer, sfcRef, totalIssuance, currency, complianceScore }
// Registers the asset on the HarbourRWA token contract on Ethereum Sepolia.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      id?: string;
      assetName?: string;
      assetType?: string;
      issuer?: string;
      sfcRef?: string;
      totalIssuance?: string;
      currency?: string;
      complianceScore?: number;
    };

    const rawName = body.assetName?.trim() || "Harbour RWA Issuance";
    const assetTypeEnum = ASSET_TYPE_MAP[body.assetType ?? "Bond"] ?? 0;
    const assetId = keccak256(
      encodeAbiParameters(parseAbiParameters("string"), [rawName])
    ) as `0x${string}`;

    // Maturity: 5 years from now (default for bonds)
    const maturityDate = BigInt(
      Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600
    );
    // Coupon: 550 bps = 5.50% (default)
    const couponBps = 550n;
    // Prospectus commitment hash from SFC ref
    const prospectusCommitment = keccak256(
      toHex(body.sfcRef ?? body.id ?? "default")
    ) as `0x${string}`;

    const walletClient = getWalletClient();

    const txHash = await walletClient.writeContract({
      address: tokenAddress(),
      abi: HARBOUR_RWA_TOKEN_ABI,
      functionName: "registerAsset",
      args: [assetId, assetTypeEnum, rawName, maturityDate, couponBps, prospectusCommitment],
    });

    // Wait for confirmation with retries (drpc can be slow to index)
    let receipt;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        receipt = await publicClient.getTransactionReceipt({ hash: txHash });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if (!receipt) {
      // TX was submitted but we couldn't get receipt — return Submitted status
      return NextResponse.json({
        success: true,
        txHash,
        deployHash: txHash,
        registrationId: txHash,
        assetId,
        contractAddress: tokenAddress(),
        blockNumber: null,
        network: "Ethereum Sepolia",
        deployedAt: new Date().toISOString().slice(0, 10),
        assetName: rawName,
        assetType: body.assetType ?? "Bond",
        issuer: body.issuer ?? "",
        sfcRef: body.sfcRef ?? "",
        totalIssuance: body.totalIssuance ?? "",
        currency: body.currency ?? "USD",
        standard: "ERC-3643 (HarbourRWA)",
        status: "Submitted",
        gasUsed: 0,
        explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
      });
    }
    const deployedAt = new Date().toISOString().slice(0, 10);
    const blockNumber = Number(receipt.blockNumber);

    if (receipt.status === "reverted") {
      return NextResponse.json(
        { error: "Transaction reverted on-chain" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash,
      deployHash: txHash,
      registrationId: txHash,
      assetId,
      contractAddress: tokenAddress(),
      blockNumber,
      network: "Ethereum Sepolia",
      deployedAt,
      assetName: rawName,
      assetType: body.assetType ?? "Bond",
      issuer: body.issuer ?? "",
      sfcRef: body.sfcRef ?? "",
      totalIssuance: body.totalIssuance ?? "",
      currency: body.currency ?? "USD",
      standard: "ERC-3643 (HarbourRWA)",
      status: "Deployed",
      gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : 0,
      explorerUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ethereum registration failed";
    console.error("[deploy-ethereum] ERROR:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
