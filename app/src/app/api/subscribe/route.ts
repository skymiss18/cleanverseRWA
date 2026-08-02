import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { PublicKey } from "casper-js-sdk";
import {
  publicClient,
  getWalletClient,
  COMPLIANCE_MODULE_ABI,
  HARBOUR_RWA_TOKEN_ABI,
  moduleAddress,
  tokenAddress,
} from "@/lib/chain";
import { makeAssetIdCasper } from "@/lib/casper-chain";
import { readDeploymentsWithReconciliation } from "@/lib/casper-deployments";
import { mintCasperTokenCoupon, verifyCasperNativeTransfer } from "@/lib/casper-token-deploy";
import { getZkProvider, type ZkProofBundle } from "@/lib/zk-provider";
import { handleCleanverseSubscription, refreshCleanverseSubscription } from "@/lib/cleanverse/subscription";

// Check if wallet has an approved KYC record in local JSON store
type KycRecord = {
  walletAddress: string;
  status: string;
  aiScore: number | null;
  jurisdiction?: string;
  riskBand?: number | null;
  kycExpiry?: number | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  monitoringStatus?: string | null;
  zkProof?: string | null;
  zkPublicSignals?: string[] | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  zkVerificationKeyId?: string | null;
  proofVerified?: boolean | null;
  zkVerifiedAt?: string | null;
};

type UsedNullifierRecord = {
  nullifierHash: string;
  walletAddress: string;
  assetName: string;
  usedAt: string;
  credentialVerifiedAt: string | null;
};

type CasperDeployment = {
  assetName?: string;
  assetId?: string;
  contractHash?: string;
  status?: string;
  deployHash?: string;
  explorerUrl?: string;
};

type SfcAssetRecord = {
  asset?: string;
  status?: string;
  unitPrice?: string | number;
};

type SponsorAssetRecord = {
  assetName?: string;
  unitPrice?: string | number;
};

type SubscriptionInvestorRecord = {
  assetId: string;
  assetName: string;
  deploymentId?: string;
  contractHash?: string;
  investorPublicKey: string;
  tokenCount: number;
  refNum?: string;
  paymentRef: string;
  paymentTxHash: string;
  mintTxHash: string;
  paymentStatus?: "Pending" | "Confirmed" | "Failed" | "Rejected" | "Skipped";
  mintStatus?: string;
  pendingReason?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt?: string;
};

const MIN_CSPR_TRANSFER_MOTES = 2_500_000_000n;
const MOTES_PER_CSPR = 1_000_000_000n;
const USD_CENTS_PER_DEMO_CSPR = 100_000n; // Demo quote: 1 CSPR = USD 1,000.
const SUBSCRIPTION_FEE_BPS = 25n; // 0.25%

const DEFAULT_PAYMENT_FINALITY_WAIT_MS = 45_000;
const DEFAULT_PAYMENT_FINALITY_POLL_MS = 3_000;
const DEFAULT_BACKGROUND_FINALITY_WAIT_MS = 8 * 60_000;
const DEFAULT_BACKGROUND_FINALITY_POLL_MS = 5_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRefPrefix(assetName: string) {
  const cleaned = assetName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned.slice(0, 4) || "RWA") + "-";
}

function readKycApps(): KycRecord[] {
  const filePath = join(process.cwd(), "data", "kyc-inbox.json");
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as KycRecord[];
}

function normalizeCasperAlias(value: string): string {
  return value.trim().toLowerCase();
}

function casperWalletAliases(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];

  const aliases = new Set<string>();
  const raw = normalizeCasperAlias(value);
  aliases.add(raw);

  const accountHashMatch = raw.match(/^account-hash-([0-9a-f]{64})$/);
  if (accountHashMatch) {
    aliases.add(`account-hash-${accountHashMatch[1]}`);
  }

  try {
    const key = PublicKey.fromHex(value.trim());
    aliases.add(normalizeCasperAlias(key.toHex()));
    aliases.add(normalizeCasperAlias(key.accountHash().toPrefixedString()));
  } catch {
    // Not a valid Casper public key hex; keep the raw alias only.
  }

  return Array.from(aliases);
}

function findApprovedKycRecord(walletAddress: string): KycRecord | null {
  try {
    const targetAliases = new Set(casperWalletAliases(walletAddress));
    if (targetAliases.size === 0) {
      targetAliases.add(walletAddress.toLowerCase());
    }

    return readKycApps().find(
      (a) => {
        if (a.status !== "approved" || (a.aiScore ?? 0) < 70) return false;

        const monitoringStatus = (a.monitoringStatus ?? "").toLowerCase();
        if (monitoringStatus === "revoked" || monitoringStatus === "revoke_prepared") {
          return false;
        }

        const now = Math.floor(Date.now() / 1000);
        const kycExpiry = typeof a.kycExpiry === "number" ? a.kycExpiry : 0;
        if (kycExpiry > 0 && kycExpiry < now) {
          return false;
        }

        const riskBand = typeof a.riskBand === "number" ? a.riskBand : null;
        if (riskBand !== null && riskBand >= 3) {
          return false;
        }

        const hasPrivacyCredential = Boolean(a.credentialCommitment && a.nullifierHash && a.proofHash);
        if (hasPrivacyCredential && (a.aiScore ?? 0) < 70) {
          return false;
        }

        const recordAliases = casperWalletAliases(a.walletAddress);
        if (recordAliases.length === 0) return false;
        return recordAliases.some((alias) => targetAliases.has(alias));
      }
    ) ?? null;
  } catch { return null; }
}

function isKycApprovedLocally(walletAddress: string): boolean {
  return findApprovedKycRecord(walletAddress) !== null;
}

function readUsedNullifiers(): UsedNullifierRecord[] {
  return readJsonFile<UsedNullifierRecord[]>("subscription-nullifiers.json", []);
}

function writeUsedNullifiers(records: UsedNullifierRecord[]) {
  const filePath = join(process.cwd(), "data", "subscription-nullifiers.json");
  writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");
}

function recordNullifierUsage(entry: UsedNullifierRecord) {
  const all = readUsedNullifiers();
  all.unshift(entry);
  writeUsedNullifiers(all.slice(0, 5000));
}

// Reconstruct the persisted ZK proof bundle for a KYC record and verify it via the active
// zk-provider, then check that its nullifier hasn't already been consumed by a prior
// subscription (unless the credential has been re-issued/refreshed since that prior use).
async function verifyKycProofForSubscription(
  record: KycRecord,
): Promise<{ valid: boolean; reason?: string }> {
  if (!record.zkProof || !record.proofHash || !record.credentialCommitment || !record.nullifierHash) {
    return { valid: false, reason: "No privacy-preserving compliance proof is on file for this KYC record." };
  }

  const bundle: ZkProofBundle = {
    scheme: (record.zkProofScheme as ZkProofBundle["scheme"]) ?? "zk-ready-hash",
    circuitId: record.zkCircuitId ?? "kyc-commitment-v1",
    verificationKeyId: record.zkVerificationKeyId ?? "local-hash-v1",
    generatedAt: record.zkVerifiedAt ?? new Date().toISOString(),
    commitment: record.credentialCommitment,
    nullifierHash: record.nullifierHash,
    proofHash: record.proofHash,
    proof: record.zkProof,
    publicSignals: record.zkPublicSignals ?? [],
  };

  const verification = await getZkProvider().verifyProof(bundle);
  if (!verification.valid) {
    return { valid: false, reason: verification.reason ?? "Compliance proof failed verification." };
  }

  const usedNullifiers = readUsedNullifiers();
  const priorUse = usedNullifiers.find((u) => u.nullifierHash === record.nullifierHash);
  if (priorUse) {
    const credentialRefreshedSincePriorUse =
      Boolean(record.zkVerifiedAt) && Boolean(priorUse.credentialVerifiedAt)
        ? new Date(record.zkVerifiedAt as string).getTime() > new Date(priorUse.credentialVerifiedAt as string).getTime()
        : false;
    if (!credentialRefreshedSincePriorUse) {
      return { valid: false, reason: "This compliance credential has already been used for a previous subscription. Refresh KYC to re-issue it." };
    }
  }

  return { valid: true };
}

function isEvmAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseCasperPublicKey(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return PublicKey.fromHex(value.trim()).toHex();
  } catch {
    return null;
  }
}

async function findCasperDeployment(assetName: string) {
  const assetId = makeAssetIdCasper(assetName);
  const deployments = await readDeploymentsWithReconciliation() as Record<string, CasperDeployment>;
  const matches = Object.entries(deployments)
    .filter(([, deployment]) => {
    const byAssetId = deployment.assetId === assetId;
    const byName = deployment.assetName?.trim().toLowerCase() === assetName.trim().toLowerCase();
    return byAssetId || byName;
    })
    .map(([deploymentId, deployment]) => ({ deploymentId, ...deployment }));
  // Prefer fully-deployed entries with contractHash over pending/submitted ones
  return matches.find((d) => d.contractHash && d.status === "Deployed")
    ?? matches.find((d) => d.contractHash)
    ?? matches[0];
}

function readInvestorRecords() {
  return readJsonFile<SubscriptionInvestorRecord[]>("subscriptions.json", []);
}

function writeInvestorRecords(records: SubscriptionInvestorRecord[]) {
  const filePath = join(process.cwd(), "data", "subscriptions.json");
  writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");
}

function upsertInvestorRecord(record: SubscriptionInvestorRecord) {
  const all = readInvestorRecords();
  const existingIndex = all.findIndex((item) => item.paymentRef === record.paymentRef);
  if (existingIndex >= 0) {
    all[existingIndex] = { ...all[existingIndex], ...record };
  } else {
    all.unshift(record);
  }
  writeInvestorRecords(all.slice(0, 2000));
}

function findInvestorRecord(paymentRef: string) {
  return readInvestorRecords().find((item) => item.paymentRef === paymentRef) ?? null;
}

function readJsonFile<T>(fileName: string, fallback: T): T {
  try {
    const filePath = join(process.cwd(), "data", fileName);
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function sameAssetName(left: string | undefined, right: string) {
  return left?.trim().toLowerCase() === right.trim().toLowerCase();
}

function parseUsdCents(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(/[$,]/g, "");
  const match = text.match(/^(\d+)(?:\.(\d{0,2}))?$/);
  if (!match) return null;
  const dollars = BigInt(match[1]);
  const cents = BigInt((match[2] ?? "").padEnd(2, "0"));
  return dollars * 100n + cents;
}

function findUnitPriceCents(assetName: string): bigint {
  const sfcRecords = readJsonFile<SfcAssetRecord[]>("sfc-inbox.json", []);
  const sfcRecord = sfcRecords.find((record) => record.status === "Approved" && sameAssetName(record.asset, assetName));
  const sfcPrice = parseUsdCents(sfcRecord?.unitPrice);
  if (sfcPrice && sfcPrice > 0n) return sfcPrice;

  const sponsorRecords = readJsonFile<SponsorAssetRecord[]>("sponsor-inbox.json", []);
  const sponsorRecord = sponsorRecords.find((record) => sameAssetName(record.assetName, assetName));
  const sponsorPrice = parseUsdCents(sponsorRecord?.unitPrice);
  if (sponsorPrice && sponsorPrice > 0n) return sponsorPrice;

  return 100_000n; // Fallback: USD 1,000 per token, matching the demo default.
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function expectedPaymentMotes(assetName: string, tokenCount: number): bigint {
  const principalCents = BigInt(tokenCount) * findUnitPriceCents(assetName);
  const totalDueCents = ceilDiv(principalCents * (10_000n + SUBSCRIPTION_FEE_BPS), 10_000n);
  const quotedMotes = ceilDiv(totalDueCents * MOTES_PER_CSPR, USD_CENTS_PER_DEMO_CSPR);
  return quotedMotes > MIN_CSPR_TRANSFER_MOTES ? quotedMotes : MIN_CSPR_TRANSFER_MOTES;
}

function refToTransferId(refNum?: string) {
  const source = refNum?.trim();
  if (!source) return undefined;

  let hash = 2166136261;
  for (const char of source) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function getTreasuryPublicKey() {
  const key = process.env.CASPER_TREASURY_PUBLIC_KEY
    ?? process.env.NEXT_PUBLIC_CASPER_TREASURY_PUBLIC_KEY
    ?? process.env.CASPER_ORACLE_PUBLIC_KEY
    ?? "";
  if (!key.trim()) {
    throw new Error("CASPER_TREASURY_PUBLIC_KEY is not configured");
  }
  return key.trim();
}

async function waitForCasperPaymentFinality(input: {
  transactionHash: string;
  expectedSenderPublicKey: string;
  expectedRecipientPublicKey?: string;
  expectedMinimumMotes: string;
  expectedTransferId?: number;
}) {
  const waitMs = Number(process.env.CASPER_SUBSCRIBE_PAYMENT_FINALITY_WAIT_MS ?? DEFAULT_PAYMENT_FINALITY_WAIT_MS);
  const pollMs = Number(process.env.CASPER_SUBSCRIBE_PAYMENT_FINALITY_POLL_MS ?? DEFAULT_PAYMENT_FINALITY_POLL_MS);
  const deadline = Date.now() + Math.max(0, Number.isFinite(waitMs) ? waitMs : DEFAULT_PAYMENT_FINALITY_WAIT_MS);
  const interval = Math.max(500, Number.isFinite(pollMs) ? pollMs : DEFAULT_PAYMENT_FINALITY_POLL_MS);

  let latest = await verifyCasperNativeTransfer(input);
  while (!latest.ok && latest.status === "Pending" && Date.now() < deadline) {
    await sleep(interval);
    latest = await verifyCasperNativeTransfer(input);
  }
  return latest;
}

async function waitForCasperPaymentFinalityInBackground(input: {
  transactionHash: string;
  expectedSenderPublicKey: string;
  expectedRecipientPublicKey?: string;
  expectedMinimumMotes: string;
  expectedTransferId?: number;
}) {
  const waitMs = Number(process.env.CASPER_SUBSCRIBE_BACKGROUND_FINALITY_WAIT_MS ?? DEFAULT_BACKGROUND_FINALITY_WAIT_MS);
  const pollMs = Number(process.env.CASPER_SUBSCRIBE_BACKGROUND_FINALITY_POLL_MS ?? DEFAULT_BACKGROUND_FINALITY_POLL_MS);
  const deadline = Date.now() + Math.max(0, Number.isFinite(waitMs) ? waitMs : DEFAULT_BACKGROUND_FINALITY_WAIT_MS);
  const interval = Math.max(1_000, Number.isFinite(pollMs) ? pollMs : DEFAULT_BACKGROUND_FINALITY_POLL_MS);

  let latest = await verifyCasperNativeTransfer(input);
  while (!latest.ok && latest.status === "Pending" && Date.now() < deadline) {
    await sleep(interval);
    latest = await verifyCasperNativeTransfer(input);
  }
  return latest;
}

async function processPendingCasperSubscription(input: {
  paymentRef: string;
  paymentTxHash: string;
  casperPublicKey: string;
  assetName: string;
  assetId: string;
  tokenCount: number;
  deploymentId?: string;
  contractHash: string;
  refNum: string;
  kycWalletAddress: string;
  expectedPaymentMotes: string;
  expectedTransferId?: number;
  matchedKycRecord?: KycRecord | null;
}) {
  try {
    const paymentVerification = await waitForCasperPaymentFinalityInBackground({
      transactionHash: input.paymentTxHash,
      expectedSenderPublicKey: input.casperPublicKey,
      expectedRecipientPublicKey: getTreasuryPublicKey(),
      expectedMinimumMotes: input.expectedPaymentMotes,
      expectedTransferId: input.expectedTransferId,
    });

    if (!paymentVerification.ok) {
      upsertInvestorRecord({
        assetId: input.assetId,
        assetName: input.assetName,
        deploymentId: input.deploymentId,
        contractHash: input.contractHash,
        investorPublicKey: input.casperPublicKey,
        tokenCount: input.tokenCount,
        refNum: input.refNum,
        paymentRef: input.paymentRef,
        paymentTxHash: input.paymentTxHash,
        mintTxHash: "",
        paymentStatus: paymentVerification.status,
        mintStatus: "PendingFinality",
        pendingReason: paymentVerification.reason ?? "Waiting for Casper payment finality.",
        error: paymentVerification.status === "Failed" ? (paymentVerification.reason ?? "Payment verification failed") : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const mintResult = await mintCasperTokenCoupon({
      contractHash: input.contractHash,
      investorPublicKey: input.casperPublicKey,
      amount: String(input.tokenCount),
      paymentRef: input.paymentRef,
    });

    upsertInvestorRecord({
      assetId: input.assetId,
      assetName: input.assetName,
      deploymentId: input.deploymentId,
      contractHash: input.contractHash,
      investorPublicKey: input.casperPublicKey,
      tokenCount: input.tokenCount,
      refNum: input.refNum,
      paymentRef: input.paymentRef,
      paymentTxHash: input.paymentTxHash,
      mintTxHash: mintResult.deployHash,
      paymentStatus: paymentVerification.status,
      mintStatus: mintResult.status,
      pendingReason: mintResult.pendingReason ?? null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (input.matchedKycRecord?.nullifierHash) {
      recordNullifierUsage({
        nullifierHash: input.matchedKycRecord.nullifierHash,
        walletAddress: input.kycWalletAddress,
        assetName: input.assetName,
        usedAt: new Date().toISOString(),
        credentialVerifiedAt: input.matchedKycRecord.zkVerifiedAt ?? null,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Background payment confirmation failed";
    upsertInvestorRecord({
      assetId: input.assetId,
      assetName: input.assetName,
      deploymentId: input.deploymentId,
      contractHash: input.contractHash,
      investorPublicKey: input.casperPublicKey,
      tokenCount: input.tokenCount,
      refNum: input.refNum,
      paymentRef: input.paymentRef,
      paymentTxHash: input.paymentTxHash,
      mintTxHash: "",
      paymentStatus: "Failed",
      mintStatus: "Failed",
      pendingReason: null,
      error: message,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function GET(req: NextRequest) {
  const paymentRef = req.nextUrl.searchParams.get("paymentRef")?.trim();
  if (!paymentRef) {
    return NextResponse.json({ error: "paymentRef is required" }, { status: 400 });
  }

  const cleanverseResult = await refreshCleanverseSubscription(paymentRef);
  if (cleanverseResult) {
    return NextResponse.json(cleanverseResult.body, { status: cleanverseResult.status });
  }

  const record = findInvestorRecord(paymentRef);
  if (!record) {
    return NextResponse.json({ found: false, status: "Pending", message: "Subscription request accepted; waiting for record initialization." }, { status: 202 });
  }

  const mintStatus = String(record.mintStatus ?? "PendingFinality");
  const normalizedMint = mintStatus.toLowerCase();
  const isDone = normalizedMint === "minted" || normalizedMint === "submitted";
  const isFailed = normalizedMint.includes("fail") || record.paymentStatus === "Failed";
  const paymentStatus = record.paymentStatus ?? (isDone ? "Confirmed" : isFailed ? "Failed" : "Pending");

  return NextResponse.json({
    found: true,
    paymentRef,
    paymentTxHash: record.paymentTxHash,
    mintTxHash: record.mintTxHash || null,
    paymentStatus,
    mintStatus: record.mintStatus ?? null,
    done: isDone,
    failed: isFailed,
    pendingReason: record.pendingReason ?? null,
    error: record.error ?? null,
    message: isDone
      ? "Payment confirmed and token credit recorded."
      : isFailed
        ? (record.error ?? "Payment confirmation or minting failed.")
        : (record.pendingReason ?? "Waiting for Casper payment finality and token credit."),
  });
}

// POST /api/subscribe
// Body: { walletAddress, casperPublicKey?, tokenCount, assetName?, refNum?, paymentTxHash? }
// EVM path is kept for legacy Mantle demos; Casper path credits TokenCoupon after native CSPR payment.
function requiresCleanverseSubscription(): boolean {
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawWalletAddress = body.walletAddress;
    const casperPublicKey = parseCasperPublicKey(body.casperPublicKey) ?? parseCasperPublicKey(rawWalletAddress);
    const tokenCount: number = Number(body.tokenCount ?? 20);
    const assetName: string = body.assetName ?? "Harbour Infrastructure Bond Token";
    const refNum: string = body.refNum ?? (buildRefPrefix(assetName) + Date.now().toString(36).toUpperCase().slice(-8));
    const paymentTxHash: string | undefined = typeof body.paymentTxHash === "string" ? body.paymentTxHash.trim() : undefined;

    if (tokenCount < 20 || tokenCount > 100_000) {
      return NextResponse.json({ error: "tokenCount must be 20–100,000" }, { status: 400 });
    }

    const cleanverseIssuanceId = typeof body.issuanceId === "string" ? body.issuanceId.trim() : "";
    if (!cleanverseIssuanceId && requiresCleanverseSubscription()) {
      return NextResponse.json(
        { error: "issuanceId is required for Cleanverse A-Pass verification" },
        { status: 400 },
      );
    }
    if (cleanverseIssuanceId) {
      const cleanverseResult = await handleCleanverseSubscription({
        issuanceId: cleanverseIssuanceId,
        walletAddress: rawWalletAddress,
        assetName,
        tokenCount,
        refNum,
        paymentRef: typeof body.paymentRef === "string" ? body.paymentRef.trim() : undefined,
        paymentTxHash,
      });
      return NextResponse.json(cleanverseResult.body, { status: cleanverseResult.status });
    }

    if (casperPublicKey) {
      if (!paymentTxHash?.trim()) {
        return NextResponse.json({ error: "paymentTxHash is required before minting Casper RWA token credit" }, { status: 400 });
      }

      const kycCandidates = [
        casperPublicKey,
        parseCasperPublicKey(rawWalletAddress),
        typeof rawWalletAddress === "string" ? rawWalletAddress.trim() : null,
      ].filter((value): value is string => Boolean(value && value.trim()));

      const kycWalletAddress = kycCandidates[0] ?? casperPublicKey;
      const skipLocalKyc = process.env.CASPER_SUBSCRIBE_SKIP_LOCAL_KYC === "true";
      const matchedKycRecord = kycCandidates
        .map((candidate) => findApprovedKycRecord(candidate))
        .find((record): record is KycRecord => record !== null) ?? null;
      const kycApproved = matchedKycRecord !== null || skipLocalKyc;
      if (!kycApproved) {
        return NextResponse.json({
          eligible: false,
          onChain: false,
          txHash: null,
          refNum,
          message: "Investor is not eligible: KYC not verified or compliance score below 70. Complete KYC first.",
        }, { status: 422 });
      }

      // Re-verify the investor's persisted ZK compliance proof at the moment of purchase
      // (not just its approval flag), and reject reuse of an already-consumed credential.
      if (matchedKycRecord && !skipLocalKyc) {
        const proofCheck = await verifyKycProofForSubscription(matchedKycRecord);
        if (!proofCheck.valid) {
          return NextResponse.json({
            eligible: false,
            onChain: false,
            txHash: null,
            refNum,
            message: `Compliance credential rejected: ${proofCheck.reason ?? "proof verification failed"}. Refresh KYC to re-issue a valid credential.`,
          }, { status: 422 });
        }
      }

      const deployment = await findCasperDeployment(assetName);
      if (!deployment) {
        return NextResponse.json({
          eligible: true,
          onChain: false,
          txHash: null,
          paymentTxHash,
          assetId: makeAssetIdCasper(assetName),
          assetName,
          tokenCount,
          walletAddress: kycWalletAddress,
          casperPublicKey,
          refNum,
          message: "Payment submitted, but TokenCoupon deployment was not found for this asset. Deploy/register it from /tokenize first.",
        }, { status: 409 });
      }

      const deploymentStatus = deployment.status?.toLowerCase() ?? "";
      const deploymentFailed =
        deploymentStatus.includes("failed")
        || deploymentStatus.includes("error")
        || deploymentStatus.includes("rejected")
        || deploymentStatus.includes("invalid");
      if (deploymentFailed) {
        return NextResponse.json({
          eligible: true,
          onChain: false,
          txHash: null,
          paymentTxHash,
          paymentStatus: "Rejected",
          assetId: deployment.assetId ?? makeAssetIdCasper(assetName),
          assetName,
          tokenCount,
          walletAddress: kycWalletAddress,
          casperPublicKey,
          refNum,
          deployHash: deployment.deployHash,
          explorerUrl: deployment.explorerUrl,
          message: "TokenCoupon deployment is in failed state. Re-run tokenize deployment after fixing install args.",
        }, { status: 409 });
      }

      if (!deployment.contractHash) {
        return NextResponse.json({
          eligible: true,
          onChain: false,
          txHash: null,
          paymentTxHash,
          paymentStatus: "Pending",
          assetId: deployment.assetId ?? makeAssetIdCasper(assetName),
          assetName,
          tokenCount,
          walletAddress: kycWalletAddress,
          casperPublicKey,
          refNum,
          deployHash: deployment.deployHash,
          explorerUrl: deployment.explorerUrl,
          message: "TokenCoupon deployment exists but contract hash is not finalized yet. Wait for Casper deploy finality, then retry token credit.",
        }, { status: 202 });
      }

      const expectedMotes = expectedPaymentMotes(assetName, tokenCount);
      const paymentRef = `${refNum}:${paymentTxHash}`;
      upsertInvestorRecord({
        assetId: deployment.assetId ?? makeAssetIdCasper(assetName),
        assetName,
        deploymentId: deployment.deploymentId,
        contractHash: deployment.contractHash,
        investorPublicKey: casperPublicKey,
        tokenCount,
        refNum,
        paymentRef,
        paymentTxHash,
        mintTxHash: "",
        paymentStatus: "Pending",
        mintStatus: "PendingFinality",
        pendingReason: "Background confirmation in progress.",
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Fire-and-forget background finality + mint workflow. Best-effort in runtime environments
      // that may reclaim workers; status polling can safely retrigger via future API extensions.
      void processPendingCasperSubscription({
        paymentRef,
        paymentTxHash,
        casperPublicKey,
        assetName,
        assetId: deployment.assetId ?? makeAssetIdCasper(assetName),
        tokenCount,
        deploymentId: deployment.deploymentId,
        contractHash: deployment.contractHash,
        refNum,
        kycWalletAddress,
        expectedPaymentMotes: expectedMotes.toString(),
        expectedTransferId: refToTransferId(refNum),
        matchedKycRecord,
      });

      return NextResponse.json({
        eligible: true,
        onChain: false,
        txHash: null,
        mintTxHash: null,
        paymentTxHash,
        paymentRef,
        paymentStatus: "Pending",
        expectedPaymentMotes: expectedMotes.toString(),
        contractHash: deployment.contractHash,
        assetId: deployment.assetId ?? makeAssetIdCasper(assetName),
        assetName,
        tokenCount,
        walletAddress: kycWalletAddress,
        casperPublicKey,
        refNum,
        status: "PendingFinality",
        pendingReason: "Background confirmation in progress.",
        message: "CSPR payment accepted. Casper finality check and token credit now run asynchronously in the background.",
      }, { status: 202 });
    }

    const walletAddress: `0x${string}` = rawWalletAddress;
    if (!isEvmAddress(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    const assetId: `0x${string}` = keccak256(
      encodeAbiParameters(parseAbiParameters("string"), [assetName])
    );

    const moduleAddr = moduleAddress();
    const tokenAddr = tokenAddress();
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    const isConfigured =
      privateKey &&
      moduleAddr !== "0x0000000000000000000000000000000000000000" &&
      tokenAddr !== "0x0000000000000000000000000000000000000000";

    // ── 1. Compliance eligibility check ──────────────────────────────────────
    let eligible = false;
    let onChainEligible = false;

    if (isConfigured) {
      try {
        onChainEligible = await publicClient.readContract({
          address: moduleAddr,
          abi: COMPLIANCE_MODULE_ABI,
          functionName: "canMint",
          args: [walletAddress, assetId],
        }) as boolean;
        eligible = onChainEligible;
      } catch { /* canMint read failed */ }

      // Fallback: KYC approved locally but not yet on-chain (e.g. legacy records)
      if (!onChainEligible) {
        eligible = isKycApprovedLocally(walletAddress);
        // Keep onChainEligible false: local KYC alone cannot bypass on-chain asset approval.
        onChainEligible = false;
      }
    } else {
      eligible = isKycApprovedLocally(walletAddress);
      onChainEligible = false;
    }

    if (!eligible) {
      return NextResponse.json({
        eligible: false,
        onChain: false,
        txHash: null,
        assetId,
        refNum,
        message: "Investor is not eligible: KYC not verified or compliance score below 70. Complete KYC first.",
      }, { status: 422 });
    }

    // ── 2. Ethereum mint path ─────────────────────────────────────────────────
    let txHash: string | null = null;
    let onChain = false;

    if (isConfigured && onChainEligible) {
      const walletClient = getWalletClient();
      const amount = BigInt(tokenCount) * BigInt(10 ** 18);

      const gasPrice = await publicClient.getGasPrice();
      const safeGasPrice = gasPrice * 2n;

      const assetInfo = await publicClient.readContract({
        address: tokenAddr,
        abi: HARBOUR_RWA_TOKEN_ABI,
        functionName: "assets",
        args: [assetId],
      }) as readonly [boolean, number, string, bigint, bigint, `0x${string}`];

      if (!assetInfo[0]) {
        const nameLower = assetName.toLowerCase();
        const assetTypeNum = nameLower.includes("reit") ? 0
          : nameLower.includes("green") ? 1
          : nameLower.includes("trade") || nameLower.includes("receivable") ? 2
          : 3;

        const couponBps = 550n;
        const maturityDate = BigInt(Math.floor(new Date("2031-07-15T00:00:00Z").getTime() / 1000));
        const prospectusHash = keccak256(
          encodeAbiParameters(parseAbiParameters("string"), [assetName])
        );

        const regTxHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: HARBOUR_RWA_TOKEN_ABI,
          functionName: "registerAsset",
          args: [assetId, assetTypeNum, assetName, maturityDate, couponBps, prospectusHash],
          maxFeePerGas: safeGasPrice,
          maxPriorityFeePerGas: safeGasPrice,
        });
        await publicClient.waitForTransactionReceipt({ hash: regTxHash });
      }

      txHash = await walletClient.writeContract({
        address: tokenAddr,
        abi: HARBOUR_RWA_TOKEN_ABI,
        functionName: "mintForAsset",
        args: [walletAddress, amount, assetId],
        maxFeePerGas: safeGasPrice,
        maxPriorityFeePerGas: safeGasPrice,
      });
      onChain = true;
    }

    return NextResponse.json({
      eligible: true,
      onChain,
      txHash,
      assetId,
      assetName,
      tokenCount,
      walletAddress,
      refNum,
      explorerUrl: txHash
        ? `https://sepolia.etherscan.io/tx/${txHash}`
        : null,
      message: onChain
        ? `${tokenCount} tokens of ${assetName} minted on Ethereum Sepolia. Settlement: T+2.`
        : `Eligibility confirmed (contracts not yet deployed — deploy first). Reference: ${refNum}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
