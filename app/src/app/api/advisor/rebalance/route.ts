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
  ethApyBps?:    number;
  ngbApyBps?:    number;
}

function getLLMClient(): OpenAI | null {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 0 });
}

// ── Default target allocations by risk profile ────────────────────────────────
// NGB2026 provides fixed-income exposure; ETH provides liquid, higher-volatility exposure.
const RISK_DEFAULTS: Record<RiskProfile, { ethPct: number; reason: string }> = {
  conservative: { ethPct: 20, reason: "20% ETH / 80% NGB2026 - fixed-income priority" },
  moderate:     { ethPct: 45, reason: "45% ETH / 55% NGB2026 - balanced risk/return" },
  aggressive:   { ethPct: 70, reason: "70% ETH / 30% NGB2026 - higher crypto-market exposure" },
};

async function getAIAllocation(
  riskProfile: RiskProfile,
  ethApy: number,
  ngbApy: number
): Promise<{ ethPct: number; rationale: string }> {
  const client = getLLMClient();

  if (!client) {
    // Rule-based fallback
    const d = RISK_DEFAULTS[riskProfile];
    let adjusted = d.ethPct;
    if (ngbApy - ethApy > 100 && riskProfile !== "aggressive") adjusted = Math.max(10, adjusted - 5);
    if (ethApy - ngbApy > 100 && riskProfile !== "conservative") adjusted = Math.min(80, adjusted + 5);
    return {
      ethPct: adjusted,
      rationale: `[rule-based] ${d.reason}. ETH ${(ethApy / 100).toFixed(2)}% APY, NGB2026 ${(ngbApy / 100).toFixed(2)}% coupon.`,
    };
  }

  const prompt = `You are a DeFi yield optimizer for an institutional RWA platform on Ethereum Sepolia.
Current APY rates:
- ETH (liquid Ethereum asset with staking yield): ${(ethApy / 100).toFixed(2)}% APY
- NGB2026 (regulated tokenized green bond): ${(ngbApy / 100).toFixed(2)}% coupon

Investor risk profile: ${riskProfile}

Determine the optimal % allocation to ETH (0-100). The rest goes to NGB2026.
Respond ONLY with valid JSON: { "ethPct": <integer 0-100>, "rationale": "<max 100 chars>" }`;

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
    const ethPct = Math.min(100, Math.max(0, parseInt(parsed.ethPct ?? 45)));
    return { ethPct, rationale: parsed.rationale ?? "AI allocation" };
  } catch {
    const d = RISK_DEFAULTS[riskProfile];
    return { ethPct: d.ethPct, rationale: d.reason };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
// POST /api/advisor/rebalance
// Body: { walletAddress, riskProfile }
// 1. Reads current APY from YieldAggregator on-chain (or uses defaults)
// 2. AI determines optimal ETH/NGB2026 split
// 3. Calls autoRebalance() on-chain
// 4. Returns { ethPct, rationale, txHash }
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
    let ethApy = body.ethApyBps ?? 320;
    let ngbApy = body.ngbApyBps ?? 550;

    if (isConfigured) {
      try {
        const info = await publicClient.readContract({
          address: yieldAddr,
          abi: YIELD_AGGREGATOR_ABI,
          functionName: "getYieldInfo",
        }) as readonly [number, number, bigint];
        ngbApy = info[0];
        ethApy = info[1];
      } catch { /* use defaults */ }
    }

    // ── 2. AI computes allocation ───────────────────────────────────────────
    const { ethPct, rationale } = await getAIAllocation(riskProfile, ethApy, ngbApy);
    const ngbPct = 100 - ethPct;

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
          args: [walletAddress, ngbPct, rationale.slice(0, 120)],
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
      ethPct,
      ngbPct,
      ethApy: (ethApy / 100).toFixed(2) + "%",
      ngbApy: (ngbApy / 100).toFixed(2) + "%",
      weightedApy: ((ethPct * ethApy + ngbPct * ngbApy) / 10000).toFixed(2) + "%",
      rationale,
      onChain,
      txHash,
      explorerUrl: txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null,
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
      ethApy: "3.20%", ngbApy: "5.50%",
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
            ngbShares:   r[1].toString(),
            ethShares:   r[2].toString(),
            ngbPct:      r[3],
            ethPct:      100 - r[3],
            aiRationale: r[4],
          };
        }
      } catch { /* no rebalance yet */ }
    }

    return NextResponse.json({
      ngbApy:        (info[0] / 100).toFixed(2) + "%",
      ethApy:        (info[1] / 100).toFixed(2) + "%",
      lastUpdate:    new Date(Number(info[2]) * 1000).toISOString(),
      lastRebalance: lastRebalanceData,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "read error" }, { status: 500 });
  }
}

