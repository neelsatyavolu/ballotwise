import type { Metadata } from "next";
import Link from "next/link";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import { Header } from "@/components/Header";
import "./globals.css";

const sans = Public_Sans({ variable: "--font-sans", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Ballotwise: a nonpartisan guide to any race", template: "%s · Ballotwise" },
  description:
    "Look up any race and see where every candidate stands, side by side, with a link for every fact. Answer a few questions to see who agrees with you most.",
  metadataBase: new URL("https://ballotwise.xanom.co"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <AccountProvider>
          <Header />
          <main>{children}</main>
          <footer className="site-footer">
            <div className="wrap">
              <span>Ballotwise is nonpartisan and not affiliated with any campaign, party, or election office.</span>
              <Link href="/method">How it works</Link>
            </div>
          </footer>
        </AccountProvider>
      </body>
    </html>
  );
}
