import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const description =
  "Messy lead lists in, safe CRM actions out: visible hygiene, declarative policy, explainable routing and evals. Built by Shaun Yap.";

export const metadata: Metadata = {
  title: "Lead Routing Lab",
  description,
  openGraph: { title: "Lead Routing Lab", description, type: "website" },
  twitter: { card: "summary_large_image", title: "Lead Routing Lab", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
