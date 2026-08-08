import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import {
  Args,
  CLValue,
  Deploy,
  ContractHash,
  DeployHeader,
  ExecutableDeployItem,
  Key,
  KeyAlgorithm,
  NamedArg,
  PrivateKey,
  PublicKey,
  SessionBuilder,
  StoredVersionedContractByHash,
  Timestamp,
  Transaction,
} from "casper-js-sdk";
import { casperExplorerDeployUrl, casperExplorerTransactionUrl, getCasperRpcClient, getCasperRpcClientForUrl, getCasperRpcUrls } from "./casper-chain";
import { isCasperAccountHash, isCasperPublicKeyHex, normalizeCasperAccountHash } from "./casper-address";

const DEFAULT_INSTALL_PAYMENT_MOTES = "200000000000"; // 200 CSPR (Odra contracts need more gas)
const DEFAULT_TIMEOUT_MS = 240_000; // 4 min — Casper block time ~65s
const DEFAULT_CHAIN_NAME = "casper-test";

export interface CasperTokenDeployInput {
  assetId: string;
  assetName: string;
  symbol: string;
  issuer: string;
  totalIssuance: string;
  currency: string;
  sfcRef: string;
  complianceOracleHash?: string;
  identityRegistryHash?: string;
  mintAuthorityPublicKey?: string;
}

export interface CasperTokenDeployResult {
  deployHash: string;
  contractHash?: string;
  explorerUrl: string;
  status: "Deployed" | "Submitted";
  pendingReason?: string;
  packageKeyName?: string;   // odra_cfg_package_hash_key_name actually used for this install (unique per deploy)
}

const TOKEN_COUPON_INSTALL_ARG_NAMES = [
  "odra_cfg_is_upgrade",
  "odra_cfg_is_upgradable",
  "odra_cfg_allow_key_override",
  "odra_cfg_package_hash_key_name",
  "asset_id",
  "asset_name",
  "symbol",
  "issuer",
  "total_issuance",
  "currency",
  "sfc_ref",
  "compliance_oracle_hash",
  "identity_registry_hash",
  "mint_authority",
] as const;

const IDENTITY_REGISTRY_INSTALL_ARG_NAMES = [
  "odra_cfg_is_upgrade",
  "odra_cfg_is_upgradable",
  "odra_cfg_allow_key_override",
  "odra_cfg_package_hash_key_name",
] as const;

const HASH_REF_REGEX = /^(?:contract-|hash-)?[0-9a-fA-F]{64}$/;

interface NormalizedInstallArgs {
  assetId: string;
  assetName: string;
  symbol: string;
  issuer: string;
  totalIssuance: string;
  currency: string;
  sfcRef: string;
  complianceOracleHash: string;
  identityRegistryHash: string;
  mintAuthorityPublicKey: string;
  packageKeyName: string;
}

function buildAssetPackageKey(prefix: "token_coupon" | "identity_registry", assetId: string, uniqueSuffix?: string) {
  const sanitizedAssetId = assetId.replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 32) || prefix;
  const base = `${prefix}_${sanitizedAssetId}`;
  return uniqueSuffix ? `${base}_${uniqueSuffix}` : base;
}

/** Short random hex suffix so every fresh install gets its own
 *  odra_cfg_package_hash_key_name, even when re-deploying the same assetId.
 *  Without this, retrying an install after a failed/partial deploy reuses the
 *  same named key and Odra reverts with ExecutionError::CannotOverrideKeys
 *  (raw Casper user error 64641). */
function generatePackageKeySuffix(): string {
  return randomBytes(4).toString("hex");
}

function getInstallPaymentAmountMotes(): string {
  const paymentAmount = process.env.CASPER_TOKEN_INSTALL_PAYMENT ?? DEFAULT_INSTALL_PAYMENT_MOTES;
  const paymentMotes = motesToSafeNumber(paymentAmount);
  const maxPayment = Number(process.env.CASPER_TOKEN_INSTALL_PAYMENT_MAX_MOTES ?? "500000000000");
  if (Number.isSafeInteger(maxPayment) && maxPayment > 0 && paymentMotes > maxPayment) {
    throw new Error(
      `CASPER_TOKEN_INSTALL_PAYMENT (${paymentMotes}) exceeds CASPER_TOKEN_INSTALL_PAYMENT_MAX_MOTES (${maxPayment})`
    );
  }
  return String(paymentMotes);
}

function normalizeContractRef(refName: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!HASH_REF_REGEX.test(trimmed)) {
    throw new Error(`${refName} must be a 64-hex hash (optionally prefixed with contract- or hash-)`);
  }
  return trimmed;
}

function normalizeContractHashForStoredCall(refName: string, value: string): string {
  const normalized = normalizeContractRef(refName, value);
  if (!normalized) return "";
  const rawHex = normalized.replace(/^(?:contract-|hash-)/i, "").toLowerCase();
  return rawHex;
}

function normalizeInstallArgs(input: CasperTokenDeployInput, fallbackMintAuthorityPublicKey: string): NormalizedInstallArgs {
  const assetId = (input.assetId ?? "").toString().trim();
  const assetName = (input.assetName ?? "Harbour RWA Issuance").toString().trim() || "Harbour RWA Issuance";
  const symbol = (input.symbol ?? "HRWA").toString().trim() || "HRWA";
  const issuer = (input.issuer ?? "Harbour Capital Markets Corporation Limited").toString().trim() || "Harbour Capital Markets Corporation Limited";
  const totalIssuance = (input.totalIssuance ?? "0").toString().trim() || "0";
  const currency = (input.currency ?? "USD").toString().trim() || "USD";
  const sfcRef = (input.sfcRef ?? "").toString().trim() || "";
  const complianceOracleHash = normalizeContractRef("complianceOracleHash", (input.complianceOracleHash ?? "").toString());
  const identityRegistryHash = normalizeContractRef("identityRegistryHash", (input.identityRegistryHash ?? "").toString());
  const mintAuthorityPublicKey = (input.mintAuthorityPublicKey ?? fallbackMintAuthorityPublicKey ?? "").toString().trim();

  if (!assetId) {
    throw new Error("assetId is required and cannot be empty");
  }
  if (!/^\d+$/.test(totalIssuance)) {
    throw new Error(`totalIssuance must be a non-negative integer string: ${totalIssuance}`);
  }
  if (!mintAuthorityPublicKey) {
    throw new Error("mintAuthorityPublicKey is required and cannot be empty");
  }
  PublicKey.fromHex(mintAuthorityPublicKey);

  const packageKeyName = buildAssetPackageKey("token_coupon", assetId, generatePackageKeySuffix());

  return {
    assetId,
    assetName,
    symbol,
    issuer,
    totalIssuance,
    currency,
    sfcRef,
    complianceOracleHash,
    identityRegistryHash,
    mintAuthorityPublicKey,
    packageKeyName,
  };
}

function buildTokenCouponInstallCallArgs(input: NormalizedInstallArgs): Args {
  const argSpecs = [
    { name: "odra_cfg_is_upgrade", value: CLValue.newCLValueBool(false) },
    { name: "odra_cfg_is_upgradable", value: CLValue.newCLValueBool(true) },
    { name: "odra_cfg_allow_key_override", value: CLValue.newCLValueBool(false) },
    { name: "odra_cfg_package_hash_key_name", value: CLValue.newCLString(input.packageKeyName) },
    { name: "asset_id", value: CLValue.newCLString(input.assetId) },
    { name: "asset_name", value: CLValue.newCLString(input.assetName) },
    { name: "symbol", value: CLValue.newCLString(input.symbol) },
    { name: "issuer", value: CLValue.newCLString(input.issuer) },
    { name: "total_issuance", value: CLValue.newCLString(input.totalIssuance) },
    { name: "currency", value: CLValue.newCLString(input.currency) },
    { name: "sfc_ref", value: CLValue.newCLString(input.sfcRef) },
    { name: "compliance_oracle_hash", value: CLValue.newCLString(input.complianceOracleHash) },
    { name: "identity_registry_hash", value: CLValue.newCLString(input.identityRegistryHash) },
    { name: "mint_authority", value: CLValue.newCLKey(publicKeyHexToAccountKey(input.mintAuthorityPublicKey)) },
  ] as const;

  const providedNames = argSpecs.map((arg) => arg.name);
  const missingNames = TOKEN_COUPON_INSTALL_ARG_NAMES.filter((name) => !providedNames.includes(name));
  const extraNames = providedNames.filter((name) => !TOKEN_COUPON_INSTALL_ARG_NAMES.includes(name as typeof TOKEN_COUPON_INSTALL_ARG_NAMES[number]));
  if (missingNames.length > 0 || extraNames.length > 0) {
    throw new Error(
      `TokenCoupon install arg schema mismatch. missing=[${missingNames.join(", ")}], extra=[${extraNames.join(", ")}]`
    );
  }

  return Args.fromNamedArgs(argSpecs.map((arg) => new NamedArg(arg.name, arg.value)));
}

function resolveTokenWasmPath() {
  const rawPath = process.env.CASPER_TOKEN_WASM_PATH?.trim();
  if (!rawPath) {
    throw new Error("CASPER_TOKEN_WASM_PATH is not configured. Build token_coupon_build_contract.wasm and set this env var.");
  }

  const wasmPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);

  if (!wasmPath.toLowerCase().endsWith(".wasm")) {
    throw new Error(`CASPER_TOKEN_WASM_PATH must point to a .wasm file: ${wasmPath}`);
  }
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Casper token WASM file not found: ${wasmPath}`);
  }

  return wasmPath;
}

function resolveIdentityRegistryWasmPath() {
  const rawPath = process.env.CASPER_IDENTITY_REGISTRY_WASM_PATH?.trim()
    || "./contracts-casper/target/wasm32-unknown-unknown/release/identity_registry_build_contract.wasm";

  const wasmPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(process.cwd(), rawPath);

  if (!wasmPath.toLowerCase().endsWith(".wasm")) {
    throw new Error(`CASPER_IDENTITY_REGISTRY_WASM_PATH must point to a .wasm file: ${wasmPath}`);
  }
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Casper identity-registry WASM file not found: ${wasmPath}`);
  }

  return wasmPath;
}

function buildIdentityRegistryInstallCallArgs(assetId: string): Args {
  const argSpecs = [
    { name: "odra_cfg_is_upgrade", value: CLValue.newCLValueBool(false) },
    { name: "odra_cfg_is_upgradable", value: CLValue.newCLValueBool(true) },
    { name: "odra_cfg_allow_key_override", value: CLValue.newCLValueBool(false) },
    { name: "odra_cfg_package_hash_key_name", value: CLValue.newCLString(buildAssetPackageKey("identity_registry", assetId)) },
  ] as const;

  const providedNames = argSpecs.map((arg) => arg.name);
  const missingNames = IDENTITY_REGISTRY_INSTALL_ARG_NAMES.filter((name) => !providedNames.includes(name));
  const extraNames = providedNames.filter((name) => !IDENTITY_REGISTRY_INSTALL_ARG_NAMES.includes(name as typeof IDENTITY_REGISTRY_INSTALL_ARG_NAMES[number]));
  if (missingNames.length > 0 || extraNames.length > 0) {
    throw new Error(
      `IdentityRegistry install arg schema mismatch. missing=[${missingNames.join(", ")}], extra=[${extraNames.join(", ")}]`
    );
  }

  return Args.fromNamedArgs(argSpecs.map((arg) => new NamedArg(arg.name, arg.value)));
}

/** Same call args as install, but with odra_cfg_is_upgrade=true so Odra runs the
 *  in-place upgrade path against the existing package hash instead of installing
 *  a brand-new package. */
function buildIdentityRegistryUpgradeCallArgs(assetId: string): Args {
  const argSpecs = [
    { name: "odra_cfg_is_upgrade", value: CLValue.newCLValueBool(true) },
    { name: "odra_cfg_is_upgradable", value: CLValue.newCLValueBool(true) },
    { name: "odra_cfg_allow_key_override", value: CLValue.newCLValueBool(false) },
    { name: "odra_cfg_package_hash_key_name", value: CLValue.newCLString(buildAssetPackageKey("identity_registry", assetId)) },
  ] as const;

  return Args.fromNamedArgs(argSpecs.map((arg) => new NamedArg(arg.name, arg.value)));
}

function getPrivateKey() {
  const privateKeyHex = process.env.CASPER_ORACLE_KEY?.trim();
  if (!privateKeyHex) {
    throw new Error("CASPER_ORACLE_KEY env var not set");
  }
  return PrivateKey.fromHex(privateKeyHex, KeyAlgorithm.ED25519);
}

function hashToHex(hash: unknown): string {
  if (!hash) return "";
  if (typeof hash === "string") return hash;
  if (typeof hash === "object" && hash !== null && "toHex" in hash && typeof hash.toHex === "function") {
    return hash.toHex();
  }
  return String(hash);
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function motesToSafeNumber(motes: string): number {
  const value = Number(motes);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Casper payment amount must be a safe positive integer: ${motes}`);
  }
  return value;
}

function publicKeyHexToAccountKey(publicKeyHex: string): Key {
  return Key.newKey(PublicKey.fromHex(publicKeyHex).accountHash().toPrefixedString());
}

function casperAddressLikeToKey(value: string): Key {
  const trimmed = value.trim();
  if (isCasperPublicKeyHex(trimmed)) {
    return publicKeyHexToAccountKey(trimmed);
  }
  if (isCasperAccountHash(trimmed)) {
    return Key.newKey(normalizeCasperAccountHash(trimmed));
  }
  throw new Error("Investor wallet must be a Casper public key or account-hash");
}

function jurisdictionToCodeBytes(jurisdiction: string): Uint8Array {
  const normalized = jurisdiction.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (!normalized) {
    throw new Error("jurisdiction is required");
  }
  const bytes = new Uint8Array(3);
  bytes[0] = normalized.charCodeAt(0);
  bytes[1] = normalized.length > 1 ? normalized.charCodeAt(1) : 0;
  bytes[2] = 0;
  return bytes;
}

function signatureHexToBytes(signatureHex: string, signerPublicKeyHex: string): Uint8Array {
  let hex = signatureHex.trim().replace(/^0x/i, "");
  const keyPrefix = signerPublicKeyHex.trim().replace(/^0x/i, "").slice(0, 2).toLowerCase();

  // Casper Wallet returns either:
  //   65 bytes (130 hex chars) with algorithm prefix already included (01=Ed25519, 02=secp256k1)
  //   64 bytes (128 hex chars) raw sig — prepend algorithm prefix from public key
  if (hex.length === 128) {
    hex = `${keyPrefix}${hex}`;
  }

  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw new Error(
      `Casper Wallet returned an invalid signature hex string (expected 64 or 65 bytes, got ${signatureHex.trim().length / 2} bytes)`
    );
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function isTransactionJson(value: Record<string, unknown>): boolean {
  return "payload" in value || "TransactionV1" in value || "transactionV1" in value;
}

function decodeUserErrorCode(rawMessage: string): string {
  const match = rawMessage.match(/user\s*error\s*:?\s*(\d+)/i);
  if (!match) return rawMessage;

  const rawCode = Number(match[1]);
  if (!Number.isFinite(rawCode) || rawCode <= 0) return rawMessage;

  const apiUserBase = 65_536;
  const userCode = rawCode >= apiUserBase ? rawCode - apiUserBase : rawCode;
  if (userCode === 122) {
    return `${rawMessage} (Odra ExecutionError::MissingArg - install runtime args are missing or mismatched)`;
  }
  return `${rawMessage} (ApiError::User(${userCode}))`;
}

function findFailureMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;

  if (typeof obj.failure === "string") return decodeUserErrorCode(obj.failure);
  if (typeof obj.Failure === "string") return decodeUserErrorCode(obj.Failure);
  if (obj.failure) return stringifyCompact(obj.failure);
  if (obj.Failure) return stringifyCompact(obj.Failure);
  if (typeof obj.errorMessage === "string") return decodeUserErrorCode(obj.errorMessage);
  if (typeof obj.error_message === "string") return decodeUserErrorCode(obj.error_message);

  for (const key of ["errorCode", "error_code", "code"]) {
    const code = obj[key];
    if (typeof code === "number" && Number.isFinite(code)) {
      const synthetic = decodeUserErrorCode(`User error: ${code}`);
      if (synthetic) return synthetic;
    }
  }

  for (const child of Object.values(obj)) {
    const message = findFailureMessage(child);
    if (message) return message;
  }
  return undefined;
}

function getExecutionResult(waitResult: unknown): unknown {
  const result = waitResult as Record<string, unknown> | undefined;
  const raw = (
    result?.executionInfo && typeof result.executionInfo === "object"
      ? (result.executionInfo as Record<string, unknown>).executionResult
      : undefined
  ) ?? (
    result?.execution_info && typeof result.execution_info === "object"
      ? (result.execution_info as Record<string, unknown>).execution_result
      : undefined
  ) ?? (
    Array.isArray(result?.executionResultsV1)
      ? (result?.executionResultsV1 as Array<Record<string, unknown>>)[0]?.result
      : undefined
  ) ?? (
    Array.isArray(result?.execution_results_v1)
      ? (result?.execution_results_v1 as Array<Record<string, unknown>>)[0]?.result
      : undefined
  ) ?? (
    Array.isArray(result?.execution_results)
      ? (result?.execution_results as Array<Record<string, unknown>>)[0]?.result
      : undefined
  );
  // Unwrap Casper 2.0 TransactionV1 Version2 wrapper so downstream helpers see transfers/initiator directly
  if (raw && typeof raw === "object" && "Version2" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).Version2;
  }
  return raw;
}

async function probeDeployExecutionFailure(deployHash: string, timeoutMs: number): Promise<string | undefined> {
  if (!/^[0-9a-f]{64}$/i.test(deployHash)) return undefined;

  const rpcUrls = getCasperRpcUrls();
  const deadline = Date.now() + Math.max(5_000, timeoutMs);
  while (Date.now() < deadline) {
    for (const rpcUrl of rpcUrls) {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "info_get_deploy",
            params: { deploy_hash: deployHash, finalized_approvals: true },
          }),
          signal: AbortSignal.timeout(8_000),
        });
        const payload = await response.json() as { result?: { execution_results?: Array<{ result?: unknown }> } };
        const execList = payload.result?.execution_results;
        if (!Array.isArray(execList) || execList.length === 0) continue;
        const failureMessage = findFailureMessage(execList[0]?.result);
        return failureMessage;
      } catch {
        // Best-effort only; keep probing other RPC nodes.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }

  return undefined;
}

interface HashCandidate {
  normalized: string;
  score: number;
}

function collectHashesFromString(value: string, trail: string[], candidates: HashCandidate[]) {
  const hashPattern = /\b(?:(contract|hash)-)?([0-9a-fA-F]{64})\b/g;
  let match: RegExpExecArray | null;
  while ((match = hashPattern.exec(value)) !== null) {
    const [, prefix = "", rawHex] = match;
    const normalized = `contract-${rawHex.toLowerCase()}`;
    const pathText = trail.join(".").toLowerCase();
    let score = 0;

    if (prefix === "contract") score += 120;
    if (prefix === "hash") score += 10;
    if (/contract_hash|contracthash/.test(pathText)) score += 120;
    if (/contract|writecontract|storedvalue/.test(pathText)) score += 80;
    if (/named.?keys?|name/.test(pathText)) score += 30;
    if (/token|coupon|package/.test(pathText)) score += 20;
    if (/deploy.?hash|block.?hash|state.?root|account.?hash|transaction.?hash/.test(pathText)) score -= 100;

    candidates.push({ normalized, score });
  }
}

function walkForHashes(value: unknown, trail: string[], candidates: HashCandidate[]) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    collectHashesFromString(value, trail, candidates);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkForHashes(child, [...trail, String(index)], candidates));
    return;
  }
  if (typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  const context = Object.entries(obj)
    .filter(([, child]) => typeof child === "string")
    .map(([key, child]) => `${key}:${child}`)
    .join(" ");
  const contextualTrail = /contract|addressable|entity/i.test(context)
    ? [...trail, "contract-context"]
    : trail;

  for (const [key, child] of Object.entries(obj)) {
    walkForHashes(child, [...contextualTrail, key], candidates);
  }
}

function extractContractHash(waitResult: unknown): string | undefined {
  const candidates: HashCandidate[] = [];
  walkForHashes(waitResult, [], candidates);
  const sorted = candidates.sort((a, b) => b.score - a.score);
  return sorted.find((candidate) => candidate.score >= 50)?.normalized;
}

export async function deployCasperTokenCoupon(input: CasperTokenDeployInput): Promise<CasperTokenDeployResult> {
  const wasmPath = resolveTokenWasmPath();
  const privateKey = getPrivateKey();
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = getInstallPaymentAmountMotes();
  const timeoutMs = Number(process.env.CASPER_DEPLOY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const wasmBytes = fs.readFileSync(wasmPath);
  const normalizedInput = normalizeInstallArgs(input, privateKey.publicKey.toHex());
  const callArgs = buildTokenCouponInstallCallArgs(normalizedInput);

  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, callArgs);
  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = privateKey.publicKey;
  // Back-date by 30 s to compensate for local clock being ahead of node clock
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  // Derive the deploy hash locally from the signed deploy (no network needed).
  // The Casper deploy hash is a Blake2b-256 of the serialised DeployHeader.
  const localDeployHash: string = (() => {
    try {
      const h = hashToHex((deploy as unknown as { hash?: unknown }).hash);
      if (h && h.length === 64) return h;
    } catch { /* ignore */ }
    // Fallback: deterministic pseudo-hash from assetId + timestamp
    const raw = `${normalizedInput.assetId}-${Date.now()}`;
    return Array.from(new TextEncoder().encode(raw))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 64)
      .padEnd(64, "0");
  })();

  // Persist the signed deploy JSON so it can be broadcast later
  // (e.g. via `casper-client put-deploy --input pending-deploy-<hash>.json`)
  const pendingDir = path.resolve(process.cwd(), "data", "pending-deploys");
  try {
    fs.mkdirSync(pendingDir, { recursive: true });
    const deployJson = JSON.stringify(Deploy.toJSON(deploy), null, 2);
    fs.writeFileSync(path.join(pendingDir, `deploy-${localDeployHash.slice(0, 16)}.json`), deployJson, "utf8");
  } catch { /* non-blocking — best-effort persistence */ }

  const rpc = getCasperRpcClient();
  let deployHash = localDeployHash;

  try {
    const putResult = await rpc.putDeploy(deploy);
    const rpcHash = hashToHex(
      (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deployHash
        ?? (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deploy_hash
    );
    if (rpcHash) deployHash = rpcHash;
  } catch (broadcastErr) {
    // Network unreachable — return Submitted with the local deploy hash.
    // The signed deploy has been persisted to data/pending-deploys/ and can
    // be manually broadcast when network access is restored.
    const reason = broadcastErr instanceof Error ? broadcastErr.message : "RPC broadcast failed";
    const isNetworkErr = /network error|ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch|http request/i.test(reason);
    if (isNetworkErr) {
      return {
        deployHash,
        explorerUrl: casperExplorerDeployUrl(deployHash),
        status: "Submitted",
        pendingReason: `Signed deploy saved locally. Broadcast pending: ${reason}`,
      };
    }
    throw broadcastErr;
  }

  try {
    const waitResult = await rpc.waitForDeploy(deploy, timeoutMs);
    const executionResult = getExecutionResult(waitResult);
    const failureMessage = findFailureMessage(executionResult);
    if (failureMessage) {
      throw new Error(`Casper deploy execution failed: ${failureMessage}`);
    }

    return {
      deployHash,
      contractHash: extractContractHash(waitResult),
      explorerUrl: casperExplorerDeployUrl(deployHash),
      status: "Deployed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timed out waiting for Casper deploy execution";
    if (/timeout|timed out|not found/i.test(message)) {
      return {
        deployHash,
        explorerUrl: casperExplorerDeployUrl(deployHash),
        status: "Submitted",
        pendingReason: message,
      };
    }
    throw error;
  }
}

// ── Wallet-based flow (Option A) ──────────────────────────────────────────────

export interface PrepareDeployInput extends CasperTokenDeployInput {
  signerPublicKey: string; // wallet public key hex, e.g. "01abc..."
}

export interface PrepareDeployResult {
  deployJson: Record<string, unknown>;   // unsigned Casper transaction JSON (pass to Casper Wallet)
  deployHash: string;
  signerPublicKey: string;
  paymentMotes: string;
  packageKeyName?: string;   // odra_cfg_package_hash_key_name actually used for this install (unique per deploy)
}

export interface PrepareCasperIdentityRegistryDeployInput {
  signerPublicKey: string;
  assetId: string;
}

export interface PrepareCasperKycWhitelistDeployInput {
  signerPublicKey: string;
  investorWalletAddress: string;
  jurisdiction: string;
  kycExpiry?: number;
  isVerified?: boolean;
  amlClear?: boolean;
  identityRegistryHash?: string;
}

/** Build an unsigned Casper transaction using the wallet's public key as the account.
 *  Returns plain JSON so the frontend can pass it to CasperWalletProvider.sign(). */
export function prepareCasperTokenDeploy(input: PrepareDeployInput): PrepareDeployResult {
  const wasmPath = resolveTokenWasmPath();
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = getInstallPaymentAmountMotes();
  const normalizedInput = normalizeInstallArgs(input, input.signerPublicKey);

  const wasmBytes = fs.readFileSync(wasmPath);
  const callArgs = buildTokenCouponInstallCallArgs(normalizedInput);

  // Use Legacy Deploy format (same as putDeploy API) — TransactionV1 (putTransaction) is
  // unreliable on current testnet nodes; legacy Deploy is the stable interface supported everywhere.
  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, callArgs);
  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = PublicKey.fromHex(input.signerPublicKey);
  // Back-date by 30 s to compensate for local clock being ahead of node clock
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));
  const deploy = Deploy.makeDeploy(header, payment, session);
  const deployHash = hashToHex((deploy as unknown as { hash?: unknown }).hash);
  const deployJson = Deploy.toJSON(deploy) as Record<string, unknown>;

  return { deployJson, deployHash, signerPublicKey: input.signerPublicKey, paymentMotes: paymentAmount, packageKeyName: normalizedInput.packageKeyName };
}

export function prepareCasperIdentityRegistryDeploy(input: PrepareCasperIdentityRegistryDeployInput): PrepareDeployResult {
  const wasmPath = resolveIdentityRegistryWasmPath();
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = process.env.CASPER_IDENTITY_REGISTRY_INSTALL_PAYMENT ?? DEFAULT_INSTALL_PAYMENT_MOTES;
  const signerPublicKey = input.signerPublicKey.trim();
  const assetId = (input.assetId ?? "").trim();

  if (!signerPublicKey) {
    throw new Error("signerPublicKey is required");
  }
  if (!assetId) {
    throw new Error("assetId is required");
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const callArgs = buildIdentityRegistryInstallCallArgs(assetId);

  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, callArgs);
  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = PublicKey.fromHex(signerPublicKey);
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  const deploy = Deploy.makeDeploy(header, payment, session);
  const deployHash = hashToHex((deploy as unknown as { hash?: unknown }).hash);
  const deployJson = Deploy.toJSON(deploy) as Record<string, unknown>;

  return { deployJson, deployHash, signerPublicKey, paymentMotes: paymentAmount };
}

export interface PrepareCasperIdentityRegistryUpgradeDeployInput {
  signerPublicKey: string;
  assetId: string;
}

/** Re-installs the identity-registry WASM against the SAME package_hash_key_name
 *  with odra_cfg_is_upgrade=true, triggering Odra's in-place contract upgrade path
 *  instead of creating a brand-new package. Requires the original install to have
 *  been done with odra_cfg_is_upgradable=true. */
export function prepareCasperIdentityRegistryUpgradeDeploy(
  input: PrepareCasperIdentityRegistryUpgradeDeployInput,
): PrepareDeployResult {
  const wasmPath = resolveIdentityRegistryWasmPath();
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = process.env.CASPER_IDENTITY_REGISTRY_INSTALL_PAYMENT ?? DEFAULT_INSTALL_PAYMENT_MOTES;
  const signerPublicKey = input.signerPublicKey.trim();
  const assetId = (input.assetId ?? "").trim();

  if (!signerPublicKey) {
    throw new Error("signerPublicKey is required");
  }
  if (!assetId) {
    throw new Error("assetId is required");
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const callArgs = buildIdentityRegistryUpgradeCallArgs(assetId);

  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, callArgs);
  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = PublicKey.fromHex(signerPublicKey);
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  const deploy = Deploy.makeDeploy(header, payment, session);
  const deployHash = hashToHex((deploy as unknown as { hash?: unknown }).hash);
  const deployJson = Deploy.toJSON(deploy) as Record<string, unknown>;

  return { deployJson, deployHash, signerPublicKey, paymentMotes: paymentAmount };
}

export function prepareCasperKycWhitelistDeploy(input: PrepareCasperKycWhitelistDeployInput): PrepareDeployResult {
  const contractHashStr = input.identityRegistryHash?.trim() || process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();
  const normalizedIdentityRegistryRef = contractHashStr
    ? normalizeContractRef("identityRegistryHash", contractHashStr)
    : "";
  const normalizedIdentityRegistryRaw = normalizedIdentityRegistryRef
    ? normalizedIdentityRegistryRef.replace(/^(?:contract-|hash-)/i, "").toLowerCase()
    : "";
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = process.env.CASPER_KYC_PAYMENT ?? "5000000000";

  if (!normalizedIdentityRegistryRaw) {
    throw new Error(
      "CASPER_IDENTITY_REGISTRY_HASH env var not set. Deploy the identity-registry contract to Casper Testnet, extract its contract-<hash>, and set CASPER_IDENTITY_REGISTRY_HASH in app/.env.local."
    );
  }
  if (!input.signerPublicKey?.trim()) {
    throw new Error("signerPublicKey is required");
  }

  const signerPublicKey = input.signerPublicKey.trim();
  PublicKey.fromHex(signerPublicKey);

  const investorKey = casperAddressLikeToKey(input.investorWalletAddress);
  const jurisdictionBytes = jurisdictionToCodeBytes(input.jurisdiction);
  const kycExpiry = input.kycExpiry ?? Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  if (!Number.isFinite(kycExpiry) || kycExpiry <= 0) {
    throw new Error("kycExpiry must be a positive unix timestamp");
  }

  const callArgs = Args.fromNamedArgs([
    new NamedArg("investor", CLValue.newCLKey(investorKey)),
    new NamedArg("is_verified", CLValue.newCLValueBool(input.isVerified ?? true)),
    new NamedArg("aml_clear", CLValue.newCLValueBool(input.amlClear ?? true)),
    new NamedArg("jurisdiction", CLValue.newCLByteArray(jurisdictionBytes)),
    new NamedArg("kyc_expiry", CLValue.newCLUint64(String(Math.floor(kycExpiry)))),
  ]);

  // Odra installs always record the *package* hash (via odra_cfg_package_hash_key_name),
  // never a direct contract-entity hash, so this must always be a versioned/package call —
  // calling StoredContractByHash against a package hash fails with
  // "RPC -32008: no such contract at hash".
  const session = new ExecutableDeployItem();
  session.storedVersionedContractByHash = new StoredVersionedContractByHash(
    ContractHash.fromJSON(normalizedIdentityRegistryRaw),
    "upsert_investor",
    callArgs,
  );

  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = PublicKey.fromHex(signerPublicKey);
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  const deploy = Deploy.makeDeploy(header, payment, session);
  const deployHash = hashToHex((deploy as unknown as { hash?: unknown }).hash);
  const deployJson = Deploy.toJSON(deploy) as Record<string, unknown>;

  return { deployJson, deployHash, signerPublicKey, paymentMotes: paymentAmount };
}

export interface BroadcastDeployInput {
  deployJson: Record<string, unknown>;
  signatureHex: string;      // from CasperWalletProvider.sign()
  signerPublicKey: string;   // wallet public key hex
  packageKeyName?: string;   // odra_cfg_package_hash_key_name used at install time; propagated into the result so
                             // deployments.json can look up the real on-chain named key later instead of guessing one.
}

export function getServerSignerPublicKeyHex(): string {
  return getPrivateKey().publicKey.toHex();
}

export function signDeployJsonWithServerKey(deployJson: Record<string, unknown>): {
  signerPublicKey: string;
  signatureHex: string;
} {
  const privateKey = getPrivateKey();
  const signerPublicKey = privateKey.publicKey.toHex();
  const deploy = Deploy.fromJSON(deployJson);
  deploy.sign(privateKey);
  const signed = Deploy.toJSON(deploy) as {
    approvals?: Array<{ signer?: string; signature?: string }>;
  };

  const signatureHex = signed.approvals?.[0]?.signature?.trim();
  if (!signatureHex) {
    throw new Error("Failed to sign deploy with server key");
  }

  return {
    signerPublicKey,
    signatureHex,
  };
}

export interface CasperTokenMintInput {
  contractHash: string;
  investorPublicKey: string;
  amount: string | number;
  paymentRef: string;
}

export interface CasperTokenMintResult {
  deployHash: string;
  explorerUrl: string;
  status: "Minted" | "Submitted";
  pendingReason?: string;
}

export async function mintCasperTokenCoupon(input: CasperTokenMintInput): Promise<CasperTokenMintResult> {
  const privateKey = getPrivateKey();
  const contractHashJson = normalizeContractHashForStoredCall("contractHash", input.contractHash);
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN_NAME;
  const paymentAmount = process.env.CASPER_TOKEN_MINT_PAYMENT ?? "5000000000";
  const timeoutMs = Number(process.env.CASPER_DEPLOY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  const amount = typeof input.amount === "number" ? String(input.amount) : input.amount.trim();
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error(`Token mint amount must be a positive integer: ${input.amount}`);
  }
  if (!input.paymentRef.trim()) {
    throw new Error("paymentRef is required");
  }

  const callArgs = Args.fromNamedArgs([
    new NamedArg("investor", CLValue.newCLKey(publicKeyHexToAccountKey(input.investorPublicKey))),
    new NamedArg("amount", CLValue.newCLUint64(amount)),
    new NamedArg("payment_ref", CLValue.newCLString(input.paymentRef.trim())),
  ]);

  const session = new ExecutableDeployItem();
  // Same reasoning as prepareCasperKycWhitelistDeploy: the persisted TokenCoupon
  // contractHash is actually the Odra package hash, so it must be called via
  // StoredVersionedContractByHash, not StoredContractByHash.
  session.storedVersionedContractByHash = new StoredVersionedContractByHash(
    ContractHash.fromJSON(contractHashJson),
    "subscribe",
    callArgs,
  );

  const payment = ExecutableDeployItem.standardPayment(paymentAmount);
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = privateKey.publicKey;
  // Back-date by 30 s to compensate for local clock being ahead of node clock
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);
  const localDeployHash = hashToHex((deploy as unknown as { hash?: unknown }).hash);
  const rpc = getCasperRpcClient();
  let deployHash = localDeployHash;

  try {
    const putResult = await rpc.putDeploy(deploy);
    const rpcHash = hashToHex(
      (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deployHash
        ?? (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deploy_hash
    );
    if (rpcHash) deployHash = rpcHash;
  } catch (broadcastErr) {
    const reason = broadcastErr instanceof Error ? broadcastErr.message : "RPC broadcast failed";
    const isTransient = /network error|ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch|http request|413|Payload Too Large|timeout|timed out|ETIMEDOUT/i.test(reason);
    if (isTransient) {
      return {
        deployHash,
        explorerUrl: casperExplorerDeployUrl(deployHash),
        status: "Submitted",
        pendingReason: `Mint broadcast pending: ${reason}`,
      };
    }
    throw broadcastErr;
  }

  try {
    const waitResult = await rpc.waitForDeploy(deploy, timeoutMs);
    const executionResult = getExecutionResult(waitResult);
    const failureMessage = findFailureMessage(executionResult);
    if (failureMessage) throw new Error(`Casper token mint failed: ${failureMessage}`);
    return {
      deployHash,
      explorerUrl: casperExplorerDeployUrl(deployHash),
      status: "Minted",
    };
  } catch (waitErr) {
    const msg = waitErr instanceof Error ? waitErr.message : "Timed out";
    if (/timeout|timed out|not found/i.test(msg)) {
      return {
        deployHash,
        explorerUrl: casperExplorerDeployUrl(deployHash),
        status: "Submitted",
        pendingReason: msg,
      };
    }
    throw waitErr;
  }
}

/** Attach the wallet signature to the unsigned transaction and broadcast to the network. */
export async function broadcastSignedDeploy(input: BroadcastDeployInput): Promise<CasperTokenDeployResult> {
  const timeoutMs = Number(process.env.CASPER_DEPLOY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const waitForConfirmation = process.env.CASPER_WAIT_FOR_CONFIRMATION === "true";
  const signerPublicKey = PublicKey.fromHex(input.signerPublicKey);

  const isRetryableError = (err: unknown) =>
    /network error|ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch|http request|413|404|Not Found|Payload Too Large|timeout|timed out|ETIMEDOUT/i.test(
      err instanceof Error ? err.message : String(err)
    );

  const rpcUrls = getCasperRpcUrls();
  let lastError: unknown = new Error("No RPC nodes available");

  for (const rpcUrl of rpcUrls) {
    const rpc = rpcUrl === (process.env.CASPER_RPC_URL ?? "https://rpc.testnet.casperlabs.io")
      ? getCasperRpcClient()
      : getCasperRpcClientForUrl(rpcUrl);

    if (isTransactionJson(input.deployJson)) {
      const transaction = Transaction.fromJSON(input.deployJson);
      transaction.setSignature(signatureHexToBytes(input.signatureHex, input.signerPublicKey), signerPublicKey);
      // Use the hash stored in deployJson (same value the wallet signed) to avoid any SDK re-computation mismatch
      const transactionHash = (typeof input.deployJson.hash === "string" ? input.deployJson.hash : null)
        ?? hashToHex(transaction.hash);

      try {
        const putResult = await rpc.putTransaction(transaction);
        const rpcHash = hashToHex(
          (putResult as { transactionHash?: unknown; transaction_hash?: unknown }).transactionHash
            ?? (putResult as { transactionHash?: unknown; transaction_hash?: unknown }).transaction_hash
        );
        const finalHash = rpcHash || transactionHash;
        console.log(`[broadcast] Transaction submitted via ${rpcUrl}: ${finalHash}`);

        if (!waitForConfirmation) {
          return {
            deployHash: finalHash,
            explorerUrl: casperExplorerTransactionUrl(finalHash),
            status: "Submitted",
            packageKeyName: input.packageKeyName,
          };
        }

        try {
          const waitResult = await rpc.waitForTransaction(transaction, timeoutMs);
          const executionResult = getExecutionResult(waitResult);
          const failureMessage = findFailureMessage(executionResult);
          if (failureMessage) throw new Error(`Casper transaction execution failed: ${failureMessage}`);
          return {
            deployHash: finalHash,
            contractHash: extractContractHash(waitResult),
            explorerUrl: casperExplorerTransactionUrl(finalHash),
            status: "Deployed",
            packageKeyName: input.packageKeyName,
          };
        } catch (waitErr) {
          const msg = waitErr instanceof Error ? waitErr.message : "Timed out";
          if (/timeout|timed out|not found/i.test(msg)) {
            return { deployHash: finalHash, explorerUrl: casperExplorerTransactionUrl(finalHash), status: "Submitted", pendingReason: msg, packageKeyName: input.packageKeyName };
          }
          throw waitErr;
        }
      } catch (broadcastErr) {
        lastError = broadcastErr;
        console.warn(`[broadcast] putTransaction failed on ${rpcUrl}: ${broadcastErr instanceof Error ? broadcastErr.message : broadcastErr}`);
        if (isRetryableError(broadcastErr)) continue;
        throw broadcastErr;
      }
    }

    const deploy = Deploy.fromJSON(input.deployJson);
    Deploy.setSignature(deploy, signatureHexToBytes(input.signatureHex, input.signerPublicKey), signerPublicKey);
    const deployJson = Deploy.toJSON(deploy) as Record<string, unknown>;
    const deployHash = typeof deployJson.hash === "string" ? deployJson.hash
      : hashToHex((deploy as unknown as { hash?: unknown }).hash);

    try {
      // Use fetch directly — the SDK's RpcClient hangs on large WASM payloads (known SDK bug)
      const reqBody = JSON.stringify({ id: 1, jsonrpc: "2.0", method: "account_put_deploy", params: { deploy: deployJson } });
      console.log(`[broadcast] Sending deploy (${(reqBody.length / 1024).toFixed(1)}KB) via ${rpcUrl}`);
      const fetchRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reqBody,
        signal: AbortSignal.timeout(30_000),
      });
      const rpcResult = await fetchRes.json() as { result?: { deploy_hash?: string }; error?: { code?: number; message?: string; data?: string } };
      if (rpcResult.error) {
        const errMsg = rpcResult.error.data ?? rpcResult.error.message ?? "RPC error";
        throw new Error(`RPC ${rpcResult.error.code ?? ""}: ${errMsg}`);
      }
      const finalHash = rpcResult.result?.deploy_hash ?? deployHash;
      console.log(`[broadcast] Deploy submitted via ${rpcUrl}: ${finalHash}`);

      if (waitForConfirmation) {
        try {
          const waitResult = await rpc.waitForDeploy(deploy, timeoutMs);
          const executionResult = getExecutionResult(waitResult);
          const failureMessage = findFailureMessage(executionResult);
          if (failureMessage) throw new Error(`Casper deploy execution failed: ${failureMessage}`);
          return {
            deployHash: finalHash,
            contractHash: extractContractHash(waitResult),
            explorerUrl: casperExplorerDeployUrl(finalHash),
            status: "Deployed",
            packageKeyName: input.packageKeyName,
          };
        } catch (waitErr) {
          const msg = waitErr instanceof Error ? waitErr.message : "Timed out";
          if (!/timeout|timed out|not found/i.test(msg)) throw waitErr;
          return {
            deployHash: finalHash,
            explorerUrl: casperExplorerDeployUrl(finalHash),
            status: "Submitted",
            pendingReason: msg,
            packageKeyName: input.packageKeyName,
          };
        }
      }

      return {
        deployHash: finalHash,
        explorerUrl: casperExplorerDeployUrl(finalHash),
        status: "Submitted",
        packageKeyName: input.packageKeyName,
      };
    } catch (broadcastErr) {
      lastError = broadcastErr;
      console.warn(`[broadcast] putDeploy failed on ${rpcUrl}: ${broadcastErr instanceof Error ? broadcastErr.message : broadcastErr}`);
      if (isRetryableError(broadcastErr)) continue;
      throw broadcastErr;
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "All RPC nodes failed";
  const isV1 = isTransactionJson(input.deployJson);

  // Build the signed payload so we can persist it for later rebroadcast
  let signedJson: Record<string, unknown> = input.deployJson;
  try {
    if (isV1) {
      const tx = Transaction.fromJSON(input.deployJson);
      tx.setSignature(signatureHexToBytes(input.signatureHex, input.signerPublicKey), signerPublicKey);
      signedJson = tx.toJSON() as Record<string, unknown>;
    } else {
      const dep = Deploy.fromJSON(input.deployJson);
      Deploy.setSignature(dep, signatureHexToBytes(input.signatureHex, input.signerPublicKey), signerPublicKey);
      signedJson = Deploy.toJSON(dep) as Record<string, unknown>;
    }
  } catch { /* keep unsigned copy if serialisation fails */ }

  const computedHash = isV1
    ? ((typeof input.deployJson.hash === "string" ? input.deployJson.hash : null)
        ?? hashToHex(Transaction.fromJSON(input.deployJson).hash))
    : (() => {
        const d = Deploy.fromJSON(input.deployJson);
        Deploy.setSignature(d, signatureHexToBytes(input.signatureHex, input.signerPublicKey), signerPublicKey);
        return hashToHex((d as unknown as { hash?: unknown }).hash);
      })();

  // Persist the SIGNED deploy so it can be rebroadcast when connectivity is restored
  try {
    const pendingDir = path.resolve(process.cwd(), "data", "pending-deploys");
    fs.mkdirSync(pendingDir, { recursive: true });
    const fileName = `deploy-${computedHash.slice(0, 16)}.json`;
    fs.writeFileSync(
      path.join(pendingDir, fileName),
      JSON.stringify({ deployJson: signedJson, signerPublicKey: input.signerPublicKey }, null, 2),
      "utf8"
    );
    console.log(`[broadcast] Signed deploy saved for later rebroadcast: ${fileName}`);
  } catch (saveErr) {
    console.warn("[broadcast] Failed to save pending deploy:", saveErr);
  }

  // All RPC nodes failed to accept this signed payload; surface a hard error instead
  // of returning a misleading "Submitted" status.
  throw new Error(
    `Broadcast failed on all Casper RPC nodes: ${reason}. ` +
    `Signed payload saved locally as deploy-${computedHash.slice(0, 16)}.json`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toJsonish(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const maybeJson = value as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === "function") {
    try {
      return maybeJson.toJSON();
    } catch {
      return value;
    }
  }
  return value;
}

function collectNamedArgValues(value: unknown, name: string, out: unknown[], seen = new WeakSet<object>()) {
  const jsonish = toJsonish(value);
  if (!isRecord(jsonish) && !Array.isArray(jsonish)) return;
  if (seen.has(jsonish)) return;
  seen.add(jsonish);

  if (Array.isArray(jsonish)) {
    if (jsonish.length >= 2 && jsonish[0] === name) {
      out.push(jsonish[1]);
    }
    jsonish.forEach((child) => collectNamedArgValues(child, name, out, seen));
    return;
  }

  for (const child of Object.values(jsonish)) {
    collectNamedArgValues(child, name, out, seen);
  }
}

function collectValuesByKeys(value: unknown, keys: string[], out: unknown[], seen = new WeakSet<object>()) {
  const jsonish = toJsonish(value);
  if (!isRecord(jsonish) && !Array.isArray(jsonish)) return;
  if (seen.has(jsonish)) return;
  seen.add(jsonish);

  if (Array.isArray(jsonish)) {
    jsonish.forEach((child) => collectValuesByKeys(child, keys, out, seen));
    return;
  }

  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(jsonish)) {
    if (wanted.has(key.toLowerCase())) out.push(child);
    collectValuesByKeys(child, keys, out, seen);
  }
}

function parsedPrimitive(value: unknown, depth = 0): string | undefined {
  if (value === null || value === undefined || depth > 4) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);

  const directString = (value as { toString?: () => string })?.toString;
  if (typeof directString === "function" && directString !== Object.prototype.toString) {
    try {
      const text = directString.call(value);
      if (text && text !== "[object Object]") return text;
    } catch { /* ignore */ }
  }

  const jsonish = toJsonish(value);
  if (jsonish !== value) return parsedPrimitive(jsonish, depth + 1);
  if (!isRecord(jsonish)) return undefined;

  for (const key of ["parsed", "value", "amount", "id", "Some", "some"]) {
    if (key in jsonish) {
      const parsed = parsedPrimitive(jsonish[key], depth + 1);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function parseBigIntCandidate(value: unknown): bigint | undefined {
  const parsed = parsedPrimitive(value)?.trim();
  if (!parsed || !/^\d+$/.test(parsed)) return undefined;
  try {
    return BigInt(parsed);
  } catch {
    return undefined;
  }
}

function parseNumberCandidate(value: unknown): number | undefined {
  const parsed = parsedPrimitive(value)?.trim();
  if (!parsed || !/^\d+$/.test(parsed)) return undefined;
  const num = Number(parsed);
  return Number.isSafeInteger(num) ? num : undefined;
}

function publicKeyHexToAccountHash(publicKeyHex: string): string {
  return PublicKey.fromHex(publicKeyHex).accountHash().toPrefixedString().toLowerCase();
}

function normalizeAccountHash(value: unknown, depth = 0): string | undefined {
  if (value === null || value === undefined || depth > 4) return undefined;

  const prefixed = (value as { toPrefixedString?: () => string })?.toPrefixedString;
  if (typeof prefixed === "function") {
    try {
      return normalizeAccountHash(prefixed.call(value), depth + 1);
    } catch { /* ignore */ }
  }

  const toHex = (value as { toHex?: () => string })?.toHex;
  if (typeof toHex === "function") {
    try {
      return normalizeAccountHash(toHex.call(value), depth + 1);
    } catch { /* ignore */ }
  }

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    const accountMatch = text.match(/^account-hash-([0-9a-f]{64})$/);
    if (accountMatch) return `account-hash-${accountMatch[1]}`;
    if (/^[0-9a-f]{64}$/.test(text)) return `account-hash-${text}`;
    if (/^(01[0-9a-f]{64}|02[0-9a-f]{66})$/.test(text)) {
      try {
        return publicKeyHexToAccountHash(text);
      } catch { /* not a public key */ }
    }
    return undefined;
  }

  const jsonish = toJsonish(value);
  if (jsonish !== value) return normalizeAccountHash(jsonish, depth + 1);
  if (!isRecord(jsonish)) return undefined;

  for (const key of ["AccountHash", "accountHash", "account_hash", "PublicKey", "publicKey", "public_key", "parsed", "from", "to", "target"]) {
    if (key in jsonish) {
      const normalized = normalizeAccountHash(jsonish[key], depth + 1);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function uniqueDefined(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function transactionJsonSources(result: unknown) {
  const record = isRecord(result) ? result : {};
  const transaction = record.transaction as { toJSON?: () => unknown } | undefined;
  return [record.rawJSON, transaction?.toJSON?.(), result].filter(Boolean);
}

function collectTransferAmountCandidates(executionResult: unknown, sources: unknown[]) {
  const candidates: bigint[] = [];
  for (const source of sources) {
    const values: unknown[] = [];
    collectNamedArgValues(source, "amount", values);
    for (const value of values) {
      const parsed = parseBigIntCandidate(value);
      if (parsed !== undefined) candidates.push(parsed);
    }
  }

  if (isRecord(executionResult) && Array.isArray(executionResult.transfers)) {
    for (const rawTransfer of executionResult.transfers as Array<Record<string, unknown>>) {
      // Unwrap Casper 2.0 Version2 transfer wrapper: { Version2: { amount, from, to, ... } }
      const transfer = (rawTransfer.Version2 && isRecord(rawTransfer.Version2))
        ? rawTransfer.Version2 as Record<string, unknown>
        : rawTransfer;
      const parsed = parseBigIntCandidate(transfer.amount);
      if (parsed !== undefined) candidates.push(parsed);
    }
  }

  return candidates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

function collectTransferIds(executionResult: unknown, sources: unknown[]) {
  const ids: number[] = [];
  for (const source of sources) {
    const values: unknown[] = [];
    collectNamedArgValues(source, "id", values);
    for (const value of values) {
      const parsed = parseNumberCandidate(value);
      if (parsed !== undefined) ids.push(parsed);
    }
  }

  if (isRecord(executionResult) && Array.isArray(executionResult.transfers)) {
    for (const rawTransfer of executionResult.transfers as Array<Record<string, unknown>>) {
      const transfer = (rawTransfer.Version2 && isRecord(rawTransfer.Version2))
        ? rawTransfer.Version2 as Record<string, unknown>
        : rawTransfer;
      const parsed = parseNumberCandidate(transfer.id);
      if (parsed !== undefined) ids.push(parsed);
    }
  }

  return Array.from(new Set(ids));
}

function collectAccountHashes(executionResult: unknown, sources: unknown[], keys: string[]) {
  const candidates: Array<string | undefined> = [];
  for (const source of sources) {
    const values: unknown[] = [];
    collectValuesByKeys(source, keys, values);
    candidates.push(...values.map((value) => normalizeAccountHash(value)));
  }

  if (isRecord(executionResult) && Array.isArray(executionResult.transfers)) {
    for (const rawTransfer of executionResult.transfers as Array<Record<string, unknown>>) {
      const transfer = (rawTransfer.Version2 && isRecord(rawTransfer.Version2))
        ? rawTransfer.Version2 as Record<string, unknown>
        : rawTransfer;
      for (const key of keys) {
        candidates.push(normalizeAccountHash(transfer[key]));
      }
    }
  }

  return uniqueDefined(candidates);
}

export interface CasperNativeTransferVerificationInput {
  transactionHash: string;
  expectedSenderPublicKey: string;
  expectedRecipientPublicKey?: string;
  expectedMinimumMotes: string;
  expectedTransferId?: number;
}

export interface CasperNativeTransferVerificationResult {
  ok: boolean;
  status: "Confirmed" | "Pending" | "Failed" | "Skipped";
  reason?: string;
  observedAmountMotes?: string;
  observedSender?: string;
  observedRecipient?: string;
  observedTransferId?: number;
}

export async function verifyCasperNativeTransfer(input: CasperNativeTransferVerificationInput): Promise<CasperNativeTransferVerificationResult> {
  const transactionHash = input.transactionHash.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(transactionHash)) {
    return { ok: false, status: "Failed", reason: "paymentTxHash must be a 64-character Casper transaction/deploy hash" };
  }

  const expectedMinimum = BigInt(input.expectedMinimumMotes);
  const expectedSender = publicKeyHexToAccountHash(input.expectedSenderPublicKey);
  const expectedRecipient = input.expectedRecipientPublicKey
    ? publicKeyHexToAccountHash(input.expectedRecipientPublicKey)
    : undefined;

  if (process.env.CASPER_SUBSCRIBE_SKIP_PAYMENT_VERIFY === "true") {
    return {
      ok: true,
      status: "Skipped",
      reason: "CASPER_SUBSCRIBE_SKIP_PAYMENT_VERIFY=true",
      observedSender: expectedSender,
      observedRecipient: expectedRecipient,
    };
  }

  const rpc = getCasperRpcClient();
  let result: unknown;
  let lastError = "";

  try {
    result = await rpc.getTransactionByTransactionHash(transactionHash);
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Transaction hash lookup failed";
    try {
      result = await rpc.getTransactionByDeployHash(transactionHash);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "Deploy hash lookup failed";
      // Final fallback: direct RPC call using { Version1: hash } format (Casper 2.0 TransactionV1)
      try {
        const rpcUrls = getCasperRpcUrls();
        for (const rpcUrl of rpcUrls) {
          const resp = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: 1,
              method: "info_get_transaction",
              params: { transaction_hash: { Version1: transactionHash } },
            }),
            signal: AbortSignal.timeout(8_000),
          });
          const payload = await resp.json() as { result?: unknown; error?: { message?: string; data?: unknown } };
          if (payload.error) continue;
          if (payload.result) { result = payload.result; break; }
        }
      } catch { /* ignore — fall through to Pending */ }

      if (!result) {
        const lookupMessage = `${lastError} ${fallbackMessage}`;
        const isRetryableLookup = /not found|no such|does not exist|missing|network error|fetch|http request|timeout|timed out|ENOTFOUND|ECONNRESET|EAI_AGAIN|413|payload too large/i.test(lookupMessage);
        return {
          ok: false,
          status: isRetryableLookup ? "Pending" : "Failed",
          reason: `Casper payment transaction is not finalized or RPC lookup is unavailable yet: ${fallbackMessage}`,
        };
      }
    }
  }

  const executionResult = getExecutionResult(result);
  if (!executionResult) {
    return {
      ok: false,
      status: "Pending",
      reason: "Casper payment transaction found, but execution result is not finalized yet",
    };
  }

  const failureMessage = findFailureMessage(executionResult);
  if (failureMessage) {
    return { ok: false, status: "Failed", reason: `Casper payment transaction failed: ${failureMessage}` };
  }

  const sources = transactionJsonSources(result);
  const amountCandidates = collectTransferAmountCandidates(executionResult, sources);
  const observedAmount = amountCandidates[0];
  if (observedAmount === undefined) {
    return { ok: false, status: "Failed", reason: "Could not parse native CSPR transfer amount from Casper transaction" };
  }
  if (observedAmount < expectedMinimum) {
    return {
      ok: false,
      status: "Failed",
      reason: `CSPR payment amount ${observedAmount.toString()} motes is below expected ${expectedMinimum.toString()} motes`,
      observedAmountMotes: observedAmount.toString(),
    };
  }

  const senderCandidates = collectAccountHashes(executionResult, sources, ["from", "account", "initiator", "initiatorAddr", "initiator_addr"]);
  const observedSender = senderCandidates.find((candidate) => candidate === expectedSender) ?? senderCandidates[0];
  if (!senderCandidates.includes(expectedSender)) {
    return {
      ok: false,
      status: "Failed",
      reason: "Casper payment sender does not match the subscribing investor wallet",
      observedAmountMotes: observedAmount.toString(),
      observedSender,
    };
  }

  const recipientCandidates = collectAccountHashes(executionResult, sources, ["to", "target", "recipient"]);
  const observedRecipient = expectedRecipient && recipientCandidates.includes(expectedRecipient)
    ? expectedRecipient
    : recipientCandidates[0];
  if (expectedRecipient && recipientCandidates.length > 0 && !recipientCandidates.includes(expectedRecipient)) {
    return {
      ok: false,
      status: "Failed",
      reason: "Casper payment recipient does not match the configured treasury wallet",
      observedAmountMotes: observedAmount.toString(),
      observedSender,
      observedRecipient,
    };
  }

  const transferIds = collectTransferIds(executionResult, sources);
  const observedTransferId = input.expectedTransferId !== undefined && transferIds.includes(input.expectedTransferId)
    ? input.expectedTransferId
    : transferIds[0];
  if (input.expectedTransferId !== undefined && transferIds.length > 0 && !transferIds.includes(input.expectedTransferId)) {
    return {
      ok: false,
      status: "Failed",
      reason: "Casper payment transfer id does not match the subscription reference",
      observedAmountMotes: observedAmount.toString(),
      observedSender,
      observedRecipient,
      observedTransferId,
    };
  }

  return {
    ok: true,
    status: "Confirmed",
    observedAmountMotes: observedAmount.toString(),
    observedSender,
    observedRecipient,
    observedTransferId,
  };
}

interface HashCandidate {
  normalized: string;
  score: number;
}

