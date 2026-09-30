"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/use-identity";
import { ConnectWallet } from "./connect-wallet";

const NAV = [
  { href: "/works", label: "Producer Desk" },
  { href: "/artist", label: "Contributor Hub" },
];

export function TopNav() {
  const { isConnected } = useIdentity();
  const pathname = usePathname();

  const active = (href: string) => pathname.startsWith(href);

  return (
    <header
      className="sticky top-0 z-10 border-b border-[color:var(--border-subtle)]"
      style={{ background: "var(--glass-bg)", backdropFilter: "blur(12px)" }}
    >
      <nav className="mx-auto flex w-full max-w-[1800px] items-center justify-between px-6 py-4 md:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/logo-mark.svg" alt="" className="h-7 w-7" />
            <span className="rf-display text-2xl leading-none text-t1">
              Creator Foundry
            </span>
          </Link>

          {isConnected && (
            <div className="flex items-center gap-1">
              {NAV.map((item) => {
                const isActive = active(item.href);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                      isActive
                        ? "bg-[color:var(--surface-hover)] text-t1"
                        : "text-t3 hover:text-t1"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ConnectWallet />
        </div>
      </nav>
    </header>
  );
}
