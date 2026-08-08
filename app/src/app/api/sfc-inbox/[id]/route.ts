import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const DATA_FILE = path.join(process.cwd(), "data", "sfc-inbox.json");

function readSubmissions(): Record<string, unknown>[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function writeSubmissions(data: Record<string, unknown>[]) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function randomTx(): string {
  const bytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
  return "0x" + bytes;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as {
    action: "approve" | "requestChanges";
    notes?: string;
    application?: Record<string, unknown>;
  };
  const submissions = readSubmissions();
  let idx = submissions.findIndex((s) => s.id === id);

  // Upsert: if preset record not yet in file, create it from the passed application data
  if (idx === -1) {
    if (!body.application) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    submissions.push({ ...body.application, id });
    idx = submissions.length - 1;
  }

  if (body.action === "approve") {
    const tx = randomTx();
    const today = new Date().toISOString().slice(0, 10);
    submissions[idx] = {
      ...submissions[idx],
      status: "Approved",
      approvedTx: tx,
      approvedAt: today,
      approvedBy: "Ms. Wong Mei-Ling, SFC Senior Director",
      sfcRef: `SFC/RWA/2026/${id}`,
    };
  } else if (body.action === "requestChanges") {
    submissions[idx] = {
      ...submissions[idx],
      status: "Changes Required",
      notes: body.notes ?? "",
    };
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  writeSubmissions(submissions);
  return NextResponse.json({ success: true, submission: submissions[idx] });
}
