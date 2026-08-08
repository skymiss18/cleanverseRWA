import { NextResponse } from "next/server";
import { readKycApplications, upsertKycApplication, appendAgentActionLog, type KycApplicationRecord } from "@/lib/kyc-store";
import { recommendKycAction } from "@/lib/kyc-agent";
import { evaluateAutoExecutePolicy } from "@/lib/agent-policy";

export const runtime = "nodejs";

export async function POST() {
  try {
    const applications = readKycApplications();
    const queue: Array<{
      id: string;
      action: string;
      reason: string;
      confidence: number;
      riskBand: number;
      autoExecutable: boolean;
    }> = [];

    for (const record of applications as KycApplicationRecord[]) {
      if (!record.id || !record.walletAddress) {
        continue;
      }

      const recommendation = await recommendKycAction({
        id: record.id,
        walletAddress: record.walletAddress,
        jurisdiction: record.jurisdiction,
        investorType: record.investorType,
        pepDeclaration: Boolean(record.pepDeclaration),
        status: record.status,
        aiScore: typeof record.aiScore === "number" ? record.aiScore : null,
        kycExpiry: typeof record.kycExpiry === "number" ? record.kycExpiry : null,
        credentialCommitment: typeof record.credentialCommitment === "string" ? record.credentialCommitment : null,
        nullifierHash: typeof record.nullifierHash === "string" ? record.nullifierHash : null,
        proofHash: typeof record.proofHash === "string" ? record.proofHash : null,
        zkProof: typeof record.zkProof === "string" ? record.zkProof : null,
        zkPublicSignals: Array.isArray(record.zkPublicSignals)
          ? record.zkPublicSignals.filter((item): item is string => typeof item === "string")
          : null,
        zkProofScheme: typeof record.zkProofScheme === "string" ? record.zkProofScheme : null,
        zkCircuitId: typeof record.zkCircuitId === "string" ? record.zkCircuitId : null,
        proofVerified: typeof record.proofVerified === "boolean" ? record.proofVerified : null,
        zkVerifiedAt: typeof record.zkVerifiedAt === "string" ? record.zkVerifiedAt : null,
        monitoringStatus: typeof record.monitoringStatus === "string" ? record.monitoringStatus : null,
        lastScreenedAt: typeof record.lastScreenedAt === "string" ? record.lastScreenedAt : null,
      });

      upsertKycApplication(record.id, recommendation.updatePatch);

      if (recommendation.action !== "noop") {
        appendAgentActionLog(record.id, { action: recommendation.action, mode: "manual", reason: recommendation.reason });

        const autoDecision =
          recommendation.action === "update" || recommendation.action === "revoke"
            ? evaluateAutoExecutePolicy({
              id: record.id,
              walletAddress: record.walletAddress,
              action: recommendation.action,
              aiScore: typeof record.aiScore === "number" ? record.aiScore : 0,
              riskBand: recommendation.riskBand,
              proofVerified: recommendation.proofVerified,
            })
            : null;

        queue.push({
          id: record.id,
          action: recommendation.action,
          reason: recommendation.reason,
          confidence: recommendation.confidence,
          riskBand: recommendation.riskBand,
          autoExecutable: autoDecision ? autoDecision.allowed : false,
        });
      }
    }

    return NextResponse.json({
      success: true,
      scanned: applications.length,
      actionable: queue.length,
      queue,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to run KYC monitor" },
      { status: 500 },
    );
  }
}
