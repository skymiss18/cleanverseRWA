import { NextResponse } from "next/server";
import { CasperContractDeploymentRecord, CasperDeploymentRecord, readDeploymentsWithReconciliation, writeDeployments } from "@/lib/casper-deployments";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readDeploymentsWithReconciliation(), {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json() as { id: string; deployment?: Record<string, unknown>; identityRegistry?: Record<string, unknown> };
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const deployments = await readDeploymentsWithReconciliation();
  const existing = (deployments[body.id] as Record<string, unknown> | undefined) ?? {};
  const nextIdentityRegistry = body.identityRegistry as CasperContractDeploymentRecord | undefined;
  if (body.deployment) {
    const mergedIdentityRegistry = nextIdentityRegistry ?? existing.identityRegistry as CasperContractDeploymentRecord | undefined;
    deployments[body.id] = {
      ...existing,
      ...body.deployment,
      ...(mergedIdentityRegistry ? { identityRegistry: mergedIdentityRegistry } : {}),
    } as CasperDeploymentRecord;
  } else if (body.identityRegistry) {
    deployments[body.id] = {
      ...existing,
      ...(nextIdentityRegistry ? { identityRegistry: nextIdentityRegistry } : {}),
    } as CasperDeploymentRecord;
  } else {
    return NextResponse.json({ error: "deployment or identityRegistry is required" }, { status: 400 });
  }
  writeDeployments(deployments);
  return NextResponse.json({ ok: true });
}
