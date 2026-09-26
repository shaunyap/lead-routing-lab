import { ImageResponse } from "next/og";

export const alt = "Lead Routing Lab — messy lead lists in, safe CRM actions out";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Link-preview card for Slack, LinkedIn and email. Rendered once at build time.
export default function OpengraphImage() {
  const steps = ["Leads", "Hygiene", "Routing", "Exceptions", "Salesforce"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: "72px 80px", background: "#fcfcfb", color: "#0b0b0b", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center",
              background: "linear-gradient(135deg, #2a78d6, #1baf7a)", color: "white", fontSize: 38, fontWeight: 700,
            }}
          >
            →
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>Lead Routing Lab</div>
        </div>
          <div style={{ fontSize: 24, color: "#85847e" }}>Prepared for LangChain by Shaun Yap</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
            Messy lead data in, safe CRM actions out
          </div>
          <div style={{ fontSize: 30, color: "#52514e" }}>
            Declarative policy, explainable routing, and evals that show when a rule change helps or hurts.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {steps.map((s) => (
              <div key={s} style={{ padding: "10px 20px", borderRadius: 999, background: "#e3eefb", color: "#1c5cab", fontSize: 24, fontWeight: 600 }}>
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
