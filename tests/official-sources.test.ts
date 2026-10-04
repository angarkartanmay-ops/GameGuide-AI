// officialSources.ts — which game's official news feed a query pulls in.
//
// The loose pass used substring matching, so the alias "ow" (Overwatch)
// matched "hollow knight" and Overwatch news was injected into Hollow Knight
// answers in production. Aliases must match whole words only.

const { findOfficial } = await import('../supabase/functions/chat-proxy/officialSources.ts');

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${name}`);
}
const game = (q: string) => findOfficial(q)?.game ?? null;

check('hollow knight is not overwatch', game('hollow knight') === null);
check('"in hollow knight" is not overwatch', game('in hollow knight') === null);
check('valheim is not valorant', game('valheim') === null);
check('dark souls is not anything', game('dark souls') === null);
check('macro guide is not minecraft', game('macro guide') === null);
check('exact overwatch still matches', game('overwatch') === 'overwatch');
check('alias ow2 still matches', game('ow2') === 'overwatch');
check('alias inside a phrase still matches', game('ow2 season 20') === 'overwatch');
check('long form still matches', game('clash royale season 83') === 'clash royale');
check('val alias as its own word', game('val patch notes') === 'valorant');

console.log(`official-sources: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
