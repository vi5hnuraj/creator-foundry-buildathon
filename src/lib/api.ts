/**
 * Thin client-side fetch helpers for the /api/* routes. Centralizes the
 * convention that error responses are { error: string } with a 4xx/5xx status,
 * surfacing that message as a thrown Error so screens can show it directly.
 *
 * Screens call these — never the service layer — keeping business logic in the
 * backend (every mutation goes through an /api/* route handler).
 */

/**
 * Surface error responses as one human-readable sentence for the UI, and
 * map common on-chain failures to plain language. Presentation only — the full
 * error is still logged by the backend.
 */
export function cleanError(message: string): string {
  let prefix = "";
  let core = message;

  // If a JSON object is embedded, lift its `message` field.
  const braceIdx = message.indexOf("{");
  if (braceIdx !== -1) {
    try {
      const obj = JSON.parse(message.slice(braceIdx)) as { message?: unknown };
      if (typeof obj.message === "string") {
        prefix = message.slice(0, braceIdx).trim();
        core = obj.message;
      }
    } catch {
      /* not JSON — keep the original text */
    }
  }

  if (/exceeds the balance|insufficient funds/i.test(core)) {
    core =
      "Insufficient funds — the signer wallet doesn't have enough testnet ETH for the price plus gas.";
  } else {
    core = core.split("\n")[0].trim();
  }

  return prefix ? `${prefix} ${core}` : core;
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(cleanError(json?.error ?? `Request failed (${res.status})`));
  }
  return json as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
  );
}

export type UploadResult = {
  path: string; // storage object key for the backend (see /api/upload)
  url: string; // browser URL (served by /api/files)
  filename: string;
  contentType: string;
  isImage: boolean;
};

/** Upload one file to /api/upload, returning its disk path + served URL. */
export async function apiUpload(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  return parse<UploadResult>(
    await fetch("/api/upload", { method: "POST", body: fd })
  );
}
