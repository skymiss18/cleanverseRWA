"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { parseUnits, type Address, type Hash } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWallet } from "@/lib/wallet-context";

const ATOKEN_ADMIN_ABI = [
  {
    type: "function",
    name: "MINTER_ROLE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [{ type: "bytes32", name: "role" }, { type: "address", name: "account" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "grantRole",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32", name: "role" }, { type: "address", name: "account" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "amount" }],
    outputs: [],
  },
] as const;

type Subscription = {
  referenceId: string;
  assetName: string;
  walletAddress: Address;
  tokenCount: number;
  atokenAddress: Address;
  expectedAmount: string;
  paymentStatus: "Pending" | "Confirmed" | "Failed";
  mintStatus: "PendingPayment" | "PendingAdminMinterRole" | "Minted";
  paymentTxHash?: Hash;
  mintTxHash?: Hash;
};

export default function AdminSubscriptionsPage() {
  const { wallet, connect, connecting } = useWallet();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingRef, setWorkingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSubscriptions() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/subscriptions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load subscriptions");
      setSubscriptions(data.subscriptions ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load subscriptions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSubscriptions(); }, []);

  async function mintSubscription(subscription: Subscription) {
    setError(null);
    if (!wallet) {
      await connect();
      return;
    }
    if (!walletClient || !publicClient) {
      setError("Ethereum wallet client is not ready");
      return;
    }

    setWorkingRef(subscription.referenceId);
    try {
      const role = await publicClient.readContract({
        address: subscription.atokenAddress,
        abi: ATOKEN_ADMIN_ABI,
        functionName: "MINTER_ROLE",
      });
      const hasMinterRole = await publicClient.readContract({
        address: subscription.atokenAddress,
        abi: ATOKEN_ADMIN_ABI,
        functionName: "hasRole",
        args: [role, wallet as Address],
      });
      if (!hasMinterRole) {
        const grantHash = await walletClient.writeContract({
          address: subscription.atokenAddress,
          abi: ATOKEN_ADMIN_ABI,
          functionName: "grantRole",
          args: [role, wallet as Address],
        });
        await publicClient.waitForTransactionReceipt({ hash: grantHash });
      }

      const mintTxHash = await walletClient.writeContract({
        address: subscription.atokenAddress,
        abi: ATOKEN_ADMIN_ABI,
        functionName: "mint",
        args: [subscription.walletAddress, parseUnits(String(subscription.tokenCount), 6)],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintTxHash });

      const response = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceId: subscription.referenceId, mintTxHash }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? data.message ?? "Mint verification failed");
      await loadSubscriptions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A-Token mint failed");
    } finally {
      setWorkingRef(null);
    }
  }

  const pending = subscriptions.filter((subscription) => subscription.paymentStatus === "Confirmed" && subscription.mintStatus !== "Minted");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Subscription Mint Queue</h1>
          <p className="text-sm text-slate-600 mt-1">Only RPC-verified Sepolia ETH payments are eligible for A-Token minting.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/kyc" className="text-sm text-blue-700 hover:underline">KYC Admin</Link>
          <button
            type="button"
            onClick={() => wallet ? undefined : void connect()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={connecting}
          >
            {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Admin Wallet"}
          </button>
        </div>
      </div>

      {error && <div className="mb-5 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded border border-black/10 bg-white">
        <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.8fr_auto] gap-4 border-b border-black/10 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">
          <span>Asset / Reference</span><span>Investor</span><span>ETH</span><span>Tokens</span><span>Action</span>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">Loading paid subscriptions...</div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">No paid subscriptions are waiting for mint.</div>
        ) : pending.map((subscription) => (
          <div key={subscription.referenceId} className="grid grid-cols-[1.2fr_1fr_0.7fr_0.8fr_auto] gap-4 border-b border-black/5 px-4 py-4 text-sm last:border-0">
            <div><div className="font-medium text-slate-900">{subscription.assetName}</div><div className="font-mono text-[11px] text-slate-500">{subscription.referenceId}</div></div>
            <div className="font-mono text-xs text-slate-600 break-all">{subscription.walletAddress}</div>
            <div className="font-mono text-slate-700">{subscription.expectedAmount}</div>
            <div className="font-mono text-slate-700">{subscription.tokenCount}</div>
            <button
              type="button"
              onClick={() => void mintSubscription(subscription)}
              disabled={workingRef !== null}
              className="self-center rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {workingRef === subscription.referenceId ? "Minting..." : "Mint A-Token"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}