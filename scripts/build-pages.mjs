// Turns the Worker build into a Cloudflare Pages "advanced mode" output:
// dist/client is the Pages output folder, the server goes into dist/client/_worker.js/.
import { cpSync, rmSync, renameSync, existsSync, writeFileSync } from "node:fs";
const out = "dist/client/_worker.js";
rmSync(out, { recursive: true, force: true });
cpSync("dist/server", out, { recursive: true, filter: (p) => !p.endsWith("wrangler.json") });
if (existsSync(`${out}/index.mjs`)) writeFileSync(`${out}/index.js`, 'export { default } from "./index.mjs";\n');
writeFileSync("dist/client/_routes.json", JSON.stringify({ version: 1, include: ["/*"], exclude: ["/assets/*", "/avp/*", "/favicon.ico", "/robots.txt"] }, null, 2));
console.log("Pages output ready in dist/client");
