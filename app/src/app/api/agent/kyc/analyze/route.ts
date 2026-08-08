import { NextRequest, NextResponse } from "next/server";
import { readKycApplications, upsertKycApplication, appendAgentActionLog, type KycApplicationRecord } from "@/lib/kyc-store";
import { recommendKycAction } from "@/lib/kyc-agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const applications = readKycApplications();
    const target = applications.find((item) => item.id === id) as KycApplicationRecord | undefined;
    if (!target) {
      return NextResponse.json({ error: `KYC application not found: ${id}` }, { status: 404 });
    }
    if (!target.walletAddress) {
      return NextResponse.json({ error: "KYC application has no walletAddress" }, { status: 422 });
    }

    const recommendation = await recommendKycAction({
      id: target.id,
      walletAddress: target.walletAddress,
      jurisdiction: target.jurisdiction,
      investorType: target.investorType,
      pepDeclaration: Boolean(target.pepDeclaration),
      status: target.status,
      aiScore: typeof target.aiScore === "number" ? target.aiScore : null,
      kycExpiry: typeof target.kycExpiry === "number" ? target.kycExpiry : null,
      credentialCommitment: typeof target.credentialCommitment === "string" ? target.credentialCommitment : null,
      nullifierHash: typeof target.nullifierHash === "string" ? target.nullifierHash : null,
      proofHash: typeof target.proofHash === "string" ? target.proofHash : null,
      zkProof: typeof target.zkProof === "string" ? target.zkProof : null,
      zkPublicSignals: Array.isArray(target.zkPublicSignals)
        ? target.zkPublicSignals.filter((item): item is string => typeof item === "string")
        : null,
      zkProofScheme: typeof target.zkProofScheme === "string" ? target.zkProofScheme : null,
      zkCircuitId: typeof target.zkCircuitId === "string" ? target.zkCircuitId : null,
      proofVerified: typeof target.proofVerified === "boolean" ? target.proofVerified : null,
      zkVerifiedAt: typeof target.zkVerifiedAt === "string" ? target.zkVerifiedAt : null,
      monitoringStatus: typeof target.monitoringStatus === "string" ? target.monitoringStatus : null,
      lastScreenedAt: typeof target.lastScreenedAt === "string" ? target.lastScreenedAt : null,
    });

    const updated = upsertKycApplication(id, {
      ...recommendation.updatePatch,
      status: target.status === "pending" ? "ai_scored" : target.status,
    });

    if (recommendation.action !== "noop") {
      appendAgentActionLog(id, { action: recommendation.action, mode: "manual", reason: recommendation.reason });
    }

    return NextResponse.json({
      success: true,
      id,
      recommendation,
      application: updated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to analyze KYC application" },
      { status: 500 },
    );
  }
}
