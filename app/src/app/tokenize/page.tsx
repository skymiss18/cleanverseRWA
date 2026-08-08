"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useWallet } from "@/lib/wallet-context";

interface CouponInvestor {
  publicKey: string;
  tokenCount: number;
  paymentRef: string;
  mintTxHash: string;
  createdAt: string;
}

type AssetType = "Bond" | "GreenBond" | "REIT" | "TradeReceivable";
const ASSET_TYPES: { value: AssetType; label: string }[] = [
  { value: "Bond",             label: "Bond"              },
  { value: "GreenBond",        label: "Green Bond"        },
  { value: "REIT",             label: "REIT"              },
  { value: "TradeReceivable",  label: "Trade Receivable"  },
];

type AppStatus = "Pending SFC Review" | "Approved" | "Changes Required";
type FilterType = "All" | AppStatus | "Deployed";

interface SFCRecord {
  id: string;
  asset: string;
  type: string;
  issuer: string;
  submitted: string;
  complianceScore: number;
  auditHash: string;
  totalIssuance: string;
  currency: string;
  status: AppStatus;
  notes?: string;
  approvedTx?: string;
  approvedAt?: string;
  approvedBy?: string;
  sfcRef?: string;
  prospectusExcerpt?: string;
}

interface DeployResult {
  txHash?: string;
  deployHash?: string;
  registrationId?: string;
  assetId?: string;
  assetName?: string;
  symbol?: string;
  contractHash?: string;
  contractAddress?: string;
  blockNumber?: number | null;
  network: string;
  deployedAt: string;
  standard: string;
  gasUsed?: number | null;
  explorerUrl?: string;
  status?: string;
  pendingReason?: string;
  packageKeyName?: string;
  identityRegistry?: DeployResult;
}

interface ATokenApplication {
  issuanceId: string;
  requestId: string;
  issueAssetId: number;
  chain: string;
  tokenSymbol: string;
  applyStatus: "PENDING" | "APPROVED" | "ISSUING" | "ISSUED" | "REJECTED" | "ISSUE_FAILED";
  subscriptionOpen: boolean;
  atokenAddress?: string;
  txHash?: string;
  rejectReason?: string;
  issueErrorMsg?: string;
  lastSyncedAt: string;
}

const STATUS_CFG: Record<AppStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  "Pending SFC Review": { color: "#f59e0b", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.3)",  dot: "bg-amber-400",   label: "Pending" },
  "Approved":           { color: "#10b981", bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.3)",  dot: "bg-emerald-400", label: "Approved" },
  "Changes Required":   { color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", dot: "bg-red-400",     label: "Changes" },
};

function StatusBadge({ status }: { status: AppStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {cfg.label}
    </span>
  );
}

function normalizeDeployResult(deploy: DeployResult): DeployResult {
  return deploy.identityRegistry
    ? { ...deploy, identityRegistry: normalizeDeployResult(deploy.identityRegistry) }
    : deploy;
}

export default function TokenizePage() {
  const { wallet, connect: connectEthereumWallet, connecting: walletConnecting } = useWallet();

  // ── view toggle ──────────────────────────────────────────────────────────
  const [view, setView] = useState<"submit" | "deploy">("deploy");

  // ── submission form state ─────────────────────────────────────────────────
  const [form, setForm] = useState({
    assetName:  "",
    assetType:  "Bond" as AssetType,
    description: "",
    unitPrice: "",
    totalSupply: "",
    prospectusText: "",
  });
  const [submitting,    setSubmitting]    = useState(false);
  const [submitResult,  setSubmitResult]  = useState<{ id: string } | null>(null);
  const [submitError,   setSubmitError]   = useState<string | null>(null);

  function setField<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.assetName.trim() || !form.unitPrice.trim() || !form.totalSupply.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      const res = await fetch("/api/sponsor-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName:      form.assetName.trim(),
          assetType:      form.assetType,
          description:    form.description.trim(),
          unitPrice:      form.unitPrice.trim(),
          totalSupply:    form.totalSupply.trim(),
          prospectusText: form.prospectusText.trim(),
          issuer:         "Nexus Capital Markets Corporation Limited",
          submittedAt:    new Date().toISOString(),
        }),
      });
      const data = await res.json() as { success: boolean; id: string };
      if (!res.ok || !data.success) throw new Error("Submission failed");
      setSubmitResult({ id: data.id });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed, please retry");
    } finally {
      setSubmitting(false);
    }
  }

  // ── deployment state ──────────────────────────────────────────────────────
  const [records,          setRecords]          = useState<SFCRecord[]>([]);
  const [selected,         setSelected]         = useState<SFCRecord | null>(null);
  const [filter,           setFilter]           = useState<FilterType>("All");
  const [loading,          setLoading]          = useState(true);
  const [deploying,        setDeploying]        = useState(false);
  const [deployMap,        setDeployMap]        = useState<Record<string, DeployResult>>({});
  const [deployError,      setDeployError]      = useState<string | null>(null);
  const [deployStep,       setDeployStep]       = useState<"idle" | "connecting" | "signingIdentity" | "broadcastingIdentity" | "signingToken" | "broadcastingToken">("idle");
  const [ethereumAdminAddress, setEthereumAdminAddress] = useState("");
  const [atokenApplication, setATokenApplication] = useState<ATokenApplication | null>(null);
  const [atokenLoading, setATokenLoading] = useState(false);
  const [atokenError, setATokenError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet) setEthereumAdminAddress(wallet);
  }, [wallet]);

  // ── coupon distribution state ─────────────────────────────────────────────
  const [investors,        setInvestors]        = useState<CouponInvestor[]>([]);
  const [investorsLoading, setInvestorsLoading] = useState(false);
  const [investorsError,   setInvestorsError]   = useState<string | null>(null);

  async function loadRecords() {
    setLoading(true);
    try {
      const [sfcRes, deplRes] = await Promise.all([
        fetch("/api/sfc-inbox"),
        fetch("/api/tokenize/deployments"),
      ]);
      const sfcData = await sfcRes.json();
      const rawDeployments = await deplRes.json() as Record<string, DeployResult>;
      const deplData = Object.fromEntries(
        Object.entries(rawDeployments).map(([id, deployment]) => [id, normalizeDeployResult(deployment)])
      ) as Record<string, DeployResult>;
      const recs: SFCRecord[] = sfcData.submissions ?? [];
      setRecords(recs);
      setDeployMap(deplData);
      setSelected((prev) => prev ?? recs.find((r) => r.status === "Approved") ?? recs[0] ?? null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function start() {
      await Promise.resolve();
      if (active) {
        await loadRecords();
      }
    }

    void start();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setATokenApplication(null);
    setATokenError(null);
    if (!selected?.id) return () => { active = false; };
    fetch(`/api/cleanverse/atoken/launch?issuanceId=${encodeURIComponent(selected.id)}`, { cache: "no-store" })
      .then(async (response) => response.status === 404 ? null : (await response.json() as { application?: ATokenApplication }).application ?? null)
      .then((application) => { if (active) setATokenApplication(application); })
      .catch(() => { if (active) setATokenApplication(null); });
    return () => { active = false; };
  }, [selected?.id]);

  async function launchCleanverseAToken() {
    if (!selected) return;
    setATokenLoading(true);
    setATokenError(null);
    try {
      const response = await fetch("/api/cleanverse/atoken/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issuanceId: selected.id, adminAddress: ethereumAdminAddress.trim() }),
      });
      const data = await response.json() as { application?: ATokenApplication; error?: string };
      if (!response.ok || !data.application) throw new Error(data.error ?? "A-Token launch failed");
      setATokenApplication(data.application);
    } catch (error) {
      setATokenError(error instanceof Error ? error.message : "A-Token launch failed");
    } finally {
      setATokenLoading(false);
    }
  }

  async function syncCleanverseAToken() {
    if (!atokenApplication) return;
    setATokenLoading(true);
    setATokenError(null);
    try {
      const response = await fetch(`/api/cleanverse/atoken/status?requestId=${encodeURIComponent(atokenApplication.requestId)}`, { cache: "no-store" });
      const data = await response.json() as { application?: ATokenApplication; error?: string };
      if (!response.ok || !data.application) throw new Error(data.error ?? "A-Token status sync failed");
      setATokenApplication(data.application);
    } catch (error) {
      setATokenError(error instanceof Error ? error.message : "A-Token status sync failed");
    } finally {
      setATokenLoading(false);
    }
  }

  async function handleDeploy() {
    if (!selected || deploying) return;
    setDeployError(null);
    setDeploying(true);

    try {
      setDeployStep("broadcastingToken");
      const deployBody = {
        id: selected.id,
        assetName: selected.asset,
        assetType: selected.type,
        issuer: selected.issuer,
        sfcRef: selected.sfcRef,
        totalIssuance: selected.totalIssuance,
        currency: selected.currency,
        complianceScore: selected.complianceScore,
      };
      const response = await fetch("/api/tokenize/deploy-mantle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deployBody),
      });
      const data = await response.json() as DeployResult & { success?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? "Ethereum asset registration failed");

      const newEntry: DeployResult = {
        txHash: data.txHash,
        deployHash: data.deployHash,
        registrationId: data.registrationId,
        assetId: data.assetId,
        assetName: data.assetName ?? selected.asset,
        symbol: data.symbol,
        contractHash: data.contractHash,
        contractAddress: data.contractAddress,
        blockNumber: data.blockNumber,
        network: data.network,
        deployedAt: data.deployedAt,
        standard: data.standard,
        gasUsed: data.gasUsed,
        explorerUrl: data.explorerUrl,
        status: data.status,
        pendingReason: data.pendingReason,
        packageKeyName: data.packageKeyName,
      };
      await fetch("/api/tokenize/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, deployment: newEntry }),
      });
      setDeployMap((prev) => ({ ...prev, [selected.id]: newEntry }));
    } catch (err) {
      console.warn("handleDeploy failed:", err instanceof Error ? err.message : String(err));
      setDeployError(err instanceof Error ? err.message : "Ethereum registration failed, please retry");
    } finally {
      setDeploying(false);
      setDeployStep("idle");
    }
  }

  const activeDeploy = selected ? deployMap[selected.id] : null;

  useEffect(() => {
    if (!selected || !activeDeploy || activeDeploy.status !== "Deployed") {
      setInvestors([]);
      return;
    }
    let active = true;
    setInvestorsLoading(true);
    setInvestorsError(null);
    const params = new URLSearchParams({ deploymentId: selected.id });
    if (activeDeploy.assetId) params.set("assetId", activeDeploy.assetId);
    if (selected.asset) params.set("assetName", selected.asset);
    fetch(`/api/tokenize/coupon-payout/investors?${params.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { investors?: CouponInvestor[]; error?: string }) => {
        if (!active) return;
        if (data.error) throw new Error(data.error);
        setInvestors(data.investors ?? []);
      })
      .catch((err) => {
        if (!active) return;
        setInvestorsError(err instanceof Error ? err.message : "Failed to load investors");
      })
      .finally(() => { if (active) setInvestorsLoading(false); });
    return () => { active = false; };
  }, [selected, activeDeploy]);

  const counts = {
    All: records.length,
    "Approved": records.filter((r) => r.status === "Approved").length,
    "Pending SFC Review": records.filter((r) => r.status === "Pending SFC Review").length,
    "Changes Required": records.filter((r) => r.status === "Changes Required").length,
    "Deployed": records.filter((r) => !!deployMap[r.id]).length,
  };
  const filtered = filter === "All"
    ? records
    : filter === "Deployed"
      ? records.filter((r) => !!deployMap[r.id])
      : records.filter((r) => r.status === filter);
  const deploy = activeDeploy;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Tokenise an Asset</h1>


      </div>

      {/* ══════════════════════════════════════════════════════════
          VIEW: Submit for Intermediary Review
      ══════════════════════════════════════════════════════════ */}
      {view === "submit" && (
        <div className="flex gap-6 items-start">

          {/* ── Left: form ─────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            <button onClick={() => setView("deploy")}
              className="flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors"
              style={{ color: "#6366f1" }}>
              ← Back to Deployment Portal
            </button>
            <div className="rounded-lg px-3 py-2.5 text-xs mb-5"
              style={{ background: "rgba(26,86,219,0.06)", border: "1px solid rgba(26,86,219,0.18)" }}>
              <span className="font-semibold text-blue-700 uppercase tracking-wide text-[10px]">Issuer · Asset Submission</span>
              <p className="text-slate-600 mt-1">
                Fill in the asset details and click <strong className="text-blue-700">Submit for Intermediary Review →</strong>.
                Your submission will appear in the Type&#160;6&#160;LC compliance queue at <a href="/compliance" className="underline text-blue-600">/compliance</a> for AI-assisted SFC review.
              </p>
            </div>

            {submitResult ? (
              <div className="rounded-xl p-8 text-center" style={{ background: "#ffffff", border: "1px solid rgba(16,185,129,0.3)" }}>
                <div className="text-3xl mb-3">✅</div>
                <h2 className="text-base font-bold text-emerald-700 mb-1">Submitted Successfully</h2>
                <p className="text-xs text-slate-500 mb-3">
                  Reference <span className="font-mono font-semibold text-slate-700">{submitResult.id}</span>
                </p>
                <p className="text-xs text-slate-500 mb-6">
                  The intermediary (Type&#160;6&#160;LC) will pick up your submission from the Sponsor Inbox at{" "}
                  <a href="/compliance" className="text-blue-600 underline">/compliance</a> and run an AI compliance check before filing with the SFC.
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                  <button onClick={() => { setSubmitResult(null); setForm({ assetName: "", assetType: "Bond", description: "", unitPrice: "", totalSupply: "", prospectusText: "" }); }}
                    className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                    style={{ background: "rgba(26,86,219,0.08)", border: "1px solid rgba(26,86,219,0.2)", color: "#1d4ed8" }}>
                    Submit another asset
                  </button>
                  <a href="/compliance"
                    className="text-xs font-semibold px-4 py-2 rounded-lg text-white transition-opacity hover:opacity-90"
                    style={{ background: "#1d4ed8" }}>
                    Go to Compliance →
                  </a>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
                <div className="rounded-xl p-5 space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>

                  {/* Asset Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Asset Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={form.assetName}
                      onChange={(e) => setField("assetName", e.target.value)}
                      placeholder="e.g. Nexus Infrastructure Bond Token (NIBT)"
                      required
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{ background: "#f9f8f6", border: "1px solid rgba(0,0,0,0.12)", color: "#111111" }}
                    />
                  </div>

                  {/* Asset Type */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Asset Type</label>
                    <div className="flex gap-2 flex-wrap">
                      {ASSET_TYPES.map(({ value, label }) => (
                        <button type="button" key={value}
                          onClick={() => setField("assetType", value)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                          style={{
                            background: form.assetType === value ? "rgba(26,86,219,0.10)" : "rgba(0,0,0,0.03)",
                            border: `1px solid ${form.assetType === value ? "rgba(26,86,219,0.35)" : "rgba(0,0,0,0.10)"}`,
                            color: form.assetType === value ? "#1d4ed8" : "#555555",
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(e) => setField("description", e.target.value)}
                      placeholder="Brief description of the asset, structure, and use of proceeds…"
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors resize-none"
                      style={{ background: "#f9f8f6", border: "1px solid rgba(0,0,0,0.12)", color: "#111111" }}
                    />
                  </div>

                  {/* Unit Price */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Unit Price (USD) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.unitPrice}
                      onChange={(e) => setField("unitPrice", e.target.value)}
                      placeholder="e.g. 1000"
                      required
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{ background: "#f9f8f6", border: "1px solid rgba(0,0,0,0.12)", color: "#111111" }}
                    />
                    <p className="text-[10px] text-slate-400 mt-1">This configured unit price will be reused later on the subscription page.</p>
                  </div>

                  {/* Total Token Supply */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Total Token Supply <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={form.totalSupply}
                      onChange={(e) => setField("totalSupply", e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="e.g. 100000"
                      required
                      className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors"
                      style={{ background: "#f9f8f6", border: "1px solid rgba(0,0,0,0.12)", color: "#111111" }}
                    />
                    {form.assetType === "TradeReceivable" && (
                      <p className="text-[10px] text-slate-400 mt-1">Trade Receivable also requires Unit Price — fill that in the Compliance page.</p>
                    )}
                  </div>

                  {/* Prospectus */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-0.5">
                      Prospectus / Term Sheet
                      <span className="ml-1 font-normal text-slate-400">(optional — for Intermediary compliance review)</span>
                    </label>
                    <p className="text-[10px] text-slate-400 mb-1.5">
                      Paste the full text. The intermediary will see it in their Sponsor Inbox and can run AI compliance review immediately.
                    </p>
                    <textarea
                      rows={10}
                      value={form.prospectusText}
                      onChange={(e) => setField("prospectusText", e.target.value)}
                      placeholder={"PROSPECTUS — ...\n\nISSUER & ELIGIBILITY\n...\n\nBOND TERMS & STRUCTURE\n..."}
                      className="w-full rounded-lg px-3 py-2.5 text-xs font-mono outline-none transition-colors resize-y"
                      style={{ background: "#f9f8f6", border: "1px solid rgba(0,0,0,0.12)", color: "#333333", minHeight: 200 }}
                    />
                  </div>
                </div>

                {submitError && (
                  <div className="text-xs text-red-600 rounded-lg px-3 py-2"
                    style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    {submitError}
                  </div>
                )}

                <button type="submit" disabled={submitting || !form.assetName.trim() || !form.unitPrice.trim() || !form.totalSupply.trim()}
                  className="w-full py-3 text-sm font-bold text-white rounded-xl transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #4f46e5 100%)" }}>
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting…
                    </>
                  ) : "Submit for Intermediary Review →"}
                </button>
              </form>
            )}
          </div>

          {/* ── Right: workflow + links ───────────────────────────────────── */}
          <div className="w-80 shrink-0 sticky top-6 space-y-4">

            {/* Issuance workflow */}
            <div className="rounded-xl p-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Issuance Workflow</div>
              <ol className="space-y-3">
                {([
                  ["1", "#1d4ed8", "Submit for Review",      "You are here — fill in asset details and submit to intermediary Sponsor Inbox."],
                  ["2", "#6366f1", "AI Compliance Check",    "Type 6 LC runs SFC compliance review at /compliance and files with the regulator."],
                  ["3", "#7c3aed", "SFC Approval",           "SFC reviews the application at /regulator/issuance and grants authorisation."],
                ] as [string, string, string, string][]).map(([num, color, title, desc]) => (
                  <li key={num} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 text-white"
                      style={{ background: color }}>
                      {num}
                    </span>
                    <div>
                      <div className="text-[12px] font-semibold text-slate-700">{title}</div>
                      <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{desc}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Quick links */}
            <div className="rounded-xl p-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Quick Links</div>
              <div className="space-y-1.5">
                {([
                  ["/compliance",         "AI Compliance Check"],
                  ["/regulator/issuance", "SFC Issuance Queue"],
                  ["/prospectus",         "Generate Prospectus"],
                ] as [string, string][]).map(([href, label]) => (
                  <a key={href} href={href}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-medium transition-colors group"
                    style={{ background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.06)", color: "#555555" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(26,86,219,0.05)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}>
                    <span>{label}</span>
                    <span style={{ color: "#aaaaaa" }}>→</span>
                  </a>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          VIEW: Deployment Portal (existing content)
      ══════════════════════════════════════════════════════════ */}
      {view === "deploy" && (
      <div>
        {/* ── Issuance flow banner ── */}
        <div className="rounded-xl mb-5 overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(99,102,241,0.18)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
          {/* Top row: flow steps */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-0 flex-wrap" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
            {([
              { n: "1", label: "Issuance Application", sub: "Fill in asset details & submit",          color: "#1d4ed8", bg: "rgba(29,78,216,0.10)" },
              { n: "2", label: "AI Compliance Review",  sub: "Intermediary runs AI compliance score",  color: "#7c3aed", bg: "rgba(124,58,237,0.09)" },
              { n: "3", label: "SFC Approval",          sub: "SFC reviews and authorises issuance",    color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
              { n: "4", label: "On-Chain Deployment",   sub: "Register issuance on Ethereum Sepolia",        color: "#10b981", bg: "rgba(16,185,129,0.10)" },
            ]).map((s, i, arr) => (
              <div key={s.n} className="flex items-center">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: s.bg }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ background: s.color }}>
                    {s.n}
                  </span>
                  <div>
                    <div className="text-[11px] font-semibold leading-none" style={{ color: s.color }}>{s.label}</div>
                    <div className="text-[10px] leading-snug mt-0.5" style={{ color: "#888888" }}>{s.sub}</div>
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <span className="mx-1.5 text-slate-300 text-xs shrink-0">→</span>
                )}
              </div>
            ))}
            <div className="ml-auto pl-4">
              <button onClick={() => setView("submit")}
                className="shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
                style={{ background: "#1d4ed8", color: "#ffffff" }}>
                Issuance Application →
              </button>
            </div>
          </div>

        </div>
        <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ── Left panel ── */}
        <div className="w-full lg:w-72 shrink-0 lg:sticky lg:top-6">
          <div className="rounded-xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="px-3 pt-3 pb-2 flex gap-1.5 flex-wrap" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
              {([
                ["All",               "All"],
                ["Deployed",          "Deployed"],
                ["Approved",          "Approved"],
                ["Pending SFC Review","Pending"],
                ["Changes Required",  "Changes"],
              ] as [string, string][]).map(([val, lbl]) => (
                <button key={val} onClick={() => setFilter(val as typeof filter)}
                  className="text-[10px] px-2.5 py-1 rounded-md transition-colors font-medium"
                  style={{
                    background: filter === val ? "rgba(99,102,241,0.12)" : "transparent",
                    border: `1px solid ${filter === val ? "rgba(99,102,241,0.4)" : "transparent"}`,
                    color: filter === val ? "#6366f1" : "#888888",
                  }}>
                  {lbl} <span className="opacity-60">{counts[val as keyof typeof counts]}</span>
                </button>
              ))}
            </div>
            <div>
              {loading ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400">No records</div>
              ) : filtered.map((rec) => {
                const cfg = STATUS_CFG[rec.status];
                const isSelected = selected?.id === rec.id;
                const isDeployed = !!deployMap[rec.id];
                return (
                  <button key={rec.id} onClick={() => setSelected(rec)} className="w-full text-left px-3 py-3 transition-colors"
                    style={{
                      background: isSelected ? "rgba(99,102,241,0.06)" : "transparent",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                      borderLeft: isSelected ? "3px solid #6366f1" : "3px solid transparent",
                    }}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-semibold text-slate-800 leading-tight truncate">{rec.asset || "Unnamed"}</span>
                      {isDeployed
                        ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0" style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)" }}>Deployed</span>
                        : <StatusBadge status={rec.status} />
                      }
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-500">{rec.type}</span>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-[10px] text-slate-400">{rec.submitted}</span>
                    </div>
                    {rec.sfcRef && (
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">{rec.sfcRef}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <span className="text-[10px]" style={{ color: cfg.color }}>{rec.status}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-3 py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}>
              <button onClick={() => void loadRecords()}
                className="w-full text-[10px] text-slate-500 hover:text-slate-700 py-1.5 rounded transition-colors"
                style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="w-full flex-1 min-w-0">
          {!selected ? (
            <div className="rounded-xl p-12 text-center" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>
              <div className="text-2xl mb-2">📋</div>
              <p className="text-sm text-slate-400">Select a record from the list to view details.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <div className="rounded-xl px-5 py-4 flex flex-col sm:flex-row items-start justify-between gap-4"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>
                <div>
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-800">{selected.asset}</h2>
                    <StatusBadge status={selected.status} />
                    {deploy && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase"
                        style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.3)" }}>
                        ✓ Deployed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{selected.issuer} · {selected.id}</p>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <div className="text-2xl font-bold" style={{ color: selected.complianceScore >= 70 ? "#10b981" : "#f59e0b" }}>
                    {selected.complianceScore}
                  </div>
                  <div className="text-[10px] text-slate-400">Compliance Score</div>
                </div>
              </div>

              {/* Detail cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl p-4 space-y-2.5"
                  style={{ background: selected.status === "Approved" ? "rgba(16,185,129,0.04)" : "rgba(245,158,11,0.04)", border: `1px solid ${selected.status === "Approved" ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">SFC Authorisation</div>
                  {([
                    ["SFC Reference",  selected.sfcRef ?? "—"],
                    ["Approved by",    selected.approvedBy ?? "Pending review"],
                    ["Approval Date",  selected.approvedAt ?? "—"],
                    ["Submission",     selected.submitted],
                    ["Status",         selected.status],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex flex-wrap justify-between gap-2 sm:gap-3 text-[11px]">
                      <span className="text-slate-500 shrink-0">{k}</span>
                      <span className={`font-mono text-right break-all ${k === "Status" ? (selected.status === "Approved" ? "text-emerald-700 font-bold" : "text-amber-600 font-bold") : "text-slate-700"}`}>{v}</span>
                    </div>
                  ))}
                  {selected.notes && (
                    <div className="text-[11px] text-red-600 rounded p-2 mt-1" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <span className="font-semibold">Changes: </span>{selected.notes}
                    </div>
                  )}
                </div>
                <div className="rounded-xl p-4 space-y-2.5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Issuance Details</div>
                  {([
                    ["Asset Type",       selected.type],
                    ["Total Issuance",   `${selected.totalIssuance} ${selected.currency}`],
                    ["Compliance Score", `${selected.complianceScore} / 100`],
                    ["Issuer",           selected.issuer || "—"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex flex-wrap justify-between gap-2 sm:gap-3 text-[11px]">
                      <span className="text-slate-500 shrink-0">{k}</span>
                      <span className={`font-mono text-right break-all ${k === "Compliance Score" ? (selected.complianceScore >= 70 ? "text-emerald-700 font-bold" : "text-amber-600 font-bold") : "text-slate-700"}`}>{v}</span>
                    </div>
                  ))}
                  {selected.auditHash && (
                    <div className="pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                      <div className="text-[10px] text-slate-400 mb-0.5">Audit Hash</div>
                      <div className="font-mono text-[10px] text-slate-600 break-all">{selected.auditHash.slice(0, 42)}...</div>
                    </div>
                  )}
                </div>
              </div>

              {/* SFC on-chain approval tx */}
              {selected.approvedTx && (
                <div className="rounded-xl px-4 py-3" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.2)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-violet-600 mb-1">SFC Approval Reference</div>
                  <div className="font-mono text-[11px] text-violet-700 break-all">{selected.approvedTx}</div>
                  <div className="text-[10px] text-violet-500 mt-0.5">Ethereum issuance registration is created in the next step.</div>
                </div>
              )}

              {/* Prospectus */}
              {selected.prospectusExcerpt && (
                <div className="rounded-xl px-4 py-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Prospectus Excerpt</div>
                  <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-4">{selected.prospectusExcerpt}</p>
                </div>
              )}

              {selected.status === "Approved" && ASSET_TYPES.some(({ value }) => value === selected.type) && (
                <div className="rounded-lg p-5" style={{ background: "#f5faf7", border: "1px solid rgba(5,150,105,0.28)" }}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Cleanverse CVA · Ethereum</div>
                      <h3 className="text-sm font-bold text-slate-800 mt-1">Launch compliant A-Token</h3>
                      <p className="text-[11px] text-slate-600 mt-1">The server derives the investor rule from the approved {selected.type} policy. Only ISSUED status opens subscriptions.</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: atokenApplication?.subscriptionOpen ? "#dcfce7" : "#fef3c7", color: atokenApplication?.subscriptionOpen ? "#166534" : "#92400e" }}>
                      {atokenApplication?.applyStatus ?? "NOT LAUNCHED"}
                    </span>
                  </div>

                  {!atokenApplication ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={ethereumAdminAddress}
                        onChange={(event) => setEthereumAdminAddress(event.target.value)}
                        placeholder="Ethereum admin address · 0x..."
                        className="min-w-0 flex-1 rounded px-3 py-2 text-xs font-mono text-slate-800 outline-none"
                        style={{ background: "#ffffff", border: "1px solid rgba(15,23,42,0.16)" }}
                      />
                      <button type="button" onClick={() => void connectEthereumWallet()} disabled={walletConnecting}
                        className="shrink-0 px-4 py-2 rounded text-xs font-bold disabled:opacity-50"
                        style={{ color: "#047857", background: "#ffffff", border: "1px solid rgba(4,120,87,0.35)" }}>
                        {walletConnecting ? "Connecting..." : wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
                      </button>
                      <button type="button" onClick={() => void launchCleanverseAToken()} disabled={atokenLoading || !/^0x[0-9a-fA-F]{40}$/.test(ethereumAdminAddress.trim())}
                        className="shrink-0 px-4 py-2 rounded text-xs font-bold text-white disabled:opacity-40" style={{ background: "#047857" }}>
                        {atokenLoading ? "Launching..." : "Launch A-Token"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {([[
                        "Request ID", atokenApplication.requestId,
                      ], [
                        "Symbol", atokenApplication.tokenSymbol,
                      ], [
                        "Chain", atokenApplication.chain,
                      ], [
                        "A-Token", atokenApplication.atokenAddress ?? "Pending issuance",
                      ], [
                        "Last sync", atokenApplication.lastSyncedAt,
                      ]] as [string, string][]).map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-4 text-[11px]"><span className="text-slate-500">{label}</span><span className="font-mono text-right break-all text-slate-700">{value}</span></div>
                      ))}
                      {!atokenApplication.subscriptionOpen && (
                        <button type="button" onClick={() => void syncCleanverseAToken()} disabled={atokenLoading}
                          className="w-full mt-2 py-2 rounded text-xs font-bold text-emerald-800 disabled:opacity-50" style={{ background: "#d1fae5", border: "1px solid rgba(5,150,105,0.24)" }}>
                          {atokenLoading ? "Syncing..." : "Sync Cleanverse Status"}
                        </button>
                      )}
                    </div>
                  )}
                  {atokenError && <p className="text-[11px] text-red-600 mt-3">{atokenError}</p>}
                  {(atokenApplication?.rejectReason || atokenApplication?.issueErrorMsg) && <p className="text-[11px] text-red-600 mt-3">{atokenApplication.rejectReason ?? atokenApplication.issueErrorMsg}</p>}
                </div>
              )}

              {selected.status === "Pending SFC Review" && !deploy && (
                <div className="rounded-xl p-4" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-1.5">Awaiting SFC Review</div>
                  <p className="text-xs text-slate-600">This application has been submitted and is pending review by the SFC regulator. Ethereum registration will be available once authorisation is granted.</p>
                </div>
              )}
              {selected.status === "Changes Required" && !deploy && (
                <div className="rounded-xl p-4" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-red-600 mb-1.5">Changes Required by SFC</div>
                  <p className="text-xs text-slate-600">The SFC regulator has requested amendments. Please review the notes above and resubmit via the compliance portal.</p>
                  <a href="/compliance" className="inline-block mt-2 text-[11px] font-semibold text-red-600 hover:underline">Go to Compliance Portal →</a>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
      )}
    </div>
  );
}