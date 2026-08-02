import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const assetDeploymentId = searchParams.get("assetDeploymentId")?.trim() || "";
  const identityRegistryHash = process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS?.trim() || "";
  const chainName = process.env.NEXT_PUBLIC_CHAIN_ID === "5000" ? "mantle" : "mantle-sepolia";

  if (!identityRegistryHash) {
    return NextResponse.json({
      identityRegistryConfigured: false,
      chainName,
      error: assetDeploymentId
        ? `Ethereum IdentityRegistry is not configured for asset ${assetDeploymentId}. Set NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS.`
        : "Set NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS before approving KYC on-chain.",
    });
  }

  if (!ADDRESS_REGEX.test(identityRegistryHash)) {
    return NextResponse.json({
      identityRegistryConfigured: false,
      chainName,
      error: assetDeploymentId
        ? `IdentityRegistry address for asset ${assetDeploymentId} is invalid. Expected an Ethereum 0x address.`
        : "NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS is invalid.",
    });
  }

  return NextResponse.json({
    identityRegistryConfigured: true,
    chainName,
    identityRegistryHash,
    assetDeploymentId,
  });
}