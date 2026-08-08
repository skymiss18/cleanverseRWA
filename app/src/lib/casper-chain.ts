/**
 * casper-chain.ts
 *
 * Casper Network integration layer — mirrors the legacy EVM helper shape for Casper.
 *
 * Architecture:
 *  - submitScoreCasper()  → called from API route, signs with CASPER_ORACLE_KEY env var
 *  - getScoreCasper()     → called server-side; queries CSPR.cloud REST API
 *  - makeAssetIdCasper()  → deterministic asset identifier (blake2-compatible string)
 *
 * Environment variables needed:
 *   CASPER_ORACLE_KEY          — hex private key (ed25519, no 0x prefix)
 *   CASPER_ORACLE_PUBLIC_KEY   — hex public key matching CASPER_ORACLE_KEY
 *   CASPER_COMPLIANCE_ORACLE_HASH — deployed contract hash, e.g. "contract-abcdef1234..."
 *   CASPER_CHAIN_NAME          — "casper-test" for Testnet (default)
 *   CASPER_RPC_URL             — optional override for RPC endpoint
 */

import {
  RpcClient,
  Deploy,
  DeployHeader,
  ExecutableDeployItem,
  StoredContractByHash,
  ContractHash,
  Args,
  NamedArg,
  HttpHandler,
  CLValue,
  PrivateKey,
  KeyAlgorithm,
  Timestamp,
} from "casper-js-sdk";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Casper Testnet RPC endpoint */
const DEFAULT_RPC = "https://rpc.testnet.casperlabs.io";

/** Casper Testnet chain name (used in deploy headers) */
const DEFAULT_CHAIN = "casper-test";

/** Default compliance threshold (mirrors Solidity contract) */
export const CASPER_COMPLIANCE_THRESHOLD = 70;

/** Gas payment amount for a simple named-key write (~50 CSPR is generous) */
const PAYMENT_MOTES = "5000000000"; // 5 CSPR expressed in motes (1 CSPR = 10^9 motes)

// ── RPC client (singleton + fallback list) ────────────────────────────────────

/** Fallback testnet nodes in priority order (used when primary RPC returns 413) */
const FALLBACK_RPCS = [
  "http://51.161.87.206:7777/rpc",
  "http://65.109.95.50:7777/rpc",
];

let _rpcClient: RpcClient | null = null;
let _rpcClientUrl: string | null = null;

export function getCasperRpcClient(): RpcClient {
  const url = process.env.CASPER_RPC_URL ?? DEFAULT_RPC;
  if (!_rpcClient || _rpcClientUrl !== url) {
    _rpcClient = new RpcClient(new HttpHandler(url));
    _rpcClientUrl = url;
  }
  return _rpcClient;
}

/** Returns an RpcClient for the given URL (not cached as singleton) */
export function getCasperRpcClientForUrl(url: string): RpcClient {
  return new RpcClient(new HttpHandler(url));
}

/** Returns all RPC URLs to try in order: primary first, then fallbacks */
export function getCasperRpcUrls(): string[] {
  const primary = process.env.CASPER_RPC_URL ?? DEFAULT_RPC;
  const extras = (process.env.CASPER_FALLBACK_RPC_URLS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const all = [primary, ...extras, ...FALLBACK_RPCS];
  // Deduplicate preserving order
  return all.filter((u, i) => all.indexOf(u) === i);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a deterministic asset-ID string from a human-readable asset name */
export function makeAssetIdCasper(assetName: string): string {
  // On Casper we use a plain string as the Mapping key (no bytes32 needed).
  // Normalise: lowercase, trim, replace spaces with underscores.
  return assetName.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Convert a hex report-hash (0x-prefixed or plain) into a 32-byte Uint8Array
 * suitable for CLValueByteArray.
 */
function reportHashToBytes(reportHashHex: string): Uint8Array {
  const hex = reportHashHex.startsWith("0x")
    ? reportHashHex.slice(2)
    : reportHashHex;
  if (hex.length !== 64) {
    throw new Error(`reportHash must be 32 bytes (64 hex chars), got ${hex.length}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Write: submit compliance score on-chain ───────────────────────────────────

/**
 * Submit an AI compliance score to the ComplianceOracle contract on Casper Testnet.
 * Called server-side (Next.js API route) using the oracle's private key.
 *
 * @param assetId   — asset identifier string (use makeAssetIdCasper)
 * @param score     — compliance score 0-100
 * @param reportHashHex — 32-byte report hash as 0x-prefixed hex string
 * @returns deploy hash (string)
 */
export async function submitScoreCasper(
  assetId: string,
  score: number,
  reportHashHex: string
): Promise<string> {
  const privateKeyHex = process.env.CASPER_ORACLE_KEY;
  const contractHashStr = process.env.CASPER_COMPLIANCE_ORACLE_HASH;
  const chainName = process.env.CASPER_CHAIN_NAME ?? DEFAULT_CHAIN;

  if (!privateKeyHex) throw new Error("CASPER_ORACLE_KEY env var not set");
  if (!contractHashStr) throw new Error("CASPER_COMPLIANCE_ORACLE_HASH env var not set");

  // Load private key (Ed25519)
  const privateKey = PrivateKey.fromHex(privateKeyHex, KeyAlgorithm.ED25519);

  // Build CLValue arguments matching the Rust entry point signature:
  //   submit_score(asset_id: String, score: u8, report_hash: [u8; 32])
  const callArgs = Args.fromNamedArgs([
    new NamedArg("asset_id", CLValue.newCLString(assetId)),
    new NamedArg("score", CLValue.newCLUint8(score)),
    new NamedArg("report_hash", CLValue.newCLByteArray(reportHashToBytes(reportHashHex))),
  ]);

  // Session: call the stored contract by its hash
  const contractHash = ContractHash.fromJSON(contractHashStr);
  const session = new ExecutableDeployItem();
  session.storedContractByHash = new StoredContractByHash(
    contractHash,
    "submit_score",
    callArgs
  );

  // Payment: standard CSPR payment
  const payment = ExecutableDeployItem.standardPayment(PAYMENT_MOTES);

  // Deploy header
  const header = DeployHeader.default();
  header.chainName = chainName;
  header.account = privateKey.publicKey;
  // Back-date by 30 s to compensate for local clock being ahead of node clock
  header.timestamp = new Timestamp(new Date(Date.now() - 30_000));

  // Build, sign, send
  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  const rpc = getCasperRpcClient();
  const result = await rpc.putDeploy(deploy);

  // putDeploy returns the deploy hash
  const deployHash = result.deployHash ?? (result as { deploy_hash?: string }).deploy_hash;
  if (!deployHash) return "";
  return typeof deployHash === "string" ? deployHash : deployHash.toHex();
}

// ── Read: get compliance score from chain ─────────────────────────────────────

export interface CasperScoreRecord {
  score: number;
  updatedAt: number;   // unix seconds
  reportHash: string;  // hex string
}

/**
 * Read the compliance score for an asset from the ComplianceOracle contract.
 * Uses CSPR.cloud REST API for reliable read access (no node required).
 *
 * Falls back to zero record if the asset has not been scored yet.
 */
export async function getScoreCasper(
  assetId: string
): Promise<CasperScoreRecord> {
  const contractHashStr = process.env.CASPER_COMPLIANCE_ORACLE_HASH;
  if (!contractHashStr) throw new Error("CASPER_COMPLIANCE_ORACLE_HASH env var not set");

  // Strip the "contract-" prefix to get the raw 64-char hex hash
  const rawHash = contractHashStr.replace(/^contract-/, "");

  // CSPR.cloud REST API — dictionary item lookup
  // Dictionary name in Odra: "scores" (matches the Mapping field name)
  const cloudBase =
    process.env.CASPER_CLOUD_URL ??
    "https://event-store-api-clarity-testnet.make.services";

  const url =
    `${cloudBase}/contract-dictionary/${rawHash}/scores/${encodeURIComponent(assetId)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Not yet scored — return zero record
      return { score: 0, updatedAt: 0, reportHash: "0x" + "0".repeat(64) };
    }
    const json = await res.json();
    // CSPR.cloud returns the CLValue as JSON; parse the struct fields
    const data = json?.data?.cl_value?.parsed ?? json?.data ?? null;
    if (!data) {
      return { score: 0, updatedAt: 0, reportHash: "0x" + "0".repeat(64) };
    }
    return {
      score: Number(data.score ?? 0),
      updatedAt: Number(data.updated_at ?? 0),
      reportHash: "0x" + (data.report_hash ?? "").replace(/^0x/, ""),
    };
  } catch {
    return { score: 0, updatedAt: 0, reportHash: "0x" + "0".repeat(64) };
  }
}

/**
 * Check whether an asset meets the compliance threshold on Casper.
 */
export async function isCompliantCasper(
  assetId: string,
  threshold = CASPER_COMPLIANCE_THRESHOLD
): Promise<boolean> {
  const record = await getScoreCasper(assetId);
  return record.score >= threshold;
}

// ── Utility: Casper explorer links ─────────────────────────────────────────────

/** TransactionV1 (created via SessionBuilder / casper-js-sdk v5) — CSPR.live indexes all txs under /deploy/ */
export function casperExplorerTransactionUrl(txHash: string): string {
  return `https://testnet.cspr.live/deploy/${txHash}`;
}

/** Legacy Deploy 1.x (created via Deploy.makeDeploy) — use /deploy/ path */
export function casperExplorerDeployUrl(deployHash: string): string {
  return `https://testnet.cspr.live/deploy/${deployHash}`;
}
