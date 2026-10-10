import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildFandomUrl } from './api/_wikiTarget.js'
import { resolveSteamArt } from './api/_steamArt.js'

// Search-engine ownership tags, read from the environment so no token is
// committed and a fork doesn't claim our site. Set them in the Vercel project's
// environment variables; unset, nothing is injected.
//   VITE_GSC_VERIFICATION   Google Search Console → "HTML tag" → the content="…" value
//   VITE_BING_VERIFICATION  Bing Webmaster Tools  → "HTML Meta Tag" → the msvalidate.01 value
// A token is a short opaque string; anything else is ignored rather than
// written into the page.
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/
function searchVerificationPlugin() {
  let env = {}
  return {
    name: 'search-verification',
    configResolved(config) {
      env = loadEnv(config.mode, config.envDir || process.cwd(), 'VITE_')
    },
    transformIndexHtml() {
      const tags = []
      const google = env.VITE_GSC_VERIFICATION?.trim()
      const bing = env.VITE_BING_VERIFICATION?.trim()
      if (google && TOKEN.test(google)) {
        tags.push({ tag: 'meta', attrs: { name: 'google-site-verification', content: google }, injectTo: 'head' })
      }
      if (bing && TOKEN.test(bing)) {
        tags.push({ tag: 'meta', attrs: { name: 'msvalidate.01', content: bing }, injectTo: 'head' })
      }
      return tags
    },
  }
}

// Custom Vite plugin to proxy Fandom wiki API requests dynamically
// Each game has its own subdomain (e.g., zelda.fandom.com), so we
// use middleware instead of static proxy rules.
function fandomProxyPlugin() {
  return {
    name: 'fandom-wiki-proxy',
    configureServer(server) {
      // Handle wiki search: /api/wiki/search?game=minecraft&q=enchanting
      server.middlewares.use('/api/wiki/search', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const game = url.searchParams.get('game');
          const query = url.searchParams.get('q');

          if (!game || !query) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing game or q parameter' }));
            return;
          }

          // `game` lands in the URL hostname — validate before assembling (SSRF).
          const fandomUrl = buildFandomUrl(game, {
            action: 'opensearch', search: query, limit: 5, format: 'json',
          });
          if (!fandomUrl) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid game parameter' }));
            return;
          }
          const response = await fetch(fandomUrl, {
            headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' },
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
          });
          const data = await response.text();

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(data);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // Handle wiki article fetch: /api/wiki/article?game=minecraft&title=Enchanting
      server.middlewares.use('/api/wiki/article', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const game = url.searchParams.get('game');
          const title = url.searchParams.get('title');

          if (!game || !title) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing game or title parameter' }));
            return;
          }

          // `game` lands in the URL hostname — validate before assembling (SSRF).
          const fandomUrl = buildFandomUrl(game, {
            action: 'query', titles: title, prop: 'extracts', exintro: false,
            explaintext: true, exsectionformat: 'plain', format: 'json',
          });
          if (!fandomUrl) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid game parameter' }));
            return;
          }
          const response = await fetch(fandomUrl, {
            headers: { 'User-Agent': 'GameGuide-AI/1.0 (educational project)' },
            redirect: 'error',
            signal: AbortSignal.timeout(8000),
          });
          const data = await response.text();

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(data);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    }
  };
}

// https://vite.dev/config/
// /api/game-art in dev — the same resolver the Vercel function uses.
function gameArtDevPlugin() {
  return {
    name: 'game-art-dev',
    configureServer(server) {
      server.middlewares.use('/api/game-art', async (req, res) => {
        const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
        const { status, body, cacheControl } = await resolveSteamArt(q);
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        if (cacheControl) res.setHeader('Cache-Control', cacheControl);
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), fandomProxyPlugin(), gameArtDevPlugin(), searchVerificationPlugin()],
  server: {
    proxy: {
      '/api/reddit': {
        target: 'https://www.reddit.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/reddit/, ''),
        headers: {
          'User-Agent': 'GameGuide-AI/1.0 (educational project)',
        },
      },
    },
  },
})
