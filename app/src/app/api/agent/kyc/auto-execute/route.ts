import { NextRequest, NextResponse } from "next/server";
import { runAutoExecute } from "@/lib/kyc-auto-execute";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string;
      action?: "update" | "revoke";
      assetDeploymentId?: string;
    };

    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const result = await runAutoExecute({
      id,
      action: body.action,
      assetDeploymentId: body.assetDeploymentId,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to auto execute KYC action" },
      { status: 500 },
    );
  }
}
