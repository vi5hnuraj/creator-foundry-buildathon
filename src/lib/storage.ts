import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { supabase } from "./supabase";
import { ASSET_BUCKET } from "./files";

/**
 * Supabase Storage adapter — BACKEND ONLY (uses the service-role client). Never
 * import from a client component.
 *
 * Uploaded files live in the `assets` bucket (public read). Supabase is the
 * source of truth; the browser previews via the public URL. Mint-time integrity
 * checks and the Python critic both need raw BYTES rather than a URL, so the
 * object is streamed to a temp file (see downloadToTemp) and handed to those
 * consumers as a local path.
 * The bucket name lives in ./files (client-safe) so previews can build URLs.
 */

/** Upload one file; returns the object key (stored in the DB) + public URL. */
export async function uploadToBucket(
  file: File
): Promise<{ key: string; publicUrl: string }> {
  const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${randomUUID()}-${safeName}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(key, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(key);
  return { key, publicUrl: data.publicUrl };
}

/**
 * Download an object to a temp file (os.tmpdir()) and return its path. The
 * caller MUST delete it afterwards (use removeTemp in a finally). Throws a clear
 * error if the object is missing, so the mint fails cleanly rather than half-way.
 */
export async function downloadToTemp(key: string): Promise<string> {
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(key);
  if (error || !data) {
    throw new Error(
      `Could not fetch "${key}" from storage: ${error?.message ?? "object not found"}`
    );
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const tmpPath = path.join(
    os.tmpdir(),
    `foundry-${randomUUID()}-${path.basename(key)}`
  );
  await writeFile(tmpPath, bytes);
  return tmpPath;
}

/** Best-effort cleanup of a temp file. */
export async function removeTemp(tmpPath: string | null): Promise<void> {
  if (!tmpPath) return;
  await unlink(tmpPath).catch(() => {});
}
