import { NextRequest, NextResponse } from "next/server";
import {
  extractInvoiceFields,
  extractContractFields,
  analyzeInvoiceRisk,
  analyzeContractRisk,
  analyzeRWAStructureRisk,
  crossValidate,
  buildMergedContext,
  type RWADetails,
} from "@/lib/trade-docs";
import { analyzeCompliance } from "@/lib/compliance";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      invoiceText   = "",
      contractText  = "",
      assetName     = "Trade Receivable RWA",
      totalSupply   = 1000,
      unitPrice     = 1,
      assetDescription = "",
    } = body as {
      invoiceText?: string;
      contractText?: string;
      assetName?: string;
      totalSupply?: number;
      unitPrice?: number;
      assetDescription?: string;
    };

    if (!invoiceText.trim()) {
      return NextResponse.json({ error: "invoiceText is required" }, { status: 400 });
    }
    if (!contractText.trim()) {
      return NextResponse.json({ error: "contractText is required" }, { status: 400 });
    }

    const rwa: RWADetails = {
      assetName,
      totalSupply: Number(totalSupply) || 1000,
      unitPrice:   Number(unitPrice)   || 1,
      assetDescription,
    };

    // ── Round 1: parallel extraction ─────────────────────────────────────────
    const [extractedInvoice, extractedContract] = await Promise.all([
      extractInvoiceFields(invoiceText).catch(err => {
        console.warn("[trade-receivable] invoice extraction failed:", err);
        return null;
      }),
      extractContractFields(contractText).catch(err => {
        console.warn("[trade-receivable] contract extraction failed:", err);
        return null;
      }),
    ]);

    const inv = extractedInvoice ?? {
      invoiceNo: "",
      buyerName: "",
      sellerName: "",
      buyerTaxId: "",
      sellerTaxId: "",
      amount: 0,
      currency: "",
      dueDate: "",
      invoiceDate: "",
      paymentDays: 0,
      goodsDescription: "",
      taxRate: "",
      hasVagueName: false,
      portOfLoading: "",
      portOfDischarge: "",
      incoterms: "",
    };
    const con = extractedContract ?? {
      contractNo: "",
      buyerName: "",
      sellerName: "",
      buyerTaxId: "",
      sellerTaxId: "",
      contractAmount: 0,
      currency: "",
      signingDate: "",
      expiryDate: "",
      paymentTerms: "",
      paymentDays: 0,
      goodsDescription: "",
      hasAssignmentProhibition: false,
      hasAssignmentPermission: false,
      governingLaw: "",
      disputeResolution: "",
      hasSignature: false,
      hasSeal: false,
      relatedPartyFlags: "",
    };

    // ── Round 2: parallel risk analysis + SFC compliance ─────────────────────
    const mergedText = buildMergedContext(inv, con, rwa);

    const [invoiceRisk, contractRisk, rwaRisk, sfcCompliance] = await Promise.all([
      analyzeInvoiceRisk(invoiceText, inv).catch(() => ({
        riskLevel: "medium" as const,
        issues: [{ severity: "medium" as const, description: "Invoice risk analysis unavailable" }],
        compliantAspects: [],
        recommendations: ["Manual review required"],
      })),
      analyzeContractRisk(contractText, con).catch(() => ({
        riskLevel: "medium" as const,
        issues: [{ severity: "medium" as const, description: "Contract risk analysis unavailable" }],
        compliantAspects: [],
        recommendations: ["Manual review required"],
      })),
      analyzeRWAStructureRisk(rwa, inv, con).catch(() => ({
        riskLevel: "medium" as const,
        issues: [{ severity: "medium" as const, description: "RWA structure risk analysis unavailable" }],
        compliantAspects: [],
        recommendations: ["Manual review required"],
      })),
      analyzeCompliance(mergedText, "TradeReceivable").catch(() => null),
    ]);

    // ── Round 3: cross validation (sync, rule-based) ──────────────────────────
    const crossValidation = crossValidate(inv, con, rwa);

    return NextResponse.json({
      invoiceRisk,
      contractRisk,
      rwaRisk,
      sfcCompliance,
      crossValidation,
      extracted: {
        invoice:  inv,
        contract: con,
      },
    });
  } catch (error) {
    console.error("[trade-receivable] unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error during trade receivable compliance check" },
      { status: 500 }
    );
  }
}
