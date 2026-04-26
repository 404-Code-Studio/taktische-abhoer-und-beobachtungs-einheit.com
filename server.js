import express from "express";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import https from "https";
import crypto from "crypto";

const app = express();
const PORT = 8076;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = "./font-cache";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ROUTES_FILE = path.join(__dirname, "routes.json");

const ALLOWED_FONTS = new Set([
  "share+tech+mono",
  "bebas+neue",
  "source+sans+3",
]);

const ROUTES = JSON.parse(await fs.readFile(ROUTES_FILE, "utf8"));
await fs.mkdir(CACHE_DIR, { recursive: true });

function cachePath(url) {
  const key = crypto.createHash("md5").update(url).digest("hex");
  return path.join(CACHE_DIR, key);
}

async function getCached(url) {
  const filePath = cachePath(url);
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
      const data = await fs.readFile(filePath);
      const meta = JSON.parse(await fs.readFile(filePath + ".meta", "utf8"));
      return { data, ...meta };
    }
  } catch {}
  return null;
}

async function setCache(url, data, contentType) {
  const filePath = cachePath(url);
  await fs.writeFile(filePath, data);
  await fs.writeFile(filePath + ".meta", JSON.stringify({ contentType, timestamp: Date.now() }));
}

function fetchAndCache(url, res) {
  getCached(url).then((cached) => {
    if (cached) {
      res.set("Content-Type", cached.contentType);
      res.set("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
      return res.send(cached.data);
    }

    https.get(url, { headers: { "User-Agent": "font-proxy/1.0" } }, (proxyRes) => {
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", async () => {
        const data = Buffer.concat(chunks);
        const contentType = proxyRes.headers["content-type"] || "application/octet-stream";
        await setCache(url, data, contentType);
        res.set("Content-Type", contentType);
        res.set("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
        res.send(data);
      });
    }).on("error", () => {
      res.status(502).send("Font proxy error");
    });
  });
}

app.get("/fonts/css", async (req, res) => {
  const googleUrl = req.query.url;
  console.log("Received URL:", googleUrl);
  if (!googleUrl || !googleUrl.includes("fonts.googleapis.com")) {
    return res.status(400).send("Missing ?url=https://fonts.googleapis.com/css2?...");
  }

  const fontMatches = [...googleUrl.matchAll(/family=([^&:]+)/gi)];
  if (!fontMatches.length) {
    return res.status(400).send("Invalid font URL");
  }

  console.log("fontMatches:", fontMatches.map(m => m[1]));
  const requestedFonts = fontMatches.map((m) => m[1].toLowerCase().replace(/ /g, "+"));
  console.log("requestedFonts:", requestedFonts);
  console.log("Requested:", requestedFonts);
  console.log("Allowed:", [...ALLOWED_FONTS]);
  const invalidFonts = requestedFonts.filter((f) => !ALLOWED_FONTS.has(f) && !ALLOWED_FONTS.has(f.replace(/ /g, "+")));
  if (invalidFonts.length > 0) {
    return res.status(403).send(`Font not allowed: ${invalidFonts.join(", ")}`);
  }

  const cached = await getCached(googleUrl);
  if (cached) {
    let css = cached.data.toString("utf8");
    css = css.replace(/https:\/\/fonts\.(gstatic|googleapis)\.com\//g, "/fonts/");
    res.set("Content-Type", "text/css; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
    return res.send(css);
  }

  https.get(googleUrl, { headers: { "User-Agent": "font-proxy/1.0" } }, (proxyRes) => {
    const chunks = [];
    proxyRes.on("data", (c) => chunks.push(c));
    proxyRes.on("end", async () => {
      let css = Buffer.concat(chunks).toString("utf8");
      css = css.replace(/https:\/\/fonts\.(gstatic|googleapis)\.com\//g, "/fonts/");
      await setCache(googleUrl, Buffer.from(css), "text/css; charset=utf-8");
      res.set("Content-Type", "text/css; charset=utf-8");
      res.set("Cache-Control", `public, max-age=${CACHE_TTL_MS / 1000}`);
      res.send(css);
    });
  }).on("error", () => {
    res.status(502).send("Font CSS proxy error");
  });
});

app.get(/\/fonts\/(.+)/, (req, res) => {
  const file = req.params[0].split("?")[0];
  const url = `https://fonts.gstatic.com/${file}`;
  fetchAndCache(url, res);
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://taktische-abhoer-und-beobachtungs-einheit.com/cdn-cgi/"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"],
    },
  },
  noSniff: true,
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "no-referrer" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));

app.use(express.static(path.join(__dirname, "public")));

function getSitemapRoutes() {
  return Object.entries(ROUTES)
    .filter(([, file]) => file.endsWith('.html'))
    .map(([route, file]) => {
      if (route === '/index.html') return '/';
      return route;
    });
}

async function formatSitemapXml(req) {
  const host = req.get('host');
  const protocol = req.protocol || 'https';
  const baseUrl = `${protocol}://${host}`;
  const routes = getSitemapRoutes();

  const entries = await Promise.all(routes.map(async (route) => {
    const normalizedRoute = route === '/' ? '' : route;
    const filePath = path.join(__dirname, ROUTES[route === '/' ? '/index.html' : route]);
    let lastmod = '';
    try {
      const stat = await fs.stat(filePath);
      lastmod = stat.mtime.toISOString();
    } catch (err) {
      lastmod = '';
    }

    return `  <url>\n    <loc>${baseUrl}${normalizedRoute}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>`;
}

app.get('/sitemap.xml', async (req, res) => {
  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', `public, max-age=${CACHE_TTL_MS / 1000}`);
  res.send(await formatSitemapXml(req));
});

app.get('*', (req, res, next) => {
  const mapped = ROUTES[req.path];
  if (mapped && mapped.endsWith('.html')) {
    return res.sendFile(path.join(__dirname, mapped));
  }
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
