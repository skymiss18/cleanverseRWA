import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

type SubscriptionInvestorRecord = {
  assetId: string;
  assetName: string;
  deploymentId?: string;
  investorPublicKey: string;
  tokenCount: number;
  paymentRef: string;
  paymentTxHash: string;
  mintTxHash: string;
  mintStatus?: string;
  createdAt: string;
};

function readInvestorRecords() {
  try {
    const filePath = join(process.cwd(), "data", "subscriptions.json");
    if (!existsSync(filePath)) return [] as SubscriptionInvestorRecord[];
    return JSON.parse(readFileSync(filePath, "utf-8")) as SubscriptionInvestorRecord[];
  } catch {
    return [] as SubscriptionInvestorRecord[];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get("assetId")?.trim().toLowerCase();
  const assetName = searchParams.get("assetName")?.trim().toLowerCase();
  const deploymentId = searchParams.get("deploymentId")?.trim();

  const records = readInvestorRecords();
  const filtered = records.filter((record) => {
    if (deploymentId && record.deploymentId === deploymentId) return true;
    if (assetId && record.assetId.toLowerCase() === assetId) return true;
    if (assetName && record.assetName.trim().toLowerCase() === assetName) return true;
    return false;
  });

  const latestByInvestor = new Map<string, SubscriptionInvestorRecord>();
  for (const item of filtered) {
    const key = item.investorPublicKey.trim().toLowerCase();
    const prev = latestByInvestor.get(key);
    if (!prev || prev.createdAt < item.createdAt) {
      latestByInvestor.set(key, item);
    }
  }

  const investors = Array.from(latestByInvestor.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((item) => ({
      publicKey: item.investorPublicKey,
      tokenCount: item.tokenCount,
      paymentRef: item.paymentRef,
      mintTxHash: item.mintTxHash,
      createdAt: item.createdAt,
    }));

  return NextResponse.json({ investors });
}
