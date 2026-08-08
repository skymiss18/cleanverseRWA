// ═══════════════════════════════════════════════════════════════════════════════
// Role Configuration
// ═══════════════════════════════════════════════════════════════════════════════
// Defines the 4 roles in the NexusRWA system and their associated workflows.
// Used by login page, navigation bar, and route protection.

export type RoleId = "issuer" | "intermediary" | "regulator" | "investor";

export interface RoleLink {
  href: string;
  step: string;
  label: string;
  desc: string;
  isTool?: boolean;
}

export interface Role {
  id: RoleId;
  code: string;
  label: string;
  desc: string;
  accentColor: string;
  links: RoleLink[];
}

// Issuer — the entity that owns the underlying real-world asset
// Responsible for: initiating tokenization + the offering memorandum (legally the issuer's document)
const ISSUER_LINKS: RoleLink[] = [
  { href: "/tokenize",           step: "1", label: "Tokenise Asset",          desc: "Structure, audit & register issuance on Ethereum",       isTool: false },
  { href: "/prospectus",         step: "2", label: "Draft Prospectus",        desc: "AI-assisted SFC-compliant offering memorandum",            isTool: false },
  { href: "/admin/subscriptions", step: "3", label: "Subscription Settlement", desc: "Verify paid subscriptions and mint A-Tokens to investors", isTool: false },
  { href: "/admin/coupons",       step: "4", label: "Coupon Distribution",    desc: "Pay investor coupons from the connected Ethereum wallet",   isTool: false },
];

// Investor — professional or retail investor subscribing to tokens
const INVESTOR_LINKS: RoleLink[] = [
  { href: "/kyc",       step: "1", label: "Submit KYC",   desc: "Off-chain identity review with ZK-backed on-chain eligibility", isTool: false },
  { href: "/subscribe", step: "2", label: "Subscribe",    desc: "Place a token subscription order",                   isTool: false },
  { href: "/portfolio", step: "3", label: "My Portfolio", desc: "Track token holdings & yield income",                isTool: false },
];

// Intermediaries — SFC-licensed corporations (Type 1 & Type 6 LC)
// Type 1 LC (Distributor): client-facing KYC/AML under AMLO Cap.615
// Type 6 LC (Sponsor): pre-SFC compliance review + smart contract technical due diligence
const INTERMEDIARY_LINKS: RoleLink[] = [
  { href: "/compliance", step: "1", label: "Compliance Check",  desc: "AI review & SFC filing on behalf of Issuer (pre-authorisation)", isTool: false },
  { href: "/admin/kyc",  step: "2", label: "KYC Review",       desc: "Agent-assisted approve/update/revoke workflow for credentials",      isTool: false },
  { href: "/evidence",   step: "3", label: "Evidence",         desc: "Judge-facing board for AI checks, ZK commitments, and Ethereum proofs", isTool: false },
];

// SFC — Securities and Futures Commission, the primary securities regulator
// Pure oversight & approval role — does not use AI drafting tools
const REGULATOR_LINKS: RoleLink[] = [
  { href: "/regulator",          step: "1", label: "Oversight Dashboard", desc: "On-chain issuance records, market stats & compliance summary", isTool: false },
  { href: "/regulator/issuance", step: "2", label: "Issuance Review",     desc: "Approve or request changes on token issuance applications",    isTool: false },
];

export const ROLES: readonly Role[] = [
  {
    id: "issuer",
    code: "IS",
    label: "Issuer",
    desc: "Structure, issue and settle assets",
    accentColor: "#2563eb",
    links: ISSUER_LINKS,
  },
  {
    id: "intermediary",
    code: "IM",
    label: "Intermediary",
    desc: "Compliance, audit and KYC review",
    accentColor: "#b45309",
    links: INTERMEDIARY_LINKS,
  },
  {
    id: "regulator",
    code: "RG",
    label: "Regulator",
    desc: "Oversight and issuance authorisation",
    accentColor: "#7c3aed",
    links: REGULATOR_LINKS,
  },
  {
    id: "investor",
    code: "IV",
    label: "Investor",
    desc: "KYC, subscribe and manage holdings",
    accentColor: "#047857",
    links: INVESTOR_LINKS,
  },
] as const;

export function getRoleById(roleId: RoleId | null): Role | null {
  if (!roleId) return null;
  return ROLES.find((role) => role.id === roleId) ?? null;
}
