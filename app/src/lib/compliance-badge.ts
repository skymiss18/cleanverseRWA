import fs from "fs";
import path from "path";

type DeploymentRecord = {
  assetId?: string;
  assetName?: string;
  symbol?: string;
  network?: string;
  status?: string;
  contractHash?: string;
  explorerUrl?: string;
  deployedAt?: string;
  identityRegistry?: {
    contractHash?: string;
    contractVersion?: string;
    isUpgradable?: boolean;
  };
};

type KycRecord = {
  status?: string;
  monitoringStatus?: string | null;
  kycExpiry?: number | null;
  credentialCommitment?: string | null;
  agentActionLog?: Array<{ ts: string; mode: "manual" | "auto" | "cron" }>;
};

export interface ComplianceBadgeCredentialStats {
  active: number;
  revoked: number;
  expired: number;
  notIssued: number;
}

export interface ComplianceBadgeData {
  assetId: string;
  found: boolean;
  assetName?: string;
  symbol?: string;
  network?: string;
  status?: string;
  contractHash?: string;
  explorerUrl?: string;
  deployedAt?: string;
  identityRegistry?: {
    contractHash?: string;
    contractVersion?: string;
    isUpgradable?: boolean;
  };
  /** Program-level aggregate credential counts. Intentionally does not expose
   *  per-investor risk band or any other field that could leak an individual
   *  risk profile — keeps the on-chain/off-chain data boundary intact. */
  credentialStats: ComplianceBadgeCredentialStats;
  lastMonitoredAt: string | null;
  generatedAt: string;
}

function readJson<T>(fileName: string, fallback: T): T {
  try {
    const filePath = path.join(process.cwd(), "data", fileName);
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function computeCredentialStats(kycApps: KycRecord[]): ComplianceBadgeCredentialStats {
  const nowSec = Math.floor(Date.now() / 1000);
  return kycApps.reduce<ComplianceBadgeCredentialStats>(
    (acc, row) => {
      const monitoring = (row.monitoringStatus ?? "").toLowerCase();
      if (row.status === "rejected" || monitoring.includes("revoke")) {
        acc.revoked += 1;
      } else if (typeof row.kycExpiry === "number" && row.kycExpiry > 0 && row.kycExpiry <= nowSec) {
        acc.expired += 1;
      } else if (row.status === "approved" && row.credentialCommitment) {
        acc.active += 1;
      } else {
        acc.notIssued += 1;
      }
      return acc;
    },
    { active: 0, revoked: 0, expired: 0, notIssued: 0 },
  );
}

function computeLastMonitoredAt(kycApps: KycRecord[]): string | null {
  let lastMonitoredAt: string | null = null;
  for (const row of kycApps) {
    const log = row.agentActionLog;
    if (!Array.isArray(log) || log.length === 0) continue;
    const ts = log[log.length - 1]?.ts;
    if (ts && (!lastMonitoredAt || ts > lastMonitoredAt)) {
      lastMonitoredAt = ts;
    }
  }
  return lastMonitoredAt;
}

/**
 * Aggregates a public, embeddable "compliance badge" view for a given asset
 * deployment. Only surfaces fields safe for public disclosure (contract
 * identity/version, aggregate credential counts, monitoring recency) — never
 * per-investor PII or risk-band detail.
 */
export function getComplianceBadgeData(assetId: string): ComplianceBadgeData {
  const deployments = readJson<Record<string, DeploymentRecord>>("deployments.json", {});
  const kycApps = readJson<KycRecord[]>("kyc-inbox.json", []);

  const credentialStats = computeCredentialStats(kycApps);
  const lastMonitoredAt = computeLastMonitoredAt(kycApps);
  const generatedAt = new Date().toISOString();

  const entry = Object.entries(deployments).find(
    ([id, record]) => id === assetId || (record.assetId ?? "").toLowerCase() === assetId.toLowerCase(),
  );

  if (!entry) {
    return { assetId, found: false, credentialStats, lastMonitoredAt, generatedAt };
  }

  const [id, record] = entry;
  return {
    assetId: id,
    found: true,
    assetName: record.assetName,
    symbol: record.symbol,
    network: record.network,
    status: record.status,
    contractHash: record.contractHash,
    explorerUrl: record.explorerUrl,
    deployedAt: record.deployedAt,
    identityRegistry: record.identityRegistry
      ? {
          contractHash: record.identityRegistry.contractHash,
          contractVersion: record.identityRegistry.contractVersion,
          isUpgradable: record.identityRegistry.isUpgradable,
        }
      : undefined,
    credentialStats,
    lastMonitoredAt,
    generatedAt,
  };
}
