import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * GET /api/files/<name> — the READ side of the asset pipeline. Streams a stored
 * file to the browser so the Review preview, thumbnails and downloads all work
 * off the same bytes the mint and the critic score. Writes happen in
 * POST /api/upload; see src/lib/storage.ts for the storage adapter.
 */
export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  usdz: "model/vnd.usdz+zip",
  pdf: "application/pdf",
  zip: "application/zip",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const rel = params.path.join("/");
  const abs = path.join(UPLOAD_DIR, rel);

  // Guard against path traversal — abs must stay inside the uploads dir.
  if (abs !== UPLOAD_DIR && !abs.startsWith(UPLOAD_DIR + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await stat(abs);
    const data = await readFile(abs);
    const e = (rel.split(".").pop() ?? "").toLowerCase();
    const type = CONTENT_TYPES[e] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
