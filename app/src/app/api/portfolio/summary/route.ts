import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import {
  publicClient,
  HARBOUR_RWA_TOKEN_ABI,
  tokenAddress,
} from "@/lib/chain";
import { encodeAbiParameters, formatUnits, keccak256, parseAbiParameters } from "viem";

const FALLBACK_ASSET_NAME = "Harbour Infrastructure Bond Token (HIBT)";
const HIBT_FACE_VALUE_USD = 1000;

/** 从 sfc-inbox 中找到最近已在链上注册的资产名，优先返回已注册资产 */
async function findPrimaryAsset(configured: boolean): Promise<{ assetName: string; assetCode: string }> {
  const defaultResult = { assetName: FALLBACK_ASSET_NAME, assetCode: "HIBT" };
  try {
    const raw = readFileSync(join(process.cwd(), "data", "sfc-inbox.json"), "utf-8");
    const submissions = JSON.parse(raw) as Array<{ asset?: string; status?: string; submittedAt?: string }>;
    const approved = submissions
      .filter((s) => s.status === "Approved" && s.asset)
      .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());

    for (const sub of approved) {
      const name = sub.asset!.trim();
      if (!name) continue;
      if (configured) {
        try {
          const info = await publicClient.readContract({
            address: tokenAddress(),
            abi: HARBOUR_RWA_TOKEN_ABI,
            functionName: "assets",
            args: [buildAssetId(name)],
          }) as readonly [boolean, ...unknown[]];
          if (!info[0]) continue; // not registered on-chain yet
        } catch {
          continue;
        }
      }
      // Extract ticker from parentheses e.g. "Bond Token (BONE)" → "BONE"
      const tickerMatch = name.match(/\(([A-Z0-9]{2,10})\)/);
      const code = (tickerMatch?.[1] ?? name.replace(/[^A-Z0-9]/g, "").slice(0, 6)) || "TOKEN";
      return { assetName: name, assetCode: code };
    }
  } catch {
    // ignore FS / JSON errors
  }
  return defaultResult;
}
const HIBT_COUPON_RATE = 0.055;
const DEFAULT_COUPON_HISTORY = [
  { paymentDate: "2026-01-15", amountPerTokenUsd: 27.5, distributed: true, label: "Semi-annual coupon" },
  { paymentDate: "2026-07-15", amountPerTokenUsd: 27.5, distributed: false, label: "Semi-annual coupon" },
  { paymentDate: "2027-01-15", amountPerTokenUsd: 27.5, distributed: false, label: "Semi-annual coupon" },
  { paymentDate: "2027-07-15", amountPerTokenUsd: 27.5, distributed: false, label: "Semi-annual coupon" },
] as const;



function buildAssetId(assetName: string): `0x${string}` {
  return keccak256(encodeAbiParameters(parseAbiParameters("string"), [assetName]));
}

function formatUsd(n: number) {
  return `USD ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatHkd(n: number) {
  return `HKD ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

type CouponHistoryRecord = {
  index: number;
  paymentDate: string;
  amountPerTokenUsd: number;
  distributed: boolean;
  label: string;
  claimableAmountUsd: number;
  claimed: boolean;
  onChain: boolean;
};

async function readCouponHistory(assetId: `0x${string}`, wallet: `0x${string}`, configured: boolean) {
  if (!configured) {
    return {
      history: DEFAULT_COUPON_HISTORY.map((entry, index) => ({
        ...entry,
        index,
        claimableAmountUsd: 0,
        claimed: false,
        onChain: false,
      } satisfies CouponHistoryRecord)),
      onChainHistory: false,
      claimEnabled: false,
    };
  }

  let claimEnabled = false;
  try {
    await publicClient.readContract({
      address: tokenAddress(),
      abi: HARBOUR_RWA_TOKEN_ABI,
      functionName: "couponToken",
    });
    claimEnabled = true;
  } catch {
    claimEnabled = false;
  }

  const history: CouponHistoryRecord[] = [];
  for (let index = 0; index < 8; index += 1) {
    try {
      const record = await publicClient.readContract({
        address: tokenAddress(),
        abi: HARBOUR_RWA_TOKEN_ABI,
        functionName: "dividendSchedules",
        args: [assetId, BigInt(index)],
      }) as readonly [bigint, bigint, boolean];
      const [paymentDate, amountPerToken, distributed] = record;

      let claimed = false;
      let claimableAmountUsd = 0;

      if (claimEnabled && distributed) {
        try {
          const [hasClaimed, claimableRaw] = await Promise.all([
            publicClient.readContract({
              address: tokenAddress(),
              abi: HARBOUR_RWA_TOKEN_ABI,
              functionName: "hasClaimedDividend",
              args: [assetId, BigInt(index), wallet],
            }) as Promise<boolean>,
            publicClient.readContract({
              address: tokenAddress(),
              abi: HARBOUR_RWA_TOKEN_ABI,
              functionName: "previewDividendClaim",
              args: [assetId, BigInt(index), wallet],
            }) as Promise<bigint>,
          ]);

          claimed = hasClaimed;
          claimableAmountUsd = Number(formatUnits(claimableRaw, 18));
        } catch {
          claimed = false;
          claimableAmountUsd = 0;
        }
      }

      history.push({
        index,
        paymentDate: new Date(Number(paymentDate) * 1000).toISOString().slice(0, 10),
        amountPerTokenUsd: Number(formatUnits(amountPerToken, 18)),
        distributed,
        label: "Scheduled distribution",
        claimableAmountUsd,
        claimed,
        onChain: true,
      });
    } catch {
      break;
    }
  }

  if (history.length > 0) {
    return { history, onChainHistory: true, claimEnabled };
  }

  return {
    history: DEFAULT_COUPON_HISTORY.map((entry, index) => ({
      ...entry,
      index,
      claimableAmountUsd: 0,
      claimed: false,
      onChain: false,
    } satisfies CouponHistoryRecord)),
    onChainHistory: false,
    claimEnabled,
  };
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") as `0x${string}` | null;

  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return NextResponse.json({ error: "Valid wallet query parameter is required" }, { status: 400 });
  }

  const tokenAddr = tokenAddress();
  const configured = tokenAddr !== "0x0000000000000000000000000000000000000000";
  const { assetName: primaryAssetName, assetCode: primaryAssetCode } = await findPrimaryAsset(configured);
  const assetId = buildAssetId(primaryAssetName);

  let hibtTokens = 0;
  let livePosition = false;

  if (configured) {
    try {
      const rawBalance = await publicClient.readContract({
        address: tokenAddr,
        abi: HARBOUR_RWA_TOKEN_ABI,
        functionName: "balanceOf",
        args: [wallet],
      }) as bigint;
      hibtTokens = Number(formatUnits(rawBalance, 18));
      livePosition = true;
    } catch {
      livePosition = false;
    }
  }

  const { history: couponHistory, onChainHistory, claimEnabled } = await readCouponHistory(assetId, wallet, configured);
  const nextCoupon = couponHistory.find((entry) => !entry.claimed && (entry.claimableAmountUsd > 0 || !entry.distributed))
    ?? couponHistory[couponHistory.length - 1];
  const upcomingPayoutUsd = hibtTokens * nextCoupon.amountPerTokenUsd;
  const hibtValueUsd = hibtTokens * HIBT_FACE_VALUE_USD;

  const liveHibtHolding = {
    name: "Harbour Infrastructure Bond Token (HIBT)",
    type: "Bond",
    balance: hibtTokens.toLocaleString("en-US", { maximumFractionDigits: 2 }),
    value: formatUsd(hibtValueUsd),
    yield: `${(HIBT_COUPON_RATE * 100).toFixed(1)}%`,
    score: 91,
    maturity: "15 Jul 2031",
    coupon: "5.50% p.a.",
    live: livePosition,
  };

  const holdings = [liveHibtHolding];

  return NextResponse.json({
    walletAddress: wallet,
    hibt: {
      assetId,
      assetName: primaryAssetName,
      assetCode: primaryAssetCode,
      tokens: hibtTokens,
      livePosition,
      faceValueUsd: HIBT_FACE_VALUE_USD,
      marketValueUsd: hibtValueUsd,
      nextCouponDate: nextCoupon.paymentDate,
      nextCouponPerTokenUsd: nextCoupon.amountPerTokenUsd,
      nextCouponPayoutUsd: upcomingPayoutUsd,
      source: onChainHistory ? "on-chain" : "estimated-schedule",
      claimEnabled,
      couponToken: "CSPR",
    },
    couponHistory: couponHistory.map((entry) => ({
      ...entry,
      amountPerToken: formatUsd(entry.amountPerTokenUsd),
      myPayout: formatUsd(entry.amountPerTokenUsd * hibtTokens),
      claimableAmount: formatUsd(entry.claimableAmountUsd),
      status: !entry.onChain || !claimEnabled
        ? (entry.distributed ? "Paid" : "Scheduled")
        : entry.claimed
          ? "Claimed"
          : entry.claimableAmountUsd > 0
            ? "Claimable"
            : entry.distributed
              ? "Funded"
              : "Scheduled",
      canClaim: entry.onChain && claimEnabled && entry.claimableAmountUsd > 0,
      // Show "Fund Demo Coupon" whenever contract is configured and coupon is not yet distributed,
      // regardless of whether we got on-chain history (supports demo mode with estimated schedule).
      canFund: configured && !entry.distributed && !entry.claimed,
    })),
    holdings,
  });
}