import fs from "fs";
import path from "path";
import ContractVersionBadge from "@/components/ContractVersionBadge";
import DataBoundaryPanel from "@/components/DataBoundaryPanel";

export const dynamic = "force-dynamic";

type DeploymentRecord = {
  deployHash?: string;
  txHash?: string;
  assetName?: string;
  contractHash?: string;
  explorerUrl?: string;
  status?: string;
  network?: string;
  identityRegistry?: {
    contractHash?: string;
    contractVersion?: string;
    isUpgradable?: boolean;
  };
};

type KycRecord = {
  id: string;
  fullName?: string;
  walletAddress?: string;
  status?: string;
  aiScore?: number | null;
  riskBand?: number | null;
  monitoringStatus?: string | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  proofVerified?: boolean | null;
  executionMode?: "manual" | "auto" | null;
  txHash?: string | null;
  explorerUrl?: string | null;
  lastScreenedAt?: string | null;
  kycExpiry?: number | null;
  agentReason?: string | null;
  agentActionLog?: Array<{ ts: string; action: string; mode: "manual" | "auto" | "cron"; reason: string }>;
};

type SubscriptionRecord = {
  assetName?: string;
  investorPublicKey?: string;
  mintStatus?: string;
  paymentTxHash?: string;
  mintTxHash?: string;
  createdAt?: string;
};

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

function shortHash(value: string | null | undefined) {
  if (!value) return "-";
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function explorerForDeploy(hash: string | null | undefined) {
  if (!hash) return null;
  return `https://testnet.cspr.live/deploy/${hash}`;
}

function countMatches(filePath: string, pattern: RegExp): number {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, "utf-8");
    return (content.match(pattern) ?? []).length;
  } catch {
    return 0;
  }
}

/** Counts real test cases directly from source at request time (not a
 *  hardcoded number) so the Verification Ledger never goes stale. */
function computeVerificationLedger() {
  const root = process.cwd();
  const rustCrates = ["identity-registry", "compliance-oracle", "token-coupon"];
  const rustTests = rustCrates.reduce(
    (sum, crateName) => sum + countMatches(path.join(root, "contracts-casper", crateName, "src", "lib.rs"), /#\[test\]/g),
    0,
  );
  const e2eTests = countMatches(path.join(root, "test", "agent-kyc-e2e.test.ts"), /^test\(/gm);
  return { rustTests, e2eTests, totalTests: rustTests + e2eTests };
}

export default async function EvidencePage() {
  const deployments = readJson<Record<string, DeploymentRecord>>("deployments.json", {});
  const kycApps = readJson<KycRecord[]>("kyc-inbox.json", []);
  const subscriptions = readJson<SubscriptionRecord[]>("subscriptions.json", []);

  const deploymentRows = Object.entries(deployments)
    .map(([id, record]) => ({ id, ...record }))
    .filter((record) => (record.network ?? "").toLowerCase().includes("ethereum") || (record.network ?? "").toLowerCase().includes("sepolia"))
    .slice(0, 8);

  const latestKyc = [...kycApps]
    .sort((a, b) => {
      const left = Date.parse(a.lastScreenedAt ?? "") || 0;
      const right = Date.parse(b.lastScreenedAt ?? "") || 0;
      return right - left;
    })
    .slice(0, 8);

  const latestSubs = [...subscriptions]
    .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0))
    .slice(0, 8);

  const nowSec = Math.floor(Date.now() / 1000);
  const credentialStats = kycApps.reduce(
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
    { active: 0, revoked: 0, expired: 0, notIssued: 0 }
  );

  const identityRegistryEntry = Object.values(deployments).find((row) => row.identityRegistry?.contractVersion);
  const verificationLedger = computeVerificationLedger();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="rounded-2xl p-5 sm:p-6" style={{ background: "linear-gradient(135deg, rgba(29,78,216,0.10), rgba(14,165,233,0.08))", border: "1px solid rgba(29,78,216,0.22)" }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-700">Track-4 Proof Board</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 mt-1">Judge Evidence Center</h1>
        <p className="text-sm text-slate-700 mt-2 max-w-3xl leading-relaxed">
          Live evidence of AI-driven compliance: off-chain document screening, zero-knowledge credential commitment issuance,
          autonomous lifecycle monitoring, and upgradeable smart contract governance.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-[11px]">
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">1</div>
            <div className="font-semibold text-slate-800">AI verification</div>
          </div>
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">2</div>
            <div className="font-semibold text-slate-800">ZK commitment</div>
          </div>
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">3</div>
            <div className="font-semibold text-slate-800">Autonomous actions</div>
          </div>
          <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">4</div>
            <div className="font-semibold text-slate-800">Upgradeable registry</div>
          </div>
        </div>
      </div>

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Compliance Credential Overview</h2>
          <ContractVersionBadge version={identityRegistryEntry?.identityRegistry?.contractVersion} isUpgradable={identityRegistryEntry?.identityRegistry?.isUpgradable} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg p-3" style={{ background: "rgba(22,163,74,0.05)", border: "1px solid rgba(22,163,74,0.15)" }}>
            <div className="text-slate-500">Active</div>
            <div className="text-lg font-bold text-emerald-700">{credentialStats.active}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <div className="text-slate-500">Revoked</div>
            <div className="text-lg font-bold text-red-700">{credentialStats.revoked}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <div className="text-slate-500">Expired</div>
            <div className="text-lg font-bold text-amber-700">{credentialStats.expired}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(100,116,139,0.05)", border: "1px solid rgba(100,116,139,0.15)" }}>
            <div className="text-slate-500">Not Issued</div>
            <div className="text-lg font-bold text-slate-600">{credentialStats.notIssued}</div>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">
          Each active credential is soulbound (non-transferable) and currently backed by the IdentityRegistry contract shown above.
        </p>
      </section>

      <DataBoundaryPanel defaultOpen />

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">Verification Ledger</h2>
        <p className="text-xs text-slate-500 mb-3">
          Quantified, checkable evidence — not just a demo. Counts are read live from source/test files, contract
          hashes and transaction hashes below resolve on the Sepolia testnet explorer.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg p-3" style={{ background: "rgba(29,78,216,0.05)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">Odra Contract Unit Tests</div>
            <div className="text-lg font-bold text-blue-700">{verificationLedger.rustTests}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(29,78,216,0.05)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">Agent/KYC E2E Tests</div>
            <div className="text-lg font-bold text-blue-700">{verificationLedger.e2eTests}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(29,78,216,0.05)", border: "1px solid rgba(29,78,216,0.15)" }}>
            <div className="text-slate-500">Total Automated Tests</div>
            <div className="text-lg font-bold text-blue-700">{verificationLedger.totalTests}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(100,116,139,0.05)", border: "1px solid rgba(100,116,139,0.15)" }}>
            <div className="text-slate-500">Live Smart Contract Deployments</div>
            <div className="text-lg font-bold text-slate-700">{deploymentRows.length}</div>
          </div>
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">Contract Deployments</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                <th className="text-left py-2 pr-3">ID</th>
                <th className="text-left py-2 pr-3">Asset</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Contract</th>
                <th className="text-left py-2 pr-3">Deploy</th>
                <th className="text-left py-2 pr-3">Badge</th>
              </tr>
            </thead>
            <tbody>
              {deploymentRows.map((row) => {
                const hash = row.deployHash ?? row.txHash ?? "";
                const explorer = row.explorerUrl ?? explorerForDeploy(hash);
                return (
                  <tr key={row.id} className="border-b" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                    <td className="py-2 pr-3 font-mono text-blue-700">{row.id}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.assetName ?? "-"}</td>
                    <td className="py-2 pr-3 text-slate-700">{row.status ?? "-"}</td>
                    <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.contractHash)}</td>
                    <td className="py-2 pr-3">
                      {explorer ? (
                        <a className="text-blue-600 hover:underline" href={explorer} target="_blank" rel="noreferrer">
                          {shortHash(hash)}
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <a className="text-blue-600 hover:underline" href={`/badge/${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer">
                        Public badge
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">Compliance Credential Lifecycle (Privacy Preserving)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                <th className="text-left py-2 pr-3">Application</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Risk</th>
                <th className="text-left py-2 pr-3">Scheme</th>
                <th className="text-left py-2 pr-3">Commitment</th>
                <th className="text-left py-2 pr-3">Proof</th>
                <th className="text-left py-2 pr-3">Verified</th>
                <th className="text-left py-2 pr-3">Mode</th>
                <th className="text-left py-2 pr-3">Chain Tx</th>
              </tr>
            </thead>
            <tbody>
              {latestKyc.map((row) => {
                const latestLog = row.agentActionLog?.[row.agentActionLog.length - 1];
                return (
                <tr key={row.id} className="border-b" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                  <td className="py-2 pr-3">
                    <div className="font-mono text-blue-700">{row.id}</div>
                    <div className="text-slate-500">{row.fullName ?? "-"}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{row.monitoringStatus ?? row.status ?? "-"}</td>
                  <td className="py-2 pr-3 text-slate-700">{row.riskBand ? `Band ${row.riskBand}` : "-"}</td>
                  <td className="py-2 pr-3 text-slate-700">{row.zkProofScheme ?? "legacy"}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.credentialCommitment)}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.proofHash)}</td>
                  <td className="py-2 pr-3 text-slate-700">{typeof row.proofVerified === "boolean" ? (row.proofVerified ? "Yes" : "No") : "-"}</td>
                  <td className="py-2 pr-3 text-slate-700">{latestLog ? latestLog.mode : (row.executionMode ?? "manual")}</td>
                  <td className="py-2 pr-3">
                    {row.explorerUrl || row.txHash ? (
                      <a
                        className="text-blue-600 hover:underline"
                        href={row.explorerUrl ?? explorerForDeploy(row.txHash ?? "") ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortHash(row.txHash)}
                      </a>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">What the ZK Proof Proves — and Does NOT Prove</h2>
        <div className="grid sm:grid-cols-2 gap-4 text-xs">
          <div className="rounded-lg p-3" style={{ background: "rgba(22,163,74,0.05)", border: "1px solid rgba(22,163,74,0.15)" }}>
            <div className="font-semibold text-emerald-700 mb-1.5">Proves</div>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>The wallet holds a valid, non-expired eligibility credential (eligible flag + risk band under policy threshold)</li>
              <li>The commitment/nullifier binds to this specific wallet + issuer domain without revealing raw identity fields</li>
              <li>The proof verifies against the published circuit id / verification key shown per row above</li>
            </ul>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <div className="font-semibold text-red-700 mb-1.5">Does NOT prove</div>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>That the underlying government ID / address proof is authentic — that determination is made off-chain by the AI screening + human review step, not by the circuit</li>
              <li>Anything about a specific regulator&apos;s ability to decrypt underlying attributes — no enforced disclosure-to-regulator path exists yet (tracked as a future enhancement)</li>
              <li>Production-grade trusted setup — current Groth16 artifacts (when enabled via <code>ZK_PROVIDER_MODE=groth16</code>) use a single-party local ceremony for demo purposes only, not a public multi-party Powers-of-Tau ceremony</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 mb-3">Subscription & Mint Outcomes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
                <th className="text-left py-2 pr-3">Asset</th>
                <th className="text-left py-2 pr-3">Investor</th>
                <th className="text-left py-2 pr-3">Mint Status</th>
                <th className="text-left py-2 pr-3">Payment Tx</th>
                <th className="text-left py-2 pr-3">Mint Tx</th>
              </tr>
            </thead>
            <tbody>
              {latestSubs.map((row, idx) => (
                <tr key={`${row.assetName ?? "asset"}-${idx}`} className="border-b" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                  <td className="py-2 pr-3 text-slate-700">{row.assetName ?? "-"}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.investorPublicKey)}</td>
                  <td className="py-2 pr-3 text-slate-700">{row.mintStatus ?? "-"}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.paymentTxHash)}</td>
                  <td className="py-2 pr-3 font-mono text-slate-700">{shortHash(row.mintTxHash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
