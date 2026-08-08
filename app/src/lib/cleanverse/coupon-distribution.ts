import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAddress,
  parseUnits,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

export type CouponDistributionStatus = "Reserved" | "Confirmed" | "Failed";

export type CouponDistributionRecord = {
  id: string;
  issuanceId: string;
  couponId: string;
  issuerAddress: Address;
  investorAddress: Address;
  atokenAddress: Address;
  paymentCurrency: "ETH";
  tokenBalance: string;
  amountPerToken: string;
  amount: string;
  status: CouponDistributionStatus;
  reservedUntil: string;
  txHash?: Hash;
  blockNumber?: string;
  confirmedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CouponReservationInput = {
  issuanceId: string;
  couponId: string;
  issuerAddress: Address;
  investorAddress: Address;
  atokenAddress: Address;
  tokenBalance: bigint;
  atokenDecimals: number;
  amountPerToken: string;
};

const DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1_000;

export type CouponDistributionConfig = {
  couponId: string;
  amountPerToken: string;
  minimumConfirmations: number;
};

export type CouponTransferVerification =
  | { ok: true; confirmations: number; blockNumber: bigint }
  | { ok: false; pending: boolean; reason: string; confirmations?: number };

function storePath() {
  return process.env.CLEANVERSE_COUPON_STORE_PATH?.trim()
    || join(process.cwd(), "data", "cleanverse-coupon-distributions.json");
}

function readRecords(): CouponDistributionRecord[] {
  try {
    const filePath = storePath();
    return existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, "utf-8")) as CouponDistributionRecord[]
      : [];
  } catch {
    return [];
  }
}

function writeRecords(records: CouponDistributionRecord[]) {
  const filePath = storePath();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(records.slice(0, 2_000), null, 2), "utf-8");
  renameSync(temporaryPath, filePath);
}

function normalizeSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

export function couponDistributionKey(input: Pick<CouponReservationInput, "issuanceId" | "couponId" | "investorAddress">) {
  return [
    normalizeSegment(input.issuanceId, "Issuance ID"),
    normalizeSegment(input.couponId, "Coupon ID"),
    getAddress(input.investorAddress).toLowerCase(),
  ].join(":");
}

export function calculateCouponAmount(input: Pick<CouponReservationInput, "tokenBalance" | "atokenDecimals" | "amountPerToken">) {
  if (input.tokenBalance <= 0n) throw new Error("Investor A-Token balance must be positive");
  if (!Number.isInteger(input.atokenDecimals) || input.atokenDecimals < 0) throw new Error("A-Token decimals are invalid");
  const couponRate = parseUnits(input.amountPerToken, 18);
  if (couponRate <= 0n) throw new Error("Coupon amount per token must be positive");
  return input.tokenBalance * couponRate / (10n ** BigInt(input.atokenDecimals));
}

export function listCouponDistributions() {
  return readRecords();
}

export function findCouponDistribution(id: string) {
  return readRecords().find((record) => record.id === id) ?? null;
}

export function couponDistributionConfigFromEnv(): CouponDistributionConfig {
  const couponId = process.env.COUPON_ID?.trim() || "2026-Q3";
  const amountPerToken = process.env.COUPON_ETH_PER_TOKEN?.trim() || "0.0001";
  const minimumConfirmations = Number(process.env.COUPON_PAYMENT_CONFIRMATIONS ?? 1);
  normalizeSegment(couponId, "Coupon ID");
  if (parseUnits(amountPerToken, 18) <= 0n) throw new Error("COUPON_ETH_PER_TOKEN must be positive");
  if (!Number.isInteger(minimumConfirmations) || minimumConfirmations < 1) {
    throw new Error("COUPON_PAYMENT_CONFIRMATIONS must be a positive integer");
  }
  return { couponId, amountPerToken, minimumConfirmations };
}

export function reserveCouponDistribution(
  input: CouponReservationInput,
  options: { now?: Date; ttlMs?: number } = {},
) {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Reservation TTL must be positive");

  const id = couponDistributionKey(input);
  const records = readRecords();
  const existing = records.find((record) => record.id === id);
  if (existing?.status === "Confirmed") throw new Error("Coupon has already been distributed to this investor");
  if (existing?.status === "Reserved" && Date.parse(existing.reservedUntil) > now.getTime()) {
    throw new Error("Coupon distribution is already awaiting a wallet transaction");
  }

  const amount = calculateCouponAmount(input);
  if (amount <= 0n) throw new Error("Calculated coupon amount is zero");
  const timestamp = now.toISOString();
  const record: CouponDistributionRecord = {
    id,
    issuanceId: normalizeSegment(input.issuanceId, "Issuance ID"),
    couponId: normalizeSegment(input.couponId, "Coupon ID"),
    issuerAddress: getAddress(input.issuerAddress),
    investorAddress: getAddress(input.investorAddress),
    atokenAddress: getAddress(input.atokenAddress),
    paymentCurrency: "ETH",
    tokenBalance: input.tokenBalance.toString(),
    amountPerToken: input.amountPerToken,
    amount: amount.toString(),
    status: "Reserved",
    reservedUntil: new Date(now.getTime() + ttlMs).toISOString(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const next = records.filter((item) => item.id !== id);
  next.unshift(record);
  writeRecords(next);
  return record;
}

export function updateCouponDistribution(
  id: string,
  update: Pick<CouponDistributionRecord, "status"> & Partial<Pick<CouponDistributionRecord, "txHash" | "blockNumber" | "confirmedAt" | "failureReason">>,
  now = new Date(),
) {
  const records = readRecords();
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error("Coupon distribution reservation was not found");
  records[index] = { ...records[index], ...update, updatedAt: now.toISOString() };
  writeRecords(records);
  return records[index];
}

export async function verifyCouponTransfer(input: {
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt" | "getBlockNumber">;
  transactionHash: Hash;
  issuerAddress: Address;
  investorAddress: Address;
  expectedAmount: bigint;
  minimumConfirmations: number;
}): Promise<CouponTransferVerification> {
  let transaction;
  let receipt;
  try {
    [transaction, receipt] = await Promise.all([
      input.client.getTransaction({ hash: input.transactionHash }),
      input.client.getTransactionReceipt({ hash: input.transactionHash }),
    ]);
  } catch {
    return { ok: false, pending: true, reason: "Coupon transaction is not indexed by the Ethereum RPC yet" };
  }
  if (receipt.status !== "success") return { ok: false, pending: false, reason: "Coupon transaction reverted" };
  if (receipt.from.toLowerCase() !== input.issuerAddress.toLowerCase()) {
    return { ok: false, pending: false, reason: "Coupon transaction sender does not match the issuer wallet" };
  }
  if (transaction.to?.toLowerCase() !== input.investorAddress.toLowerCase()) {
    return { ok: false, pending: false, reason: "Coupon transaction recipient does not match the investor wallet" };
  }
  if (transaction.value !== input.expectedAmount) {
    return { ok: false, pending: false, reason: "Coupon transaction value does not match the reserved ETH amount" };
  }
  const latestBlock = await input.client.getBlockNumber();
  const confirmations = Number(latestBlock - receipt.blockNumber + 1n);
  if (confirmations < input.minimumConfirmations) {
    return {
      ok: false,
      pending: true,
      confirmations,
      reason: `Waiting for coupon confirmations (${confirmations}/${input.minimumConfirmations})`,
    };
  }
  return { ok: true, confirmations, blockNumber: receipt.blockNumber };
}