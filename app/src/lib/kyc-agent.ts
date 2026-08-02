import { generateCredentialSaltHex, toRiskBand, type RiskBand } from "@/lib/zk-credential";
import { getZkProvider, type ZkProofBundle } from "@/lib/zk-provider";

export type KycAgentAction = "issue" | "update" | "revoke" | "manual_review" | "noop";

export interface KycAgentApplication {
  id: string;
  walletAddress: string;
  jurisdiction?: string | null;
  investorType?: "individual" | "institutional";
  pepDeclaration?: boolean;
  status?: string;
  aiScore?: number | null;
  kycExpiry?: number | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  zkProof?: string | null;
  zkPublicSignals?: string[] | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  proofVerified?: boolean | null;
  zkVerifiedAt?: string | null;
  monitoringStatus?: string | null;
  lastScreenedAt?: string | null;
}

export interface KycAgentRecommendation {
  action: KycAgentAction;
  reason: string;
  riskBand: RiskBand;
  eligible: boolean;
  kycExpiry: number;
  confidence: number;
  proofBundle: ZkProofBundle;
  envelope: {
    credentialCommitment: string;
    nullifierHash: string;
    proofHash: string;
  };
  proofVerified: boolean;
  updatePatch: Record<string, unknown>;
}

function defaultKycExpiry(): number {
  return Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
}

export function recommendKycAction(
  app: KycAgentApplication,
  options?: { issuerDomain?: string },
): Promise<KycAgentRecommendation> {
  const now = Math.floor(Date.now() / 1000);
  const aiScore = Number(app.aiScore ?? 0);
  const riskBand = toRiskBand(aiScore);
  const kycExpiry = Number.isFinite(app.kycExpiry) && (app.kycExpiry ?? 0) > 0
    ? Math.floor(Number(app.kycExpiry))
    : defaultKycExpiry();

  const highRisk = riskBand >= 3;
  const expired = kycExpiry <= now;
  const pepFlag = Boolean(app.pepDeclaration);
  const rejected = app.status === "rejected";
  const hasLegacyCredential = !!app.credentialCommitment && !!app.nullifierHash && !!app.proofHash;
  const hasZkCredential = !!app.zkProof && Array.isArray(app.zkPublicSignals) && app.zkPublicSignals.length > 0;
  const hasCredential = hasLegacyCredential || hasZkCredential;

  let action: KycAgentAction = "noop";
  let reason = "Credential is healthy; no update required.";
  let confidence = 0.88;

  if (rejected || expired || aiScore < 50) {
    action = "revoke";
    reason = rejected
      ? "Application was rejected and must be revoked on-chain."
      : expired
        ? "KYC credential expired; revoke before re-issuance."
        : "AI risk score fell below critical threshold (<50).";
    confidence = 0.95;
  } else if (!hasCredential) {
    action = "issue";
    reason = "No active privacy-preserving credential found; issue required.";
    confidence = 0.93;
  } else if (pepFlag || highRisk || aiScore < 70) {
    action = "manual_review";
    reason = pepFlag
      ? "PEP declaration requires manual compliance review."
      : "Risk band or AI score indicates manual review before update.";
    confidence = 0.82;
  } else {
    action = "update";
    reason = "Credential should be refreshed with latest monitoring state.";
    confidence = 0.84;
  }

  const issuerDomain = options?.issuerDomain?.trim() || "nexusrwa.casper";
  const saltHex = generateCredentialSaltHex();
  const provider = getZkProvider();
  return (async () => {
    const proofBundle = await provider.generateProof({
    walletAddress: app.walletAddress,
    jurisdiction: app.jurisdiction?.trim() || "SG",
    investorType: app.investorType === "institutional" ? "institutional" : "individual",
    kycExpiry,
    riskBand,
    saltHex,
    eligible: action !== "revoke" && action !== "manual_review",
    issuerDomain,
    nullifierSaltHex: saltHex,
  });
    const verification = await provider.verifyProof(proofBundle);

    if (!verification.valid && action !== "revoke") {
      action = "manual_review";
      reason = `Proof verification failed: ${verification.reason ?? "unknown reason"}`;
      confidence = 0.7;
    }

    return {
      action,
      reason,
      riskBand,
      eligible: proofBundle.publicSignals[5] === "1",
      kycExpiry,
      confidence,
      proofBundle,
      envelope: {
        credentialCommitment: proofBundle.commitment,
        nullifierHash: proofBundle.nullifierHash,
        proofHash: proofBundle.proofHash,
      },
      proofVerified: verification.valid,
      updatePatch: {
        aiRiskScore: aiScore,
        riskBand,
        credentialCommitment: proofBundle.commitment,
        nullifierHash: proofBundle.nullifierHash,
        proofHash: proofBundle.proofHash,
        zkProof: proofBundle.proof,
        zkPublicSignals: proofBundle.publicSignals,
        zkProofScheme: proofBundle.scheme,
        zkCircuitId: proofBundle.circuitId,
        zkVerificationKeyId: proofBundle.verificationKeyId,
        proofVerified: verification.valid,
        zkVerifiedAt: verification.valid ? new Date().toISOString() : null,
        monitoringStatus: action,
        lastScreenedAt: new Date().toISOString(),
        agentReason: reason,
        kycExpiry,
      },
    };
  })();
}
