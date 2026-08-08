import { NextRequest, NextResponse } from "next/server";
import { broadcastSignedDeploy } from "@/lib/casper-token-deploy";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Broadcasts a wallet-signed IdentityRegistry *upgrade* deploy (prepared via
 *  /api/tokenize/prepare-identity-upgrade-deploy). Mirrors
 *  broadcast-identity-deploy/route.ts but marks the resulting record as
 *  contractVersion "v2" so the UI can show the Track-4 "contract is
 *  upgradable, and was actually upgraded" story. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      deployToken?: string;
      deployJson?: Record<string, unknown>;
      signatureHex?: string;
      signerPublicKey?: string;
      id?: string;
      assetName?: string;
    };

    let deployJson: Record<string, unknown> | undefined = body.deployJson;

    if (body.deployToken) {
      if (!/^[0-9a-f]{32}$/.test(body.deployToken)) {
        return NextResponse.json({ error: "Invalid deployToken" }, { status: 400 });
      }
      const filePath = path.resolve(process.cwd(), "data/pending-deploys", `deploy-${body.deployToken}.json`);
      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: "Deploy token not found or expired" }, { status: 404 });
      }
      const stored = JSON.parse(fs.readFileSync(filePath, "utf8")) as { deployJson: Record<string, unknown> };
      deployJson = stored.deployJson;
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
    });

    return NextResponse.json({
      success: true,
      txHash: result.deployHash,
      deployHash: result.deployHash,
      id: body.id ?? "",
      assetName: body.assetName ?? "",
      contractHash: result.contractHash,
      contractAddress: result.contractHash,
      network: "Casper Testnet",
      deployedAt: new Date().toISOString().slice(0, 10),
      standard: "Casper Identity Registry WASM (upgrade)",
      status: result.status,
      pendingReason: result.pendingReason,
      explorerUrl: result.explorerUrl,
      contractVersion: "v2",
      isUpgradable: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Casper identity-registry upgrade broadcast failed";
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
