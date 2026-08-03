"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import artifact from "@/contracts/artifacts/contracts/HarbourRWAToken.sol/HarbourRWAToken.json";
import { useWallet } from "@/lib/wallet-context";

interface AssetInfo {
  name: string;
  type: "REIT" | "GreenBond" | "TradeReceivable" | "Bond";
  balance: string;
  value: string;
  yield: string;
  score: number;
  maturity?: string;
  coupon?: string;
  live?: boolean;
}

interface CouponHistoryEntry {
  index: number;
  paymentDate: string;
  amountPerToken: string;
  myPayout: string;
  claimableAmount: string;
  status: string;
  distributed: boolean;
  claimed: boolean;
  label: string;
  canClaim: boolean;
  canFund: boolean;
}

interface PortfolioSummary {
  walletAddress: string;
  hibt: {
    assetId: `0x${string}`;
    assetName?: string;
    assetCode?: string;
    tokens: number;
    livePosition: boolean;
    nextCouponDate: string;
    nextCouponPerTokenUsd: number;
    nextCouponPayoutUsd: number;
    source: string;
    claimEnabled: boolean;
    couponToken: string;
  };
  couponHistory: CouponHistoryEntry[];
  holdings: AssetInfo[];
}

type EIP1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const HIBT_PLACEHOLDER: AssetInfo[] = [
  { name: "Nexus Infrastructure Bond Token (NIBT)", type: "Bond", balance: "0", value: "USD 0", yield: "5.5%", score: 91, maturity: "15 Jul 2031", coupon: "5.50% p.a.", live: false },
];

const TYPE_COLORS: Record<string, string> = {
  REIT:            "text-emerald-400",
  GreenBond:       "text-teal-400",
  TradeReceivable: "text-violet-400",
  Bond:            "text-blue-400",
};

// Bond math helpers
const TODAY = new Date();
const NEXT_COUPON = new Date("2026-07-15");
const SUBSCRIPTION_DEADLINE = new Date("2026-06-30");
const MATURITY = new Date("2031-07-15");
const FACE_VALUE = 1000;
const COUPON_RATE = 0.055;
const SEMI_ANNUAL_COUPON = FACE_VALUE * COUPON_RATE / 2;

function daysUntil(d: Date) {
  return Math.ceil((d.getTime() - TODAY.getTime()) / 86_400_000);
}

function accrued(tokens: number) {
  const lastCoupon = new Date("2026-01-15");
  const days = Math.ceil((TODAY.getTime() - lastCoupon.getTime()) / 86_400_000);
  return (tokens * FACE_VALUE * COUPON_RATE * days / 365).toFixed(2);
}

function parseCurrencyAmount(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseYieldPct(value: string) {
  const numeric = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatHkd(value: number) {
  return `USD ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function couponStatusStyle(status: string) {
  if (status === "Claimed") {
    return {
      text: "text-emerald-700",
      background: "rgba(16,185,129,0.10)",
      border: "rgba(16,185,129,0.18)",
    };
  }

  if (status === "Claimable" || status === "Funded") {
    return {
      text: "text-blue-700",
      background: "rgba(37,99,235,0.10)",
      border: "rgba(37,99,235,0.18)",
    };
  }

  return {
    text: "text-amber-700",
    background: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.18)",
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: string | null;
  followups?: string[];
}

type RiskProfile = "conservative" | "moderate" | "aggressive";
const RISK_LABELS: Record<RiskProfile, string> = {
  conservative: "Conservative",
  moderate:     "Moderate",
  aggressive:   "Aggressive",
};

const SUGGESTIONS = [
  "What's my next coupon payment?",
  "How does NIBT compare to my holdings?",
  "What are the main risks in my portfolio?",
  "Should I subscribe to NIBT?",
];

// Action button config
const ACTION_BUTTONS: Record<string, { label: string; href: string }> = {
  subscribe: { label: "Subscribe to NIBT ->",  href: "/subscribe" },
  kyc:       { label: "Complete KYC ->",        href: "/kyc"      },
  audit:     { label: "View Audit Report ->",   href: "/audit"    },
};

function isEvmAddress(value: string | null): value is `0x${string}` {
  return !!value && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export default function PortfolioPage() {
  const { wallet: connectedWallet, connect: connectEthereumWallet, connecting: ethereumConnecting } = useWallet();
  const wallet = connectedWallet;
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const connected = !!wallet;
  const walletIsEvm = isEvmAddress(wallet);
  const [loading,   setLoading]   = useState(false);
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummary | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);

  const [advisorOpen,  setAdvisorOpen]  = useState(false);
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [input,        setInput]        = useState("");
  const [thinking,     setThinking]     = useState(false);
  const [riskProfile,  setRiskProfile]  = useState<RiskProfile>("moderate");
  const [streamBuffer, setStreamBuffer] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Yield rebalance panel ───────────────────────────────────────────────────
  const [rebalancing,      setRebalancing]      = useState(false);
  const [rebalanceResult,  setRebalanceResult]  = useState<{
    ethPct: number; ngbPct: number; ethApy: string; ngbApy: string;
    weightedApy: string; rationale: string; txHash: string | null; onChain: boolean;
  } | null>(null);
  const [rebalanceError,   setRebalanceError]   = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponNotice, setCouponNotice] = useState<string | null>(null);

  async function fetchPortfolioSummary(walletAddress: string) {
    const res = await fetch(`/api/portfolio/summary?wallet=${walletAddress}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Failed to load portfolio");
    }
    return data as PortfolioSummary;
  }

  useEffect(() => {
    if (!wallet || !walletIsEvm) {
      return;
    }

    let active = true;

    fetchPortfolioSummary(wallet)
      .then((data) => {
        if (active) {
          setPortfolioSummary(data);
          setPortfolioError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setPortfolioSummary(null);
          setPortfolioError(err instanceof Error ? err.message : "Failed to load portfolio");
        }
      });

    return () => {
      active = false;
    };
  }, [wallet, walletIsEvm]);

  const activeSummary = wallet && portfolioSummary?.walletAddress === wallet ? portfolioSummary : null;
  const portfolioLoading = connected && walletIsEvm && !activeSummary && !portfolioError;
  const holdings = activeSummary?.holdings ?? HIBT_PLACEHOLDER;
  const couponHistory = activeSummary?.couponHistory ?? [];
  const hibtPosition = activeSummary?.hibt ?? null;

  const daysToNextCoupon = hibtPosition
    ? daysUntil(new Date(hibtPosition.nextCouponDate))
    : daysUntil(NEXT_COUPON);
  const daysToDeadline   = daysUntil(SUBSCRIPTION_DEADLINE);
  const daysToMaturity   = daysUntil(MATURITY);

  const totalValueAmount = holdings.reduce((sum, asset) => sum + parseCurrencyAmount(asset.value), 0);
  const totalValue = formatHkd(totalValueAmount);
  const avgYieldNumber = holdings.length > 0
    ? holdings.reduce((sum, asset) => sum + parseYieldPct(asset.yield), 0) / holdings.length
    : 0;
  const avgYield = `${avgYieldNumber.toFixed(1)}%`;
  const avgScore = holdings.length > 0
    ? Math.round(holdings.reduce((sum, asset) => sum + asset.score, 0) / holdings.length)
    : 0;
  const liveHibtTokens = hibtPosition?.tokens ?? 0;
  const assetCode = hibtPosition?.assetCode ?? "NIBT";
  const nextCouponPayout = hibtPosition ? `USD ${hibtPosition.nextCouponPayoutUsd.toFixed(2)}` : `USD ${(SEMI_ANNUAL_COUPON * 20).toFixed(2)}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, streamBuffer]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setThinking(true);
    setStreamBuffer("");

    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          holdings,
          riskProfile,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let finalAction: string | null = null;
      let finalFollowups: string[] = [];

      setThinking(false);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "delta") {
              accumulated += event.text;
              setStreamBuffer(accumulated);
            } else if (event.type === "done") {
              finalAction    = event.action ?? null;
              finalFollowups = event.followups ?? [];
            }
          } catch { /* partial JSON */ }
        }
      }

      setStreamBuffer("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: accumulated || "Sorry, no response received.", action: finalAction, followups: finalFollowups },
      ]);
    } catch {
      setThinking(false);
      setStreamBuffer("");
      setMessages((prev) => [...prev, { role: "assistant", content: "Connection error -- please try again." }]);
    }
  }

  function exportChat() {
    const lines: string[] = [
      "NexusRWA AI Wealth Advisor -- Conversation Export",
      `Date: ${TODAY.toDateString()}`,
      `Wallet: ${wallet}`,
      `Risk Profile: ${RISK_LABELS[riskProfile]}`,
      "-".repeat(60),
      "",
      ...messages.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`),
      "",
      "-".repeat(60),
      "DISCLAIMER: For informational purposes only. Not financial advice.",
    ];
    const blob = new Blob([lines.join("\n\n")], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `harbourRWA-advisor-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function connectDemo() {
    if (loading || walletConnecting || ethereumConnecting) {
      return;
    }

    setLoading(true);
    setWalletConnecting(true);
    setWalletError(null);

    void (async () => {
      try {
        await connectEthereumWallet();
      } catch (error) {
        setWalletError(error instanceof Error ? error.message : "Failed to connect Ethereum wallet");
      } finally {
        setLoading(false);
        setWalletConnecting(false);
      }
    })();
  }

  async function handleRebalance() {
    if (!wallet || rebalancing) return;
    if (!walletIsEvm) {
      setRebalanceError("AI Rebalance currently requires an EVM wallet address (0x...). Connect an EVM wallet for this action.");
      return;
    }
    setRebalancing(true);
    setRebalanceError(null);
    try {
      const res = await fetch("/api/advisor/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, riskProfile }),
      });
      const data = await res.json();
      if (!res.ok) { setRebalanceError(data.error ?? "Rebalance failed"); return; }
      setRebalanceResult(data);
    } catch (e) {
      setRebalanceError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRebalancing(false);
    }
  }

  async function handleCouponAction(entry: CouponHistoryEntry) {
    if (!wallet || !hibtPosition) {
      return;
    }

    if (!walletIsEvm) {
      setCouponError("Coupon actions currently require an EVM wallet address (0x...).");
      return;
    }

    setCouponBusy(`${entry.canClaim ? "claim" : "fund"}-${entry.index}`);
    setCouponError(null);
    setCouponNotice(null);

    try {
      if (entry.canFund) {
        const res = await fetch("/api/portfolio/coupon/fund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: hibtPosition.assetId, index: entry.index, wallet }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to fund coupon");
        }
        const payout = data.payout ? (Number(data.payout) / 1e18).toFixed(2) : "?";
        setCouponNotice(`Issuer sent ${payout} coupon tokens directly to your wallet. Tx: ${data.txHash.slice(0, 10)}...`);
      } else if (entry.canClaim) {
        const tokenAddr = process.env.NEXT_PUBLIC_HARBOUR_RWA_TOKEN_ADDRESS as `0x${string}` | undefined;
        if (!tokenAddr || tokenAddr === "0x0000000000000000000000000000000000000000") {
          throw new Error("NEXT_PUBLIC_HARBOUR_RWA_TOKEN_ADDRESS not configured");
        }

        const chain = process.env.NEXT_PUBLIC_CHAIN_ID === "1" ? mainnet : sepolia;
        const rpcUrl = process.env.NEXT_PUBLIC_CHAIN_ID === "1"
          ? (process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com")
          : (process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
        const eth = (window as unknown as { ethereum?: EIP1193 }).ethereum;
        if (!eth) {
          throw new Error("Wallet provider not detected");
        }

        const walletClient = createWalletClient({
          account: wallet,
          chain,
          transport: custom(eth),
        });
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        });

        const txHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: artifact.abi,
          functionName: "claimDividend",
          args: [hibtPosition.assetId, BigInt(entry.index)],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
        setCouponNotice(`Coupon claimed in ${hibtPosition.couponToken}. Tx: ${txHash.slice(0, 10)}...`);
      }

      const updated = await fetchPortfolioSummary(wallet);
      setPortfolioSummary(updated);
      setPortfolioError(null);
    } catch (error) {
      setCouponError(error instanceof Error ? error.message : "Coupon action failed");
    } finally {
      setCouponBusy(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

      {/* Page header */}
      <div className="mb-7 pb-5 flex items-start justify-between gap-4"
        style={{ borderBottom: "1px solid #152538" }}>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Investor Portfolio</h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Token holdings and yield dashboard on{" "}
            <span className="text-blue-400">Ethereum Sepolia</span>
          </p>
          {connected && (
            <p className="text-[11px] text-slate-600 mt-2">
              {!walletIsEvm
                ? "Ethereum wallet connected."
                : portfolioLoading
                  ? `Loading live ${assetCode} position...`
                  : portfolioError
                    ? portfolioError
                    : hibtPosition?.livePosition
                      ? `${assetCode} balance synced from HarbourRWAToken on Ethereum.`
                      : `No live ${assetCode} token position detected; showing estimated schedule alongside live wallet context.`}
            </p>
          )}
        </div>
        {!connected ? (
          <button onClick={connectDemo} disabled={loading || walletConnecting}
            className="shrink-0 text-sm font-semibold rounded px-5 py-2.5 text-white transition-colors disabled:opacity-40"
            style={{ background: "#1d4ed8" }}>
            {loading || walletConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-2 text-xs rounded px-3 py-2"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="font-mono text-slate-700">{wallet.slice(0, 12)}...{wallet.slice(-6)}</span>
            <span className="text-slate-600">Ethereum EVM</span>
          </div>
        )}
      </div>

      {walletError && (
        <div className="mb-4 text-xs text-red-700 px-3 py-2 rounded"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
          {walletError}
        </div>
      )}

      {connected && !walletIsEvm && (
        <div className="mb-4 text-xs text-blue-700 px-3 py-2 rounded"
          style={{ background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.18)" }}>
          Connect a valid Ethereum address to load live contract balances and coupon claims.
        </div>
      )}

      {!connected ? (
        <div className="rounded py-20 text-center"
          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "#f3f1eb", border: "1px solid rgba(0,0,0,0.10)" }}>
            <span className="text-slate-500 text-xl">&#128274;</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Connect Your Wallet</h2>
          <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
            Connect your KYC-verified institutional wallet to view RWA token holdings and on-chain yield earnings.
          </p>
          <button onClick={connectDemo} disabled={loading || walletConnecting}
            className="text-sm font-semibold px-7 py-2.5 rounded text-white transition-colors disabled:opacity-40"
            style={{ background: "#1d4ed8" }}>
            {loading || walletConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        </div>
      ) : (
        <>
          {/* Proactive alert bar */}
          <div className="rounded px-4 py-3 mb-7 flex flex-wrap gap-4 items-start text-xs"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span className="text-slate-700">
                <span className="text-amber-700 font-semibold">Coupon in {daysToNextCoupon} days</span>
                {liveHibtTokens > 0
                  ? ` -- ${liveHibtTokens.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${assetCode} on-chain · next payout ${nextCouponPayout}`
                  : ` -- ${assetCode} next payment ${hibtPosition?.nextCouponDate ?? "15 Jul 2026"} · USD ${SEMI_ANNUAL_COUPON.toFixed(2)}/token`}
              </span>
            </div>
            <div className="w-px self-stretch" style={{ background: "#1a2e48" }} />
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              <span className="text-slate-700">
                <span className="text-blue-700 font-semibold">Subscription closes in {daysToDeadline} days</span>
                {" "}-- {assetCode} deadline 30 Jun 2026 17:00 HKT
              </span>
            </div>
            <div className="w-px self-stretch" style={{ background: "#1a2e48" }} />
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
              <span className="text-slate-700">
                Accrued interest ({Math.max(liveHibtTokens, 20).toLocaleString("en-US", { maximumFractionDigits: 0 })} tokens basis):{" "}
                <span className="text-slate-900 font-mono">USD {accrued(Math.max(liveHibtTokens, 20))}</span>
              </span>
            </div>
          </div>

          {/* Summary stats */}
          <div className="flex items-start gap-8 mb-8 pb-8" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            {[
              { value: totalValue,                     label: "Portfolio Value"  },
              { value: avgYield + " APY",              label: "Avg. Yield"       },
              { value: `${avgScore}/100`,              label: "Compliance Score" },
              { value: `${holdings.length} assets`, label: "Holdings"         },
            ].map((s, i) => (
              <div key={s.label} className="flex items-start gap-8">
                <div>
                  <div className="text-2xl font-bold text-gray-900 tabular-nums">{s.value}</div>
                  <div className="text-xs text-slate-600 mt-1">{s.label}</div>
                </div>
                {i < 3 && <div className="w-px self-stretch" style={{ background: "#1a2e48" }} />}
              </div>
            ))}
          </div>

          {/* HIBT quick metrics */}
          <div className="rounded px-5 py-4 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-6"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">{assetCode} YTM</div>
              <div className="text-lg font-bold text-emerald-400">5.50%</div>
              <div className="text-[10px] text-slate-600">semi-annual</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Modified Duration</div>
              <div className="text-lg font-bold text-slate-900">4.21 yrs</div>
              <div className="text-[10px] text-slate-600">+100bps -&gt; -4.21% price</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Maturity</div>
              <div className="text-lg font-bold text-slate-900">{daysToMaturity}d</div>
              <div className="text-[10px] text-slate-600">15 Jul 2031</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Live {assetCode} Position</div>
              <div className="text-lg font-bold text-slate-900">{liveHibtTokens.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
              <div className="text-[10px] text-slate-600">on-chain tokens</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Min. Subscription</div>
              <div className="text-lg font-bold text-slate-900">USD 20K</div>
              <div className="text-[10px] text-slate-600">20 tokens</div>
            </div>
          </div>

          {/* Coupon history */}
          <div className="rounded overflow-hidden mb-8"
            style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-slate-900">{assetCode} Coupon History</span>
                <div className="text-[11px] text-slate-600 mt-1">
                  {hibtPosition?.source === "on-chain"
                    ? hibtPosition.claimEnabled
                      ? `Schedule read from HarbourRWAToken dividend records. Coupons are funded and claimed in ${hibtPosition.couponToken}.`  
                      : "Schedule read from HarbourRWAToken dividend records. Redeploy the latest token contract to enable claimable coupons."
                    : "Using estimated schedule until dividend records are deployed."}
                </div>
              </div>
              <span className="text-xs text-slate-500">Expected next payout: {nextCouponPayout}</span>
            </div>
            {(couponError || couponNotice) && (
              <div className="px-5 pb-3">
                {couponNotice && (
                  <div className="text-xs text-emerald-700 px-3 py-2 rounded"
                    style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.18)" }}>
                    {couponNotice}
                  </div>
                )}
                {couponError && (
                  <div className="text-xs text-red-700 px-3 py-2 rounded mt-2"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
                    {couponError}
                  </div>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                    {[
                      "Payment Date",
                      "Type",
                      "Per Token",
                      "My Payout",
                      "Status",
                      "Action",
                    ].map((heading) => (
                      <th key={heading} className="px-5 py-2.5 text-left text-[10px] text-slate-500 font-medium uppercase tracking-wide">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(couponHistory.length > 0
                    ? couponHistory
                    : [{ index: 0, paymentDate: "2026-07-15", label: "Semi-annual coupon", amountPerToken: "USD 27.50", myPayout: nextCouponPayout, claimableAmount: "USD 0.00", status: "Scheduled", distributed: false, claimed: false, canClaim: false, canFund: false }]
                  ).map((entry, index) => {
                    const statusStyle = couponStatusStyle(entry.status);
                    const actionKey = `${entry.canClaim ? "claim" : "fund"}-${entry.index}`;

                    return (
                      <tr key={`${entry.paymentDate}-${index}`} style={{ borderBottom: index < couponHistory.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }}>
                        <td className="px-5 py-3 text-slate-900">{entry.paymentDate}</td>
                        <td className="px-5 py-3 text-slate-700">{entry.label}</td>
                        <td className="px-5 py-3 text-slate-900 font-mono">{entry.amountPerToken}</td>
                        <td className="px-5 py-3 text-slate-900 font-mono">
                          <div>{entry.myPayout}</div>
                          {(entry.canClaim || entry.claimed) && (
                            <div className="text-[10px] text-slate-500 mt-1">Claimable: {entry.claimableAmount}</div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${statusStyle.text}`}
                            style={{ background: statusStyle.background, border: `1px solid ${statusStyle.border}` }}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {entry.canClaim ? (
                            <button
                              onClick={() => handleCouponAction(entry)}
                              disabled={couponBusy === actionKey}
                              className="px-3 py-1.5 text-[10px] font-semibold rounded text-white transition-opacity disabled:opacity-50 hover:opacity-90"
                              style={{ background: "#1d4ed8", border: "1px solid #1a56db" }}>
                              {couponBusy === actionKey ? "Claiming..." : `Claim ${hibtPosition?.couponToken ?? "coupon token"}`}
                            </button>
                          ) : entry.canFund ? (
                            <span className="text-[10px] text-slate-500 italic">Distributed by Issuer</span>
                          ) : (
                            <span className="text-[10px] text-slate-500">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Yield & AI Rebalance Panel ──────────────────────────────────── */}
          <div className="rounded p-5 mb-8" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">Ethereum Yield Routing</div>
                <div className="text-[11px] text-slate-600 mt-0.5">ETH + NGB2026 positions · AI-driven allocation on Ethereum Sepolia</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-0 rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
                  {(["conservative", "moderate", "aggressive"] as RiskProfile[]).map((r) => (
                    <button key={r} onClick={() => { setRiskProfile(r); setRebalanceResult(null); }}
                      className="px-2.5 py-1 text-[10px] font-medium transition-colors"
                      style={{
                        background: riskProfile === r ? "#1d4ed8" : "#ffffff",
                        color: riskProfile === r ? "white" : "#888888",
                        borderRight: r !== "aggressive" ? "1px solid rgba(0,0,0,0.10)" : "none",
                      }}>
                      {RISK_LABELS[r]}
                    </button>
                  ))}
                </div>
                <button onClick={handleRebalance} disabled={rebalancing}
                  className="px-3 py-1.5 text-xs font-semibold rounded text-white transition-opacity disabled:opacity-50 hover:opacity-90"
                  style={{ background: "#16a34a", border: "1px solid #15803d" }}>
                  {rebalancing ? "AI Optimising..." : "AI Rebalance"}
                </button>
              </div>
            </div>

            {/* Current allocation display */}
            {!rebalanceResult ? (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "ETH", sublabel: "Ethereum native asset · liquid", apy: "3.20%", pct: 45, color: "#1a56db", tag: "Sepolia ETH" },
                  { label: assetCode, sublabel: "Tokenized green bond · fixed coupon", apy: "5.50%", pct: 55, color: "#16a34a", tag: "ERC-20 A-Token" },
                ].map((item) => (
                  <div key={item.label} className="rounded p-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold" style={{ color: item.color }}>{item.label}</span>
                      <span className="text-[10px] text-slate-600 font-mono">{item.tag}</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-3">{item.sublabel}</div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-lg font-bold text-emerald-400">{item.apy} APY</div>
                        <div className="text-[10px] text-slate-600 mt-0.5">{item.pct}% current allocation</div>
                      </div>
                      <div className="h-8 w-16 rounded overflow-hidden" style={{ background: "#ffffff" }}>
                        <div className="h-full rounded" style={{ width: `${item.pct}%`, background: item.color, opacity: 0.7 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {rebalanceError && (
                  <div className="text-xs text-red-300 px-3 py-2 rounded" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    {rebalanceError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "ETH", pct: rebalanceResult.ethPct, apy: rebalanceResult.ethApy, color: "#1a56db" },
                    { label: assetCode, pct: rebalanceResult.ngbPct, apy: rebalanceResult.ngbApy, color: "#16a34a" },
                  ].map((item) => (
                    <div key={item.label} className="rounded p-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-sm" style={{ color: item.color }}>{item.label}</span>
                        <span className="text-lg font-bold text-slate-900">{item.pct}%</span>
                      </div>
                      <div className="h-2 rounded-full mb-2" style={{ background: "#ffffff" }}>
                        <div className="h-2 rounded-full" style={{ width: `${item.pct}%`, background: item.color }} />
                      </div>
                      <div className="text-emerald-400 font-semibold text-sm">{item.apy} APY</div>
                    </div>
                  ))}
                </div>
                <div className="rounded p-3 text-xs space-y-1" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Weighted APY after rebalance</span>
                    <span className="text-emerald-400 font-semibold">{rebalanceResult.weightedApy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">AI rationale</span>
                    <span className="text-slate-800 max-w-[55%] text-right">{rebalanceResult.rationale}</span>
                  </div>
                  {rebalanceResult.txHash && (
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-slate-500">On-chain txHash</span>
                      <a href={`https://sepolia.etherscan.io/tx/${rebalanceResult.txHash}`}
                        target="_blank" rel="noreferrer"
                        className="text-blue-400 hover:underline font-mono text-[10px]">
                        {rebalanceResult.txHash.slice(0, 16)}...                      </a>
                    </div>
                  )}
                  {!rebalanceResult.onChain && (
                    <div className="text-slate-600 text-[10px] pt-1">Deploy contracts to submit on-chain</div>
                  )}
                </div>
              </div>
            )}
            {rebalanceError && !rebalanceResult && (
              <div className="mt-3 text-xs text-red-300 px-3 py-2 rounded" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {rebalanceError}
              </div>
            )}
          </div>

          {/* Holdings table */}
          <div className="rounded overflow-hidden mb-8"
            style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Token Holdings</span>
              <span className="text-xs text-slate-500">{holdings.length} positions</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                    {["Asset", "Type", "Balance", "Value", "Yield", "Score", "Maturity / Coupon"].map((h) => (
                      <th key={h} className={`py-2.5 text-[10px] text-slate-500 font-medium uppercase tracking-wide ${h === "Asset" ? "text-left px-5" : h === "Maturity / Coupon" ? "text-right px-5" : "text-right px-4"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((a, i) => (
                    <tr key={a.name} className="hover:bg-blue-900/5 transition-colors"
                      style={{ borderBottom: i < holdings.length - 1 ? "1px solid rgba(0,0,0,0.08)" : "none" }}>
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          <span>{a.name}</span>
                          {a.live && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-emerald-700"
                              style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.18)" }}>
                              Live
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`font-mono text-[10px] font-bold ${TYPE_COLORS[a.type]}`}>{a.type}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-900">{a.balance}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-900">{a.value}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-sm text-emerald-400">{a.yield}</td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-bold text-sm ${a.score >= 80 ? "text-emerald-400" : a.score >= 70 ? "text-amber-400" : "text-red-400"}`}>
                          {a.score}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-slate-500">
                        {a.maturity ? (
                          <div>
                            <div className="text-slate-800">{a.maturity}</div>
                            {a.coupon && <div className="text-slate-600 text-[10px]">{a.coupon}</div>}
                          </div>
                        ) : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom panels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
              <div className="px-5 pt-4 pb-2">
                <span className="text-sm font-semibold text-slate-900">Yield Sources</span>
              </div>
              <div className="px-5 pt-2 pb-4 space-y-4">
                {[
                  { name: "ETH", desc: "Ethereum native asset · staking yield", apy: "3.20%", share: "45%" },
                  { name: assetCode, desc: "Tokenized green bond · fixed coupon", apy: "5.50%", share: "55%" },
                ].map((y) => (
                  <div key={y.name} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{y.name}</div>
                      <div className="text-xs text-slate-600">{y.desc}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-emerald-400">{y.apy}</div>
                      <div className="text-[10px] text-slate-600">{y.share} allocation</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.10)", background: "#ffffff" }}>
              <div className="px-5 pt-4 pb-2">
                <span className="text-sm font-semibold text-slate-900">On-Chain Compliance Scores</span>
              </div>
              <div className="px-5 pt-2 pb-4 space-y-4">
                <div className="text-[11px] text-slate-600 mb-2">
                  From <code className="text-blue-500">ComplianceOracle.sol</code> on Ethereum Sepolia
                </div>
                {holdings.map((a) => (
                  <div key={a.name}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-700">{a.name}</span>
                      <span className={`font-bold ${a.score >= 80 ? "text-emerald-400" : a.score >= 70 ? "text-amber-400" : "text-red-400"}`}>
                        {a.score}/100
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: "#f3f1eb" }}>
                      <div className={`h-1.5 rounded-full ${a.score >= 80 ? "bg-emerald-500" : a.score >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${a.score}%` }} />
                    </div>
                  </div>
                ))}
                <a href="https://sepolia.etherscan.io" target="_blank" rel="noopener noreferrer"
                  className="block text-[11px] text-slate-600 hover:text-slate-400 text-center mt-2 transition-colors">
                  View on Etherscan
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      {/* AI Advisor floating button */}
      {connected && (
        <button
          onClick={() => setAdvisorOpen((o) => !o)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90"
          style={{ background: advisorOpen ? "#ffffff" : "#1d4ed8", border: advisorOpen ? "1px solid rgba(0,0,0,0.12)" : "1px solid #1a56db", color: advisorOpen ? "#111111" : "#ffffff" }}
        >
          <span className="text-base leading-none">{advisorOpen ? "x" : "+"}</span>
          {advisorOpen ? "Close" : "Ask AI Advisor"}
        </button>
      )}

      {/* AI Advisor slide-over panel */}
      {advisorOpen && (
        <div
          className="fixed right-0 z-30 flex flex-col"
          style={{
            top: "52px",
            bottom: 0,
            width: "400px",
            background: "#f7f5f0",
            borderLeft: "1px solid rgba(0,0,0,0.10)",
            boxShadow: "-12px 0 40px rgba(0,0,0,0.5)",
          }}
        >
          {/* Header */}
          <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">AI Wealth Advisor</div>
                <div className="text-[10px] text-slate-600 mt-0.5">Qwen2.5-72B &middot; NexusRWA context</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-slate-600">Online</span>
                </div>
                {messages.length > 0 && (
                  <button onClick={exportChat}
                    className="text-[10px] text-slate-600 hover:text-slate-900 transition-colors px-2 py-1 rounded"
                    style={{ border: "1px solid rgba(0,0,0,0.10)" }}
                    title="Export conversation">
                    Export
                  </button>
                )}
              </div>
            </div>

            {/* Risk profile selector */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-600 shrink-0">Risk profile:</span>
              <div className="flex gap-0 rounded overflow-hidden flex-1" style={{ border: "1px solid rgba(0,0,0,0.10)" }}>
                {(["conservative", "moderate", "aggressive"] as RiskProfile[]).map((r) => (
                  <button key={r} onClick={() => setRiskProfile(r)}
                    className="flex-1 text-[10px] py-1 transition-colors font-medium"
                    style={{
                      background: riskProfile === r ? "#1d4ed8" : "#ffffff",
                      color: riskProfile === r ? "white" : "#888888",
                      borderRight: r !== "aggressive" ? "1px solid rgba(0,0,0,0.10)" : "none",
                    }}>
                    {RISK_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && !streamBuffer && (
              <div className="space-y-4">
                  <div className="rounded p-3 text-xs space-y-1.5"
                  style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <div className="text-[10px] text-slate-600 uppercase tracking-wide font-medium mb-2">Today&apos;s Alerts</div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="text-amber-400 shrink-0">!</span>
                    <span>HIBT coupon in <span className="text-amber-700 font-semibold">{daysToNextCoupon} days</span> -- next payout {nextCouponPayout}</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="text-blue-400 shrink-0">*</span>
                    <span>Subscription deadline in <span className="text-blue-700 font-semibold">{daysToDeadline} days</span> -- 30 Jun 2026</span>
                  </div>
                  <div className="flex items-start gap-2 text-slate-700">
                    <span className="text-emerald-400 shrink-0">+</span>
                    <span>Portfolio avg yield <span className="text-emerald-700 font-semibold">{avgYield} APY</span> -- HIBT adds 5.50%</span>
                  </div>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed">
                  Ask me anything about your portfolio, HIBT bond terms, yield, risks, or compliance.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => sendMessage(s)}
                      className="w-full text-left text-xs px-3 py-2.5 rounded-lg transition-colors hover:bg-gray-100"
                      style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#666666" }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} w-full`}>
                  {m.role === "assistant" && (
                    <div className="w-5 h-5 rounded-full shrink-0 mr-2 mt-0.5 flex items-center justify-center text-[9px] font-bold text-blue-700"
                      style={{ background: "#f3f1eb", border: "1px solid rgba(0,0,0,0.10)" }}>
                      AI
                    </div>
                  )}
                  <div
                    className="max-w-[88%] text-xs leading-relaxed px-3 py-2.5 rounded-xl whitespace-pre-wrap"
                    style={m.role === "user"
                      ? { background: "#1d4ed8", color: "white", borderBottomRightRadius: "4px" }
                      : { background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#334155", borderBottomLeftRadius: "4px" }
                    }
                  >
                    {m.content}
                  </div>
                </div>

                {m.role === "assistant" && m.action && ACTION_BUTTONS[m.action] && (
                  <div className="ml-7 mt-1.5">
                    <Link href={ACTION_BUTTONS[m.action].href}
                      className="inline-block text-[11px] font-semibold px-3 py-1.5 rounded text-white transition-opacity hover:opacity-90"
                      style={{ background: "#1d4ed8" }}>
                      {ACTION_BUTTONS[m.action].label}
                    </Link>
                  </div>
                )}

                {m.role === "assistant" && m.followups && m.followups.length > 0 && (
                  <div className="ml-7 mt-2 flex flex-wrap gap-1.5">
                    {m.followups.map((q) => (
                      <button key={q} onClick={() => sendMessage(q)}
                        className="text-[10px] px-2.5 py-1 rounded-full transition-colors hover:bg-gray-100"
                        style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#666666" }}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {streamBuffer && (
              <div className="flex justify-start">
                <div className="w-5 h-5 rounded-full shrink-0 mr-2 mt-0.5 flex items-center justify-center text-[9px] font-bold text-blue-700"
                  style={{ background: "#f3f1eb", border: "1px solid rgba(0,0,0,0.10)" }}>
                  AI
                </div>
                <div className="max-w-[88%] text-xs leading-relaxed px-3 py-2.5 rounded-xl whitespace-pre-wrap"
                  style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#334155", borderBottomLeftRadius: "4px" }}>
                  {streamBuffer}
                  <span className="inline-block w-0.5 h-3 ml-0.5 bg-slate-400 animate-pulse align-middle" />
                </div>
              </div>
            )}

            {thinking && !streamBuffer && (
              <div className="flex justify-start">
                <div className="w-5 h-5 rounded-full shrink-0 mr-2 mt-0.5 flex items-center justify-center text-[9px] font-bold text-blue-700"
                  style={{ background: "#f3f1eb", border: "1px solid rgba(0,0,0,0.10)" }}>
                  AI
                </div>
                <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl"
                  style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 shrink-0" style={{ borderTop: "1px solid rgba(0,0,0,0.10)" }}>
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs rounded-lg px-3 py-2.5 outline-none transition-colors"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)", color: "#222222" }}
                placeholder="Ask about your portfolio..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={(e)  => (e.currentTarget.style.borderColor = "#1a56db")}
                onBlur={(e)   => (e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)")}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                disabled={thinking || !!streamBuffer}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={thinking || !!streamBuffer || !input.trim()}
                className="px-3 py-2.5 rounded-lg text-sm font-bold text-white transition-opacity disabled:opacity-40 hover:opacity-90"
                style={{ background: "#1d4ed8", minWidth: "40px" }}
              >
                ^
              </button>
            </div>
            <p className="text-[10px] text-slate-700 mt-2 text-center">
              For informational purposes only &middot; Not financial advice
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
