import { NextRequest, NextResponse } from "next/server";
import { makeAssetIdCasper } from "@/lib/casper-chain";
import { prepareCasperIdentityRegistryDeploy } from "@/lib/casper-token-deploy";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      signerPublicKey?: string;
      id?: string;
      assetName?: string;
    };

    if (!body.signerPublicKey?.trim()) {
      return NextResponse.json({ error: "signerPublicKey is required" }, { status: 400 });
    }

    const rawName = body.assetName?.trim() || "Harbour RWA Issuance";
    const assetId = makeAssetIdCasper(rawName);
    const result = prepareCasperIdentityRegistryDeploy({
      signerPublicKey: body.signerPublicKey.trim(),
      assetId,
    });

    return NextResponse.json({
      success: true,
      deployJson: result.deployJson,
      deployArgSchema: {
        installArgCount: 4,
        odraCfgArgs: [
          "odra_cfg_is_upgrade",
          "odra_cfg_is_upgradable",
          "odra_cfg_allow_key_override",
          "odra_cfg_package_hash_key_name",
        ],
      },
      deployToken: (() => {
        const token = randomBytes(16).toString("hex");
        const dir = path.resolve(process.cwd(), "data/pending-deploys");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `deploy-${token}.json`),
          JSON.stringify({ deployJson: result.deployJson, signerPublicKey: result.signerPublicKey, contractType: "identityRegistry" }),
        );
        return token;
      })(),
      deployHash: result.deployHash,
      signerPublicKey: result.signerPublicKey,
      paymentMotes: result.paymentMotes,
      paymentCSPR: (Number(result.paymentMotes) / 1e9).toFixed(0),
      assetId,
      assetName: rawName,
      id: body.id ?? "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare identity-registry deploy" },
      { status: 500 }
    );
  }
}