import assert from "node:assert/strict";
import test from "node:test";

import { launchAToken, queryATokenApplyStatus } from "../src/lib/cleanverse/atoken";
import type { CleanverseEnvelope, LaunchATokenRequest } from "../src/lib/cleanverse/types";

const launchRequest: LaunchATokenRequest = {
  chain: "monad",
  token_name: "Nexus Verified Green Bond",
  token_symbol: "NGB2026",
  decimals: 6,
  admin_address: "0x1111111111111111111111111111111111111111",
  rule: {
    allowed_group: "",
    allowed_sub_group: "",
    min_tier: 30,
    min_sub_tier: 0,
    is_black_list: false,
    countries: ["HK", "SG"],
  },
  icon: "https://example.test/green-bond.png",
};

test("launchAToken uses the encrypted Cleanverse launch endpoint", async () => {
  let captured: unknown;
  const client = {
    request: async <T>(path: string, options: unknown) => {
      captured = { path, options };
      return { code: "0000", message: "success", data: { requestId: "IA202607280001", issueAssetId: 28 } } as T;
    },
  };

  const response = await launchAToken(client as never, launchRequest);
  assert.equal(response.data?.requestId, "IA202607280001");
  assert.deepEqual(captured, {
    path: "atoken/launch",
    options: { method: "POST", body: launchRequest, encrypted: true },
  });
});

test("queryATokenApplyStatus treats only ISSUED as subscription-ready evidence", async () => {
  for (const [applyStatus, expectedOpen] of [["PENDING", false], ["APPROVED", false], ["REJECTED", false], ["ISSUE_FAILED", false], ["ISSUED", true]] as const) {
    const response: CleanverseEnvelope<unknown> = {
      code: "0000",
      message: "success",
      data: {
        flowType: "LAUNCH",
        requestId: "IA202607280001",
        applyStatus,
        chain: "monad",
        ...(applyStatus === "ISSUED" ? { atokenAddress: "0x2222222222222222222222222222222222222222" } : {}),
      },
    };
    const client = { request: async () => response };
    const status = await queryATokenApplyStatus(client as never, "IA202607280001");
    const subscriptionOpen = status.applyStatus === "ISSUED" && Boolean(status.atokenAddress);
    assert.equal(subscriptionOpen, expectedOpen, applyStatus);
  }
});

test("queryATokenApplyStatus rejects malformed IDs and empty provider data", async () => {
  await assert.rejects(() => queryATokenApplyStatus({ request: async () => { throw new Error("should not call"); } } as never, "../bad"), /Invalid/);
  await assert.rejects(
    () => queryATokenApplyStatus({ request: async () => ({ code: "0000", message: "success", data: null }) } as never, "IA202607280001"),
    /no A-Token application data/,
  );
});