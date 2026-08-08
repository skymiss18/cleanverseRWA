import fs from "fs";
import path from "path";
import OpenAI from "openai";

interface SFCRule {
  id: string;
  category: string;
  description: string;
  keywords: string[];
  weight: number;
}

interface RulesDB {
  rules: SFCRule[];
  greenBondExtra: SFCRule[];
  reitExtra: SFCRule[];
  tradeReceivableExtra: SFCRule[];
  bondExtra: SFCRule[];
}

function loadRules(): RulesDB {
  const p = path.join(process.cwd(), "compliance-rules", "sfc-rules.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as RulesDB;
}

export interface ComplianceResult {
  score: number;
  passed: boolean;
  breakdown: {
    ruleId: string;
    ruleName: string;
    score: number;
    maxScore: number;
    weight: number;
    details: string;
  }[];
  summary: string;
  recommendations: string[];
  engine: "llm" | "rule-based";
}

// ── LLM client (SiliconFlow / Qwen, OpenAI-compatible) ──────────────────────
function getLLMClient(): OpenAI | null {
  const apiKey  = process.env.SILICONFLOW_API_KEY;
  const baseURL = process.env.SILICONFLOW_BASE_URL;
  if (!apiKey || !baseURL) return null;
  return new OpenAI({ apiKey, baseURL, timeout: 45000, maxRetries: 0 });
}

function buildSystemPrompt(rules: SFCRule[]): string {
  const rulesText = rules
    .map((r) => `- ${r.id} [${r.category}] (weight ${r.weight}): ${r.description}`)
    .join("\n");

  return `You are a strict SFC compliance analyst specialising in RWA tokenisation.
You evaluate whether a prospectus or term sheet document explicitly satisfies each SFC rule below.

${rulesText}

CRITICAL SCORING RULES — read carefully before scoring:
1. Score ONLY based on content explicitly stated in the submitted document. Do NOT use your own knowledge to infer or assume compliance.
2. A rule that is merely hinted at by a product name, standard name, or passing mention (e.g. "ERC-3643", "AI compliance oracle") does NOT satisfy the rule. The document must contain substantive, specific language addressing the rule's requirement.
3. Award 0 for any rule where the document provides no substantive explicit content addressing it.
4. Award full marks ONLY when the document contains clear, detailed coverage of the rule (e.g. named custodian, explicit PI restriction language, documented KYC procedures).
5. A one-sentence marketing description is NEVER sufficient to pass any rule.

Compute a final weighted average score (0–100). Score >= 70 means PASS.

Respond ONLY with valid JSON in this exact schema (no markdown, no explanation outside JSON):
{
  "score": <number 0-100>,
  "passed": <boolean>,
  "breakdown": [
    {
      "ruleId": "<rule id>",
      "ruleName": "<category>",
      "score": <number 0-maxScore>,
      "maxScore": <weight value>,
      "weight": <weight value>,
      "details": "<one sentence citing specific text from the document, or stating what is missing>"
    }
  ],
  "summary": "<2-3 sentence overall assessment>",
  "recommendations": ["<actionable recommendation 1>", ...]
}`;
}

async function analyzeWithLLM(
  text: string,
  assetType: "REIT" | "GreenBond" | "TradeReceivable" | "Bond",
  rules: SFCRule[]
): Promise<ComplianceResult> {
  const client = getLLMClient();
  if (!client) throw new Error("LLM not configured");

  const model = process.env.SILICONFLOW_MODEL ?? "qwen2.5-72b-instruct";

  const truncatedText = text.length > 6000 ? text.slice(0, 6000) + "\n[... document truncated ...]" : text;

  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(rules) },
      {
        role: "user",
        content: `Asset Type: ${assetType}\n\nProspectus / Term Sheet:\n${truncatedText}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "";
  if (!raw) throw new Error("LLM returned empty response");

  // Strip accidental markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: ComplianceResult;
  try {
    parsed = JSON.parse(cleaned) as ComplianceResult;
  } catch {
    throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  // Validate required fields
  if (typeof parsed.score !== "number" || !Array.isArray(parsed.breakdown)) {
    throw new Error("LLM response missing required fields");
  }

  parsed.passed = parsed.score >= 70;
  parsed.engine = "llm";
  return parsed;
}

// ── Rule-based fallback ──────────────────────────────────────────────────────
function analyzeWithRules(
  text: string,
  rules: SFCRule[]
): ComplianceResult {
  const lowerText = text.toLowerCase();
  const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
  let earnedWeight = 0;

  const breakdown = rules.map((rule) => {
    const hit = rule.keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
    const pts = hit ? rule.weight : 0;
    earnedWeight += pts;
    return {
      ruleId:   rule.id,
      ruleName: rule.category,
      score:    pts,
      maxScore: rule.weight,
      weight:   rule.weight,
      details:  hit
        ? `Document contains relevant keywords for ${rule.category}.`
        : `No keywords found for ${rule.category}. ${rule.description}`,
    };
  });

  const score = Math.round((earnedWeight / totalWeight) * 100);
  const failed = breakdown.filter((b) => b.score === 0);
  const recommendations = failed.map((b) => `[${b.ruleId}] ${b.ruleName}: ${rules.find((r) => r.id === b.ruleId)?.description ?? ""}`);

  const summary =
    score >= 70
      ? `Document passes SFC compliance threshold (${score}/100). ${failed.length} minor gap(s) noted.`
      : `Document does NOT meet SFC threshold (${score}/100). ${failed.length} critical gap(s) must be addressed.`;

  return { score, passed: score >= 70, breakdown, summary, recommendations, engine: "rule-based" };
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function analyzeCompliance(
  text: string,
  assetType: "REIT" | "GreenBond" | "TradeReceivable" | "Bond"
): Promise<ComplianceResult> {
  const db = loadRules();
  let allRules = [...db.rules];
  if (assetType === "GreenBond")        allRules = [...allRules, ...(db.greenBondExtra ?? [])];
  if (assetType === "REIT")             allRules = [...allRules, ...(db.reitExtra ?? [])];
  if (assetType === "TradeReceivable")  allRules = [...allRules, ...(db.tradeReceivableExtra ?? [])];
  if (assetType === "Bond")             allRules = [...allRules, ...(db.bondExtra ?? [])];

  // Try LLM first; fall back to rule-based on any error
  try {
    return await analyzeWithLLM(text, assetType, allRules);
  } catch (err) {
    console.warn("[compliance] LLM failed, using rule-based fallback:", err instanceof Error ? err.message : err);
    return analyzeWithRules(text, allRules);
  }
}
