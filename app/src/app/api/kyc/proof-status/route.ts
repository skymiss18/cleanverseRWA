import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PublicKey } from "casper-js-sdk";

export const runtime = "nodejs";

const DATA_PATH = path.join(process.cwd(), "data", "kyc-inbox.json");

type KycRecord = {
  walletAddress?: string;
  status?: string;
  proofVerified?: boolean | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  zkVerifiedAt?: string | null;
  kycExpiry?: number | null;
};

function readApps(): KycRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function walletAliases(value: string): string[] {
  const aliases = new Set<string>();
  const raw = value.trim().toLowerCase();
  if (!raw) return [];
  aliases.add(raw);
  try {
    const key = PublicKey.fromHex(value.trim());
    aliases.add(key.toHex().toLowerCase());
    aliases.add(key.accountHash().toPrefixedString().toLowerCase());
  } catch {
    // not a public key hex; keep raw alias only
  }
  return Array.from(aliases);
}

function shorten(value?: string | null): string | null {
  if (!value) return null;
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

// GET /api/kyc/proof-status?walletAddress=... — read-only summary of the ZK compliance
// credential currently on file for a wallet, for display on the /subscribe pre-check step.
export async function GET(req: NextRequest) {
  const walletAddress = req.nextUrl.searchParams.get("walletAddress")?.trim();
  if (!walletAddress) {
    return NextResponse.json({ found: false, message: "walletAddress is required" }, { status: 400 });
  }

  const targetAliases = new Set(walletAliases(walletAddress));
  const record = readApps().find((app) => {
    if (!app.walletAddress) return false;
    return walletAliases(app.walletAddress).some((alias) => targetAliases.has(alias));
  });

  if (!record) {
    return NextResponse.json({ found: false });
  }

  const hasCredential = Boolean(record.credentialCommitment && record.nullifierHash && record.proofHash);

  return NextResponse.json({
    found: true,
    status: record.status ?? null,
    hasCredential,
    proofVerified: record.proofVerified ?? null,
    zkProofScheme: record.zkProofScheme ?? null,
    zkCircuitId: record.zkCircuitId ?? null,
    zkVerifiedAt: record.zkVerifiedAt ?? null,
    kycExpiry: record.kycExpiry ?? null,
    credentialCommitment: shorten(record.credentialCommitment),
    nullifierHash: shorten(record.nullifierHash),
  });
}
