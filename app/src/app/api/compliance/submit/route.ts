import { NextRequest, NextResponse } from "next/server";
import { makeAssetId, makeReportHash, submitScoreOnChain } from "@/lib/oracle";
import { analyzeCompliance } from "@/lib/compliance";

// POST /api/compliance/submit
// Body: { text, assetType, assetName }
// Runs AI compliance analysis and anchors the result on Ethereum.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text:      string = body.text      ?? "";
    const assetType: "REIT" | "GreenBond" | "TradeReceivable" | "Bond" = body.assetType ?? "REIT";
    const assetName: string = body.assetName ?? "Unnamed Asset";

    if (!text || text.length < 200) {
      return NextResponse.json({ error: "Document text too short — please paste the full prospectus or term sheet (minimum 200 characters)" }, { status: 400 });
    }

    const result  = await analyzeCompliance(text, assetType);
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
      const result2 = await submitScoreOnChain(assetId, result.score, reportPayload, assetName);
      txHash = result2.txHash;
      explorerUrl = result2.explorerUrl ?? null;
    }

    return NextResponse.json({
      assetId,
      assetName,
      assetType,
      score:    result.score,
      passed:   result.passed,
      summary:  result.summary,
      recommendations: result.recommendations,
      breakdown: result.breakdown,
      engine:   result.engine,
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
