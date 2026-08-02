import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isEthereumAddress } from "@/lib/investor-wallet";

export const runtime = "nodejs";

const DATA_PATH = path.join(process.cwd(), "data", "kyc-inbox.json");

function readApps(): unknown[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeApps(apps: unknown[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(apps, null, 2), "utf-8");
}

// GET /api/kyc/applications — list all KYC applications
export async function GET() {
  const apps = readApps();
  return NextResponse.json({ applications: apps });
}

// POST /api/kyc/applications — investor submits a new KYC application (queued for intermediary review)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const walletAddress = String(body.walletAddress ?? "").trim();
    if (!isEthereumAddress(walletAddress)) {
      return NextResponse.json(
        { error: "Invalid wallet identifier. Use an Ethereum 0x address." },
        { status: 400 }
      );
    }
    if (!body.fullName?.trim()) {
      return NextResponse.json({ error: "fullName is required" }, { status: 400 });
    }

    const apps = readApps() as Record<string, unknown>[];

    // Generate sequential ID
    const year = new Date().getFullYear();
    const seq  = String(apps.length + 1).padStart(3, "0");
    const id   = `KYC-${year}-${seq}`;

    const newApp = {
      id,
      submittedAt:   new Date().toISOString(),
      fullName:      String(body.fullName ?? "").trim(),
      email:         String(body.email ?? "").trim(),
      dateOfBirth:   String(body.dateOfBirth ?? "").trim(),
      phone:         String(body.phone ?? "").trim(),
      occupation:    String(body.occupation ?? "").trim(),
      jurisdiction:  String(body.jurisdiction ?? "SG").trim(),
      investorType:  body.investorType === "institutional" ? "institutional" : "individual",
      subscriptionTokens: Number(body.subscriptionTokens) || 200,
      walletAddress,
      walletNetwork: "ethereum",
      pepDeclaration: Boolean(body.pepDeclaration),
      docs: {
        govId:      String(body.docs?.govId      ?? ""),
        proofAddr:  String(body.docs?.proofAddr  ?? ""),
        piEvidence: String(body.docs?.piEvidence ?? ""),
        ...(body.docs?.sofDecl ? { sofDecl: String(body.docs.sofDecl) } : {}),
      },
      assetDeploymentId: String(body.assetDeploymentId ?? "").trim() || null,
      assetId: String(body.assetId ?? "").trim() || null,
      assetName: String(body.assetName ?? "").trim() || null,
      status:      "pending",
      aiScore:     null,
      aiRiskScore: null,
      riskBand:    null,
      aiSummary:   null,
      reviewNotes: "",
      txHash:      null,
      kycExpiry:   null,
      credentialCommitment: null,
      nullifierHash: null,
      proofHash: null,
      monitoringStatus: "pending",
      lastScreenedAt: null,
      agentReason: null,
    };

    apps.push(newApp);
    writeApps(apps);

    return NextResponse.json({ application: newApp }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
