import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { analyzeContract } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Files to audit — paths relative to project root (app/)
const CONTRACT_FILES = [
  "contracts/contracts/HarbourRWAToken.sol",
  "contracts/contracts/ComplianceModule.sol",
  "contracts/contracts/ComplianceOracle.sol",
  "contracts/contracts/IdentityRegistry.sol",
  "contracts/contracts/YieldAggregator.sol",
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectName: string = body.projectName ?? "HarbourRWA";

    // Read contract sources from filesystem
    const cwd = process.cwd(); // Next.js API routes run from the app/ folder
    const sources: Record<string, string> = {};

    for (const relPath of CONTRACT_FILES) {
      const absPath = path.join(cwd, relPath);
      if (fs.existsSync(absPath)) {
        const code = fs.readFileSync(absPath, "utf-8");
        const fileName = path.basename(relPath);
        sources[fileName] = code;
      }
    }

    if (Object.keys(sources).length === 0) {
      return NextResponse.json(
        { error: "No contract files found. Ensure contracts/ directory is present." },
        { status: 404 }
      );
    }

    const report = await analyzeContract({ projectName, sources });

    return NextResponse.json(report);
  } catch (err) {
    console.error("[audit/contract]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audit failed" },
      { status: 500 }
    );
  }
}
