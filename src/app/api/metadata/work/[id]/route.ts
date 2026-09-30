import { NextRequest, NextResponse } from "next/server";
import { resolveWorkParam } from "@/lib/slug-server";
import { workHref } from "@/lib/slug";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Slug or UUID — explorer clients may store either form.
  const resolved = await resolveWorkParam(params.id);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("works")
    .select("id, slug, title, description, cover_path")
    .eq("id", resolved.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const baseUrl = _req.nextUrl.origin;
  const imageUrl = data.cover_path
    ? `${baseUrl}/api/files/${data.cover_path}`
    : `${baseUrl}/og-image.png`;

  return NextResponse.json({
    name: data.title,
    description: data.description || `Creator Foundry collection — ${data.title}`,
    image: imageUrl,
    external_url: `${baseUrl}${workHref(data as { id: string; slug?: string | null })}`,
  });
}
