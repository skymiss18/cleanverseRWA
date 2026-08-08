import { NextRequest, NextResponse } from "next/server";
import { getComplianceBadgeData } from "@/lib/compliance-badge";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const data = getComplianceBadgeData(assetId);
  return NextResponse.json(data, { status: data.found ? 200 : 404 });
}
