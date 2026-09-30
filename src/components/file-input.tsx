"use client";

import { useRef, useState } from "react";

/**
 * File input styled to the design system. The native input (which renders an
 * OS-language grey control like "Sin archivos seleccionados") is hidden; a
 * styled button triggers it and the chosen filename shows in app typography.
 * English only.
 */
export function FileInput({
  accept,
  disabled,
  onChange,
  label = "Choose file",
}: {
  accept?: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-ghost shrink-0"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        {label}
      </button>
      <span className="truncate text-sm text-t3">{name ?? "No file chosen"}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setName(f?.name ?? null);
          onChange(f);
        }}
      />
    </div>
  );
}
