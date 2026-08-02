import { NextRequest, NextResponse } from "next/server";
import { Deploy, PublicKey, Transaction } from "casper-js-sdk";
import { casperExplorerDeployUrl, getCasperRpcClientForUrl, getCasperRpcUrls } from "@/lib/casper-chain";

export const runtime = "nodejs";
export const maxDuration = 60;

function signatureHexToBytes(signatureHex: string, signingPublicKeyHex: string) {
  let hex = signatureHex.trim().replace(/^0x/i, "");
  const signerKey = signingPublicKeyHex.trim().replace(/^0x/i, "");

  if (hex.length === 128 && /^[0-9a-fA-F]{2}/.test(signerKey)) {
    hex = `${signerKey.slice(0, 2)}${hex}`;
  }

  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 130) {
    throw new Error("signatureHex must be a Casper signature hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTransactionJson(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && ("payload" in value || "TransactionV1" in value || "transactionV1" in value);
}

function findHashString(value: unknown): string | undefined {
  if (typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) return value;
  if (!isRecord(value)) return undefined;
  for (const child of Object.values(value)) {
    const found = findHashString(child);
    if (found) return found;
  }
  return undefined;
}

async function putTransactionDirect(transaction: Transaction) {
  const rpcUrls = getCasperRpcUrls();
  let lastError: unknown;

  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "account_put_transaction",
          params: { transaction: { Version1: transaction.toJSON() } },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      const text = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      const data = JSON.parse(text) as {
        result?: { transaction_hash?: unknown; transactionHash?: unknown };
        error?: { code?: number; message?: string; data?: unknown };
      };

      if (data.error) {
        const detail = typeof data.error.data === "string" ? `: ${data.error.data}` : "";
        throw new Error(`Code: ${data.error.code ?? "RPC"}, err: ${data.error.message ?? "Casper RPC error"}${detail}`);
      }

      return findHashString(data.result?.transaction_hash ?? data.result?.transactionHash) || hashToHex(transaction.hash);
    } catch (err) {
      lastError = err;
      console.warn(`[casper-transfer/submit] account_put_transaction failed on ${rpcUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All Casper RPC nodes are unreachable");
}

async function putDeployDirect(deploy: Deploy) {
  const rpcUrls = getCasperRpcUrls();
  let lastError: unknown;

  for (const rpcUrl of rpcUrls) {
    try {
      const rpc = getCasperRpcClientForUrl(rpcUrl);
      const putResult = await rpc.putDeploy(deploy);
      return hashToHex(
        (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deployHash
          ?? (putResult as { deployHash?: unknown; deploy_hash?: unknown }).deploy_hash
          ?? deploy.hash
      );
    } catch (err) {
      lastError = err;
      console.warn(`[casper-transfer/submit] putDeploy failed on ${rpcUrl}: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All Casper RPC nodes are unreachable");
}

export async function POST(req: NextRequest) {
  let earlyHash: string | undefined;
  try {
    const body = await req.json() as {
      deployJson?: unknown;
      signedDeployJson?: unknown;
      signatureHex?: string;
      signingPublicKeyHex?: string;
    };

    const payload = body.signedDeployJson ?? body.deployJson;
    if (!payload) {
      return NextResponse.json({ error: "deployJson is required" }, { status: 400 });
    }

    if (isTransactionJson(payload)) {
      const transaction = Transaction.fromJSON(payload);
      earlyHash = hashToHex(transaction.hash);
      if (!body.signedDeployJson) {
        if (!body.signatureHex || !body.signingPublicKeyHex) {
          return NextResponse.json({ error: "signatureHex and signingPublicKeyHex are required" }, { status: 400 });
        }
        transaction.setSignature(
          signatureHexToBytes(body.signatureHex, body.signingPublicKeyHex),
          PublicKey.fromHex(body.signingPublicKeyHex)
        );
      }

      transaction.validate();
      const transactionHash = await putTransactionDirect(transaction);

      return NextResponse.json({
        status: "Submitted",
        deployHash: transactionHash,
        txHash: transactionHash,
        transactionHash,
        explorerUrl: casperExplorerDeployUrl(transactionHash),
      });
    }

    const deploy = Deploy.fromJSON(payload);
    earlyHash = hashToHex(deploy.hash);
    if (!body.signedDeployJson) {
      if (!body.signatureHex || !body.signingPublicKeyHex) {
        return NextResponse.json({ error: "signatureHex and signingPublicKeyHex are required" }, { status: 400 });
      }
      Deploy.setSignature(
        deploy,
        signatureHexToBytes(body.signatureHex, body.signingPublicKeyHex),
        PublicKey.fromHex(body.signingPublicKeyHex)
      );
    }

    deploy.validate();
    const deployHash = await putDeployDirect(deploy);

    return NextResponse.json({
      status: "Submitted",
      deployHash,
      txHash: deployHash,
      transactionHash: deployHash,
      explorerUrl: casperExplorerDeployUrl(deployHash),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit signed Casper transfer";
    console.error("[casper-transfer/submit] ERROR:", message);
    return NextResponse.json(
      {
        error: message,
        // Deterministic hash computed before broadcasting, so the client can still
        // show/reference a transaction id even if every RPC node rejected the submit.
        deployHash: earlyHash,
        txHash: earlyHash,
        transactionHash: earlyHash,
        explorerUrl: earlyHash ? casperExplorerDeployUrl(earlyHash) : undefined,
        broadcastFailed: true,
      },
      { status: 500 }
    );
  }
}
