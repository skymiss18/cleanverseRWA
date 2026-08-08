import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const STATE_FILE = path.resolve(process.cwd(), "data/agent-scheduler-state.json");

/** Read-only view of the last autonomous cron-run summary, for the admin UI.
 *  Does NOT trigger a scan itself — only /api/agent/kyc/cron-run does that. */
export async function GET() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return NextResponse.json({ state: null });
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return NextResponse.json({ state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read scheduler state" },
      { status: 500 },
    );
  }
}
