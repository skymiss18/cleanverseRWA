import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { prepareCasperKycWhitelistDeploy } from "@/lib/casper-token-deploy";
import { readDeploymentsWithReconciliation } from "@/lib/casper-deployments";
import { readKycApplications, upsertKycApplication, type KycApplicationRecord } from "@/lib/kyc-store";
import { isCasperPublicKeyHex } from "@/lib/casper-address";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string;
      signerPublicKey?: string;
      assetDeploymentId?: string;
    };

    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const signerPublicKey = body.signerPublicKey?.trim() || "";
    if (!isCasperPublicKeyHex(signerPublicKey)) {
      return NextResponse.json({ error: "signerPublicKey must be a Casper public key" }, { status: 400 });
    }

    const applications = readKycApplications();
    const target = applications.find((item) => item.id === id) as KycApplicationRecord | undefined;
    if (!target) {
      return NextResponse.json({ error: `KYC application not found: ${id}` }, { status: 404 });
    }
    if (!target.walletAddress) {
      return NextResponse.json({ error: "KYC application has no walletAddress" }, { status: 422 });
    }

    const deployments = await readDeploymentsWithReconciliation() as Record<string, { identityRegistry?: { contractHash?: string } }>;
    const assetDeploymentId = body.assetDeploymentId?.trim() || String(target.assetDeploymentId ?? "").trim();
    const identityRegistryHash = assetDeploymentId
      ? (deployments[assetDeploymentId]?.identityRegistry?.contractHash?.trim() || process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim())
      : process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();

    if (!identityRegistryHash) {
      return NextResponse.json({ error: "Identity registry hash is not configured" }, { status: 409 });
    }

    const kycExpiry = typeof target.kycExpiry === "number" && target.kycExpiry > 0
      ? Math.floor(target.kycExpiry)
      : Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const aiScore = typeof target.aiScore === "number" ? target.aiScore : 0;

    const prepared = prepareCasperKycWhitelistDeploy({
      signerPublicKey,
      investorWalletAddress: target.walletAddress,
      jurisdiction: String(target.jurisdiction ?? "SG"),
      kycExpiry,
      isVerified: aiScore >= 70,
      amlClear: aiScore >= 70,
      identityRegistryHash,
    });

    const deployToken = randomBytes(16).toString("hex");
    const dir = path.resolve(process.cwd(), "data/pending-kyc-approvals");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `deploy-${deployToken}.json`),
      JSON.stringify({
        deployJson: prepared.deployJson,
        signerPublicKey: prepared.signerPublicKey,
        action: "update",
        kycApplicationId: id,
      }),
    );

    upsertKycApplication(id, {
      monitoringStatus: "update_prepared",
      lastScreenedAt: new Date().toISOString(),
      agentReason: "Prepared credential update transaction for compliance signer.",
    });

    return NextResponse.json({
      success: true,
      action: "update",
      id,
      deployToken,
      deployHash: prepared.deployHash,
      deployJson: prepared.deployJson,
      signerPublicKey: prepared.signerPublicKey,
      paymentMotes: prepared.paymentMotes,
      paymentCSPR: (Number(prepared.paymentMotes) / 1e9).toFixed(0),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare KYC credential update" },
      { status: 500 },
    );
  }
}
