"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/role-context";
import { getRoleById } from "@/lib/roles";

export default function HomePage() {
  const { selectedRole, isLoading } = useRole();
  const router = useRouter();

  // Redirect to role home if already logged in
  useEffect(() => {
    if (!isLoading && selectedRole) {
      const role = getRoleById(selectedRole);
      if (role) {
        router.push(role.links[0].href);
      }
    }
  }, [selectedRole, isLoading, router]);

  // Show loading while checking role
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin mx-auto mb-3" />
          <div className="text-sm text-slate-600">Loading...</div>
        </div>
      </div>
    );
  }

  // If logged in, don't show home page (redirect will happen)
  if (selectedRole) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

      {/* ── S1: Hero ── */}
      <section className="pt-6 pb-20 grid grid-cols-1 lg:grid-cols-5 gap-12 lg:gap-16 items-start">

        {/* Left — 3 cols */}
        <div className="lg:col-span-3 animate-fade-up">
          <div className="inline-flex items-center gap-2 mb-6">

          </div>
          <h1 className="text-[40px] sm:text-[48px] leading-[1.06] tracking-tight mb-6"
            style={{ letterSpacing: "-0.025em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>
            <span style={{ color: "#111111" }}>AI Compliance,</span><br />
            <span style={{ color: "#111111" }}>Zero-Knowledge Credentials,</span><br />
            <span className="text-gradient-blue">Ethereum Enforcement End-to-End.</span>
          </h1>
          <p className="text-[15px] leading-relaxed mb-10 max-w-[480px]" style={{ color: "#555555" }}>
            Off-chain AI verifies issuer and investor evidence, then only privacy-preserving
            commitment/proof state is anchored on Ethereum Sepolia. Smart contracts enforce mint and
            transfer policy while autonomous agents handle update/revoke operations.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-14">
            <a href="/login"
              className="btn-primary px-6 py-2.5 rounded-lg text-sm font-semibold text-white">
              Login to Start
            </a>
            <a href="/login"
              className="btn-outline px-6 py-2.5 rounded-lg text-sm font-medium">
              Access Platform
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-0 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
            <div className="px-5 py-4" style={{ borderRight: "1px solid rgba(0,0,0,0.08)" }}>
              <div className="text-[22px] font-bold leading-none mb-1.5" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif" }}>5</div>
              <div className="text-[11px]" style={{ color: "#888888" }}>Smart contracts on Ethereum Sepolia</div>
            </div>
            <div className="px-5 py-4" style={{ borderRight: "1px solid rgba(0,0,0,0.08)" }}>
              <div className="text-[22px] font-bold leading-none mb-1.5" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif" }}>4</div>
              <div className="text-[11px]" style={{ color: "#888888" }}>RWA asset classes supported</div>
            </div>
            <div className="px-5 py-4">
              <div className="text-[22px] font-bold leading-none mb-1.5" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif" }}>24/7</div>
              <div className="text-[11px]" style={{ color: "#888888" }}>Continuous off-chain monitoring</div>
            </div>
          </div>
        </div>

        {/* Right — 2 cols: live deal card */}
        <div className="lg:col-span-2 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "#999999" }}>
            Live Issuance
          </div>
          <div className="rounded-2xl overflow-hidden glow-hover" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}>
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="text-[10px] font-semibold mb-1.5" style={{ color: "#1a56db", letterSpacing: "0.08em" }}>NIBT · ERC-3643</div>
                  <div className="text-[17px] font-semibold leading-snug" style={{ color: "#111111", fontFamily: "'Lora', Georgia, serif" }}>
                    Nexus Infrastructure<br />Bond Token
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: "#888888" }}>Ethereum Sepolia Testnet · Series 2026-B</div>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 flex items-center gap-1.5"
                  style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.20)", color: "#16a34a" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-slow" />
                  LIVE
                </span>
              </div>

              <div>
                {[
                  { k: "Type",         v: "Corporate Bond · ERC-3643",                 hi: false },
                  { k: "Coupon",       v: "5.50% p.a. (semi-annual)",                  hi: false },
                  { k: "Maturity",     v: "15 July 2031",                              hi: false },
                  { k: "Face Value",   v: "USD 1,000 / token",                         hi: false },
                  { k: "Total Issue",  v: "USD 100,000,000",                           hi: false },
                  { k: "Min. Sub",     v: "USD 20,000 (20 tokens)",                   hi: false },
                  { k: "AI Score",     v: "85 / 100 · PASSED",                        hi: true  },
                  { k: "Oracle",       v: "ComplianceOracle.sol on Ethereum",          hi: true  },
                  { k: "Settlement",   v: "Ethereum Sepolia · Chain ID 11155111",      hi: false },
                ].map(({ k, v, hi }) => (
                  <div key={k} className="flex items-center justify-between py-2.5 text-xs"
                    style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                    <span className="shrink-0" style={{ color: "#888888" }}>{k}</span>
                    <span className="font-mono text-right ml-4" style={{ color: hi ? "#16a34a" : "#111111" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3.5" style={{ borderTop: "1px solid rgba(0,0,0,0.07)", background: "#f7f5f0" }}>
              <a href="/login"
                className="btn-primary block w-full text-center text-xs font-semibold py-2.5 text-white rounded-lg">
                Login to Subscribe →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── S2: Core Innovation — 3 differentiators ── */}
      <section className="py-14 section-divider">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#aaaaaa" }}>What makes this different</p>
          <h2 className="text-2xl" style={{ color: "#111111", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>Three breakthroughs in one stack</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              accent: "#1a56db",
              accentBg: "rgba(26,86,219,0.07)",
              accentBorder: "rgba(26,86,219,0.18)",
              icon: (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="7" stroke="#1a56db" strokeWidth="1.5" opacity="0.4"/>
                  <path d="M10 6v4l3 2" stroke="#1a56db" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="10" cy="10" r="1.5" fill="#1a56db"/>
                </svg>
              ),
              title: "AI Score → On-Chain Oracle",
              label: "Technical Depth",
              body: "AI analyses the prospectus against SFC rules and writes a numeric score to ComplianceOracle.sol on Ethereum Sepolia. Any wallet below 70/100 cannot mint — enforced automatically at the smart contract level, not by a human reviewer.",
              link: "/compliance",
              cta: "Run compliance check →",
            },
            {
              accent: "#16a34a",
              accentBg: "rgba(22,163,74,0.07)",
              accentBorder: "rgba(22,163,74,0.18)",
              icon: (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
                  <rect x="3" y="3" width="6" height="6" rx="1.5" fill="#16a34a" opacity="0.8"/>
                  <rect x="11" y="3" width="6" height="6" rx="1.5" fill="#16a34a" opacity="0.3"/>
                  <rect x="3" y="11" width="6" height="6" rx="1.5" fill="#16a34a" opacity="0.3"/>
                  <rect x="11" y="11" width="6" height="6" rx="1.5" fill="#16a34a" opacity="0.8"/>
                </svg>
              ),
              title: "SFC-Gated by Default",
              label: "Compliance Innovation",
              body: "ERC-3643-inspired ComplianceModule hooks into every mint and transfer. Only KYC-whitelisted wallets registered in IdentityRegistry can hold or move tokens — no whitelist, no access. Regulatory logic lives in code, not in operations.",
              link: "/kyc",
              cta: "See KYC flow →",
            },
            {
              accent: "#0f766e",
              accentBg: "rgba(15,118,110,0.08)",
              accentBorder: "rgba(15,118,110,0.2)",
              icon: (
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
                  <path d="M4 14c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="#0f766e" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5"/>
                  <path d="M10 3v5M7 5l3-2 3 2" stroke="#0f766e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ),
              title: "Autonomous Credential Lifecycle",
              label: "Agentic Governance",
              body: "After issuance, autonomous policy checks can update or revoke credentials via Ethereum transactions. IdentityRegistry keeps compliance logic enforceable without exposing raw personal data.",
              link: "/admin/kyc",
              cta: "Open control plane →",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-xl p-6 flex flex-col gap-4 glow-hover"
              style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: c.accentBg, border: `1px solid ${c.accentBorder}` }}>
                  {c.icon}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: c.accent }}>{c.label}</span>
              </div>
              <h3 className="text-[15px] font-semibold leading-snug" style={{ color: "#111111" }}>{c.title}</h3>
              <p className="text-[12px] leading-relaxed flex-1" style={{ color: "#666666" }}>{c.body}</p>
              <a href={c.link} className="text-[12px] font-medium transition-colors" style={{ color: c.accent }}>{c.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* ── S3: Full pipeline — 4-party lifecycle ── */}
      <section className="py-16 section-divider">
        <div className="mb-10">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#aaaaaa" }}>End-to-end flow</p>
          <h2 className="text-2xl" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>
            From prospectus to coupon claim — fully on-chain
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-0">
          {[
            {
              n: "01",
              actor: "Issuer",
              actorColor: "#1a56db",
              title: "Draft & AI Review",
              desc: "Issuer submits the offering prospectus. AI (Qwen2.5-72B) scores it against SFC tokenisation rules — contract terms, risk disclosures, asset structure. Report hash is committed to EigenDA.",
              ai: "AI scores prospectus → EigenDA hash",
            },
            {
              n: "02",
              actor: "Type 6 LC Intermediary",
              actorColor: "#f59e0b",
              title: "Score Written On-Chain",
              desc: "The licensed intermediary reviews AI findings and submits the compliance score to ComplianceOracle.sol on Ethereum Sepolia. Score below 70 blocks issuance — no override, no workaround.",
              ai: "submitScore() → Ethereum",
            },
            {
              n: "03",
              actor: "Investor",
              actorColor: "#16a34a",
              title: "KYC → Subscribe → Mint",
              desc: "Investor submits KYC under AMLO Cap.615. Approved wallet is registered in IdentityRegistry. Subscription triggers mintForAsset() — compliance module validates both KYC and oracle score before minting.",
              ai: "canMint() gating at contract",
            },
            {
              n: "04",
              actor: "On-Chain Servicing",
              actorColor: "#7c3aed",
              title: "Coupon Funding & Claim",
              desc: "Issuer funds the coupon schedule with the configured ERC-20 coupon token. On payment date, investors call claimDividend() to receive yield directly to their Ethereum wallet.",
              ai: "ERC-20 coupon yield on Ethereum",
            },
          ].map((s, i) => (
            <div key={s.n} className="pr-8 pl-4 py-6"
              style={{ borderLeft: i > 0 ? "1px solid rgba(0,0,0,0.08)" : "none" }}>
              <div className="text-[40px] leading-none mb-3"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Lora', Georgia, serif", fontWeight: 600, color: "rgba(0,0,0,0.08)" }}>
                {s.n}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: s.actorColor }}>{s.actor}</div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: "#111111" }}>{s.title}</h3>
              <p className="text-xs leading-relaxed mb-3" style={{ color: "#777777" }}>{s.desc}</p>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded"
                style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.08)", color: "#555555" }}>
                <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                {s.ai}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── S4: Role selection — 4 roles ── */}
      <section className="py-14 section-divider">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#aaaaaa" }}>Where to start</p>
          <h2 className="text-2xl" style={{ color: "#111111", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>Choose your role in the issuance ecosystem</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Issuer */}
          <div className="rounded-xl p-6 flex flex-col gap-5 glow-hover"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(26,86,219,0.08)", border: "1px solid rgba(26,86,219,0.15)" }}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5" height="5" rx="1" fill="#1a56db" opacity="0.9" />
                  <rect x="9" y="2" width="5" height="5" rx="1" fill="#1a56db" opacity="0.4" />
                  <rect x="2" y="9" width="5" height="5" rx="1" fill="#1a56db" opacity="0.4" />
                  <rect x="9" y="9" width="5" height="5" rx="1" fill="#1a56db" opacity="0.9" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "#111111" }}>Asset Issuer</div>
                <div className="text-[11px]" style={{ color: "#888888" }}>Fund managers, banks, corporates</div>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                { step: "1", href: "/prospectus", label: "Draft Prospectus",      desc: "AI-assisted SFC-compliant offering memorandum" },
                { step: "2", href: "/compliance", label: "AI Compliance Check",   desc: "Score prospectus — result written to Ethereum oracle" },
                { step: "3", href: "/tokenize",   label: "Tokenise & Deploy",     desc: "Register ERC-3643-inspired assets on Ethereum Sepolia" },
              ].map(({ step, href, label, desc }) => (
                <li key={step}>
                  <a href={href} className="flex items-start gap-3 group">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: "#1a56db", color: "white" }}>{step}</span>
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: "#333333" }}>{label}</div>
                      <div className="text-[11px]" style={{ color: "#888888" }}>{desc}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ol>
            <a href="/compliance" className="btn-primary mt-1 w-full text-center text-sm font-semibold py-2.5 rounded-lg text-white">
              Start Issuing →
            </a>
          </div>

          {/* Intermediary */}
          <div className="rounded-xl p-6 flex flex-col gap-5 glow-hover"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.20)" }}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" fill="#f59e0b" opacity="0.7"/>
                </svg>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "#111111" }}>Intermediary <span className="text-[11px] font-normal" style={{ color: "#888888" }}>(Type 6 LC)</span></div>
                <div className="text-[11px]" style={{ color: "#888888" }}>SFC-licensed sponsor — writes AI score on-chain</div>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                { step: "1", href: "/compliance",  label: "Review Compliance Report", desc: "AI-generated score + SFC rule breakdown" },
                { step: "2", href: "/audit",        label: "Smart Contract Audit",     desc: "AI security review of Solidity contracts" },
                { step: "3", href: "/admin/kyc",    label: "Approve KYC Applications", desc: "AMLO CDD — review and whitelist investor wallets" },
              ].map(({ step, href, label, desc }) => (
                <li key={step}>
                  <a href={href} className="flex items-start gap-3 group">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: "#f59e0b", color: "white" }}>{step}</span>
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: "#333333" }}>{label}</div>
                      <div className="text-[11px]" style={{ color: "#888888" }}>{desc}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ol>
            <a href="/compliance" className="mt-1 w-full text-center text-sm font-semibold py-2.5 rounded-lg transition-all"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "#b45309" }}>
              Open Compliance Tools →
            </a>
          </div>

          {/* Investor */}
          <div className="rounded-xl p-6 flex flex-col gap-5 glow-hover"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.15)" }}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="5" r="3" fill="#16a34a" opacity="0.8" />
                  <path d="M2 14c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.6" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "#111111" }}>Professional Investor</div>
                <div className="text-[11px]" style={{ color: "#888888" }}>PI-qualified individuals &amp; institutions</div>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                { step: "1", href: "/kyc",       label: "Submit KYC",           desc: "AMLO (Cap.615) identity verification — wallet whitelisted on approval" },
                { step: "2", href: "/subscribe", label: "Subscribe to NIBT",    desc: "Place order — mintForAsset() fires after compliance gate passes" },
                { step: "3", href: "/portfolio", label: "Claim Coupons",        desc: "Track holdings and claim ERC-20 coupons on-chain" },
              ].map(({ step, href, label, desc }) => (
                <li key={step}>
                  <a href={href} className="flex items-start gap-3 group">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: "#16a34a", color: "white" }}>{step}</span>
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: "#333333" }}>{label}</div>
                      <div className="text-[11px]" style={{ color: "#888888" }}>{desc}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ol>
            <a href="/kyc" className="mt-1 w-full text-center text-sm font-semibold py-2.5 rounded-lg transition-all"
              style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.22)", color: "#16a34a" }}>
              Apply for KYC →
            </a>
          </div>

          {/* Regulator */}
          <div className="rounded-xl p-6 flex flex-col gap-5 glow-hover"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.18)" }}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2L3 5v4c0 2.5 2 4.7 5 5.5 3-0.8 5-3 5-5.5V5L8 2z" fill="#7c3aed" opacity="0.6"/>
                  <path d="M5.5 8l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <div className="font-semibold text-sm" style={{ color: "#111111" }}>Regulator <span className="text-[11px] font-normal" style={{ color: "#888888" }}>(SFC)</span></div>
                <div className="text-[11px]" style={{ color: "#888888" }}>Securities &amp; Futures Commission — oversight only</div>
              </div>
            </div>
            <ol className="space-y-3">
              {[
                { step: "1", href: "/regulator",          label: "Oversight Dashboard",   desc: "On-chain issuance records, compliance scores, market stats" },
                { step: "2", href: "/regulator/issuance", label: "Issuance Review",        desc: "Approve or request changes on pending token offerings" },
                { step: "3", href: "/regulator",          label: "Market Surveillance",    desc: "Wallet-level transfer history and anomaly detection" },
              ].map(({ step, href, label, desc }) => (
                <li key={step}>
                  <a href={href} className="flex items-start gap-3 group">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ background: "#7c3aed", color: "white" }}>{step}</span>
                    <div>
                      <div className="text-[13px] font-medium" style={{ color: "#333333" }}>{label}</div>
                      <div className="text-[11px]" style={{ color: "#888888" }}>{desc}</div>
                    </div>
                  </a>
                </li>
              ))}
            </ol>
            <a href="/regulator" className="mt-1 w-full text-center text-sm font-semibold py-2.5 rounded-lg transition-all"
              style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(124,58,237,0.20)", color: "#7c3aed" }}>
              Open Regulator Dashboard →
            </a>
          </div>

        </div>
      </section>

      {/* ── S5: Ethereum ecosystem integration ── */}
      <section className="py-16 section-divider">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#aaaaaa" }}>Ethereum ecosystem</p>
          <h2 className="text-2xl mb-1" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>
            Built on Ethereum infrastructure
          </h2>
          <p className="text-sm" style={{ color: "#777777" }}>Solidity contracts, EVM wallets and Cleanverse compliance in one flow.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              name: "Mantle Network",
              color: "#1a56db",
              bg: "rgba(26,86,219,0.06)",
              border: "rgba(26,86,219,0.15)",
              role: "Execution & Settlement Layer",
              detail: "Solidity contracts run on Ethereum Sepolia. ERC-3643-inspired minting, compliance gating and coupon claims are enforced on-chain.",
            },
            {
              name: "MNT · Native Token",
              color: "#16a34a",
              bg: "rgba(22,163,74,0.06)",
              border: "rgba(22,163,74,0.15)",
              role: "Coupon Yield & Autocompounding",
              detail: "MNT pays transaction fees while coupon schedules use the configured ERC-20 settlement token.",
            },
            {
              name: "Ethereum Wallets",
              color: "#0d9488",
              bg: "rgba(13,148,136,0.06)",
              border: "rgba(13,148,136,0.15)",
              role: "Idle Capital Yield Routing",
              detail: "RainbowKit, wagmi and viem provide wallet connectivity, contract reads and transaction execution.",
            },
            {
              name: "EigenDA",
              color: "#7c3aed",
              bg: "rgba(124,58,237,0.06)",
              border: "rgba(124,58,237,0.15)",
              role: "Prospectus Data Availability",
              detail: "Full prospectus and AI compliance report committed to EigenDA. keccak256 hash anchored in ComplianceOracle.sol — tamper-evident, permanently auditable.",
            },
          ].map((p) => (
            <div key={p.name} className="rounded-xl p-5 flex flex-col gap-3"
              style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[13px] font-semibold" style={{ color: "#111111" }}>{p.name}</span>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded self-start"
                style={{ background: p.bg, border: `1px solid ${p.border}`, color: p.color }}>
                {p.role}
              </span>
              <p className="text-[12px] leading-relaxed" style={{ color: "#666666" }}>{p.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── S6: Asset class table ── */}
      <section className="py-16 section-divider">
        <div className="mb-8">
          <h2 className="text-2xl mb-1" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>Supported Instruments</h2>
          <p className="text-sm" style={{ color: "#777777" }}>Four asset classes, one compliance-gated issuance pipeline.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.10)" }}>
                {["Asset Class", "Token Standard", "AI Compliance Rules", "Yield Mechanism", "Settlement", "Try"].map((h) => (
                  <th key={h} className="text-left pb-3 pr-6" style={{ fontSize: "10px", fontWeight: 600, color: "#aaaaaa", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Asia REIT",         color: "#16a34a", rules: "SFC REIT Code + tokenisation circular",   yield_: "Quarterly ERC-20 dividend",           settle: "T+2 · Mantle", demo: "/tokenize" },
                { name: "Corporate Bond",   color: "#1a56db", rules: "SFO s.103 + bond trust deed",            yield_: "Semi-annual ERC-20 coupon",           settle: "T+2 · Mantle", demo: "/subscribe" },
                { name: "Green Bond",       color: "#0d9488", rules: "ICMA GBP + ESG SFC certification",       yield_: "Semi-annual ERC-20 coupon",           settle: "T+2 · Mantle", demo: "/tokenize" },
                { name: "Trade Receivable", color: "#7c3aed", rules: "Invoice + contract AI cross-validation", yield_: "Receivable maturity proceeds",        settle: "T+0 · Mantle", demo: "/compliance" },
              ].map((row) => (
                <tr key={row.name} style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                  <td className="py-4 pr-6 font-semibold text-sm" style={{ color: row.color }}>{row.name}</td>
                  <td className="py-4 pr-6 font-mono text-xs" style={{ color: "#555555" }}>ERC-3643</td>
                  <td className="py-4 pr-6 text-xs" style={{ color: "#666666" }}>{row.rules}</td>
                  <td className="py-4 pr-6 text-xs" style={{ color: "#666666" }}>{row.yield_}</td>
                  <td className="py-4 pr-6 text-xs" style={{ color: "#666666" }}>{row.settle}</td>
                  <td className="py-4 text-xs">
                    <a href={row.demo} className="font-medium transition-colors" style={{ color: row.color }}>Try →</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── S7: Technical architecture ── */}
      <section className="py-16 section-divider">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
          <div>
            <h2 className="text-2xl mb-4" style={{ color: "#111111", letterSpacing: "-0.02em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>
              5 contracts, one compliance-gated pipeline
            </h2>
            <p className="text-[14px] leading-relaxed mb-6" style={{ color: "#666666" }}>
              Deployed on Ethereum Sepolia Testnet (Chain ID 11155111). AI powered by Qwen2.5-72B
              via DashScope. Prospectus documents committed to EigenDA with on-chain hash
              anchoring in ComplianceOracle. Full open-source codebase.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Mantle Network", "Ethereum EVM", "ERC-3643", "Qwen2.5-72B", "EigenDA", "MNT", "viem · wagmi · RainbowKit"].map((t) => (
                <span key={t} className="text-[11px] px-2.5 py-1 rounded-md"
                  style={{ border: "1px solid rgba(0,0,0,0.10)", color: "#666666", background: "#ffffff" }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
            {[
              { file: "ComplianceOracle.sol",  note: "AI score anchor · mint gate"         },
              { file: "IdentityRegistry.sol",  note: "KYC whitelist · AMLO Cap.615"        },
              { file: "ComplianceModule.sol",  note: "ERC-3643 hook · transfer guard"      },
              { file: "HarbourRWAToken.sol",   note: "ERC-3643 token · coupon schedules"   },
              { file: "YieldAggregator.sol",   note: "ERC-20 yield allocation"              },
            ].map((c, i, arr) => (
              <div key={c.file} className="flex items-center justify-between px-5 py-3"
                style={{
                  background: i % 2 === 0 ? "#f7f5f0" : "#ffffff",
                  borderBottom: i < arr.length - 1 ? "1px solid rgba(0,0,0,0.06)" : "none",
                }}>
                <span className="font-mono text-xs" style={{ color: "#1a56db" }}>{c.file}</span>
                <span className="text-[10px]" style={{ color: "#aaaaaa" }}>{c.note}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── S8: CTA ── */}
      <section className="py-20 text-center section-divider">
        <div className="max-w-lg mx-auto">
          <h2 className="text-[32px] mb-4" style={{ color: "#111111", letterSpacing: "-0.025em", fontFamily: "'Lora', Georgia, serif", fontWeight: 600 }}>
            See the full pipeline in action
          </h2>
          <p className="text-sm max-w-md mx-auto mb-8 leading-relaxed" style={{ color: "#666666" }}>
            AI compliance check → score anchored on Ethereum → KYC-gated mint →
            ERC-20 coupon claim. The complete RWA life-cycle, end-to-end.
          </p>
          <div className="flex justify-center gap-3">
            <a href="/compliance"
              className="btn-primary px-8 py-3 text-sm font-semibold text-white rounded-lg">
              Run AI Compliance Check
            </a>
            <a href="/subscribe"
              className="btn-outline px-8 py-3 text-sm font-medium rounded-lg">
              Subscribe to NIBT
            </a>
          </div>
        </div>
      </section>

    </div>
  );
}
