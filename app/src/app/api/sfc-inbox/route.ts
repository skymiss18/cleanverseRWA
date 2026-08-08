import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const DATA_FILE = path.join(process.cwd(), "data", "sfc-inbox.json");

function readSubmissions() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw) as object[];
  } catch {
    return [];
  }
}

function writeSubmissions(data: object[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const submissions = readSubmissions();
  return NextResponse.json({ submissions });
}

export async function POST(req: Request) {
  const body = await req.json();
  const submissions = readSubmissions();
  const entry = {
    id: `ISS-DYN-${Date.now()}`,
    status: "Pending SFC Review",
    submittedAt: new Date().toISOString(),
    asset: body.asset || "",
    type: body.type || "Bond",
    issuer: body.issuer || "",
    submitted: body.submitted || new Date().toISOString().slice(0, 10),
    complianceScore: body.complianceScore || 0,
    auditHash: body.auditHash || "",
    totalIssuance: body.totalIssuance || "0",
    unitPrice: body.unitPrice || "1",
    currency: body.currency || "USD",
    prospectusExcerpt: body.prospectusExcerpt || "",
    sponsorLicence: body.sponsorLicence || "Type 6 LC",
  };
  submissions.push(entry);
  writeSubmissions(submissions);
  return NextResponse.json({ success: true, id: entry.id });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  const submissions = readSubmissions();
  const updated = submissions.filter((s: object) => (s as { id: string }).id !== id);
  writeSubmissions(updated);
  return NextResponse.json({ success: true });
}
