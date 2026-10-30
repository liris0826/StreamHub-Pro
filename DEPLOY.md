# Deploy on Cloudflare

## Option A — Cloudflare Workers (recommended)
CLI: `npm install && npx wrangler login && npm run deploy`

Git (Workers & Pages → Create → Import repository):
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## Option B — Cloudflare Pages
CLI: `npm install && npx wrangler login && npm run deploy:pages`

Git (Pages → Connect to Git):
- Framework preset: None
- Build command: `npm run build:pages`
- Build output directory: `dist/client`

Video player isolation headers (COOP/COEP) and the `/api/public/proxy` endpoint work on both.
Local dev: `npm install && npm run dev`.
