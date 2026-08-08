export type AutoExecuteAction = "update" | "revoke";

export interface AutoExecuteContext {
  id: string;
  walletAddress: string;
  action: AutoExecuteAction;
  aiScore: number;
  riskBand: number;
  proofVerified: boolean;
}

export interface AutoExecutePolicy {
  enabled: boolean;
  killSwitch: boolean;
  dryRun: boolean;
  requireProofVerified: boolean;
  minAiScoreUpdate: number;
  maxRiskBandUpdate: number;
  idAllowlist: Set<string>;
  walletAllowlist: Set<string>;
}

export interface PolicyDecision {
  allowed: boolean;
  dryRun: boolean;
  reasons: string[];
  policy: Omit<AutoExecutePolicy, "idAllowlist" | "walletAllowlist"> & {
    idAllowlistSize: number;
    walletAllowlistSize: number;
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return fallback;
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function parseSet(value: string | undefined): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function readAutoExecutePolicy(): AutoExecutePolicy {
  return {
    enabled: parseBool(process.env.AGENT_AUTO_EXECUTE_ENABLED, false),
    killSwitch: parseBool(process.env.AGENT_AUTO_EXECUTE_KILL_SWITCH, false),
    dryRun: parseBool(process.env.AGENT_AUTO_EXECUTE_DRY_RUN, true),
    requireProofVerified: parseBool(process.env.AGENT_AUTO_EXECUTE_REQUIRE_PROOF_VERIFIED, true),
    minAiScoreUpdate: parseIntWithDefault(process.env.AGENT_AUTO_EXECUTE_MIN_AI_SCORE_UPDATE, 70),
    maxRiskBandUpdate: parseIntWithDefault(process.env.AGENT_AUTO_EXECUTE_MAX_RISK_BAND_UPDATE, 2),
    idAllowlist: parseSet(process.env.AGENT_AUTO_EXECUTE_ID_ALLOWLIST),
    walletAllowlist: parseSet(process.env.AGENT_AUTO_EXECUTE_WALLET_ALLOWLIST),
  };
}

export function evaluateAutoExecutePolicy(context: AutoExecuteContext): PolicyDecision {
  const policy = readAutoExecutePolicy();
  const reasons: string[] = [];
  const normalizedId = context.id.trim().toLowerCase();
  const normalizedWallet = context.walletAddress.trim().toLowerCase();

  if (!policy.enabled) {
    reasons.push("Auto execute is disabled");
  }
  if (policy.killSwitch) {
    reasons.push("Kill switch is enabled");
  }
  if (policy.requireProofVerified && !context.proofVerified) {
    reasons.push("Proof verification is required");
  }

  if (policy.idAllowlist.size > 0 && !policy.idAllowlist.has(normalizedId)) {
    reasons.push("KYC application id is not in allowlist");
  }
  if (policy.walletAllowlist.size > 0 && !policy.walletAllowlist.has(normalizedWallet)) {
    reasons.push("Wallet is not in allowlist");
  }

  if (context.action === "update") {
    if (context.aiScore < policy.minAiScoreUpdate) {
      reasons.push(`AI score below update threshold (${policy.minAiScoreUpdate})`);
    }
    if (context.riskBand > policy.maxRiskBandUpdate) {
      reasons.push(`Risk band above update threshold (${policy.maxRiskBandUpdate})`);
    }
  }

  return {
    allowed: reasons.length === 0,
    dryRun: policy.dryRun,
    reasons,
    policy: {
      enabled: policy.enabled,
      killSwitch: policy.killSwitch,
      dryRun: policy.dryRun,
      requireProofVerified: policy.requireProofVerified,
      minAiScoreUpdate: policy.minAiScoreUpdate,
      maxRiskBandUpdate: policy.maxRiskBandUpdate,
      idAllowlistSize: policy.idAllowlist.size,
      walletAllowlistSize: policy.walletAllowlist.size,
    },
  };
}
