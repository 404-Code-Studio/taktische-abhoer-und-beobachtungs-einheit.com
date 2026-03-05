import express from 'express';
import path from 'path';
import fs from 'fs';


const app = express();
const DOMAIN="taktische-abhoer-und-beobachtungs-einheit.com"
const DEBUG = process.argv.includes('debug');
app.use(express.json());
const routes = JSON.parse(fs.readFileSync('routes.json', 'utf8'));
const cache = {};

for (const [route, file] of Object.entries(routes)) {
  const filePath = path.join('public', file);
  let type;
  if (file.endsWith('.html')) type = 'text/html';
  else if (file.endsWith('.xml')) type = 'text/xml';
  else if (file.endsWith('.css')) type = 'text/css';
  else if (file.endsWith('.js')) type = 'application/javascript';
  else type = 'text/plain';
  if (!DEBUG) {
    const content = fs.readFileSync(filePath);
    cache[route] = { content, type };
  } else {
    cache[route] = { filePath, type };
  }
}

for (const [route, file] of Object.entries(routes)) {
  app.get(route, (req, res) => {
    let cached = cache[route];
    if (DEBUG) {
      cached = { content: fs.readFileSync(cached.filePath), type: cached.type };
    }
    const cacheAge = DEBUG ? 0 : 31536000;
    res.set('Cache-Control', `public, max-age=${cacheAge}`);
    res.type(cached.type).send(cached.content);
  });
}

//const PORT = process.env.EXPRESS_PORT || 3000;

const baseUrl = `https://${DOMAIN}:80`;
let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
for (const route of Object.keys(routes)) {
  const filePath = path.join('public', routes[route]);
  const stats = fs.statSync(filePath);
  const lastmod = stats.mtime.toISOString().split('T')[0];
  const priority = route === '/' ? '1.0' : '0.5';
  sitemap += `  <url>\n    <loc>${baseUrl}${route}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${priority}</priority>\n  </url>\n`;
}
sitemap += '</urlset>';
fs.writeFileSync(path.join('public', 'sitemap.xml'), sitemap);
cache['/sitemap.xml'] = { content: Buffer.from(sitemap), type: 'text/xml' };

export default app;