import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";
import { publicClient, getWalletClient, COMPLIANCE_ORACLE_ABI, oracleAddress, targetExplorerUrl } from "./chain";

export function makeReportHash(reportJson: string): `0x${string}` {
  return keccak256(toHex(reportJson));
}

export function makeAssetId(assetName: string): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("string"), [assetName])
  );
}

// ── Unified write: submit compliance score ─────────────────────────────────────

/**
 * Submit an AI compliance score on-chain.
 * @returns object with txHash and optional explorerUrl
 */
export async function submitScoreOnChain(
  assetId: `0x${string}`,
  score: number,
  reportJson: string,
  _assetName?: string
): Promise<{ txHash: string; explorerUrl?: string }> {
  const reportHash = makeReportHash(reportJson);
  const walletClient = getWalletClient();
  const txHash = await walletClient.writeContract({
    address: oracleAddress(),
    abi: COMPLIANCE_ORACLE_ABI,
    functionName: "submitScore",
    args: [assetId, Math.round(score), reportHash],
  });
  return { txHash, explorerUrl: `${targetExplorerUrl}/tx/${txHash}` };
}

// ── Unified read: get compliance score ────────────────────────────────────────

export async function getScoreFromChain(assetId: `0x${string}`, _assetName?: string) {
  const data = await publicClient.readContract({
    address: oracleAddress(),
    abi: COMPLIANCE_ORACLE_ABI,
    functionName: "getScore",
    args: [assetId],
  });
  return { score: data[0], updatedAt: data[1], reportHash: data[2] };
}
