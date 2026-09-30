/**
 * SLUGS — human-readable work URLs (pure, client-safe helpers)
 *
 * Instead of exposing UUIDs (/work/58083ed7-e5e9-46b6-a228-bcc23f1e6201/store)
 * every work gets a kebab-case handle derived from its title:
 *   "Neon Requiem" -> /work/neon-requiem/store
 *
 * Server-side slug/UUID resolution lives in slug-server.ts — keep this module
 * free of any supabase/node imports so client components can use it.
 */

export function slugifyTitle(title: string): string {
  return (
    title
      // "Neon Requiem (cyberpunk action RPG)" -> "neon-requiem", not the
      // whole qualification — the qualifier belongs in the subtitle.
      .replace(/[(\[].*?[)\]]/g, " ")
      .toLowerCase()
      .normalize("NFKD")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/^-+|-+$/g, "")
  )
    // slice may re-introduce a trailing dash
    .replace(/^-+|-+$/g, "");
}

/** True when `param` looks like a UUID rather than a slug. */
export function isUuid(param: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param);
}

/**
 * Canonical URL segment for a work row: its slug, falling back to the id.
 * Accepts partial rows (works /works list selects only a few columns).
 */
export function workHref(work: { id: string; slug?: string | null }): string {
  return `/work/${work.slug || work.id}`;
}
