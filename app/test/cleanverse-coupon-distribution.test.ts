import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type Address, type Hash } from "viem";

import {
  calculateCouponAmount,
  reserveCouponDistribution,
  updateCouponDistribution,
  verifyCouponTransfer,
} from "../src/lib/cleanverse/coupon-distribution";

const issuer = "0x1111111111111111111111111111111111111111" as Address;
const investor = "0x2222222222222222222222222222222222222222" as Address;
const atoken = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;

test("coupon amount preserves A-Token and ETH decimal precision", () => {
  assert.equal(calculateCouponAmount({
    tokenBalance: 20_000_000n,
    atokenDecimals: 6,
    amountPerToken: "0.0001",
  }), 2_000_000_000_000_000n);
});

test("coupon reservation prevents duplicates until it expires", () => {
  const directory = mkdtempSync(join(tmpdir(), "cleanverse-coupon-"));
  process.env.CLEANVERSE_COUPON_STORE_PATH = join(directory, "distributions.json");
  const input = {
    issuanceId: "NIBT-001",
    couponId: "2026-Q3",
    issuerAddress: issuer,
    investorAddress: investor,
    atokenAddress: atoken,
    tokenBalance: 20_000_000n,
    atokenDecimals: 6,
    amountPerToken: "0.0001",
  };

  try {
    const first = reserveCouponDistribution(input, { now: new Date("2026-08-08T00:00:00.000Z"), ttlMs: 60_000 });
    assert.throws(
      () => reserveCouponDistribution(input, { now: new Date("2026-08-08T00:00:30.000Z"), ttlMs: 60_000 }),
      /already awaiting/,
    );
    const retried = reserveCouponDistribution(input, { now: new Date("2026-08-08T00:01:01.000Z"), ttlMs: 60_000 });
    assert.equal(retried.id, first.id);
    assert.equal(JSON.parse(readFileSync(process.env.CLEANVERSE_COUPON_STORE_PATH, "utf-8")).length, 1);

    updateCouponDistribution(retried.id, { status: "Confirmed", confirmedAt: "2026-08-08T00:02:00.000Z" });
    assert.throws(() => reserveCouponDistribution(input), /already been distributed/);
  } finally {
    delete process.env.CLEANVERSE_COUPON_STORE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("coupon verification requires the exact native ETH transfer", async () => {
  const expectedAmount = 2_000_000_000_000_000n;
  const client = {
    getTransaction: async () => ({ from: issuer, to: investor, value: expectedAmount }),
    getTransactionReceipt: async () => ({
      status: "success" as const,
      from: issuer,
      blockNumber: 100n,
      logs: [],
    }),
    getBlockNumber: async () => 101n,
  };
  const verified = await verifyCouponTransfer({
    client: client as never,
    transactionHash: hash,
    issuerAddress: issuer,
    investorAddress: investor,
    expectedAmount,
    minimumConfirmations: 2,
  });
  assert.equal(verified.ok, true);

  const wrongAmount = await verifyCouponTransfer({
    client: client as never,
    transactionHash: hash,
    issuerAddress: issuer,
    investorAddress: investor,
    expectedAmount: expectedAmount + 1n,
    minimumConfirmations: 1,
  });
  assert.deepEqual(wrongAmount, { ok: false, pending: false, reason: "Coupon transaction value does not match the reserved ETH amount" });
});