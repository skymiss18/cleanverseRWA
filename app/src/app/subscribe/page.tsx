"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { type Address } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { useWallet } from "@/lib/wallet-context";

// ── Constants ──────────────────────────────────────────────────────────────────

const COUPON_RATE      = 0.055;
const SUBSCRIPTION_FEE = 0.0025;   // 0.25%
const ANNUAL_MGMT_FEE  = 0.0008;   // 0.08%
const CUSTODY_FEE      = 0.0005;   // 0.05%
const MIN_TOKENS       = 20;
const DEADLINE         = "30 June 2026, 17:00 HKT";
const SETTLEMENT       = "15 July 2026";
const DEFAULT_ASSET_NAME = "Nexus Infrastructure Bond Token (NIBT)";

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Pre-check", "Subscription", "Declarations", "Payment"];

type ApprovedAsset = {
  id: string;
  asset: string;
  type: string;
  status: "Pending SFC Review" | "Approved" | "Changes Required";
  unitPrice?: string;
};

type AssetType = "Bond" | "GreenBond" | "REIT" | "TradeReceivable";

type SponsorAsset = {
  assetName: string;
  unitPrice?: string;
};

type AssetOption = {
  id?: string;
  name: string;
  type: AssetType;
  unitPrice: number;
  tokenSymbol?: string;
  atokenAddress?: string;
};

function buildRefPrefix(assetName: string) {
  const cleaned = assetName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned.slice(0, 4) || "RWA") + "-";
}

function makeRefNum(assetName: string) {
  const suffix = Date.now().toString(36).toUpperCase().slice(-8);
  return buildRefPrefix(assetName) + suffix;
}

async function fetchApiWithSubpathFallback(input: string, init?: RequestInit) {
  const primary = await fetch(input, init);
  if (primary.status !== 404 || typeof window === "undefined" || !input.startsWith("/api/")) {
    return primary;
  }

  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  if (!firstPathSegment) {
    return primary;
  }

  const fallbackPath = `/${firstPathSegment}${input}`;
  if (fallbackPath === input) {
    return primary;
  }

  return fetch(fallbackPath, init);
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SubscribePage() {
  const { wallet: connectedWallet, connect: connectEvmWallet, connecting: evmConnecting } = useWallet();
  const { data: walletClient } = useWalletClient();
  const walletPublicClient = usePublicClient();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [piConfirmed,     setPiConfirmed]     = useState(false);
  const [notUSPerson,     setNotUSPerson]     = useState(false);

  // Step 2
  const [assetName,       setAssetName]       = useState(DEFAULT_ASSET_NAME);
  const [approvedAssets,  setApprovedAssets]  = useState<AssetOption[]>([]);
  const [assetSelected,   setAssetSelected]   = useState(false);
  const [assetsLoading,   setAssetsLoading]   = useState(true);
  const [assetsError,     setAssetsError]     = useState<string | null>(null);
  const [tokens,          setTokens]          = useState("20");

  // Step 3
  const [declProspectus,  setDeclProspectus]  = useState(false);
  const [declConflict,    setDeclConflict]    = useState(false);
  const [declRisk,        setDeclRisk]        = useState(false);
  const [declPiStatus,    setDeclPiStatus]    = useState(false);

  const walletAddress = "";

  // Step 4
  const [refNum, setRefNum] = useState(() => makeRefNum(DEFAULT_ASSET_NAME));
  const [submitted,     setSubmitted]     = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState<string | null>(null);
  const [txHash,        setTxHash]        = useState<string | null>(null);
  const [mintTxHash,    setMintTxHash]    = useState<string | null>(null);
  const [onChain,       setOnChain]       = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"swift" | "onchain">("onchain");
  const [paying,        setPaying]        = useState(false);
  const [payError,      setPayError]      = useState<string | null>(null);
  const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  // Deterministic hash computed before broadcast; only used for display when the actual
  // broadcast fails, so the "real" paymentTxHash never points at a transaction that was
  // never submitted to the chain (that would make the confirm/retry button act on a fake tx).
  const [attemptedTxHash, setAttemptedTxHash] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"Idle" | "Submitted" | "Pending" | "Confirmed" | "Failed" | "Skipped">("Idle");
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [paymentDetails, setPaymentDetails] = useState<{
    treasuryAddress: Address;
    expectedAmount: string;
    expectedAmountWei: string;
    paymentCurrency: "ETH";
  } | null>(null);
  const [contractHash, setContractHash] = useState<string | null>(null);
  const [atokenApplication, setATokenApplication] = useState<{
    issuanceId: string;
    requestId: string;
    applyStatus: string;
    subscriptionOpen: boolean;
    atokenAddress?: string;
    tokenSymbol: string;
  } | null>(null);
  const [cleanverseEligibility, setCleanverseEligibility] = useState<{
    eligible: boolean;
    checkedAt: string;
    apass?: { tier: string; subTier: number; expirationTime: number };
    verification?: { code: number; message: string };
    reasons: Array<{ code: string; message: string }>;
  } | null>(null);
  const [cleanverseChecking, setCleanverseChecking] = useState(false);

  const assetCode = buildRefPrefix(assetName).replace("-", "");
  const selectedAsset: AssetOption = assetSelected
    ? approvedAssets.find((asset) => asset.name === assetName) ?? { name: assetName, type: "Bond", unitPrice: 1000 }
    : { name: DEFAULT_ASSET_NAME, type: "Bond", unitPrice: 1000 };
  const tokenSymbol = atokenApplication?.tokenSymbol ?? selectedAsset.tokenSymbol ?? assetCode;
  const faceValue = selectedAsset.unitPrice;

  useEffect(() => {
    let active = true;
    async function loadApprovedAssets() {
      try {
        setAssetsLoading(true);
        setAssetsError(null);
        const [sfcRes, sponsorRes, deploymentsRes] = await Promise.all([
          fetchApiWithSubpathFallback("/api/sfc-inbox", { cache: "no-store" }),
          fetchApiWithSubpathFallback("/api/sponsor-inbox", { cache: "no-store" }),
          fetchApiWithSubpathFallback("/api/tokenize/deployments", { cache: "no-store" }),
        ]);
        const sfcData = await sfcRes.json() as { submissions?: ApprovedAsset[] };
        const sponsorData = await sponsorRes.json() as { submissions?: SponsorAsset[] };
        const deploymentsData = await deploymentsRes.json() as Record<string, {
          assetName?: string;
          network?: string;
          standard?: string;
          status?: string;
          contractHash?: string;
          contractAddress?: string;
        }>;

        const sponsorPriceMap = new Map(
          (sponsorData.submissions ?? []).map((entry) => [entry.assetName, Number(entry.unitPrice ?? "0")])
        );

        const uniqueMap = new Map<string, AssetOption>();
        for (const submission of sfcData.submissions ?? []) {
          if (submission.status !== "Approved" || !submission.asset?.trim()) continue;
          const unitPrice = Number(submission.unitPrice ?? sponsorPriceMap.get(submission.asset) ?? 0);
          if (unitPrice <= 0) continue;
          if (!uniqueMap.has(submission.asset)) {
            uniqueMap.set(submission.asset, { id: submission.id, name: submission.asset, type: submission.type as AssetType, unitPrice });
          }
        }

        const finalList = Array.from(uniqueMap.values());

        const ethereumDeployments = Object.values(deploymentsData ?? {}).filter((deployment) =>
          (deployment.network ?? "").toLowerCase().includes("mantle")
          && (deployment.standard ?? "").toLowerCase().includes("erc")
          && (deployment.status ?? "") === "Deployed"
          && !!deployment.contractAddress
          && !!deployment.assetName?.trim()
        );
        const preferredAssetName = ethereumDeployments.length > 0
          ? (ethereumDeployments[ethereumDeployments.length - 1].assetName ?? "").trim()
          : "";

        if (preferredAssetName && !finalList.some((asset) => asset.name === preferredAssetName)) {
          finalList.unshift({ name: preferredAssetName, type: "Bond", unitPrice: 1000 });
        }

        const subscribableAssets = (await Promise.all(finalList.map(async (asset) => {
          if (!asset.id) return null;
          try {
            const response = await fetchApiWithSubpathFallback(`/api/cleanverse/atoken/launch?issuanceId=${encodeURIComponent(asset.id)}`, { cache: "no-store" });
            if (!response.ok) return null;
            const data = await response.json() as { application?: { subscriptionOpen?: boolean; atokenAddress?: string; tokenSymbol?: string } | null };
            if (!data.application?.subscriptionOpen || !data.application.atokenAddress) return null;
            return { ...asset, tokenSymbol: data.application.tokenSymbol, atokenAddress: data.application.atokenAddress };
          } catch {
            return null;
          }
        }))).filter((asset) => asset !== null);

        if (!active) return;
        setApprovedAssets(subscribableAssets);
        setAssetSelected((selected) => selected && subscribableAssets.some((asset) => asset.name === assetName));
      } catch {
        if (!active) return;
        setAssetsError("Failed to load approved assets");
        setApprovedAssets([]);
        setAssetSelected(false);
      } finally {
        if (active) setAssetsLoading(false);
      }
    }

    void loadApprovedAssets();

    return () => {
      active = false;
    };
  }, []);

  const kycWalletAddress = walletAddress || connectedWallet || "";
  const effectiveWalletAddress = kycWalletAddress;
  const cleanverseMode = Boolean(
    atokenApplication
    && atokenApplication.issuanceId === selectedAsset.id
    && atokenApplication.subscriptionOpen
    && atokenApplication.atokenAddress
  );

  useEffect(() => {
    let active = true;
    if (!selectedAsset.id) return () => { active = false; };
    fetchApiWithSubpathFallback(`/api/cleanverse/atoken/launch?issuanceId=${encodeURIComponent(selectedAsset.id)}`, { cache: "no-store" })
      .then(async (response) => response.status === 404 ? null : (await response.json() as { application?: typeof atokenApplication }).application ?? null)
      .then((application) => { if (active) setATokenApplication(application); })
      .catch(() => { if (active) setATokenApplication(null); });
    return () => { active = false; };
  }, [selectedAsset.id]);

  useEffect(() => {
    let active = true;
    if (!cleanverseMode || !selectedAsset.id || !connectedWallet) return () => { active = false; };
    Promise.resolve()
      .then(() => { if (active) setCleanverseChecking(true); })
      .then(() => fetchApiWithSubpathFallback(`/api/subscription/eligibility?issuanceId=${encodeURIComponent(selectedAsset.id as string)}&walletAddress=${encodeURIComponent(connectedWallet)}`, { cache: "no-store" }))
      .then(async (response) => await response.json() as typeof cleanverseEligibility)
      .then((decision) => { if (active) setCleanverseEligibility(decision); })
      .catch(() => { if (active) setCleanverseEligibility({ eligible: false, checkedAt: new Date().toISOString(), reasons: [{ code: "PROVIDER_ERROR", message: "Eligibility service unavailable" }] }); })
      .finally(() => { if (active) setCleanverseChecking(false); });
    return () => { active = false; };
  }, [cleanverseMode, connectedWallet, selectedAsset.id]);

  const tokenCount   = parseInt(tokens) || 0;
  const principal    = tokenCount * faceValue;
  const subFee       = principal * SUBSCRIPTION_FEE;
  const annualMgmt   = principal * ANNUAL_MGMT_FEE;
  const custodyAnn   = principal * CUSTODY_FEE;
  const totalDue     = principal + subFee;
  const semiCoupon   = tokenCount * faceValue * COUPON_RATE / 2;
  const fixedIncomeAsset = selectedAsset.type === "Bond" || selectedAsset.type === "GreenBond";
  const assetTerms = selectedAsset.type === "REIT"
    ? [
        { label: "Income", value: "Property distributions" },
        { label: "Term", value: "Per trust terms" },
        { label: "Risk", value: "Property portfolio" },
        { label: "Settlement", value: "T+2 on-chain" },
      ]
    : selectedAsset.type === "TradeReceivable"
      ? [
          { label: "Return", value: "Receivable discount" },
          { label: "Term", value: "Invoice due date" },
          { label: "Risk", value: "Obligor credit" },
          { label: "Settlement", value: "T+2 on-chain" },
        ]
      : [
          { label: "Coupon Rate", value: "5.50% p.a." },
          { label: "Maturity", value: "15 Jul 2031" },
          { label: "Rating", value: "Moody's A2 / S&P A" },
          { label: "Settlement", value: "T+2 on-chain" },
        ];
  const paymentFinal = paymentStatus === "Confirmed" || paymentStatus === "Skipped";
  const paymentStatusText = paymentFinal ? "Payment confirmed" : paymentStatus === "Pending" ? "Payment pending finality" : "Payment submitted";

  const displayAmt   = (n: number) =>
    "USD " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  function step1Valid() {
    return cleanverseMode && cleanverseEligibility?.eligible === true && piConfirmed && notUSPerson;
  }

  async function handleConfirmSubscription(pmtTxHash?: string, walletOverride?: string, paymentRefOverride?: string) {
    setSubmitting(true);
    setSubmitError(null);
    setPaymentNotice(null);
    try {
      const subscriptionWallet = walletOverride ?? effectiveWalletAddress;
      const res = await fetchApiWithSubpathFallback("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuanceId: selectedAsset.id,
          walletAddress: kycWalletAddress || subscriptionWallet,
          tokenCount,
          assetName,
          refNum,
          paymentRef: paymentRefOverride ?? paymentRef ?? undefined,
          paymentTxHash: pmtTxHash,
        }),
      });
      const data = await res.json();
      if (res.status === 202) {
        setPaymentTxHash(data.paymentTxHash ?? pmtTxHash ?? paymentTxHash ?? null);
        setPaymentRef(data.paymentRef ?? null);
        if (data.payment) setPaymentDetails(data.payment);
        setPaymentStatus(data.paymentTxHash || pmtTxHash ? (data.paymentStatus ?? "Pending") : "Idle");
        setPaymentNotice(data.message ?? "Sepolia ETH payment required.");
        if (data.contractHash) setContractHash(data.contractHash);
        setOnChain(false);
        setMintTxHash(null);
        return;
      }
      if (!res.ok) {
        setPaymentStatus(data.paymentStatus ?? "Failed");
        setSubmitError(data.error ?? data.message ?? "Submission failed");
        return;
      }
      setTxHash(data.txHash ?? null);
      setMintTxHash(data.mintTxHash ?? data.txHash ?? null);
      setPaymentRef(data.paymentRef ?? null);
      setContractHash(data.contractHash ?? null);
      setPaymentStatus(data.paymentStatus ?? "Confirmed");
      setPaymentNotice(data.message ?? null);
      setOnChain(!!data.onChain);
      setSubmitted(true);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOnChainPayment() {
    setPaying(true);
    setPayError(null);
    setPaymentNotice(null);
    setPaymentStatus("Idle");
    setAttemptedTxHash(null);
    try {
      if (!connectedWallet) {
        await connectEvmWallet();
        return;
      }
      if (!walletClient || !walletPublicClient) throw new Error("Ethereum wallet client is not ready");

      let details = paymentDetails;
      let activePaymentRef = paymentRef;
      if (!details || !activePaymentRef) {
        const intentResponse = await fetchApiWithSubpathFallback("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issuanceId: selectedAsset.id,
            walletAddress: connectedWallet,
            tokenCount,
            assetName,
            refNum,
          }),
        });
        const intent = await intentResponse.json();
        if (intentResponse.status !== 202 || !intent.payment || !intent.paymentRef) {
          throw new Error(intent.error ?? intent.message ?? "Unable to create ETH payment intent");
        }
        details = intent.payment;
        activePaymentRef = intent.paymentRef;
        setPaymentDetails(details);
        setPaymentRef(activePaymentRef);
        setPaymentNotice(intent.message ?? null);
      }
      if (!details || !activePaymentRef) throw new Error("ETH payment intent is incomplete");

      const transactionHash = await walletClient.sendTransaction({
        to: details.treasuryAddress,
        value: BigInt(details.expectedAmountWei),
      });
      setPaymentTxHash(transactionHash);
      setPaymentStatus("Submitted");
      setPaymentNotice("Sepolia ETH transfer submitted; waiting for confirmation.");
      await walletPublicClient.waitForTransactionReceipt({ hash: transactionHash });
      await handleConfirmSubscription(transactionHash, connectedWallet, activePaymentRef);
    } catch (e) {
      setPaymentStatus("Failed");
      setPayError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  async function refreshPendingSubscriptionStatus() {
    if (!paymentRef) return;
    try {
      const res = await fetchApiWithSubpathFallback(`/api/subscribe?paymentRef=${encodeURIComponent(paymentRef)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) return;

      if (data.paymentTxHash) setPaymentTxHash(data.paymentTxHash);
      if (data.mintTxHash) {
        setMintTxHash(data.mintTxHash);
        setTxHash(data.mintTxHash);
      }
      if (data.paymentStatus) setPaymentStatus(data.paymentStatus);
      if (typeof data.message === "string") setPaymentNotice(data.message);

      if (data.failed) {
        setSubmitError(data.error ?? "Subscription confirmation failed.");
        setPayError(data.error ?? null);
      }

      if (data.done) {
        setOnChain(true);
        setSubmitted(true);
      }
    } catch {
      // Keep current pending UI; polling is best-effort.
    }
  }

  useEffect(() => {
    if (paymentMethod !== "onchain") return;
    if (!paymentRef) return;
    if (submitted) return;
    if (paymentStatus !== "Pending" && paymentStatus !== "Submitted") return;

    const initial = window.setTimeout(() => { void refreshPendingSubscriptionStatus(); }, 0);
    const timer = setInterval(() => {
      void refreshPendingSubscriptionStatus();
    }, 4000);

    return () => {
      window.clearTimeout(initial);
      clearInterval(timer);
    };
  }, [paymentMethod, paymentRef, paymentStatus, submitted]);
  function step2Valid() { return tokenCount >= MIN_TOKENS && tokenCount <= 100_000; }
  function step3Valid() { return declProspectus && declConflict && declRisk && declPiStatus; }

  function selectAsset(asset: AssetOption) {
    setAssetName(asset.name);
    setAssetSelected(true);
    setStep(1);
    setRefNum(makeRefNum(asset.name));
    setSubmitted(false);
    setSubmitError(null);
    setATokenApplication(null);
    setCleanverseEligibility(null);
    setPiConfirmed(false);
    setNotUSPerson(false);
    setPaymentTxHash(null);
    setPaymentRef(null);
    setMintTxHash(null);
    setAttemptedTxHash(null);
    setPaymentStatus("Idle");
    setPaymentNotice(null);
    setPaymentDetails(null);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Token Subscription</h1>
        <p className="text-sm text-slate-600 mt-1.5">Select an issued A-Token to start an eligibility check and subscription order.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <aside className="rounded bg-white border border-black/10 overflow-hidden lg:sticky lg:top-6">
          <div className="px-4 py-3 border-b border-black/10">
            <h2 className="text-sm font-semibold text-slate-900">Available Tokens</h2>
            <p className="text-[11px] text-slate-500 mt-1">Cleanverse-issued assets open for subscription</p>
          </div>
          <div className="p-2 space-y-1">
            {assetsLoading && (
              <div className="px-3 py-8 text-center text-xs text-slate-500">Loading available tokens...</div>
            )}
            {!assetsLoading && approvedAssets.map((asset) => {
              const active = assetSelected && asset.name === assetName;
              const symbol = asset.tokenSymbol ?? buildRefPrefix(asset.name).replace("-", "");
              return (
                <button
                  key={asset.id ?? asset.name}
                  type="button"
                  onClick={() => selectAsset(asset)}
                  className="w-full rounded px-3 py-3 text-left transition-colors"
                  style={{
                    background: active ? "rgba(29,78,216,0.08)" : "transparent",
                    border: `1px solid ${active ? "rgba(29,78,216,0.35)" : "transparent"}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-blue-700">{symbol}</div>
                      <div className="text-sm font-medium text-slate-900 mt-0.5 truncate">{asset.name}</div>
                    </div>
                    <span className="mt-0.5 shrink-0 rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">ISSUED</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">USD {asset.unitPrice.toLocaleString("en-US")} per token</div>
                </button>
              );
            })}
            {!assetsLoading && approvedAssets.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-slate-500">No issued A-Tokens are currently open for subscription.</div>
            )}
            {assetsError && <p className="px-3 pb-3 text-[11px] text-red-500">{assetsError}</p>}
          </div>
        </aside>

        <main className="min-w-0">
          {!assetSelected ? (
            <div className="min-h-[420px] rounded bg-white border border-black/10 flex items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto w-10 h-10 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-lg font-semibold">+</div>
                <h2 className="text-base font-semibold text-slate-900 mt-4">Select a token</h2>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">Choose an available A-Token from the list to view its Eligibility Pre-check.</p>
              </div>
            </div>
          ) : (
            <>

      {/* Page header */}
      <div className="mb-8 pb-5" style={{ borderBottom: "1px solid rgba(0,0,0,0.10)" }}>
        <h1 className="text-2xl font-bold text-gray-900">{assetCode} Subscription Order</h1>
        <p className="text-sm text-slate-600 mt-1.5 max-w-xl">
          {assetName} &middot; Series 2026-B &middot;
          <span className="text-amber-600 ml-1.5">Deadline: {DEADLINE}</span>
        </p>
      </div>

      {/* Deadline banner */}
      <div className="rounded px-4 py-3 mb-7 flex flex-wrap items-center gap-4 text-xs"
        style={{ background: "rgba(254,243,199,0.8)", border: "1px solid rgba(217,119,6,0.3)" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        <span className="text-amber-700 font-semibold">Subscription closes 30 Jun 2026 17:00 HKT</span>
        <span className="text-slate-500">Settlement: {SETTLEMENT} &middot; T+2 on-chain atomic settlement</span>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-0 mb-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const done   = submitted ? true : step > n;
          const active = !submitted && step === n;
          return (
            <div key={n} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                  style={{
                    background: done ? "#16a34a" : active ? "#1d4ed8" : "#ffffff",
                    border: `1px solid ${done ? "#16a34a" : active ? "#1a56db" : "rgba(0,0,0,0.12)"}`,
                    color: done || active ? "white" : "#888888",
                  }}>
                  {done ? "..." : n}
                </div>
                <span className="text-[9px] text-center whitespace-nowrap"
                  style={{ color: active ? "#1d4ed8" : done ? "#16a34a" : "#888888" }}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className="flex-1 h-px mx-1 mb-4 transition-colors"
                  style={{ background: step > n || submitted ? "#16a34a" : "rgba(0,0,0,0.12)" }} />
              )}
            </div>
          );
        })}
      </div>
      {!submitted && (
        <p className="text-[10px] text-slate-600 text-right mb-6">
          Step {step} of {STEP_LABELS.length}
        </p>
      )}

      {/* ── STEP 1: Pre-check ─────────────────────────────────────────────────── */}
      {step === 1 && !submitted && (
        <div className="rounded p-6 space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <h2 className="text-base font-semibold text-slate-900">Eligibility Pre-check</h2>
          <p className="text-xs text-slate-500 -mt-2 leading-relaxed">
            Cleanverse verifies your active A-Pass against this A-Token&apos;s rule on Ethereum.
            Complete all three confirmations before proceeding.
          </p>

          <div className="rounded-lg p-4 space-y-3" style={{ background: "#f5faf7", border: "1px solid rgba(5,150,105,0.28)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700">Cleanverse CVI + CVA</p>
                  <h3 className="text-sm font-semibold text-slate-800 mt-0.5">A-Pass eligibility for {atokenApplication?.tokenSymbol ?? selectedAsset.name}</h3>
                </div>
                <span className="text-[10px] font-semibold rounded px-2 py-1" style={{ background: cleanverseEligibility?.eligible ? "#dcfce7" : "#fef3c7", color: cleanverseEligibility?.eligible ? "#166534" : "#92400e" }}>
                  {!cleanverseMode ? "A-TOKEN NOT ISSUED" : cleanverseChecking ? "CHECKING" : cleanverseEligibility?.eligible ? "ELIGIBLE · CODE 4" : "ACTION REQUIRED"}
                </span>
              </div>
              {connectedWallet ? (
                <div className="space-y-2">
                  <div className="font-mono text-[11px] text-slate-700 break-all">{connectedWallet}</div>
                  {!cleanverseMode ? (
                    <div className="text-[11px] text-amber-700">
                      This issuance does not have an ISSUED Cleanverse A-Token yet. Subscription is unavailable.
                    </div>
                  ) : cleanverseChecking ? (
                    <p className="text-[11px] text-slate-500">Querying A-Pass status, expiration, and target-token rule...</p>
                  ) : cleanverseEligibility?.eligible ? (
                    <div className="text-[11px] text-emerald-700">
                      Active A-Pass · Tier {cleanverseEligibility.apass?.tier ?? "-"} · Sub-tier {cleanverseEligibility.apass?.subTier ?? "-"} · verify_apass code {cleanverseEligibility.verification?.code}
                    </div>
                  ) : (
                    <div className="text-[11px] text-amber-700">
                      {cleanverseEligibility?.reasons[0]?.message ?? "No eligible A-Pass was found for this Ethereum wallet."} <Link href="/kyc" className="font-semibold underline">Open KYC</Link>
                    </div>
                  )}
                </div>
              ) : (
                <button type="button" onClick={() => void connectEvmWallet()} disabled={evmConnecting}
                  className="px-3 py-2 rounded text-xs font-semibold text-white disabled:opacity-50" style={{ background: "#047857" }}>
                  {evmConnecting ? "Connecting..." : "Connect Ethereum Wallet"}
                </button>
              )}
              <div className="text-[10px] text-slate-500 font-mono break-all">A-Token: {atokenApplication?.atokenAddress ?? "Not issued"}</div>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer group rounded-lg px-3 py-2"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.9)" }}>
              <input type="checkbox" checked={cleanverseEligibility?.eligible === true} readOnly
                disabled className="mt-0.5 shrink-0 accent-blue-500" />
              <div>
                <div className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                  KYC Approved
                </div>
                <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Cleanverse must verify this wallet&apos;s active A-Pass against the selected A-Token.
                  <span className="ml-1">Need to complete KYC first?</span>{" "}
                  <Link href="/kyc" className="text-blue-500 hover:underline">Go to KYC &rarr;</Link>
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group rounded-lg px-3 py-2"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.9)" }}>
              <input type="checkbox" checked={piConfirmed} onChange={(e) => setPiConfirmed(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div>
                <div className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                  Professional Investor Status
                </div>
                <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  I am a Professional Investor as defined under Schedule 1 of the Securities and Futures
                  Ordinance (SFO). Individual PI: net assets &ge; USD 1,000,000. Institutional PI:
                  SFC-licensed firm, insurer, bank, or MPF trustee.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group rounded-lg px-3 py-2"
              style={{ border: "1px solid rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.9)" }}>
              <input type="checkbox" checked={notUSPerson} onChange={(e) => setNotUSPerson(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div>
                <div className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                  Non-US Person Declaration
                </div>
                <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  I am not a US Person as defined under Regulation S of the US Securities Act 1933.
                  Distribution to US persons is restricted.
                </div>
              </div>
            </label>
          </div>

          <div className="pt-2 flex justify-end">
            <button onClick={() => setStep(2)} disabled={!step1Valid()}
              className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ background: "#1d4ed8" }}>
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Subscription Details ──────────────────────────────────────── */}
      {step === 2 && !submitted && (
        <div className="rounded p-6 space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <h2 className="text-base font-semibold text-slate-900">Subscription Details</h2>

          {/* Token input */}
          <div>
            <label className="block text-xs text-slate-400 font-medium mb-1.5">
              Number of {tokenSymbol} Tokens <span className="text-red-400">*</span>
            </label>
            <p className="text-[11px] text-slate-600 mb-2">
              Minimum 20 tokens (USD {(20 * faceValue).toLocaleString("en-US")}) &middot; Unit price USD {faceValue.toLocaleString("en-US")} per token &middot; Max 100,000 tokens
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number" min="20" max="100000" step="1"
                className="w-48 text-sm rounded px-3 py-2.5 text-slate-900 outline-none transition-colors font-mono"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}
                value={tokens}
                onChange={(e) => {
                  setTokens(e.target.value);
                  setPaymentTxHash(null);
                  setPaymentRef(null);
                  setMintTxHash(null);
                  setPaymentStatus("Idle");
                  setPaymentNotice(null);
                }}
                onFocus={(e)  => (e.currentTarget.style.borderColor = "#1a56db")}
                onBlur={(e)   => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}
              />
              <span className="text-xs text-slate-500">{tokenSymbol} tokens</span>
            </div>
            {tokenCount > 0 && tokenCount < MIN_TOKENS && (
              <p className="text-[11px] text-red-400 mt-1.5">Minimum subscription is 20 tokens</p>
            )}
          </div>

          {/* Fee breakdown */}
          {tokenCount >= MIN_TOKENS && (
            <div className="rounded p-4 space-y-2.5"
              style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide font-medium mb-3">
                Subscription Fee Breakdown
              </div>
              {[
                ["Principal",         displayAmt(principal),   ""],
                ["Subscription fee",  displayAmt(subFee),      "0.25% of principal"],
                ["Total payable",     displayAmt(totalDue),    "Due by 30 Jun 2026"],
              ].map(([k, v, note]) => (
                <div key={k} className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-500">{k}{note && <span className="text-slate-700 ml-1.5">({note})</span>}</span>
                  <span className={`font-mono font-semibold ${k === "Total payable" ? "text-slate-900" : "text-slate-600"}`}>{v}</span>
                </div>
              ))}
              <div className="h-px my-1" style={{ background: "rgba(0,0,0,0.12)" }} />
              <div className="text-[10px] text-slate-600 space-y-1 pt-1">
                <div className="flex justify-between">
                  <span>Annual management fee (ongoing)</span>
                  <span className="font-mono">{displayAmt(annualMgmt)} p.a.</span>
                </div>
                <div className="flex justify-between">
                  <span>Custody fee (ongoing)</span>
                  <span className="font-mono">{displayAmt(custodyAnn)} p.a.</span>
                </div>
                {fixedIncomeAsset && (
                  <div className="flex justify-between pt-1 border-t" style={{ borderColor: "rgba(0,0,0,0.10)" }}>
                    <span className="text-slate-500">Semi-annual coupon income</span>
                    <span className="font-mono text-emerald-500">{displayAmt(semiCoupon)} per payment</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Asset terms summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
            {assetTerms.map((m) => (
              <div key={m.label} className="rounded p-2.5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                <div className="text-slate-600 text-[10px]">{m.label}</div>
                <div className="text-slate-700 font-medium mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button onClick={() => setStep(1)}
              className="px-5 py-2.5 text-sm font-medium rounded text-slate-600 transition-colors hover:text-slate-900"
              style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
              Back
            </button>
            <button onClick={() => setStep(3)} disabled={!step2Valid()}
              className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ background: "#1d4ed8" }}>
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Declarations ──────────────────────────────────────────────── */}
      {step === 3 && !submitted && (
        <div className="rounded p-6 space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <h2 className="text-base font-semibold text-slate-900">Required Declarations</h2>
          <p className="text-xs text-slate-500 -mt-2">
            All declarations must be confirmed before you can place the order.
          </p>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={declProspectus} onChange={(e) => setDeclProspectus(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="text-slate-900 font-medium">Prospectus Receipt Confirmation: </span>
                I confirm I have received, read, and understood the {assetName} offering document,
                including all risk factors, fee structures, and redemption terms. I acknowledge the document
                is committed to EigenDA with on-chain hash in the token contract.
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={declConflict} onChange={(e) => setDeclConflict(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="text-slate-900 font-medium">Conflict of Interest Acknowledgement: </span>
                I acknowledge that Nexus Capital Markets Corporation Limited acts as both issuer and
                placement agent for this offering. This conflict has been disclosed in the prospectus
                per SFC Code of Conduct para. 13.5, and I proceed on an informed basis.
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={declRisk} onChange={(e) => setDeclRisk(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="text-slate-900 font-medium">Risk Acknowledgement: </span>
                I understand the material risk factors including credit risk, interest rate risk,
                liquidity risk (no guaranteed secondary market), technology risk (smart contract
                vulnerabilities), and regulatory risk. Investment may result in loss of capital.
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={declPiStatus} onChange={(e) => setDeclPiStatus(e.target.checked)}
                className="mt-0.5 shrink-0 accent-blue-500" />
              <div className="text-xs text-slate-600 leading-relaxed">
                <span className="text-slate-900 font-medium">PI Status Declaration: </span>
                I declare that I am subscribing as a Professional Investor under Schedule 1 of the SFO
                and waive certain protections under the SFC Code of Conduct that are not applicable
                to PI dealings. I understand this product is not available to retail investors.
              </div>
            </label>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button onClick={() => setStep(2)}
              className="px-5 py-2.5 text-sm font-medium rounded text-slate-600 transition-colors hover:text-slate-900"
              style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
              Back
            </button>
            <button onClick={() => setStep(4)} disabled={!step3Valid()}
              className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ background: "#1d4ed8" }}>
              Proceed to Payment &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Payment Instructions ──────────────────────────────────────── */}
      {step === 4 && !submitted && (
        <div className="rounded p-6 space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <h2 className="text-base font-semibold text-slate-900">Payment Instructions</h2>

          {cleanverseMode && (
            <div className="rounded-lg p-4" style={{ background: "#f5faf7", border: "1px solid rgba(5,150,105,0.28)" }}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">A-Pass Verified · Sepolia ETH Settlement Required</div>
              <p className="text-xs text-slate-600 mt-1">Your wallet will transfer the exact subscription amount in Sepolia ETH. The allocation is recorded only after Ethereum RPC verifies the payer, treasury, value, and finality.</p>
            </div>
          )}

          {/* Amount due */}
          <div className="rounded p-4 flex items-center justify-between"
            style={{ background: "#ffffff", border: "1px solid #1a56db" }}>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Total Amount Due</div>
              <div className="text-2xl font-bold text-slate-900 font-mono">{displayAmt(totalDue)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {tokenCount} tokens x USD {faceValue.toLocaleString("en-US")} + 0.25% subscription fee
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-600 mb-1">Reference</div>
              <code className="text-blue-400 font-mono text-sm">{refNum}</code>
            </div>
          </div>

          {/* Payment method toggle */}
          {!cleanverseMode && <div className="flex rounded overflow-hidden text-xs font-medium"
            style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
            <button
              type="button"
              onClick={() => setPaymentMethod("onchain")}
              className="flex-1 py-2.5 transition-colors"
              style={{
                background: paymentMethod === "onchain" ? "#1d4ed8" : "#ffffff",
                color: paymentMethod === "onchain" ? "#ffffff" : "#64748b",
              }}>
              On-chain (Ethereum)
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("swift")}
              className="flex-1 py-2.5 transition-colors"
              style={{
                background: paymentMethod === "swift" ? "#1d4ed8" : "#ffffff",
                color: paymentMethod === "swift" ? "#ffffff" : "#64748b",
                borderLeft: "1px solid rgba(0,0,0,0.10)",
              }}>
              SWIFT Wire Transfer
            </button>
          </div>}

          {/* ── SWIFT details ── */}
          {!cleanverseMode && paymentMethod === "swift" && (
            <>
              <p className="text-xs text-slate-500 -mt-2">
                Wire the subscription amount to the escrow account below. Tokens will be delivered T+2 after funds are confirmed.
              </p>
              <div className="rounded p-4 space-y-2.5 text-xs"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                <div className="text-[10px] text-slate-600 uppercase tracking-wide font-medium mb-3">SWIFT Wire Transfer Details</div>
                {[
                  ["Beneficiary",       "Nexus Capital Markets Corporation Limited"],
                  ["Account No.",       "001-234567-001 (USD)"],
                  ["Bank",              "HSBC"],
                  ["SWIFT / BIC",       "HSBCHKHHHKH"],
                  ["Bank Address",      "1 Queen's Road Central"],
                  ["Payment Reference", refNum + " / NIBT Subscription"],
                  ["Payment Deadline",  "30 June 2026, 17:00 HKT"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-4">
                    <span className="text-slate-600 w-40 shrink-0">{k}</span>
                    <span className={`text-slate-700 ${k === "Payment Reference" ? "font-mono text-blue-600 font-semibold" : ""}`}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="rounded p-3 text-xs text-amber-700 leading-relaxed"
                style={{ background: "rgba(254,243,199,0.8)", border: "1px solid rgba(217,119,6,0.3)" }}>
                Include your reference number <code className="text-amber-700 font-mono">{refNum}</code> in the
                payment remarks. Funds must clear by 30 June 2026 17:00 HKT.
              </div>
            </>
          )}

          {/* ── Ethereum compliance mint ── */}
          {!cleanverseMode && paymentMethod === "onchain" && (
            <>
              <p className="text-xs text-slate-500 -mt-2">
                Your Ethereum address is checked against the on-chain identity registry and compliance oracle before {tokenSymbol} tokens are minted.
              </p>
              <div className="rounded p-4 space-y-3 text-xs"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                <div className="text-[10px] text-slate-600 uppercase tracking-wide font-medium mb-1">Ethereum Mint Details</div>
                {[
                  ["Network",           "Ethereum Sepolia"],
                  ["Token Standard",    "ERC-3643-inspired RWA token"],
                  ["Subscription Value", displayAmt(totalDue)],
                  ["Investor",          connectedWallet ?? "Connect Ethereum wallet"],
                  ["Settlement",        `${assetCode} minted after on-chain compliance approval`],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-4">
                    <span className="text-slate-600 w-40 shrink-0">{k}</span>
                    <span className={`font-mono text-slate-700 break-all ${k === "Recipient" ? "text-[10px]" : ""}`}>{v}</span>
                  </div>
                ))}
              </div>
              {paymentTxHash && (
                <div className={`rounded px-3 py-2.5 text-xs flex flex-col gap-1.5 ${paymentFinal ? "text-emerald-700" : "text-amber-700"}`}
                  style={paymentFinal
                    ? { background: "rgba(22,163,74,0.07)", border: "1px solid #16a34a" }
                    : { background: "rgba(254,243,199,0.8)", border: "1px solid rgba(217,119,6,0.3)" }}>
                  <div className="flex items-center gap-2">
                    <span>{paymentFinal ? "✓" : "..."}</span>
                    <span className="font-medium">{paymentStatusText}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] break-all">
                    <span className="shrink-0 text-slate-500">Payment Tx:</span>
                    <a href={`https://sepolia.etherscan.io/tx/${paymentTxHash}`} target="_blank" rel="noopener noreferrer"
                      className="underline hover:opacity-75 break-all">{paymentTxHash}</a>
                  </div>
                </div>
              )}
              {contractHash && (
                <div className="rounded px-3 py-2.5 text-xs flex flex-col gap-1.5"
                  style={{ background: "rgba(219,234,254,0.5)", border: "1px solid rgba(29,78,216,0.25)" }}>
                  <div className="flex items-center gap-2 font-medium text-blue-700">
                    <span>&#9632;</span>
                    <span>TokenCoupon Contract</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] break-all">
                    <span className="shrink-0 text-slate-500">Hash:</span>
                    <a href={`https://sepolia.etherscan.io/address/${contractHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="underline text-blue-600 hover:opacity-75 break-all">{contractHash}</a>
                  </div>
                </div>
              )}
              {mintTxHash && (
                <div className="rounded px-3 py-2.5 text-xs flex flex-col gap-1.5 text-emerald-700"
                  style={{ background: "rgba(22,163,74,0.07)", border: "1px solid #16a34a" }}>
                  <div className="flex items-center gap-2">
                    <span>&#10003;</span>
                    <span className="font-medium">RWA token credit confirmed</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] break-all">
                    <span className="shrink-0 text-slate-500">Mint Tx:</span>
                    <a href={`https://sepolia.etherscan.io/tx/${mintTxHash}`} target="_blank" rel="noopener noreferrer"
                      className="underline hover:opacity-75 break-all">{mintTxHash}</a>
                  </div>
                </div>
              )}
              {paymentNotice && !submitted && (
                <div className="rounded px-3 py-2 text-xs text-amber-700"
                  style={{ background: "rgba(254,243,199,0.8)", border: "1px solid rgba(217,119,6,0.3)" }}>
                  {paymentNotice}
                </div>
              )}
              {connectedWallet && (
                <div className="text-[10px] text-slate-500 font-mono break-all">
                  Ethereum investor: {connectedWallet}
                </div>
              )}
              {payError && (
                <div className="rounded px-3 py-2 text-xs text-red-600"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {payError}
                </div>
              )}
            </>
          )}

          <div className="pt-2 flex items-center justify-between">
            <button onClick={() => setStep(3)}
              className="px-5 py-2.5 text-sm font-medium rounded text-slate-600 transition-colors hover:text-slate-900"
              style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
              Back
            </button>
            {submitError && (
              <div className="rounded px-3 py-2 text-xs text-red-600" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {submitError}
              </div>
            )}
            {cleanverseMode ? (
              <button
                onClick={() => void handleOnChainPayment()}
                disabled={paying || submitting || cleanverseEligibility?.eligible !== true || !connectedWallet}
                className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#047857" }}>
                {paying
                  ? paymentTxHash ? "Verifying ETH payment..." : "Preparing ETH payment..."
                  : paymentDetails ? `Pay ${paymentDetails.expectedAmount} ETH` : "Prepare Sepolia ETH Payment"}
              </button>
            ) : paymentMethod === "swift" ? (
              <button
                onClick={() => handleConfirmSubscription()}
                disabled={submitting}
                className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#1d4ed8" }}>
                {submitting ? "Submitting..." : "Confirm Subscription Order"}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (paymentRef) {
                    void refreshPendingSubscriptionStatus();
                  } else if (paymentTxHash) {
                    void handleConfirmSubscription(paymentTxHash, connectedWallet ?? effectiveWalletAddress);
                  } else {
                    void handleOnChainPayment();
                  }
                }}
                disabled={paying || submitting || submitted}
                className="px-6 py-2.5 text-sm font-semibold rounded text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#059669" }}>
                {paying
                  ? "Preparing Ethereum mint..."
                  : submitting
                    ? `Crediting ${assetCode}...`
                    : paymentRef
                      ? "Refresh payment and credit status"
                      : paymentTxHash
                        ? "Retry payment confirmation and RWA credit"
                      : connectedWallet ? "Verify & Mint on Ethereum" : "Connect Ethereum Wallet"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── CONFIRMATION ──────────────────────────────────────────────────────── */}
      {submitted && (
        <div className="rounded p-8 text-center space-y-5" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
            style={{ background: "rgba(22,163,74,0.07)", border: "1px solid #16a34a" }}>
            <span className="text-emerald-400 text-2xl font-bold">&#10003;</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Subscription Order Confirmed</h2>
          <p className="text-sm text-slate-600 max-w-sm mx-auto leading-relaxed">
            Your order for <span className="text-slate-900 font-semibold">{tokenCount} {tokenSymbol} tokens</span> ({displayAmt(principal)}) has been recorded.
            {cleanverseMode
              ? " Cleanverse verified your A-Pass, and the Sepolia ETH payment was confirmed by Ethereum RPC. A-Token minting remains pending the admin MINTER_ROLE flow."
              : paymentMethod === "onchain"
              ? " Your eligibility was confirmed and the RWA token was minted on Ethereum Sepolia."
              : " Wire the subscription funds using the payment reference below to complete settlement."}
          </p>

          <div className="inline-flex items-center gap-3 rounded px-5 py-3"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <span className="text-slate-500 text-xs">Payment Reference</span>
            <code className="font-mono text-blue-400 text-base font-semibold">{refNum}</code>
          </div>

          <div className="rounded p-4 text-left text-xs space-y-2"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="text-[10px] text-slate-600 uppercase tracking-wide font-medium mb-3">Settlement Timeline</div>
            {(cleanverseMode ? [
              ["Cleanverse Decision", "A-Pass active, unexpired, and verify_apass returned code 4"],
              ["Sepolia ETH Payment", paymentTxHash ?? "Confirmed"],
              ["Allocation", `${tokenCount} ${tokenSymbol} tokens accepted`],
              ["A-Token", atokenApplication?.atokenAddress ?? "Pending"],
              ["Mint Status", "Pending admin MINTER_ROLE flow; no on-chain mint claimed"],
            ] : [
              ["Wire Transfer",     "Send " + displayAmt(totalDue) + " to HSBC escrow with reference " + refNum],
              ["Funds Reconciled",  "Nexus Capital matches your incoming payment to the reference within 1 business day"],
              ["Ethereum Mint",     paymentTxHash
                ? `${paymentTxHash}`
                : paymentMethod === "swift" ? "Wire transfer pending" : "Payment pending"],
              ["Token Issuance",    onChain
                ? `Mint Tx: ${mintTxHash ?? txHash ?? ""}`
                : "NexusRWA's compliance system verifies settlement conditions, then issues tokens to your wallet"],
              ["Token Delivery",    `${tokenSymbol} tokens delivered to your whitelisted wallet on ${SETTLEMENT} (2 business days after confirmed payment)`],
              ["First Coupon",      "USD " + semiCoupon.toFixed(2) + " per semi-annual coupon from 15 Jan 2027"],
            ]).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-emerald-400 shrink-0">+</span>
                <div>
                  <span className="text-slate-700 font-medium">{k}: </span>
                  <span className="text-slate-500">{v}</span>
                </div>
              </div>
            ))}
          </div>

          {contractHash && (
            <div className="rounded p-4 text-left text-xs space-y-2"
              style={{ background: "rgba(219,234,254,0.5)", border: "1px solid rgba(29,78,216,0.25)" }}>
              <div className="text-[10px] text-blue-700 uppercase tracking-wide font-medium mb-2">On-chain Contract Details</div>
              <div className="flex gap-3 items-start">
                <span className="text-blue-500 shrink-0">&#9632;</span>
                <div>
                  <span className="text-slate-700 font-medium">Contract Hash: </span>
                  <a href={`https://sepolia.etherscan.io/address/${contractHash}`}
                    target="_blank" rel="noopener noreferrer"
                    className="font-mono text-blue-600 underline break-all hover:opacity-75">{contractHash}</a>
                </div>
              </div>
              {(mintTxHash ?? txHash) && (
                <div className="flex gap-3 items-start">
                  <span className="text-emerald-500 shrink-0">&#10003;</span>
                  <div>
                    <span className="text-slate-700 font-medium">Mint Tx: </span>
                    <a href={`https://sepolia.etherscan.io/tx/${mintTxHash ?? txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-emerald-600 underline break-all hover:opacity-75">{mintTxHash ?? txHash}</a>
                  </div>
                </div>
              )}
              {paymentTxHash && (
                <div className="flex gap-3 items-start">
                  <span className="text-amber-500 shrink-0">&#8594;</span>
                  <div>
                    <span className="text-slate-700 font-medium">Payment Tx: </span>
                    <a href={`https://sepolia.etherscan.io/tx/${paymentTxHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-amber-600 underline break-all hover:opacity-75">{paymentTxHash}</a>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-5 py-2.5 text-sm font-medium rounded text-slate-600 transition-colors hover:text-slate-900"
              style={{ border: "1px solid rgba(0,0,0,0.10)" }}
            >
              Save as PDF
            </button>
            <a href={"mailto:institutional@nexuscapital.hk?subject=" + encodeURIComponent(`${assetCode} Subscription ${refNum}`)}
              className="px-5 py-2.5 text-sm font-medium rounded text-slate-600 transition-colors hover:text-slate-900"
              style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
              Email Placement Agent
            </a>
            <Link href="/portfolio"
              className="px-5 py-2.5 text-sm font-semibold rounded text-white transition-opacity hover:opacity-90"
              style={{ background: "#1d4ed8" }}>
              Back to Portfolio
            </Link>
          </div>

          <p className="text-[10px] text-slate-700 pt-2">
            SFC Authorisation Ref: SFC/NIBT/2026-B/001 &middot; Subscription Deadline: 30 Jun 2026 17:00 HKT
            &middot; Governing Law: SFC
          </p>
        </div>
      )}

            </>
          )}
        </main>
      </div>
    </div>
  );
}
