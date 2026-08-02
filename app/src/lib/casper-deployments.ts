import fs from "fs";
import path from "path";
import { KeyAlgorithm, PrivateKey } from "casper-js-sdk";
import { getCasperRpcUrls, makeAssetIdCasper } from "./casper-chain";

const DATA_FILE = path.join(process.cwd(), "data", "deployments.json");

export interface CasperContractDeploymentRecord {
  txHash?: string;
  deployHash?: string;
  registrationId?: string;
  assetId?: string;
  assetName?: string;
  symbol?: string;
  contractHash?: string;
  contractAddress?: string;
  blockNumber?: number | null;
  network?: string;
  deployedAt?: string;
  standard?: string;
  gasUsed?: number | null;
  explorerUrl?: string;
  status?: string;
  pendingReason?: string;
  deployerPublicKey?: string;
  /** The real odra_cfg_package_hash_key_name used at install time (includes a random
   *  uniqueness suffix — see generatePackageKeySuffix() in casper-token-deploy.ts).
   *  Reconciliation MUST use this exact name when present; it cannot be re-derived
   *  from assetId alone. */
  packageKeyName?: string;
  /** Odra contract version tag ("v1" initial install, "v2"+ after an in-place
   *  upgrade via odra_cfg_is_upgrade=true). Used to show a Track-4 "contract is
   *  upgradable" badge in the UI. */
  contractVersion?: string;
  isUpgradable?: boolean;
}

export interface CasperDeploymentRecord extends CasperContractDeploymentRecord {
  identityRegistry?: CasperContractDeploymentRecord;
}

type DeployResultPayload = {
  result?: {
    deploy?: {
      header?: {
        account?: string;
      };
    };
    // Casper 1.x shape
    execution_results?: Array<{
      result?: {
        Failure?: { error_message?: string };
        Success?: { effect?: { transforms?: Array<{ key?: string; transform?: unknown }> } };
      };
    }>;
    // Casper 2.x shape
    execution_info?: {
      execution_result?: {
        Version1?: { error_message?: string | null; effects?: Array<{ key?: string; kind?: unknown }> };
        Version2?: { error_message?: string | null; effects?: Array<{ key?: string; kind?: unknown }> };
      };
    };
  };
};

type AccountInfoPayload = {
  result?: {
    account?: {
      named_keys?: Array<{ name?: string; key?: string }>;
    };
  };
};

function readRawDeployments(): Record<string, CasperDeploymentRecord> {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, CasperDeploymentRecord>;
  } catch {
    return {};
  }
}

export function writeDeployments(data: Record<string, CasperDeploymentRecord>) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function isCasperTokenCouponDeployment(deployment: CasperContractDeploymentRecord) {
  return (deployment.network ?? "").toLowerCase().includes("casper")
    && (deployment.standard ?? "").toLowerCase().includes("casper token/coupon wasm");
}

function isCasperIdentityRegistryDeployment(deployment: CasperContractDeploymentRecord) {
  return (deployment.network ?? "").toLowerCase().includes("casper")
    && (deployment.standard ?? "").toLowerCase().includes("casper identity registry wasm");
}

function normalizeContractHash(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^contract-[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  const match = trimmed.match(/^hash-([0-9a-f]{64})$/i);
  if (match) return `contract-${match[1].toLowerCase()}`;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return `contract-${trimmed.toLowerCase()}`;
  return undefined;
}

function getOraclePublicKey(): string | undefined {
  const explicit = process.env.CASPER_ORACLE_PUBLIC_KEY?.trim();
  if (explicit) return explicit;
  const privateKeyHex = process.env.CASPER_ORACLE_KEY?.trim();
  if (!privateKeyHex) return undefined;
  try {
    return PrivateKey.fromHex(privateKeyHex, KeyAlgorithm.ED25519).publicKey.toHex();
  } catch {
    return undefined;
  }
}

async function rpcCall<T>(method: string, params: Record<string, unknown>) {
  const rpcUrls = getCasperRpcUrls();
  let lastError: string | undefined;
  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(4_000),
      });
      const payload = await response.json() as T & { error?: { message?: string } };
      if (!(payload as { error?: { message?: string } }).error) return payload;
      lastError = (payload as { error?: { message?: string } }).error?.message ?? lastError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError ?? `RPC call failed: ${method}`);
}

/**
 * Extracts the on-chain contract hash directly from a deploy's own execution effects.
 * This is the ONLY reliable way to reconcile a Submitted TokenCoupon deploy retroactively:
 * unlike named-key lookups (fetchNamedKeyContractHash), it doesn't depend on knowing the
 * exact odra_cfg_package_hash_key_name used at install time (which includes a random
 * uniqueness suffix that isn't always recorded), and it works even if the account's named
 * keys were later overwritten/removed. Odra contracts write a "EVENTS" message topic under
 * their own AddressableEntity key at install time, which Casper 2.x nodes report as an
 * effect keyed "...entity-contract-<64 hex>..." — that hex IS the contract hash.
 */
function extractContractHashFromEffects(effects: Array<{ key?: string }> | undefined): string | undefined {
  if (!Array.isArray(effects)) return undefined;
  for (const effect of effects) {
    const match = /entity-contract-([0-9a-fA-F]{64})/.exec(effect.key ?? "");
    if (match) return `contract-${match[1].toLowerCase()}`;
  }
  // Legacy Casper 1.x shape: a Contract value written directly under a "hash-<hex>" key.
  for (const effect of effects) {
    const match = /^hash-([0-9a-fA-F]{64})$/.exec(effect.key ?? "");
    if (match) return `contract-${match[1].toLowerCase()}`;
  }
  return undefined;
}

async function fetchDeployMetadata(deployHash: string) {
  try {
    const payload = await rpcCall<DeployResultPayload>("info_get_deploy", { deploy_hash: deployHash, finalized_approvals: true });
    const v1Result = payload.result?.execution_results?.[0]?.result;
    const v2Result = payload.result?.execution_info?.execution_result?.Version2
      ?? payload.result?.execution_info?.execution_result?.Version1;

    const failureMessage = v1Result?.Failure?.error_message ?? v2Result?.error_message ?? undefined;
    const contractHash = v1Result?.Success?.effect?.transforms
      ? extractContractHashFromEffects(v1Result.Success.effect.transforms as Array<{ key?: string }>)
      : extractContractHashFromEffects(v2Result?.effects as Array<{ key?: string }> | undefined);

    return {
      account: payload.result?.deploy?.header?.account,
      failureMessage,
      contractHash,
    };
  } catch {
    return { account: undefined, failureMessage: undefined, contractHash: undefined };
  }
}

async function fetchNamedKeyContractHash(publicKey: string, namedKeyName: string) {
  try {
    const payload = await rpcCall<AccountInfoPayload>("state_get_account_info", { public_key: publicKey });
    const expectedName = namedKeyName.trim().toLowerCase();
    const namedKeys = payload.result?.account?.named_keys ?? [];
    const match = namedKeys.find((entry) => entry.name?.trim().toLowerCase() === expectedName);
    return normalizeContractHash(match?.key);
  } catch {
    return undefined;
  }
}

function makeNamedKeyName(prefix: "token_coupon" | "identity_registry", assetId: string) {
  return `${prefix}_${makeAssetIdCasper(assetId).toLowerCase()}`;
}

async function reconcileContractDeployment(
  deployment: CasperContractDeploymentRecord,
  kind: "tokenCoupon" | "identityRegistry",
) {
  const isSupported = kind === "tokenCoupon"
    ? isCasperTokenCouponDeployment(deployment)
    : isCasperIdentityRegistryDeployment(deployment);
  if (!isSupported) return deployment;

  const normalizedExistingHash = normalizeContractHash(deployment.contractHash);
  if (normalizedExistingHash && deployment.status === "Deployed") {
    return normalizedExistingHash === deployment.contractHash ? deployment : {
      ...deployment,
      contractHash: normalizedExistingHash,
      contractAddress: deployment.contractAddress ?? normalizedExistingHash,
    };
  }

  const next: CasperDeploymentRecord = { ...deployment };
  if (normalizedExistingHash) {
    next.contractHash = normalizedExistingHash;
    next.contractAddress = next.contractAddress ?? normalizedExistingHash;
    next.status = "Deployed";
    delete next.pendingReason;
    return next;
  }

  const deployHash = deployment.deployHash ?? deployment.txHash ?? deployment.registrationId;
  const deployMeta = deployHash
    ? await fetchDeployMetadata(deployHash)
    : { account: undefined, failureMessage: undefined, contractHash: undefined };

  if (!next.deployerPublicKey && deployMeta.account) {
    next.deployerPublicKey = deployMeta.account;
  }

  // Primary path: read the contract hash directly out of the deploy's own execution effects.
  // This works retroactively for ANY already-broadcast deploy (no dependency on named keys or
  // on packageKeyName having been recorded), so it fixes already-stuck "Submitted" records too.
  if (deployMeta.contractHash) {
    next.contractHash = deployMeta.contractHash;
    next.contractAddress = next.contractAddress ?? deployMeta.contractHash;
    next.status = "Deployed";
    delete next.pendingReason;
    return next;
  }

  const candidatePublicKeys = [
    deployment.deployerPublicKey,
    deployMeta.account,
    getOraclePublicKey(),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  const assetId = deployment.assetId ?? (deployment.assetName ? makeAssetIdCasper(deployment.assetName) : undefined);
  // Prefer the real named key captured at install time (it includes a random uniqueness
  // suffix — see generatePackageKeySuffix() in casper-token-deploy.ts). Falling back to the
  // guessed "prefix_assetId" name only supports older records saved before this field existed;
  // that guess will never match a freshly-installed contract's actual named key.
  const namedKeyCandidates = [
    deployment.packageKeyName,
    assetId ? (kind === "tokenCoupon" ? makeNamedKeyName("token_coupon", assetId) : makeNamedKeyName("identity_registry", assetId)) : undefined,
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  for (const namedKeyName of namedKeyCandidates) {
    for (const publicKey of candidatePublicKeys) {
      const contractHash = await fetchNamedKeyContractHash(publicKey, namedKeyName);
      if (contractHash) {
        next.contractHash = contractHash;
        next.contractAddress = next.contractAddress ?? contractHash;
        next.status = "Deployed";
        delete next.pendingReason;
        return next;
      }
    }
  }

  if (deployMeta.failureMessage) {
    next.status = "Failed";
    next.pendingReason = deployMeta.failureMessage;
  }

  return next;
}

async function reconcileDeployment(deployment: CasperDeploymentRecord) {
  const tokenDeployment = await reconcileContractDeployment(deployment, "tokenCoupon");

  if (!deployment.identityRegistry) {
    return tokenDeployment;
  }

  const identityRegistry = await reconcileContractDeployment(deployment.identityRegistry, "identityRegistry");
  if (JSON.stringify(identityRegistry) === JSON.stringify(deployment.identityRegistry)) {
    return tokenDeployment;
  }

  return {
    ...tokenDeployment,
    identityRegistry,
  };
}

function isStableContractDeployment(deployment: CasperContractDeploymentRecord | undefined) {
  if (!deployment) return true;
  const normalizedHash = normalizeContractHash(deployment.contractHash);
  return Boolean(normalizedHash && deployment.status === "Deployed");
}

function isStableDeployment(deployment: CasperDeploymentRecord) {
  return isStableContractDeployment(deployment)
    && isStableContractDeployment(deployment.identityRegistry);
}

// Reconciling an unresolved deployment means hitting the Casper RPC (with an 8s timeout
// per fallback node) up to several times. Every API route that reads deployments
// (tokenize/deployments, kyc/config, subscribe, ...) calls this function, and pages poll
// those routes frequently — without a cooldown, a single still-pending deployment causes
// every request across the whole app to block for 20-30+ seconds while RPC nodes are
// slow/unreachable. Cap retries to once per cooldown window per deployment id instead.
const RECONCILE_COOLDOWN_MS = 60_000;
const lastReconcileAttemptAt = new Map<string, number>();

export async function readDeploymentsWithReconciliation() {
  const current = readRawDeployments();
  let changed = false;
  const now = Date.now();
  const nextEntries = await Promise.all(Object.entries(current).map(async ([id, deployment]) => {
    if (isStableDeployment(deployment)) {
      return [id, deployment] as const;
    }

    const lastAttempt = lastReconcileAttemptAt.get(id);
    if (lastAttempt && now - lastAttempt < RECONCILE_COOLDOWN_MS) {
      // Recently attempted and still unresolved; skip the slow RPC round-trip this time.
      return [id, deployment] as const;
    }

    lastReconcileAttemptAt.set(id, now);
    const reconciled = await reconcileDeployment(deployment);
    const hasChanged = JSON.stringify(reconciled) !== JSON.stringify(deployment);
    if (hasChanged) changed = true;
    return [id, reconciled] as const;
  }));
  const reconciled = Object.fromEntries(nextEntries);
  if (changed) writeDeployments(reconciled);
  return reconciled;
}