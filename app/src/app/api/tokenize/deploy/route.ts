import { NextRequest, NextResponse } from "next/server";
import { makeAssetIdCasper } from "@/lib/casper-chain";
import { readDeploymentsWithReconciliation } from "@/lib/casper-deployments";
import { deployCasperTokenCoupon } from "@/lib/casper-token-deploy";

export const runtime = "nodejs";
export const maxDuration = 300;

function makeSymbol(assetName: string) {
  const parenSymbol = assetName.match(/\(([A-Z0-9]{2,12})\)/)?.[1];
  if (parenSymbol) return parenSymbol.slice(0, 12);
  return assetName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "HRWA";
}

/** Return an existing Deployed entry for this assetId, if one exists. */
async function findExistingDeployment(assetId: string, assetName: string) {
  const deps = await readDeploymentsWithReconciliation() as Record<string, {
    assetId?: string; assetName?: string; contractHash?: string;
    status?: string; deployHash?: string; explorerUrl?: string; network?: string;
  }>;
  for (const d of Object.values(deps)) {
    if (!(d.network ?? "").toLowerCase().includes("casper")) continue;
    if (!d.contractHash) continue;
    const nameMatch = d.assetName?.trim().toLowerCase() === assetName.trim().toLowerCase();
    const idMatch = d.assetId === assetId;
    if (nameMatch || idMatch) return d;
  }
  return null;
}

// POST /api/tokenize/deploy
// Body: { id, assetName, assetType, issuer, sfcRef, approvedBy, totalIssuance, currency }
// Deploys the configured Casper TokenCoupon WASM to Casper Testnet.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string;
      assetName?: string;
      assetType?: string;
      issuer?: string;
      sfcRef?: string;
      approvedBy?: string;
      totalIssuance?: string;
      currency?: string;
    };

    const rawName = body.assetName?.trim() || "Harbour RWA Issuance";
    const assetId = makeAssetIdCasper(rawName);
    const symbol = makeSymbol(rawName);
    const issuer = body.issuer?.trim() || "Harbour Capital Markets Corporation Limited";
    const totalIssuance = body.totalIssuance?.trim() || "0";
    const currency = body.currency?.trim() || "USD";
    const sfcRef = body.sfcRef?.trim() || body.id || "";
    const deploymentKey = body.id?.trim() || "";
    const identityRegistryHash = process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();

    if (!identityRegistryHash) {
      return NextResponse.json(
        { error: "CASPER_IDENTITY_REGISTRY_HASH is not configured. Set the shared identity registry contract hash in app/.env.local." },
        { status: 500 }
      );
    }

    // Idempotency: if a deployed contract already exists for this asset, return it directly.
    const existing = await findExistingDeployment(assetId, rawName);
    if (existing?.contractHash) {
      return NextResponse.json({
        success: true,
        txHash: existing.deployHash ?? "",
        deployHash: existing.deployHash ?? "",
        registrationId: existing.deployHash ?? "",
        assetId,
        contractHash: existing.contractHash,
        contractAddress: existing.contractHash,
        blockNumber: null,
        network: "Casper Testnet",
        deployedAt: new Date().toISOString().slice(0, 10),
        assetName: rawName,
        assetType: body.assetType ?? "",
        issuer,
        sfcRef,
        approvedBy: body.approvedBy ?? "",
        totalIssuance,
        currency,
        standard: "Casper Token/Coupon WASM",
        status: "Deployed",
        gasUsed: 0,
        explorerUrl: existing.explorerUrl ?? "",
      });
    }

    const result = await deployCasperTokenCoupon({
      assetId,
      assetName: rawName,
      symbol,
      issuer,
      totalIssuance,
      currency,
      sfcRef,
      complianceOracleHash: process.env.CASPER_COMPLIANCE_ORACLE_HASH,
      identityRegistryHash,
    });

    const deployedAt = new Date().toISOString().slice(0, 10);

    return NextResponse.json({
      success: true,
      txHash: result.deployHash,
      deployHash: result.deployHash,
      registrationId: result.deployHash,
      assetId,
      contractHash: result.contractHash,
      contractAddress: result.contractHash,
      blockNumber: null,
      network: "Casper Testnet",
      deployedAt,
      assetName: rawName,
      assetType: body.assetType ?? "",
      issuer,
      sfcRef,
      approvedBy: body.approvedBy ?? "",
      totalIssuance,
      currency,
      standard: "Casper Token/Coupon WASM",
      status: result.status,
      pendingReason: result.pendingReason,
      gasUsed: 0,
      explorerUrl: result.explorerUrl,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Casper token deploy failed" },
      { status: 500 }
    );
  }
}
