import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { APassOverwriteConfirmationRequired, generateAPass } from "@/lib/cleanverse/apass";
import { getCleanverseClient } from "@/lib/cleanverse/client";

export const runtime = "nodejs";

type KycRecord = {
  id?: string;
  status?: string;
  aiScore?: number | null;
  fullName?: string;
  jurisdiction?: string;
  walletAddress?: string;
  kycExpiry?: number | null;
};

function findApprovedKyc(id: string) {
  const file = path.join(process.cwd(), "data", "kyc-inbox.json");
  const records = JSON.parse(fs.readFileSync(file, "utf8")) as KycRecord[];
  return records.find((record) => record.id === id && record.status === "approved" && (record.aiScore ?? 0) >= 70) ?? null;
}

function customerId(id: string) {
  return `NXR${createHash("sha256").update(id).digest("hex").slice(0, 21)}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { kycId?: string; override?: boolean };
    const kycId = body.kycId?.trim() ?? "";
    if (!kycId) return NextResponse.json({ error: "kycId is required" }, { status: 400 });
    const kyc = findApprovedKyc(kycId);
    if (!kyc) return NextResponse.json({ error: "An approved KYC record with score 70 or above is required" }, { status: 409 });
    if (!kyc.walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(kyc.walletAddress)) {
      return NextResponse.json({ error: "The approved KYC record must contain an Ethereum address" }, { status: 422 });
    }
    const country = (kyc.jurisdiction ?? "SG").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: "KYC jurisdiction must be an ISO alpha-2 country code" }, { status: 422 });

    const response = await generateAPass(getCleanverseClient(), {
      customerId: customerId(kycId),
      kycSource: "NexusRWA",
      kycId,
      subTier: Number(process.env.CLEANVERSE_DEFAULT_APASS_SUB_TIER ?? 40),
      override: body.override === true,
      expirationTime: kyc.kycExpiry && kyc.kycExpiry > Math.floor(Date.now() / 1_000)
        ? kyc.kycExpiry
        : Math.floor(Date.now() / 1_000) + 365 * 24 * 60 * 60,
      wallet: { address: kyc.walletAddress, chain: process.env.CLEANVERSE_DEFAULT_CHAIN?.trim() || "ethereum" },
      identityDataList: [{
        idType: "ID_CARD",
        fullName: kyc.fullName?.trim() || "Verified Investor",
        idNumber: createHash("sha256").update(kycId).digest("hex"),
        issuingCountryISO2: country,
      }],
    });
    return NextResponse.json({ success: true, apass: response.data });
  } catch (error) {
    if (error instanceof APassOverwriteConfirmationRequired) {
      return NextResponse.json({ error: error.message, confirmationRequired: true, providerMessage: error.providerMessage }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "A-Pass generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}