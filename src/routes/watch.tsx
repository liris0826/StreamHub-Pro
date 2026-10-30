import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { StreamPlayer } from "@/components/StreamPlayer";
import { fileNameFromUrl } from "@/lib/avplayer";
import { NoVideo } from "./index";

export const Route = createFileRoute("/watch")({
  validateSearch: (s: Record<string, unknown>) => ({ url: typeof s["url"] === "string" ? (s["url"] as string) : "" }),
  head: () => ({
    meta: [
      { title: "Now streaming" },
      { name: "description", content: "Watch a direct video link with dual audio tracks support." },
      { property: "og:title", content: "Now streaming — ReelLink" },
      { property: "og:description", content: "Watch a direct video link with dual audio tracks switching." },
    ],
  }),
  component: Watch,
});

async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}

function Watch() {
  const { url } = Route.useSearch();
  const name = url ? fileNameFromUrl(url) : "";

  const copyShareLink = async () => {
    const ok = await copyText(window.location.href);
    if (ok) toast.success("Share link copied");
    else window.prompt("Copy this link to share:", window.location.href);
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="mx-auto max-w-6xl px-4 py-4 pb-16 sm:px-6">
        {!url ? (
          <NoVideo />
        ) : (
          <>
            <ClientOnly fallback={<div className="player-shell" />}>
              <StreamPlayer url={url} />
            </ClientOnly>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={copyShareLink}>
                <Copy className="h-4 w-4" /> Copy share link
              </button>
              <a className="btn-ghost" href={url} target="_blank" rel="noreferrer" download={name || undefined}>
                <Download className="h-4 w-4" /> Download
              </a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
