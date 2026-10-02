import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { fetchPublicStats, statParts, statSentence } from '../../site/stats';

/**
 * "● 1,284 players · 9,312 answers researched · 412 games" — the real totals
 * from gg_public_stats(). Renders an empty, reserved line until they arrive,
 * and stays empty if they never do.
 */
export default function LiveCount() {
  const [parts, setParts] = useState([]);

  useEffect(() => {
    let alive = true;
    fetchPublicStats(supabase).then((stats) => { if (alive) setParts(statParts(stats)); });
    return () => { alive = false; };
  }, []);

  if (!parts.length) return <p className="s-livecount" aria-hidden="true" />;

  return (
    <p className="s-livecount is-ready" title="Players who have had an answer, on the web and in Discord">
      <span className="s-livecount__dot" aria-hidden="true" />
      <span className="sr-only">{statSentence(parts)} so far.</span>
      <span aria-hidden="true" className="s-livecount__line">
        {parts.map((p, i) => (
          <span key={p.label} className="s-livecount__part">
            <b>{p.value}</b> {p.label}
            {i < parts.length - 1 && <span className="s-livecount__sep">·</span>}
          </span>
        ))}
      </span>
    </p>
  );
}
