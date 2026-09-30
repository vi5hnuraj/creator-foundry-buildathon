import { servedUrl, isImagePath, fileIcon } from "@/lib/files";

/**
 * Deliverable preview: the served image when it's an image, otherwise a type
 * icon + filename. Shared by the Review modal (large) and the artist's minted
 * rows (compact) — size via `className` on the box.
 */
export function AssetPreview({
  path,
  alt,
  className = "h-40 w-full",
}: {
  path: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const url = servedUrl(path);
  const name = (path ?? "").split("/").pop() || "No preview";

  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-surface-inset ${className}`}
    >
      {url && isImagePath(path) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt ?? ""} className="h-full w-full object-contain" />
      ) : (
        <div className="flex flex-col items-center justify-center p-2 text-center">
          <span className="text-2xl">{fileIcon(path)}</span>
          <span className="rf-data mt-1 max-w-full truncate text-[10px] text-t4">
            {name}
          </span>
        </div>
      )}
    </div>
  );
}
