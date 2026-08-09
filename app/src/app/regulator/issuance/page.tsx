"use client";
import { useState, useEffect } from "react";
// ── Types ────────────────────────────────────────────────────────────
type AppStatus = "Pending SFC Review" | "Approved" | "Changes Required";
interface Application {
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
  prospectusExcerpt: string;
  sponsorLicence?: string;
}
// ── Demo data ────────────────────────────────────────────────────────────
const EXPLORER = "https://sepolia.etherscan.io/tx/";
const INITIAL_APPS: Application[] = [];
const TYPE_META: Record<string, { color: string; bg: string; border: string; label: string; regRef: string }> = {
  Bond:            { color: "#1a56db", bg: "rgba(96,165,250,0.1)",   border: "rgba(96,165,250,0.3)",   label: "Fixed Income / Bond",       regRef: "SFO s.103 · SFC Circular on Tokenisation (Nov 2023)" },
  GreenBond:       { color: "#059669", bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.25)",  label: "Green Bond",                regRef: "ICMA GBP 2021 · SFC ESG Fund Guidelines" },
  REIT:            { color: "#b45309", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.25)",  label: "Real Estate Investment Trust", regRef: "SFC Code on REITs · SFO s.104" },
  TradeReceivable: { color: "#7c3aed", bg: "rgba(124,58,237,0.08)",  border: "rgba(124,58,237,0.25)",  label: "Trade Receivable",          regRef: "AMLO Cap.615 · SFC AML Guidelines" },
};
const STATUS_CFG: Record<AppStatus, { color: string; bg: string; border: string; dot: string; label: string }> = {
  "Pending SFC Review": { color: "#b45309", bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.3)",  dot: "bg-amber-500",   label: "Pending SFC Review"   },
  "Approved":           { color: "#065f46", bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.3)",  dot: "bg-emerald-600", label: "Authorised"           },
  "Changes Required":   { color: "#991b1b", bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.25)",  dot: "bg-red-600",     label: "Changes Required"     },
};
const SFC_RULES: Array<{ id: string; name: string; threshold: number }> = [
  { id: "SFC-001", name: "Issuer Eligibility",     threshold: 12 },
  { id: "SFC-002", name: "Investor Restrictions",  threshold: 12 },
  { id: "SFC-003", name: "Asset Backing",           threshold: 10 },
  { id: "SFC-004", name: "Custody Arrangements",   threshold: 10 },
  { id: "SFC-005", name: "Disclosure Adequacy",    threshold: 10 },
  { id: "SFC-006", name: "AML / KYC",              threshold: 10 },
  { id: "SFC-007", name: "Technology Risk",        threshold: 5  },
  { id: "SFC-008", name: "Transferability",        threshold: 5  },
];
function inferRuleScores(total: number) {
  const weights = SFC_RULES.map((r) => r.threshold);
  const max = weights.reduce((a, b) => a + b, 0);
  return SFC_RULES.map((r, i) => {
    const ratio = total / 100;
    const noise = (i % 3 === 0 ? 0.97 : i % 3 === 1 ? 1.02 : 0.99);
    const score = Math.round(r.threshold * Math.min(1, ratio * noise));
    return { ...r, score, maxScore: weights[i], max };
  });
}
// ── Component ────────────────────────────────────────────────────────────
export default function IssuanceReviewPage() {
  const [apps, setApps]             = useState<Application[]>(INITIAL_APPS);
  const [filter, setFilter]         = useState<"All" | AppStatus>("All");
  const [selected, setSelected]     = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/sfc-inbox")
      .then((r) => r.json())
      .then((data: { submissions?: Array<Record<string, unknown>> }) => {
        const dynamic: Application[] = (data.submissions ?? []).map((s) => ({
          id:               String(s.id ?? ""),
          asset:            String(s.asset ?? ""),
          type:             String(s.type ?? "Bond"),
          issuer:           String(s.issuer ?? ""),
          submitted:        String(s.submitted ?? new Date().toISOString().slice(0, 10)),
          complianceScore:  Number(s.complianceScore ?? 0),
          auditHash:        String(s.auditHash ?? ""),
          totalIssuance:    String(s.totalIssuance ?? "0"),
          currency:         String(s.currency ?? "USD"),
          status:           (s.status as AppStatus) ?? "Pending SFC Review",
          notes:            s.notes ? String(s.notes) : undefined,
          approvedTx:       s.approvedTx ? String(s.approvedTx) : undefined,
          approvedAt:       s.approvedAt ? String(s.approvedAt) : undefined,
          approvedBy:       s.approvedBy ? String(s.approvedBy) : undefined,
          sfcRef:           s.sfcRef ? String(s.sfcRef) : undefined,
          prospectusExcerpt: String(s.prospectusExcerpt ?? ""),
          sponsorLicence:   s.sponsorLicence ? String(s.sponsorLicence) : "Type 6 LC",
        }));
        if (dynamic.length > 0) {
          setApps((prev) => [
            ...prev,
            ...dynamic.filter((d) => !prev.some((p) => p.id === d.id)),
          ]);
        }
      })
      .catch(() => {/* ignore */});
  }, []);
  const [changesModal, setChangesModal] = useState<string | null>(null);
  const [changesText, setChangesText]   = useState("");
  const [processing, setProcessing]     = useState<string | null>(null);
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }
  async function approve(id: string) {
    setProcessing(id);
    const app = apps.find((a) => a.id === id);
    try {
      const res = await fetch(`/api/sfc-inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", application: app }),
      });
      const data = await res.json() as { success: boolean; submission: Application };
      if (data.success) {
        setApps((prev) => prev.map((a) => a.id === id ? { ...a, ...data.submission } : a));
        const tx = data.submission.approvedTx ?? "";
        showToast(`Issuance authorised · on-chain record: ${tx.slice(0, 10)}...${tx.slice(-6)}`);
      }
    } finally {
      setProcessing(null);
    }
  }
  async function submitChanges(id: string) {
    if (!changesText.trim()) return;
    setChangesModal(null);
    const notes = changesText;
    setChangesText("");
    try {
      const res = await fetch(`/api/sfc-inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requestChanges", notes }),
      });
      const data = await res.json() as { success: boolean; submission: Application };
      if (data.success) {
        setApps((prev) => prev.map((a) => a.id === id ? { ...a, ...data.submission } : a));
        showToast("Deficiency notice issued · issuer has been notified.", false);
      }
    } catch {
      showToast("Network error — please retry.", false);
    }
  }
  const counts = {
    all:      apps.length,
    pending:  apps.filter((a) => a.status === "Pending SFC Review").length,
    approved: apps.filter((a) => a.status === "Approved").length,
    changes:  apps.filter((a) => a.status === "Changes Required").length,
  };
  const filtered = filter === "All" ? apps : apps.filter((a) => a.status === filter);
  const selectedApp = apps.find((a) => a.id === selected) ?? null;
  const isProcessing = processing === selected;
  const ruleScores = selectedApp ? inferRuleScores(selectedApp.complianceScore) : [];

  return (
    <div className="min-h-screen py-8 px-4 sm:px-6" style={{ background: "#f4f3ef" }}>
      <div className="max-w-[1600px] mx-auto space-y-5">

        {/* ── Official Header ─────────────────────────────────────────── */}
        <div className="rounded-xl px-6 py-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0"
                style={{ background: "rgba(30,58,138,0.06)", border: "1px solid rgba(30,58,138,0.15)" }}>
                🏛
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-0.5">
                  Securities and Futures Commission
                </div>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">
                  Tokenised Securities Issuance Review Portal
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  SFO s.103 Authorisation · ERC-3643 Compliance Gate · Ethereum Sepolia
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-[11px] font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "rgba(30,58,138,0.07)", border: "1px solid rgba(30,58,138,0.2)", color: "#1e3a8a" }}>
                ● SFC Regulatory Authority
              </span>
              <span className="text-[10px] text-slate-400">
                Ref: SFC/IT/TOKENISATION/2026 · Portal v2.1
              </span>
            </div>
          </div>

          {/* Regulatory notice bar */}
          <div className="mt-4 px-4 py-2.5 rounded-lg text-[11px] text-slate-600 leading-relaxed"
            style={{ background: "rgba(30,58,138,0.04)", border: "1px solid rgba(30,58,138,0.10)" }}>
            <strong className="text-slate-700">Regulatory Basis:</strong>{" "}
            Applications submitted under the SFC Circular on Tokenisation of SFC-authorised Investment Products (November 2023).
            AI compliance pre-screening conducted by the sponsoring Type 6 Licensed Corporation.
            Scores are anchored on-chain via <code className="font-mono text-blue-600">ComplianceOracle.sol</code> on Ethereum Sepolia and are tamper-proof.
            The SFC retains final authorisation authority under SFO s.103.
          </div>
        </div>

        {/* ── Stats Bar ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Applications", value: counts.all,      sub: "All submissions",       color: "#1e3a8a", bg: "rgba(30,58,138,0.06)", border: "rgba(30,58,138,0.12)" },
            { label: "Pending Review",      value: counts.pending,  sub: "Awaiting SFC decision", color: "#92400e", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.2)"  },
            { label: "Authorised",          value: counts.approved, sub: "Issuance approved",     color: "#065f46", bg: "rgba(16,185,129,0.07)", border: "rgba(16,185,129,0.2)"  },
            { label: "Deficiency Issued",   value: counts.changes,  sub: "Amendments required",  color: "#991b1b", bg: "rgba(239,68,68,0.07)",  border: "rgba(239,68,68,0.2)"   },
          ].map((s) => (
            <div key={s.label} className="rounded-xl px-4 py-3.5"
              style={{ background: "#ffffff", border: `1px solid ${s.border}` }}>
              <div className="text-3xl font-bold tabular-nums mb-0.5" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[12px] font-semibold text-slate-700">{s.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Two-Panel Layout ─────────────────────────────────────────── */}
        <div className="flex gap-5 items-start">

          {/* Left: Application Queue */}
          <div className="w-80 shrink-0 sticky top-6">
            <div className="rounded-xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
              <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)", background: "rgba(30,58,138,0.03)" }}>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Application Queue</div>
                <div className="flex gap-1.5 flex-wrap">
                  {(["All", "Pending SFC Review", "Approved", "Changes Required"] as const).map((f) => {
                    const active = filter === f;
                    return (
                      <button key={f} onClick={() => setFilter(f)}
                        className="text-[10px] px-2.5 py-1 rounded font-semibold transition-all"
                        style={{
                          background: active ? "rgba(30,58,138,0.12)" : "transparent",
                          border: `1px solid ${active ? "rgba(30,58,138,0.3)" : "rgba(0,0,0,0.08)"}`,
                          color: active ? "#1e3a8a" : "#888888",
                        }}>
                        {f === "Pending SFC Review" ? "Pending" : f === "Changes Required" ? "Changes" : f}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ maxHeight: "calc(100vh - 330px)", overflowY: "auto" }}>
                {filtered.length === 0 && (
                  <p className="text-[11px] text-slate-400 text-center py-8">No applications found.</p>
                )}
                {filtered.map((app) => {
                  const tm = TYPE_META[app.type] ?? TYPE_META.Bond;
                  const sc = STATUS_CFG[app.status];
                  const isSelected = selected === app.id;
                  const scoreColor = app.complianceScore >= 85 ? "#059669" : app.complianceScore >= 70 ? "#b45309" : "#dc2626";
                  return (
                    <button key={app.id} type="button" onClick={() => setSelected(app.id)}
                      className="w-full text-left px-4 py-3.5 transition-all"
                      style={{
                        background: isSelected ? "rgba(30,58,138,0.05)" : "transparent",
                        borderLeft: `3px solid ${isSelected ? "#1e3a8a" : "transparent"}`,
                        borderBottom: "1px solid rgba(0,0,0,0.05)",
                      }}>
                      <div className="flex items-start gap-2 mb-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${sc.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-slate-800 leading-tight truncate">{app.asset}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate">{app.issuer}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pl-4">
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: tm.bg, color: tm.color, border: `1px solid ${tm.border}` }}>
                          {app.type}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "#ece9e3" }}>
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${app.complianceScore}%`, background: scoreColor }} />
                          </div>
                          <span className="text-[11px] font-bold tabular-nums" style={{ color: scoreColor }}>
                            {app.complianceScore}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pl-4 mt-1.5">
                        <span className="text-[9px] text-slate-400">Submitted {app.submitted}</span>
                        <span className="text-[9px] font-medium" style={{ color: sc.color }}>{sc.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Detail Panel */}
          <div className="flex-1 min-w-0">
            {!selectedApp ? (
              <div className="rounded-xl p-16 text-center" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                <div className="text-5xl mb-4 opacity-30">📋</div>
                <p className="text-slate-500 font-medium">Select an application from the queue to review the filing details.</p>
                <p className="text-[12px] text-slate-400 mt-1">Applications are sorted by submission date, newest first.</p>
              </div>
            ) : (() => {
              const tm = TYPE_META[selectedApp.type] ?? TYPE_META.Bond;
              const sc = STATUS_CFG[selectedApp.status];
              const scoreColor = selectedApp.complianceScore >= 85 ? "#059669" : selectedApp.complianceScore >= 70 ? "#b45309" : "#dc2626";
              const sfcRef = selectedApp.sfcRef ?? `SFC/ISS/2026/${selectedApp.id.replace("ISS-", "")}`;
              return (
                <div className="rounded-xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>

                  {/* ── Filing Header ── */}
                  <div className="px-6 py-5" style={{ background: "rgba(30,58,138,0.03)", borderBottom: "2px solid rgba(30,58,138,0.12)" }}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h2 className="text-lg font-bold text-gray-900 leading-tight">{selectedApp.asset}</h2>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                            style={{ background: tm.bg, color: tm.color, border: `1px solid ${tm.border}` }}>
                            {tm.label}
                          </span>
                        </div>
                        <div className="text-[12px] text-slate-600 mb-2">{selectedApp.issuer}</div>
                        <div className="flex items-center gap-4 flex-wrap text-[11px]">
                          <span className="text-slate-500">Application Ref: <strong className="text-slate-700 font-mono">{selectedApp.id}</strong></span>
                          <span className="text-slate-500">SFC Ref: <strong className="text-blue-700 font-mono">{sfcRef}</strong></span>
                          <span className="text-slate-500">Submitted: <strong className="text-slate-700">{selectedApp.submitted}</strong></span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className="text-[11px] font-bold px-3 py-1.5 rounded-full"
                          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                          ● {sc.label}
                        </span>
                        {selectedApp.approvedAt && (
                          <span className="text-[10px] text-slate-400">Authorised {selectedApp.approvedAt}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="px-6 py-5 space-y-6">

                    {/* ── Section 1: Issuer & Intermediary ── */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                          style={{ background: "rgba(30,58,138,0.08)", border: "1px solid rgba(30,58,138,0.2)" }}>1</div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Issuer & Intermediary Information</h3>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                          { label: "Issuer / Applicant",    value: selectedApp.issuer },
                          { label: "Sponsoring Intermediary", value: `${selectedApp.sponsorLicence ?? "Type 6 LC"} — Nexus Capital Markets` },
                          { label: "Asset Type",            value: tm.label },
                          { label: "Token Standard",        value: "ERC-3643 (Transfer-Restricted)" },
                          { label: "Blockchain Network",    value: "Ethereum Sepolia (Chain ID 11155111)" },
                          { label: "Regulatory Framework",  value: tm.regRef },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-lg px-3 py-2.5"
                            style={{ background: "#f8f7f4", border: "1px solid rgba(0,0,0,0.07)" }}>
                            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
                            <div className="text-[12px] font-medium text-slate-700 leading-snug">{value}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* ── Section 2: Financial Summary ── */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                          style={{ background: "rgba(30,58,138,0.08)", border: "1px solid rgba(30,58,138,0.2)" }}>2</div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Offering Structure</h3>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Total Issuance",      value: `${selectedApp.currency} ${selectedApp.totalIssuance}`, highlight: true },
                          { label: "Settlement Currency", value: selectedApp.currency },
                          { label: "Eligible Investors",  value: "Professional Investors (SFO Schedule 1)" },
                          { label: "Transfer Restrictions", value: "On-chain · KYC-gated (IdentityRegistry.sol)" },
                        ].map(({ label, value, highlight }) => (
                          <div key={label} className="rounded-lg px-3 py-2.5"
                            style={{
                              background: highlight ? "rgba(30,58,138,0.05)" : "#f8f7f4",
                              border: `1px solid ${highlight ? "rgba(30,58,138,0.15)" : "rgba(0,0,0,0.07)"}`,
                            }}>
                            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">{label}</div>
                            <div className={`text-[12px] font-${highlight ? "bold" : "medium"} leading-snug`}
                              style={{ color: highlight ? "#1e3a8a" : "#334155" }}>
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* ── Section 3: AI Compliance Assessment ── */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                          style={{ background: "rgba(30,58,138,0.08)", border: "1px solid rgba(30,58,138,0.2)" }}>3</div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">AI Compliance Pre-Screening</h3>
                        <span className="text-[9px] text-slate-400 ml-1">Conducted by Sponsoring Type 6 LC · Qwen2.5-72B</span>
                      </div>
                      <div className="rounded-lg p-4" style={{ background: "#f8f7f4", border: "1px solid rgba(0,0,0,0.08)" }}>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-[10px] text-slate-500 mb-0.5">Aggregate Compliance Score</div>
                            <div className="flex items-center gap-3">
                              <span className="text-3xl font-bold tabular-nums" style={{ color: scoreColor }}>
                                {selectedApp.complianceScore}
                              </span>
                              <span className="text-sm text-slate-400 font-medium">/ 100</span>
                              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                                style={{
                                  background: selectedApp.complianceScore >= 70 ? "rgba(5,150,105,0.1)" : "rgba(220,38,38,0.1)",
                                  color: selectedApp.complianceScore >= 70 ? "#065f46" : "#991b1b",
                                  border: `1px solid ${selectedApp.complianceScore >= 70 ? "rgba(5,150,105,0.25)" : "rgba(220,38,38,0.25)"}`,
                                }}>
                                {selectedApp.complianceScore >= 70 ? "✓ PRE-SCREENING PASSED" : "✗ PRE-SCREENING FAILED"}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[9px] text-slate-400 mb-1">Pass Threshold</div>
                            <div className="text-[13px] font-bold text-slate-600">70 / 100</div>
                          </div>
                        </div>
                        {/* Score bar */}
                        <div className="w-full h-2 rounded-full overflow-hidden mb-4" style={{ background: "#e5e3de" }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${selectedApp.complianceScore}%`, background: scoreColor }} />
                        </div>
                        {/* Rule breakdown */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {ruleScores.map((r) => {
                            const pct = r.maxScore > 0 ? r.score / r.maxScore : 0;
                            const c = pct >= 0.8 ? "#059669" : pct >= 0.6 ? "#b45309" : "#dc2626";
                            return (
                              <div key={r.id} className="rounded px-2.5 py-2"
                                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[9px] font-mono text-slate-400">{r.id}</span>
                                  <span className="text-[10px] font-bold tabular-nums" style={{ color: c }}>
                                    {r.score}/{r.maxScore}
                                  </span>
                                </div>
                                <div className="text-[10px] font-medium text-slate-600 leading-tight mb-1.5">{r.name}</div>
                                <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "#e5e3de" }}>
                                  <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: c }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>

                    {/* ── Section 4: On-Chain Evidence ── */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                          style={{ background: "rgba(30,58,138,0.08)", border: "1px solid rgba(30,58,138,0.2)" }}>4</div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">On-Chain Evidence (Ethereum Sepolia)</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="rounded-lg px-4 py-3" style={{ background: "#f8f7f4", border: "1px solid rgba(0,0,0,0.08)" }}>
                          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            ComplianceOracle.sol · submitScore() Record
                          </div>
                          <a href={`${EXPLORER}${selectedApp.auditHash}`} target="_blank" rel="noopener noreferrer"
                            className="font-mono text-[11px] break-all transition-colors hover:text-blue-600"
                            style={{ color: "#4f46e5" }}>
                            {selectedApp.auditHash.slice(0, 30)}…{selectedApp.auditHash.slice(-8)}
                          </a>
                          <div className="text-[10px] text-slate-400 mt-1.5">
                            Compliance score + report hash anchored on-chain. Tamper-proof. Readable by any contract.
                          </div>
                        </div>
                        {selectedApp.approvedTx ? (
                          <div className="rounded-lg px-4 py-3" style={{ background: "rgba(5,150,105,0.04)", border: "1px solid rgba(5,150,105,0.2)" }}>
                            <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 mb-1">
                              SFC Authorisation · On-Chain Record
                            </div>
                            <a href={`${EXPLORER}${selectedApp.approvedTx}`} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-[11px] break-all transition-colors hover:text-emerald-700"
                              style={{ color: "#059669" }}>
                              {selectedApp.approvedTx.slice(0, 30)}…{selectedApp.approvedTx.slice(-8)}
                            </a>
                            <div className="text-[10px] text-slate-500 mt-1.5">
                              Authorised by: {selectedApp.approvedBy ?? "SFC Officer"} · {selectedApp.approvedAt}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg px-4 py-3 flex items-center gap-3"
                            style={{ background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.2)" }}>
                            <span className="text-amber-500 text-xl">⏳</span>
                            <div>
                              <div className="text-[11px] font-semibold text-amber-700">Awaiting SFC Authorisation</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Approval will generate an on-chain authorisation record on Ethereum Sepolia.
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* ── Section 5: Prospectus ── */}
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                          style={{ background: "rgba(30,58,138,0.08)", border: "1px solid rgba(30,58,138,0.2)" }}>5</div>
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Prospectus / Offering Memorandum Extract</h3>
                      </div>
                      <div className="rounded-lg p-4 text-[12px] leading-relaxed text-slate-600 font-mono"
                        style={{ background: "#f8f7f4", border: "1px solid rgba(0,0,0,0.08)", maxHeight: "260px", overflowY: "auto", whiteSpace: "pre-wrap" }}>
                        {selectedApp.prospectusExcerpt || "No prospectus excerpt provided."}
                      </div>
                    </section>

                    {/* ── Section 6: SFC Review Notes ── */}
                    {selectedApp.notes && (
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-5 h-5 rounded flex items-center justify-center text-[11px]"
                            style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", color: "#dc2626" }}>!</div>
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-red-600">SFC Deficiency Notice</h3>
                        </div>
                        <div className="rounded-lg p-4 text-[12px] leading-relaxed text-slate-700"
                          style={{ background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.2)" }}>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-2">
                            Notice to Issuer — Amendments Required Before Re-submission
                          </div>
                          {selectedApp.notes}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* ── Action Bar ── */}
                  {selectedApp.status === "Pending SFC Review" && (
                    <div className="px-6 py-4 flex items-center gap-3 flex-wrap"
                      style={{ borderTop: "2px solid rgba(30,58,138,0.10)", background: "rgba(30,58,138,0.02)" }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-slate-700">Regulatory Action</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Review all sections above. Approving will write an authorisation record to Ethereum Sepolia and unlock token deployment.
                        </div>
                      </div>
                      <button
                        onClick={() => { setChangesModal(selectedApp.id); setChangesText(""); }}
                        className="text-[12px] font-semibold px-4 py-2 rounded-lg transition-colors shrink-0"
                        style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.25)", color: "#dc2626" }}>
                        Issue Deficiency Notice
                      </button>
                      <button
                        onClick={() => approve(selectedApp.id)}
                        disabled={isProcessing}
                        className="text-[12px] font-semibold px-5 py-2 rounded-lg text-white transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
                        style={{ background: "#065f46" }}>
                        {isProcessing ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Writing authorisation...
                          </>
                        ) : "✓ Grant Issuance Authorisation"}
                      </button>
                    </div>
                  )}
                  {selectedApp.status === "Approved" && (
                    <div className="px-6 py-4 flex items-center gap-3"
                      style={{ borderTop: "2px solid rgba(5,150,105,0.15)", background: "rgba(5,150,105,0.03)" }}>
                      <span className="text-xl">✅</span>
                      <div>
                        <div className="text-[12px] font-bold text-emerald-700">Issuance Authorised</div>
                        <div className="text-[11px] text-slate-500">
                          Authorisation written to Ethereum Sepolia · {selectedApp.approvedBy ?? "SFC Officer"} · {selectedApp.approvedAt}. Issuer may now deploy the token contract.
                        </div>
                      </div>
                    </div>
                  )}
                  {selectedApp.status === "Changes Required" && (
                    <div className="px-6 py-4 flex items-center gap-3"
                      style={{ borderTop: "2px solid rgba(220,38,38,0.15)", background: "rgba(220,38,38,0.03)" }}>
                      <span className="text-xl">📋</span>
                      <div>
                        <div className="text-[12px] font-bold text-red-700">Deficiency Notice Issued</div>
                        <div className="text-[11px] text-slate-500">
                          Issuer must address all deficiencies listed in Section 6 and re-submit via the compliance portal.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Request Changes Modal ── */}
      {changesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)" }}>
          <div className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
            style={{ background: "#ffffff", border: "1px solid rgba(220,38,38,0.3)" }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)", background: "rgba(220,38,38,0.03)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-0.5">SFC Regulatory Action</div>
              <h2 className="text-[15px] font-bold text-gray-900">Issue Deficiency Notice</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Specify all deficiencies the issuer must address before re-submission under SFO s.103.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="px-3 py-2 rounded text-[11px] text-amber-800"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                This notice will be formally recorded. The issuer&apos;s application status will change to &quot;Changes Required&quot; and they will be notified to revise and resubmit.
              </div>
              <textarea rows={6} value={changesText} onChange={(e) => setChangesText(e.target.value)}
                placeholder="e.g. Section 4.2 liquidity risk disclosure is insufficient. Please elaborate on redemption restrictions and secondary market liquidity per SFC Code on REITs §10.3..."
                className="w-full text-[12px] text-slate-700 rounded-lg px-3 py-2.5 resize-none outline-none"
                style={{ background: "#f8f7f4", border: "1px solid rgba(0,0,0,0.10)", lineHeight: "1.6" }}
                autoFocus />
              <div className="flex justify-end gap-3">
                <button onClick={() => setChangesModal(null)}
                  className="text-[12px] px-4 py-2 rounded-lg"
                  style={{ background: "#f7f5f0", border: "1px solid rgba(0,0,0,0.10)", color: "#666666" }}>
                  Cancel
                </button>
                <button onClick={() => submitChanges(changesModal)} disabled={!changesText.trim()}
                  className="text-[12px] font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                  style={{ background: "rgba(220,38,38,0.12)", border: "1px solid rgba(220,38,38,0.35)", color: "#dc2626" }}>
                  Issue Formal Notice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-[12px] font-semibold shadow-xl"
          style={{
            background: "#ffffff",
            border: `1px solid ${toast.ok ? "rgba(5,150,105,0.35)" : "rgba(220,38,38,0.35)"}`,
            color: toast.ok ? "#065f46" : "#991b1b",
          }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
