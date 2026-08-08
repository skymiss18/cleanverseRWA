import { NextRequest, NextResponse } from "next/server";
import { prepareCasperIdentityRegistryUpgradeDeploy } from "@/lib/casper-token-deploy";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      signerPublicKey?: string;
      assetId?: string;
      id?: string;
    };

    if (!body.signerPublicKey?.trim()) {
      return NextResponse.json({ error: "signerPublicKey is required" }, { status: 400 });
    }
    if (!body.assetId?.trim()) {
      return NextResponse.json({ error: "assetId is required (same assetId used at install time)" }, { status: 400 });
    }

    const result = prepareCasperIdentityRegistryUpgradeDeploy({
      signerPublicKey: body.signerPublicKey.trim(),
      assetId: body.assetId.trim(),
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
        note: "odra_cfg_is_upgrade=true triggers Odra's in-place upgrade against the existing package.",
      },
      deployToken: (() => {
        const token = randomBytes(16).toString("hex");
        const dir = path.resolve(process.cwd(), "data/pending-deploys");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, `deploy-${token}.json`),
          JSON.stringify({ deployJson: result.deployJson, signerPublicKey: result.signerPublicKey, contractType: "identityRegistryUpgrade" }),
        );
        return token;
      })(),
      deployHash: result.deployHash,
      signerPublicKey: result.signerPublicKey,
      paymentMotes: result.paymentMotes,
      paymentCSPR: (Number(result.paymentMotes) / 1e9).toFixed(0),
      assetId: body.assetId.trim(),
      id: body.id ?? "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare identity-registry upgrade deploy" },
      { status: 500 }
    );
  }
}
