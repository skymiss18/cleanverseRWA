import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { prepareCasperKycWhitelistDeploy } from "@/lib/casper-token-deploy";
import { readDeploymentsWithReconciliation } from "@/lib/casper-deployments";
import { isCasperAddressLike, isCasperPublicKeyHex } from "@/lib/casper-address";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      signerPublicKey?: string;
      walletAddress?: string;
      jurisdiction?: string;
      kycExpiry?: number;
      assetDeploymentId?: string;
      kycApplicationId?: string;
    };

    if (!body.signerPublicKey?.trim()) {
      return NextResponse.json({ error: "signerPublicKey is required" }, { status: 400 });
    }
    if (!isCasperPublicKeyHex(body.signerPublicKey.trim())) {
      return NextResponse.json({ error: "signerPublicKey must be a Casper public key" }, { status: 400 });
    }
    if (!body.walletAddress?.trim()) {
      return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
    }
    if (!isCasperAddressLike(body.walletAddress.trim())) {
      return NextResponse.json(
        { error: "Investor wallet must be a Casper public key or account-hash. Legacy 0x EVM addresses cannot be whitelisted on Casper." },
        { status: 422 }
      );
    }
    if (!body.jurisdiction?.trim()) {
      return NextResponse.json({ error: "jurisdiction is required" }, { status: 400 });
    }
    const deployments = await readDeploymentsWithReconciliation() as Record<string, { identityRegistry?: { contractHash?: string } }>;
    const assetDeploymentId = body.assetDeploymentId?.trim() || "";
    const identityRegistryHash = assetDeploymentId
      ? (deployments[assetDeploymentId]?.identityRegistry?.contractHash?.trim() || process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim())
      : process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();
    if (!identityRegistryHash) {
      const contextMessage = assetDeploymentId
        ? `Identity registry is not deployed for asset ${assetDeploymentId}. Deploy that asset's identity-registry first from /tokenize, or set CASPER_IDENTITY_REGISTRY_HASH as fallback.`
        : "assetDeploymentId is missing and CASPER_IDENTITY_REGISTRY_HASH is not set. Select an issuance from /tokenize or configure global fallback.";
      return NextResponse.json(
        { error: contextMessage },
        { status: 409 }
      );
    }

    const result = prepareCasperKycWhitelistDeploy({
      signerPublicKey: body.signerPublicKey.trim(),
      investorWalletAddress: body.walletAddress.trim(),
      jurisdiction: body.jurisdiction.trim(),
      kycExpiry: body.kycExpiry,
      isVerified: true,
      amlClear: true,
      identityRegistryHash,
    });

    const deployToken = randomBytes(16).toString("hex");
    const dir = path.resolve(process.cwd(), "data/pending-kyc-approvals");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `deploy-${deployToken}.json`),
      JSON.stringify({
        deployJson: result.deployJson,
        signerPublicKey: result.signerPublicKey,
        action: "approve",
        kycApplicationId: body.kycApplicationId?.trim() || "",
      }),
    );

    return NextResponse.json({
      success: true,
      deployJson: result.deployJson,
      deployHash: result.deployHash,
      deployToken,
      signerPublicKey: result.signerPublicKey,
      paymentMotes: result.paymentMotes,
      paymentCSPR: (Number(result.paymentMotes) / 1e9).toFixed(0),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare KYC whitelist deploy" },
      { status: 500 }
    );
  }
}