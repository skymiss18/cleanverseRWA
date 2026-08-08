import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import { handleCleanverseSubscription } from "../src/lib/cleanverse/subscription";
import type { ATokenApplicationRecord } from "../src/lib/cleanverse/types";

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let tempDir = "";

const application: ATokenApplicationRecord = {
  issuanceId: "ISS-CLEANVERSE-1",
  assetName: "Nexus Verified Green Bond",
  requestId: "IA202607280001",
  issueAssetId: 28,
  chain: "monad",
  tokenSymbol: "NGB2026",
  adminAddress: "0x1111111111111111111111111111111111111111",
  rule: { allowed_group: "", allowed_sub_group: "", min_tier: 30, min_sub_tier: 0, countries: ["SG"] },
  applyStatus: "ISSUED",
  subscriptionOpen: true,
  atokenAddress: "0x2222222222222222222222222222222222222222",
  submittedAt: "2026-07-28T00:00:00.000Z",
  lastSyncedAt: "2026-07-28T00:00:00.000Z",
};

function request() {
  return {
    issuanceId: application.issuanceId,
    walletAddress: "0x3333333333333333333333333333333333333333",
    assetName: application.assetName,
    tokenCount: 20,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexusrwa-subscribe-"));
  const atokenStore = path.join(tempDir, "atoken.json");
  fs.writeFileSync(atokenStore, JSON.stringify([application]), "utf8");
  process.env.CLEANVERSE_ATOKEN_STORE_PATH = atokenStore;
  process.env.CLEANVERSE_SUBSCRIPTION_STORE_PATH = path.join(tempDir, "subscriptions.json");
  process.env.CLEANVERSE_ISSUANCE_STORE_PATH = path.join(tempDir, "issuances.json");
  fs.writeFileSync(process.env.CLEANVERSE_ISSUANCE_STORE_PATH, JSON.stringify([{
    id: application.issuanceId,
    status: "Approved",
    unitPrice: "1",
  }]), "utf8");
  process.env.CLEANVERSE_BASE_URL = "https://cleanverse.test/api/cooperate";
  process.env.CLEANVERSE_API_ID = "test-id";
  process.env.CLEANVERSE_API_KEY = Buffer.alloc(32, 1).toString("base64");
  process.env.CLEANVERSE_REQUEST_TIMEOUT_MS = "1000";
  process.env.SUBSCRIPTION_TREASURY_ADDRESS = "0x5555555555555555555555555555555555555555";
  process.env.SUBSCRIPTION_ETH_PER_USD = "0.001";
  process.env.SUBSCRIPTION_PAYMENT_CONFIRMATIONS = "1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...savedEnv };
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("direct subscription POST is rejected when verify_apass denies the wallet", async () => {
  let call = 0;
  globalThis.fetch = async () => Response.json(call++ === 0
    ? { code: "0000", message: "success", data: { cvRecordId: "CV1", subTier: 40, tier: "40", status: 1, expirationTime: 2_000_000_000, countries: ["SG"] } }
    : { code: "0000", message: "success", data: { chain: "monad", atoken: application.atokenAddress, address: "0x3333333333333333333333333333333333333333", code: 3, message: "country denied" } });

  const response = await handleCleanverseSubscription(request());
  assert.equal(response.status, 422);
  const body = response.body as { accepted: boolean; decision: { reasons: Array<{ code: string }> } };
  assert.equal(body.accepted, false);
  assert.equal(body.decision.reasons[0]?.code, "CVI_RULE_REJECTED");
  assert.equal(fs.existsSync(process.env.CLEANVERSE_SUBSCRIPTION_STORE_PATH!), false);
});

test("verified subscription creates an ETH payment intent without accepting allocation", async () => {
  let call = 0;
  globalThis.fetch = async () => Response.json(call++ === 0
    ? { code: "0000", message: "success", data: { cvRecordId: "CV1", subTier: 40, tier: "40", status: 1, expirationTime: 2_000_000_000, countries: ["SG"] } }
    : { code: "0000", message: "success", data: { chain: "monad", atoken: application.atokenAddress, address: "0x3333333333333333333333333333333333333333", code: 4, message: "verified" } });

  const response = await handleCleanverseSubscription(request());
  assert.equal(response.status, 202);
  const body = response.body as { accepted: boolean; paymentRequired: boolean; payment: { expectedAmount: string; mintStatus: string } };
  assert.equal(body.accepted, false);
  assert.equal(body.paymentRequired, true);
  assert.equal(body.payment.expectedAmount, "0.02005");
  assert.equal(body.payment.mintStatus, "PendingPayment");
  assert.equal(fs.existsSync(process.env.CLEANVERSE_SUBSCRIPTION_STORE_PATH!), true);
});