import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withEdgeCache } from "./lib/edge-cache";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// The player's decoder only runs on background threads when the page is "cross-origin isolated"
// (needs SharedArrayBuffer). Without these headers every frame of 8-bit/10-bit video and all audio
// are decoded on the page's main thread, which starves the sound and makes it cut out every second.
// "credentialless" keeps Google Fonts and direct video hosts working without extra CORS headers.
function withIsolation(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  out.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  out.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await withEdgeCache(
        request,
        ctx as { waitUntil?: (p: Promise<unknown>) => void },
        async () => normalizeCatastrophicSsrResponse(await handler.fetch(request, env, ctx)),
      );
      return withIsolation(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
