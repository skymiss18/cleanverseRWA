import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import test, { after, before } from "node:test";
import { NextRequest } from "next/server";
import { POST as analyzeKyc } from "../src/app/api/agent/kyc/analyze/route";
import { POST as monitorKyc } from "../src/app/api/agent/kyc/monitor/route";
import { POST as autoExecuteKyc } from "../src/app/api/agent/kyc/auto-execute/route";

type KycRecord = Record<string, unknown>;

const dataPath = path.resolve(process.cwd(), "data", "kyc-inbox.json");
let originalData: string | null = null;
const savedEnv: Record<string, string | undefined> = {};

function makeRequest(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readKycData(): KycRecord[] {
  const raw = fs.readFileSync(dataPath, "utf8");
  return JSON.parse(raw) as KycRecord[];
}

function setEnv(key: string, value: string) {
  if (!(key in savedEnv)) {
    savedEnv[key] = process.env[key];
  }
  process.env[key] = value;
}

before(() => {
  if (fs.existsSync(dataPath)) {
    originalData = fs.readFileSync(dataPath, "utf8");
  }

  const fixture: KycRecord[] = [
    {
      id: "KYC-E2E-001",
      submittedAt: new Date().toISOString(),
      fullName: "E2E Candidate",
      email: "e2e@example.com",
      jurisdiction: "HK",
      investorType: "individual",
      walletAddress: "02031282d32bbacc75eb84179aef5ce519364b5a0bf7701781437f558c793661597d",
      pepDeclaration: false,
      status: "ai_scored",
      aiScore: 85,
      kycExpiry: Math.floor(Date.now() / 1000) + 86400,
      credentialCommitment: "legacy-commitment",
      nullifierHash: "legacy-nullifier",
      proofHash: "legacy-proof",
      monitoringStatus: "pending",
    },
  ];

  fs.writeFileSync(dataPath, JSON.stringify(fixture, null, 2), "utf8");

  setEnv("ZK_PROVIDER_MODE", "zk-ready-hash");
  setEnv("AGENT_AUTO_EXECUTE_ENABLED", "true");
  setEnv("AGENT_AUTO_EXECUTE_DRY_RUN", "true");
  setEnv("AGENT_AUTO_EXECUTE_KILL_SWITCH", "false");
  setEnv("AGENT_AUTO_EXECUTE_REQUIRE_PROOF_VERIFIED", "true");
  setEnv("AGENT_AUTO_EXECUTE_MIN_AI_SCORE_UPDATE", "70");
  setEnv("AGENT_AUTO_EXECUTE_MAX_RISK_BAND_UPDATE", "2");
  setEnv("AGENT_AUTO_EXECUTE_ID_ALLOWLIST", "kyc-e2e-001");
  setEnv("AGENT_AUTO_EXECUTE_WALLET_ALLOWLIST", "02031282d32bbacc75eb84179aef5ce519364b5a0bf7701781437f558c793661597d");
});

after(() => {
  if (originalData !== null) {
    fs.writeFileSync(dataPath, originalData, "utf8");
  }

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("analyze -> monitor -> auto-execute updates KYC chain state in dry-run mode", async () => {
  const analyzeRes = await analyzeKyc(makeRequest("http://localhost/api/agent/kyc/analyze", { id: "KYC-E2E-001" }));
  assert.equal(analyzeRes.status, 200);
  const analyzeBody = await analyzeRes.json() as {
    recommendation: { action: string; proofVerified: boolean };
  };
  assert.equal(analyzeBody.recommendation.action, "update");
  assert.equal(analyzeBody.recommendation.proofVerified, true);

  const monitorRes = await monitorKyc();
  assert.equal(monitorRes.status, 200);
  const monitorBody = await monitorRes.json() as {
    queue: Array<{ id: string; action: string; autoExecutable: boolean }>;
  };
  const queueItem = monitorBody.queue.find((item) => item.id === "KYC-E2E-001");
  assert.ok(queueItem);
  assert.equal(queueItem?.action, "update");
  assert.equal(queueItem?.autoExecutable, true);

  const autoRes = await autoExecuteKyc(
    makeRequest("http://localhost/api/agent/kyc/auto-execute", {
      id: "KYC-E2E-001",
      action: "update",
    }),
  );
  assert.equal(autoRes.status, 200);
  const autoBody = await autoRes.json() as {
    dryRun: boolean;
    status: string;
    deployHash: string;
  };
  assert.equal(autoBody.dryRun, true);
  assert.equal(autoBody.status, "DryRun");
  assert.match(autoBody.deployHash, /^dryrun-/i);

  const updated = readKycData().find((item) => item.id === "KYC-E2E-001");
  assert.ok(updated);
  assert.equal(updated?.monitoringStatus, "update_dry_run");
  assert.equal(updated?.executionMode, "auto");
  assert.equal(updated?.chainStatus, "DryRun");
  assert.equal(updated?.status, "approved");
  assert.equal(updated?.proofVerified, true);
});
