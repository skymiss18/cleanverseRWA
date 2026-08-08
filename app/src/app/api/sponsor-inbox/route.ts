import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const DATA_FILE = path.join(process.cwd(), "data", "sponsor-inbox.json");

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
    id: `ISS-${Date.now()}`,
    receivedAt: new Date().toISOString(),
    reference: body.reference || `REF-${Date.now()}`,
    issuer: body.issuer || "Harbour Capital Markets Corporation Limited",
    assetName: body.assetName || "",
    assetType: body.assetType || "Bond",
    totalSupply: body.totalSupply || "0",
    unitPrice: body.unitPrice || "1",
    description: body.description || "",
    prospectusText: body.prospectusText || "",
    invoiceText: body.invoiceText || "",
    contractText: body.contractText || "",
    submittedAt: body.submittedAt || new Date().toISOString(),
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
