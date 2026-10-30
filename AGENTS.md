# Project rules
- Video playback uses the bundled libmedia AVPlayer in public/avp (CDN fallback); all player commands run through a serial queue so audio switches never race seeks/plays.
- Hosts without CORS are streamed via /api/public/proxy (Range pass-through, http(s) only) — keep it stateless so it runs on Workers and Vercel.
- Vercel deploys build with NITRO_PRESET=vercel (see vercel.json).
<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
