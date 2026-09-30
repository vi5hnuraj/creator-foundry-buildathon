"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Reusable modal shell used by the create-work form, Review, and Deliver flows.
 * Closes on backdrop click or Escape. Content scrolls if overflow.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] rounded-2xl border border-white/10 bg-[#0d0d12] p-6 shadow-2xl shadow-black/50 flex flex-col">
        <div className="flex items-center justify-between gap-4 shrink-0">
          <h2 className="text-base font-bold text-t1 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-t4 transition-colors hover:text-t1 rounded-lg hover:bg-white/[0.06]"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 -mx-6 px-6">
          {children}
        </div>
      </div>
    </div>
  );
}
