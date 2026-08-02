import { NextRequest, NextResponse } from "next/server";
import { NativeTransferBuilder, PublicKey, Timestamp } from "casper-js-sdk";

export const runtime = "nodejs";

const MIN_TRANSFER_MOTES = 2_500_000_000n;

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

function hashToHex(hash: unknown): string {
  if (!hash) return "";
  if (typeof hash === "string") return hash;
  if (typeof hash === "object" && hash !== null && "toHex" in hash) {
    const maybeHash = hash as { toHex?: () => string };
    if (typeof maybeHash.toHex === "function") return maybeHash.toHex();
  }
  return String(hash);
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

function motesToSafeNumber(motes: string) {
  const value = Number(motes);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Casper payment amount must be a safe positive integer: ${motes}`);
  }
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      senderPublicKeyHex?: string;
      amountMotes?: string;
      refNum?: string;
    };

    const senderPublicKeyHex = body.senderPublicKeyHex?.trim();
    const amountMotes = body.amountMotes?.trim();
    if (!senderPublicKeyHex) {
      return NextResponse.json({ error: "senderPublicKeyHex is required" }, { status: 400 });
    }
    if (!amountMotes || !/^\d+$/.test(amountMotes) || BigInt(amountMotes) <= 0n) {
      return NextResponse.json({ error: "amountMotes must be a positive integer string" }, { status: 400 });
    }
    if (BigInt(amountMotes) < MIN_TRANSFER_MOTES) {
      return NextResponse.json({ error: "amountMotes is below Casper's 2.5 CSPR native transfer minimum" }, { status: 400 });
    }

    const recipientPublicKeyHex = getTreasuryPublicKey();
    const chainName = process.env.CASPER_CHAIN_NAME ?? "casper-test";
    const paymentAmount = process.env.CASPER_TRANSFER_PAYMENT ?? "100000000";
    const transferId = refToTransferId(body.refNum);

    const builder = new NativeTransferBuilder()
      .from(PublicKey.fromHex(senderPublicKeyHex))
      .target(PublicKey.fromHex(recipientPublicKeyHex))
      .amount(amountMotes)
      .chainName(chainName)
      .payment(motesToSafeNumber(paymentAmount))
      // Back-date by 30 s to compensate for local clock being ahead of node clock
      .timestamp(new Timestamp(new Date(Date.now() - 30_000)));

    if (transferId !== undefined) {
      builder.id(transferId);
    }

    const transaction = builder.build();

    return NextResponse.json({
      deployJson: transaction.toJSON(),
      deployHash: hashToHex(transaction.hash),
      transactionHash: hashToHex(transaction.hash),
      transactionKind: "TransactionV1",
      amountMotes,
      transferId,
      recipientPublicKeyHex,
      chainName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build Casper transfer" },
      { status: 500 }
    );
  }
}
