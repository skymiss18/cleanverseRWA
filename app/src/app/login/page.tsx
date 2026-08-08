"use client";

import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet-context";
import { useRole } from "@/lib/role-context";
import { ROLES, type RoleId } from "@/lib/roles";

export default function LoginPage() {
  const { wallet, connect, connecting } = useWallet();
  const { setRole } = useRole();
  const router = useRouter();

  const handleRoleSelect = (roleId: RoleId) => {
    setRole(roleId);
    const role = ROLES.find((r) => r.id === roleId);
    if (role) {
      router.push(role.links[0].href);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#f7f5f0" }}>
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center"
              style={{ background: "#111111" }}
            >
              <svg viewBox="0 0 10 10" className="w-6 h-6" fill="none">
                <rect x="1" y="1" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.9" />
                <rect x="5.5" y="1" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.5" />
                <rect x="1" y="5.5" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.5" />
                <rect x="5.5" y="5.5" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.9" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold" style={{ color: "#111111", fontFamily: "'Lora', Georgia, serif" }}>
              NexusRWA
            </h1>
          </div>
          <p className="text-base text-slate-600 max-w-md mx-auto">
            Connect your wallet and select your role to access the platform
          </p>
        </div>

        {/* Step 1: Wallet Connection */}
        {!wallet ? (
          <div
            className="rounded-2xl p-8 text-center max-w-md mx-auto"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.10)" }}
          >
            <div
              className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
              style={{ background: "rgba(37,99,235,0.10)" }}
            >
              <svg className="w-8 h-8" style={{ color: "#2563eb" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z" />
                <circle cx="17" cy="14" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2" style={{ color: "#111111" }}>
              Connect Your Wallet
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              Connect your Ethereum wallet to continue
            </p>
            <button
              onClick={() => void connect()}
              disabled={connecting}
              className="btn-primary w-full py-3 rounded-lg text-base font-semibold text-white"
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          </div>
        ) : (
          <>
            {/* Connected Wallet Info */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.20)" }}>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-slate-800">
                  Connected: <span className="font-mono">{wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
                </span>
              </div>
            </div>

            {/* Step 2: Role Selection */}
            <div>
              <h2 className="text-lg font-semibold text-center mb-6" style={{ color: "#111111" }}>
                Select Your Role
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ROLES.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => handleRoleSelect(role.id)}
                    className="group rounded-xl p-6 text-left transition-all duration-200 hover:shadow-lg"
                    style={{
                      background: "#ffffff",
                      border: "1px solid rgba(0,0,0,0.10)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = role.accentColor;
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "rgba(0,0,0,0.10)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-14 h-14 rounded-lg flex items-center justify-center text-base font-bold text-white shrink-0 transition-transform group-hover:scale-110"
                        style={{ background: role.accentColor }}
                      >
                        {role.code}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-semibold mb-1" style={{ color: "#111111" }}>
                          {role.label}
                        </h3>
                        <p className="text-sm text-slate-600 mb-3">
                          {role.desc}
                        </p>
                        <div className="text-xs text-slate-500">
                          {role.links.length} workflow step{role.links.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
