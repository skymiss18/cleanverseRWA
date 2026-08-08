import { recommendKycAction } from "@/lib/kyc-agent";
import { evaluateAutoExecutePolicy } from "@/lib/agent-policy";
import { readKycApplications, upsertKycApplication, appendAgentActionLog, type KycApplicationRecord } from "@/lib/kyc-store";

export type AutoExecuteAction = "update" | "revoke";

export interface RunAutoExecuteInput {
  id: string;
  action?: AutoExecuteAction;
  assetDeploymentId?: string;
  /** Distinguishes a human clicking "Auto Execute" (manual) from the
   *  unattended Vercel Cron / local scheduler invocation (cron), so the
   *  Agent Action Timeline can show which actions truly required zero
   *  human interaction. Defaults to "manual". */
  source?: "manual" | "cron";
}

export interface RunAutoExecuteResult {
  status: number;
  body: Record<string, unknown>;
}

function resolveAction(requested: string | undefined, recommended: string): AutoExecuteAction | null {
  const normalized = (requested || "").trim().toLowerCase();
  if (normalized === "update" || normalized === "revoke") {
    return normalized;
  }
  if (recommended === "update" || recommended === "revoke") {
    return recommended;
  }
  return null;
}

/** Core policy-gated auto update/revoke logic, shared by the manual
 *  `/api/agent/kyc/auto-execute` route and the `/api/agent/kyc/cron-run`
 *  autonomous scheduler so there is exactly one implementation of the
 *  decision + execution path. */
export async function runAutoExecute(input: RunAutoExecuteInput): Promise<RunAutoExecuteResult> {
  const id = input.id?.trim();
  if (!id) {
    return { status: 400, body: { error: "id is required" } };
  }

  const applications = readKycApplications();
  const target = applications.find((item) => item.id === id) as KycApplicationRecord | undefined;
  if (!target) {
    return { status: 404, body: { error: `KYC application not found: ${id}` } };
  }
  if (!target.walletAddress) {
    return { status: 422, body: { error: "KYC application has no walletAddress" } };
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

  const action = resolveAction(input.action, recommendation.action);
  if (!action) {
    return {
      status: 409,
      body: {
        error: "No auto-executable action available for this record",
        recommendation: recommendation.action,
      },
    };
  }

  const logMode: "manual" | "cron" = input.source === "cron" ? "cron" : "manual";

  const policyDecision = evaluateAutoExecutePolicy({
    id,
    walletAddress: target.walletAddress,
    action,
    aiScore: typeof target.aiScore === "number" ? target.aiScore : 0,
    riskBand: recommendation.riskBand,
    proofVerified: recommendation.proofVerified,
  });

  if (!policyDecision.allowed) {
    appendAgentActionLog(id, {
      action,
      mode: logMode,
      reason: `Blocked by policy: ${policyDecision.reasons.join("; ")}`,
    });
    return {
      status: 403,
      body: {
        error: "Auto execute blocked by policy",
        action,
        reasons: policyDecision.reasons,
        policy: policyDecision.policy,
      },
    };
  }

  const nowIso = new Date().toISOString();
  if (policyDecision.dryRun) {
    const dryRunHash = `dryrun-${Date.now().toString(16)}-${id.slice(0, 6)}`;
    const dryUpdated = upsertKycApplication(id, {
      ...recommendation.updatePatch,
      status: action === "revoke" ? "rejected" : "approved",
      monitoringStatus: action === "revoke" ? "revoke_dry_run" : "update_dry_run",
      chainStatus: "DryRun",
      txHash: dryRunHash,
      explorerUrl: null,
      pendingReason: "Dry run mode enabled",
      lastScreenedAt: nowIso,
      executionMode: "auto",
      zkRevocationReason: action === "revoke" ? recommendation.reason : null,
      agentReason: `Policy-approved dry run for ${action}.`,
    });

    appendAgentActionLog(id, { action, mode: logMode, reason: `Dry run: ${recommendation.reason}` });

    return {
      status: 200,
      body: {
        success: true,
        id,
        action,
        executionMode: "auto",
        dryRun: true,
        recommendation: recommendation.action,
        proofVerified: recommendation.proofVerified,
        deployHash: dryRunHash,
        explorerUrl: null,
        status: "DryRun",
        pendingReason: "Dry run mode enabled",
        policy: policyDecision.policy,
        application: dryUpdated,
      },
    };
  }

  const { readDeploymentsWithReconciliation } = await import("@/lib/casper-deployments");
  const deployments = await readDeploymentsWithReconciliation() as Record<string, { identityRegistry?: { contractHash?: string } }>;
  const assetDeploymentId = input.assetDeploymentId?.trim() || String(target.assetDeploymentId ?? "").trim();
  const identityRegistryHash = assetDeploymentId
    ? (deployments[assetDeploymentId]?.identityRegistry?.contractHash?.trim() || process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim())
    : process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();

  if (!identityRegistryHash) {
    return { status: 409, body: { error: "Identity registry hash is not configured" } };
  }

  const {
    broadcastSignedDeploy,
    getServerSignerPublicKeyHex,
    prepareCasperKycWhitelistDeploy,
    signDeployJsonWithServerKey,
  } = await import("@/lib/casper-token-deploy");

  const signerPublicKey = getServerSignerPublicKeyHex();
  const nowSec = Math.floor(Date.now() / 1000);
  const prepared = prepareCasperKycWhitelistDeploy({
    signerPublicKey,
    investorWalletAddress: target.walletAddress,
    jurisdiction: String(target.jurisdiction ?? "SG"),
    kycExpiry: action === "revoke"
      ? nowSec
      : (typeof target.kycExpiry === "number" && target.kycExpiry > 0
        ? Math.floor(target.kycExpiry)
        : nowSec + 365 * 24 * 3600),
    isVerified: action === "update" ? (typeof target.aiScore === "number" ? target.aiScore >= 70 : false) : false,
    amlClear: action === "update" ? (typeof target.aiScore === "number" ? target.aiScore >= 70 : false) : false,
    identityRegistryHash,
  });

  const signed = signDeployJsonWithServerKey(prepared.deployJson);
  const result = await broadcastSignedDeploy({
    deployJson: prepared.deployJson,
    signerPublicKey: signed.signerPublicKey,
    signatureHex: signed.signatureHex,
  });

  const updated = upsertKycApplication(id, {
    ...recommendation.updatePatch,
    status: action === "revoke" ? "rejected" : "approved",
    monitoringStatus: action === "revoke" ? "revoked" : "updated",
    chainStatus: result.status,
    txHash: result.deployHash,
    explorerUrl: result.explorerUrl,
    pendingReason: result.pendingReason ?? null,
    lastScreenedAt: nowIso,
    executionMode: "auto",
    zkRevocationReason: action === "revoke" ? recommendation.reason : null,
    agentReason: action === "revoke"
      ? "Credential revoked on-chain by auto compliance agent."
      : "Credential updated on-chain by auto compliance agent.",
  });

  appendAgentActionLog(id, { action, mode: logMode, reason: recommendation.reason });

  return {
    status: 200,
    body: {
      success: true,
      id,
      action,
      executionMode: "auto",
      dryRun: false,
      recommendation: recommendation.action,
      proofVerified: recommendation.proofVerified,
      deployHash: result.deployHash,
      explorerUrl: result.explorerUrl,
      status: result.status,
      pendingReason: result.pendingReason,
      policy: policyDecision.policy,
      application: updated,
    },
  };
}

/** Returns the ids of KYC applications that are candidates for continuous
 *  autonomous monitoring: anything not already in a terminal revoked state
 *  and that has a wallet address to check. */
export function listAutoExecuteCandidateIds(): string[] {
  const applications = readKycApplications();
  return applications
    .filter((item) => Boolean(item.walletAddress) && item.status !== "rejected")
    .map((item) => item.id);
}
