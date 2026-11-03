// Every file the build writes, in one list. Rendering lives here, apart from the
// components in pages.jsx, so those files export components only (what React's
// fast refresh asks of a .jsx file) and this one can export a function.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Landing, TextPage, Plans, ChatShell, NotFoundShell, ShareShell } from './pages.jsx';
import { ROUTES } from '../site/route.js';
import { metaFor } from '../site/meta.js';
import { jsonLdFor } from '../site/seo.js';

const html = (component, props) => renderToStaticMarkup(createElement(component, props));

/** The head fields for a view: its meta plus its structured data. */
function headFor(view) {
  const meta = metaFor(view);
  return {
    title: meta.title,
    description: meta.description,
    share: meta.share,
    path: meta.path,
    robots: meta.robots,
    jsonLd: jsonLdFor(view),
  };
}

const BODY = { landing: Landing, chat: ChatShell, upgrade: Plans };

/**
 * Every file the build writes:
 *   { file, view, head, body }   file is relative to the output folder
 */
export function pagePlan() {
  const plan = [];
  for (const { view, path } of ROUTES) {
    plan.push({
      view,
      file: path === '/' ? 'index.html' : `${path.slice(1)}/index.html`,
      head: headFor(view),
      body: BODY[view] ? html(BODY[view]) : html(TextPage, { view }),
    });
  }
  // A real 404 is served from here (vercel.json has no catch-all rewrite), and
  // the app, once it boots, shows its own 404 view over it.
  plan.push({ view: 'notfound', file: '404.html', head: headFor('notfound'), body: html(NotFoundShell) });
  // The shell api/share.js dresses with a shared answer's own tags.
  plan.push({ view: 'share', file: 'share-shell.html', head: headFor('share'), body: html(ShareShell) });
  return plan;
}
