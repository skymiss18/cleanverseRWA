import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  deriveCredentialCommitment,
  deriveNullifierHash,
  type CredentialCommitmentInput,
} from "@/lib/zk-credential";

export type ZkProofScheme = "zk-ready-hash" | "groth16";

export interface ZkProofBundle {
  scheme: ZkProofScheme;
  circuitId: string;
  verificationKeyId: string;
  generatedAt: string;
  commitment: string;
  nullifierHash: string;
  proofHash: string;
  proof: string;
  publicSignals: string[];
}

export interface ZkProviderInput extends CredentialCommitmentInput {
  eligible: boolean;
  issuerDomain: string;
  nullifierSaltHex: string;
}

export interface ZkVerificationResult {
  valid: boolean;
  reason?: string;
}

export interface ZkProvider {
  id: ZkProofScheme;
  generateProof(input: ZkProviderInput): Promise<ZkProofBundle>;
  verifyProof(proof: ZkProofBundle): Promise<ZkVerificationResult>;
}

type Groth16 = {
  fullProve: (
    input: Record<string, unknown>,
    wasmPath: string,
    zkeyPath: string,
  ) => Promise<{ proof: unknown; publicSignals: Array<string | number | bigint> }>;
  verify: (verificationKey: unknown, publicSignals: Array<string | number | bigint>, proof: unknown) => Promise<boolean>;
};

type SnarkJsModule = {
  groth16: Groth16;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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

function buildPublicSignals(input: ZkProviderInput): string[] {
  return [
    input.walletAddress.trim().toLowerCase(),
    input.jurisdiction.trim().toUpperCase().slice(0, 3) || "UNK",
    input.investorType,
    String(Math.floor(input.kycExpiry)),
    String(input.riskBand),
    input.eligible ? "1" : "0",
  ];
}

function resolvePath(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function shaToFieldDecimal(value: string): string {
  const modulus = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  const digest = sha256Hex(value);
  return (BigInt(`0x${digest}`) % modulus).toString();
}

function toGroth16Input(input: ZkProviderInput): Record<string, string> {
  return {
    wallet_hash: shaToFieldDecimal(input.walletAddress.trim().toLowerCase()),
    jurisdiction_code: shaToFieldDecimal(input.jurisdiction.trim().toUpperCase().slice(0, 3) || "UNK"),
    investor_type: input.investorType === "institutional" ? "2" : "1",
    kyc_expiry: String(Math.floor(input.kycExpiry)),
    risk_band: String(input.riskBand),
    eligible: input.eligible ? "1" : "0",
    commitment: shaToFieldDecimal(deriveCredentialCommitment(input)),
    nullifier: shaToFieldDecimal(deriveNullifierHash(input.walletAddress, input.issuerDomain, input.nullifierSaltHex)),
  };
}

function toStringSignals(values: Array<string | number | bigint>): string[] {
  return values.map((value) => String(value));
}

function parseProofFromBundle(bundle: ZkProofBundle): unknown {
  const decoded = Buffer.from(bundle.proof, "base64").toString("utf8");
  return JSON.parse(decoded);
}

let snarkjsModulePromise: Promise<SnarkJsModule> | null = null;
function getSnarkJs(): Promise<SnarkJsModule> {
  if (!snarkjsModulePromise) {
    snarkjsModulePromise = import("snarkjs") as Promise<SnarkJsModule>;
  }
  return snarkjsModulePromise;
}

function buildBundle(
  scheme: ZkProofScheme,
  circuitId: string,
  verificationKeyId: string,
  input: ZkProviderInput,
): ZkProofBundle {
  const commitment = deriveCredentialCommitment(input);
  const nullifierHash = deriveNullifierHash(input.walletAddress, input.issuerDomain, input.nullifierSaltHex);
  const publicSignals = buildPublicSignals(input);
  const proofPayload = stableStringify({
    scheme,
    circuitId,
    verificationKeyId,
    commitment,
    nullifierHash,
    publicSignals,
  });

  return {
    scheme,
    circuitId,
    verificationKeyId,
    generatedAt: new Date().toISOString(),
    commitment,
    nullifierHash,
    proofHash: sha256Hex(proofPayload),
    proof: Buffer.from(proofPayload).toString("base64"),
    publicSignals,
  };
}

function verifyBundle(bundle: ZkProofBundle): ZkVerificationResult {
  if (!bundle.proof || !bundle.proofHash || !bundle.commitment || !bundle.nullifierHash) {
    return { valid: false, reason: "Missing proof fields" };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(bundle.proof, "base64").toString("utf8");
  } catch {
    return { valid: false, reason: "Invalid proof encoding" };
  }

  const expectedHash = sha256Hex(decoded);
  if (expectedHash !== bundle.proofHash) {
    return { valid: false, reason: "proofHash mismatch" };
  }
  return { valid: true };
}

const hashProvider: ZkProvider = {
  id: "zk-ready-hash",
  async generateProof(input) {
    return buildBundle("zk-ready-hash", "kyc-commitment-v1", "local-hash-v1", input);
  },
  async verifyProof(proof) {
    return verifyBundle(proof);
  },
};

const groth16Provider: ZkProvider = {
  id: "groth16",
  async generateProof(input) {
    const wasmPath = resolvePath(process.env.ZK_GROTH16_WASM_PATH);
    const zkeyPath = resolvePath(process.env.ZK_GROTH16_ZKEY_PATH);
    const verificationKeyPath = resolvePath(process.env.ZK_GROTH16_VKEY_PATH);

    if (!wasmPath || !zkeyPath || !verificationKeyPath) {
      throw new Error("Groth16 provider requires ZK_GROTH16_WASM_PATH, ZK_GROTH16_ZKEY_PATH and ZK_GROTH16_VKEY_PATH");
    }
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath) || !fs.existsSync(verificationKeyPath)) {
      throw new Error("Groth16 artifact path not found. Check WASM/ZKEY/VKEY files");
    }

    const snarkjs = await getSnarkJs();
    const witnessInput = toGroth16Input(input);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(witnessInput, wasmPath, zkeyPath);
    const commitment = deriveCredentialCommitment(input);
    const nullifierHash = deriveNullifierHash(input.walletAddress, input.issuerDomain, input.nullifierSaltHex);
    const signals = toStringSignals(publicSignals);
    const proofJson = JSON.stringify(proof);
    const proofPayload = stableStringify({
      scheme: "groth16",
      circuitId: process.env.ZK_GROTH16_CIRCUIT_ID?.trim() || "kyc-groth16-v1",
      verificationKeyId: process.env.ZK_GROTH16_VKEY_ID?.trim() || path.basename(verificationKeyPath),
      commitment,
      nullifierHash,
      publicSignals: signals,
      proof: proofJson,
    });

    return {
      scheme: "groth16",
      circuitId: process.env.ZK_GROTH16_CIRCUIT_ID?.trim() || "kyc-groth16-v1",
      verificationKeyId: process.env.ZK_GROTH16_VKEY_ID?.trim() || path.basename(verificationKeyPath),
      generatedAt: new Date().toISOString(),
      commitment,
      nullifierHash,
      proofHash: sha256Hex(proofPayload),
      proof: Buffer.from(proofJson).toString("base64"),
      publicSignals: signals,
    };
  },
  async verifyProof(bundle) {
    const basic = verifyBundle(bundle);
    if (!basic.valid) return basic;

    const verificationKeyPath = resolvePath(process.env.ZK_GROTH16_VKEY_PATH);
    if (!verificationKeyPath || !fs.existsSync(verificationKeyPath)) {
      return { valid: false, reason: "Groth16 verification key file missing" };
    }

    try {
      const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, "utf8"));
      const proof = parseProofFromBundle(bundle);
      const snarkjs = await getSnarkJs();
      const verified = await snarkjs.groth16.verify(verificationKey, bundle.publicSignals, proof);
      return verified ? { valid: true } : { valid: false, reason: "Groth16 verification failed" };
    } catch (err) {
      return { valid: false, reason: err instanceof Error ? err.message : "Groth16 verification error" };
    }
  },
};

export function getZkProvider(): ZkProvider {
  const configured = (process.env.ZK_PROVIDER_MODE || "").trim().toLowerCase();
  if (configured === "groth16") {
    return groth16Provider;
  }
  return hashProvider;
}
