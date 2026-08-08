import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "data", "kyc-inbox.json");

export interface AgentActionLogEntry {
  ts: string;
  action: string;
  mode: "manual" | "auto" | "cron";
  reason: string;
}

export type KycApplicationRecord = Record<string, unknown> & {
  id: string;
  walletAddress?: string;
  jurisdiction?: string;
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
  zkVerificationKeyId?: string | null;
  proofVerified?: boolean | null;
  zkVerifiedAt?: string | null;
  zkRevocationReason?: string | null;
  executionMode?: "manual" | "auto" | null;
  monitoringStatus?: string | null;
  lastScreenedAt?: string | null;
  agentReason?: string | null;
  agentActionLog?: AgentActionLogEntry[];
};

export function readKycApplications(): KycApplicationRecord[] {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as KycApplicationRecord[];
  } catch {
    return [];
  }
}

export function writeKycApplications(applications: KycApplicationRecord[]) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(applications, null, 2), "utf-8");
}

export function upsertKycApplication(id: string, patch: Record<string, unknown>) {
  const applications = readKycApplications();
  const index = applications.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  applications[index] = { ...applications[index], ...patch };
  writeKycApplications(applications);
  return applications[index];
}

/** Appends an entry to a KYC record's autonomous-agent action timeline (most
 *  recent 20 kept). Used so the UI can show a real "who/when/why" history of
 *  manual, auto-execute, and cron-triggered compliance decisions instead of
 *  just the latest status. */
export function appendAgentActionLog(
  id: string,
  entry: { action: string; mode: "manual" | "auto" | "cron"; reason: string },
) {
  const applications = readKycApplications();
  const index = applications.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const existingLog = Array.isArray(applications[index].agentActionLog)
    ? (applications[index].agentActionLog as AgentActionLogEntry[])
    : [];
  const nextLog = [
    ...existingLog,
    { ts: new Date().toISOString(), action: entry.action, mode: entry.mode, reason: entry.reason },
  ].slice(-20);
  applications[index] = { ...applications[index], agentActionLog: nextLog };
  writeKycApplications(applications);
  return applications[index];
}
