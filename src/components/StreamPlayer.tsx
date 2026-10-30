/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Check, ChevronsLeft, ChevronsRight, Gauge, Headphones, Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX, RotateCcw, RotateCw, X } from "lucide-react";
import { toast } from "sonner";
import { refreshKeepAwake, startKeepAwake, stopKeepAwake } from "@/lib/keep-awake";
import { canReadDirect, durationFrom, extFromUrl, fmtTime, isKind, loadAVPlayer, proxied, trackLabel, type Track } from "@/lib/avplayer";

// Old AVI-era video codecs (MPEG-4 Part 2 / Xvid / DivX, MS-MPEG4, H.263, MJPEG, DV, MPEG-1/2).
// Phone/desktop hardware decoders and WebCodecs reject most of these, which left the picture black
// while the sound clock kept running. They must go through the built-in software decoder.
const LEGACY_VIDEO = new Set([1, 2, 4, 5, 7, 12, 15, 16, 17, 24, 25, 26]);

const playable = (s: number) => s === 4 || s === 7 || s === 8;
const active = (s: number) => s === 5 || s === 6;
const transient = (s: number) => s === 2 || s === 3 || s === 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Two taps closer together than this count as a double tap.
const DOUBLE_TAP_MS = 300;
const TAP_SEEK_SECS = 10;

type Menu = null | "audio" | "subs" | "speed";

// iOS fix: Safari only lets Web Audio make sound when it is started *synchronously* inside a tap,
// and the hardware ring/silent switch mutes Web Audio unless the page declares itself a media player.
// This must run before any await in a click handler.
let avClass: any = null;
let silentEl: HTMLAudioElement | null = null;
function unlockIOSAudio(p?: any) {
  try {
    const nav: any = navigator;
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch { /* ignore */ }
  try {
    // A looping silent <audio> switches iOS into "media playback" mode so the silent switch doesn't mute us.
    if (!silentEl) {
      silentEl = document.createElement("audio");
      silentEl.setAttribute("playsinline", "");
      silentEl.setAttribute("webkit-playsinline", "");
      // Not looped: a looping clip restarting every fraction of a second made a "beatbox" thump on iOS.
      silentEl.loop = false;
      silentEl.preload = "auto";
      silentEl.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
      silentEl.muted = true;
      silentEl.volume = 0;
    }
    if (silentEl.paused && !silentEl.dataset["done"]) {
      silentEl.dataset["done"] = "1";
      silentEl.play().then(() => silentEl?.pause()).catch(() => {});
    }
  } catch { /* ignore */ }
  try {
    const ctx: any = avClass?.audioContext;
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  } catch { /* ignore */ }
  // Only wake the player when its sound engine is actually stopped; calling resume() while playing
  // restarted the audio and caused repeated thumps.
  try {
    const st = avClass?.audioContext?.state;
    if (st && st !== "running") p?.resume?.();
  } catch { /* ignore */ }
}

// iPhone / iPad (iPadOS reports itself as a Mac with a touch screen).
function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
}

export function StreamPlayer({ url }: { url: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const startedRef = useRef(false);
  const timeRef = useRef(0);
  const scrubRef = useRef(false);
  const lastProgressRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const seekingRef = useRef(false);
  const nudgesRef = useRef(0);

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [paused, setPaused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [audio, setAudio] = useState<Track[]>([]);
  const [subs, setSubs] = useState<Track[]>([]);
  const [curAudio, setCurAudio] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [fs, setFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [via, setVia] = useState<"direct" | "proxy">("direct");
  const volRef = useRef(1); volRef.current = vol;
  const mutedRef = useRef(false); mutedRef.current = muted;
  const rateRef = useRef(1); rateRef.current = rate;

  // Every player command runs one at a time so audio switches never overlap seeks/plays.
  const run = useCallback(<T,>(fn: () => Promise<T>) => {
    const next = queueRef.current.then(fn, fn);
    queueRef.current = next.then(() => {}, () => {});
    return next;
  }, []);

  const settle = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    for (let i = 0; i < 120 && transient(p.status); i++) await sleep(25);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setPaused(true); setBusy(false); setTime(0); setDur(0); setAudio([]); setSubs([]); setCurAudio(null);
      timeRef.current = 0; pendingSeekRef.current = null;
      try {
        // Load the player code and test the link at the same time instead of one after the other.
        const [AVPlayer, direct] = await Promise.all([loadAVPlayer(), canReadDirect(url)]);
        avClass = AVPlayer;
        const src = direct ? url : proxied(url);
        if (cancelled || !hostRef.current) return;
        setVia(direct ? "direct" : "proxy");
        // On-demand files must NOT use the jitter buffer: it is a live-stream feature that keeps
        // nudging playback speed (0.9x / 1.05x) to hit a tiny target, which made the sound cut out
        // every second on 8-bit/10-bit files. A large read-ahead keeps audio continuous instead.
        const ext = extFromUrl(url);
        const make = (soft: boolean) => new AVPlayer({
          container: hostRef.current,
          isLive: false,
          lowLatency: false,
          enableJitterBuffer: false,
          enableHardware: !soft,
          enableWebCodecs: !soft,
          enableWorker: true,
          enableAudioWorklet: true,
          // Smallest buffer the sound engine allows: less audio queued means less lag behind the video.
          audioWorkletBufferLength: 256,
          preLoadTime: 12,
        });
        // AVI files almost always carry Xvid/DivX video: decode in software from the start.
        let soft = ext === "avi";
        let p = make(soft);
        playerRef.current = p;
        // The proxied URL has no file extension, so tell the player the real container.
        const loadOpts = ext ? { ext } : {};
        await p.load(src, loadOpts);
        if (cancelled) { try { p.destroy(); } catch { /* ignore */ } return; }
        const vs = (p.getStreams ? p.getStreams() : []).find((s: any) => [0, "Video", "video"].includes(s?.mediaType));
        const codec = Number(vs?.codecpar?.codecId ?? vs?.codecId);
        if (!soft && LEGACY_VIDEO.has(codec)) {
          // Other containers holding an old codec: reopen with the software decoder.
          try { p.destroy(); } catch { /* ignore */ }
          soft = true;
          p = make(true);
          playerRef.current = p;
          await p.load(src, loadOpts);
          if (cancelled) { try { p.destroy(); } catch { /* ignore */ } return; }
        }
        playerRef.current = p;
        // Re-render at most ~3x/sec: per-frame React renders starve the audio thread on mobile.
        let lastUi = 0;
        p.on("time", (pts: any) => {
          const v = Number(pts);
          const t = isFinite(v) && v >= 0 ? v / 1000 : 0;
          const now = performance.now();
          // While a seek is running, frames from the old position are ignored so the seek bar
          // doesn't jump back and forth.
          if (pendingSeekRef.current !== null || seekingRef.current) return;
          if (Math.abs(t - timeRef.current) > 0.01) {
            lastProgressRef.current = now;
            nudgesRef.current = 0;
            setBusy(false);
          }
          timeRef.current = t;
          if (!scrubRef.current && now - lastUi > 500) {
            lastUi = now;
            setTime(t);
          }
        });
        p.on("played", () => setPaused(false));
        p.on("playing", () => setPaused(false));
        p.on("paused", () => setPaused(true));
        p.on("ended", () => setPaused(true));
        p.on("error", (e: any) => console.error("[player]", e));
        const streams: any[] = p.getStreams ? p.getStreams() : [];
        setDur(durationFrom(streams));
        const a = streams.filter((s) => isKind(s, "audio")).map((s, i) => ({ id: s.id, label: trackLabel(s, i) }));
        const sb = streams.filter((s) => isKind(s, "subtitle")).map((s, i) => ({ id: s.id, label: trackLabel(s, i) }));
        setAudio(a);
        setSubs(sb);
        setCurAudio(p.selectedAudioStream?.id ?? a[0]?.id ?? null);
        try { p.setVolume(mutedRef.current ? 0 : volRef.current); } catch { /* ignore */ }
        try { if (rateRef.current !== 1) p.setPlaybackRate(rateRef.current); } catch { /* ignore */ }
        setPhase("ready");
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          try { playerRef.current?.destroy(); } catch { /* ignore */ }
          playerRef.current = null;
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      startedRef.current = false;
    };
  }, [url]);

  // Remembers that the video was playing when the app was minimized, so it can carry on when the user comes back.
  const resumeOnReturnRef = useRef(false);

  useEffect(() => {
    // Minimizing the app, switching tabs or locking the phone pauses the video so it stops streaming
    // in the background. When the page comes back, playback continues from the same spot.
    const wake = () => { if (startedRef.current) unlockIOSAudio(playerRef.current); };

    const pauseForBackground = () => {
      const p = playerRef.current;
      if (!p || !startedRef.current) return;
      const stop = (pl: any) => {
        try { pl.pause(); } catch { /* ignore */ }
        resumeOnReturnRef.current = true;
        setPaused(true);
        setBusy(false);
        stopKeepAwake();
      };
      // Pause right away: background tabs slow timers down, so waiting in the queue could let it keep streaming.
      if (active(p.status)) { stop(p); return; }
      // A seek / play / audio switch is still running: pause as soon as it finishes.
      run(async () => {
        const cur = playerRef.current;
        if (!cur) return;
        await settle();
        if (document.visibilityState === "hidden" && active(cur.status)) stop(cur);
      });
    };

    const resumeFromBackground = () => {
      wake();
      if (!resumeOnReturnRef.current) return;
      resumeOnReturnRef.current = false;
      startKeepAwake(wrapRef.current);
      run(async () => {
        const p = playerRef.current;
        if (!p) return;
        await settle();
        if (!playable(p.status)) return;
        setBusy(true);
        try {
          await Promise.race([p.play(), sleep(8000)]);
          setPaused(false);
          try { if (avClass?.audioContext?.state !== "running") await p.resume?.(); } catch { /* ignore */ }
        } catch {
          setPaused(true);
          stopKeepAwake();
        } finally { setBusy(false); }
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") pauseForBackground();
      else resumeFromBackground();
    };
    document.addEventListener("touchend", wake, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    // Some phones (older iPhones) fire only pagehide when the app is sent to the background.
    window.addEventListener("pagehide", pauseForBackground);
    return () => {
      document.removeEventListener("touchend", wake);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pauseForBackground);
    };
  }, [run, settle]);

  // Keep the screen ON for as long as the video is playing; let it sleep again when paused/ended.
  useEffect(() => {
    if (!paused) startKeepAwake(wrapRef.current);
    else stopKeepAwake();
  }, [paused]);
  useEffect(() => () => stopKeepAwake(), []);

  // A seek that never answers used to freeze the whole player (spinner forever, every later tap
  // stuck in the queue). Each attempt is now time-limited, and the BigInt/number fallback only
  // runs when the first form actually fails.
  // Mutes during a seek and flushes sound already queued in the speakers, which was the cause of
  // audio running late behind the picture after skipping.
  const silence = (on: boolean) => {
    // Only the volume is lowered. Suspending the sound engine here stopped the player's clock,
    // so the picture could not restart until a 2.5 s timeout ran out after every seek.
    const p = playerRef.current;
    try { p?.setVolume(on || mutedRef.current ? 0 : volRef.current); } catch { /* ignore */ }
    if (!on) {
      const ctx: any = avClass?.audioContext;
      try { if (ctx && ctx.state !== "running" && !pausedRef.current) ctx.resume(); } catch { /* ignore */ }
    }
  };

  // Long jumps on big files need a fresh network request + a keyframe search, which can take far
  // longer than a short skip. The old 6 s limit gave up mid-seek and left the player stuck on
  // "Loading". The limit is now generous, and after the jump playback is restarted if it stalled.
  const doSeek = useCallback(async (secs: number) => {
    const p = playerRef.current;
    if (!p) return;
    const ms = Math.max(0, Math.round(secs * 1000));
    seekingRef.current = true;
    const limit = <T,>(pr: Promise<T>, t: number) => Promise.race([pr, sleep(t).then(() => { throw new Error("seek timeout"); })]);
    try {
      try { await limit(p.seek(BigInt(ms)), 20000); }
      catch (e: any) {
        if (String(e?.message) !== "seek timeout") { try { await limit(p.seek(ms), 20000); } catch { /* ignore */ } }
      }
      // Wait (briefly) for the player to leave its seeking/loading state.
      for (let i = 0; i < 200 && transient(p.status); i++) await sleep(25);
      // Some seeks land in a paused/ready state: restart playback if the viewer was watching.
      if (startedRef.current && !pausedRef.current && playable(p.status)) {
        try { await Promise.race([p.play(), sleep(5000)]); } catch { /* ignore */ }
      }
    } finally { seekingRef.current = false; }
    timeRef.current = secs;
    lastProgressRef.current = performance.now();
    setTime(secs);
  }, []);

  const togglePlay = useCallback(() => {
    unlockIOSAudio(playerRef.current);
    // Must run inside the tap itself, before any await, or iPhone ignores it.
    if (paused) startKeepAwake(wrapRef.current);
    run(async () => {
      const p = playerRef.current;
      if (!p) return;
      await settle();
      if (active(p.status)) {
        p.pause();
        setPaused(true);
        stopKeepAwake();
      } else if (playable(p.status)) {
        setBusy(true);
        try {
          // Never leave the spinner stuck if play() is slow to resolve on some devices.
          await Promise.race([p.play(), sleep(8000)]);
          startedRef.current = true;
          setPaused(false);
          // iOS may leave the sound engine suspended/"interrupted" after play(); wake it.
          try { if (avClass?.audioContext?.state !== "running") await p.resume?.(); } catch { /* ignore */ }
        } catch { setPaused(true); stopKeepAwake(); } finally { setBusy(false); }
      }
    });
  }, [run, settle, paused]);

  // Seeks are merged: rapid taps / scrubbing only update the target, and a single job jumps to the
  // newest position. Previously every tap queued its own seek, so the stream re-buffered over and
  // over and playback appeared frozen.
  const queueSeek = useCallback((target: () => number) => {
    unlockIOSAudio(playerRef.current);
    if (!startedRef.current) startKeepAwake(wrapRef.current);
    const first = pendingSeekRef.current === null;
    pendingSeekRef.current = target();
    setTime(pendingSeekRef.current);
    if (!first) return;
    setBusy(true);
    run(async () => {
      let done: number | null = null;
      try {
        const p = playerRef.current;
        if (!startedRef.current) {
          await settle();
          if (p && playable(p.status)) {
            try { await Promise.race([p.play(), sleep(8000)]); startedRef.current = true; setPaused(false); } catch { /* ignore */ }
          }
        } else {
          await settle();
        }
        // Keep jumping while new targets arrive during the seek.
        // Silence the sound while jumping so old audio does not keep playing during forward/reverse.
        silence(true);
        while (pendingSeekRef.current !== null && pendingSeekRef.current !== done) {
          const t: number = pendingSeekRef.current;
          done = t;
          await doSeek(t);
        }
        pendingSeekRef.current = null;
        // Bring the sound back only once the picture moves again, so both restart together.
        const from = timeRef.current, t0 = performance.now();
        while (performance.now() - t0 < 2500 && Math.abs(timeRef.current - from) < 0.05 && !pausedRef.current) await sleep(20);
      } finally {
        // A newer seek may already be queued: leave its target and spinner alone.
        const newer = pendingSeekRef.current !== null && pendingSeekRef.current !== done;
        if (!newer) {
          pendingSeekRef.current = null;
          silence(false);
          setBusy(false);
        }
      }
    });
  }, [run, settle, doSeek]);

  const clampT = useCallback((t: number) => Math.min(Math.max(0, t), dur > 0 ? Math.max(0, dur - 1) : t), [dur]);
  const seekTo = useCallback((secs: number) => queueSeek(() => clampT(secs)), [queueSeek, clampT]);
  // Relative seek: adds to a seek that is still pending, so rapid taps add up (+10, +20, +30…).
  const seekBy = useCallback((delta: number) => queueSeek(() => clampT((pendingSeekRef.current ?? timeRef.current) + delta)), [queueSeek, clampT]);

  // Stall watchdog: if playback is on but the clock hasn't moved for a while (network hiccup,
  // decoder stuck after a seek), nudge the player at the same spot so it refills and carries on.
  useEffect(() => {
    if (paused || phase !== "ready") return;
    lastProgressRef.current = performance.now();
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !startedRef.current || pendingSeekRef.current !== null) return;
      if (document.visibilityState === "hidden") return;
      const idleFor = performance.now() - lastProgressRef.current;
      if (idleFor > 1500) setBusy(true);
      // Still fetching after a jump: give it time instead of restarting the request over and over.
      if (transient(p.status) && idleFor < 20000) return;
      if (idleFor > 6000 && nudgesRef.current < 3) {
        nudgesRef.current++;
        lastProgressRef.current = performance.now();
        run(async () => {
          try {
            if (playable(p.status)) await Promise.race([p.play(), sleep(5000)]);
            else await doSeek(timeRef.current);
          } catch { /* ignore */ }
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [paused, phase, run, doSeek]);

  const switchAudio = useCallback((t: Track) => {
    setMenu(null);
    if (t.id === curAudio) return;
    run(async () => {
      const p = playerRef.current;
      if (!p) return;
      setBusy(true);
      try {
        await settle();
        const at = timeRef.current;
        await Promise.race([p.selectAudio(t.id), sleep(15000).then(() => { throw new Error("timeout"); })]);
        await settle();
        let now = at;
        try { now = Number(p.currentTime) / 1000; } catch { /* ignore */ }
        setCurAudio(t.id);
        // Seek in place to flush audio already buffered from the old track,
        // so the new language is heard immediately instead of after the buffer drains.
        if (startedRef.current) await doSeek(Math.abs(now - at) > 2 ? at : now);
        toast.success(`Audio: ${t.label}`);
      } catch {
        toast.error("That audio track could not be switched");
      } finally { setBusy(false); }
    });
  }, [run, settle, doSeek, curAudio]);


  const applyVolume = (v: number, m: boolean) => {
    try { playerRef.current?.setVolume(m ? 0 : v); } catch { /* ignore */ }
  };

  const setSpeed = (r: number) => {
    setRate(r);
    setMenu(null);
    try { playerRef.current?.setPlaybackRate(r); } catch { /* ignore */ }
  };

  // iPhone fallback: iOS Safari has no fullscreen for normal page elements (and the picture is drawn
  // on a canvas, not a <video>), so we fill the screen ourselves and rotate to landscape when the
  // phone is held upright.
  // Hide the control bar until the user starts playback the first time.
  const [started, setStarted] = useState(false);
  useEffect(() => { if (!paused) setStarted(true); }, [paused]);

  const [pseudoFs, setPseudoFs] = useState(false);
  const [portrait, setPortrait] = useState(false);

  const fsEl = () => (document as any).fullscreenElement || (document as any).webkitFullscreenElement;

  // ---- iOS native fullscreen -------------------------------------------------------------
  // On iPhone/iPad, fullscreen opens Apple's own video screen (close, picture-in-picture, volume,
  // play/pause in the middle). That screen only works with a real <video>, but this player draws
  // the picture on a canvas, so the canvas is mirrored into a hidden <video> that iOS can open.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const nativeRef = useRef<{ video: HTMLVideoElement; stream: MediaStream | null; canvas: HTMLCanvasElement | null; mirror: boolean } | null>(null);
  const nativeFsRef = useRef(false);

  const pausePlayer = useCallback(() => {
    run(async () => {
      const p = playerRef.current;
      if (!p) return;
      await settle();
      if (active(p.status)) { try { p.pause(); } catch { /* ignore */ } setPaused(true); stopKeepAwake(); }
    });
  }, [run, settle]);

  const playPlayer = useCallback(() => {
    unlockIOSAudio(playerRef.current);
    startKeepAwake(wrapRef.current);
    run(async () => {
      const p = playerRef.current;
      if (!p) return;
      await settle();
      if (!playable(p.status)) return;
      setBusy(true);
      try {
        await Promise.race([p.play(), sleep(8000)]);
        startedRef.current = true;
        setPaused(false);
        try { if (avClass?.audioContext?.state !== "running") await p.resume?.(); } catch { /* ignore */ }
      } catch { setPaused(true); stopKeepAwake(); } finally { setBusy(false); }
    });
  }, [run, settle]);

  // Event listeners are attached once, so they read the latest play/pause functions from here.
  const ctlRef = useRef<any>({ pausePlayer, playPlayer });
  ctlRef.current = { ...ctlRef.current, pausePlayer, playPlayer };

  const bindNative = useCallback((v: HTMLVideoElement, mirror: boolean) => {
    if (v.dataset["nativeBound"]) return;
    v.dataset["nativeBound"] = "1";
    v.addEventListener("webkitbeginfullscreen", () => {
      nativeFsRef.current = true;
      setPseudoFs(false);
      // Show the right button (play or pause) in Apple's screen straight away.
      if (mirror) {
        if (pausedRef.current) v.pause();
        else v.play().catch(() => {});
      }
      refreshKeepAwake(wrapRef.current);
    });
    v.addEventListener("webkitendfullscreen", () => {
      nativeFsRef.current = false;
      // The hidden copy is not needed while watching normally.
      if (mirror) { v.muted = true; try { v.pause(); } catch { /* ignore */ } }
      refreshKeepAwake(wrapRef.current);
    });
    // Pause / play pressed in Apple's screen controls our player (sound included).
    v.addEventListener("pause", () => {
      if (!nativeFsRef.current) return;
      // Closing the screen also fires "pause" — wait a moment so closing doesn't stop the video.
      setTimeout(() => {
        if (nativeFsRef.current && v.paused && !pausedRef.current) ctlRef.current.pausePlayer();
      }, 250);
    });
    v.addEventListener("play", () => {
      if (nativeFsRef.current && pausedRef.current) ctlRef.current.playPlayer();
    });
  }, []);

  const teardownNative = useCallback(() => {
    const n = nativeRef.current;
    nativeRef.current = null;
    nativeFsRef.current = false;
    if (!n || !n.mirror) return;
    try { n.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { n.video.pause(); n.video.srcObject = null; n.video.remove(); } catch { /* ignore */ }
  }, []);

  // Finds (or builds) the <video> that Apple's fullscreen screen will show.
  const prepareNative = useCallback((): HTMLVideoElement | null => {
    if (!isIOS()) return null;
    const host = hostRef.current;
    if (!host) return null;
    // Some files are played through a real <video> already: use it directly.
    const own = host.querySelector("video") as HTMLVideoElement | null;
    if (own && (own as any).webkitEnterFullscreen && own.readyState >= 1) {
      if (nativeRef.current?.video !== own) { teardownNative(); nativeRef.current = { video: own, stream: null, canvas: null, mirror: false }; }
      bindNative(own, false);
      return own;
    }
    // Otherwise mirror the biggest canvas (the picture) into a hidden <video>.
    const canvases = Array.from(host.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!canvas || !(canvas as any).captureStream || !canvas.width) return null;
    const n = nativeRef.current;
    if (n && n.mirror && n.canvas === canvas && n.stream?.getVideoTracks()[0]?.readyState === "live") return n.video;
    teardownNative();
    let stream: MediaStream;
    try { stream = (canvas as any).captureStream(30); } catch { return null; }
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    // Kept on the page (iOS won't open a hidden element) but invisible and untouchable.
    Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", zIndex: "-1" });
    v.srcObject = stream;
    document.body.appendChild(v);
    v.play().catch(() => {});
    bindNative(v, true);
    nativeRef.current = { video: v, stream, canvas, mirror: true };
    return v;
  }, [bindNative, teardownNative]);

  // Get the hidden copy ready once the video has started, so the fullscreen tap opens instantly
  // (iOS only allows opening it directly inside the tap).
  useEffect(() => {
    if (!started || phase !== "ready" || !isIOS()) return;
    let tries = 0;
    const id = setInterval(() => { if (prepareNative() || ++tries > 20) clearInterval(id); }, 500);
    return () => clearInterval(id);
  }, [started, phase, prepareNative]);

  // New link or leaving the page: remove the hidden copy.
  useEffect(() => () => teardownNative(), [url, teardownNative]);

  // Keep Apple's play/pause button in step when the video is paused/played another way.
  useEffect(() => {
    const n = nativeRef.current;
    if (!n || !n.mirror || !nativeFsRef.current) return;
    if (paused && !n.video.paused) n.video.pause();
    else if (!paused && n.video.paused) n.video.play().catch(() => {});
  }, [paused]);

  ctlRef.current.seekTo = seekTo;
  // Seek bar / 10-second skip info for iOS (Now Playing, lock screen and, where supported, Apple's screen).
  useEffect(() => {
    const ms: any = typeof navigator !== "undefined" ? (navigator as any).mediaSession : null;
    if (!ms || !isIOS()) return;
    const set = (a: string, h: any) => { try { ms.setActionHandler(a, h); } catch { /* unsupported */ } };
    set("play", () => ctlRef.current.playPlayer());
    set("pause", () => ctlRef.current.pausePlayer());
    set("seekbackward", (d: any) => seekTo(timeRef.current - (d?.seekOffset || 10)));
    set("seekforward", (d: any) => seekTo(timeRef.current + (d?.seekOffset || 10)));
    set("seekto", (d: any) => { if (typeof d?.seekTime === "number") seekTo(d.seekTime); });
    return () => { ["play", "pause", "seekbackward", "seekforward", "seekto"].forEach((a) => set(a, null)); };
  }, [seekTo]);
  useEffect(() => {
    const ms: any = typeof navigator !== "undefined" ? (navigator as any).mediaSession : null;
    if (!ms?.setPositionState || !isIOS() || !(dur > 0)) return;
    try { ms.setPositionState({ duration: dur, playbackRate: rate || 1, position: Math.min(Math.max(time, 0), dur) }); } catch { /* ignore */ }
    try { ms.playbackState = paused ? "paused" : "playing"; } catch { /* ignore */ }
  }, [dur, time, rate, paused]);

  // ---- iOS full Apple player (seek bar + 10s skip) ----------------------------------------
  // A mirrored canvas is a live feed, so Apple's screen hides the seek bar and skip buttons.
  // When Safari can play the file itself (MP4 / MOV / M4V / HLS…), open the real file in Apple's
  // screen instead, at the same position, then hand the position back when it closes.
  const realRef = useRef<{ video: HTMLVideoElement; ok: boolean } | null>(null);
  const realFsRef = useRef(false);
  useEffect(() => {
    if (!isIOS() || typeof document === "undefined") return;
    const v = document.createElement("video");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.playsInline = true;
    v.preload = "metadata";
    v.controls = true;
    Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", zIndex: "-1" });
    const entry = { video: v, ok: false };
    realRef.current = entry;
    v.addEventListener("loadedmetadata", () => {
      entry.ok = Number.isFinite(v.duration) && v.duration > 0 && v.videoWidth > 0;
    });
    v.addEventListener("error", () => { entry.ok = false; });
    v.addEventListener("webkitbeginfullscreen", () => { realFsRef.current = true; refreshKeepAwake(wrapRef.current); });
    v.addEventListener("webkitendfullscreen", () => {
      realFsRef.current = false;
      const t = v.currentTime;
      const wasPlaying = !v.paused && !v.ended;
      try { v.pause(); } catch { /* ignore */ }
      // Continue in our player from where Apple's screen stopped.
      ctlRef.current.seekTo(t);
      if (wasPlaying) ctlRef.current.playPlayer();
      refreshKeepAwake(wrapRef.current);
    });
    v.src = url;
    document.body.appendChild(v);
    try { v.load(); } catch { /* ignore */ }
    return () => {
      if (realRef.current === entry) realRef.current = null;
      try { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); } catch { /* ignore */ }
    };
  }, [url]);

  // Must run synchronously inside the tap.
  const enterRealFs = (): boolean => {
    const r = realRef.current;
    const v: any = r?.video;
    if (!r?.ok || !v?.webkitEnterFullscreen) return false;
    try {
      v.muted = false;
      v.playbackRate = rate || 1;
      try { v.currentTime = Math.min(timeRef.current, Math.max(0, v.duration - 1)); } catch { /* ignore */ }
      if (!pausedRef.current) v.play().catch(() => {});
      v.webkitEnterFullscreen();
    } catch { return false; }
    // Our player stays silent and still underneath.
    if (!pausedRef.current) ctlRef.current.pausePlayer();
    return true;
  };

  const enterNativeFs = async (): Promise<boolean> => {
    const v: any = prepareNative();
    if (!v?.webkitEnterFullscreen) return false;
    try {
      if (nativeRef.current?.mirror) { v.muted = false; v.play().catch(() => {}); }
      // Must be called right inside the tap (before any await) or iOS ignores it.
      if (v.readyState >= 1) { v.webkitEnterFullscreen(); }
      else {
        await new Promise((res) => { v.addEventListener("loadedmetadata", res, { once: true }); setTimeout(res, 1500); });
        v.webkitEnterFullscreen();
      }
    } catch { return false; }
    // If Apple's screen didn't open, fall back to the in-page fullscreen.
    await sleep(800);
    return nativeFsRef.current || !!v.webkitDisplayingFullscreen;
  };
  // ----------------------------------------------------------------------------------------

  const toggleFs = async () => {
    const so: any = typeof screen !== "undefined" ? screen.orientation : null;
    const d: any = document;
    if (pseudoFs) { setPseudoFs(false); return; }
    if (isIOS()) {
      if (enterRealFs()) return;
      if (await enterNativeFs()) return;
      setPseudoFs(true);
      return;
    }
    if (fsEl()) {
      try { so?.unlock?.(); } catch { /* ignore */ }
      if (d.exitFullscreen) await d.exitFullscreen().catch(() => {});
      else d.webkitExitFullscreen?.();
      return;
    }
    const el: any = wrapRef.current;
    let ok = false;
    try {
      if (el?.requestFullscreen) { await el.requestFullscreen({ navigationUI: "hide" }); ok = true; }
      else if (el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); ok = true; }
    } catch { ok = false; }
    if (!ok || !fsEl()) {
      // Give webkit a moment to report, then fall back.
      await sleep(50);
      if (!fsEl()) { setPseudoFs(true); return; }
    }
    // Rotate to landscape on phones while in fullscreen.
    try { await so?.lock?.("landscape"); } catch { /* unsupported: rotate via CSS if upright */
      if (window.innerHeight > window.innerWidth) { await d.exitFullscreen?.().catch(() => {}); setPseudoFs(true); }
    }
  };

  useEffect(() => {
    const on = () => {
      const isFs = !!fsEl();
      setFs(isFs);
      refreshKeepAwake(wrapRef.current);
      if (!isFs) { try { (screen.orientation as any)?.unlock?.(); } catch { /* ignore */ } }
    };
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);

  // Track the real visible screen size (iOS 100vh includes the hidden Safari bars, which cut the controls off).
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const check = () => {
      const vv = (window as any).visualViewport;
      const w = Math.round(vv?.width ?? window.innerWidth);
      const h = Math.round(vv?.height ?? window.innerHeight);
      setVp({ w, h });
      setPortrait(h > w);
    };
    check();
    const late = () => { check(); setTimeout(check, 300); };
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", late);
    (window as any).visualViewport?.addEventListener("resize", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", late);
      (window as any).visualViewport?.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    if (!pseudoFs) return;
    const b = document.body.style, h = document.documentElement.style;
    const prev: [string, string, string] = [b.overflow, h.overflow, b.touchAction ?? ""];
    b.overflow = "hidden"; h.overflow = "hidden"; b.touchAction = "none";
    window.scrollTo(0, 0);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPseudoFs(false); };
    window.addEventListener("keydown", esc);
    return () => { [b.overflow, h.overflow, b.touchAction] = prev; window.removeEventListener("keydown", esc); };
  }, [pseudoFs]);

  const W = vp.w || (typeof window !== "undefined" ? window.innerWidth : 0);
  const H = vp.h || (typeof window !== "undefined" ? window.innerHeight : 0);
  const base: any = { position: "fixed", zIndex: 2147483000, background: "#000", maxWidth: "none", maxHeight: "none", margin: 0, borderRadius: 0, aspectRatio: "auto", boxSizing: "border-box" };
  const pseudoStyle: any = !pseudoFs ? undefined : portrait
    // Phone upright: lay the player sideways across the visible area so it reads as landscape.
    ? { ...base, top: 0, left: W, width: H, height: W, transform: "rotate(90deg)", transformOrigin: "top left",
        paddingLeft: "env(safe-area-inset-top)", paddingRight: "env(safe-area-inset-bottom)" }
    // Phone already sideways: just fill the visible screen, clear of the notch.
    : { ...base, top: 0, left: 0, width: W, height: H,
        paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)", paddingBottom: "env(safe-area-inset-bottom)" };

  // Auto-hide controls while playing. Listen to pointerdown too: touch taps
  // never fire pointermove, so on phones tapping a button must also reset the timer.
  useEffect(() => {
    if (paused || menu) { setIdle(false); return; }
    let t = setTimeout(() => setIdle(true), 2800);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2800); };
    const el = wrapRef.current;
    el?.addEventListener("pointermove", wake);
    el?.addEventListener("pointerdown", wake);
    return () => {
      clearTimeout(t);
      el?.removeEventListener("pointermove", wake);
      el?.removeEventListener("pointerdown", wake);
    };
  }, [paused, menu]);

  // Keyboard shortcuts.
  const toggleFsRef = useRef(toggleFs);
  toggleFsRef.current = toggleFs;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || e.ctrlKey || e.metaKey || e.altKey || phase !== "ready") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowRight") seekTo(timeRef.current + 10);
      else if (e.key === "ArrowLeft") seekTo(timeRef.current - 10);
      else if (e.key === "f") toggleFsRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, togglePlay, seekTo]);


  const tapWasIdleRef = useRef(false);

  // Double tap: right half = forward 10s, left half = back 10s. Keep tapping the same side to keep seeking.
  const tapRef = useRef<{ t: number; side: "left" | "right" | null; timer: ReturnType<typeof setTimeout> | null; streak: number }>({ t: 0, side: null, timer: null, streak: 0 });
  const fxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fx, setFx] = useState<{ side: "left" | "right"; secs: number; id: number } | null>(null);
  useEffect(() => () => {
    if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
    if (fxTimerRef.current) clearTimeout(fxTimerRef.current);
  }, []);

  const onSurfaceTap = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (phase !== "ready") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side: "left" | "right" = e.clientX - rect.left < rect.width / 2 ? "left" : "right";
    const now = performance.now();
    const tr = tapRef.current;
    const wasIdle = tapWasIdleRef.current;

    if (tr.side === side && now - tr.t < DOUBLE_TAP_MS) {
      // Second (or further) quick tap on the same side: seek instead of play/pause.
      if (tr.timer) { clearTimeout(tr.timer); tr.timer = null; }
      tr.t = now;
      tr.streak += 1;
      seekBy(side === "right" ? TAP_SEEK_SECS : -TAP_SEEK_SECS);
      setFx({ side, secs: tr.streak * TAP_SEEK_SECS, id: now });
      if (fxTimerRef.current) clearTimeout(fxTimerRef.current);
      fxTimerRef.current = setTimeout(() => setFx(null), 700);
      return;
    }

    // First tap: wait briefly to see whether a second tap follows.
    if (tr.timer) clearTimeout(tr.timer);
    tr.t = now;
    tr.side = side;
    tr.streak = 0;
    tr.timer = setTimeout(() => {
      tr.timer = null;
      // First tap while controls are hidden only reveals them; next tap toggles play.
      if (started && !paused && wasIdle) { setIdle(false); return; }
      togglePlay();
    }, DOUBLE_TAP_MS);
  };

  const pct = dur > 0 ? (time / dur) * 100 : 0;
  const curAudioLabel = audio.find((a) => a.id === curAudio)?.label;

  return (
    <div className="space-y-4">
      <div ref={wrapRef} style={pseudoStyle} className={`player-shell ${fs || pseudoFs ? "player-fs" : ""} ${idle ? "cursor-none" : ""}`}>
        <div
          ref={hostRef}
          className="absolute inset-0 touch-manipulation select-none"
          onPointerDownCapture={() => { tapWasIdleRef.current = idle; }}
          onClick={onSurfaceTap}
          onDoubleClick={(e) => e.preventDefault()}
        />

        {fx && (
          <div
            className={`pointer-events-none absolute inset-y-0 z-10 flex w-1/2 items-center justify-center bg-foreground/10 ${fx.side === "left" ? "left-0 rounded-r-[50%]" : "right-0 rounded-l-[50%]"}`}
          >
            <div key={fx.id} className="flex flex-col items-center gap-1 text-foreground animate-in fade-in zoom-in-90 duration-200">
              {fx.side === "left" ? <ChevronsLeft className="h-8 w-8" /> : <ChevronsRight className="h-8 w-8" />}
              <span className="font-mono text-sm font-semibold">{fx.side === "left" ? "-" : "+"}{fx.secs}s</span>
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div className="player-overlay">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Opening stream…</p>
          </div>
        )}
        {phase === "error" && (
          <div className="player-overlay">
            <p className="font-display text-lg text-foreground">Couldn't play this link</p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">Because this link is expired or deleted.</p>
          </div>
        )}
        {phase === "ready" && paused && !busy && (
          <button aria-label="Play" onClick={togglePlay} className="player-bigplay z-20" style={{ width: 60, height: 60, top: "42%" }}>
            <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
          </button>
        )}
        {busy && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}

        {phase === "ready" && started && (
          <div className={`player-controls ${idle ? "opacity-0" : "opacity-100"}`}>
            <input
              type="range" min={0} max={dur || 0} step={0.1} value={time}
              aria-label="Seek"
              className="player-range w-full"
              style={{ ["--pct" as any]: `${pct}%` }}
              onPointerDown={() => (scrubRef.current = true)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTime(v);
                // Keyboard / screen-reader changes have no pointer: jump straight away.
                if (!scrubRef.current) seekTo(v);
              }}
              onPointerUp={(e) => { if (!scrubRef.current) return; scrubRef.current = false; seekTo(Number((e.target as HTMLInputElement).value)); }}
              onPointerCancel={(e) => { if (!scrubRef.current) return; scrubRef.current = false; seekTo(Number((e.target as HTMLInputElement).value)); }}
            />
            <div className="mt-2 flex items-center gap-1 sm:gap-2">
              <button className="ctl-btn" aria-label={paused ? "Play" : "Pause"} onClick={togglePlay}>
                {paused ? <Play className="h-5 w-5" fill="currentColor" /> : <Pause className="h-5 w-5" fill="currentColor" />}
              </button>
              <button className="ctl-btn" aria-label="Back 10 seconds" onClick={() => seekTo(timeRef.current - 10)}><RotateCcw className="h-4 w-4" /></button>
              <button className="ctl-btn" aria-label="Forward 10 seconds" onClick={() => seekTo(timeRef.current + 10)}><RotateCw className="h-4 w-4" /></button>
              <button className="ctl-btn" aria-label="Mute" onClick={() => { const m = !muted; setMuted(m); applyVolume(vol, m); }}>
                {muted || vol === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} aria-label="Volume"
                className="player-range hidden w-20 sm:block" style={{ ["--pct" as any]: `${(muted ? 0 : vol) * 100}%` }}
                onChange={(e) => { const v = Number(e.target.value); setVol(v); setMuted(false); applyVolume(v, false); }} />
              <span className="ml-1 font-mono text-xs tabular-nums text-foreground/80">{fmtTime(time)} / {fmtTime(dur)}</span>

              <div className="ml-auto flex items-center gap-1">
                {audio.length > 0 && (
                  <div>
                    <button className={`ctl-chip ${audio.length > 1 ? "ctl-chip-hot" : ""}`} onClick={() => setMenu(menu === "audio" ? null : "audio")}>
                      <Headphones className="h-4 w-4" />
                      <span className="hidden max-w-28 truncate sm:inline">{curAudioLabel || "Audio"}</span>
                    </button>
                    {menu === "audio" && (
                      <div className="ctl-menu">
                        <div className="ctl-menu-head">
                          <p className="ctl-menu-title">Audio track</p>
                          <button className="ctl-close" aria-label="Close audio menu" onClick={() => setMenu(null)}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {audio.map((a) => (
                          <button key={a.id} className={`ctl-item ${a.id === curAudio ? "ctl-item-on" : ""}`} onClick={() => switchAudio(a)}>{a.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <button className="ctl-chip" aria-label="Speed" onClick={() => setMenu(menu === "speed" ? null : "speed")}>
                    <Gauge className="h-4 w-4" /><span className="font-mono text-xs">{rate}x</span>
                  </button>
                  {menu === "speed" && (
                    <div className="speed-panel">
                      <div className="speed-panel-head">
                        <span>Playback speed</span>
                        <button className="ctl-close ctl-close-on-primary" aria-label="Close speed menu" onClick={() => setMenu(null)}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="speed-panel-list">
                        {RATES.map((r) => (
                          <button key={r} className={`speed-item ${r === rate ? "speed-item-on" : ""}`} onClick={() => setSpeed(r)}>
                            <span>{r === 1 ? "1×" : `${r}×`}</span>
                            {r === rate && <Check className="h-4 w-4" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button className="ctl-btn" aria-label="Fullscreen" onClick={toggleFs}>{fs || pseudoFs ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {phase === "ready" && audio.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-muted-foreground">🎧 Audio:</span>
          {audio.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => switchAudio(a)}
              aria-pressed={a.id === curAudio}
              className={`rounded-full border px-3 py-1 transition-colors ${
                a.id === curAudio
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-secondary text-foreground hover:border-primary"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {phase === "ready" && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="info-pill">{subs.length} subtitle{subs.length === 1 ? "" : "s"}</span>
          <span className="info-pill">{via === "direct" ? "Direct stream" : "Relayed stream"}</span>
        </div>
      )}
    </div>
  );
}
