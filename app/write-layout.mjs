import fs from "fs";
const content = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HarbourRWA | Institutional RWA Tokenisation Platform",
  description:
    "Enterprise-grade RWA tokenisation platform for professional investors. SFC compliant on Mantle Network.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased" style={{ background: "#f0f4f8" }}>

        {/* ── iCapital-style dark navy navigation ── */}
        <nav style={{ background: "#071223", borderBottom: "1px solid #0d1e30" }} className="sticky top-0 z-50">
          <div className="max-w-[1280px] mx-auto px-6 flex items-center justify-between" style={{ height: "56px" }}>

            {/* Left: logo + primary links */}
            <div className="flex items-center gap-8">
              <a href="/" className="flex items-center gap-2.5 shrink-0">
                <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-white text-sm"
                  style={{ background: "#0098a6" }}>
                  H
                </div>
                <span className="text-white font-semibold text-sm tracking-tight">HarbourRWA</span>
              </a>

              {/* Nav groups like iCapital: Learn | Invest | Manage */}
              <div className="hidden md:flex items-center">
                {[
                  { href: "/compliance", label: "Compliance" },
                  { href: "/tokenize",   label: "Tokenise"   },
                  { href: "/audit",      label: "Audit"      },
                  { href: "/kyc",        label: "KYC"        },
                  { href: "/subscribe",  label: "Subscribe"  },
                  { href: "/portfolio",  label: "Portfolio"  },
                ].map(({ href, label }) => (
                  <a key={href} href={href}
                    className="px-4 py-5 text-[13px] text-[#9ab0c8] transition-colors relative group"
                    style={{ display: "inline-flex", alignItems: "center" }}>
                    <span className="group-hover:text-white transition-colors">{label}</span>
                    <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#0098a6] scale-x-0 group-hover:scale-x-100 transition-transform origin-center" />
                  </a>
                ))}
              </div>
            </div>

            {/* Right: Admin + chain */}
            <div className="flex items-center gap-4">
              <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#4a6480]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                Mantle Sepolia
              </span>
              <a href="/admin/kyc"
                className="px-3.5 py-1.5 text-[12px] font-semibold rounded transition-colors"
                style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.30)" }}>
                Admin
              </a>
              {/* Avatar placeholder */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ background: "#1564a0" }}>
                A
              </div>
            </div>
          </div>
        </nav>

        <main style={{ minHeight: "calc(100vh - 56px)" }}>{children}</main>

        <footer style={{ background: "#071223", borderTop: "1px solid #0d1e30" }} className="mt-16 py-6">
          <div className="max-w-[1280px] mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-[11px]" style={{ color: "#4a6480" }}>
            <span>&#169; 2026 Harbour Capital Markets Corporation &middot; HarbourRWA</span>
            <div className="flex items-center gap-6">
              <span>Mantle Network</span>
              <span>SFC Circular (Oct 2023)</span>
              <a href="https://mantlescan.xyz" target="_blank" rel="noopener noreferrer"
                className="hover:text-white transition-colors">Explorer &#8599;</a>
            </div>
          </div>
        </footer>

      </body>
    </html>
  );
}
`;
fs.writeFileSync("src/app/layout.tsx", content, "utf8");
console.log("layout.tsx written");
