// Isolated visual fixture: production markup/styles, no login, API or real data.
// Run: node tools/preview-listing-header.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.HEADER_PREVIEW_PORT || 4174);
const types = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/") {
      const source = await readFile(resolve(root, "index.html"), "utf8");
      const head = source.match(/<template id="jsAuthenticatedHeadAssets">([\s\S]*?)<\/template>/)[1];
      const styles = [...head.matchAll(/<link[^>]+href="css\/[^>]+>/g)].map(match => match[0]).join("\n");
      const markup = source.match(/<template id="jsAuthenticatedApplication">([\s\S]*?)<\/template>/)[1]
        .replace('id="wrap" inert aria-hidden="true"', 'id="wrap"');
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Header layout fixture</title>${styles}</head><body>${markup}<script src="js/listing-trade-ui-v1.js"></script><script src="js/mobile-app-v1.js"></script></body></html>`);
      return;
    }
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep) || !/^(css\/|js\/(listing-trade-ui-v1|mobile-app-v1)\.js$)/.test(relative)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`);
    response.end(await readFile(file));
  } catch {
    response.writeHead(500).end("Preview unavailable");
  }
}).listen(port, "127.0.0.1", () => console.log(`Header fixture: http://127.0.0.1:${port}/`));
