import { NextRequest, NextResponse } from "next/server";

// POST /api/kyc/submit
// Deprecated: KYC approval now requires Casper Wallet signing from /admin/kyc.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return NextResponse.json({
      error: "Deprecated endpoint. KYC whitelist approval must be initiated from /admin/kyc with Casper Wallet signing.",
      walletAddress: body.walletAddress ?? null,
    }, { status: 410 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
