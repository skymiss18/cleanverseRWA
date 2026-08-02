import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

const CONTRACT_FILES = [
  "HarbourRWAToken.sol",
  "ComplianceModule.sol",
  "ComplianceOracle.sol",
  "IdentityRegistry.sol",
  "YieldAggregator.sol",
];

const ALLOWED_NAMES = new Set(CONTRACT_FILES);
const CONTRACTS_DIR = path.join(process.cwd(), "contracts", "contracts");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedFile = searchParams.get("file");

  if (requestedFile) {
    // Security: only allow known filenames — prevent path traversal
    if (!ALLOWED_NAMES.has(requestedFile)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const absPath = path.join(CONTRACTS_DIR, requestedFile);
    if (!fs.existsSync(absPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const source = fs.readFileSync(absPath, "utf-8");
    return NextResponse.json({
      fileName: requestedFile,
      source,
      lines: source.split("\n").length,
    });
  }

  // Return all contracts with source
  const contracts: { fileName: string; source: string; lines: number; functions: string[] }[] = [];
  for (const fileName of CONTRACT_FILES) {
    const absPath = path.join(CONTRACTS_DIR, fileName);
    if (fs.existsSync(absPath)) {
      const source = fs.readFileSync(absPath, "utf-8");
      const lines = source.split("\n").length;
      const fns = [...new Set([...source.matchAll(/function\s+(\w+)\s*\(/g)].map((m) => m[1]))];
      contracts.push({ fileName, source, lines, functions: fns });
    }
  }
  return NextResponse.json({ contracts });
}
