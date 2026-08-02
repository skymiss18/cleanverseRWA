import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, getAddress, isAddress, parseEther, parseUnits, type Address, type Hash } from "viem";

import { publicClient } from "@/lib/chain";
import { findLatestATokenApplicationForIssuance } from "./atoken-store";
import { getCleanverseClient } from "./client";
import { evaluateCleanverseEligibility } from "./eligibility";
import { subscriptionPaymentConfigFromEnv, verifyATokenMint, verifyNativeSubscriptionPayment } from "./subscription-payment";

export type CleanverseSubscriptionRecord = {
  referenceId: string;
  issuanceId: string;
  assetName: string;
  walletAddress: Address;
  tokenCount: number;
  chain: string;
  atokenAddress: Address;
  status: "AwaitingPayment" | "PaymentPending" | "PaymentConfirmed" | "PaymentFailed" | "Minted";
  paymentStatus: "Pending" | "Confirmed" | "Failed";
  mintStatus: "PendingPayment" | "PendingAdminMinterRole" | "Minted";
  treasuryAddress: Address;
  paymentCurrency: "ETH";
  expectedAmountWei: string;
  expectedAmount: string;
  paymentTxHash?: Hash;
  paymentBlockNumber?: string;
  paymentConfirmations?: number;
  cleanverseTransactionIndexed?: boolean;
  mintTxHash?: Hash;
  eligibilityCheckedAt: string;
  verificationCode: number;
  createdAt: string;
  updatedAt: string;
};

export type CleanverseSubscriptionResult = { status: number; body: Record<string, unknown> };

type IssuanceRecord = { id?: string; status?: string; unitPrice?: string | number };

function subscriptionStorePath() {
  return process.env.CLEANVERSE_SUBSCRIPTION_STORE_PATH?.trim()
    || join(process.cwd(), "data", "cleanverse-subscriptions.json");
}

function readSubscriptions(): CleanverseSubscriptionRecord[] {
  try {
    const filePath = subscriptionStorePath();
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf-8")) as CleanverseSubscriptionRecord[] : [];
  } catch {
    return [];
  }
}

function writeSubscriptions(records: CleanverseSubscriptionRecord[]) {
  writeFileSync(subscriptionStorePath(), JSON.stringify(records.slice(0, 2_000), null, 2), "utf-8");
}

function upsertSubscription(record: CleanverseSubscriptionRecord) {
  const records = readSubscriptions();
  const index = records.findIndex((item) => item.referenceId === record.referenceId);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
  writeSubscriptions(records);
}

function approvedUnitPrice(issuanceId: string): string | null {
  try {
    const filePath = process.env.CLEANVERSE_ISSUANCE_STORE_PATH?.trim()
      || join(process.cwd(), "data", "sfc-inbox.json");
    const records = JSON.parse(readFileSync(filePath, "utf-8")) as IssuanceRecord[];
    const value = records.find((record) => record.id === issuanceId && record.status === "Approved")?.unitPrice;
    return (typeof value === "string" || typeof value === "number") && Number.isFinite(Number(value)) && Number(value) > 0
      ? String(value)
      : null;
  } catch {
    return null;
  }
}

function normalizeReference(value: string | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9-]{6,64}$/.test(normalized)
    ? normalized
    : `CV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function publicRecord(record: CleanverseSubscriptionRecord) {
  const { eligibilityCheckedAt: _eligibilityCheckedAt, verificationCode: _verificationCode, ...visible } = record;
  return visible;
}

export function findCleanverseSubscription(referenceId: string) {
  return readSubscriptions().find((record) => record.referenceId === referenceId) ?? null;
}

export function listCleanverseSubscriptions() {
  return readSubscriptions().map(publicRecord);
}

async function evaluate(input: { issuanceId: string; walletAddress: Address }) {
  return evaluateCleanverseEligibility({
    client: getCleanverseClient(),
    application: findLatestATokenApplicationForIssuance(input.issuanceId),
    issuanceId: input.issuanceId,
    walletAddress: input.walletAddress,
  });
}

async function createPaymentIntent(input: {
  issuanceId: string;
  walletAddress: Address;
  assetName: string;
  tokenCount: number;
  refNum?: string;
}): Promise<CleanverseSubscriptionResult> {
  const decision = await evaluate(input);
  if (!decision.eligible || !decision.atokenAddress || decision.verification?.code !== 4) {
    return { status: 422, body: { eligible: false, accepted: false, decision, message: decision.reasons[0]?.message ?? "Cleanverse eligibility verification failed." } };
  }

  let config;
  try {
    config = subscriptionPaymentConfigFromEnv();
  } catch (error) {
    return { status: 503, body: { error: error instanceof Error ? error.message : "ETH payment is not configured" } };
  }

  const unitPrice = approvedUnitPrice(input.issuanceId);
  if (!unitPrice) return { status: 409, body: { error: "Approved issuance unit price is unavailable" } };

  const referenceId = normalizeReference(input.refNum);
  const existing = findCleanverseSubscription(referenceId);
  if (existing) {
    if (existing.walletAddress.toLowerCase() !== input.walletAddress.toLowerCase() || existing.issuanceId !== input.issuanceId) {
      return { status: 409, body: { error: "Payment reference is already assigned to another subscription" } };
    }
    return { status: existing.paymentStatus === "Confirmed" ? 200 : 202, body: { paymentRequired: existing.paymentStatus !== "Confirmed", paymentRef: referenceId, payment: publicRecord(existing) } };
  }

  const ethPerUsd = process.env.SUBSCRIPTION_ETH_PER_USD?.trim() || "0.001";
  const principalUsdMicros = parseUnits(unitPrice, 6) * BigInt(input.tokenCount);
  const feeUsdMicros = (principalUsdMicros * 25n + 9_999n) / 10_000n;
  const totalUsdMicros = principalUsdMicros + feeUsdMicros;
  const ethPerUsdWei = parseEther(ethPerUsd);
  const amount = (totalUsdMicros * ethPerUsdWei + 999_999n) / 1_000_000n;
  const now = new Date().toISOString();
  const record: CleanverseSubscriptionRecord = {
    referenceId,
    issuanceId: input.issuanceId,
    assetName: input.assetName,
    walletAddress: getAddress(input.walletAddress),
    tokenCount: input.tokenCount,
    chain: decision.chain,
    atokenAddress: getAddress(decision.atokenAddress),
    status: "AwaitingPayment",
    paymentStatus: "Pending",
    mintStatus: "PendingPayment",
    treasuryAddress: config.treasuryAddress,
    paymentCurrency: "ETH",
    expectedAmountWei: amount.toString(),
    expectedAmount: formatEther(amount),
    eligibilityCheckedAt: decision.checkedAt,
    verificationCode: decision.verification.code,
    createdAt: now,
    updatedAt: now,
  };
  upsertSubscription(record);
  return {
    status: 202,
    body: {
      eligible: true,
      accepted: false,
      paymentRequired: true,
      paymentRef: referenceId,
      payment: publicRecord(record),
      message: `Transfer exactly ${record.expectedAmount} Sepolia ETH to continue the subscription.`,
    },
  };
}

async function queryCleanverseIndex(record: CleanverseSubscriptionRecord) {
  if (!record.paymentTxHash) return false;
  try {
    const response = await getCleanverseClient().request<{ txs?: Array<{ tx_hash?: string; status?: string }> }>("query_txs", {
      method: "POST",
      body: { chain: record.chain, address: record.treasuryAddress, symbol: "eth", txHash: record.paymentTxHash, page: 1, pageSize: 10 },
    });
    return response.data?.txs?.some((transaction) =>
      transaction.tx_hash?.toLowerCase() === record.paymentTxHash?.toLowerCase()
      && transaction.status?.toLowerCase() === "success") ?? false;
  } catch {
    return false;
  }
}

async function confirmPayment(record: CleanverseSubscriptionRecord, paymentTxHash: Hash): Promise<CleanverseSubscriptionResult> {
  const duplicate = readSubscriptions().find((item) => item.referenceId !== record.referenceId && item.paymentTxHash?.toLowerCase() === paymentTxHash.toLowerCase());
  if (duplicate) return { status: 409, body: { error: "ETH transaction has already been used for another subscription" } };

  const decision = await evaluate({ issuanceId: record.issuanceId, walletAddress: record.walletAddress });
  if (!decision.eligible || decision.verification?.code !== 4) {
    return { status: 422, body: { accepted: false, decision, error: "A-Pass eligibility changed before payment confirmation" } };
  }

  let config;
  try {
    config = subscriptionPaymentConfigFromEnv();
  } catch (error) {
    return { status: 503, body: { error: error instanceof Error ? error.message : "ETH payment is not configured" } };
  }
  if (config.treasuryAddress.toLowerCase() !== record.treasuryAddress.toLowerCase()) {
    return { status: 409, body: { error: "Subscription payment configuration changed after the payment intent was created" } };
  }

  const verification = await verifyNativeSubscriptionPayment({
    client: publicClient,
    transactionHash: paymentTxHash,
    payerAddress: record.walletAddress,
    treasuryAddress: record.treasuryAddress,
    expectedAmount: BigInt(record.expectedAmountWei),
    minimumConfirmations: config.minimumConfirmations,
  });
  const now = new Date().toISOString();
  if (!verification.ok) {
    const updated: CleanverseSubscriptionRecord = {
      ...record,
      status: verification.pending ? "PaymentPending" : "PaymentFailed",
      paymentStatus: verification.pending ? "Pending" : "Failed",
      paymentTxHash,
      paymentConfirmations: verification.confirmations,
      updatedAt: now,
    };
    upsertSubscription(updated);
    return { status: verification.pending ? 202 : 422, body: { accepted: false, paymentRef: record.referenceId, paymentTxHash, paymentStatus: updated.paymentStatus, message: verification.reason } };
  }

  const updated: CleanverseSubscriptionRecord = {
    ...record,
    status: "PaymentConfirmed",
    paymentStatus: "Confirmed",
    mintStatus: "PendingAdminMinterRole",
    paymentTxHash,
    paymentBlockNumber: verification.blockNumber.toString(),
    paymentConfirmations: verification.confirmations,
    updatedAt: now,
  };
  updated.cleanverseTransactionIndexed = await queryCleanverseIndex(updated);
  upsertSubscription(updated);
  return {
    status: 201,
    body: {
      eligible: true,
      accepted: true,
      onChain: false,
      paymentStatus: "Confirmed",
      paymentRef: updated.referenceId,
      paymentTxHash,
      allocation: publicRecord(updated),
      message: "Sepolia ETH payment verified by Ethereum RPC. Subscription recorded; A-Token mint is pending the admin MINTER_ROLE transaction.",
    },
  };
}

export async function handleCleanverseSubscription(input: {
  issuanceId: string;
  walletAddress: unknown;
  assetName: string;
  tokenCount: number;
  refNum?: string;
  paymentRef?: string;
  paymentTxHash?: string;
}): Promise<CleanverseSubscriptionResult> {
  if (typeof input.walletAddress !== "string" || !isAddress(input.walletAddress)) {
    return { status: 400, body: { error: "A valid Ethereum walletAddress is required" } };
  }
  const walletAddress = getAddress(input.walletAddress);

  if (input.paymentRef || input.paymentTxHash) {
    if (!input.paymentRef) return { status: 400, body: { error: "paymentRef is required with paymentTxHash" } };
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.paymentTxHash ?? "")) return { status: 400, body: { error: "paymentTxHash must be a valid Ethereum transaction hash" } };
    const record = findCleanverseSubscription(input.paymentRef);
    if (!record) return { status: 404, body: { error: "Subscription payment reference was not found" } };
    if (record.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return { status: 403, body: { error: "Subscription payment reference belongs to another wallet" } };
    if (record.paymentStatus === "Confirmed") return { status: 200, body: { accepted: true, paymentStatus: "Confirmed", allocation: publicRecord(record) } };
    return confirmPayment(record, input.paymentTxHash as Hash);
  }

  return createPaymentIntent({ issuanceId: input.issuanceId, walletAddress, assetName: input.assetName, tokenCount: input.tokenCount, refNum: input.refNum });
}

export async function refreshCleanverseSubscription(referenceId: string): Promise<CleanverseSubscriptionResult | null> {
  const record = findCleanverseSubscription(referenceId);
  if (!record) return null;
  if (record.paymentStatus === "Confirmed") {
    return {
      status: 200,
      body: {
        found: true,
        done: true,
        paymentRef: record.referenceId,
        paymentTxHash: record.paymentTxHash,
        paymentStatus: record.paymentStatus,
        mintStatus: record.mintStatus,
        message: "Sepolia ETH payment confirmed; A-Token mint is pending administrator action.",
      },
    };
  }
  if (!record.paymentTxHash) {
    return {
      status: 202,
      body: {
        found: true,
        done: false,
        paymentRef: record.referenceId,
        paymentStatus: record.paymentStatus,
        mintStatus: record.mintStatus,
        message: `Waiting for ${record.expectedAmount} Sepolia ETH payment.`,
      },
    };
  }
  return confirmPayment(record, record.paymentTxHash);
}

export async function confirmCleanverseMint(referenceId: string, mintTxHash: string): Promise<CleanverseSubscriptionResult> {
  const record = findCleanverseSubscription(referenceId);
  if (!record) return { status: 404, body: { error: "Subscription was not found" } };
  if (record.paymentStatus !== "Confirmed") return { status: 409, body: { error: "ETH payment must be confirmed before minting" } };
  if (!/^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) return { status: 400, body: { error: "mintTxHash must be a valid Ethereum transaction hash" } };

  const application = findLatestATokenApplicationForIssuance(record.issuanceId);
  if (!application || !isAddress(application.adminAddress)) {
    return { status: 409, body: { error: "A-Token administrator is unavailable" } };
  }
  const decimals = Number(process.env.CLEANVERSE_ATOKEN_DECIMALS ?? 6);
  const minimumConfirmations = Number(process.env.SUBSCRIPTION_MINT_CONFIRMATIONS ?? 1);
  const verification = await verifyATokenMint({
    client: publicClient,
    transactionHash: mintTxHash as Hash,
    tokenAddress: record.atokenAddress,
    adminAddress: getAddress(application.adminAddress),
    recipientAddress: record.walletAddress,
    expectedAmount: parseUnits(String(record.tokenCount), decimals),
    minimumConfirmations,
  });
  if (!verification.ok) {
    return { status: verification.pending ? 202 : 422, body: { minted: false, message: verification.reason } };
  }

  const updated: CleanverseSubscriptionRecord = {
    ...record,
    status: "Minted",
    mintStatus: "Minted",
    mintTxHash: mintTxHash as Hash,
    updatedAt: new Date().toISOString(),
  };
  upsertSubscription(updated);
  return { status: 200, body: { minted: true, subscription: publicRecord(updated), message: "A-Token mint verified on Ethereum." } };
}