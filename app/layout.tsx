import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Inter, Public_Sans, Source_Serif_4 } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import { Header } from "@/components/Header";
import { TermsGate } from "@/components/TermsGate";
import "./globals.css";

const sans = Public_Sans({ variable: "--font-sans", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });
// The midterms tracker's election mode only; not preloaded, so other pages never download it.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: { default: "Ballotwise: a nonpartisan guide to any race", template: "%s · Ballotwise" },
  description:
    "Look up any race and see where every candidate stands, side by side, with a link for every fact. Answer a few questions to see who agrees with you most.",
  metadataBase: new URL("https://ballotwise.xanom.co"),
  openGraph: { type: "website", siteName: "Ballotwise" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${inter.variable}`}>
      <body>
        <AccountProvider>
          <Header />
          <main>
            <TermsGate>{children}</TermsGate>
          </main>
          <footer className="site-footer">
            <div className="wrap">
              <span>Ballotwise is nonpartisan and not affiliated with any campaign, party, or election office.</span>
              <span className="footer-links">
                <Link href="/method">How it works</Link>
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
                <Link href="/account">Account</Link>
              </span>
            </div>
          </footer>
        </AccountProvider>
        <Script src="https://analytics.n3el.dev/p.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
