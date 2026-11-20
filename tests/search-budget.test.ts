// Search budget: one free Serper key (2,500/month) must last.
// Fakes fetch so no real search is made.

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++; console.error(`  FAIL: ${name}`);
}

(globalThis as any).Deno = { env: { get: (k: string) => ({ SERPER_API_KEY: 'k'.repeat(20), SEARCH_PAID_DAILY_CAP: '3' } as Record<string, string>)[k] } };

let serperCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  if (u.includes('serper.dev')) {
    serperCalls++;
    return new Response(JSON.stringify({ organic: [{ title: 't', link: `https://example.com/${serperCalls}`, snippet: 's', date: '2 days ago' }] }), { status: 200 });
  }
  return new Response('', { status: 500 });   // free backends fail fast
}) as typeof fetch;

const { multiWebSearch, getSearchBudget } = await import('../supabase/functions/chat-proxy/webSearch.ts');

// Same query twice, concurrently and afterwards: one paid call.
const [a, b] = await Promise.all([multiWebSearch('gta 6 news', 6, true), multiWebSearch('GTA 6  news', 6, true)]);
await multiWebSearch('gta 6 news', 6, true);
check('identical queries share one paid call', serperCalls === 1);
check('both callers get the hits', a.length === 1 && b.length === 1);
check('relative date is parsed', !!a[0].publishedISO && !isNaN(Date.parse(a[0].publishedISO!)));

// Distinct queries spend the cap, then paid backends are skipped.
await multiWebSearch('q2', 6, true);
await multiWebSearch('q3', 6, true);
check('cap of 3 reached', getSearchBudget().paidUsedToday === 3 && serperCalls === 3);
const over = await multiWebSearch('q4', 6, true);
check('past the cap no paid call is made', serperCalls === 3);
check('past the cap the search still resolves', Array.isArray(over));
check('budget reports configured', getSearchBudget().paidConfigured === true && getSearchBudget().paidDailyCap === 3);

globalThis.fetch = realFetch;
console.log(`search-budget: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
