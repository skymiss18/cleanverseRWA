#!/usr/bin/env node
/**
 * Local demo scheduler for autonomous KYC/AML continuous monitoring.
 *
 * Polls the local Next.js dev server's /api/agent/kyc/cron-run endpoint on a
 * fixed interval, WITHOUT any human clicking a button — this is the same
 * core logic (runAutoExecute) that Vercel Cron calls in production, just
 * driven by a local setInterval loop for recording a demo video.
 *
 * Usage: npm run agent:scheduler
 * Env:   AGENT_SCHEDULER_URL (default http://localhost:3000/api/agent/kyc/cron-run)
 *        AGENT_SCHEDULER_INTERVAL_MS (default 30000)
 *        CRON_SECRET (optional, sent as Authorization: Bearer <secret>)
 */

const url = process.env.AGENT_SCHEDULER_URL || "http://localhost:3000/api/agent/kyc/cron-run";
const intervalMs = Number(process.env.AGENT_SCHEDULER_INTERVAL_MS || "30000");
const secret = process.env.CRON_SECRET;

async function runOnce() {
  const startedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
    });
    const body = await res.json();
    console.log(
      `[agent-scheduler] ${startedAt} status=${res.status} scanned=${body.scanned ?? "-"} executed=${body.executed ?? "-"} blocked=${body.blocked ?? "-"} skipped=${body.skipped ?? "-"} errors=${body.errors ?? "-"}`,
    );
  } catch (err) {
    console.error(`[agent-scheduler] ${startedAt} request failed:`, err instanceof Error ? err.message : err);
  }
}

console.log(`[agent-scheduler] starting — polling ${url} every ${intervalMs}ms (no manual clicks required)`);
runOnce();
setInterval(runOnce, intervalMs);
