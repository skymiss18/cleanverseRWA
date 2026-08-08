"use client";
import { useState } from "react";

export default function DemoModeBanner() {
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem("demo-banner-dismissed") !== "1";
  });

  if (!visible) return null;

  return (
    <div
      className="relative flex items-center justify-center gap-2.5 px-4 py-2 text-[12px] font-medium"
      style={{
        background: "#f0ede6",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        color: "#555555",
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{
          background: "rgba(0,0,0,0.07)",
          border: "1px solid rgba(0,0,0,0.12)",
          color: "#444444",
          flexShrink: 0,
        }}
      >
        <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse-slow" />
        DEMO
      </span>
      <span>
        Explore freely — no real transactions or funds involved
      </span>
      <button
        onClick={() => {
          sessionStorage.setItem("demo-banner-dismissed", "1");
          setVisible(false);
        }}
        className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors text-lg leading-none"
        style={{ color: "#999999" }}
        onMouseEnter={e => (e.currentTarget.style.color = "#333333")}
        onMouseLeave={e => (e.currentTarget.style.color = "#999999")}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
