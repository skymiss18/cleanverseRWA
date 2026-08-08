"use client";



import { useState, useEffect } from "react";
import type { AuditReport, AuditSeverity } from "@/lib/audit";

import DocumentUploadField from "@/components/DocumentUploadField";



type AssetType = "REIT" | "GreenBond" | "TradeReceivable" | "Bond";

interface PendingSubmission {
  id: string;
  receivedAt: string;
  reference: string;
  issuer: string;
  assetName: string;
  assetType: AssetType;
  totalSupply: string;
  unitPrice: string;
  prospectusText: string;
  invoiceText?: string;
  contractText?: string;
  description?: string;
  submittedAt: string;
}



interface ComplianceResult {

  assetId: string;

  assetName: string;

  assetType: AssetType;

  score: number;

  passed: boolean;

  summary: string;

  recommendations: string[];

  breakdown: Array<{ ruleId: string; ruleName: string; score: number; maxScore: number; weight: number; details: string }>;

  onChain: boolean;

  txHash: string | null;

  explorerUrl?: string | null;

  reportHash?: string;

  timestamp: string;

  engine?: string;

}



type RiskLevel = "low" | "medium" | "high" | "critical";



interface DocumentRisk {

  riskLevel: RiskLevel;

  issues: { severity: RiskLevel; description: string }[];

  compliantAspects: string[];

  recommendations: string[];

}



interface CrossValidationRule { id: string; name: string; passed: boolean; detail: string; }



interface TradeResult {

  invoiceRisk: DocumentRisk | null;

  contractRisk: DocumentRisk | null;

  rwaRisk: DocumentRisk | null;

  crossValidation: { allPassed: boolean; rules: CrossValidationRule[] } | null;

  reportHash?: string;

  sfcCompliance: {

    score: number;

    passed: boolean;

    summary?: string;

    breakdown?: ComplianceResult["breakdown"];

    recommendations?: string[];

    engine?: string;

  } | null;

}



// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {

  const pct = max > 0 ? Math.min(100, (score / max) * 100) : 0;

  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";

  return (

    <div className="h-1 rounded-full" style={{ background: "#1a2e48" }}>

      <div className={`h-1 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />

    </div>

  );

}



// ── Risk card ─────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {

  low: "text-emerald-700", medium: "text-amber-700", high: "text-orange-700", critical: "text-red-700",

};

const RISK_BG: Record<RiskLevel, React.CSSProperties> = {

  low:      { background: "rgba(16,185,129,0.05)",  border: "1px solid rgba(16,185,129,0.15)"  },

  medium:   { background: "rgba(245,158,11,0.05)",  border: "1px solid rgba(245,158,11,0.15)"  },

  high:     { background: "rgba(249,115,22,0.06)",  border: "1px solid rgba(249,115,22,0.2)"   },

  critical: { background: "rgba(239,68,68,0.07)",   border: "1px solid rgba(239,68,68,0.2)"    },

};



function RiskCard({ title, report }: { title: string; report: DocumentRisk | null }) {

  if (!report) return null;

  return (

    <div className="rounded-lg p-4 space-y-2" style={RISK_BG[report.riskLevel]}>

      <div className="flex items-center justify-between">

        <span className="text-xs font-semibold text-slate-800">{title}</span>

        <span className={`text-[10px] font-bold uppercase ${RISK_COLOR[report.riskLevel]}`}>

          {report.riskLevel}

        </span>

      </div>

      {report.issues.map((iss, i) => (

        <div key={i} className="flex gap-2 text-xs text-slate-700">

          <span className="text-amber-600 shrink-0"></span>

          [{iss.severity.toUpperCase()}] {iss.description}

        </div>

      ))}

      {report.compliantAspects.map((a, i) => (

        <div key={i} className="flex gap-2 text-xs text-emerald-700">

          <span className="shrink-0"></span>{a}

        </div>

      ))}

      {report.recommendations.length > 0 && (

        <div className="text-[10px] text-slate-600 pt-1 space-y-0.5">

          {report.recommendations.map((r, i) => <div key={i}>...{r}</div>)}

        </div>

      )}

    </div>

  );

}



// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompliancePage() {
  const [text,             setText]             = useState("");

  const [assetType,        setAssetType]        = useState<AssetType>("REIT");

  const [assetName,        setAssetName]        = useState("");

  const [mode,             setMode]             = useState<"check" | "submit">("check");

  const [invoiceText,      setInvoiceText]      = useState("");

  const [contractText,     setContractText]     = useState("");

  const [invoiceFileName,  setInvoiceFileName]  = useState<string | null>(null);

  const [contractFileName, setContractFileName] = useState<string | null>(null);



  // ── AI prospectus generator state ─────────────────────────────────────────

  const [genOpen,        setGenOpen]        = useState(false);

  const [genLoading,     setGenLoading]     = useState(false);

  const [genError,       setGenError]       = useState<string | null>(null);

  const [genIssuer,      setGenIssuer]      = useState("Harbour Capital Markets Corporation Limited");

  const [genCoupon,      setGenCoupon]      = useState("");

  const [genMaturity,    setGenMaturity]    = useState("");

  const [genIssuance,    setGenIssuance]    = useState("");

  const [genRating,      setGenRating]      = useState("");

  const [genCurrency,    setGenCurrency]    = useState("USD");

  const [genDesc,        setGenDesc]        = useState("");

  const [genGreenPurpose,setGenGreenPurpose]= useState("");

  const [unitPrice,        setUnitPrice]        = useState("1");

  const [totalSupply,      setTotalSupply]      = useState("1000");

  const [loading,          setLoading]          = useState(false);

  const [result,           setResult]           = useState<ComplianceResult | null>(null);

  const [tradeResult,      setTradeResult]      = useState<TradeResult | null>(null);

  const [error,            setError]            = useState<string | null>(null);

  const [loadingStep,      setLoadingStep]      = useState(0);

  const [auditReport,      setAuditReport]      = useState<AuditReport | null>(null);
  const [auditLoading,     setAuditLoading]     = useState(false);
  const [auditError,       setAuditError]       = useState<string | null>(null);
  const [sfcSubmitted,     setSfcSubmitted]     = useState(false);

  async function runAudit() {
    setAuditLoading(true);
    setAuditError(null);
    setAuditReport(null);
    try {
      const res = await fetch("/api/audit/contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName: "HarbourRWA" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audit failed");
      setAuditReport(data as AuditReport);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setAuditLoading(false);
    }
  }



  const isTradeReceivable = assetType === "TradeReceivable";



  async function handleGenerate() {

    setGenLoading(true); setGenError(null);

    try {

      const res = await fetch("/api/compliance/generate-prospectus", {

        method: "POST", headers: { "Content-Type": "application/json" },

        body: JSON.stringify({

          assetType, assetName,

          issuerName:   genIssuer,

          coupon:       genCoupon,

          maturity:     genMaturity,

          totalIssuance:genIssuance,

          rating:       genRating,

          currency:     genCurrency,

          description:  genDesc,

          greenPurpose: genGreenPurpose,

        }),

      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Generation failed");

      setText(data.prospectus);

      setGenOpen(false);

    } catch (err) {

      setGenError(err instanceof Error ? err.message : "Generation failed");

    } finally {

      setGenLoading(false);

    }

  }



  async function submitToSFC(complianceScore: number, reportHash: string, prospectusExcerpt: string) {
    try {
      await fetch("/api/sfc-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: assetName,
          type: assetType,
          issuer: selectedSubmission?.issuer ?? "Harbour Capital Markets Corporation Limited",
          submitted: new Date().toISOString().slice(0, 10),
          complianceScore,
          auditHash: reportHash ?? "",
          totalIssuance: totalSupply,
          unitPrice,
          currency: "USD",
          prospectusExcerpt: prospectusExcerpt?.slice(0, 800) ?? "",
          sponsorLicence: "Type 6 LC",
        }),
      });
    } catch { /* non-blocking */ }
    setSfcSubmitted(true);
  }

  async function handleSubmit(e: React.FormEvent) {

    e.preventDefault();

    setLoadingStep(0);

    setLoading(true); setError(null); setResult(null); setTradeResult(null);

    try {

      if (isTradeReceivable) {

        const res = await fetch("/api/compliance/trade-receivable", {

          method: "POST", headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ invoiceText, contractText, assetName, totalSupply: Number(totalSupply), unitPrice: Number(unitPrice), assetDescription: "" }),

        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Request failed");

        setTradeResult(data as TradeResult);

      } else {

        const endpoint = mode === "submit" ? "/api/compliance/submit" : "/api/compliance/check";

        const res = await fetch(endpoint, {

          method: "POST", headers: { "Content-Type": "application/json" },

          body: JSON.stringify({ text, assetType, assetName }),

        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Request failed");

        setResult(data as ComplianceResult);

      }

    } catch (err) {

      setError(err instanceof Error ? err.message : "Unknown error");

    } finally {

      setLoading(false);

    }

  }



  // Pre-fill prospectus text if navigated from /prospectus page

  useEffect(() => {

    try {

      const stored = sessionStorage.getItem("harbourRWA_prospectusText");

      if (stored) {

        sessionStorage.removeItem("harbourRWA_prospectusText");

        const id = window.setTimeout(() => setText(stored), 0);

        return () => window.clearTimeout(id);

      }

    } catch { /* SSR guard */ }

  }, []);



  useEffect(() => {

    if (!loading) return;

    const id = setInterval(() => setLoadingStep((s) => s + 1), 1400);

    return () => clearInterval(id);

  }, [loading]);

  // -- Sponsor inbox --
  const [submissions,        setSubmissions]        = useState<PendingSubmission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<PendingSubmission | null>(null);

  async function loadSubmissions() {
    try {
      const res = await fetch("/api/sponsor-inbox");
      const data = await res.json();
      setSubmissions(data.submissions ?? []);
    } catch { /* ignore */ }
  }

  function handleSelectSubmission(sub: PendingSubmission) {
    setSelectedSubmission(sub);
    setAssetName(sub.assetName);
    setAssetType(sub.assetType as AssetType);
    if (sub.assetType === "TradeReceivable") {
      if (sub.invoiceText)  setInvoiceText(sub.invoiceText);
      if (sub.contractText) setContractText(sub.contractText);
    } else {
      if (sub.prospectusText) setText(sub.prospectusText);
    }
    if (sub.totalSupply) setTotalSupply(sub.totalSupply);
    if (sub.unitPrice)   setUnitPrice(sub.unitPrice);
    setResult(null);
    setTradeResult(null);
    setError(null);
  }

  useEffect(() => {
    const id = window.setTimeout(() => { void loadSubmissions(); }, 0);
    return () => window.clearTimeout(id);
  }, []);



  const disabled = loading || (isTradeReceivable ? !assetName.trim() || invoiceText.length < 10 || contractText.length < 10 : !text.trim() || !assetName.trim());



  const inputCls = "w-full text-sm rounded-md px-3 py-2.5 outline-none transition-colors";

  const inputStyle: React.CSSProperties = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#222222" };



  const LOADING_STEPS = isTradeReceivable

    ? ["Parsing invoice document...", "Parsing trade contract...", "Checking AML / anti-money-laundering risks...", "Validating cross-document consistency...",

       "Applying SFC tokenisation rules...", "Generating risk-rating report..."]

    : ["Parsing prospectus content...", "Checking issuer eligibility (SFC-001)...", "Checking investor restrictions (SFC-002)...",

       "Verifying asset backing structure (SFC-003)...", "Checking custody arrangements (SFC-004)...", "Assessing disclosure adequacy (SFC-005)...",

       "Reviewing AML/KYC compliance (SFC-006)...", "Reviewing technical risk (SFC-007)...", "Compiling score and recommendations..."];



  const showRight = result !== null || tradeResult !== null || loading;



  return (

    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex gap-5 items-start">

        {/* Left sidebar: issuer submission queue */}
        <div className="w-56 shrink-0 sticky top-6">
          <div className="rounded-xl p-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex items-center justify-between pb-2 mb-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
              <span className="text-[11px] font-semibold text-slate-700">📥 Issuer Submission Queue</span>
              <span className="text-[10px] text-slate-400">{submissions.length} item{submissions.length !== 1 ? "s" : ""}</span>
            </div>
            {submissions.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-4">No submissions pending review</p>
            ) : (
              <div className="space-y-1">
                {submissions.map((sub) => (
                  <button key={sub.id} type="button" onClick={() => handleSelectSubmission(sub)}
                    className="w-full text-left rounded-lg px-2.5 py-2 transition-colors"
                    style={{
                      background: selectedSubmission?.id === sub.id ? "rgba(26,86,219,0.07)" : "transparent",
                      border: `1px solid ${selectedSubmission?.id === sub.id ? "rgba(26,86,219,0.3)" : "transparent"}`,
                    }}>
                    <div className="text-[11px] font-semibold text-slate-800 truncate">{sub.assetName || "Unnamed"}</div>
                    <div className="flex items-center justify-between mt-0.5 gap-1">
                      <span className="text-[10px] text-slate-500">{sub.assetType}</span>
                      <span className="text-[10px] text-slate-400">{new Date(sub.receivedAt).toLocaleDateString("en-GB")}</span>
                    </div>
                    {sub.issuer && <div className="text-[10px] text-slate-400 truncate mt-0.5">{sub.issuer}</div>}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={loadSubmissions}
              className="w-full mt-2 text-[10px] text-slate-500 hover:text-slate-700 py-1.5 rounded transition-colors"
              style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
              Refresh
            </button>
          </div>
        </div>

        {/* Main area: form + results */}
        <div className="flex-1 min-w-0 flex gap-8 items-start">
        <div className={showRight ? "w-[460px] shrink-0" : "w-full max-w-2xl"}>



      {/* Header */}

      <div className="mb-6">

        <div className="rounded-lg px-3 py-2.5 text-xs mb-4" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>

          <span className="font-semibold text-amber-700 uppercase tracking-wide text-[10px]">Sponsor (Type 6 LC) · AI Compliance Review &amp; SFC Issuance Filing</span>

          <p className="text-slate-600 mt-1">Operated by the <strong className="text-amber-700">Sponsor (Type 6 LC)</strong>. The sponsor independently completes the AI compliance review before filing with the SFC, submitting the compliance report and audit evidence to apply for token issuance authorisation under SFO s.103. The compliance score is anchored on-chain in ComplianceOracle.sol and is tamper-proof.</p>

        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">AI Compliance Review &amp; SFC Issuance Filing</h1>

        <p className="text-sm text-slate-500">

          {isTradeReceivable

            ? "Upload the issuer's commercial invoice and trade contract. AI validates document consistency, AML risk and SFC tokenisation rules. Once compliant, the Type 6 LC files with the SFC."

            : "Paste the issuer's prospectus or term sheet. AI scores it against the 8 SFC tokenisation rules item by item. Once passed, the Type 6 LC submits the issuance authorisation application to the SFC."}

        </p>

      </div>



      {/* ── Form ── */}

      <form onSubmit={handleSubmit} className="space-y-6">



        {/* Asset name */}

        <div>

          <label className="block text-xs font-medium text-slate-600 mb-2">Asset Name</label>

          <input className={inputCls} style={inputStyle}

            placeholder="e.g. Harbour Infrastructure Bond Token 2026"

            value={assetName} onChange={(e) => setAssetName(e.target.value)}

            onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}

            onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} required />

        </div>



        {/* Asset type */}

        <div>

          <label className="block text-xs font-medium text-slate-600 mb-2">Asset Type</label>

          <div className="flex flex-wrap gap-2">

            {(["REIT", "Bond", "GreenBond", "TradeReceivable"] as AssetType[]).map((t) => (

              <button key={t} type="button" onClick={() => setAssetType(t)}

                className="px-3.5 py-1.5 rounded text-xs font-medium transition-colors"

                style={{

                  background: assetType === t ? "#1d4ed8" : "#f3f1eb",

                  border: `1px solid ${assetType === t ? "#1a56db" : "rgba(0,0,0,0.12)"}`,

                  color: assetType === t ? "white" : "#6b8499",

                }}>

                {t}

              </button>

            ))}

          </div>

        </div>



        {/* Trade Receivable */}

        {isTradeReceivable ? (

          <>

            <div className="grid grid-cols-2 gap-4">

              <div>

                <label className="block text-xs font-medium text-slate-600 mb-2">Total Token Supply</label>

                <input type="number" className={inputCls} style={inputStyle} value={totalSupply}

                  onChange={(e) => setTotalSupply(e.target.value)}

                  onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}

                  onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} />

              </div>

              <div>

                <label className="block text-xs font-medium text-slate-600 mb-2">Unit Price (USD)</label>

                <input type="number" step="0.01" className={inputCls} style={inputStyle} value={unitPrice}

                  onChange={(e) => setUnitPrice(e.target.value)}

                  onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}

                  onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} />

              </div>

            </div>

            <p className="text-[11px] text-slate-600 -mt-4">

              Token face value ={" "}

              <strong className="text-blue-400">${(Number(totalSupply) * Number(unitPrice)).toLocaleString()}</strong>

            </p>

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "1.5rem" }}>

              <div className="text-xs font-medium text-slate-600 mb-4">Documents</div>

              <div className="space-y-4">

                <DocumentUploadField label="Commercial Invoice" value={invoiceText} fileName={invoiceFileName}

                  onExtracted={(t, n) => { setInvoiceText(t); setInvoiceFileName(n); }}

                  onClear={() => { setInvoiceText(""); setInvoiceFileName(null); }}

                  placeholder="Invoice ...counterparty, amount, goods, due date" />

                <DocumentUploadField label="Trade Contract" value={contractText} fileName={contractFileName}

                  onExtracted={(t, n) => { setContractText(t); setContractFileName(n); }}

                  onClear={() => { setContractText(""); setContractFileName(null); }}

                  placeholder="Sales/purchase contract ...payment terms, governing law" />

              </div>

            </div>

          </>

        ) : (

          <>

            {/* ── AI Prospectus Generator ── */}

            <div className="rounded-md overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)" }}>

              <button type="button" onClick={() => setGenOpen(!genOpen)}

                className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium transition-colors"

                style={{ background: "#ffffff", color: genOpen ? "#a78bfa" : "#64748b" }}>

                <span className="flex items-center gap-2">

                  <span style={{ color: "#a78bfa" }}></span>

                  Generate draft prospectus with AI

                </span>

                <svg className="w-4 h-4 transition-transform" style={{ transform: genOpen ? "rotate(180deg)" : "none" }}

                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>

                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />

                </svg>

              </button>

              {genOpen && (

                <div className="px-4 py-4 space-y-4" style={{ background: "#ffffff", borderTop: "1px solid rgba(0,0,0,0.10)" }}>

                  <p className="text-[11px]" style={{ color: "#64748b" }}>

                    Fill in the key terms below. AI will generate a complete SFC-format prospectus and auto-insert it into the text area so you can review and run a compliance check.

                  </p>

                  <div className="grid grid-cols-2 gap-3">

                    <div className="col-span-2">

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Issuer Name</label>

                      <input className={inputCls} style={inputStyle} value={genIssuer}

                        onChange={(e) => setGenIssuer(e.target.value)}

                        onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                        placeholder="e.g. Harbour Capital Markets Corporation Limited" />

                    </div>

                    <div>

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Coupon / Yield Rate</label>

                      <input className={inputCls} style={inputStyle} value={genCoupon}

                        onChange={(e) => setGenCoupon(e.target.value)}

                        onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                        placeholder="e.g. 5.50% p.a. semi-annual" />

                    </div>

                    <div>

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Maturity / Redemption Date</label>

                      <input className={inputCls} style={inputStyle} value={genMaturity}

                        onChange={(e) => setGenMaturity(e.target.value)}

                        onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                        placeholder="e.g. 15 July 2031" />

                    </div>

                    <div>

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Total Issuance Amount</label>

                      <input className={inputCls} style={inputStyle} value={genIssuance}

                        onChange={(e) => setGenIssuance(e.target.value)}

                        onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                        placeholder="e.g. 100000000" />

                    </div>

                    <div>

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Credit Rating</label>

                      <select className={inputCls} style={inputStyle} value={genRating}

                        onChange={(e) => setGenRating(e.target.value)}>

                        <option value="">-- Select --</option>

                        {["Moody's Aaa", "Moody's Aa1", "Moody's Aa2", "Moody's Aa3",

                          "Moody's A1", "Moody's A2", "Moody's A3",

                          "Moody's Baa1", "Moody's Baa2", "Moody's Baa3",

                          "S&P AAA", "S&P AA+", "S&P AA", "S&P AA-",

                          "S&P A+", "S&P A", "S&P A-",

                          "S&P BBB+", "S&P BBB", "S&P BBB-",

                          "Fitch AAA", "Fitch AA+", "Fitch AA", "Fitch AA-",

                          "Fitch A+", "Fitch A", "Fitch A-",

                          "Fitch BBB+", "Fitch BBB", "Fitch BBB-"].map((r) => (

                          <option key={r} value={r}>{r}</option>

                        ))}

                      </select>

                    </div>

                    <div>

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Settlement Currency</label>

                      <select className={inputCls} style={inputStyle} value={genCurrency}

                        onChange={(e) => setGenCurrency(e.target.value)}>

                        {["USD", "HKD", "EUR", "SGD", "CNH"].map((c) => (

                          <option key={c} value={c}>{c}</option>

                        ))}

                      </select>

                    </div>

                    {assetType === "GreenBond" && (

                      <div className="col-span-2">

                        <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Green Bond ...Use of Proceeds</label>

                        <input className={inputCls} style={inputStyle} value={genGreenPurpose}

                          onChange={(e) => setGenGreenPurpose(e.target.value)}

                          onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                          onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                          placeholder="e.g. Solar energy infrastructure, renewable power projects" />

                      </div>

                    )}

                    <div className="col-span-2">

                      <label className="block text-[10px] font-medium mb-1" style={{ color: "#475569" }}>Asset Description (optional)</label>

                      <textarea className={`${inputCls} resize-none`} style={{ ...inputStyle, height: "60px" }}

                        value={genDesc} onChange={(e) => setGenDesc(e.target.value)}

                        onFocus={(e) => (e.currentTarget.style.borderColor = "#7c3aed")}

                        onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}

                        placeholder="Brief description of the asset or fund structure..." />

                    </div>

                  </div>

                  {genError && (

                    <div className="text-[11px] text-red-400 rounded px-3 py-2"

                      style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>

                      {genError}

                    </div>

                  )}

                  {!assetName.trim() && !genLoading && (

                    <div className="text-[11px] rounded px-3 py-2 flex items-center gap-1.5"

                      style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", color: "#ca8a04" }}>

                      <span></span>

                      <span>Please fill in the <strong>Asset Name</strong> above to enable this button.</span>

                    </div>

                  )}

                  <button type="button" onClick={handleGenerate}

                    disabled={genLoading || !assetName.trim()}

                    className="w-full py-2.5 text-xs font-semibold rounded transition-opacity hover:opacity-90 disabled:opacity-40 text-white"

                    style={{ background: "linear-gradient(135deg, #5b21b6 0%, #1d4ed8 100%)" }}>

                    {genLoading ? "Generating prospectus..." : "Generate Draft Prospectus"}

                  </button>

                </div>

              )}

            </div>



            {/* ── Total Supply + Unit Price (SFC Issuance Metrics — Required for SFC Filing) ── */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Total Token Supply</label>
                <input type="number" className={inputCls} style={inputStyle} value={totalSupply}
                  onChange={(e) => setTotalSupply(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Unit Price (USD)</label>
                <input type="number" step="0.01" className={inputCls} style={inputStyle} value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}
                  onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} />
              </div>
            </div>
            <p className="text-[11px] text-slate-600 -mt-4">
              Issuance Size ={" "}
              <strong className="text-blue-400">USD {(Number(totalSupply) * Number(unitPrice)).toLocaleString()}</strong>
            </p>

            {/* ── Prospectus text area ── */}

            <div>

              <label className="block text-xs font-medium text-slate-600 mb-2">Prospectus / Term Sheet</label>

              <textarea className={`${inputCls} resize-none font-mono`}

                style={{ ...inputStyle, height: "180px" }}

                placeholder="Paste prospectus or term sheet text here..."

                value={text} onChange={(e) => setText(e.target.value)}

                onFocus={(e) => (e.currentTarget.style.borderColor = "#1a56db")}

                onBlur={(e)  => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")} />

              <div className="text-[11px] text-slate-700 mt-1.5">{text.length} characters</div>

            </div>

            <div>

              <label className="block text-xs font-medium text-slate-600 mb-2">Mode</label>

              <div className="flex rounded overflow-hidden" style={{ width: "fit-content", border: "1px solid rgba(0,0,0,0.10)" }}>

                {[

                  { v: "check",  l: "AI Compliance Check (Analysis Only)"   },

                  { v: "submit", l: "Review + Write to ComplianceOracle.sol" },

                ].map((m, i) => (

                  <button key={m.v} type="button" onClick={() => setMode(m.v as "check" | "submit")}

                    className="px-4 py-2 text-xs transition-colors"

                    style={{

                      background: mode === m.v ? "#1d4ed8" : "#f3f1eb",

                      color: mode === m.v ? "white" : "#6b8499",

                      borderRight: i === 0 ? "1px solid rgba(0,0,0,0.10)" : "none",

                    }}>

                    {m.l}

                  </button>

                ))}

              </div>

            </div>

          </>

        )}



        {error && (

          <div className="text-xs text-red-600 rounded-md px-4 py-3"

            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>

            {error}

          </div>

        )}



        <button type="submit" disabled={disabled}

          className="w-full py-2.5 text-sm font-semibold text-white rounded-md transition-opacity hover:opacity-90 disabled:opacity-40"

          style={{ background: "#1d4ed8" }}>

          {loading

            ? (isTradeReceivable ? "Analysing documents..." : "Running AI compliance review...")

            : isTradeReceivable ? "Run Trade Receivable Compliance"

            : mode === "submit" ? "Run AI Review + Write On-Chain" : "Run AI Compliance Review"}

        </button>

      </form>



        </div>{/* ── end left column ── */}



        {/* ── Right column: Loading / Results ── */}

        {showRight && (

          <div className="flex-1 min-w-0 space-y-6">

            {loading && (

              <div className="rounded-lg p-5 space-y-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>

                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">

                  <span className="inline-block w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />

                  Running compliance check...
                </div>

                <div className="space-y-2.5 mt-2">

                  {LOADING_STEPS.map((step, i) => (

                    <div key={i} className={`flex items-center gap-2.5 text-xs transition-all duration-300 ${

                      i < loadingStep ? "text-emerald-400" :

                      i === loadingStep ? "text-blue-300" :

                      "text-slate-600 opacity-40"

                    }`}>

                      <span className="w-3 text-center shrink-0 font-bold">

                        {i < loadingStep ? "✓" : i === loadingStep ? "▶" : "·"}

                      </span>

                      <span className={i === loadingStep ? "font-medium" : ""}>{step}</span>

                    </div>

                  ))}

                </div>

              </div>

            )}



            {/* ── Standard results ── */}

            {result && (

              <div className="space-y-6">

          {/* Score header */}

          <div>

            <div className="flex items-start justify-between mb-1">

              <div>

                <div className="text-lg font-bold text-gray-900">{result.assetName}</div>

                <div className="flex items-center gap-3 mt-1">

                  <span className="font-mono text-[10px] text-blue-400">{result.assetType}</span>

                  {result.engine && (

                    <span className="text-[10px] text-violet-400">{result.engine === "llm" ? "Qwen2.5-72B" : "Rule Engine"}</span>

                  )}

                </div>

              </div>

              <div className="text-right">

                <div className="text-4xl font-bold text-gray-900 tabular-nums">{result.score}</div>

                <div className="text-[10px] text-slate-600 mt-0.5">/ 100</div>

              </div>

            </div>

            <ScoreBar score={result.score} />

            <div className="flex items-center justify-between mt-2">

              <span className={`text-xs font-semibold ${result.passed ? "text-emerald-400" : "text-red-400"}`}>

                {result.passed ? "PASSED" : "FAILED"}

              </span>

              {result.onChain && result.txHash && (

                <a href={result.explorerUrl ?? `https://sepolia.etherscan.io/tx/${result.txHash}`} target="_blank" rel="noopener noreferrer"

                  className="text-[11px] font-mono text-blue-400 hover:text-blue-300 transition-colors">

                  On-chain: {result.txHash.slice(0, 18)}...
                </a>

              )}

            </div>

          </div>



          <p className="text-sm text-slate-600 leading-relaxed">{result.summary}</p>



          {/* Rule breakdown */}

          {result.breakdown?.length > 0 && (

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "1.5rem" }}>

              <div className="text-xs font-semibold text-slate-700 mb-4">SFC Rule Breakdown</div>

              <div className="space-y-4">

                {result.breakdown.map((rule) => (

                  <div key={rule.ruleId}>

                    <div className="flex justify-between text-xs mb-1.5">

                      <span className="text-slate-600">{rule.ruleId}: {rule.ruleName}</span>

                      <span className="font-mono text-slate-500">{rule.score}/{rule.maxScore}</span>

                    </div>

                    <ScoreBar score={rule.score} max={rule.maxScore} />

                    {rule.details && <p className="text-[10px] text-slate-600 mt-1">{rule.details}</p>}

                  </div>

                ))}

              </div>

            </div>

          )}



          {/* Recommendations */}

          {result.recommendations?.length > 0 && (

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "1.5rem" }}>

              <div className="text-xs font-semibold text-amber-400 mb-3">Recommendations</div>

              <ol className="space-y-2">

                {result.recommendations.map((r, i) => (

                  <li key={i} className="flex gap-3 text-xs text-slate-600">

                    <span className="text-amber-500 shrink-0 font-bold tabular-nums">{i + 1}.</span>{r}

                  </li>

                ))}

              </ol>

            </div>

          )}

          {/* Submit to SFC CTA — shown when score is submitted on-chain and passed */}

          {result.passed && (

            <div className="pt-5 mt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
              {sfcSubmitted ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <svg className="w-4 h-4 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-sm font-semibold text-emerald-700">Successfully submitted to SFC</div>
                    <div className="text-xs text-emerald-600 mt-0.5">The application has been forwarded to the SFC Issuance Review portal. The regulator will review and approve.</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    {result.onChain
                      ? <>Score recorded on <code className="text-blue-400">ComplianceOracle</code>. Submit to SFC for issuance authorisation.</>
                      : <>Compliance check passed. Submit to SFC for issuance authorisation.</>}
                  </div>
                  <button
                    onClick={() => void submitToSFC(result.score, result.reportHash ?? "", text)}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded transition-opacity hover:opacity-90"
                    style={{ background: "#1d4ed8" }}
                  >
                    Submit to SFC →
                  </button>
                </div>
              )}
            </div>

          )}

            </div>

            )}



            {/* ── Trade Receivable results ── */}

            {tradeResult && (

              <div className="space-y-6">



          {tradeResult.sfcCompliance && (

            <div>

              <div className="flex items-start justify-between mb-1">

                <div>

                  <div className="text-sm font-semibold text-slate-700">SFC Compliance Score</div>

                  {tradeResult.sfcCompliance.engine && (

                    <div className="text-[10px] text-violet-400 mt-0.5">

                      {tradeResult.sfcCompliance.engine === "llm" ? "Qwen2.5-72B" : "Rule Engine"}

                    </div>

                  )}

                </div>

                <div className="text-right">

                  <div className="text-4xl font-bold text-gray-900 tabular-nums">{tradeResult.sfcCompliance.score}</div>

                  <div className="text-[10px] text-slate-600 mt-0.5">/ 100</div>

                </div>

              </div>

              <ScoreBar score={tradeResult.sfcCompliance.score} />

              <div className="mt-2">

                <span className={`text-xs font-semibold ${tradeResult.sfcCompliance.passed ? "text-emerald-400" : "text-red-400"}`}>

                  {tradeResult.sfcCompliance.passed ? "PASSED" : "FAILED"}

                </span>

              </div>

              {tradeResult.sfcCompliance.summary && (

                <p className="text-sm text-slate-600 mt-3 leading-relaxed">{tradeResult.sfcCompliance.summary}</p>

              )}

            </div>

          )}



          <div className="space-y-3">

            <RiskCard title="Invoice Risk Analysis"    report={tradeResult.invoiceRisk}  />

            <RiskCard title="Contract Risk Analysis"   report={tradeResult.contractRisk} />

            <RiskCard title="RWA Token Structure Risk" report={tradeResult.rwaRisk}      />

          </div>



          {tradeResult.crossValidation && (

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "1.5rem" }}>

              <div className="flex items-center justify-between mb-3">

                <div className="text-xs font-semibold text-slate-700">Cross-Validation</div>

                <span className={`text-xs font-semibold ${tradeResult.crossValidation.allPassed ? "text-emerald-400" : "text-amber-400"}`}>

                  {tradeResult.crossValidation.rules.filter((r) => r.passed).length}/{tradeResult.crossValidation.rules.length} rules passed

                </span>

              </div>

              <div className="space-y-2">

                {tradeResult.crossValidation.rules.map((r) => (

                  <div key={r.id} className="flex gap-3 text-xs">

                    <span className={`shrink-0 font-bold ${r.passed ? "text-emerald-400" : "text-red-400"}`}>{r.passed ? "✓" : "×"}</span>

                    <span className="font-mono text-slate-600 w-14 shrink-0">{r.id}</span>

                    <span className="text-slate-600">{r.name} — <span className="text-slate-700">{r.detail}</span></span>

                  </div>

                ))}

              </div>

            </div>

          )}



          {tradeResult.sfcCompliance?.recommendations?.length ? (

            <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "1.5rem" }}>

              <div className="text-xs font-semibold text-amber-400 mb-3">Recommendations</div>

              <ol className="space-y-2">

                {tradeResult.sfcCompliance.recommendations!.map((r, i) => (

                  <li key={i} className="flex gap-3 text-xs text-slate-600">

                    <span className="text-amber-500 shrink-0 font-bold tabular-nums">{i + 1}.</span>{r}

                  </li>

                ))}

              </ol>

            </div>

          ) : null}



          {/* Submit to SFC CTA for trade receivables */}

          {tradeResult.sfcCompliance?.passed && tradeResult.crossValidation?.allPassed && (

            <div className="pt-5 mt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
              {sfcSubmitted ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <svg className="w-4 h-4 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-sm font-semibold text-emerald-700">Successfully submitted to SFC</div>
                    <div className="text-xs text-emerald-600 mt-0.5">The application has been forwarded to the SFC Issuance Review portal. The regulator will review and approve.</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-600">
                    All cross-validation rules passed. Submit to SFC for issuance authorisation.
                  </div>
                  <button
                    onClick={() => void submitToSFC(tradeResult.sfcCompliance?.score ?? 0, tradeResult.reportHash ?? "", invoiceText)}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded transition-opacity hover:opacity-90"
                    style={{ background: "#1d4ed8" }}
                  >
                    Submit to SFC →
                  </button>
                </div>
              )}
            </div>

          )}

        </div>

      )}

          </div>

        )}

        </div>{/* end main area */}

      </div>

    </div>

  );

}

