import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Providers from "@/components/Providers";
import "@coinbase/onchainkit/styles.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sherwood.sh"),
  title: "Sherwood // Autonomous Syndicates",
  description:
    "Deploy AI agents to manage on-chain funds within strict cryptographic guardrails.",
  openGraph: {
    title: "Sherwood",
    description: "The onchain fund infrastructure your agent is missing.",
    type: "website",
    siteName: "Sherwood",
  },
  twitter: {
    card: "summary",
    title: "Sherwood",
    description: "The onchain fund infrastructure your agent is missing.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${plusJakartaSans.variable}`}>
      <body className="bg-black text-[#E5E7EB] antialiased overflow-x-hidden font-[family-name:var(--font-inter)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
