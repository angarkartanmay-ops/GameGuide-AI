// In-memory stand-in for the Supabase client, speaking just the calls the
// billing code makes. Shared by the Stripe, Razorpay and Lemon Squeezy tests.

const KEYS = { discord_billing_events: 'event_id', discord_entitlements: 'user_id', discord_premium_servers: 'guild_id' };
export function makeDb() {
  const t = { discord_billing_events: new Map(), discord_entitlements: new Map(), discord_premium_servers: new Map() };
  const state = { down: false, writes: 0 };
  const guardDown = () => { if (state.down) throw new Error('connection refused'); };
  const builder = (table) => {
    const rows = t[table], key = KEYS[table];
    const q = { op: null, payload: null, filter: null };
    const run = () => {
      guardDown();
      if (q.op === 'insert') {
        if (rows.has(q.payload[key])) return { error: { code: '23505', message: 'duplicate key' } };
        rows.set(q.payload[key], { ...q.payload }); state.writes++; return { error: null };
      }
      if (q.op === 'upsert') { rows.set(q.payload[key], { ...(rows.get(q.payload[key]) || {}), ...q.payload }); state.writes++; return { error: null }; }
      const match = [...rows.values()].filter(r => !q.filter || String(r[q.filter[0]]) === String(q.filter[1]));
      if (q.op === 'delete') { match.forEach(r => rows.delete(r[key])); return { error: null }; }
      if (q.op === 'update') { match.forEach(r => Object.assign(r, q.payload)); state.writes++; return { error: null }; }
      return { data: match[0] ?? null, error: null };
    };
    const api = {
      insert(p) { q.op = 'insert'; q.payload = p; return api; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return api; },
      update(p) { q.op = 'update'; q.payload = p; return api; },
      delete() { q.op = 'delete'; return api; },
      select() { q.op = 'select'; return api; },
      eq(c, v) { q.filter = [c, v]; return api; },
      maybeSingle() { return Promise.resolve().then(run); },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return api;
  };
  return { from: builder, t, state };
}

