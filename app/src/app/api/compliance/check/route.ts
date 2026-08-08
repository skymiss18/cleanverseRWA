import { NextRequest, NextResponse } from "next/server";
import { analyzeCompliance } from "@/lib/compliance";
import { makeAssetId, makeReportHash, submitScoreOnChain } from "@/lib/oracle";

// Next.js Route Handler: POST /api/compliance/check
// Accepts multipart form with fields: text (string) OR file (PDF text already extracted client-side)
// Also accepts JSON body: { text, assetType }
export async function POST(req: NextRequest) {
  try {
    let text = "";
    let assetType: "REIT" | "GreenBond" | "TradeReceivable" | "Bond" = "REIT";
    let assetName = "Unnamed Asset";

    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      text      = body.text      ?? "";
      assetType = body.assetType ?? "REIT";
      assetName = body.assetName ?? "Unnamed Asset";
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      text      = (form.get("text")      as string) ?? "";
      assetType = (form.get("assetType") as "REIT" | "GreenBond" | "TradeReceivable" | "Bond") ?? "REIT";
      assetName = (form.get("assetName") as string) ?? "Unnamed Asset";
    } else {
      return NextResponse.json({ error: "Unsupported content-type" }, { status: 400 });
    }

    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Document text too short or missing" }, { status: 400 });
    }

    const result = await analyzeCompliance(text, assetType);
    const assetId = makeAssetId(assetName);
    const reportPayload = JSON.stringify({
      assetId,
      assetName,
      assetType,
      score: result.score,
      passed: result.passed,
      summary: result.summary,
      recommendations: result.recommendations,
      breakdown: result.breakdown,
      engine: result.engine,
      sourceLength: text.length,
      generatedAt: new Date().toISOString(),
    });

    const oracleAddr = process.env.NEXT_PUBLIC_COMPLIANCE_ORACLE_ADDRESS ?? "0x0000000000000000000000000000000000000000";
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    const isConfigured = !!privateKey && oracleAddr !== "0x0000000000000000000000000000000000000000";
    const reportHash = makeReportHash(reportPayload);

    let txHash: string | null = null;
    let explorerUrl: string | null = null;
    if (isConfigured) {
      const onChainResult = await submitScoreOnChain(assetId, result.score, reportPayload, assetName);
      txHash = onChainResult.txHash;
      explorerUrl = onChainResult.explorerUrl ?? null;
    }

    return NextResponse.json({
      assetId,
      assetName,
      assetType,
      ...result,
      onChain: !!txHash,
      txHash,
      reportHash,
      explorerUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
