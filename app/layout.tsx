import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HEICO Institutional Ownership",
  description: "13F institutional holders for HEI and HEI/A from SEC EDGAR",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
