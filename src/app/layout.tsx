import type { Metadata } from "next";
import "./globals.css";
// Design system loads AFTER globals.css so its base.css (plum canvas, serif
// headings, .rf-* utilities) wins over Tailwind's preflight reset.
import "../styles/design-system/styles.css";
import { Providers } from "./providers";
import { TopNav } from "@/components/top-nav";


export const metadata: Metadata = {
  title: "Creator Foundry — AI-First Creative Production Platform",
  description:
    "An AI-First Creative Production Platform powered by Foundry Intelligence. Plan productions, draft storylines, audit visual assets with the AI Critic, and distribute royalty shares on-chain.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TopNav />
          <main className="rf-aurora mx-auto w-full max-w-[1800px] px-6 md:px-8 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
