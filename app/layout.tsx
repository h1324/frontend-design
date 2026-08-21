import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Display: Archivo — a grotesque with industrial-signage character, used with restraint for the
// wordmark, page titles and big stat numbers.
const display = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
// UI/body: IBM Plex Sans — engineered, hardware lineage; the workhorse for dense operational data.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
// Data: IBM Plex Mono — doc numbers, quantities, ₹ amounts and codes, where alignment reads as
// instrumentation and tabular figures line up.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EPE Foam ERP",
  description: "Manufacturing operations system for an EPE foam sheet plant",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
