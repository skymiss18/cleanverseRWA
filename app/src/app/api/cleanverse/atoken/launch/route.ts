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

function greenBondRule(): CleanverseRule {
  return {
    allowed_group: process.env.CLEANVERSE_GREEN_BOND_ALLOWED_GROUP?.trim() ?? "",
    allowed_sub_group: process.env.CLEANVERSE_GREEN_BOND_ALLOWED_SUB_GROUP?.trim() ?? "",
    min_tier: Number(process.env.CLEANVERSE_GREEN_BOND_MIN_TIER ?? 30),
    min_sub_tier: Number(process.env.CLEANVERSE_GREEN_BOND_MIN_SUB_TIER ?? 0),
    is_black_list: process.env.CLEANVERSE_GREEN_BOND_COUNTRY_MODE === "blacklist",
    countries: parseCountries(process.env.CLEANVERSE_GREEN_BOND_COUNTRIES),
  };
}

function tokenSymbol(issuanceId: string) {
  const configured = process.env.CLEANVERSE_GREEN_BOND_SYMBOL?.trim().toUpperCase();
  if (configured) return configured;
  return `NGB${issuanceId.replace(/[^A-Za-z0-9]/g, "").slice(-7).toUpperCase()}`.slice(0, 12);
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
    if (!/green\s*bond/i.test(`${issuance.type ?? ""} ${issuance.asset ?? ""}`)) {
      return NextResponse.json({ error: "The hackathon launch route currently supports approved green bonds only" }, { status: 422 });
    }

    const existing = findLatestATokenApplicationForIssuance(issuanceId);
    if (existing && !["REJECTED", "ISSUE_FAILED"].includes(existing.applyStatus)) {
      return NextResponse.json({ success: true, existing: true, application: existing }, { status: 200 });
    }

    const icon = process.env.CLEANVERSE_GREEN_BOND_ICON_URL?.trim();
    if (!icon || !/^https:\/\//i.test(icon)) {
      return NextResponse.json({ error: "CLEANVERSE_GREEN_BOND_ICON_URL must be configured with an HTTPS URL" }, { status: 503 });
    }

    const rule = greenBondRule();
    const symbol = tokenSymbol(issuanceId);
    const chain = process.env.CLEANVERSE_DEFAULT_CHAIN?.trim() || "ethereum";
    const response = await launchAToken(getCleanverseClient(), {
      chain,
      token_name: issuance.asset?.trim() || "Nexus Verified Green Bond",
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
      assetName: issuance.asset?.trim() || "Nexus Verified Green Bond",
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