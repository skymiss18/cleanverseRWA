"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@/lib/wallet-context";
import { useRole } from "@/lib/role-context";
import { getRoleById } from "@/lib/roles";

function RoleDropdown({
  label,
  links,
  accentColor,
  activeHref,
}: {
  label: string;
  links: { href: string; step: string; label: string; desc: string; isTool?: boolean }[];
  accentColor: string;
  activeHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const hasActive = links.some((l) => l.href === activeHref);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  }
  function hide() {
    timer.current = setTimeout(() => setOpen(false), 120);
  }

  // After any client-side navigation (including browser back), onMouseEnter won't
  // fire if the cursor was already over this element before the route change.
  // Sync open state by checking the :hover pseudo-class after each navigation.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (containerRef.current?.matches(":hover")) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [pathname]);

  return (
    <div ref={containerRef} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      {/* Trigger button */}
      <button
        className="flex items-center gap-0.5 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-[13px] font-medium transition-all duration-150"
        style={{
          color:      hasActive ? "#111111" : "#666666",
          background: open || hasActive ? "rgba(0,0,0,0.05)" : "transparent",
          border: open || hasActive ? "1px solid rgba(0,0,0,0.12)" : "1px solid transparent",
        }}
      >
        {hasActive && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-slow"
            style={{ background: accentColor }}
          />
        )}
        {label}
        <svg
          className="w-3 h-3 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "none", color: "#999999" }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 rounded-xl py-2 z-50"
          style={{
            minWidth: "272px",
            background: "#ffffff",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border: "1px solid rgba(0,0,0,0.10)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
          }}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <div
            className="px-3 pb-2 mb-1 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: accentColor, borderBottom: "1px solid rgba(0,0,0,0.07)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }} />
            {label} workflow
          </div>
          {links.map((l, i) => (
            <div key={l.href}>
              {/* Divider before first tool entry */}
              {l.isTool && !links[i - 1]?.isTool && (
                <div
                  className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-widest"
                  style={{ color: "#999999", borderTop: "1px solid rgba(0,0,0,0.06)", marginTop: "4px" }}
                >
                  Standalone Tools
                </div>
              )}
              <Link
                href={l.href}
                className="flex items-start gap-3 px-3 py-2.5 transition-all duration-150 group rounded-md mx-1"
                style={{
                  background: l.href === activeHref ? `${accentColor}12` : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (l.href !== activeHref) e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (l.href !== activeHref) e.currentTarget.style.background = "transparent";
                }}
              >
                {l.isTool ? (
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center text-[11px] shrink-0 mt-0.5"
                    style={{ background: "rgba(0,0,0,0.06)", color: "#666666" }}
                  >
                    ⚙
                  </span>
                ) : (
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                    style={{ background: accentColor, color: "white" }}
                  >
                    {l.step}
                  </span>
                )}
                <div>
                  <div
                    className="text-[13px] font-medium leading-snug transition-colors"
                    style={{ color: l.href === activeHref ? "#111111" : "#333333" }}
                  >
                    {l.label}
                  </div>
                  <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "#999999" }}>
                    {l.desc}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { wallet, connect, disconnect, connecting } = useWallet();
  const { selectedRole, clearRole } = useRole();

  const currentRole = getRoleById(selectedRole);

  // Find active link in current role's links
  const activeHref = currentRole?.links
    .slice()
    .sort((a, b) => b.href.length - a.href.length)
    .find((l) => pathname.startsWith(l.href))?.href ?? null;

  const handleLogout = () => {
    disconnect();
    clearRole();
    router.push("/login");
  };

  // Don't show navbar on login page or home page
  if (pathname === "/login" || pathname === "/") {
    return null;
  }

  // Don't show navbar if no role selected
  if (!currentRole) {
    return null;
  }

  return (
    <nav
      style={{
        background: "rgba(247,245,240,0.92)",
        backdropFilter: "blur(14px) saturate(150%)",
        WebkitBackdropFilter: "blur(14px) saturate(150%)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
      }}
      className="sticky top-0 z-50"
    >
      <div
        className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 flex items-center justify-between"
        style={{ height: "52px" }}
      >
        {/* Left: logo + workflow menu */}
        <div className="flex items-center gap-0.5 sm:gap-2 min-w-0">
          {/* Logo */}
          <Link href="/" className="hidden sm:flex items-center gap-2.5 shrink-0 mr-3 group">
            <Image
              src="/logo.png"
              alt="NexusRWA"
              width={32}
              height={32}
              className="rounded-lg"
              priority
            />
            <span className="text-[13px] font-semibold tracking-tight hidden sm:block" style={{ color: "#111111", letterSpacing: "-0.01em" }}>
              NexusRWA
            </span>
          </Link>

          {/* Workflow Dropdown */}
          <RoleDropdown
            label={`${currentRole.label} Workflow`}
            links={[...currentRole.links]}
            accentColor={currentRole.accentColor}
            activeHref={activeHref}
          />
        </div>

        {/* Right: role status + wallet + logout */}
        <div className="hidden sm:flex items-center gap-3">
          <div
            className="flex items-center gap-2 pr-4 mr-1"
            style={{ borderRight: "1px solid rgba(0,0,0,0.12)" }}
            aria-label={`Current role: ${currentRole.label}`}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: currentRole.accentColor }} />
            <span className="leading-tight">
              <span className="block text-[9px] font-semibold uppercase tracking-wider text-slate-400">Role</span>
              <span className="block text-[12px] font-semibold text-slate-700">{currentRole.label}</span>
            </span>
          </div>
          {wallet ? (
            <>
              <button
                onClick={disconnect}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.15)", color: "#333333" }}
                title="Disconnect Ethereum Wallet"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse-slow" />
                <span className="font-mono">{wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.15)", color: "#dc2626" }}
                title="Logout and switch role"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={() => void connect()}
              disabled={connecting}
              className="btn-primary flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z" />
                <circle cx="17" cy="14" r="1.5" fill="currentColor" />
              </svg>
              {connecting ? "Connecting..." : "Connect Ethereum Wallet"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
