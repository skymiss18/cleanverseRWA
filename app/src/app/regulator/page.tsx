"use client";



import { useState } from "react";



// ── Demo data ─────────────────────────────────────────────────────────────────



const EXPLORER = process.env.NEXT_PUBLIC_CHAIN_ID === "5000"

  ? "https://cspr.live/deploy/"

  : "https://testnet.cspr.live/deploy/";



const RECORDS = [

  {

    id: "OC-2026-001",

    asset: "Nexus Institutional Bond Token",

    type: "Bond",

    issuer: "Nexus Capital Markets Corp",

    score: 94,

    status: "Compliant",

    txHash: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",

    date: "2026-05-22",

  },

  {

    id: "OC-2026-002",

    asset: "Green Infrastructure Fund Token",

    type: "GreenBond",

    issuer: "Asia Green Capital Ltd",

    score: 88,

    status: "Compliant",

    txHash: "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c",

    date: "2026-05-21",

  },

  {

    id: "OC-2026-003",

    asset: "Kowloon Commercial REIT Token",

    type: "REIT",

    issuer: "Asia Property Trust Management",

    score: 72,

    status: "Review Required",

    txHash: "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d",

    date: "2026-05-20",

  },

  {

    id: "OC-2026-004",

    asset: "Trade Finance Receivable Token",

    type: "TradeReceivable",

    issuer: "Pacific Trade Finance Ltd",

    score: 91,

    status: "Compliant",

    txHash: "0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e",

    date: "2026-05-19",

  },

  {

    id: "OC-2026-005",

    asset: "Casper Sovereign Bond Token",

    type: "Bond",

    issuer: "Casper Financial Group",

    score: 65,

    status: "Pending Review",

    txHash: "0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f",

    date: "2026-05-18",

  },

];



const KYC_STATS = { pending: 3, reviewing: 1, approved: 12, rejected: 2 };



const STAT_CARDS = [

  {

    label: "Tokens Issued On-Chain",

    value: "5",

    sub: "ERC-3643 · Ethereum Sepolia",

    icon: "💰",

    color: "#a78bfa",

    bg: "rgba(167,139,250,0.08)",

    border: "rgba(167,139,250,0.2)",

  },

  {

    label: "KYC Applications",

    value: String(KYC_STATS.pending + KYC_STATS.reviewing + KYC_STATS.approved + KYC_STATS.rejected),

    sub: `${KYC_STATS.pending} pending · ${KYC_STATS.approved} approved`,

    icon: "👤",

    color: "#34d399",

    bg: "rgba(52,211,153,0.08)",

    border: "rgba(52,211,153,0.2)",

  },

  {

    label: "Compliance Pass Rate",

    value: "80%",

    sub: "4 of 5 submissions passed",

    icon: "✓",

    color: "#1a56db",

    bg: "rgba(96,165,250,0.08)",

    border: "rgba(96,165,250,0.2)",

  },

  {

    label: "On-Chain Audit Records",

    value: "5",

    sub: "Keccak256 fingerprints stored",

    icon: "📑",

    color: "#f59e0b",

    bg: "rgba(245,158,11,0.08)",

    border: "rgba(245,158,11,0.2)",

  },

];



const TYPE_COLORS: Record<string, { color: string; bg: string }> = {

  Bond:            { color: "#1a56db", bg: "rgba(96,165,250,0.1)" },

  GreenBond:       { color: "#34d399", bg: "rgba(52,211,153,0.1)" },

  REIT:            { color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },

  TradeReceivable: { color: "#c084fc", bg: "rgba(192,132,252,0.1)" },

};



const STATUS_COLORS: Record<string, { color: string; bg: string; border: string }> = {

  "Compliant":       { color: "#34d399", bg: "rgba(52,211,153,0.08)",  border: "rgba(52,211,153,0.25)"  },

  "Review Required": { color: "#fbbf24", bg: "rgba(251,191,36,0.08)",  border: "rgba(251,191,36,0.25)"  },

  "Pending Review":  { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.25)" },

};



const QUICK_LINKS = [

  {

    href: "/admin/kyc",

    icon: "👤",

    label: "KYC Review",

    desc: "Review & approve pending investor identity applications",

    badge: String(KYC_STATS.pending),

    badgeColor: "#f59e0b",

  },

  {

    href: "/compliance",

    icon: "✅",

    label: "Verify Compliance",

    desc: "Cross-check a prospectus against SFC tokenization rules",

    badge: null,

    badgeColor: "",

  },

  {

    href: "/audit",

    icon: "📋",

    label: "Contract Audit",

    desc: "Review smart contract security findings & on-chain fingerprint",

    badge: null,

    badgeColor: "",

  },

];



// ── Component ─────────────────────────────────────────────────────────────────



export default function RegulatorPage() {

  const [filter, setFilter] = useState<"All" | "Compliant" | "Review Required" | "Pending Review">("All");



  const filtered = filter === "All" ? RECORDS : RECORDS.filter((r) => r.status === filter);



  return (

    <div className="min-h-screen py-8 px-4 sm:px-6" style={{ background: "#f7f5f0" }}>

      <div className="max-w-7xl mx-auto space-y-8">



        {/* ── Header ─────────────────────────────────────────────────────── */}

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">

          <div>

            <div className="flex items-center gap-3 mb-2">

              <div

                className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"

                style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)" }}

              >

                🛡

              </div>

              <div>

                <h1 className="text-2xl font-bold text-white leading-tight">

                  Regulatory Oversight Dashboard

                </h1>

                <p className="text-sm text-slate-400">

                  On-chain compliance records · NexusRWA Protocol · Ethereum Sepolia

                </p>

              </div>

            </div>

          </div>

          <div className="flex items-center gap-2 shrink-0">

            <span

              className="text-[11px] font-semibold px-3 py-1.5 rounded-full"

              style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa" }}

            >

              SFC Supervised Platform

            </span>

            <span

              className="text-[11px] font-semibold px-3 py-1.5 rounded-full"

              style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", color: "#34d399" }}

            >

              ● Live

            </span>

          </div>

        </div>



        {/* ── Stat cards ─────────────────────────────────────────────────── */}

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">

          {STAT_CARDS.map((c) => (

            <div

              key={c.label}

              className="rounded-xl p-5"

              style={{ background: c.bg, border: `1px solid ${c.border}` }}

            >

              <div className="flex items-start justify-between mb-3">

                <span className="text-xl" style={{ color: c.color }}>{c.icon}</span>

              </div>

              <div className="text-3xl font-bold text-white mb-1">{c.value}</div>

              <div className="text-[12px] font-medium mb-0.5" style={{ color: c.color }}>{c.label}</div>

              <div className="text-[11px] text-slate-600">{c.sub}</div>

            </div>

          ))}

        </div>



        {/* ── On-chain Records ───────────────────────────────────────────── */}

        <div

          className="rounded-xl overflow-hidden"

          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}

        >

          {/* Table header bar */}

          <div

            className="flex items-center justify-between px-5 py-3"

            style={{ borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#ffffff" }}

          >

            <div className="flex items-center gap-3">

              <span className="text-[13px] font-semibold text-white">On-Chain Compliance Records</span>

              <span

                className="text-[10px] px-2 py-0.5 rounded font-mono"

                style={{ background: "#f7f5f0", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}

              >

                {RECORDS.length} records

              </span>

            </div>

            {/* Status filter */}

            <div className="flex items-center gap-1.5">

              {(["All", "Compliant", "Review Required", "Pending Review"] as const).map((f) => (

                <button

                  key={f}

                  onClick={() => setFilter(f)}

                  className="text-[11px] px-2.5 py-1 rounded transition-colors"

                  style={{

                    background: filter === f ? "rgba(167,139,250,0.15)" : "transparent",

                    border: `1px solid ${filter === f ? "rgba(167,139,250,0.4)" : "rgba(0,0,0,0.12)"}`,

                    color: filter === f ? "#a78bfa" : "#888888",

                  }}

                >

                  {f}

                </button>

              ))}

            </div>

          </div>



          {/* Table */}

          <div className="overflow-x-auto">

            <table className="w-full text-[12px]">

              <thead>

                <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>

                  {["Record ID", "Asset", "Type", "Issuer", "Score", "Status", "Tx Hash", "Date"].map((h) => (

                    <th

                      key={h}

                      className="px-4 py-2.5 text-left font-semibold uppercase tracking-wide"

                      style={{ color: "#888888", fontSize: "10px" }}

                    >

                      {h}

                    </th>

                  ))}

                </tr>

              </thead>

              <tbody>

                {filtered.map((r, i) => {

                  const tc = TYPE_COLORS[r.type] ?? { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };

                  const sc = STATUS_COLORS[r.status] ?? STATUS_COLORS["Pending Review"];

                  return (

                    <tr

                      key={r.id}

                      style={{ borderBottom: i < filtered.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }}

                      className="transition-colors hover:bg-gray-100"

                    >

                      <td className="px-4 py-3 font-mono text-slate-500">{r.id}</td>

                      <td className="px-4 py-3 font-medium text-slate-300 max-w-[200px]">

                        <span className="line-clamp-1">{r.asset}</span>

                      </td>

                      <td className="px-4 py-3">

                        <span

                          className="text-[11px] px-2 py-0.5 rounded font-medium"

                          style={{ background: tc.bg, color: tc.color }}

                        >

                          {r.type}

                        </span>

                      </td>

                      <td className="px-4 py-3 text-slate-400 max-w-[160px]">

                        <span className="line-clamp-1">{r.issuer}</span>

                      </td>

                      <td className="px-4 py-3">

                        <div className="flex items-center gap-2">

                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "#f3f1eb" }}>

                            <div

                              className="h-full rounded-full"

                              style={{

                                width: `${r.score}%`,

                                background: r.score >= 85 ? "#34d399" : r.score >= 70 ? "#fbbf24" : "#f87171",

                              }}

                            />

                          </div>

                          <span

                            className="font-semibold"

                            style={{ color: r.score >= 85 ? "#34d399" : r.score >= 70 ? "#fbbf24" : "#f87171" }}

                          >

                            {r.score}

                          </span>

                        </div>

                      </td>

                      <td className="px-4 py-3">

                        <span

                          className="text-[11px] px-2 py-0.5 rounded font-medium"

                          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}

                        >

                          {r.status}

                        </span>

                      </td>

                      <td className="px-4 py-3">

                        <a

                          href={`${EXPLORER}${r.txHash}`}

                          target="_blank"

                          rel="noopener noreferrer"

                          className="font-mono text-[11px] transition-colors hover:text-blue-400"

                          style={{ color: "#888888" }}

                        >

                          {r.txHash.slice(0, 8)}…{r.txHash.slice(-6)} ...
                        </a>

                      </td>

                      <td className="px-4 py-3 text-slate-500">{r.date}</td>

                    </tr>

                  );

                })}

                {filtered.length === 0 && (

                  <tr>

                    <td colSpan={8} className="px-4 py-8 text-center text-slate-600 text-sm">

                      No records match the selected filter.

                    </td>

                  </tr>

                )}

              </tbody>

            </table>

          </div>

        </div>



        {/* ── KYC pipeline summary ───────────────────────────────────────── */}

        <div

          className="rounded-xl p-5"

          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}

        >

          <div className="flex items-center justify-between mb-4">

            <span className="text-[13px] font-semibold text-white">KYC Pipeline</span>

            <a

              href="/admin/kyc"

              className="text-[11px] font-semibold transition-colors hover:text-violet-300"

              style={{ color: "#a78bfa" }}

            >

              Open Review Panel ...
            </a>

          </div>

          <div className="grid grid-cols-4 gap-4">

            {[

              { label: "Pending",  value: KYC_STATS.pending,   color: "#f59e0b" },

              { label: "Reviewing",value: KYC_STATS.reviewing,  color: "#1a56db" },

              { label: "Approved", value: KYC_STATS.approved,   color: "#34d399" },

              { label: "Rejected", value: KYC_STATS.rejected,   color: "#f87171" },

            ].map((s) => (

              <div key={s.label} className="text-center">

                <div className="text-2xl font-bold mb-1" style={{ color: s.color }}>{s.value}</div>

                <div className="text-[11px] text-slate-500">{s.label}</div>

              </div>

            ))}

          </div>

          {/* Progress bar */}

          <div className="mt-4 h-2 rounded-full overflow-hidden flex" style={{ background: "#f3f1eb" }}>

            {[

              { value: KYC_STATS.pending,   color: "#f59e0b" },

              { value: KYC_STATS.reviewing, color: "#1a56db" },

              { value: KYC_STATS.approved,  color: "#34d399" },

              { value: KYC_STATS.rejected,  color: "#f87171" },

            ].map((s, i) => {

              const total = KYC_STATS.pending + KYC_STATS.reviewing + KYC_STATS.approved + KYC_STATS.rejected;

              return (

                <div

                  key={i}

                  style={{ width: `${(s.value / total) * 100}%`, background: s.color }}

                />

              );

            })}

          </div>

        </div>



        {/* ── Quick action links ─────────────────────────────────────────── */}

        <div>

          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-600 mb-3">

            Regulatory Tools

          </h2>

          <div className="grid sm:grid-cols-3 gap-4">

            {QUICK_LINKS.map((ql) => (

              <a

                key={ql.href}

                href={ql.href}

                className="flex items-start gap-4 p-4 rounded-xl transition-all group"

                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}

                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(167,139,250,0.4)"; }}

                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)"; }}

              >

                <div

                  className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"

                  style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}

                >

                  {ql.icon}

                </div>

                <div className="flex-1">

                  <div className="flex items-center gap-2 mb-1">

                    <span className="text-[13px] font-semibold text-violet-700 group-hover:text-violet-500 transition-colors">

                      {ql.label}

                    </span>

                    {ql.badge && (

                      <span

                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"

                        style={{ background: "rgba(245,158,11,0.15)", color: ql.badgeColor, border: "1px solid rgba(245,158,11,0.3)" }}

                      >

                        {ql.badge} pending

                      </span>

                    )}

                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">{ql.desc}</p>

                </div>

                <span className="text-slate-600 group-hover:text-violet-400 transition-colors text-sm shrink-0"></span>

              </a>

            ))}

          </div>

        </div>



      </div>

    </div>

  );

}

