import { NextRequest, NextResponse } from "next/server";
import { makeAssetIdCasper } from "@/lib/casper-chain";
import { prepareCasperTokenDeploy } from "@/lib/casper-token-deploy";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { KeyAlgorithm, PrivateKey } from "casper-js-sdk";

export const runtime = "nodejs";

function makeSymbol(assetName: string) {
  const parenSymbol = assetName.match(/\(([A-Z0-9]{2,12})\)/)?.[1];
  if (parenSymbol) return parenSymbol.slice(0, 12);
  return assetName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "HRWA";
}

function getMintAuthorityPublicKey() {
  const configuredPublicKey = process.env.CASPER_ORACLE_PUBLIC_KEY?.trim();
  if (configuredPublicKey) return configuredPublicKey;

  const privateKeyHex = process.env.CASPER_ORACLE_KEY?.trim();
  if (privateKeyHex) {
    return PrivateKey.fromHex(privateKeyHex, KeyAlgorithm.ED25519).publicKey.toHex();
  }

  return "";
}

// POST /api/tokenize/prepare-deploy
// Body: { signerPublicKey, id, assetName, assetType, issuer, sfcRef, totalIssuance, currency }
// Returns unsigned Casper transaction JSON for the Casper Wallet to sign.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      signerPublicKey?: string;
      id?: string;
      assetName?: string;
      assetType?: string;
      issuer?: string;
      sfcRef?: string;
      totalIssuance?: string;
      currency?: string;
    };

    if (!body.signerPublicKey?.trim()) {
      return NextResponse.json({ error: "signerPublicKey is required" }, { status: 400 });
    }

    const mintAuthorityPublicKey = getMintAuthorityPublicKey();
    if (!mintAuthorityPublicKey) {
      return NextResponse.json(
        { error: "CASPER_ORACLE_PUBLIC_KEY or CASPER_ORACLE_KEY is required to configure TokenCoupon mint authority" },
        { status: 500 }
      );
    }

    const rawName = body.assetName?.trim() || "Harbour RWA Issuance";
    const assetId = makeAssetIdCasper(rawName);
    const symbol = makeSymbol(rawName);
    const identityRegistryHash = process.env.CASPER_IDENTITY_REGISTRY_HASH?.trim();

    if (!identityRegistryHash) {
      return NextResponse.json(
        { error: "CASPER_IDENTITY_REGISTRY_HASH is not configured. Set the shared identity registry contract hash in app/.env.local." },
        { status: 500 }
      );
    }

    const result = prepareCasperTokenDeploy({
      signerPublicKey: body.signerPublicKey.trim(),
      assetId,
      assetName: rawName,
      symbol,
      issuer: body.issuer?.trim() || "Harbour Capital Markets Corporation Limited",
      totalIssuance: body.totalIssuance?.trim() || "0",
      currency: body.currency?.trim() || "USD",
      sfcRef: body.sfcRef?.trim() || body.id?.trim() || "",
      complianceOracleHash: process.env.CASPER_COMPLIANCE_ORACLE_HASH?.trim() || undefined,
      identityRegistryHash,
      mintAuthorityPublicKey,
    });

    return NextResponse.json({
      success: true,
      deployJson: result.deployJson,
      deployArgSchema: {
        installArgCount: 13,
        odraCfgArgs: [
          "odra_cfg_is_upgradable",
          "odra_cfg_allow_key_override",
          "odra_cfg_package_hash_key_name",
        ],
        initArgs: [
          "asset_id",
          "asset_name",
          "symbol",
          "issuer",
          "total_issuance",
          "currency",
          "sfc_ref",
          "compliance_oracle_hash",
          "identity_registry_hash",
          "mint_authority",
        ],
      },
      deployToken: (() => {
        const token = randomBytes(16).toString("hex");
        const dir = path.resolve(process.cwd(), "data/pending-deploys");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `deploy-${token}.json`),
          // Persist packageKeyName alongside the deploy payload so broadcast-deploy can echo
          // back the REAL odra_cfg_package_hash_key_name used for this install (it includes a
          // random uniqueness suffix that reconciliation cannot re-derive from assetId alone).
          JSON.stringify({ deployJson: result.deployJson, signerPublicKey: result.signerPublicKey, packageKeyName: result.packageKeyName }),
        );
        return token;
      })(),
      deployHash: result.deployHash,
      signerPublicKey: result.signerPublicKey,
      paymentMotes: result.paymentMotes,
      paymentCSPR: (Number(result.paymentMotes) / 1e9).toFixed(0),
      packageKeyName: result.packageKeyName,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare deploy" },
      { status: 500 }
    );
  }
}
