import { NextRequest, NextResponse } from "next/server";
import { uploadToBucket } from "@/lib/storage";

/**
 * POST /api/upload  (multipart/form-data, field "file")
 *
 * Uploads one file to Supabase Storage (the `assets` bucket) and returns:
 *   - path: the object KEY (stored in the DB — delivery_path / reference_path /
 *           imagePath). At mint time the backend downloads it to a temp file so
 *           the bytes can be hashed and minted (see storage.ts downloadToTemp).
 *   - url:  the public URL the browser uses for previews / downloads.
 *
 * Storage is durable across ephemeral hosts (Vercel/Railway), unlike local disk.
 * The Supabase Storage client is server-only (service key in src/lib/supabase.ts).
 */
export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — game-dev assets can be large

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a 'file' field" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` },
      { status: 400 }
    );
  }

  // Any file type is accepted: images become NFT media directly; other assets
  // (FBX, audio, …) are stored + served, with an image used for the mint.
  try {
    const { key, publicUrl } = await uploadToBucket(file);
    return NextResponse.json({
      path: key,
      url: publicUrl,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      isImage: file.type.startsWith("image/"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Failed to store upload: ${message}` }, { status: 500 });
  }
}
