import Link from "next/link";
import { getComplianceBadgeData } from "@/lib/compliance-badge";
import ContractVersionBadge from "@/components/ContractVersionBadge";

export const dynamic = "force-dynamic";

function shortHash(value: string | null | undefined) {
  if (!value) return "-";
  if (value.length <= 20) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not yet monitored";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default async function ComplianceBadgePage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const data = getComplianceBadgeData(assetId);

  if (!data.found) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-xl p-6 text-center" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
          <h1 className="text-lg font-semibold text-slate-900">No compliance record found</h1>
          <p className="text-sm text-slate-500 mt-2">
            No deployment matches asset id <span className="font-mono">{assetId}</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 space-y-4">
      <div className="rounded-xl p-6" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {data.assetName ?? data.assetId} · Compliance Badge
          </h1>
          <ContractVersionBadge
            version={data.identityRegistry?.contractVersion}
            isUpgradable={data.identityRegistry?.isUpgradable}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Publicly verifiable status. No investor PII, document, or individual risk score is exposed here — only
          aggregate credential counts and contract identity.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-4">
          <div className="rounded-lg p-3" style={{ background: "rgba(22,163,74,0.05)", border: "1px solid rgba(22,163,74,0.15)" }}>
            <div className="text-slate-500">Active</div>
            <div className="text-lg font-bold text-emerald-700">{data.credentialStats.active}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
            <div className="text-slate-500">Revoked</div>
            <div className="text-lg font-bold text-red-700">{data.credentialStats.revoked}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <div className="text-slate-500">Expired</div>
            <div className="text-lg font-bold text-amber-700">{data.credentialStats.expired}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "rgba(100,116,139,0.05)", border: "1px solid rgba(100,116,139,0.15)" }}>
            <div className="text-slate-500">Not Issued</div>
            <div className="text-lg font-bold text-slate-600">{data.credentialStats.notIssued}</div>
          </div>
        </div>

        <dl className="mt-4 text-xs space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Network</dt>
            <dd className="text-slate-700">{data.network ?? "-"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Status</dt>
            <dd className="text-slate-700">{data.status ?? "-"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Contract</dt>
            <dd className="font-mono text-slate-700">
              {data.explorerUrl ? (
                <a className="text-blue-600 hover:underline" href={data.explorerUrl} target="_blank" rel="noreferrer">
                  {shortHash(data.contractHash)}
                </a>
              ) : (
                shortHash(data.contractHash)
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Last Autonomous Monitoring Run</dt>
            <dd className="text-slate-700">{formatTimestamp(data.lastMonitoredAt)}</dd>
          </div>
        </dl>

        <p className="text-[10px] text-slate-400 mt-4">
          Generated {new Date(data.generatedAt).toLocaleString()} · Programmatic status:{" "}
          <Link className="text-blue-600 hover:underline" href={`/api/compliance/badge/${encodeURIComponent(assetId)}`}>
            JSON endpoint
          </Link>
        </p>
      </div>
    </div>
  );
}
