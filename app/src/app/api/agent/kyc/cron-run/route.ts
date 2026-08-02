import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { runAutoExecute, listAutoExecuteCandidateIds } from "@/lib/kyc-auto-execute";
import { readAutoExecutePolicy } from "@/lib/agent-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

const STATE_FILE = path.resolve(process.cwd(), "data/agent-scheduler-state.json");

interface SchedulerState {
  lastRunAt: string;
  scanned: number;
  executed: number;
  blocked: number;
  skipped: number;
  errors: number;
  results: Array<{ id: string; outcome: string; status: number }>;
}

function writeState(state: SchedulerState) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // No secret configured — allow (local/demo use only). Production deployments
    // MUST set CRON_SECRET so this endpoint isn't publicly triggerable.
    return true;
  }
  const authHeader = req.headers.get("authorization");
  const provided = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return provided === secret;
}

/** Autonomous continuous-monitoring entry point. Intended to be invoked on a
 *  schedule (Vercel Cron in production, a local polling script for demos) —
 *  no human click required. Scans all open KYC records, re-evaluates each via
 *  the same policy-gated runAutoExecute() core used by the manual endpoint,
 *  and records a summary for the admin UI to display. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const policy = readAutoExecutePolicy();
  if (!policy.enabled) {
    const state: SchedulerState = {
      lastRunAt: new Date().toISOString(),
      scanned: 0,
      executed: 0,
      blocked: 0,
      skipped: 0,
      errors: 0,
      results: [],
    };
    writeState(state);
    return NextResponse.json({ success: true, message: "Auto-execute disabled by policy (AGENT_AUTO_EXECUTE_ENABLED=false)", ...state });
  }

  const ids = listAutoExecuteCandidateIds();
  const results: SchedulerState["results"] = [];
  let executed = 0;
  let blocked = 0;
  let skipped = 0;
  let errors = 0;

  for (const id of ids) {
    try {
      const result = await runAutoExecute({ id, source: "cron" });
      if (result.status === 200) {
        executed += 1;
        results.push({ id, outcome: typeof result.body.action === "string" ? result.body.action : "executed", status: result.status });
      } else if (result.status === 403) {
        blocked += 1;
        results.push({ id, outcome: "blocked_by_policy", status: result.status });
      } else {
        skipped += 1;
        results.push({ id, outcome: "skipped", status: result.status });
      }
    } catch {
      errors += 1;
      results.push({ id, outcome: "error", status: 500 });
    }
  }

  const state: SchedulerState = {
    lastRunAt: new Date().toISOString(),
    scanned: ids.length,
    executed,
    blocked,
    skipped,
    errors,
    results,
  };
  writeState(state);

  return NextResponse.json({ success: true, ...state });
}
