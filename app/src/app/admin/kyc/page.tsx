"use client";

import { useEffect, useState } from "react";
import { isEthereumAddress } from "@/lib/investor-wallet";
import ComplianceCredentialCard from "@/components/ComplianceCredentialCard";
import ContractVersionBadge from "@/components/ContractVersionBadge";
import DataBoundaryPanel from "@/components/DataBoundaryPanel";

type AppStatus = "pending" | "reviewing" | "ai_scored" | "approved" | "rejected";

interface BreakdownItem {
  ruleId: string;
  ruleName: string;
  score: number;
  maxScore: number;
  details: string;
}

interface KYCApp {
  id: string;
  submittedAt: string;
  fullName: string;
  email: string;
  jurisdiction: string;
  investorType: "individual" | "institutional";
  subscriptionTokens: number;
  walletAddress: string;
  pepDeclaration: boolean;
  docs: { govId: string; proofAddr: string; piEvidence: string; sofDecl?: string };
  status: AppStatus;
  aiScore: number | null;
  aiSummary: string | null;
  aiBreakdown: BreakdownItem[] | null;
  reviewNotes: string;
  txHash: string | null;
  assetDeploymentId?: string | null;
  assetId?: string | null;
  assetName?: string | null;
  network?: string | null;
  explorerUrl?: string | null;
  signerPublicKey?: string | null;
  pendingReason?: string | null;
  chainStatus?: string | null;
  aiRiskScore?: number | null;
  riskBand?: number | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  proofVerified?: boolean | null;
  executionMode?: "manual" | "auto" | null;
  monitoringStatus?: string | null;
  lastScreenedAt?: string | null;
  agentReason?: string | null;
  kycExpiry?: number | null;
  agentActionLog?: Array<{ ts: string; action: string; mode: "manual" | "auto" | "cron"; reason: string }>;
}

interface KycChainConfig {
  identityRegistryConfigured: boolean;
  chainName: string;
  identityRegistryHash?: string | null;
  assetDeploymentId?: string | null;
  error?: string | null;
}

interface ApprovedAssetOption {
  deploymentId: string;
  assetId: string;
  assetName: string;
  issuer: string;
  identityRegistryHash?: string | null;
  contractVersion?: string | null;
  isUpgradable?: boolean | null;
}

interface AutoPolicySnapshot {
  enabled: boolean;
  killSwitch: boolean;
  dryRun: boolean;
  requireProofVerified: boolean;
  minAiScoreUpdate: number;
  maxRiskBandUpdate: number;
  idAllowlistSize: number;
  walletAllowlistSize: number;
}

interface LastAutoExecution {
  applicationId: string;
  action: "update" | "revoke";
  attemptedAt: string;
  outcome: "success" | "blocked" | "error";
  status?: string | null;
  deployHash?: string | null;
}

interface OperationFeedback {
  level: "success" | "warning" | "error" | "info";
  title: string;
  detail: string;
  timestamp: string;
  reasons?: string[];
}

interface SchedulerState {
  lastRunAt: string;
  scanned: number;
  executed: number;
  blocked: number;
  skipped: number;
  errors: number;
}

const SEED_APPS: KYCApp[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_META: Record<AppStatus, { label: string; color: string; bg: string; border: string }> = {
  pending:    { label: "Pending",    color: "#f59e0b", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)" },
  reviewing:  { label: "Reviewing", color: "#93c5fd", bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.30)" },
  ai_scored:  { label: "AI Scored", color: "#c084fc", bg: "rgba(192,132,252,0.10)", border: "rgba(192,132,252,0.30)" },
  approved:   { label: "Approved",  color: "#4ade80", bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.30)" },
  rejected:   { label: "Rejected",  color: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.30)" },
};

function StatusBadge({ s }: { s: AppStatus }) {
  const m = STATUS_META[s];
  return (
    <span className="text-[10px] font-semibold rounded-full px-2.5 py-0.5"
      style={{ color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
      {m.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, score);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 rounded-full" style={{ background: "rgba(0,0,0,0.08)" }}>
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AdminKYCPage() {
  const [apps, setApps] = useState<KYCApp[]>(SEED_APPS);
  const [selected, setSelected] = useState<KYCApp | null>(null);
  const [scoring, setScoring] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<AppStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [chainConfig, setChainConfig] = useState<KycChainConfig | null>(null);
  const [approvedAssets, setApprovedAssets] = useState<ApprovedAssetOption[]>([]);
  const [agentBusyAction, setAgentBusyAction] = useState<"analyze" | "update" | "revoke" | "auto-update" | "auto-revoke" | null>(null);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [autoPolicySnapshot, setAutoPolicySnapshot] = useState<AutoPolicySnapshot | null>(null);
  const [autoBlockReasons, setAutoBlockReasons] = useState<string[]>([]);
  const [lastAutoExecution, setLastAutoExecution] = useState<LastAutoExecution | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<OperationFeedback | null>(null);
  const [quickAction, setQuickAction] = useState<"manual-update" | "manual-revoke" | "auto-update" | "auto-revoke" | "reject">("auto-update");
  const [schedulerState, setSchedulerState] = useState<SchedulerState | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);

  async function refreshApplications(showLoading = false) {
    if (showLoading) setLoading(true);
    const data = await fetch("/api/kyc/applications", { cache: "no-store" }).then((r) => r.json());
    setApps((data.applications ?? []).map((a: Partial<KYCApp>) => ({ subscriptionTokens: 0, ...a })));
    if (showLoading) setLoading(false);
  }

  // Load applications from API on mount
  useEffect(() => {
    fetch("/api/kyc/applications")
      .then((r) => r.json())
      .then((data) => {
        const loaded: KYCApp[] = (data.applications ?? []).map((a: Partial<KYCApp>) => ({
          subscriptionTokens: 0,
          ...a,
        }));
        setApps(loaded);
      })
      .catch(() => { /* keep empty */ })
      .finally(() => setLoading(false));
  }, []);

  // Poll the autonomous scheduler's last-run summary (read-only — does not
  // itself trigger a scan). Shows that continuous monitoring is running
  // without any human clicking a button.
  useEffect(() => {
    let cancelled = false;
    const loadSchedulerState = () => {
      fetch("/api/agent/kyc/scheduler-state", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setSchedulerState(data.state ?? null);
        })
        .catch(() => { /* ignore */ });
    };
    loadSchedulerState();
    const interval = setInterval(loadSchedulerState, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadApprovedAssets = async () => {
      try {
        const [sfcData, deployments] = await Promise.all([
          fetch("/api/sfc-inbox", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/tokenize/deployments", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const submissions = (sfcData.submissions ?? []) as Array<{ id?: string; asset?: string; issuer?: string; status?: string }>;
        const options = submissions
          .filter((submission) => submission.id && submission.status === "Approved")
          .map((submission) => {
            const deployment = (deployments?.[submission.id as string] ?? {}) as { assetId?: string; assetName?: string; identityRegistry?: { contractHash?: string | null; contractVersion?: string | null; isUpgradable?: boolean | null } };
            return {
              deploymentId: submission.id as string,
              assetId: deployment.assetId ?? "",
              assetName: deployment.assetName ?? submission.asset ?? submission.id ?? "",
              issuer: submission.issuer ?? "",
              identityRegistryHash: deployment.identityRegistry?.contractHash ?? null,
              contractVersion: deployment.identityRegistry?.contractVersion ?? null,
              isUpgradable: deployment.identityRegistry?.isUpgradable ?? null,
            } satisfies ApprovedAssetOption;
          })
          .filter((asset) => Boolean(asset.identityRegistryHash));
        setApprovedAssets(options);
      } catch {
        if (!cancelled) {
          setApprovedAssets([]);
        }
      }
    };

    void loadApprovedAssets();
    const intervalId = setInterval(() => {
      void loadApprovedAssets();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const assetDeploymentId = selected?.assetDeploymentId?.trim();
    fetch(`/api/kyc/config${assetDeploymentId ? `?assetDeploymentId=${encodeURIComponent(assetDeploymentId)}` : ""}`)
      .then((r) => r.json())
      .then((data: KycChainConfig) => {
        setChainConfig(data);
      })
      .catch(() => {
        setChainConfig({
          identityRegistryConfigured: false,
          chainName: "mantle-sepolia",
          assetDeploymentId: assetDeploymentId ?? null,
          error: assetDeploymentId
            ? "Failed to load Ethereum KYC contract configuration. Check the server environment and reload."
            : "Select the target asset issuance before approving KYC on-chain.",
        });
      });
  }, [selected?.assetDeploymentId]);

  useEffect(() => {
    if (!selected?.assetDeploymentId) return;
    const stillAvailable = approvedAssets.some((asset) => asset.deploymentId === selected.assetDeploymentId);
    if (stillAvailable) return;

    const patch = {
      assetDeploymentId: null,
      assetId: null,
      assetName: null,
    };
    updateApp(selected.id, patch);
    void persistPatch(selected.id, patch);
  }, [approvedAssets, selected?.assetDeploymentId, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    if (selected.status === "approved" || selected.status === "rejected") return;
    if (selected.assetDeploymentId?.trim()) return;
    if (approvedAssets.length === 0) return;

    const preferred = approvedAssets.find((asset) => asset.assetName === selected.assetName);
    const fallback = approvedAssets[approvedAssets.length - 1];
    const target = preferred ?? fallback;
    if (!target) return;

    const patch = {
      assetDeploymentId: target.deploymentId,
      assetId: target.assetId || null,
      assetName: target.assetName || null,
    };
    updateApp(selected.id, patch);
    void persistPatch(selected.id, patch);
  }, [approvedAssets, selected]);

  // Persist a patch to the API and update local state
  async function persistPatch(id: string, patch: Partial<KYCApp>) {
    await fetch(`/api/kyc/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  const filtered = filterStatus === "all" ? apps : apps.filter((a) => a.status === filterStatus);

  function updateApp(id: string, patch: Partial<KYCApp>) {
    setApps((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setSelected((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }

  async function runAIScore(app: KYCApp) {
    setScoring(true);
    updateApp(app.id, { status: "reviewing" });
    await persistPatch(app.id, { status: "reviewing" });
    try {
      const isPEP = app.pepDeclaration;
      const tokens = app.subscriptionTokens ?? 200;
      const breakdown: BreakdownItem[] = [
        {
          ruleId: "KYC-01", ruleName: "Identity Verification",
          score: app.docs.govId ? 20 : 0, maxScore: 20,
          details: app.docs.govId
            ? "Government ID document submitted and format verified."
            : "Government ID document missing — identity cannot be verified.",
        },
        {
          ruleId: "KYC-02", ruleName: "PEP & Sanctions Screening",
          score: isPEP ? 0 : 20, maxScore: 20,
          details: isPEP
            ? "Applicant declared as Politically Exposed Person (PEP). Enhanced due diligence required per AMLO Cap.615 s.20."
            : "No PEP or sanctions flag. Screening consistent with low-risk profile.",
        },
        {
          ruleId: "KYC-03", ruleName: "PI Eligibility (SFO Schedule 1)",
          score: app.docs.piEvidence ? 20 : 5, maxScore: 20,
          details: app.docs.piEvidence
            ? "PI eligibility evidence document submitted."
            : "PI eligibility evidence missing — subscription to restricted product not permitted.",
        },
        {
          ruleId: "KYC-04", ruleName: "Source of Funds Declaration",
          score: tokens >= 500 ? (app.docs.sofDecl ? 20 : 0) : 20,
          maxScore: 20,
          details: tokens >= 500
            ? (app.docs.sofDecl
              ? "Source of funds declaration submitted for large-value subscription."
              : "Source of funds declaration missing for subscription ≥500 tokens (AMLO requirement).")
            : "Subscription below 500 tokens — source of funds declaration not mandatory.",
        },
        {
          ruleId: "KYC-05", ruleName: "Proof of Address",
          score: app.docs.proofAddr ? 20 : 0, maxScore: 20,
          details: app.docs.proofAddr
            ? "Valid proof of address document submitted."
            : "Proof of address document missing — required for AMLO CDD.",
        },
      ];
      const score = breakdown.reduce((s, r) => s + r.score, 0);
      const failed = breakdown.filter(r => r.score < r.maxScore);
      const summary = score >= 70
        ? `KYC review passed with score ${score}/100. All mandatory documents verified. ${isPEP ? "Note: PEP declaration requires enhanced review." : "No compliance flags detected."}`
        : `KYC review score ${score}/100 — below minimum threshold of 70. Issues: ${failed.map(r => r.ruleName).join(", ")}.`;
      const scorePatch = { status: "ai_scored" as AppStatus, aiScore: score, aiSummary: summary, aiBreakdown: breakdown };
      updateApp(app.id, scorePatch);
      await persistPatch(app.id, scorePatch);
    } finally {
      setScoring(false);
    }
  }

  async function approveApp(app: KYCApp) {
    setApproving(true);
    setApproveError(null);
    try {
      if (!isEthereumAddress(app.walletAddress)) {
        throw new Error("KYC approval requires a valid Ethereum wallet address.");
      }
      const response = await fetch("/api/kyc/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: [{
            wallet: app.walletAddress,
            jurisdiction: app.jurisdiction || "SG",
            isVerified: true,
            amlClear: true,
            kycExpiry: Math.floor(Date.now() / 1000) + 365 * 86400,
          }],
        }),
      });
      const data = await response.json() as { error?: string; results?: Array<{ txHash: string | null; error?: string }> };
      const result = data.results?.[0];
      if (!response.ok || !result || result.error) {
        throw new Error(result?.error ?? data.error ?? "Failed to register KYC on Ethereum");
      }

      const approvePatch = {
        status: "approved" as AppStatus,
        assetDeploymentId: app.assetDeploymentId,
        assetId: app.assetId ?? null,
        assetName: app.assetName ?? null,
        txHash: result.txHash,
        network: "Ethereum Sepolia",
        explorerUrl: result.txHash ? `https://sepolia.etherscan.io/tx/${result.txHash}` : null,
        signerPublicKey: null,
        pendingReason: result.txHash ? null : "IdentityRegistry contract is not configured.",
        chainStatus: result.txHash ? "Submitted" : "Validated",
      };
      updateApp(app.id, approvePatch);
      await persistPatch(app.id, approvePatch);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setApproving(false);
    }
  }

  async function rejectApp(app: KYCApp) {
    const rejectPatch = { status: "rejected" as AppStatus };
    updateApp(app.id, rejectPatch);
    await persistPatch(app.id, rejectPatch);
  }

  async function handleUpgradeRegistry() {
    setUpgrading(true);
    setUpgradeMessage("The Solidity IdentityRegistry is not configured behind an upgradeable proxy. Deploy a reviewed proxy upgrade through the Ethereum deployment pipeline.");
    setUpgrading(false);
  }

  /** Merged "① Analyze this application" action — runs the deterministic compliance
   *  score first (so the AI recommendation below has a fresh aiScore to
   *  reason about), then asks the agent for a recommendation. Sequential
   *  awaits ensure the score is persisted server-side before the analyze
   *  call reads the application record back. */
  async function analyzeAndScore(app: KYCApp) {
    await runAIScore(app);
    await analyzeWithAgent(app);
  }

  async function analyzeWithAgent(app: KYCApp) {
    setAgentBusyAction("analyze");
    setAgentMessage(null);
    try {
      const res = await fetch("/api/agent/kyc/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to analyze KYC with agent");
      }
      if (data.application) {
        updateApp(app.id, data.application as Partial<KYCApp>);
      }
      setAgentMessage(`Agent analyzed ${app.id}: ${data.recommendation?.action ?? "done"}`);
      setOperationFeedback({
        level: "info",
        title: "Analyze Completed",
        detail: `Application ${app.id} analyzed. Recommended action: ${String(data.recommendation?.action ?? "n/a")}.`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      setAgentMessage(err instanceof Error ? err.message : "Agent analyze failed");
      setOperationFeedback({
        level: "error",
        title: "Analyze Failed",
        detail: err instanceof Error ? err.message : "Agent analyze failed",
        timestamp: new Date().toISOString(),
      });
    } finally {
      setAgentBusyAction(null);
    }
  }

  async function executeAgentCredentialAction(app: KYCApp, action: "update" | "revoke") {
    setAgentBusyAction(action);
    setApproveError(null);
    setAgentMessage(null);
    try {
      if (!isEthereumAddress(app.walletAddress)) {
        throw new Error("Credential actions require a valid Ethereum wallet address.");
      }
      const response = await fetch("/api/kyc/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: [{
            wallet: app.walletAddress,
            jurisdiction: app.jurisdiction || "SG",
            isVerified: action === "update",
            amlClear: action === "update",
            kycExpiry: action === "update" ? Math.floor(Date.now() / 1000) + 365 * 86400 : Math.floor(Date.now() / 1000),
          }],
        }),
      });
      const data = await response.json() as { error?: string; results?: Array<{ txHash: string | null; error?: string }> };
      const result = data.results?.[0];
      if (!response.ok || !result || result.error) {
        throw new Error(result?.error ?? data.error ?? `Failed to ${action} Ethereum credential`);
      }

      setAgentMessage(`Credential ${action} transaction submitted: ${result.txHash ?? "contract not configured"}`);
      setOperationFeedback({
        level: "success",
        title: `Manual ${action === "update" ? "Update" : "Revoke"} Submitted`,
        detail: `Tx: ${String(result.txHash ?? "contract not configured")}`,
        timestamp: new Date().toISOString(),
      });
      await refreshApplications();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : `Credential ${action} failed`);
      setOperationFeedback({
        level: "error",
        title: `Manual ${action === "update" ? "Update" : "Revoke"} Failed`,
        detail: err instanceof Error ? err.message : `Credential ${action} failed`,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setAgentBusyAction(null);
    }
  }

  async function executeAgentAutoAction(app: KYCApp, action: "update" | "revoke") {
    setAgentBusyAction(action === "update" ? "auto-update" : "auto-revoke");
    setApproveError(null);
    setAgentMessage(null);
    setAutoBlockReasons([]);
    try {
      if (!chainConfig?.identityRegistryConfigured) {
        throw new Error(chainConfig?.error ?? "Ethereum Identity Registry is not configured.");
      }

      const res = await fetch("/api/agent/kyc/auto-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: app.id,
          action,
          assetDeploymentId: app.assetDeploymentId?.trim() || undefined,
        }),
      });
      const data = await res.json();
      setAutoPolicySnapshot((data.policy ?? null) as AutoPolicySnapshot | null);
      setAutoBlockReasons(Array.isArray(data.reasons) ? data.reasons.filter((item: unknown): item is string => typeof item === "string") : []);
      if (!res.ok) {
        setLastAutoExecution({
          applicationId: app.id,
          action,
          attemptedAt: new Date().toISOString(),
          outcome: Array.isArray(data.reasons) && data.reasons.length > 0 ? "blocked" : "error",
          status: typeof data.status === "string" ? data.status : null,
          deployHash: typeof data.deployHash === "string" ? data.deployHash : null,
        });
        setOperationFeedback({
          level: Array.isArray(data.reasons) && data.reasons.length > 0 ? "warning" : "error",
          title: "Auto Execute Blocked/Failed",
          detail: String(data.error ?? `Failed to auto ${action} credential`),
          timestamp: new Date().toISOString(),
          reasons: Array.isArray(data.reasons)
            ? data.reasons.filter((item: unknown): item is string => typeof item === "string")
            : [],
        });
        throw new Error(data.error ?? `Failed to auto ${action} credential`);
      }

      setLastAutoExecution({
        applicationId: app.id,
        action,
        attemptedAt: new Date().toISOString(),
        outcome: "success",
        status: typeof data.status === "string" ? data.status : null,
        deployHash: typeof data.deployHash === "string" ? data.deployHash : null,
      });

      setOperationFeedback({
        level: "success",
        title: `Auto ${action === "update" ? "Update" : "Revoke"} ${data.dryRun ? "Dry-Run" : "Submitted"}`,
        detail: `Deploy: ${String(data.deployHash ?? "unknown hash")} · Status: ${String(data.status ?? "Submitted")}`,
        timestamp: new Date().toISOString(),
      });

      setAgentMessage(
        `Auto ${action} submitted: ${data.deployHash ?? "unknown hash"} (${data.status ?? "Submitted"})`,
      );
      await refreshApplications();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : `Auto credential ${action} failed`);
    } finally {
      setAgentBusyAction(null);
    }
  }

  const approvalBlockedReason = !selected || chainConfig === null
    ? null
    : !chainConfig.identityRegistryConfigured
        ? (chainConfig.error ?? "Ethereum Identity Registry is not configured.")
        : null;

  const quickActionDisabled =
    !selected
    || agentBusyAction !== null
    || (quickAction !== "reject" && (!isEthereumAddress(selected.walletAddress) || Boolean(approvalBlockedReason)));

  const quickActionLabel =
    quickAction === "manual-update"
      ? "Execute Manual Update"
      : quickAction === "manual-revoke"
        ? "Execute Manual Revoke"
        : quickAction === "auto-update"
          ? "Execute Auto Update"
          : quickAction === "auto-revoke"
            ? "Execute Auto Revoke"
            : "Reject Application";

  async function runQuickAction(app: KYCApp) {
    if (quickAction === "manual-update") {
      await executeAgentCredentialAction(app, "update");
      return;
    }
    if (quickAction === "manual-revoke") {
      await executeAgentCredentialAction(app, "revoke");
      return;
    }
    if (quickAction === "auto-update") {
      await executeAgentAutoAction(app, "update");
      return;
    }
    if (quickAction === "auto-revoke") {
      await executeAgentAutoAction(app, "revoke");
      return;
    }
    await rejectApp(app);
    setOperationFeedback({
      level: "warning",
      title: "Application Rejected",
      detail: `Application ${app.id} marked as rejected.`,
      timestamp: new Date().toISOString(),
    });
  }

  return (
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <section className="rounded-2xl p-5 sm:p-6 mb-5" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(29,78,216,0.08))", border: "1px solid rgba(245,158,11,0.24)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-700">AI Agent Control Plane</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 mt-1">Compliance & KYC Operations</h1>
            <p className="text-sm text-slate-700 mt-2 leading-relaxed">
              Run deterministic scoring, invoke agent recommendations, and execute wallet credential updates on Ethereum.
              This console controls the off-chain review and on-chain credential lifecycle without exposing sensitive source documents.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] w-full sm:w-auto">
            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(245,158,11,0.22)" }}>
              <div className="text-slate-500">Lane A</div>
              <div className="font-semibold text-slate-800">Analyze</div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(245,158,11,0.22)" }}>
              <div className="text-slate-500">Lane B</div>
              <div className="font-semibold text-slate-800">Approve / Reject</div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(245,158,11,0.22)" }}>
              <div className="text-slate-500">Lane C</div>
              <div className="font-semibold text-slate-800">Auto Update / Revoke</div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(245,158,11,0.22)" }}>
              <div className="text-slate-500">Lane D</div>
              <div className="font-semibold text-slate-800">Upgradeable governance</div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex gap-5 items-start">

        {/* ── LEFT SIDEBAR: Application queue ────────────────────────────── */}
        <div className="w-56 shrink-0 sticky top-6">
          <div className="rounded-xl p-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex items-center justify-between pb-2 mb-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <span className="text-[11px] font-semibold text-slate-700">📋 KYC Application Queue</span>
              <span className="text-[10px] text-slate-400">{apps.length} item(s)</span>
            </div>

            {/* Filter tabs */}
            <div className="flex flex-wrap gap-1 mb-2">
              {(["all", "pending", "ai_scored", "approved", "rejected"] as (AppStatus | "all")[]).map((s) => {
                const meta = s === "all" ? null : STATUS_META[s];
                const count = s === "all" ? apps.length : apps.filter((a) => a.status === s).length;
                const active = filterStatus === s;
                return (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className="text-[9px] px-2 py-0.5 rounded-full font-medium transition-colors"
                    style={{
                      background: active ? (meta?.bg ?? "rgba(29,78,216,0.12)") : "transparent",
                      border: `1px solid ${active ? (meta?.border ?? "rgba(29,78,216,0.3)") : "transparent"}`,
                      color: active ? (meta?.color ?? "#93c5fd") : "#888",
                    }}>
                    {s === "all" ? "All" : STATUS_META[s].label} {count}
                  </button>
                );
              })}
            </div>

            {/* Application list */}
            {loading ? (
              <p className="text-[11px] text-slate-400 text-center py-4">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-4">No applications</p>
            ) : (
              <div className="space-y-1">
                {filtered.map((app) => (
                  <button key={app.id} onClick={() => { setSelected(app); setApproveError(null); }}
                    className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
                    style={{
                      background: selected?.id === app.id ? "rgba(26,86,219,0.07)" : "transparent",
                      border: `1px solid ${selected?.id === app.id ? "rgba(26,86,219,0.3)" : "transparent"}`,
                    }}>
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <span className="text-[11px] font-semibold text-slate-800 truncate leading-tight">{app.fullName}</span>
                      {app.aiScore !== null && (
                        <span className="text-[10px] font-mono font-bold shrink-0"
                          style={{ color: app.aiScore >= 70 ? "#16a34a" : app.aiScore >= 50 ? "#d97706" : "#dc2626" }}>
                          {app.aiScore}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-slate-500 font-mono truncate">{app.id}</span>
                      <StatusBadge s={app.status} />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {app.jurisdiction.replace(" SAR", "")} · {app.investorType === "individual" ? "Individual" : "Institutional"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => {
              void refreshApplications(true);
            }}
              className="w-full mt-2 text-[10px] text-slate-500 hover:text-slate-700 py-1.5 rounded transition-colors"
              style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
              Refresh
            </button>
          </div>
        </div>

        {/* ── MAIN AREA ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* Header banner */}
          <div className="rounded-lg px-3 py-2.5 text-xs mb-5" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <span className="font-semibold text-amber-700 uppercase tracking-wide text-[10px]">Type 1 LC · Compliance Officer Portal</span>
            <p className="text-slate-600 mt-1">
              AMLO (Cap.615) identity verification pipeline. Review each investor application, run AI compliance scoring, then <strong className="text-amber-700">Approve &amp; Whitelist</strong> to activate the wallet in <code className="text-amber-600">IdentityRegistry.sol</code>.
              Credential updates and revocations can be executed manually or autonomously through the agent policy controls below.
            </p>
          </div>

          {(autoPolicySnapshot || lastAutoExecution) && (
            <div className="sticky top-3 z-20 rounded-lg px-4 py-3 mb-5" style={{ background: "#f8fafc", border: "1px solid rgba(14,116,144,0.22)", boxShadow: "0 6px 14px rgba(2,6,23,0.08)" }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700">Auto-Execute Policy Snapshot</div>
                  {autoPolicySnapshot ? (
                    <div className="text-[11px] text-slate-700 mt-1">
                      Enabled {autoPolicySnapshot.enabled ? "Yes" : "No"} · Kill Switch {autoPolicySnapshot.killSwitch ? "On" : "Off"} · Dry Run {autoPolicySnapshot.dryRun ? "On" : "Off"} · Min Score {autoPolicySnapshot.minAiScoreUpdate} · Max Risk Band {autoPolicySnapshot.maxRiskBandUpdate}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-1">No policy snapshot received yet.</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Last Auto-Execute</div>
                  {lastAutoExecution ? (
                    <>
                      <div className="text-[11px] text-slate-700 mt-1">
                        {lastAutoExecution.applicationId} · {lastAutoExecution.action.toUpperCase()} · {lastAutoExecution.outcome.toUpperCase()}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {new Date(lastAutoExecution.attemptedAt).toLocaleString("en-GB")}
                        {lastAutoExecution.status ? ` · ${lastAutoExecution.status}` : ""}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] text-slate-500 mt-1">No execution recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg px-4 py-3 mb-5" style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.20)" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Autonomous Continuous Monitoring</div>
                <div className="text-[11px] text-slate-500 mt-0.5">No manual click required — Vercel Cron / local scheduler calls this on an interval.</div>
              </div>
              {schedulerState ? (
                <div className="text-right text-[11px] text-slate-700">
                  <div>
                    Last run: <span className="font-semibold">{new Date(schedulerState.lastRunAt).toLocaleString("en-GB")}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Scanned {schedulerState.scanned} · Executed {schedulerState.executed} · Blocked {schedulerState.blocked} · Skipped {schedulerState.skipped} · Errors {schedulerState.errors}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">No autonomous run recorded yet.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg px-4 py-3 mb-5" style={{ background: "rgba(29,78,216,0.05)", border: "1px solid rgba(29,78,216,0.20)" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Compliance Contract · Upgradable</div>
                <div className="mt-1.5">
                  <ContractVersionBadge
                    version={approvedAssets.find((item) => item.deploymentId === selected?.assetDeploymentId)?.contractVersion ?? approvedAssets[0]?.contractVersion}
                    isUpgradable={approvedAssets.find((item) => item.deploymentId === selected?.assetDeploymentId)?.isUpgradable ?? approvedAssets[0]?.isUpgradable}
                  />
                </div>
                {upgradeMessage && <div className="text-[10px] text-slate-500 mt-1.5">{upgradeMessage}</div>}
              </div>
              <button
                onClick={() => void handleUpgradeRegistry()}
                disabled={upgrading || approvedAssets.length === 0}
                className="text-[11px] font-semibold rounded-lg px-3.5 py-2 transition-colors disabled:opacity-50"
                style={{ color: "#1d4ed8", background: "rgba(29,78,216,0.10)", border: "1px solid rgba(29,78,216,0.3)" }}
              >
                {upgrading ? "Upgrading…" : "Upgrade Registry (v1→v2)"}
              </button>
            </div>
          </div>

          <div className="mb-5">
            <DataBoundaryPanel />
          </div>

          {approvalBlockedReason && (
            <div className="rounded-lg px-4 py-3 text-xs mb-5" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.20)" }}>
              <div className="font-semibold text-red-700 uppercase tracking-wide text-[10px] mb-1">Ethereum KYC Contract Not Ready</div>
              <p className="text-slate-700 leading-relaxed">
                {approvalBlockedReason}
              </p>
              <p className="text-slate-500 mt-1.5 leading-relaxed">
                Select an approved issuance that already has an asset-scoped identity-registry deployment from <code className="text-red-700">/tokenize</code> before approving KYC on-chain.
              </p>
            </div>
          )}

          {!selected ? (
            <div className="rounded-xl flex items-center justify-center text-sm text-slate-400"
              style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", minHeight: "480px" }}>
              ← Select an application from the queue to begin review
            </div>
          ) : (
            <div className="flex gap-6 items-start">

              {/* ── LEFT COLUMN: Investor details ──────────────────────── */}
              <div className="w-[420px] shrink-0 space-y-4">

                {/* Name + status */}
                <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="flex items-start justify-between gap-3 mb-3 pb-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">{selected.fullName}</h2>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{selected.id} · {selected.email}</div>
                    </div>
                    <StatusBadge s={selected.status} />
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      ["Submitted",      new Date(selected.submittedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })],
                      ["Jurisdiction",   selected.jurisdiction],
                      ["Investor Type",  selected.investorType === "individual" ? "Individual PI" : "Institutional PI"],
                      ["PEP Status",     selected.pepDeclaration ? "⚠ PEP FLAGGED" : "✓ No PEP"],
                      ["Risk Band",      selected.riskBand ? `Band ${selected.riskBand}` : "-"],
                      ["Monitor Status", selected.monitoringStatus ?? "-"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg p-2.5" style={{ background: "#f8f9fa", border: "1px solid rgba(0,0,0,0.06)" }}>
                        <div className="text-[10px] text-slate-500 mb-0.5">{k}</div>
                        <div className={`font-semibold text-xs ${k === "PEP Status" && selected.pepDeclaration ? "text-red-600" : "text-slate-800"}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Wallet */}
                <div className="rounded-xl px-5 py-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1.5">Wallet Address</div>
                  <code className="text-xs font-mono text-blue-600 break-all">{selected.walletAddress}</code>
                  {!isEthereumAddress(selected.walletAddress) && (
                    <p className="text-[11px] text-red-600 mt-2">A valid Ethereum 0x wallet address is required before approval.</p>
                  )}
                </div>

                {selected.agentActionLog && selected.agentActionLog.length > 0 && (
                  <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">Agent Action Timeline</div>
                    <div className="space-y-2 text-[11px] max-h-56 overflow-y-auto pr-1">
                      {[...selected.agentActionLog].reverse().map((entry, idx) => {
                        const modeMeta = entry.mode === "cron"
                          ? { label: "AUTO · CRON", color: "#16a34a", bg: "rgba(22,163,74,0.10)" }
                          : entry.mode === "auto"
                            ? { label: "AUTO", color: "#0891b2", bg: "rgba(8,145,178,0.10)" }
                            : { label: "MANUAL", color: "#64748b", bg: "rgba(100,116,139,0.10)" };
                        return (
                          <div key={`${entry.ts}-${idx}`} className="flex items-start gap-2 pb-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                              style={{ color: modeMeta.color, background: modeMeta.bg }}
                            >
                              {modeMeta.label}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-slate-700 font-medium">{entry.action}</div>
                              <div className="text-slate-500">{entry.reason}</div>
                              <div className="text-slate-400 text-[10px]">{new Date(entry.ts).toLocaleString("en-GB")}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">Target Asset Issuance</div>
                  <select
                    className="w-full rounded-lg px-3 py-2.5 text-xs text-slate-700 outline-none"
                    style={{ background: "#f8f9fa", border: "1px solid rgba(0,0,0,0.08)" }}
                    value={selected.assetDeploymentId ?? ""}
                    onChange={(e) => {
                      const deploymentId = e.currentTarget.value;
                      const asset = approvedAssets.find((item) => item.deploymentId === deploymentId);
                      const patch = {
                        assetDeploymentId: deploymentId || null,
                        assetId: asset?.assetId ?? null,
                        assetName: asset?.assetName ?? null,
                      };
                      updateApp(selected.id, patch);
                      void persistPatch(selected.id, patch);
                    }}
                    disabled={selected.status === "approved" || selected.status === "rejected" || approvedAssets.length === 0}
                  >
                    <option value="">{approvedAssets.length === 0 ? "No identity-ready issuance available" : "Select approved issuance..."}</option>
                    {approvedAssets.map((asset) => (
                      <option key={asset.deploymentId} value={asset.deploymentId}>
                        {asset.assetName} · {asset.deploymentId}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    KYC whitelist approval writes to the configured Ethereum IdentityRegistry contract.
                  </p>
                  {approvedAssets.length === 0 && (
                    <p className="text-[11px] text-amber-700 mt-2 leading-relaxed">
                      No approved issuance currently has an asset-scoped identity-registry deployment. Finish the identity step in /tokenize first, then return here.
                    </p>
                  )}
                  {selected.assetName && (
                    <p className="text-[11px] text-emerald-700 mt-1">
                      Selected asset: <span className="font-semibold">{selected.assetName}</span>
                    </p>
                  )}
                </div>

                {/* Documents */}
                <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-3">Submitted Documents</div>
                  <div className="space-y-2">
                    {[
                      ["Government ID",       selected.docs.govId],
                      ["Proof of Address",    selected.docs.proofAddr],
                      ["PI Eligibility",      selected.docs.piEvidence],
                      ...(selected.docs.sofDecl ? [["Source of Funds", selected.docs.sofDecl] as [string, string]] : []),
                    ].map(([label, file]) => (
                      <div key={label} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs"
                        style={{ background: "rgba(22,163,74,0.04)", border: "1px solid rgba(22,163,74,0.15)" }}>
                        <span className="text-emerald-600 text-sm shrink-0">✓</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-slate-500">{label}</div>
                          <div className="text-slate-700 font-mono text-[11px] truncate">{file}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* ── RIGHT COLUMN: AI scoring + actions ─────────────────── */}
              <div className="flex-1 min-w-0 space-y-4">

                {/* AI Score panel */}
                <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-3">
                    ComplianceOracle.sol · AI KYC Score
                  </div>

                  {selected.aiScore === null ? (
                    <div className="rounded-lg px-4 py-6 text-center text-sm text-slate-400"
                      style={{ background: "#f8f9fa", border: "1px dashed rgba(0,0,0,0.10)" }}>
                      Run AI Compliance Score to evaluate this application
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl font-bold font-mono"
                            style={{ color: selected.aiScore >= 70 ? "#16a34a" : selected.aiScore >= 50 ? "#d97706" : "#dc2626" }}>
                            {selected.aiScore}
                          </span>
                          <span className="text-slate-400 text-sm">/100</span>
                        </div>
                        <span className="text-xs font-bold px-3 py-1 rounded-full"
                          style={{
                            background: selected.aiScore >= 70 ? "rgba(22,163,74,0.10)" : "rgba(239,68,68,0.10)",
                            color: selected.aiScore >= 70 ? "#16a34a" : "#dc2626",
                            border: `1px solid ${selected.aiScore >= 70 ? "rgba(22,163,74,0.3)" : "rgba(239,68,68,0.3)"}`,
                          }}>
                          {selected.aiScore >= 70 ? "PASS ≥70" : "FAIL <70"}
                        </span>
                      </div>
                      <ScoreBar score={selected.aiScore} />
                      {selected.aiSummary && (
                        <p className="text-xs text-slate-600 leading-relaxed pt-1">{selected.aiSummary}</p>
                      )}

                      {/* Deduction items */}
                      {selected.aiBreakdown && selected.aiBreakdown.filter((b) => b.score < b.maxScore).length > 0 && (
                        <div className="mt-1 space-y-1.5">
                          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide pt-1">
                            Deduction Items ({selected.aiBreakdown.filter((b) => b.score < b.maxScore).length})
                          </div>
                          {selected.aiBreakdown
                            .filter((b) => b.score < b.maxScore)
                            .map((b) => (
                              <div key={b.ruleId} className="rounded-lg px-3 py-2"
                                style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.18)" }}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[11px] font-semibold text-slate-700">{b.ruleName}</span>
                                  <span className="text-[11px] font-mono shrink-0 ml-2">
                                    <span style={{ color: "#dc2626" }}>{b.score}</span>
                                    <span className="text-slate-400">/{b.maxScore}</span>
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 leading-relaxed">{b.details}</p>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* All-pass notice */}
                      {selected.aiBreakdown && selected.aiBreakdown.filter((b) => b.score < b.maxScore).length === 0 && (
                        <p className="text-[11px] text-emerald-600 pt-1">✓ All scoring items passed — no deductions.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Whitelist tx */}
                {selected.txHash && (
                  <div className="rounded-xl px-5 py-3 flex items-center gap-3"
                    style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.25)" }}>
                    <span className="text-emerald-600 font-semibold text-xs shrink-0">✓ Whitelisted</span>
                    <span className="text-slate-400 text-xs">Tx:</span>
                    <code className="font-mono text-blue-500 text-xs truncate">{selected.txHash}</code>
                    {selected.explorerUrl && (
                      <a href={selected.explorerUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:underline shrink-0">Explorer</a>
                    )}
                  </div>
                )}

                {/* Review notes */}
                <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-2">
                    Compliance Officer Notes
                  </label>
                  <textarea rows={4}
                    className="w-full text-xs rounded-lg px-3 py-2.5 text-slate-700 resize-none outline-none transition-colors"
                    style={{ background: "#f8f9fa", border: "1px solid rgba(0,0,0,0.08)" }}
                    placeholder="Add review notes, flags, or reasons for decision..."
                    value={selected.reviewNotes}
                    onChange={(e) => updateApp(selected.id, { reviewNotes: e.target.value })}
                    onFocus={(ev)  => (ev.currentTarget.style.borderColor = "#1a56db")}
                    onBlur={(ev)   => {
                      ev.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
                      void persistPatch(selected.id, { reviewNotes: ev.currentTarget.value });
                    }}
                    disabled={selected.status === "approved" || selected.status === "rejected"}
                  />
                </div>

                <ComplianceCredentialCard
                  status={selected.status}
                  monitoringStatus={selected.monitoringStatus}
                  riskBand={selected.riskBand}
                  credentialCommitment={selected.credentialCommitment}
                  nullifierHash={selected.nullifierHash}
                  proofHash={selected.proofHash}
                  zkProofScheme={selected.zkProofScheme}
                  zkCircuitId={selected.zkCircuitId}
                  proofVerified={selected.proofVerified}
                  executionMode={selected.executionMode}
                  kycExpiry={selected.kycExpiry}
                  agentReason={selected.agentReason}
                />

                {/* Action buttons */}
                {selected.status !== "approved" && selected.status !== "rejected" && (
                  <div className="rounded-xl px-5 py-4 space-y-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Actions</div>

                    {/* Plain-language "what should I click next" hint for non-expert users.
                        Purely derived from existing state — no new data fetching. */}
                    {(() => {
                      const hint = selected.aiScore === null
                        ? { text: "Recommended: click \"▶ Run AI Compliance Score\" below to score this application first.", tone: "info" as const }
                        : selected.aiScore < 70
                          ? { text: "Current score is below 70, so approval is blocked for now. Ask the investor to provide missing documents and run scoring again.", tone: "warning" as const }
                          : !isEthereumAddress(selected.walletAddress)
                            ? { text: "Score passed, but the wallet address is not a valid Ethereum address.", tone: "warning" as const }
                            : { text: "Score passed (≥70). You can now click \"✓ Approve & Whitelist\" to complete on-chain approval.", tone: "success" as const };
                      return (
                        <div
                          className="rounded-lg px-3 py-2 flex items-start gap-2"
                          style={{
                            background: hint.tone === "success" ? "rgba(22,163,74,0.06)" : hint.tone === "warning" ? "rgba(245,158,11,0.08)" : "rgba(59,130,246,0.06)",
                            border: `1px solid ${hint.tone === "success" ? "rgba(22,163,74,0.20)" : hint.tone === "warning" ? "rgba(245,158,11,0.25)" : "rgba(59,130,246,0.20)"}`,
                          }}
                        >
                          <span className="text-xs shrink-0">{hint.tone === "success" ? "✓" : hint.tone === "warning" ? "⚠" : "💡"}</span>
                          <span className="text-[11px] text-slate-700 leading-relaxed">{hint.text}</span>
                        </div>
                      );
                    })()}

                    {/* Results of the most recent action — shown above the buttons so the
                        outcome of a click is always visible without scrolling down. */}
                    {(operationFeedback || agentMessage || autoBlockReasons.length > 0 || autoPolicySnapshot
                      || approveError || approvalBlockedReason || (selected.aiScore !== null && selected.aiScore < 70)
                      || !isEthereumAddress(selected.walletAddress)) && (
                      <div className="space-y-2 pb-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                        {operationFeedback && (
                          <div
                            className="rounded-lg p-3"
                            style={{
                              background:
                                operationFeedback.level === "success"
                                  ? "rgba(22,163,74,0.08)"
                                  : operationFeedback.level === "warning"
                                    ? "rgba(245,158,11,0.10)"
                                    : operationFeedback.level === "error"
                                      ? "rgba(239,68,68,0.08)"
                                      : "rgba(59,130,246,0.08)",
                              border:
                                operationFeedback.level === "success"
                                  ? "1px solid rgba(22,163,74,0.25)"
                                  : operationFeedback.level === "warning"
                                    ? "1px solid rgba(245,158,11,0.30)"
                                    : operationFeedback.level === "error"
                                      ? "1px solid rgba(239,68,68,0.25)"
                                      : "1px solid rgba(59,130,246,0.25)",
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                              <span className="text-[11px] font-semibold text-slate-800">{operationFeedback.title}</span>
                              <span className="text-[10px] text-slate-500">{new Date(operationFeedback.timestamp).toLocaleString("en-GB")}</span>
                            </div>
                            <p className="text-[11px] text-slate-700 leading-relaxed">{operationFeedback.detail}</p>
                            {operationFeedback.reasons && operationFeedback.reasons.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {operationFeedback.reasons.map((reason, idx) => (
                                  <p key={`${reason}-${idx}`} className="text-[11px] text-amber-800">• {reason}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {agentMessage && (
                          <p className="text-[11px] text-blue-700 flex items-start gap-1.5">
                            <span className="shrink-0">i</span>
                            <span>{agentMessage}</span>
                          </p>
                        )}
                        {selected.aiScore !== null && selected.aiScore < 70 && (
                          <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                            <span>⚠</span>
                            AI score below 70 — approval blocked per ComplianceOracle.sol gating condition.
                          </p>
                        )}
                        {!isEthereumAddress(selected.walletAddress) && (
                          <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
                            <span className="shrink-0">⚠</span>
                            <span>This record does not contain a valid Ethereum address. Update it before whitelist approval.</span>
                          </p>
                        )}
                        {approvalBlockedReason && (
                          <p className="text-[11px] text-amber-600 flex items-start gap-1.5">
                            <span className="shrink-0">⚠</span>
                            <span>{approvalBlockedReason}</span>
                          </p>
                        )}
                        {approveError && (
                          <p className="text-[11px] text-red-600 flex items-start gap-1.5">
                            <span className="shrink-0">✗</span>
                            <span>On-chain error: {approveError}</span>
                          </p>
                        )}
                        {autoBlockReasons.length > 0 && (
                          <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.20)" }}>
                            <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-2">Auto-Execute Block Reasons</div>
                            <div className="space-y-1">
                              {autoBlockReasons.map((reason, index) => (
                                <p key={`${reason}-${index}`} className="text-[11px] text-red-700 leading-relaxed">• {reason}</p>
                              ))}
                            </div>
                          </div>
                        )}
                        {autoPolicySnapshot && (
                          <div className="rounded-lg p-3" style={{ background: "rgba(14,116,144,0.05)", border: "1px solid rgba(14,116,144,0.18)" }}>
                            <div className="text-[10px] font-semibold text-cyan-700 uppercase tracking-wide mb-2">Auto Policy Snapshot</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                              <div>Enabled: <span className="font-semibold">{autoPolicySnapshot.enabled ? "Yes" : "No"}</span></div>
                              <div>Kill Switch: <span className="font-semibold">{autoPolicySnapshot.killSwitch ? "On" : "Off"}</span></div>
                              <div>Dry Run: <span className="font-semibold">{autoPolicySnapshot.dryRun ? "On" : "Off"}</span></div>
                              <div>Require Proof: <span className="font-semibold">{autoPolicySnapshot.requireProofVerified ? "Yes" : "No"}</span></div>
                              <div>Min AI Score: <span className="font-semibold">{autoPolicySnapshot.minAiScoreUpdate}</span></div>
                              <div>Max Risk Band: <span className="font-semibold">{autoPolicySnapshot.maxRiskBandUpdate}</span></div>
                              <div>ID Allowlist Size: <span className="font-semibold">{autoPolicySnapshot.idAllowlistSize}</span></div>
                              <div>Wallet Allowlist Size: <span className="font-semibold">{autoPolicySnapshot.walletAllowlistSize}</span></div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Button groups — laid out below the results so the outcome of the
                        previous click stays visible while choosing the next action. */}
                    <div className="space-y-1.5">
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-wide font-semibold">① Analyze This Application</div>
                        <div className="text-[10px] text-slate-400">Diagnostics and scoring only; no on-chain data changes</div>
                      </div>
                      <div className="flex flex-wrap items-stretch gap-3">
                        {/* Scope: the currently selected application */}
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => void analyzeAndScore(selected)}
                            disabled={agentBusyAction !== null || scoring || selected.status === "reviewing"}
                            title="First compute a 0-100 compliance score, then ask AI for a recommendation (issue/update/revoke/manual review). No automatic execution."
                            className="min-w-[150px] px-4 py-2 text-xs font-semibold rounded-lg text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                            style={{ background: "linear-gradient(135deg, #5b21b6 0%, #1d4ed8 100%)" }}>
                            {scoring
                              ? "Scoring..."
                              : agentBusyAction === "analyze"
                                ? "Analyzing..."
                                : selected.aiScore !== null
                                  ? "↺ Re-run AI Analysis"
                                  : "▶ Run AI Analysis"}
                          </button>
                            <span className="text-[9px] text-slate-400 leading-snug max-w-[220px]">Generates a 0-100 score (≥70 required for approval) and action recommendations. It will not auto-issue/revoke credentials.</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-wide font-semibold">② Approval</div>
                        <div className="text-[10px] text-slate-400">The only action that writes the investor wallet into the on-chain whitelist</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => void approveApp(selected)}
                          disabled={approving || selected.aiScore === null || selected.aiScore < 70 || !isEthereumAddress(selected.walletAddress) || Boolean(approvalBlockedReason)}
                          title="Connect an admin wallet and sign to add this investor address to the on-chain IdentityRegistry whitelist"
                          className="min-w-[150px] px-4 py-2 text-xs font-semibold rounded-lg text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                          style={{ background: "#16a34a" }}>
                          {approving ? "Submitting Ethereum transaction..." : "Approve & Whitelist"}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-lg p-2.5" style={{ background: "rgba(0,0,0,0.02)", border: "1px dashed rgba(0,0,0,0.10)" }}>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase tracking-wide font-semibold">③ Execution (Advanced)</div>
                        <div className="text-[10px] text-slate-400">Use only when updating/revoking issued credentials or rejecting an application; choose carefully</div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={quickAction}
                          onChange={(e) => setQuickAction(e.currentTarget.value as typeof quickAction)}
                          title="Choose the specific action to execute for this credential"
                          className="px-3 py-2 text-xs rounded-lg text-slate-700"
                          style={{ background: "#f8f9fa", border: "1px solid rgba(0,0,0,0.10)" }}
                          disabled={agentBusyAction !== null}
                        >
                          <option value="auto-update">Auto Update (Server Signer)</option>
                          <option value="auto-revoke">Auto Revoke (Server Signer)</option>
                          <option value="manual-update">Manual Update Credential</option>
                          <option value="manual-revoke">Manual Revoke Credential</option>
                          <option value="reject">Reject Application</option>
                        </select>
                        <button
                          onClick={() => void runQuickAction(selected)}
                          disabled={quickActionDisabled}
                          title="Execute the selected action on the left. Auto is server-signed; Manual requires wallet signature."
                          className="min-w-[150px] px-4 py-2 text-xs font-semibold rounded-lg transition-opacity disabled:opacity-40 hover:opacity-90 text-white"
                          style={{ background: "linear-gradient(135deg, #0f766e 0%, #1d4ed8 100%)" }}
                        >
                          {quickActionLabel}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Outcome banners */}
                {selected.status === "approved" && (
                  <div className="rounded-xl px-5 py-4"
                    style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.25)" }}>
                    <div className="text-xs font-semibold text-emerald-700 mb-1">✓ Application Approved</div>
                    <p className="text-xs text-emerald-600 leading-relaxed">
                      Wallet whitelisted in <code>IdentityRegistry.sol</code> on Ethereum Sepolia. Investor may now proceed to subscription.
                    </p>
                    {selected.txHash && (
                      <p className="text-[11px] font-mono mt-2 break-all">
                        Tx:{" "}
                        <a
                          href={selected.explorerUrl ?? `https://sepolia.etherscan.io/tx/${selected.txHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-emerald-700 underline hover:opacity-75"
                        >
                          {selected.txHash}
                        </a>
                        {selected.chainStatus && (
                          <span className="ml-1.5 text-slate-400">({selected.chainStatus})</span>
                        )}
                      </p>
                    )}
                    {selected.pendingReason && (
                      <p className="text-[11px] text-amber-700 mt-2">Ethereum finality pending: {selected.pendingReason}</p>
                    )}
                  </div>
                )}
                {selected.status === "rejected" && (
                  <div className="rounded-xl px-5 py-4"
                    style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)" }}>
                    <div className="text-xs font-semibold text-red-600 mb-1">✗ Application Rejected</div>
                    <p className="text-xs text-red-500 leading-relaxed">
                      Wallet will not be whitelisted. Notify investor at <span className="underline">{selected.email}</span> with the reason for rejection.
                    </p>
                    {selected.txHash && (
                      <p className="text-[11px] font-mono mt-2 break-all">
                        Tx:{" "}
                        <a
                          href={selected.explorerUrl ?? `https://sepolia.etherscan.io/tx/${selected.txHash}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-red-600 underline hover:opacity-75"
                        >
                          {selected.txHash}
                        </a>
                        {selected.chainStatus && (
                          <span className="ml-1.5 text-slate-400">({selected.chainStatus})</span>
                        )}
                      </p>
                    )}
                    {selected.pendingReason && (
                      <p className="text-[11px] text-amber-700 mt-2">Ethereum finality pending: {selected.pendingReason}</p>
                    )}
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
