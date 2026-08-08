export interface ContractVersionBadgeProps {
  version?: string | null;
  isUpgradable?: boolean | null;
  label?: string;
}

/** Small badge that surfaces an Ethereum contract's version + upgradability so
 *  judges can see the Track-4 "upgradable smart contract" story at a glance,
 *  instead of it being an invisible deploy-time flag. */
export default function ContractVersionBadge({ version, isUpgradable, label = "IdentityRegistry" }: ContractVersionBadgeProps) {
  if (!version) {
    return (
      <span className="text-[10px] text-slate-400 italic">{label}: governance version unknown (not yet deployed)</span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2.5 py-1"
      style={{ color: "#1d4ed8", background: "rgba(29,78,216,0.08)", border: "1px solid rgba(29,78,216,0.2)" }}
    >
      {label} {version}
      <span style={{ color: isUpgradable ? "#16a34a" : "#dc2626" }}>
        · Upgradeable Governance: {isUpgradable ? "Enabled" : "Disabled"}
      </span>
    </span>
  );
}
