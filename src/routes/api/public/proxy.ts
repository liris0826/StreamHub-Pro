import { createFileRoute } from "@tanstack/react-router";

// Streaming pass-through for video hosts that don't send CORS headers.
// Forwards Range so seeking works; only http(s) GET/HEAD are allowed.
// Range requests are NOT edge-cached: with cacheEverything Cloudflare downloads the WHOLE file
// to the edge before answering the first byte range, which made start-up and every seek very slow
// on big movies. Ranges stream straight through; only small whole-file responses are cached.
const EDGE_TTL = 60 * 60 * 24; // 1 day for successful responses
const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

async function handle(request: Request) {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("Unsupported protocol", { status: 400 });
  }
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 StreamDeck" };
  const range = request.headers.get("range");
  if (range) headers["range"] = range;
  const noCache = new URL(request.url).searchParams.has("nocache") || !!range;
  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      method: request.method,
      headers,
      redirect: "follow",
      // Stop pulling from the origin when the viewer seeks away or closes the tab.
      signal: request.signal,
      // Ignored outside Cloudflare (local dev).
      cf: noCache
        ? { cacheTtl: 0, cacheEverything: false }
        : { cacheEverything: true, cacheTtlByStatus: { "200-299": EDGE_TTL, "404": 60, "500-599": 0 } },
    } as RequestInit);
  } catch {
    return new Response("Upstream unreachable", { status: 502, headers: { "access-control-allow-origin": "*" } });
  }
  const out = new Headers();
  for (const h of PASS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("access-control-allow-origin", "*");
  out.set("vary", "range");
  out.set("access-control-expose-headers", [...PASS, "x-edge-cache"].join(", "));
  out.set(
    "cache-control",
    upstream.ok && !noCache && !range ? `public, max-age=3600, s-maxage=${EDGE_TTL}` : "no-store",
  );
  const cfStatus = upstream.headers.get("cf-cache-status");
  if (cfStatus) out.set("x-edge-cache", cfStatus);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

export const Route = createFileRoute("/api/public/proxy")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
            "access-control-allow-headers": "range",
          },
        }),
    },
  },
});
