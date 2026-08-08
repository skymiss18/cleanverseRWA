import assert from "node:assert/strict";
import test from "node:test";

import { isInvestorWalletAddress, isEthereumAddress } from "../src/lib/investor-wallet";

test("KYC accepts Ethereum wallet identifiers", () => {
  const ethereum = "0x1111111111111111111111111111111111111111";

  assert.equal(isEthereumAddress(ethereum), true);
  assert.equal(isInvestorWalletAddress(ethereum), true);
});

test("KYC rejects malformed and non-Ethereum wallet identifiers", () => {
  assert.equal(isInvestorWalletAddress("0x1234"), false);
  assert.equal(isInvestorWalletAddress(`01${"a".repeat(64)}`), false);
  assert.equal(isInvestorWalletAddress("not-a-wallet"), false);
});