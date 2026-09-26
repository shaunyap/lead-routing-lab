import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Routing Lab",
  description: "Messy lead lists → visible hygiene → declarative policy → explainable routing → measurable evals → safe CRM action.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
