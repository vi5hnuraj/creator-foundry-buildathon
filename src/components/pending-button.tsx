"use client";

import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./spinner";

/**
 * Standard button for actions that hit an on-chain endpoint (FRONTEND_SPEC: every
 * such action shows a pending state and disables re-submission). While `pending`,
 * it shows a spinner + label and is disabled so it can't be double-submitted.
 */
export function PendingButton({
  pending,
  pendingLabel,
  children,
  className = "btn-primary",
  disabled,
  ...rest
}: {
  pending: boolean;
  pendingLabel: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={className} disabled={pending || disabled} {...rest}>
      {pending ? (
        <>
          <Spinner /> {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
