import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const DATA_PATH = path.join(process.cwd(), "data", "kyc-inbox.json");

function readApps(): Record<string, unknown>[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeApps(apps: Record<string, unknown>[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2), "utf-8");
}

// PATCH /api/kyc/applications/[id] — intermediary updates status, aiScore, reviewNotes, txHash
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const patch = await req.json() as Record<string, unknown>;

    const apps = readApps();
    const idx  = apps.findIndex((a) => a.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    // Only allow updating safe fields; never overwrite id or submittedAt
    const ALLOWED = [
      "status",
      "aiScore",
      "aiSummary",
      "aiBreakdown",
      "reviewNotes",
      "txHash",
      "assetDeploymentId",
      "assetId",
      "assetName",
      "network",
      "explorerUrl",
      "signerPublicKey",
      "pendingReason",
      "chainStatus",
    ] as const;
    for (const key of ALLOWED) {
      if (key in patch) {
        apps[idx][key] = patch[key];
      }
    }

    writeApps(apps);

    return NextResponse.json({ application: apps[idx] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
