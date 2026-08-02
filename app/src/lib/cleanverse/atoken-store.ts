import fs from "node:fs";
import path from "node:path";

import type { ATokenApplicationRecord } from "./types";

function storePath() {
  return process.env.CLEANVERSE_ATOKEN_STORE_PATH?.trim()
    || path.join(process.cwd(), "data", "cleanverse-atoken-applications.json");
}

export function readATokenApplications(): ATokenApplicationRecord[] {
  try {
    const file = storePath();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, "utf8")) as ATokenApplicationRecord[];
  } catch {
    return [];
  }
}

export function findATokenApplicationByRequestId(requestId: string) {
  return readATokenApplications().find((record) => record.requestId === requestId) ?? null;
}

export function findLatestATokenApplicationForIssuance(issuanceId: string) {
  return readATokenApplications().find((record) => record.issuanceId === issuanceId) ?? null;
}

export function upsertATokenApplication(record: ATokenApplicationRecord) {
  const records = readATokenApplications();
  const index = records.findIndex((item) => item.requestId === record.requestId);
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.unshift(record);

  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records.slice(0, 2_000), null, 2), "utf8");
  return record;
}