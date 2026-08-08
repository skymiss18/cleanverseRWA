import OpenAI from "openai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedInvoice {
  invoiceNo: string;
  buyerName: string;
  sellerName: string;
  buyerTaxId: string;          // VAT/tax registration number of buyer
  sellerTaxId: string;         // VAT/tax registration number of seller
  amount: number;
  currency: string;
  dueDate: string;
  invoiceDate: string;
  paymentDays: number;         // e.g. 90 (days net)
  goodsDescription: string;
  taxRate: string;             // e.g. "13%" or "0%" (VAT)
  hasVagueName: boolean;       // true if goods desc is very generic ("office supplies batch" etc)
  portOfLoading: string;
  portOfDischarge: string;
  incoterms: string;
}

export interface ExtractedContract {
  contractNo: string;
  buyerName: string;
  sellerName: string;
  buyerTaxId: string;
  sellerTaxId: string;
  contractAmount: number;
  currency: string;
  signingDate: string;
  expiryDate: string;          // contract validity end
  paymentTerms: string;        // e.g. "Net 90 days", "D/A 60", "L/C at sight"
  paymentDays: number;         // numeric, e.g. 90
  goodsDescription: string;
  hasAssignmentProhibition: boolean; // true = cannot tokenise
  hasAssignmentPermission: boolean;  // explicit assignment clause present
  governingLaw: string;
  disputeResolution: string;   // e.g. "SIAC arbitration"
  hasSignature: boolean;       // both parties signed
  hasSeal: boolean;            // chop/seal present
  relatedPartyFlags: string;   // any indication buyer/seller are related
}

export interface RWADetails {
  assetName: string;
  totalSupply: number;
  unitPrice: number;
  assetDescription: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DocumentRiskReport {
  riskLevel: RiskLevel;
  issues: { severity: RiskLevel; description: string }[];
  compliantAspects: string[];
  recommendations: string[];
}

export interface CrossValidationRule {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface CrossValidationResult {
  allPassed: boolean;
  rules: CrossValidationRule[];
}

// ── LLM client ────────────────────────────────────────────────────────────────

function getLLMClient(): OpenAI | null {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL, timeout: 45000, maxRetries: 0 });
}

function getModel(): string {
  return process.env.SILICONFLOW_MODEL ?? "Qwen/Qwen2.5-72B-Instruct";
}

async function llmJson<T>(systemPrompt: string, userContent: string, fallback: T): Promise<T> {
  const client = getLLMClient();
  if (!client) return fallback;
  try {
    const resp = await client.chat.completions.create({
      model: getModel(),
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.warn("[trade-docs] LLM call failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

// ── Field Extraction ──────────────────────────────────────────────────────────

const INVOICE_EXTRACT_SYSTEM = `You are a trade finance document parser.
Extract structured fields from a commercial invoice. Return ONLY valid JSON:
{
  "invoiceNo": "<string or empty>",
  "buyerName": "<string>",
  "sellerName": "<string>",
  "buyerTaxId": "<VAT/tax reg number or empty>",
  "sellerTaxId": "<VAT/tax reg number or empty>",
  "amount": <number, 0 if not found>,
  "currency": "<USD|HKD|CNY|EUR|GBP or empty>",
  "dueDate": "<YYYY-MM-DD or empty>",
  "invoiceDate": "<YYYY-MM-DD or empty>",
  "paymentDays": <number of days net payment term, 0 if not found>,
  "goodsDescription": "<string>",
  "taxRate": "<e.g. 13% or empty>",
  "hasVagueName": <true if goods description is vague like 'misc goods' or 'office supplies batch', else false>,
  "portOfLoading": "<string or empty>",
  "portOfDischarge": "<string or empty>",
  "incoterms": "<e.g. CIF, FOB, EXW or empty>"
}`;

const CONTRACT_EXTRACT_SYSTEM = `You are a trade finance document parser.
Extract structured fields from a trade contract. Return ONLY valid JSON:
{
  "contractNo": "<string or empty>",
  "buyerName": "<string>",
  "sellerName": "<string>",
  "buyerTaxId": "<registration/VAT number or empty>",
  "sellerTaxId": "<registration/VAT number or empty>",
  "contractAmount": <number, 0 if not found>,
  "currency": "<USD|HKD|CNY|EUR|GBP or empty>",
  "signingDate": "<YYYY-MM-DD or empty>",
  "expiryDate": "<YYYY-MM-DD or empty>",
  "paymentTerms": "<string, e.g. Net 90 days, D/A 60, L/C at sight>",
  "paymentDays": <number of days payment term, 0 if not found>,
  "goodsDescription": "<string>",
  "hasAssignmentProhibition": <true if contract PROHIBITS assignment/transfer of receivables>,
  "hasAssignmentPermission": <true if contract EXPLICITLY PERMITS assignment/transfer of receivables to third parties>,
  "governingLaw": "<string, e.g. applicable law>",
  "disputeResolution": "<string, e.g. SIAC arbitration, Singapore courts>",
  "hasSignature": <true if both parties signatures are present>,
  "hasSeal": <true if company chop or seal is mentioned>,
  "relatedPartyFlags": "<string, any indication buyer and seller are related entities, or empty>"
}`;

function regexFallbackInvoice(text: string): ExtractedInvoice {
  const amountMatch = text.match(/(?:total|amount|invoice\s+value|total\s+due)[^\d]*([\d,]+(?:\.\d{2})?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;
  const daysMatch = text.match(/(\d+)\s*days?\s*net|net\s*(\d+)\s*days?/i);
  const paymentDays = daysMatch ? parseInt(daysMatch[1] ?? daysMatch[2]) : 0;
  return {
    invoiceNo: text.match(/invoice\s*(?:no\.?|number|#)[:\s]*([\w-]+)/i)?.[1] ?? "",
    buyerName: "", sellerName: "",
    buyerTaxId: "", sellerTaxId: "",
    amount,
    currency: text.match(/\b(USD|HKD|CNY|EUR|GBP)\b/i)?.[1]?.toUpperCase() ?? "",
    dueDate: "", invoiceDate: "",
    paymentDays,
    goodsDescription: text.slice(0, 200),
    taxRate: "",
    hasVagueName: false,
    portOfLoading: text.match(/port\s+of\s+loading[:\s]+([^\n]+)/i)?.[1]?.trim() ?? "",
    portOfDischarge: text.match(/port\s+of\s+discharge[:\s]+([^\n]+)/i)?.[1]?.trim() ?? "",
    incoterms: text.match(/\b(CIF|FOB|EXW|DAP|DDP|CPT|CFR|FCA)\b/i)?.[1]?.toUpperCase() ?? "",
  };
}

function regexFallbackContract(text: string): ExtractedContract {
  const amountMatch = text.match(/(?:contract\s+value|total\s+(?:contract\s+)?value|total\s+amount)[^\d]*([\d,]+(?:\.\d{2})?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) : 0;
  const daysMatch = text.match(/net\s*(\d+)\s*days?|(\d+)\s*days?\s*(?:net|from)/i);
  const paymentDays = daysMatch ? parseInt(daysMatch[1] ?? daysMatch[2]) : 0;
  const hasAssignmentProhibition = /prohibit|not\s+(?:be\s+)?assign|no\s+assignment|cannot\s+transfer|may\s+not\s+assign/i.test(text);
  const hasAssignmentPermission = /(?:may|is\s+permitted\s+to|expressly\s+permitted|right\s+to)\s+assign|assignment\s+(?:of\s+receivables?|is\s+permitted)|transfer.*receivable/i.test(text);
  return {
    contractNo: text.match(/contract\s*(?:no\.?|number)[:\s]*([\w-]+)/i)?.[1] ?? "",
    buyerName: "", sellerName: "",
    buyerTaxId: "", sellerTaxId: "",
    contractAmount: amount,
    currency: text.match(/\b(USD|HKD|CNY|EUR|GBP)\b/i)?.[1]?.toUpperCase() ?? "",
    signingDate: "", expiryDate: "",
    paymentTerms: daysMatch ? `Net ${paymentDays} days` : "",
    paymentDays,
    goodsDescription: text.slice(0, 200),
    hasAssignmentProhibition,
    hasAssignmentPermission,
    governingLaw: /hong\s+kong/i.test(text) ? "applicable law" : "",
    disputeResolution: /hkiac|arbitrat/i.test(text) ? "SIAC arbitration" : "",
    hasSignature: /sign(?:ed|ature)|signed\s*by/i.test(text),
    hasSeal: /seal|chop|stamp/i.test(text),
    relatedPartyFlags: "",
  };
}

export async function extractInvoiceFields(text: string): Promise<ExtractedInvoice> {
  const result = await llmJson<ExtractedInvoice>(
    INVOICE_EXTRACT_SYSTEM,
    `Commercial Invoice:\n${text.slice(0, 4000)}`,
    regexFallbackInvoice(text)
  );
  result.amount = Number(result.amount) || 0;
  result.paymentDays = Number(result.paymentDays) || 0;
  result.hasVagueName = Boolean(result.hasVagueName);
  return result;
}

export async function extractContractFields(text: string): Promise<ExtractedContract> {
  const result = await llmJson<ExtractedContract>(
    CONTRACT_EXTRACT_SYSTEM,
    `Trade Contract:\n${text.slice(0, 4000)}`,
    regexFallbackContract(text)
  );
  result.contractAmount = Number(result.contractAmount) || 0;
  result.paymentDays = Number(result.paymentDays) || 0;
  result.hasAssignmentProhibition = Boolean(result.hasAssignmentProhibition);
  result.hasAssignmentPermission = Boolean(result.hasAssignmentPermission);
  result.hasSignature = Boolean(result.hasSignature);
  result.hasSeal = Boolean(result.hasSeal);
  return result;
}

// ── Risk Analysis ─────────────────────────────────────────────────────────────

const INVOICE_RISK_SYSTEM = `You are a SFC-certified AML and trade finance compliance officer specialising in trade receivable tokenisation.
Analyse this commercial invoice across all 6 validation dimensions:
1. SUBJECT VALIDITY: buyer/seller names present, not sanctioned, not shell entities
2. COMPLETENESS: invoice number, date, due date, buyer+seller tax IDs, goods description with specs, quantities, unit prices, total amount all present
3. AUTHENTICITY: goods description specific (not vague like "misc goods"), amounts realistic, tax rate correct for jurisdiction
4. DUPLICATE/PLEDGE RISK: note if invoice could already be pledged or discounted elsewhere
5. PAYMENT TERMS: days-net payment period is within industry norm (<=180 days); note if unusually long
6. AML FLAGS: round-number amounts, sanctioned countries, over/under-invoicing indicators
Return ONLY valid JSON:
{
  "riskLevel": "low|medium|high|critical",
  "issues": [{ "severity": "low|medium|high|critical", "description": "<string>" }],
  "compliantAspects": ["<string>"],
  "recommendations": ["<string>"]
}`;

const CONTRACT_RISK_SYSTEM = `You are a SFC-certified legal and trade finance compliance officer specialising in supply chain finance and RWA tokenisation.
Analyse this trade contract across all required dimensions:
1. COMPLETENESS: contract number, signing date, full party details, goods/services specs, quantities, pricing, delivery terms, payment method, payment period, breach provisions, both-party signatures/seals
2. VALIDITY: contract in force (not expired/cancelled), no supplementary amendments with conflicting terms, no yin-yang contract indicators
3. CRITICAL — ASSIGNMENT CLAUSE: Does the contract PROHIBIT assignment of receivables? If yes, RWA tokenisation is BLOCKED (critical issue). Does it PERMIT assignment to SPV/third party? Explicit permission is required for clean tokenisation.
4. PAYMENT TERMS RISK: D/A (documents against acceptance) = higher risk than D/P or L/C; unusually long terms (>180 days) = flag
5. GOVERNING LAW & DISPUTE RESOLUTION: SG or other recognised jurisdiction? Arbitration clause (SIAC preferred)?
6. RELATED PARTY / AUTHENTICITY: any indication buyer and seller are affiliated, same controller, or that this is a circular/self-financing trade?
7. SIGNATURE & AUTHORITY: both parties have signed, authorised signatories, company seals present
Return ONLY valid JSON:
{
  "riskLevel": "low|medium|high|critical",
  "issues": [{ "severity": "low|medium|high|critical", "description": "<string>" }],
  "compliantAspects": ["<string>"],
  "recommendations": ["<string>"]
}`;

const RWA_STRUCTURE_RISK_SYSTEM = `You are a SFC tokenisation expert reviewing a Trade Receivable RWA token structure.
Check for: over-issuance (token face value vs underlying receivable), SFC investor suitability requirements,
redemption mechanism adequacy, yield source legitimacy, and compliance with SFC Circular on Tokenisation (Nov 2023).
Return ONLY valid JSON:
{
  "riskLevel": "low|medium|high|critical",
  "issues": [{ "severity": "low|medium|high|critical", "description": "<string>" }],
  "compliantAspects": ["<string>"],
  "recommendations": ["<string>"]
}`;

const FALLBACK_RISK: DocumentRiskReport = {
  riskLevel: "medium",
  issues: [{ severity: "medium", description: "AI analysis unavailable. Manual review required." }],
  compliantAspects: [],
  recommendations: ["Please submit documents for manual compliance review."],
};

export async function analyzeInvoiceRisk(
  text: string,
  extracted: ExtractedInvoice
): Promise<DocumentRiskReport> {
  return llmJson<DocumentRiskReport>(
    INVOICE_RISK_SYSTEM,
    `Invoice Summary:\nNo.: ${extracted.invoiceNo}\nBuyer: ${extracted.buyerName} (Tax: ${extracted.buyerTaxId || "N/A"})\nSeller: ${extracted.sellerName} (Tax: ${extracted.sellerTaxId || "N/A"})\nAmount: ${extracted.amount} ${extracted.currency}\nInvoice Date: ${extracted.invoiceDate}\nDue Date: ${extracted.dueDate} (${extracted.paymentDays} days net)\nGoods: ${extracted.goodsDescription}\nTax Rate: ${extracted.taxRate || "N/A"}\nIncoterms: ${extracted.incoterms || "N/A"}\nVague goods name: ${extracted.hasVagueName}\n\nFull Invoice Text:\n${text.slice(0, 3000)}`,
    FALLBACK_RISK
  );
}

export async function analyzeContractRisk(
  text: string,
  extracted: ExtractedContract
): Promise<DocumentRiskReport> {
  return llmJson<DocumentRiskReport>(
    CONTRACT_RISK_SYSTEM,
    `Contract Summary:\nNo.: ${extracted.contractNo}\nBuyer: ${extracted.buyerName} (Tax: ${extracted.buyerTaxId || "N/A"})\nSeller: ${extracted.sellerName} (Tax: ${extracted.sellerTaxId || "N/A"})\nAmount: ${extracted.contractAmount} ${extracted.currency}\nSigning Date: ${extracted.signingDate}\nExpiry Date: ${extracted.expiryDate || "N/A"}\nPayment Terms: ${extracted.paymentTerms} (${extracted.paymentDays} days)\nGoverning Law: ${extracted.governingLaw}\nDispute Resolution: ${extracted.disputeResolution || "N/A"}\nAssignment Prohibited: ${extracted.hasAssignmentProhibition}\nAssignment Permitted: ${extracted.hasAssignmentPermission}\nSigned: ${extracted.hasSignature} | Seal: ${extracted.hasSeal}\nRelated Party Flags: ${extracted.relatedPartyFlags || "none"}\n\nFull Contract Text:\n${text.slice(0, 3000)}`,
    FALLBACK_RISK
  );
}

export async function analyzeRWAStructureRisk(
  rwa: RWADetails,
  invoice: ExtractedInvoice,
  contract: ExtractedContract
): Promise<DocumentRiskReport> {
  const tokenFaceValue = rwa.totalSupply * rwa.unitPrice;
  const overIssuanceRatio = invoice.amount > 0 ? (tokenFaceValue / invoice.amount).toFixed(2) : "N/A";
  return llmJson<DocumentRiskReport>(
    RWA_STRUCTURE_RISK_SYSTEM,
    `RWA Token Structure:\nAsset Name: ${rwa.assetName}\nTotal Supply: ${rwa.totalSupply}\nUnit Price: ${rwa.unitPrice} ${invoice.currency || "HKD"}\nToken Face Value: ${tokenFaceValue}\nUnderlying Invoice Amount: ${invoice.amount} ${invoice.currency}\nOver-issuance Ratio: ${overIssuanceRatio}x\nContract Governing Law: ${contract.governingLaw}\nAssignment Prohibition in Contract: ${contract.hasAssignmentProhibition}\nAsset Description: ${rwa.assetDescription}`,
    FALLBACK_RISK
  );
}

// ── Cross Validation (rule-based, no LLM) ────────────────────────────────────

export function crossValidate(
  invoice: ExtractedInvoice,
  contract: ExtractedContract,
  rwa: RWADetails
): CrossValidationResult {
  const tokenFaceValue = rwa.totalSupply * rwa.unitPrice;

  function nameSimilar(a: string, b: string): boolean {
    if (!a || !b) return false;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const na = norm(a); const nb = norm(b);
    return na === nb || na.includes(nb.slice(0, 6)) || nb.includes(na.slice(0, 6));
  }

  const rules: CrossValidationRule[] = [
    {
      id: "TR-001",
      name: "Counterparty Consistency",
      passed: nameSimilar(invoice.buyerName, contract.buyerName) &&
              nameSimilar(invoice.sellerName, contract.sellerName),
      detail: invoice.buyerName && contract.buyerName
        ? `Invoice buyer "${invoice.buyerName}" vs Contract buyer "${contract.buyerName}"`
        : "Could not extract counterparty names for comparison",
    },
    {
      id: "TR-002",
      name: "Amount Integrity",
      passed: invoice.amount > 0 && contract.contractAmount > 0
        ? invoice.amount <= contract.contractAmount * 1.02  // 2% tolerance
        : true, // skip if amounts not parsed
      detail: invoice.amount > 0 && contract.contractAmount > 0
        ? `Invoice: ${invoice.amount} ${invoice.currency} vs Contract: ${contract.contractAmount} ${contract.currency}`
        : "Amounts not parseable — manual review required",
    },
    {
      id: "TR-003",
      name: "Goods/Services Consistency",
      passed: (() => {
        if (!invoice.goodsDescription || !contract.goodsDescription) return false;
        const invWords = invoice.goodsDescription.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const conText = contract.goodsDescription.toLowerCase();
        const matchCount = invWords.filter(w => conText.includes(w)).length;
        return invWords.length === 0 ? false : matchCount / invWords.length >= 0.2;
      })(),
      detail: `Invoice goods: "${invoice.goodsDescription.slice(0, 80)}" vs Contract: "${contract.goodsDescription.slice(0, 80)}"`,
    },
    {
      id: "TR-004",
      name: "RWA Token Sizing",
      passed: invoice.amount > 0 ? tokenFaceValue <= invoice.amount * 1.0 : true,
      detail: invoice.amount > 0
        ? `Token face value: ${tokenFaceValue} vs Invoice receivable: ${invoice.amount} ${invoice.currency} (ratio: ${(tokenFaceValue / invoice.amount).toFixed(2)}x)`
        : `Invoice amount not parsed. Token face value: ${tokenFaceValue}`,
    },
    {
      id: "TR-005",
      name: "Document Chronology",
      passed: (() => {
        if (!invoice.invoiceDate || !contract.signingDate) return true; // skip if dates missing
        return new Date(invoice.invoiceDate) >= new Date(contract.signingDate);
      })(),
      detail: invoice.invoiceDate && contract.signingDate
        ? `Invoice date: ${invoice.invoiceDate}, Contract signing: ${contract.signingDate}`
        : "Date fields not parsed — chronology check skipped",
    },
  ];

  return { allPassed: rules.every(r => r.passed), rules };
}

// ── Merged context for SFC analyzeCompliance ─────────────────────────────────

export function buildMergedContext(
  invoice: ExtractedInvoice,
  contract: ExtractedContract,
  rwa: RWADetails
): string {
  return `
TRADE RECEIVABLE RWA TOKENISATION PACKAGE

=== ASSET OVERVIEW ===
Asset Name: ${rwa.assetName}
Asset Description: ${rwa.assetDescription}
Total Token Supply: ${rwa.totalSupply}
Unit Price: ${rwa.unitPrice}
Token Face Value: ${rwa.totalSupply * rwa.unitPrice}

=== COMMERCIAL INVOICE SUMMARY ===
Invoice No: ${invoice.invoiceNo}
Seller (Issuer): ${invoice.sellerName}
Buyer (Obligor): ${invoice.buyerName}
Invoice Amount: ${invoice.amount} ${invoice.currency}
Due Date: ${invoice.dueDate}
Goods/Services: ${invoice.goodsDescription}

=== TRADE CONTRACT SUMMARY ===
Contract No: ${contract.contractNo}
Buyer: ${contract.buyerName}
Seller: ${contract.sellerName}
Contract Amount: ${contract.contractAmount} ${contract.currency}
Payment Terms: ${contract.paymentTerms}
Governing Law: ${contract.governingLaw}
Assignment Prohibition: ${contract.hasAssignmentProhibition ? "YES - CRITICAL ISSUE" : "No"}

=== TOKENISATION STRUCTURE ===
This trade receivable is being tokenised under the SFC Circular on Tokenisation of SFC-authorised Products (Nov 2023).
Tokens represent legal claims on the above invoice receivable, distributed exclusively to Professional Investors.
KYC/AML verified investors are registered in IdentityRegistry.sol on Ethereum Sepolia.
Compliance score from AI oracle is written on-chain via ComplianceOracle.sol.
`.trim();
}
