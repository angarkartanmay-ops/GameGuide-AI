import { useEffect } from 'react';
import { applyMeta, metaFor } from './meta';

/**
 * Give the page its view's title, description, canonical and robots (see
 * meta.js). The last view to mount wins, and every view calls this, so
 * nothing is left over from the one before.
 *   usePageMeta('about')
 *   usePageMeta('share', { title: 'Shared answer: Elden Ring | GameGuide' })
 */
export default function usePageMeta(view, overrides) {
  const meta = metaFor(view, overrides);
  const { title, description, path, robots, share } = meta;
  useEffect(() => {
    applyMeta({ title, description, path, robots, share });
  }, [title, description, path, robots, share]);
}
