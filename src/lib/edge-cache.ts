// Cloudflare edge cache helpers (Workers + Pages Functions).
// Uses the Cache API (caches.default) when running on Cloudflare; no-ops elsewhere (local dev).

type Ctx = { waitUntil?: (p: Promise<unknown>) => void } | undefined;

export const HTML_TTL = 60; // seconds pages are kept at the edge
export const HTML_SWR = 300; // serve stale while refreshing in background

function edgeCache(): Cache | undefined {
  const c = (globalThis as unknown as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default;
}

function isCacheable(request: Request): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false; // API routes manage their own caching
  if (url.pathname.startsWith("/_serverFn")) return false;
  if (url.searchParams.has("nocache")) return false;
  if (request.headers.get("cookie")) return false; // never share personalised pages
  if (request.headers.get("authorization")) return false;
  return true;
}

/** Serve SSR pages from the Cloudflare edge cache, filling it on miss. */
export async function withEdgeCache(
  request: Request,
  ctx: Ctx,
  render: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache();
  if (!cache || !isCacheable(request)) return render();

  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    const out = new Response(hit.body, hit);
    out.headers.set("x-edge-cache", "HIT");
    return out;
  }

  const response = await render();
  const type = response.headers.get("content-type") ?? "";
  const storable =
    response.status === 200 &&
    type.includes("text/html") &&
    !response.headers.has("set-cookie") &&
    !/no-store|private/i.test(response.headers.get("cache-control") ?? "");

  const out = new Response(response.body, response);
  if (!storable) {
    out.headers.set("x-edge-cache", "BYPASS");
    return out;
  }
  out.headers.set(
    "cache-control",
    `public, max-age=0, s-maxage=${HTML_TTL}, stale-while-revalidate=${HTML_SWR}`,
  );
  out.headers.set("x-edge-cache", "MISS");
  const put = cache.put(key, out.clone()).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(put);
  else await put;
  return out;
}
