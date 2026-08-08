import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hash } from "viem";

import { verifyATokenMint, verifyNativeSubscriptionPayment } from "../src/lib/cleanverse/subscription-payment";

const token = "0x1111111111111111111111111111111111111111" as Address;
const payer = "0x2222222222222222222222222222222222222222" as Address;
const treasury = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;

function clientForTransfer(overrides: { to?: Address; value?: bigint; latestBlock?: bigint } = {}) {
  const to = overrides.to ?? treasury;
  const value = overrides.value ?? 20_050_000n;
  return {
    getTransaction: async () => ({ from: payer, to, value }),
    getTransactionReceipt: async () => ({
      status: "success" as const,
      from: payer,
      blockNumber: 100n,
      logs: [],
    }),
    getBlockNumber: async () => overrides.latestBlock ?? 101n,
  };
}

test("ETH verification accepts only the exact payer, treasury and amount", async () => {
  const result = await verifyNativeSubscriptionPayment({
    client: clientForTransfer() as never,
    transactionHash: hash,
    payerAddress: payer,
    treasuryAddress: treasury,
    expectedAmount: 20_050_000n,
    minimumConfirmations: 2,
  });
  assert.equal(result.ok, true);
});

test("ETH verification rejects a transfer to another recipient", async () => {
  const result = await verifyNativeSubscriptionPayment({
    client: clientForTransfer({ to: "0x4444444444444444444444444444444444444444" }) as never,
    transactionHash: hash,
    payerAddress: payer,
    treasuryAddress: treasury,
    expectedAmount: 20_050_000n,
    minimumConfirmations: 1,
  });
  assert.deepEqual(result, { ok: false, pending: false, reason: "ETH transaction recipient does not match the subscription treasury" });
});

test("ETH verification keeps a valid transfer pending until finality", async () => {
  const result = await verifyNativeSubscriptionPayment({
    client: clientForTransfer({ latestBlock: 100n }) as never,
    transactionHash: hash,
    payerAddress: payer,
    treasuryAddress: treasury,
    expectedAmount: 20_050_000n,
    minimumConfirmations: 2,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.pending, true);
    assert.equal(result.confirmations, 1);
  }
});

test("A-Token mint verification requires a zero-address transfer to the investor", async () => {
  const mintAmount = 20_000_000n;
  const client = {
    getTransactionReceipt: async () => ({
      status: "success" as const,
      from: treasury,
      blockNumber: 200n,
      logs: [{
        address: token,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: { from: "0x0000000000000000000000000000000000000000", to: payer },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [mintAmount]),
      }],
    }),
    getBlockNumber: async () => 200n,
  };
  const result = await verifyATokenMint({
    client: client as never,
    transactionHash: hash,
    tokenAddress: token,
    adminAddress: treasury,
    recipientAddress: payer,
    expectedAmount: mintAmount,
    minimumConfirmations: 1,
  });
  assert.equal(result.ok, true);
});