import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  publicClient,
  getWalletClient,
  YIELD_AGGREGATOR_ABI,
  yieldAggregatorAddress,
} from "@/lib/chain";

type RiskProfile = "conservative" | "moderate" | "aggressive";

interface RebalanceRequest {
  walletAddress: `0x${string}`;
  riskProfile:   RiskProfile;
  csprApyBps?:   number;  // optional override; fetched on-chain if not supplied
  scsprApyBps?:  number;
}

function getLLMClient(): OpenAI | null {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 0 });
}

// ── Default target allocations by risk profile ────────────────────────────────
// CSPR: native, liquid, no lock-up (lower risk, lower return ceiling)
// sCSPR (Staked CSPR): native validator delegation yield (higher risk — unbonding period, slashing)
const RISK_DEFAULTS: Record<RiskProfile, { csprPct: number; reason: string }> = {
  conservative: { csprPct: 80, reason: "80% CSPR / 20% sCSPR — capital preservation priority" },
  moderate:     { csprPct: 55, reason: "55% CSPR / 45% sCSPR — balanced risk/return" },
  aggressive:   { csprPct: 25, reason: "25% CSPR / 75% sCSPR — maximise staking-correlated yield" },
};

async function getAIAllocation(
  riskProfile: RiskProfile,
  csprApy: number,
  scsprApy: number
): Promise<{ csprPct: number; rationale: string }> {
  const client = getLLMClient();

  if (!client) {
    // Rule-based fallback
    const d = RISK_DEFAULTS[riskProfile];
    // Slight dynamic adjustment: if sCSPR APY > CSPR APY by >100bps, shift 5% more to sCSPR
    let adjusted = d.csprPct;
    if (scsprApy - csprApy > 100 && riskProfile !== "conservative") adjusted = Math.max(20, adjusted - 5);
    if (csprApy - scsprApy > 100) adjusted = Math.min(90, adjusted + 5);
    return {
      csprPct: adjusted,
      rationale: `[rule-based] ${d.reason}. CSPR ${(csprApy / 100).toFixed(2)}% APY, sCSPR ${(scsprApy / 100).toFixed(2)}% APY.`,
    };
  }

  const prompt = `You are a DeFi yield optimizer for an institutional RWA platform on Casper Network.
Current APY rates:
- CSPR (native token, liquid, no lock-up): ${(csprApy / 100).toFixed(2)}% APY
- sCSPR (Staked CSPR, native validator delegation yield): ${(scsprApy / 100).toFixed(2)}% APY

Investor risk profile: ${riskProfile}

Determine the optimal % allocation to CSPR (0-100). The rest goes to sCSPR.
Respond ONLY with valid JSON: { "csprPct": <integer 0-100>, "rationale": "<max 100 chars>" }`;

  try {
    const res = await client.chat.completions.create({
      model: "Qwen/Qwen2.5-7B-Instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 120,
      response_format: { type: "json_object" },
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    const csprPct = Math.min(100, Math.max(0, parseInt(parsed.csprPct ?? 50)));
    return { csprPct, rationale: parsed.rationale ?? "AI allocation" };
  } catch {
    const d = RISK_DEFAULTS[riskProfile];
    return { csprPct: d.csprPct, rationale: d.reason };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
// POST /api/advisor/rebalance
// Body: { walletAddress, riskProfile }
// 1. Reads current APY from YieldAggregator on-chain (or uses defaults)
// 2. AI determines optimal CSPR/sCSPR split
// 3. Calls autoRebalance() on-chain
// 4. Returns { csprPct, rationale, txHash }
export async function POST(req: NextRequest) {
  try {
    const body: RebalanceRequest = await req.json();
    const { walletAddress, riskProfile } = body;

    if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    if (!["conservative", "moderate", "aggressive"].includes(riskProfile)) {
      return NextResponse.json({ error: "riskProfile must be conservative | moderate | aggressive" }, { status: 400 });
    }

    const yieldAddr  = yieldAggregatorAddress();
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    const isConfigured = privateKey && yieldAddr !== "0x0000000000000000000000000000000000000000";

    // ── 1. Get current APY rates ────────────────────────────────────────────
    let csprApy = body.csprApyBps ?? 500;   // default 5.00%
    let scsprApy = body.scsprApyBps ?? 1085; // default 10.85% (cspr.live network APY)

    if (isConfigured) {
      try {
        const info = await publicClient.readContract({
          address: yieldAddr,
          abi: YIELD_AGGREGATOR_ABI,
          functionName: "getYieldInfo",
        }) as readonly [number, number, bigint];
        csprApy = info[0];
        scsprApy = info[1];
      } catch { /* use defaults */ }
    }

    // ── 2. AI computes allocation ───────────────────────────────────────────
    const { csprPct, rationale } = await getAIAllocation(riskProfile, csprApy, scsprApy);

    // ── 3. Submit rebalance on-chain ────────────────────────────────────────
    let txHash: string | null = null;
    let onChain = false;

    if (isConfigured) {
      try {
        const walletClient = getWalletClient();
        const gasPrice = await publicClient.getGasPrice();
        const safeGasPrice = gasPrice * 2n;
        txHash = await walletClient.writeContract({
          address: yieldAddr,
          abi: YIELD_AGGREGATOR_ABI,
          functionName: "autoRebalance",
          args: [walletAddress, csprPct, rationale.slice(0, 120)],
          maxFeePerGas: safeGasPrice,
          maxPriorityFeePerGas: safeGasPrice,
        });
        onChain = true;
      } catch (chainErr) {
        // Deployer may not have AI_AGENT_ROLE on this deployment — return AI result off-chain
        console.warn("[rebalance] on-chain call skipped:", chainErr instanceof Error ? chainErr.message : chainErr);
      }
    }

    return NextResponse.json({
      walletAddress,
      riskProfile,
      csprPct,
      scsprPct:    100 - csprPct,
      csprApy:   (csprApy / 100).toFixed(2) + "%",
      scsprApy:  (scsprApy / 100).toFixed(2) + "%",
      weightedApy: ((csprPct * csprApy + (100 - csprPct) * scsprApy) / 10000).toFixed(2) + "%",
      rationale,
      onChain,
      txHash,
      explorerUrl: txHash ? `https://testnet.cspr.live/deploy/${txHash}` : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/advisor/rebalance?wallet=0x...
// Returns current yield info + last rebalance record from chain
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") as `0x${string}` | null;

  const yieldAddr  = yieldAggregatorAddress();
  const isConfigured = yieldAddr !== "0x0000000000000000000000000000000000000000";

  if (!isConfigured) {
    return NextResponse.json({
      csprApy: "5.00%", scsprApy: "10.85%",
      lastUpdate: null, lastRebalance: null,
      note: "Contracts not yet deployed",
    });
  }

  try {
    const info = await publicClient.readContract({
      address: yieldAddr,
      abi: YIELD_AGGREGATOR_ABI,
      functionName: "getYieldInfo",
    }) as readonly [number, number, bigint];

    let lastRebalanceData = null;
    if (wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      try {
        const r = await publicClient.readContract({
          address: yieldAddr,
          abi: YIELD_AGGREGATOR_ABI,
          functionName: "lastRebalance",
          args: [wallet],
        }) as readonly [bigint, bigint, bigint, number, string];
        if (r[0] > BigInt(0)) {
          lastRebalanceData = {
            timestamp:   new Date(Number(r[0]) * 1000).toISOString(),
            csprShares:  r[1].toString(),
            scsprShares: r[2].toString(),
            csprPct:     r[3],
            aiRationale: r[4],
          };
        }
      } catch { /* no rebalance yet */ }
    }

    return NextResponse.json({
      csprApy:       (info[0] / 100).toFixed(2) + "%",
      scsprApy:      (info[1] / 100).toFixed(2) + "%",
      lastUpdate:    new Date(Number(info[2]) * 1000).toISOString(),
      lastRebalance: lastRebalanceData,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "read error" }, { status: 500 });
  }
}

