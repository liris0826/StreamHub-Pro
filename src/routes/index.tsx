import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, AudioLines, Link2, MonitorPlay } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StreamHub — Stream any video link instantly" },
      { name: "description", content: "Paste a direct video URL (MKV, MP4, WebM) and stream it in the browser with dual audio tracks support." },
      { property: "og:title", content: "StreamHub — Stream any video link instantly" },
      { property: "og:description", content: "Direct URL streaming with dual audio track support." },
    ],
  }),
  component: Index,
});

const SAMPLE =
  "https://pub-7d78ae74ce5542fc81b4c671ea8c3d70.r2.dev/u1gssa/%28FilmyFly.CA%29%20Dorothy%20%282026%29%20%28Hindi%20%2B%20Tamil%29%20Dual%20Audio%20UnCut%20South%20Movie%20HD%20720p%20ESub.mkv?expired=H6adf3af6365501.4895663391eb2c95f4bcaeb5&userid=8142144072254&vaid=6adf3af63657c8.00841258&token=7858062502";

function Index() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  const go = (e?: React.FormEvent) => {
    e?.preventDefault();
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
      navigate({ to: "/watch", search: { url: u.toString() } });
    } catch {
      setErr("Paste a full link starting with http:// or https://");
    }
  };

  return (
    <main className="hero-bg flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 py-6">
        <MonitorPlay className="h-6 w-6 text-primary" />
        <span className="font-display text-xl tracking-tight">StreamHub</span>
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 pb-24">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.3em] text-primary">Direct URL streaming</p>
        <h1 className="font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl">
          Paste a link.<br /><span className="text-gradient">Press stream.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          MKV, MP4 and WebM stream straight in your browser — switch between dual audio tracks without restarting.
        </p>
        <form onSubmit={go} className="url-box mt-10">
          <Link2 className="ml-4 h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setErr(""); }}
            placeholder="https://example.com/movie.mkv"
            aria-label="Video URL"
            className="min-w-0 flex-1 bg-transparent px-3 py-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" className="btn-hero">Stream <ArrowRight className="h-4 w-4" /></button>
        </form>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        <button onClick={() => setUrl(SAMPLE)} className="mt-4 self-start text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
          Try a dual-audio sample
        </button>
        <div className="mt-14 grid gap-3 sm:grid-cols-3">
          {[
            ["Dual audio", "Swap languages mid-movie, position kept."],
            ["Any host", "Links without CORS are relayed automatically."],
          ].map(([t, d]) => (
            <div key={t} className="feature-card">
              <AudioLines className="h-4 w-4 text-primary" />
              <p className="mt-3 font-display text-base">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
