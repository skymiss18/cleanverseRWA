"use client";



import { useState, useEffect } from "react";

import type { AuditReport, AuditFinding, AuditSeverity } from "@/lib/audit";



// ── Types ─────────────────────────────────────────────────────────────────────



interface ContractSource {

  fileName: string;

  source: string;

  lines: number;

  functions: string[];

}



// ── Design tokens (enterprise navy palette) ───────────────────────────────────



const S: Record<AuditSeverity, { badge: string; text: string }> = {

  Critical:      { badge: "bg-red-900/50 text-red-300 border border-red-700/60",           text: "text-red-700"    },

  High:          { badge: "bg-orange-900/50 text-orange-300 border border-orange-700/60",  text: "text-orange-700" },

  Medium:        { badge: "bg-amber-900/50 text-amber-300 border border-amber-700/60",     text: "text-amber-700"  },

  Low:           { badge: "bg-blue-900/50 text-blue-300 border border-blue-700/60",        text: "text-blue-700"   },

  Informational: { badge: "bg-slate-800 text-slate-300 border border-slate-600",           text: "text-slate-700"  },

};



// ── Source Code Modal ─────────────────────────────────────────────────────────



function SourceModal({ contract, onClose }: { contract: ContractSource; onClose: () => void }) {

  const lines = contract.source.split("\n");

  return (

    <div

      className="fixed inset-0 z-50 flex items-center justify-center p-4"

      style={{ background: "rgba(2,8,18,0.88)", backdropFilter: "blur(4px)" }}

      onClick={onClose}

    >

      <div

        className="w-full max-w-5xl rounded flex flex-col overflow-hidden"

        style={{ maxHeight: "88vh", background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}

        onClick={(e) => e.stopPropagation()}

      >

        {/* Header */}

        <div className="flex items-center justify-between px-5 py-3 shrink-0"

          style={{ background: "#f3f1eb", borderBottom: "1px solid rgba(0,0,0,0.10)" }}>

          <div className="flex items-center gap-3 flex-wrap">

            <span className="font-mono text-sm font-semibold text-blue-300">{contract.fileName}</span>

            <span className="text-xs text-slate-500">{contract.lines} lines</span>

            <span className="text-xs text-slate-500">{contract.functions.length} functions</span>

            {contract.functions.length > 0 && (

              <span className="text-xs text-slate-600 font-mono">

                {contract.functions.slice(0, 6).join(", ")}{contract.functions.length > 6 ? "..." : ""}

              </span>

            )}

          </div>

          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg px-2 transition-colors">×</button>

        </div>

        {/* Code */}

        <div className="overflow-auto flex-1" style={{ background: "#ffffff" }}>

          <table className="w-full" style={{ borderCollapse: "collapse" }}>

            <tbody>

              {lines.map((line, i) => (

                <tr key={i} className="hover:bg-blue-900/10 transition-colors">

                  <td className="select-none text-right pr-4 pl-4 font-mono text-slate-600 shrink-0 align-top"

                    style={{ minWidth: "3.5rem", fontSize: "11px", paddingTop: "1px", paddingBottom: "1px", userSelect: "none" }}>

                    {i + 1}

                  </td>

                  <td className="font-mono text-slate-200 pr-6 whitespace-pre align-top"

                    style={{ fontSize: "12px", paddingTop: "1px", paddingBottom: "1px" }}>

                    {line || " "}

                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </div>

    </div>

  );

}



// ── Contracts In Scope Panel ──────────────────────────────────────────────────



const CONTRACT_DESC: Record<string, string> = {

  "HarbourRWAToken.sol":    "ERC-3643 token ...compliance-gated mint & transfer",

  "ComplianceModule.sol":   "KYC eligibility + AI oracle score enforcement",

  "ComplianceOracle.sol":   "On-chain AI compliance score storage",

  "IdentityRegistry.sol":   "Investor KYC whitelist registry",

  "YieldAggregator.sol":    "Coupon / dividend proceeds routing",

};



function ContractsPanel({ contracts, onViewSource }: { contracts: ContractSource[]; onViewSource: (c: ContractSource) => void }) {

  return (

    <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>

        <div className="px-5 pt-4 pb-2 flex items-center justify-between">

          <span className="text-sm font-semibold text-slate-300">Contracts in Scope</span>

          <span className="text-xs text-slate-500">{contracts.length} files · Click name to view source</span>

        </div>

      <table className="w-full">

        <thead>

          <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>

            <th className="text-left px-5 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Contract</th>

            <th className="text-left px-4 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Description</th>

            <th className="text-right px-4 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Lines</th>

            <th className="text-right px-5 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Functions</th>

          </tr>

        </thead>

        <tbody>

          {contracts.map((c, i) => (

            <tr key={c.fileName} className="hover:bg-blue-900/8 transition-colors"

              style={{ borderBottom: i < contracts.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }}>

              <td className="px-5 py-2.5">

                <button onClick={() => onViewSource(c)}

                  className="font-mono text-xs font-semibold text-blue-400 hover:text-blue-200 transition-colors underline-offset-2 hover:underline">

                  {c.fileName}

                </button>

              </td>

              <td className="px-4 py-2.5 text-xs text-slate-400">{CONTRACT_DESC[c.fileName] ?? "—"}</td>

              <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-400">{c.lines}</td>

              <td className="px-5 py-2.5 text-right font-mono text-xs text-slate-400">{c.functions.length}</td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>

  );

}



// ── Finding Row ───────────────────────────────────────────────────────────────



function FindingRow({ finding, contractMap, onViewSource }: {

  finding: AuditFinding;

  contractMap: Map<string, ContractSource>;

  onViewSource: (c: ContractSource) => void;

}) {

  const [open, setOpen] = useState(false);

  const style = S[finding.severity] ?? S.Informational;

  const linkedFile = [...contractMap.keys()].find((k) => finding.location.includes(k));



  return (

    <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>

      <td className="px-5 py-3 align-top font-mono text-xs text-slate-500 whitespace-nowrap">{finding.id}</td>

      <td className="px-3 py-3 align-top font-mono text-xs text-slate-500 whitespace-nowrap">

        {finding.swcId ?? <span className="text-slate-700"></span>}

      </td>

      <td className="px-3 py-3 align-top">

        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${style.badge}`}>

          {finding.severity}

        </span>

      </td>

      <td className="px-4 py-3 align-top w-full">

        <button onClick={() => setOpen((o) => !o)}

          className="text-sm font-medium text-slate-200 hover:text-white text-left transition-colors block">

          {finding.title}

        </button>

        <div className="mt-0.5">

          {linkedFile ? (

            <button onClick={() => onViewSource(contractMap.get(linkedFile)!)}

              className="text-[10px] font-mono text-blue-500 hover:text-blue-300 transition-colors">

              {finding.location}

            </button>

          ) : (

            <span className="text-[10px] font-mono text-slate-600">{finding.location}</span>

          )}

        </div>

        {open && (

          <div className="mt-3 space-y-2">

            <p className="text-xs text-slate-400 leading-relaxed">{finding.description}</p>

            {finding.poc && (

              <div className="rounded p-2.5 text-xs"

                style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>

                <p className="text-red-400 font-semibold text-[10px] uppercase tracking-wide mb-1">Proof of Concept</p>

                <p className="text-slate-400">{finding.poc}</p>

              </div>

            )}

            <div className="rounded p-2.5 text-xs"

              style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>

              <p className="text-emerald-400 font-semibold text-[10px] uppercase tracking-wide mb-1">Recommendation</p>

              <p className="text-slate-400">{finding.recommendation}</p>

            </div>

          </div>

        )}

      </td>

      <td className="px-3 py-3 align-top">

        <button onClick={() => setOpen((o) => !o)}

          className="text-slate-600 hover:text-slate-400 text-xs transition-colors">

          {open ? "▲" : "▼"}

        </button>

      </td>

    </tr>

  );

}



// ── Full Report View ──────────────────────────────────────────────────────────



function ReportView({ report, contracts, onViewSource }: {

  report: AuditReport;

  contracts: ContractSource[];

  onViewSource: (c: ContractSource) => void;

}) {

  const { findingSummary: s } = report;

  const contractMap = new Map(contracts.map((c) => [c.fileName, c]));

  const sevCols: { sev: AuditSeverity; count: number }[] = [

    { sev: "Critical",      count: s.critical      },

    { sev: "High",          count: s.high          },

    { sev: "Medium",        count: s.medium        },

    { sev: "Low",           count: s.low           },

    { sev: "Informational", count: s.informational },

  ];



  return (

    <div className="space-y-5">



      {/* Status banner */}

      <div className="rounded p-4 flex items-center justify-between"

        style={{

          background: report.passed ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.07)",

          border: `1px solid ${report.passed ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.25)"}`,

        }}>

        <div>

          <div className="text-sm font-semibold text-gray-900">{report.projectName} ...Security Audit Report</div>

          <div className="text-xs text-slate-600 mt-0.5">

            {report.auditor} · {new Date(report.auditedAt).toLocaleString()} · Solidity {report.solidityVersion}

          </div>

        </div>

        <div className="text-right shrink-0">

          <div className={`text-sm font-bold ${report.passed ? "text-emerald-700" : "text-red-700"}`}>

            {report.passed ? "...PASSED" : "...ACTION REQUIRED"}

          </div>

          <div className={`text-xs mt-0.5 ${S[report.overallRisk]?.text}`}>Overall Risk: {report.overallRisk}</div>

        </div>

      </div>



      {/* Executive summary */}

      <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>

        <div className="px-5 pt-4 pb-2">

          <span className="text-sm font-semibold text-slate-300">Executive Summary</span>

        </div>

        <div className="p-5 pt-2">

          <div className="grid grid-cols-5 gap-3 mb-4">

            {sevCols.map(({ sev, count }) => (

              <div key={sev} className={`rounded p-3 text-center ${S[sev].badge}`}>

                <div className="text-2xl font-bold">{count}</div>

                <div className="text-[10px] uppercase tracking-wide mt-0.5 opacity-80">{sev}</div>

              </div>

            ))}

          </div>

          <p className="text-xs text-slate-400 leading-relaxed">{report.conclusion}</p>

        </div>

      </div>



      {/* Contracts in scope */}

      {contracts.length > 0 && <ContractsPanel contracts={contracts} onViewSource={onViewSource} />}



      {/* Audit methods */}

      <div className="flex flex-wrap gap-2">

        {report.auditMethods.map((m) => (

          <span key={m} className="text-[11px] px-2.5 py-1 rounded text-slate-400"

            style={{ background: "#f3f1eb", border: "1px solid rgba(0,0,0,0.10)" }}>

            {m}

          </span>

        ))}

      </div>



      {/* Findings */}

      <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>

        <div className="px-5 pt-4 pb-2 flex items-center justify-between">

          <span className="text-sm font-semibold text-slate-300">Findings</span>

          <span className="text-xs text-slate-500">{report.findings.length} total</span>

        </div>

        {report.findings.length > 0 ? (

          <table className="w-full">

            <thead>

              <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>

                <th className="text-left px-5 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">ID</th>

                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">SWC</th>

                <th className="text-left px-3 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Severity</th>

                <th className="text-left px-4 py-2 text-[10px] text-slate-500 font-medium uppercase tracking-wide">Title / Location</th>

                <th className="px-3 py-2"></th>

              </tr>

            </thead>

            <tbody>

              {report.findings.map((f) => (

                <FindingRow key={f.id} finding={f} contractMap={contractMap} onViewSource={onViewSource} />

              ))}

            </tbody>

          </table>

        ) : (

          <div className="px-5 py-8 text-center">

            <div className="text-emerald-400 text-sm font-medium">No vulnerabilities found</div>

            <div className="text-slate-500 text-xs mt-1">All contracts passed all security checks</div>

          </div>

        )}

      </div>



      {/* On-chain hash */}

      <div className="rounded p-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>

        <details className="group">

          <summary className="cursor-pointer list-none select-none flex items-center gap-2 text-[10px] text-slate-500 hover:text-slate-400 transition-colors uppercase tracking-wider font-medium">

            <span>Audit Fingerprint ...On-Chain Proof</span>

            <span className="group-open:hidden normal-case tracking-normal">...view</span>

            <span className="hidden group-open:inline normal-case tracking-normal">...hide</span>

          </summary>

          <code className="text-xs text-blue-300 mt-2 block break-all">{report.auditHash}</code>

          <p className="text-[11px] text-slate-600 mt-2">

            This fingerprint is a unique cryptographic hash of the audit results. It is recorded on the blockchain so the audit can never be backdated or altered.

          </p>

        </details>

      </div>

    </div>

  );

}



// ── Page ──────────────────────────────────────────────────────────────────────



export default function AuditPage() {

  const [contracts, setContracts] = useState<ContractSource[]>([]);

  const [report, setReport] = useState<AuditReport | null>(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [sourceModal, setSourceModal] = useState<ContractSource | null>(null);



  useEffect(() => {

    fetch("/api/audit/sources")

      .then((r) => r.json())

      .then((d) => { if (d.contracts) setContracts(d.contracts); })

      .catch(() => {});

  }, []);



  async function runAudit() {

    setLoading(true);

    setError(null);

    setReport(null);

    try {

      const res = await fetch("/api/audit/contract", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ projectName: "HarbourRWA" }),

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setReport(data);

    } catch (err) {

      setError(err instanceof Error ? err.message : "Audit failed");

    } finally {

      setLoading(false);

    }

  }



  return (

    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">



      {/* Page header */}

      <div className="mb-7 pb-5" style={{ borderBottom: "1px solid #152538" }}>

        <div className="rounded-lg px-3 py-2.5 text-xs mb-5" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>

          <span className="font-semibold text-amber-400 uppercase tracking-wide text-[10px]">Type 6 LC · Intermediary Tool</span>

          <p className="text-slate-500 mt-1">Technical due diligence conducted by the Intermediary (Type 6 LC / Sponsor) before SFC filing. The audit hash is anchored on-chain to ComplianceOracle.sol as a tamper-proof record.</p>

        </div>

        <div className="flex items-start justify-between gap-4">

          <div>

            <h1 className="text-2xl font-bold text-gray-900">Smart Contract Audit</h1>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium" style={{ background: "rgba(99,102,241,0.08)", color: "#4f46e5", border: "1px solid rgba(99,102,241,0.18)" }}>
              <span>Conducted by NexusRWA AI Audit Engine</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500 font-normal">Independent of reviewing Intermediary (Type 6 LC)</span>
            </div>

            <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">

              AI-powered security audit following the{" "}

              <span className="text-blue-400">SWC Registry</span>{" "}

              and industry best practices. Click any contract name to inspect its source code.

            </p>

          </div>

          <button

            onClick={runAudit}

            disabled={loading}

            className="shrink-0 text-sm font-semibold rounded px-5 py-2.5 transition-colors disabled:opacity-40 text-white"

            style={{ background: "#1d4ed8" }}

          >

            {loading ? "Auditing..." : "Run Audit"}

          </button>

        </div>

      </div>



      {/* Method items */}

      <div className="flex flex-wrap gap-6 mb-6 pb-6" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>

        {[

          { label: "Static Analysis",  desc: "SWC-100 through SWC-115 pattern matching" },

          { label: "AI Deep Audit",    desc: "Qwen2.5-72B ...logic, access control, compliance bypass" },

          { label: "On-Chain Proof",   desc: "Audit fingerprint permanently anchored on Casper blockchain ...tamper-proof, publicly verifiable" },

        ].map((m) => (

          <div key={m.label}>

            <div className="text-xs font-semibold text-blue-400 mb-0.5">{m.label}</div>

            <div className="text-[11px] text-slate-500">{m.desc}</div>

          </div>

        ))}

      </div>



      {/* Contracts in scope (always visible) */}

      {contracts.length > 0 && (

        <div className="mb-6">

          <ContractsPanel contracts={contracts} onViewSource={setSourceModal} />

        </div>

      )}



      {/* Loading */}

      {loading && (

        <div className="flex items-center gap-4 rounded p-5"

          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>

          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />

          <div>

            <div className="text-sm font-medium text-white">Running security audit...</div>

            <div className="text-xs text-slate-500 mt-0.5">Static analysis + AI deep audit (Qwen2.5-72B)</div>

          </div>

        </div>

      )}



      {/* Error */}

      {error && (

          <div className="rounded p-4 text-sm text-red-600"

          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)" }}>

          {error}

        </div>

      )}



      {/* Report */}

      {report && (

        <>

          <ReportView report={report} contracts={contracts} onViewSource={setSourceModal} />

          <button

            onClick={runAudit}

            className="mt-5 w-full py-2.5 text-sm text-slate-500 hover:text-slate-300 rounded transition-colors"

            style={{ border: "1px solid rgba(0,0,0,0.10)" }}

          >

            Re-run Audit

          </button>

        </>

      )}



      {/* Source modal */}

      {sourceModal && <SourceModal contract={sourceModal} onClose={() => setSourceModal(null)} />}

    </div>

  );

}

