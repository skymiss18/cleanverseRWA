import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { launchAToken } from "@/lib/cleanverse/atoken";
import { findLatestATokenApplicationForIssuance, upsertATokenApplication } from "@/lib/cleanverse/atoken-store";
import { getCleanverseClient } from "@/lib/cleanverse/client";
import type { CleanverseRule } from "@/lib/cleanverse/types";

export const runtime = "nodejs";

type IssuanceRecord = {
  id?: string;
  status?: string;
  asset?: string;
  type?: string;
};

type SupportedAssetType = "Bond" | "GreenBond" | "REIT" | "TradeReceivable";

const ASSET_TYPE_CONFIG: Record<SupportedAssetType, { prefix: string; label: string }> = {
  Bond: { prefix: "BND", label: "Bond" },
  GreenBond: { prefix: "NGB", label: "Green Bond" },
  REIT: { prefix: "REIT", label: "REIT" },
  TradeReceivable: { prefix: "TR", label: "Trade Receivable" },
};

function supportedAssetType(value: string | undefined): SupportedAssetType | null {
  return value && value in ASSET_TYPE_CONFIG ? value as SupportedAssetType : null;
}

function readApprovedIssuance(issuanceId: string) {
  const file = path.join(process.cwd(), "data", "sfc-inbox.json");
  const records = JSON.parse(fs.readFileSync(file, "utf8")) as IssuanceRecord[];
  return records.find((record) => record.id === issuanceId && record.status === "Approved") ?? null;
}

function parseCountries(value: string | undefined) {
  return Array.from(new Set((value ?? "HK,SG")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country))));
}

function assetRule(assetType: SupportedAssetType): CleanverseRule {
  const prefix = `CLEANVERSE_${assetType.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`;
  const env = (suffix: string) => process.env[`${prefix}_${suffix}`] ?? process.env[`CLEANVERSE_GREEN_BOND_${suffix}`];
  return {
    allowed_group: env("ALLOWED_GROUP")?.trim() ?? "",
    allowed_sub_group: env("ALLOWED_SUB_GROUP")?.trim() ?? "",
    min_tier: Number(env("MIN_TIER") ?? 30),
    min_sub_tier: Number(env("MIN_SUB_TIER") ?? 0),
    is_black_list: env("COUNTRY_MODE") === "blacklist",
    countries: parseCountries(env("COUNTRIES")),
  };
}

function tokenSymbol(issuanceId: string, assetType: SupportedAssetType) {
  const typeKey = assetType.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  const configured = process.env[`CLEANVERSE_${typeKey}_SYMBOL`]?.trim().toUpperCase();
  if (configured) return configured;
  const suffix = issuanceId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  return `${ASSET_TYPE_CONFIG[assetType].prefix}${suffix}`.slice(0, 12);
}

export async function GET(req: NextRequest) {
  const issuanceId = req.nextUrl.searchParams.get("issuanceId")?.trim() ?? "";
  if (!issuanceId) return NextResponse.json({ error: "issuanceId is required" }, { status: 400 });
  const application = findLatestATokenApplicationForIssuance(issuanceId);
  return NextResponse.json({ application });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { issuanceId?: string; adminAddress?: string };
    const issuanceId = body.issuanceId?.trim() ?? "";
    const adminAddress = body.adminAddress?.trim() ?? "";
    if (!issuanceId) return NextResponse.json({ error: "issuanceId is required" }, { status: 400 });
    if (!/^0x[0-9a-fA-F]{40}$/.test(adminAddress)) {
      return NextResponse.json({ error: "adminAddress must be a valid Ethereum address" }, { status: 400 });
    }

    const issuance = readApprovedIssuance(issuanceId);
    if (!issuance) {
      return NextResponse.json({ error: "Only an internally approved issuance can launch an A-Token" }, { status: 409 });
    }
    const assetType = supportedAssetType(issuance.type);
    if (!assetType) {
      return NextResponse.json({ error: "Supported asset types are Bond, GreenBond, REIT, and TradeReceivable" }, { status: 422 });
    }

    const existing = findLatestATokenApplicationForIssuance(issuanceId);
    if (existing && !["REJECTED", "ISSUE_FAILED"].includes(existing.applyStatus)) {
      return NextResponse.json({ success: true, existing: true, application: existing }, { status: 200 });
    }

    const typeKey = assetType.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
    const icon = (process.env[`CLEANVERSE_${typeKey}_ICON_URL`] ?? process.env.CLEANVERSE_GREEN_BOND_ICON_URL)?.trim();
    if (!icon || !/^https:\/\//i.test(icon)) {
      return NextResponse.json({ error: `CLEANVERSE_${typeKey}_ICON_URL or the shared fallback icon must be an HTTPS URL` }, { status: 503 });
    }

    const rule = assetRule(assetType);
    const symbol = tokenSymbol(issuanceId, assetType);
    const chain = process.env.CLEANVERSE_DEFAULT_CHAIN?.trim() || "ethereum";
    const response = await launchAToken(getCleanverseClient(), {
      chain,
      token_name: issuance.asset?.trim() || `Nexus Verified ${ASSET_TYPE_CONFIG[assetType].label}`,
      token_symbol: symbol,
      decimals: 6,
      admin_address: adminAddress,
      rule,
      icon,
      ...(process.env.CLEANVERSE_ATOKEN_CALLBACK_URL?.trim()
        ? { callback_url: process.env.CLEANVERSE_ATOKEN_CALLBACK_URL.trim() }
        : {}),
    });
    if (!response.data) throw new Error("Cleanverse launch response did not include application data");

    const now = new Date().toISOString();
    const record = upsertATokenApplication({
      issuanceId,
      assetName: issuance.asset?.trim() || `Nexus Verified ${ASSET_TYPE_CONFIG[assetType].label}`,
      assetType,
      requestId: response.data.requestId,
      issueAssetId: response.data.issueAssetId,
      chain,
      tokenSymbol: symbol,
      adminAddress,
      rule,
      applyStatus: "PENDING",
      subscriptionOpen: false,
      submittedAt: now,
      lastSyncedAt: now,
    });
    return NextResponse.json({ success: true, application: record }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "A-Token launch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}