import { servedUrl, isImagePath, fileIcon } from "@/lib/files";

/**
 * Small asset preview: image thumbnail when the file is an image, otherwise a
 * type icon. Uses the served URL derived from the stored disk path.
 */
export function AssetThumb({
  path,
  size = 40,
}: {
  path: string | null | undefined;
  size?: number;
}) {
  const url = servedUrl(path);
  const style = { width: size, height: size };

  if (url && isImagePath(path)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        style={style}
        className="shrink-0 rounded-md border border-[color:var(--border-subtle)] object-cover"
      />
    );
  }
  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-md border border-[color:var(--border-subtle)] bg-surface-inset text-base"
    >
      {fileIcon(path)}
    </div>
  );
}
