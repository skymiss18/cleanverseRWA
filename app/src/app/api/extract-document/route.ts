import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ── PDF extraction ────────────────────────────────────────────────────────────
async function extractFromPdf(buffer: Buffer): Promise<string> {
  // pdfjs-dist is pure JS — no native dependencies, works in Next.js API routes
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data: uint8, useWorkerFetch: false, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineText = content.items.map((item: any) => item.str ?? "").join(" ");
    pages.push(lineText);
  }
  return pages.join("\n");
}

// ── Image OCR via Qwen VL ─────────────────────────────────────────────────────
async function extractFromImage(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) throw new Error("Vision LLM not configured");

  const client = new OpenAI({ apiKey, baseURL, timeout: 60000, maxRetries: 0 });
  const base64 = buffer.toString("base64");

  const resp = await client.chat.completions.create({
    model: "qwen-vl-max",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: "text",
            text: "Please extract ALL text from this document image. Preserve the original structure and formatting as much as possible (line breaks, table alignment). Output ONLY the extracted text, no commentary.",
          },
        ],
      },
    ],
  });

  return resp.choices[0]?.message?.content ?? "";
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
    }

    const buffer   = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type;
    const fileName = file.name;
    let text = "";

    if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      text = await extractFromPdf(buffer);
    } else if (mimeType.startsWith("image/")) {
      text = await extractFromImage(buffer, mimeType);
    } else if (mimeType === "text/plain" || fileName.toLowerCase().endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else {
      return NextResponse.json(
        { error: `Unsupported file type: ${mimeType || fileName}. Please upload PDF, image (JPG/PNG), or TXT.` },
        { status: 400 }
      );
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "No text could be extracted from the document." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text: trimmed, fileName, charCount: trimmed.length });
  } catch (error) {
    console.error("[extract-document]", error);
    return NextResponse.json(
      { error: "Failed to extract document. Please try a different file." },
      { status: 500 }
    );
  }
}
