import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildFandomUrl } from './api/_wikiTarget.js'
import { resolveSteamArt } from './api/_steamArt.js'
import { resolveTrending } from './api/_trending.js'

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

// The landing page is a lazy chunk, so the browser only learns it needs the
// chunk (and the animation library behind it) after the entry has downloaded
// AND run: HTML, then entry, then LandingPage and its imports, in turn. On a
// phone that is three round trips with the CPU idle between them. This writes
// the chunk list into index.html's inline script (`/*gg-landing-preload*/`),
// which asks for them alongside the entry, but only on a visit that will show
// the landing (the same test the daily-games request uses), so someone going
// straight to the chat or an info page doesn't pay for it.
function landingPreloadPlugin() {
  let base = '/'
  return {
    name: 'landing-preload',
    apply: 'build',
    configResolved(config) { base = config.base || '/' },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle || {}).filter(c => c.type === 'chunk')
        const byName = new Map(chunks.map(c => [c.fileName, c]))
        const landing = chunks.find(c => (c.facadeModuleId || '').split('\\').join('/').endsWith('components/LandingPage.jsx'))
        const entry = chunks.find(c => c.isEntry)
        if (!landing || !entry) return html
        const closure = (start) => {
          const seen = new Set()
          const walk = (name) => {
            if (seen.has(name) || !byName.has(name)) return
            seen.add(name)
            byName.get(name).imports.forEach(walk)
          }
          walk(start.fileName)
          return seen
        }
        const have = closure(entry)
        const need = [...closure(landing)].filter(n => !have.has(n))
        const css = need.flatMap(n => [...(byName.get(n).viteMetadata?.importedCss ?? [])])
        const urls = [...new Set([...need, ...css])].map(n => base + n)
        return html.replace('/*gg-landing-preload*/[]', JSON.stringify(urls))
      },
    },
  }
}

// https://vite.dev/config/
// /api/game-art and /api/trending-games in dev and in `vite preview`: the same
// resolvers the Vercel functions use. Preview matters because a production
// build can then be measured locally with the real daily games, not the
// fallback list a missing endpoint would silently produce.
function gameArtDevPlugin() {
  const json = (res, { status, body, cacheControl }) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    if (cacheControl) res.setHeader('Cache-Control', cacheControl);
    res.end(JSON.stringify(body));
  };
  // Steam is asked twice per list; a repeated page load shouldn't ask again.
  let trending = { at: 0, value: null };
  const mount = (server) => {
    server.middlewares.use('/api/game-art', async (req, res) => {
      const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      json(res, await resolveSteamArt(q));
    });
    server.middlewares.use('/api/trending-games', async (_req, res) => {
      if (!trending.value || Date.now() - trending.at > 5 * 60_000) trending = { at: Date.now(), value: await resolveTrending() };
      json(res, trending.value);
    });
  };
  return { name: 'game-art-dev', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  plugins: [react(), fandomProxyPlugin(), gameArtDevPlugin(), searchVerificationPlugin(), landingPreloadPlugin()],
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
