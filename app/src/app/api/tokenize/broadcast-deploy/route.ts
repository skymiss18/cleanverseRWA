import { NextRequest, NextResponse } from "next/server";
import { makeAssetIdCasper } from "@/lib/casper-chain";
import { broadcastSignedDeploy } from "@/lib/casper-token-deploy";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

function makeSymbol(assetName: string) {
  const parenSymbol = assetName.match(/\(([A-Z0-9]{2,12})\)/)?.[1];
  if (parenSymbol) return parenSymbol.slice(0, 12);
  return assetName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12) || "HRWA";
}

// POST /api/tokenize/broadcast-deploy
// Body: { deployToken, signatureHex, signerPublicKey, id, assetName, assetType, issuer, sfcRef, totalIssuance, currency }
// Loads the stored transaction JSON by token, attaches wallet signature and broadcasts to Casper Network.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      deployToken?: string;
      deployJson?: Record<string, unknown>; // legacy fallback
      signatureHex?: string;
      signerPublicKey?: string;
      id?: string;
      assetName?: string;
      assetType?: string;
      issuer?: string;
      sfcRef?: string;
      totalIssuance?: string;
      currency?: string;
    };

    let deployJson: Record<string, unknown> | undefined = body.deployJson;
    let packageKeyName: string | undefined;

    if (body.deployToken) {
      // Validate token format to prevent path traversal
      if (!/^[0-9a-f]{32}$/.test(body.deployToken)) {
        return NextResponse.json({ error: "Invalid deployToken" }, { status: 400 });
      }
      const filePath = path.resolve(process.cwd(), "data/pending-deploys", `deploy-${body.deployToken}.json`);
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: "Deploy token not found or expired" }, { status: 404 });
      }
      const stored = JSON.parse(fs.readFileSync(filePath, "utf8")) as { deployJson: Record<string, unknown>; signerPublicKey: string; packageKeyName?: string };
      deployJson = stored.deployJson;
      packageKeyName = stored.packageKeyName;
      // Clean up the temp file
      fs.unlinkSync(filePath);
    }

    if (!deployJson) {
      return NextResponse.json({ error: "deployToken or deployJson is required" }, { status: 400 });
    }
    if (!body.signatureHex?.trim()) {
      return NextResponse.json({ error: "signatureHex is required" }, { status: 400 });
    }
    if (!body.signerPublicKey?.trim()) {
      return NextResponse.json({ error: "signerPublicKey is required" }, { status: 400 });
    }

    const result = await broadcastSignedDeploy({
      deployJson,
      signatureHex: body.signatureHex.trim(),
      signerPublicKey: body.signerPublicKey.trim(),
      packageKeyName,
    });

    const rawName = body.assetName?.trim() || "Harbour RWA Issuance";
    const assetId = makeAssetIdCasper(rawName);
    const deployedAt = new Date().toISOString().slice(0, 10);

    return NextResponse.json({
      success: true,
      txHash: result.deployHash,
      deployHash: result.deployHash,
      registrationId: result.deployHash,
      assetId,
      contractHash: result.contractHash,
      contractAddress: result.contractHash,
      blockNumber: null,
      network: "Casper Testnet",
      deployedAt,
      assetName: rawName,
      assetType: body.assetType ?? "",
      issuer: body.issuer ?? "",
      sfcRef: body.sfcRef ?? body.id ?? "",
      totalIssuance: body.totalIssuance ?? "",
      currency: body.currency ?? "",
      standard: "Casper Token/Coupon WASM",
      status: result.status,
      pendingReason: result.pendingReason,
      gasUsed: 0,
      explorerUrl: result.explorerUrl,
      symbol: makeSymbol(rawName),
      packageKeyName: result.packageKeyName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Casper broadcast failed";
    console.error("[broadcast-deploy] ERROR:", msg, err instanceof Error ? err.stack?.split('\n').slice(0,3).join(' | ') : "");
    const isExecutionFailure = /execution failed|User error:|MissingArg|ApiError::User/i.test(msg);
    return NextResponse.json(
      {
        error: msg,
        errorType: isExecutionFailure ? "ExecutionFailure" : "BroadcastFailure",
      },
      { status: isExecutionFailure ? 422 : 500 }
    );
  }
}
