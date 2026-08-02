import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime   = "nodejs";
export const maxDuration = 90;

function getLLMClient(): OpenAI | null {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL, timeout: 85000, maxRetries: 0 });
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  REIT:             "Real Estate Investment Trust (REIT) Token",
  Bond:             "Corporate Bond Token",
  GreenBond:        "Green Bond Token",
  TradeReceivable:  "Trade Receivable Token",
};

const SYSTEM_PROMPT = `You are a senior securities lawyer and investment banker specialising in RWA tokenisation under the SFC framework.

Draft a professional investment prospectus that complies with:
- SFC Circular on Tokenisation of SFC-Authorised Investment Products (November 2023)
- Securities and Futures Ordinance (Cap.571) — Prospectus requirements
- SFC Code on Unit Trusts and Mutual Funds (where applicable)
- Anti-Money Laundering and Counter-Terrorist Financing Ordinance (AMLO, Cap.615)
- ICMA Green Bond Principles (for Green Bond instruments)

The prospectus MUST include all of these sections in order:

1. IMPORTANT NOTICE — Professional investors only (SFO s.14A), jurisdiction disclaimers, not for US persons
2. EXECUTIVE SUMMARY — Asset type, issuer, key terms overview
3. ISSUER INFORMATION — Company details, SFC authorisation, regulatory status, track record
4. KEY TERMS — Token details, face value, coupon/yield/distribution rate, maturity/redemption, unit price, minimum subscription, lock-up period, settlement on Casper Network
5. USE OF PROCEEDS — How funds will be deployed, project description, green framework if applicable
6. RISK FACTORS — Minimum 6 specific risks drawn from provided risk factors (market risk, liquidity risk, smart contract risk, regulatory risk, concentration risk, currency risk, credit risk as applicable)
7. SFC TOKENISATION COMPLIANCE — Casper-native issuance workflow, identity-registry KYC gating, compliance-oracle scoring, transfer controls
8. KYC / AML REQUIREMENTS — AMLO Cap.615 compliance, Professional Investor eligibility (HKD 8M liquid assets or HKD 40M portfolio), on-chain identity registry
9. SUBSCRIPTION PROCEDURE — Minimum subscription amount, subscription period, payment instructions, allocation process
10. ON-CHAIN SETTLEMENT — Casper Network infrastructure, identity-registry transfer restrictions, coupon/distribution routing

Write in formal legal English. Include all specific figures provided by the user. Length: 1000–1400 words. Output plain text only. Use clear section headings in ALL CAPS.`;

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const wantStream = url.searchParams.get("stream") === "true";

    const {
      assetType,
      assetName,
      issuerName,
      coupon,
      maturity,
      totalIssuance,
      rating,
      currency,
      description,
      greenPurpose,
      unitPrice,
      minSubscription,
      lockupPeriod,
      useOfProceeds,
      regulatoryStatus,
      riskFactors,
    } = await req.json();

    if (!assetName || !assetType) {
      return NextResponse.json(
        { error: "assetName and assetType are required" },
        { status: 400 }
      );
    }

    const client = getLLMClient();
    if (!client) {
      return NextResponse.json(
        { error: "AI service not configured — check SILICONFLOW_API_KEY" },
        { status: 503 }
      );
    }

    const typeLabel = ASSET_TYPE_LABELS[assetType] ?? assetType;
    const issueDate = new Date().toLocaleDateString("en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });
    const cur = currency || "USD";

    const risksLine = Array.isArray(riskFactors) && riskFactors.length > 0
      ? `Key Risk Factors:  ${riskFactors.join(", ")}`
      : null;

    const assetDetails = [
      `Instrument Type:     ${typeLabel}`,
      `Token Name:          ${assetName}`,
      `Issuer:              ${issuerName || "Harbour Capital Markets Corporation Limited"}`,
      regulatoryStatus   ? `Regulatory Status:   ${regulatoryStatus}` : null,
      coupon             ? `Coupon / Yield:      ${coupon}` : null,
      maturity           ? `Maturity Date:       ${maturity}` : null,
      totalIssuance      ? `Total Issuance:      ${cur} ${Number(String(totalIssuance).replace(/,/g, "")).toLocaleString()}` : null,
      unitPrice          ? `Unit Price:          ${cur} ${unitPrice}` : null,
      minSubscription    ? `Min Subscription:    ${cur} ${minSubscription}` : null,
      lockupPeriod       ? `Lock-up Period:      ${lockupPeriod}` : null,
      rating             ? `Credit Rating:       ${rating}` : null,
      `Settlement Ccy:      ${cur}`,
      `Issue Date:          ${issueDate}`,
      `Token Standard:      Casper-native RWA issuance on Casper Network`,
      description        ? `Asset Description:   ${description}` : null,
      useOfProceeds      ? `Use of Proceeds:     ${useOfProceeds}` : null,
      greenPurpose       ? `Green Use of Proceeds: ${greenPurpose}` : null,
      risksLine,
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = `Please draft the prospectus for the following asset:\n\n${assetDetails}`;

    // ── Streaming path ───────────────────────────────────────────────────────
    if (wantStream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            const stream = await client.chat.completions.create({
              model:       process.env.SILICONFLOW_MODEL || "qwen2.5-72b-instruct",
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: userPrompt },
              ],
              temperature: 0.25,
              max_tokens:  2800,
              stream:      true,
            });

            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (delta) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`)
                );
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          } catch (err) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "error", text: String(err) })}\n\n`)
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type":  "text/event-stream",
          "Cache-Control": "no-cache",
          Connection:      "keep-alive",
        },
      });
    }

    // ── Non-streaming path (backward-compat for /compliance page) ───────────
    const response = await client.chat.completions.create({
      model:       process.env.SILICONFLOW_MODEL || "qwen2.5-72b-instruct",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens:  2800,
    });

    const prospectus = response.choices[0]?.message?.content ?? "";
    if (!prospectus.trim()) {
      return NextResponse.json({ error: "AI returned empty response" }, { status: 502 });
    }

    return NextResponse.json({ prospectus });
  } catch (err) {
    console.error("[generate-prospectus]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
