import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildFandomUrl } from './api/_wikiTarget.js'

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
export default defineConfig({
  plugins: [react(), fandomProxyPlugin()],
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
