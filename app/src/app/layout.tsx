import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";
import Providers from "@/components/Providers";
import { RoleProvider } from "@/lib/role-context";
import { RoleGuard } from "@/components/RoleGuard";

export const metadata: Metadata = {
  title: "NexusRWA | Institutional RWA Tokenisation Platform",
  description:
    "Enterprise-grade RWA tokenisation platform for professional investors. SFC compliant on Ethereum Sepolia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Lora:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>
          <RoleProvider>
            <RoleGuard>
              {/* Nav */}
              <NavBar />

              <main>{children}</main>

              <footer
                style={{ borderTop: "1px solid rgba(0,0,0,0.08)", background: "#f0ede6" }}
                className="mt-20 py-6 relative z-10"
              >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px]" style={{ color: "#888888" }}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center"
                      style={{ background: "#111111" }}
                    >
                      <svg viewBox="0 0 10 10" className="w-3 h-3" fill="none">
                        <rect x="1" y="1" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.9" />
                        <rect x="5.5" y="1" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.5" />
                        <rect x="1" y="5.5" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.5" />
                        <rect x="5.5" y="5.5" width="3.5" height="3.5" rx="0.5" fill="white" opacity="0.9" />
                      </svg>
                    </div>
                    <span>© 2026 Nexus Capital Markets Corporation · NexusRWA</span>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-emerald-500" />
                      Ethereum Sepolia
                    </span>
                    <span>SFC Circular (Oct 2023)</span>
                  </div>
                </div>
              </footer>
            </RoleGuard>
          </RoleProvider>
        </Providers>
      </body>
    </html>
  );
}
