"use client";
import { useState, useRef, useEffect } from "react";

const GLOSSARY: Record<string, { label: string; definition: string }> = {
  "erc-3643": {
    label: "ERC-3643",
    definition:
      "A smart-contract standard that enforces compliance rules on every token transfer — like a built-in rulebook that automatically checks each transaction.",
  },
  "t-rex": {
    label: "T-REX",
    definition:
      "Token for Regulated EXchanges — the technical framework behind ERC-3643 that links investor identity to token permissions.",
  },
  amlo: {
    label: "AMLO",
    definition:
      "Anti-Money Laundering and Counter-Terrorist Financing Ordinance (Cap. 615) — law requiring financial institutions to verify customer identities.",
  },
  sfo: {
    label: "SFO",
    definition:
      "Securities and Futures Ordinance — primary legislation governing securities, futures, and related activities.",
  },
  keccak256: {
    label: "keccak256",
    definition:
      "A cryptographic fingerprint algorithm — it converts any document into a unique fixed-length code, proving the document hasn't been altered.",
  },
  "t+2": {
    label: "T+2 Settlement",
    definition:
      "Trade date plus 2 business days — the standard window between agreeing a trade and the actual delivery of tokens/funds.",
  },
  "complianceoracle": {
    label: "ComplianceOracle.sol",
    definition:
      "NexusRWA's on-chain compliance ledger — a smart contract that permanently records audit results and regulatory approvals on the blockchain.",
  },
  "identityregistry": {
    label: "IdentityRegistry.sol",
    definition:
      "NexusRWA's on-chain KYC whitelist — a smart contract that records which wallet addresses have been verified as eligible investors.",
  },
  "professional-investor": {
    label: "Professional Investor",
    definition:
      "Under SFO Schedule 1 — investors with a portfolio of HKD 8M+ or licensed financial institutions. They receive less retail-investor protection but access to a wider range of products.",
  },
  swc: {
    label: "SWC Registry",
    definition:
      "Smart Contract Weakness Classification — an industry-standard catalogue of known smart contract security vulnerabilities, similar to CVEs in traditional software.",
  },
  txhash: {
    label: "Transaction Hash",
    definition:
      "A unique ID assigned to every blockchain transaction — like a receipt number that lets anyone verify the transaction happened on a public blockchain explorer.",
  },
  mantle: {
    label: "Ethereum Sepolia",
    definition:
      "Ethereum's public proof-of-stake test network used by NexusRWA for contract deployment and validation.",
  },
  "swift-bic": {
    label: "SWIFT BIC",
    definition:
      "Bank Identifier Code — an international standard code (e.g. HSBCHKHHHKH) that uniquely identifies a bank for international wire transfers.",
  },
  "eigenda": {
    label: "EigenDA",
    definition:
      "A decentralised data availability layer — stores important documents (like prospectuses) in a verifiable way so they can't be secretly altered after publication.",
  },
  "sfc": {
    label: "SFC",
    definition:
      "Securities and Futures Commission — independent statutory body that regulates securities and futures markets.",
  },
};

interface JargonTooltipProps {
  term: keyof typeof GLOSSARY;
  children?: React.ReactNode;
}

export default function JargonTooltip({ term, children }: JargonTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const entry = GLOSSARY[term];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 cursor-help"
        aria-label={`Definition: ${entry.label}`}
      >
        <span className="border-b border-dashed border-blue-400/60 text-inherit leading-none">
          {children ?? entry.label}
        </span>
        <span
          className="inline-flex items-center justify-center rounded-full text-[9px] font-bold leading-none ml-0.5 flex-shrink-0"
          style={{
            width: 13,
            height: 13,
            background: "rgba(59,130,246,0.15)",
            color: "#60a5fa",
            border: "1px solid rgba(59,130,246,0.3)",
          }}
        >
          ?
        </span>
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 rounded-lg p-3 text-left shadow-xl"
          style={{
            background: "#0b1d34",
            border: "1px solid #1d3a5c",
            pointerEvents: "none",
          }}
        >
          {/* Arrow */}
          <div
            className="absolute left-1/2 -translate-x-1/2 top-full"
            style={{
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid #1d3a5c",
            }}
          />
          <p className="text-[11px] font-semibold text-blue-300 mb-1">
            {entry.label}
          </p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {entry.definition}
          </p>
        </div>
      )}
    </span>
  );
}
