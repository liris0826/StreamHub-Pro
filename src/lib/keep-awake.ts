/* eslint-disable @typescript-eslint/no-explicit-any */
// Keeps the phone / PC screen on while a video is playing.
//
// 1. Screen Wake Lock API: Chrome/Edge/Firefox on Android & PC, Safari 16.4+ on iPhone/iPad/Mac.
//    The browser drops the lock whenever the tab is hidden, so it is taken again on return.
// 2. Fallback: a tiny muted, looping inline video. The picture is painted on a <canvas>, which does
//    NOT count as "video playing" for the OS, so older iOS / Android browsers would dim and lock the
//    screen. A real playing <video> keeps them awake (same trick NoSleep.js uses).
//
// start() must be called synchronously inside a tap/click the first time so iOS lets the fallback
// video play.

const BLANK_MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMqbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAThzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAe/+EAFmdCwB7ZHsBEAAADAAQAAAMACDxYuSABAAVoy4PEyAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAoYAAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAACewAAAAsAAAAUc3RjbwAAAAAAAAABAAADWgAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjIuMy4xMDAAAAAIZnJlZQAAAo5tZGF0AAACZAYF//9g3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTotMzotMyBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9Mi4wMDowLjcwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tNCB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMjAAgAAAAA9liIQF85///w9FAAFXn4AAAAAHQZo4C+c6gA==";

const BLANK_WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIBEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggHr7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAn0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIKjeR1zTbRKycgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4Q7msoA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIKjeR1zTbRKxnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1w+eBAKOjgQAAgBACAJ0BKhAAEAAARwiFhYiZhIgCAgAMDWAA/v+rUICjmYED6ACxAQABEBAAGAAwP/QMAAAA/v+rUIAcU7trkbuPs4EAt4r3gQHxggGj8IED";

let wanted = false;
let lock: any = null;
let requesting = false;
let video: HTMLVideoElement | null = null;
let listening = false;
let host: HTMLElement | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

const hasWakeLock = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

function getVideo() {
  if (video) return video;
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("muted", "");
  v.setAttribute("aria-hidden", "true");
  v.setAttribute("title", "");
  v.muted = true;
  v.loop = true;
  v.preload = "auto";
  v.disableRemotePlayback = true;
  // Must stay in the page and "visible" (not display:none) or iOS ignores it.
  Object.assign(v.style, {
    position: "fixed", left: "0", top: "0", width: "1px", height: "1px",
    opacity: "0.01", pointerEvents: "none", zIndex: "-1",
  });
  // H.264 MP4 for iPhone/iPad/Safari/most Android; WebM where MP4 is not supported.
  v.src = v.canPlayType("video/mp4; codecs=\"avc1.42E01E\"") ? BLANK_MP4 : BLANK_WEBM;
  // Some browsers ignore loop on very short clips; restart manually.
  v.addEventListener("timeupdate", () => { if (v.currentTime > 0.5) v.currentTime = 0; });
  v.addEventListener("ended", () => { if (wanted) v.play().catch(() => {}); });
  video = v;
  placeVideo();
  return v;
}

// The helper video must sit inside the player: in fullscreen the browser stops drawing everything
// outside the fullscreen box, and Android Chrome then pauses that "invisible" video, so the screen
// turned off again while watching fullscreen.
function placeVideo() {
  if (!video) return;
  const parent = host && host.isConnected ? host : document.body;
  if (video.parentNode !== parent) {
    const wasPlaying = !video.paused;
    parent.appendChild(video);
    if (wasPlaying || wanted) video.play().catch(() => {});
  }
}

function playFallback() {
  try {
    const v = getVideo();
    if (v.paused) v.play().catch(() => {});
  } catch { /* ignore */ }
}

function stopFallback() {
  try { video?.pause(); } catch { /* ignore */ }
}

async function requestLock() {
  if (!hasWakeLock() || lock || requesting || document.visibilityState !== "visible") return false;
  requesting = true;
  try {
    const l = await (navigator as any).wakeLock.request("screen");
    if (!wanted) { l.release().catch(() => {}); return false; }
    lock = l;
    l.addEventListener?.("release", () => {
      if (lock === l) lock = null;
      // Released by the system (e.g. battery saver): fall back and try again on next visibility.
      if (wanted) playFallback();
    });
    return true;
  } catch {
    return false;
  } finally {
    requesting = false;
  }
}

function onVisible() {
  if (!wanted || document.visibilityState !== "visible") return;
  playFallback();
  requestLock();
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  window.addEventListener("focus", onVisible);
  // Any tap re-arms the fallback if the OS paused it (iOS does this after calls / Control Center).
  document.addEventListener("touchend", onVisible, { passive: true });
  document.addEventListener("click", onVisible);
  document.addEventListener("fullscreenchange", onVisible);
  document.addEventListener("webkitfullscreenchange", onVisible);
}

// Every few seconds, re-check: the lock or the helper video can be dropped silently by the system
// (battery saver, a notification, audio interruption). Re-arm them without waiting for a tap.
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!wanted) return;
    if (document.visibilityState !== "visible") return;
    placeVideo();
    playFallback();
    if (!lock) requestLock();
  }, 5000);
}

function stopWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}

/** Keep the screen on. Call from the play tap (before any await). */
export function startKeepAwake(container?: HTMLElement | null) {
  if (typeof document === "undefined") return;
  wanted = true;
  if (container) host = container;
  listen();
  startWatchdog();
  placeVideo();
  // Always run the video too: on iOS home-screen apps before 18.4 the Wake Lock "succeeds"
  // but does nothing, and some Android browsers drop the lock silently.
  playFallback();
  requestLock();
}

/** Let the screen turn off normally again (paused, ended, left the page). */
export function stopKeepAwake() {
  wanted = false;
  stopWatchdog();
  stopFallback();
  const l = lock;
  lock = null;
  try { l?.release?.().catch?.(() => {}); } catch { /* ignore */ }
}

/** Call after the player enters/leaves fullscreen; re-arms only if the screen is meant to stay on. */
export function refreshKeepAwake(container?: HTMLElement | null) {
  if (container) host = container;
  if (!wanted || typeof document === "undefined") return;
  placeVideo();
  playFallback();
  requestLock();
}
