"use client";

import type { SelectHTMLAttributes } from "react";

/**
 * Select styled to the design system: the native control is given token styling
 * via `.input`, the native chevron is removed (appearance-none) and replaced
 * with our own, so it stops rendering as an off-system grey control.
 */
export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={`input cursor-pointer appearance-none pr-9 ${className}`} {...rest}>
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-t3">
        ▾
      </span>
    </div>
  );
}
