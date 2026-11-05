import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Inter, Public_Sans } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import { Header } from "@/components/Header";
import { TermsGate } from "@/components/TermsGate";
import "./globals.css";

// Public Sans sets the site header only; Inter sets everything else, as on the midterms tracker.
const sans = Public_Sans({ variable: "--font-sans", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

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
    <html lang="en" className={`${sans.variable} ${inter.variable}`}>
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
                {/* Not prefetched: every page view would otherwise render each of these on the server. */}
                <Link href="/midterms" prefetch={false}>Midterms</Link>
                <Link href="/method" prefetch={false}>How it works</Link>
                <Link href="/terms" prefetch={false}>Terms</Link>
                <Link href="/privacy" prefetch={false}>Privacy</Link>
                <Link href="/account" prefetch={false}>Account</Link>
              </span>
            </div>
          </footer>
        </AccountProvider>
        <Script src="https://analytics.n3el.dev/p.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
