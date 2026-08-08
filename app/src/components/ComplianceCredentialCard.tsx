"use client";

function shortHash(value: string | null | undefined) {
  if (!value) return "-";
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export interface ComplianceCredentialCardProps {
  status?: string | null; // pending | reviewing | ai_scored | approved | rejected
  monitoringStatus?: string | null;
  riskBand?: number | null;
  credentialCommitment?: string | null;
  nullifierHash?: string | null;
  proofHash?: string | null;
  zkProofScheme?: string | null;
  zkCircuitId?: string | null;
  proofVerified?: boolean | null;
  executionMode?: "manual" | "auto" | null;
  kycExpiry?: number | null;
  agentReason?: string | null;
  /** Compact mode drops the footer disclosure line — used on the judge-facing
   *  evidence page where the disclosure is already shown once at the top. */
  compact?: boolean;
}

interface CredentialState {
  label: string;
  color: string;
  bg: string;
  border: string;
}

function deriveCredentialState(props: ComplianceCredentialCardProps): CredentialState {
  const nowSec = Math.floor(Date.now() / 1000);
  const monitoring = (props.monitoringStatus ?? "").toLowerCase();

  if (props.status === "rejected" || monitoring.includes("revoke")) {
    return { label: "Revoked", color: "#dc2626", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)" };
  }
  if (typeof props.kycExpiry === "number" && props.kycExpiry > 0 && props.kycExpiry <= nowSec) {
    return { label: "Expired", color: "#b45309", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.3)" };
  }
  if (props.status === "approved" && props.credentialCommitment) {
    return { label: "Active", color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.25)" };
  }
  return { label: "Not Issued", color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)" };
}

/** Presents an investor's/asset's KYC credential data as a distinct
 *  "Compliance Credential" entity (status badge + soulbound tag), rather than
 *  scattered field rows — makes the Track-4 "compliance credential token"
 *  narrative visible without overclaiming a separate token contract exists
 *  yet (see the disclosure footer). */
export default function ComplianceCredentialCard(props: ComplianceCredentialCardProps) {
  const state = deriveCredentialState(props);

  return (
    <div className="rounded-xl px-5 py-4" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Compliance Credential</div>
          <p className="text-[10px] text-slate-500 mt-0.5">ZK-backed eligibility state for policy gating and continuous monitoring.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span
            className="text-[10px] font-bold rounded-full px-2.5 py-0.5"
            style={{ color: state.color, background: state.bg, border: `1px solid ${state.border}` }}
          >
            {state.label}
          </span>
          <span
            className="text-[9px] font-semibold rounded px-1.5 py-0.5"
            style={{ color: "#7c3aed", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)" }}
            title="Cannot be transferred between wallets, mirroring a soulbound token"
          >
            Soulbound · Non-transferable
          </span>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Commitment</span>
          <code className="text-blue-600 font-mono">{shortHash(props.credentialCommitment)}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Nullifier</span>
          <code className="text-slate-700 font-mono">{shortHash(props.nullifierHash)}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Proof Hash</span>
          <code className="text-slate-700 font-mono">{shortHash(props.proofHash)}</code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Proof Scheme</span>
          <span className="text-slate-700">{props.zkProofScheme ?? "-"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Circuit</span>
          <span className="text-slate-700">{props.zkCircuitId ?? "-"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Proof Verified</span>
          <span className="text-slate-700">{typeof props.proofVerified === "boolean" ? (props.proofVerified ? "Yes" : "No") : "-"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Risk Band</span>
          <span className="text-slate-700">{props.riskBand ? `Band ${props.riskBand}` : "-"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">Execution Mode</span>
          <span className="text-slate-700">{props.executionMode ?? "manual"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-500">KYC Expiry</span>
          <span className="text-slate-700">
            {props.kycExpiry ? new Date(props.kycExpiry * 1000).toLocaleDateString("en-GB") : "-"}
          </span>
        </div>
        {props.agentReason && (
          <div className="text-slate-500 leading-relaxed pt-1">{props.agentReason}</div>
        )}
      </div>

      {!props.compact && (
        <div className="text-[10px] text-slate-400 mt-3 pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          Backed by the Ethereum IdentityRegistry whitelist mapping today. A dedicated soulbound
          Compliance Credential token contract is designed as a future upgrade path.
        </div>
      )}
    </div>
  );
}
