/* eslint-disable @typescript-eslint/no-explicit-any */
// Loads the bundled libmedia AVPlayer (public/avp) with a CDN fallback.
const SOURCES = ["/avp/avplayer.js", "https://cdn.jsdelivr.net/npm/@libmedia/avplayer@1.3.1/dist/umd/avplayer.js"];
let loading: Promise<any> | null = null;

export function loadAVPlayer(): Promise<any> {
  const w = window as any;
  if (w.AVPlayer) return Promise.resolve(w.AVPlayer);
  if (loading) return loading;
  loading = new Promise((ok, no) => {
    const tryLoad = (i: number) => {
      if (i >= SOURCES.length) return no(new Error("Player failed to load"));
      const sc = document.createElement("script");
      sc.src = SOURCES[i]!;
      sc.crossOrigin = "anonymous";
      sc.onload = () => (w.AVPlayer ? ok(w.AVPlayer) : tryLoad(i + 1));
      sc.async = true;
      sc.onerror = () => { sc.remove(); tryLoad(i + 1); };
      document.head.appendChild(sc);
    };
    tryLoad(0);
  });
  // A failed load must not be cached forever, or every later video stays broken until a full reload.
  loading.catch(() => { loading = null; });
  return loading;
}

export type Track = { id: number; label: string };

export function isKind(t: any, kind: "audio" | "subtitle") {
  const want = kind === "audio" ? [1, "Audio", "audio"] : [3, "Subtitle", "subtitle"];
  return want.includes(t?.mediaType);
}

// Turns a language code like "hin" into "Hindi". Returns "" for unknown/undetermined codes.
function languageName(code: unknown) {
  const c = String(code || "").trim();
  if (!c || /^(und|unk|mis|zxx)$/i.test(c)) return "";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(c);
    if (name && name.toLowerCase() !== c.toLowerCase()) return name;
  } catch {
    /* not a valid language code */
  }
  return c;
}

// Shows only the language (e.g. "Hindi"); falls back to a cleaned title, then "Track N".
export function trackLabel(t: any, i: number) {
  const m = t?.metadata || {};
  return languageName(m.language) || trackTitle(m.title) || `Track ${i + 1}`;
}

export function durationFrom(streams: any[]) {
  let best = 0;
  for (const t of streams) {
    if (!t?.duration) continue;
    const d = Number(t.duration);
    if (!isFinite(d) || d <= 0) continue;
    const tb = t.timeBase;
    const secs = tb && Number(tb.den) > 0 ? (d * (Number(tb.num) || 1)) / Number(tb.den) : d / 1000;
    if (secs > best) best = secs;
  }
  return best;
}

export function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// Piracy/uploader site tags that get stamped onto file names, e.g. "(FilmyFly.CA)".
const SITE_NAMES = [
  "filmyfly", "filmy fly", "hdhub4u", "hd hub4u", "moviesdrive", "movies drive", "movies4u", "desiremovies", "desiresmovies",
  "filmycab", "extraflix", "cinevood", "vegamovies", "vega movies", "katmoviehd", "mkvcinemas", "bolly4u",
  "9xmovies", "world4ufree", "filmyzilla", "filmyhit", "filmywap", "filmy4wap", "moviesmod", "themoviesflix",
  "moviesflix", "hdmovies2", "skymovieshd", "7starhd", "mlwbd", "uhdmovies", "topmovies", "khatrimaza",
  "pikahd", "mkvking", "1tamilmv", "tamilmv", "tamilblasters", "tamilrockers", "isaimini", "moviesverse",
  "hdmovie2", "moviesbaba", "ssrmovies", "mp4moviez", "worldfree4u", "rdxhd", "jalshamoviez", "movierulz",
  "ibomma", "filmy4web", "dotmovies", "luxmovies", "mallumv", "hdhub", "4khdhub", "vegamovie",
];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s._-]?");
// Real domain endings only, so "Vegamovies.Movie.2026" keeps the word "Movie".
const TLD = "(?:com|net|org|in|co|ca|foo|to|ms|mx|bz|lol|cfd|sbs|xyz|fun|pro|me|io|tv|cc|ws|nl|re|cv|tl|ag|li|lat|mov|day|life|club|site|online|store|live|world|shop|click|link|top|win|vip|biz|info|art|bar|hair|mom|boo|dad|yt|ly|am|at|bid|cam|cyou|dev|diy|gd|gg|gl|gs|hn|ht|la|lc|lt|lu|mn|mu|nu|one|ph|pk|pl|pw|rs|ru|sh|si|sk|so|st|su|uk|us|vc|vg|wf|work|ink|icu|asia|autos|beauty|boats|quest|rest|skin|homes|monster|baby|buzz|wiki|dad|esq|zone|space|tech|digital|media|cloud|news)";
const SITE = `(?:www\\.)?(?:${SITE_NAMES.map(esc).join("|")})(?:\\.${TLD}){0,2}`;
const DOMAIN = `(?:www\\.)?[a-z0-9-]+(?:\\.[a-z]{2,10}){1,2}`;
const BRACKETED = new RegExp(`[\\[({]\\s*(?:[^\\])}]*?${SITE}[^\\])}]*?|${DOMAIN})\\s*[\\])}]`, "gi");
const LOOSE = new RegExp(`(^|[\\s._@-])${SITE}(?=$|[\\s._@-])`, "gi");
const WWW = /(^|[\s._@-])www\.[a-z0-9-]+(?:\.[a-z]{2,10}){1,2}(?=$|[\s_@-])/gi;

/** Removes site/domain tags like "(FilmyFly.CA)", "[Vegamovies.to]" or "www.HDHub4u.ms -" from a title. */
export function cleanTitle(name: string) {
  const out = name
    .replace(BRACKETED, " ")
    .replace(LOOSE, "$1")
    .replace(WWW, "$1")
    .replace(/[\s]{2,}/g, " ")
    .replace(/^[\s._@:|~-]+/, "")
    .replace(/[\s._@:|~-]+(?=\.[a-z0-9]{2,4}$)/i, "")
    .replace(/[\s_@:|~·-]+$/, "")
    .trim();
  return out || "Video";
}

/** Like cleanTitle, but returns "" when nothing but a site tag is left (used for audio/subtitle names). */
function trackTitle(title: unknown) {
  return String(title || "")
    .replace(BRACKETED, " ")
    .replace(LOOSE, "$1")
    .replace(WWW, "$1")
    .replace(/[\s._@:|~·-]+$/, "")
    .replace(/^[\s._@:|~·-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function fileNameFromUrl(url: string) {
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop() || "Video";
    let name = p;
    try { name = decodeURIComponent(p); } catch { /* keep raw */ }
    return cleanTitle(name);
  } catch {
    return "Video";
  }
}

// Container formats the player can open, keyed by file extension.
const EXT_FORMAT: Record<string, string> = {
  mp4: "mp4", m4v: "mp4", mov: "mp4", m4a: "mp4", "3gp": "mp4",
  avi: "avi", divx: "avi", xvid: "avi",
  mkv: "mkv", webm: "webm", flv: "flv", ts: "ts", m2ts: "ts", mts: "ts",
  m3u8: "m3u8", mpd: "mpd", ogg: "ogg", ogv: "ogg",
};

/** Reads the container type from the original URL (path first, then query values like ?file=x.avi). */
export function extFromUrl(url: string): string | undefined {
  const pick = (s: string) => {
    let v = s;
    try { v = decodeURIComponent(s); } catch { /* keep raw */ }
    const m = v.toLowerCase().match(/\.([a-z0-9]{2,4})$/);
    return m ? EXT_FORMAT[m[1]!] : undefined;
  };
  try {
    const u = new URL(url);
    const fromPath = pick(u.pathname);
    if (fromPath) return fromPath;
    for (const v of u.searchParams.values()) {
      const f = pick(v.split("?")[0] ?? "");
      if (f) return f;
    }
  } catch { /* not a URL */ }
  return undefined;
}

export function proxied(url: string) {
  return `${window.location.origin}/api/public/proxy?url=${encodeURIComponent(url)}`;
}

/** Returns true when the browser can read the URL directly (CORS + Range). */
// Time-limited: a slow host used to hold the "Opening stream" spinner for many seconds before
// anything else happened. A host that ignores Range (200 instead of 206) is relayed too, otherwise
// every seek re-downloads the file from the start, which is what made seeking so slow.
export async function canReadDirect(url: string, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { range: "bytes=0-1" }, signal: ctl.signal, cache: "no-store" });
    try { await r.body?.cancel(); } catch { /* ignore */ }
    if (r.status === 206) return true;
    return r.ok && /bytes/i.test(r.headers.get("accept-ranges") || "");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
