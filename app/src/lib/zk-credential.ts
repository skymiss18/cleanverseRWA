import { createHash, randomBytes } from "crypto";

export type RiskBand = 1 | 2 | 3 | 4;

export interface CredentialCommitmentInput {
  walletAddress: string;
  jurisdiction: string;
  investorType: "individual" | "institutional";
  kycExpiry: number;
  riskBand: RiskBand;
  saltHex?: string;
}

export interface ProofEnvelope {
  version: "v1";
  generatedAt: string;
  publicClaims: {
    walletHash: string;
    jurisdiction: string;
    investorType: "individual" | "institutional";
    kycExpiry: number;
    riskBand: RiskBand;
    eligible: boolean;
  };
  commitment: string;
  nullifierHash: string;
  proofHash: string;
  meta: {
    schema: "zk-ready-proof-envelope";
    verifier: "local-hash-verifier";
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeJurisdiction(value: string): string {
  return value.trim().toUpperCase().slice(0, 3) || "UNK";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(",")}}`;
}

export function generateCredentialSaltHex(): string {
  return randomBytes(16).toString("hex");
}

export function deriveCredentialCommitment(input: CredentialCommitmentInput): string {
  const payload = {
    walletAddress: input.walletAddress.trim().toLowerCase(),
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    investorType: input.investorType,
    kycExpiry: Math.floor(input.kycExpiry),
    riskBand: input.riskBand,
    saltHex: input.saltHex?.trim().toLowerCase() || "",
  };
  return sha256Hex(stableStringify(payload));
}

export function deriveNullifierHash(walletAddress: string, issuerDomain: string, saltHex: string): string {
  const payload = {
    walletAddress: walletAddress.trim().toLowerCase(),
    issuerDomain: issuerDomain.trim().toLowerCase(),
    saltHex: saltHex.trim().toLowerCase(),
  };
  return sha256Hex(stableStringify(payload));
}

export function toRiskBand(score: number | null | undefined): RiskBand {
  const normalized = Number.isFinite(score) ? Number(score) : 0;
  if (normalized >= 85) return 1;
  if (normalized >= 70) return 2;
  if (normalized >= 50) return 3;
  return 4;
}

export function buildProofEnvelope(input: CredentialCommitmentInput & {
  eligible: boolean;
  issuerDomain: string;
  nullifierSaltHex: string;
}): ProofEnvelope {
  const walletHash = sha256Hex(input.walletAddress.trim().toLowerCase());
  const commitment = deriveCredentialCommitment(input);
  const nullifierHash = deriveNullifierHash(input.walletAddress, input.issuerDomain, input.nullifierSaltHex);

  const publicClaims = {
    walletHash,
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    investorType: input.investorType,
    kycExpiry: Math.floor(input.kycExpiry),
    riskBand: input.riskBand,
    eligible: input.eligible,
  };

  const proofHash = sha256Hex(stableStringify({ commitment, nullifierHash, publicClaims }));

  return {
    version: "v1",
    generatedAt: new Date().toISOString(),
    publicClaims,
    commitment,
    nullifierHash,
    proofHash,
    meta: {
      schema: "zk-ready-proof-envelope",
      verifier: "local-hash-verifier",
    },
  };
}

export function verifyProofEnvelope(envelope: ProofEnvelope): { valid: boolean; reason?: string } {
  if (!envelope || envelope.version !== "v1") {
    return { valid: false, reason: "Unsupported or missing proof envelope version" };
  }

  const recomputed = sha256Hex(
    stableStringify({
      commitment: envelope.commitment,
      nullifierHash: envelope.nullifierHash,
      publicClaims: envelope.publicClaims,
    }),
  );

  if (recomputed !== envelope.proofHash) {
    return { valid: false, reason: "proofHash mismatch" };
  }

  const expiry = Number(envelope.publicClaims.kycExpiry ?? 0);
  if (!Number.isFinite(expiry) || expiry <= 0) {
    return { valid: false, reason: "Invalid kycExpiry" };
  }

  return { valid: true };
}
