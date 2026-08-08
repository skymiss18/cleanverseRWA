import assert from "node:assert/strict";
import test from "node:test";

import { APassOverwriteConfirmationRequired, generateAPass } from "../src/lib/cleanverse/apass";
import { CleanverseBusinessError } from "../src/lib/cleanverse/errors";
import { evaluateCleanverseEligibility } from "../src/lib/cleanverse/eligibility";
import type { ATokenApplicationRecord, GenerateAPassRequest } from "../src/lib/cleanverse/types";

const request: GenerateAPassRequest = {
  customerId: "NXR123456789012345678901",
  expirationTime: 2_000_000_000,
  wallet: { chain: "monad", address: "0x1111111111111111111111111111111111111111" },
};

const issuedApplication: ATokenApplicationRecord = {
  issuanceId: "ISS-1",
  assetName: "Nexus Green Bond",
  requestId: "IA202607280001",
  issueAssetId: 1,
  chain: "monad",
  tokenSymbol: "NGB2026",
  adminAddress: "0x2222222222222222222222222222222222222222",
  rule: { allowed_group: "", allowed_sub_group: "", min_tier: 30, min_sub_tier: 0 },
  applyStatus: "ISSUED",
  subscriptionOpen: true,
  atokenAddress: "0x3333333333333333333333333333333333333333",
  submittedAt: "2026-07-28T00:00:00.000Z",
  lastSyncedAt: "2026-07-28T00:00:00.000Z",
};

test("generateAPass uses encrypted endpoint and preserves explicit override", async () => {
  let captured: unknown;
  const client = { request: async <T>(path: string, options: unknown) => {
    captured = { path, options };
    return { code: "0000", message: "success", data: { customerId: request.customerId } } as T;
  } };
  await generateAPass(client as never, { ...request, override: true });
  assert.deepEqual(captured, { path: "generate_apass", options: { method: "POST", body: { ...request, override: true }, encrypted: true } });
});

test("generateAPass maps provider code 1000 to explicit overwrite confirmation", async () => {
  const client = { request: async () => { throw new CleanverseBusinessError("confirm overwrite", "1000", "req", null); } };
  await assert.rejects(() => generateAPass(client as never, request), APassOverwriteConfirmationRequired);
});

test("eligibility allows only active, unexpired A-Pass with verify code 4", async () => {
  const client = { request: async (path: string) => path === "query_apass"
    ? { code: "0000", message: "success", data: { cvRecordId: "CV1", subTier: 40, tier: "40", status: 1, expirationTime: 2_000_000_000, countries: ["SG"] } }
    : { code: "0000", message: "success", data: { chain: "monad", atoken: issuedApplication.atokenAddress, address: request.wallet.address, code: 4, message: "success" } } };
  const decision = await evaluateCleanverseEligibility({ client: client as never, application: issuedApplication, issuanceId: "ISS-1", walletAddress: request.wallet.address, nowSeconds: 1_900_000_000 });
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasons, []);
});

test("eligibility fails closed for pending CVA, frozen/expired CVI, rule rejection, and provider errors", async () => {
  const pending = await evaluateCleanverseEligibility({ client: {} as never, application: { ...issuedApplication, applyStatus: "PENDING", subscriptionOpen: false }, issuanceId: "ISS-1", walletAddress: request.wallet.address });
  assert.equal(pending.reasons[0]?.code, "CVA_NOT_ISSUED");

  for (const fixture of [
    { status: 2, expirationTime: 2_000_000_000, expected: "CVI_FROZEN" },
    { status: 1, expirationTime: 1_800_000_000, expected: "CVI_EXPIRED" },
  ] as const) {
    const client = { request: async () => ({ code: "0000", message: "success", data: { cvRecordId: "CV1", subTier: 40, tier: "40", countries: ["SG"], ...fixture } }) };
    const result = await evaluateCleanverseEligibility({ client: client as never, application: issuedApplication, issuanceId: "ISS-1", walletAddress: request.wallet.address, nowSeconds: 1_900_000_000 });
    assert.equal(result.reasons[0]?.code, fixture.expected);
  }

  let calls = 0;
  const rejectedClient = { request: async () => {
    calls += 1;
    return calls === 1
      ? { code: "0000", message: "success", data: { cvRecordId: "CV1", subTier: 40, tier: "40", status: 1, expirationTime: 2_000_000_000, countries: ["SG"] } }
      : { code: "0000", message: "success", data: { chain: "monad", atoken: issuedApplication.atokenAddress, address: request.wallet.address, code: 3, message: "country denied" } };
  } };
  const rejected = await evaluateCleanverseEligibility({ client: rejectedClient as never, application: issuedApplication, issuanceId: "ISS-1", walletAddress: request.wallet.address, nowSeconds: 1_900_000_000 });
  assert.equal(rejected.reasons[0]?.code, "CVI_RULE_REJECTED");

  const failure = await evaluateCleanverseEligibility({ client: { request: async () => { throw new Error("timeout"); } } as never, application: issuedApplication, issuanceId: "ISS-1", walletAddress: request.wallet.address });
  assert.equal(failure.reasons[0]?.code, "PROVIDER_ERROR");
});