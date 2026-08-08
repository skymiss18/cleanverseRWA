import { NextRequest, NextResponse } from "next/server";

import { queryAPass } from "@/lib/cleanverse/apass";
import { getCleanverseClient } from "@/lib/cleanverse/client";
import { CleanverseBusinessError } from "@/lib/cleanverse/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "A valid Ethereum address is required" }, { status: 400 });
    const chain = process.env.CLEANVERSE_DEFAULT_CHAIN?.trim() || "ethereum";
    const apass = await queryAPass(getCleanverseClient(), { chain, address });
    return NextResponse.json({ apass, active: apass.status === 1 && apass.expirationTime > Math.floor(Date.now() / 1_000) });
  } catch (error) {
    if (error instanceof CleanverseBusinessError
      && /\[CN_001\].*apass not found/i.test(error.message)) {
      return NextResponse.json({ apass: null, active: false });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "A-Pass query failed" }, { status: 502 });
  }
}