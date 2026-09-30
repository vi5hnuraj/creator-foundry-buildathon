/**
 * Helpers for uploaded-file display. Files live in Supabase Storage; the DB
 * stores the object KEY, and the browser reads them via the bucket's public URL.
 * (Client-safe module — no Supabase client import, just the public URL shape.)
 */

/** Supabase Storage bucket for uploaded assets (public read). */
export const ASSET_BUCKET = "assets";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

export function ext(path: string | null | undefined): string {
  if (!path) return "";
  const m = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function isImagePath(path: string | null | undefined): boolean {
  return IMAGE_EXT.has(ext(path));
}

/**
 * Resolve a stored reference to a browser URL. Accepts either a full URL
 * (e.g. delivery_ipfs holds the public URL) or a Supabase Storage object key
 * (e.g. delivery_path / reference_path), which is mapped to the bucket's public
 * URL. Returns null if there's nothing to show.
 */
export function servedUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  if (!SUPABASE_URL) return ref.startsWith("/") ? ref : `/api/files/${ref}`;
  return `${SUPABASE_URL}/storage/v1/object/public/${ASSET_BUCKET}/${ref}`;
}

/** Short uppercase type label (e.g. "FBX", "MP3"). */
export function fileTypeLabel(path: string | null | undefined): string {
  const e = ext(path);
  return e ? e.toUpperCase() : "FILE";
}

/** Emoji icon for a non-image file type. */
export function fileIcon(path: string | null | undefined): string {
  const e = ext(path);
  if (["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(e)) return "🎵";
  if (["glb", "gltf", "fbx", "obj", "usdz", "blend"].includes(e)) return "🧊";
  if (["mp4", "mov", "webm", "avi"].includes(e)) return "🎬";
  if (e === "pdf") return "📄";
  if (["zip", "rar", "7z"].includes(e)) return "🗜️";
  return "📦";
}
