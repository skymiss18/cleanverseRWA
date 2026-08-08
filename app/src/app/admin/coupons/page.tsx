"use client";

import { useEffect, useState } from "react";
import { type Address, type Hash } from "viem";
import { useChainId, usePublicClient, useWalletClient } from "wagmi";

import { useWallet } from "@/lib/wallet-context";

type Distribution = {
  status: "Reserved" | "Confirmed" | "Failed";
  amount: string;
  txHash?: Hash;
  reservedUntil: string;
};

type Investor = {
  referenceId: string;
  issuanceId: string;
  assetName: string;
  investorAddress: Address;
  atokenAddress: Address;
  tokenBalance: string;
  tokenBalanceFormatted: string;
  atokenDecimals: number;
  distribution: Distribution | null;
};

type QueueResponse = {
  chain: { id: number; name: string; explorerUrl: string };
  coupon: { id: string; amountPerToken: string; currency: "ETH" };
  investors: Investor[];
};

type PrepareResponse = {
  reservationId: string;
  chainId: number;
  recipient: Address;
  amount: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function AdminCouponsPage() {
  const { wallet, connect, connecting } = useWallet();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [assetFilter, setAssetFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);

  async function fetchQueue() {
    const response = await fetch("/api/admin/coupons", { cache: "no-store" });
    const data = await response.json() as QueueResponse & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Unable to load coupon queue");
    return data;
  }

  async function loadQueue() {
    setLoading(true);
    try {
      setQueue(await fetchQueue());
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Unable to load coupon queue", ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchQueue()
      .then((data) => { if (active) setQueue(data); })
      .catch((error: unknown) => {
        if (active) setNotice({ message: error instanceof Error ? error.message : "Unable to load coupon queue", ok: false });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const assets = Array.from(new Set(queue?.investors.map((investor) => investor.assetName) ?? []));
  const visibleInvestors = queue?.investors.filter((investor) => assetFilter === "All" || investor.assetName === assetFilter) ?? [];
  const selected = queue?.investors.find((investor) => `${investor.issuanceId}:${investor.investorAddress}` === selectedKey) ?? null;
  const wrongChain = Boolean(queue && chainId !== queue.chain.id);

  async function distributeCoupon() {
    setNotice(null);
    if (!selected) return;
    if (!wallet) {
      await connect();
      return;
    }
    if (!walletClient || !publicClient) {
      setNotice({ message: "Ethereum wallet client is not ready", ok: false });
      return;
    }
    if (wrongChain) {
      setNotice({ message: `Switch the wallet to ${queue?.chain.name ?? "the configured Ethereum network"}`, ok: false });
      return;
    }

    setWorking(true);
    try {
      const prepareResponse = await fetch("/api/admin/coupons/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuanceId: selected.issuanceId,
          investorAddress: selected.investorAddress,
          issuerAddress: wallet,
        }),
      });
      const prepared = await prepareResponse.json() as PrepareResponse & { error?: string };
      if (!prepareResponse.ok) throw new Error(prepared.error ?? "Unable to prepare coupon payment");

      const issuerBalance = await publicClient.getBalance({ address: wallet as Address });
      if (issuerBalance <= BigInt(prepared.amount)) throw new Error("Issuer wallet has insufficient Sepolia ETH for the coupon and gas");

      const txHash = await walletClient.sendTransaction({
        to: prepared.recipient,
        value: BigInt(prepared.amount),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const confirmResponse = await fetch("/api/admin/coupons/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: prepared.reservationId, txHash }),
      });
      const confirmation = await confirmResponse.json() as { accepted?: boolean; pending?: boolean; message?: string; error?: string };
      if (!confirmResponse.ok && confirmResponse.status !== 202) {
        throw new Error(confirmation.error ?? confirmation.message ?? "Coupon transaction verification failed");
      }
      setNotice({
        message: confirmation.accepted ? "Coupon distributed and verified on Ethereum." : confirmation.message ?? "Coupon transfer is awaiting confirmation.",
        ok: true,
      });
      await loadQueue();
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Coupon distribution failed", ok: false });
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6" style={{ background: "#f4f3ef" }}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">Issuer servicing</p>
            <h1 className="text-3xl text-slate-950">Coupon Distribution</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Select a minted investor position and pay the current coupon directly from the issuer wallet in Sepolia ETH.</p>
          </div>
          <button
            type="button"
            onClick={() => wallet ? undefined : void connect()}
            disabled={connecting}
            className="h-10 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {wallet ? shortAddress(wallet) : "Connect Issuer Wallet"}
          </button>
        </header>

        {notice && (
          <div className={`rounded-md border px-4 py-3 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
            {notice.message}
          </div>
        )}

        <section className="grid gap-px overflow-hidden rounded-md border border-black/10 bg-black/10 sm:grid-cols-3">
          <div className="bg-white p-4"><p className="text-[10px] font-bold uppercase text-slate-400">Coupon period</p><p className="mt-1 font-mono text-sm text-slate-900">{queue?.coupon.id ?? "--"}</p></div>
          <div className="bg-white p-4"><p className="text-[10px] font-bold uppercase text-slate-400">Rate</p><p className="mt-1 font-mono text-sm text-slate-900">{queue ? `${queue.coupon.amountPerToken} ETH / token` : "--"}</p></div>
          <div className="bg-white p-4"><p className="text-[10px] font-bold uppercase text-slate-400">Network</p><p className={`mt-1 text-sm font-semibold ${wrongChain ? "text-red-700" : "text-emerald-700"}`}>{queue?.chain.name ?? "--"}{wrongChain ? " · switch required" : ""}</p></div>
        </section>

        <section className="overflow-hidden rounded-md border border-black/10 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-slate-50 px-4 py-3">
            <div><h2 className="text-base font-semibold">Minted investor positions</h2><p className="text-xs text-slate-500">Balances are read from the deployed A-Token contracts.</p></div>
            <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)} className="h-9 rounded border border-black/15 bg-white px-3 text-sm">
              <option>All</option>
              {assets.map((asset) => <option key={asset}>{asset}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="px-4 py-16 text-center text-sm text-slate-500">Loading on-chain positions...</div>
          ) : visibleInvestors.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-slate-500">No paid and minted investors are available.</div>
          ) : (
            <div className="divide-y divide-black/5">
              {visibleInvestors.map((investor) => {
                const key = `${investor.issuanceId}:${investor.investorAddress}`;
                const confirmed = investor.distribution?.status === "Confirmed";
                return (
                  <label key={key} className={`grid cursor-pointer gap-3 px-4 py-4 sm:grid-cols-[24px_1fr_1.2fr_0.7fr_0.7fr] sm:items-center ${selectedKey === key ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                    <input type="radio" name="investor" checked={selectedKey === key} onChange={() => setSelectedKey(key)} disabled={confirmed} />
                    <span><span className="block text-sm font-semibold text-slate-900">{investor.assetName}</span><span className="block font-mono text-[10px] text-slate-400">{investor.referenceId}</span></span>
                    <span className="break-all font-mono text-xs text-slate-600">{investor.investorAddress}</span>
                    <span><span className="block text-[10px] uppercase text-slate-400">A-Token balance</span><span className="font-mono text-sm">{investor.tokenBalanceFormatted}</span></span>
                    <span className={`text-xs font-semibold ${confirmed ? "text-emerald-700" : investor.distribution?.status === "Reserved" ? "text-amber-700" : "text-slate-500"}`}>{confirmed ? "Paid" : investor.distribution?.status ?? "Ready"}</span>
                  </label>
                );
              })}
            </div>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-black/10 bg-slate-50 px-4 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase text-slate-400">Selected payout</p>
              <p className="mt-1 text-sm text-slate-700">
                {selected && queue ? `${selected.tokenBalanceFormatted} tokens × ${queue.coupon.amountPerToken} ETH` : "Select an investor to calculate the payment"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void distributeCoupon()}
              disabled={!selected || !wallet || working || wrongChain || selected.distribution?.status === "Confirmed" || selected.distribution?.status === "Reserved"}
              className="h-10 min-w-48 rounded-md bg-blue-700 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {working ? "Confirming on Ethereum..." : "Pay via Ethereum Wallet"}
            </button>
          </footer>
        </section>

        {selected?.distribution?.txHash && queue && (
          <a className="inline-block text-xs font-semibold text-blue-700 hover:underline" href={`${queue.chain.explorerUrl}/tx/${selected.distribution.txHash}`} target="_blank" rel="noreferrer">View confirmed transfer on explorer</a>
        )}
      </div>
    </main>
  );
}