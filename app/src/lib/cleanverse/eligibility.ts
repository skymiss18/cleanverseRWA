import { queryAPass, verifyAPass } from "./apass";
import type { CleanverseClient } from "./client";
import type { ATokenApplicationRecord, CleanverseEligibilityDecision } from "./types";

type CleanverseRequester = Pick<CleanverseClient, "request">;

export async function evaluateCleanverseEligibility(input: {
  client: CleanverseRequester;
  application: ATokenApplicationRecord | null;
  issuanceId: string;
  walletAddress: string;
  nowSeconds?: number;
}): Promise<CleanverseEligibilityDecision> {
  const checkedAt = new Date().toISOString();
  const chain = input.application?.chain ?? "ethereum";
  const base = {
    eligible: false,
    checkedAt,
    issuanceId: input.issuanceId,
    chain,
    walletAddress: input.walletAddress,
    reasons: [],
  } satisfies CleanverseEligibilityDecision;

  if (!input.application) {
    return { ...base, reasons: [{ code: "CVA_NOT_FOUND", message: "No Cleanverse A-Token application exists for this issuance." }] };
  }
  if (input.application.applyStatus !== "ISSUED") {
    return { ...base, reasons: [{ code: "CVA_NOT_ISSUED", message: `A-Token is ${input.application.applyStatus}; only ISSUED assets can accept subscriptions.` }] };
  }
  if (!input.application.atokenAddress) {
    return { ...base, reasons: [{ code: "CVA_ADDRESS_MISSING", message: "The issued A-Token address is missing." }] };
  }

  try {
    const apass = await queryAPass(input.client, { chain, address: input.walletAddress });
    const apassEvidence = {
      cvRecordId: apass.cvRecordId,
      status: apass.status,
      expirationTime: apass.expirationTime,
      tier: apass.tier,
      subTier: apass.subTier,
      countries: apass.countries ?? [],
    };
    if (apass.status !== 1) {
      return { ...base, atokenAddress: input.application.atokenAddress, apass: apassEvidence, reasons: [{ code: "CVI_FROZEN", message: "The investor A-Pass is frozen." }] };
    }
    if (apass.expirationTime <= (input.nowSeconds ?? Math.floor(Date.now() / 1_000))) {
      return { ...base, atokenAddress: input.application.atokenAddress, apass: apassEvidence, reasons: [{ code: "CVI_EXPIRED", message: "The investor A-Pass has expired." }] };
    }

    const verification = await verifyAPass(input.client, {
      chain,
      atoken: input.application.atokenAddress,
      address: input.walletAddress,
    });
    if (verification.code !== 4) {
      return {
        ...base,
        atokenAddress: input.application.atokenAddress,
        apass: apassEvidence,
        verification,
        reasons: [{ code: verification.code === 2 ? "CVI_NOT_FOUND" : "CVI_RULE_REJECTED", message: verification.message || "A-Pass does not satisfy the A-Token compliance rule." }],
      };
    }

    return {
      ...base,
      eligible: true,
      atokenAddress: input.application.atokenAddress,
      apass: apassEvidence,
      verification,
      reasons: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanverse eligibility check failed";
    return { ...base, atokenAddress: input.application.atokenAddress, reasons: [{ code: "PROVIDER_ERROR", message }] };
  }
}