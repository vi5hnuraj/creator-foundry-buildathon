/**
 * Server-only slug resolution. Split from slug.ts because client components
 * import the pure helpers — a supabase (node:fs) import here would break the
 * production client build with UnhandledSchemeError for "node:path".
 */
import { supabase } from "./supabase";
import { isUuid } from "./slug";

export type WorkIdentifier = { id: string; slug: string | null };

/** Persist a unique slug for `workId` derived from its title. */
export async function ensureWorkSlug(
  workId: string,
  title: string,
  knownSlugs?: Set<string>
): Promise<string | null> {
  const { slugifyTitle } = await import("./slug");
  const base = slugifyTitle(title) || workId;
  let slug = base;
  for (let n = 2; ; n++) {
    const { data } = await supabase
      .from("works")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!data || data.id === workId) break;
    slug = `${base}-${n}`;
  }
  const { error } = await supabase.from("works").update({ slug }).eq("id", workId);
  return error ? null : slug;
}

/**
 * Resolve a route / API parameter to a work, accepting BOTH the UUID (legacy
 * links, explorer metadata) and the slug. Never a 404 just because the caller
 * passed the pretty form.
 */
export async function resolveWorkParam(param: string): Promise<WorkIdentifier | null> {
  if (isUuid(param)) {
    const { data } = await supabase
      .from("works")
      .select("id, slug")
      .eq("id", param)
      .maybeSingle();
    return data ? { id: data.id, slug: (data as any).slug ?? null } : null;
  }
  const { data } = await supabase
    .from("works")
    .select("id, slug")
    .eq("slug", param)
    .maybeSingle();
  return data ? { id: data.id, slug: (data as any).slug ?? param } : null;
}
