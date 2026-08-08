// Mirrors roll_tournament_matchups()'s algorithm exactly (see schema.sql)
// so the core rule -- "roll only the pool when one is staged, with a
// randomized bye on an odd count, otherwise fall back to rolling every
// unmatched team" -- can be verified without spinning up Postgres.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollMatchups({ teams, matchups, pool }) {
  const poolIdxs = pool.slice();
  let kept, freeIds;

  if (poolIdxs.length >= 2) {
    kept = matchups.slice(); // every existing matchup, locked or not, untouched
    freeIds = poolIdxs;
  } else {
    const usedIdxs = new Set();
    kept = matchups.filter((m) => {
      if (m.locked) {
        if (m.a != null) usedIdxs.add(m.a);
        if (m.b != null) usedIdxs.add(m.b);
        return true;
      }
      return false; // unlocked entries are dissolved, teams flow back to free pool
    });
    freeIds = teams.map((t) => t.idx).filter((idx) => !usedIdxs.has(idx));
  }

  const shuffled = shuffle(freeIds);
  const rolled = [];
  let ptr = 0;
  while (ptr < shuffled.length) {
    const a = shuffled[ptr++];
    const b = ptr < shuffled.length ? shuffled[ptr++] : null;
    rolled.push({ a, b, locked: false });
  }

  return { matchups: [...kept, ...rolled], pool: [] };
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

const TEAMS = Array.from({ length: 8 }, (_, i) => ({ idx: i }));

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok  -', name);
  } catch (e) {
    failures++;
    console.log('  FAIL -', name, '->', e.message);
  }
}

console.log('=== Scenario: pool count -> matchup/bye count (spec table) ===');
const spec = [
  [2, 1, 0], [3, 1, 1], [4, 2, 0], [5, 2, 1],
  [6, 3, 0], [7, 3, 1], [8, 4, 0],
];
for (const [poolSize, expectedMatches, expectedByes] of spec) {
  check(`${poolSize} locked teams -> ${expectedMatches} matchup(s), ${expectedByes} bye(s)`, () => {
    const pool = TEAMS.slice(0, poolSize).map((t) => t.idx);
    const result = rollMatchups({ teams: TEAMS, matchups: [], pool });
    const realMatchCount = result.matchups.filter((m) => m.b != null).length;
    const byeCount = result.matchups.filter((m) => m.b == null).length;
    assert(realMatchCount === expectedMatches, `expected ${expectedMatches} real 2-team matchups, got ${realMatchCount}`);
    assert(byeCount === expectedByes, `expected ${expectedByes} bye(s), got ${byeCount}`);
    assert(result.pool.length === 0, 'pool should be cleared after rolling');
    // every pool team appears in exactly one matchup, no team appears twice, no team outside the pool appears
    const seen = new Set();
    result.matchups.forEach((m) => {
      [m.a, m.b].forEach((idx) => {
        if (idx == null) return;
        assert(pool.includes(idx), `team ${idx} was rolled but was not in the pool`);
        assert(!seen.has(idx), `team ${idx} appears in more than one matchup`);
        seen.add(idx);
      });
    });
    assert(seen.size === poolSize, `expected all ${poolSize} pool teams to be matched, got ${seen.size}`);
  });
}

console.log('\n=== Scenario: locking A,B,C,D does NOT mean "A vs B, C vs D" ===');
check('a 4-team pool can produce a pairing other than the selection order', () => {
  const pool = [0, 1, 2, 3]; // A, B, C, D
  const seenOrders = new Set();
  for (let i = 0; i < 200; i++) {
    const result = rollMatchups({ teams: TEAMS, matchups: [], pool });
    const key = result.matchups.map((m) => [m.a, m.b].sort().join('-')).sort().join('|');
    seenOrders.add(key);
  }
  // "A vs B, C vs D" is only one of three possible pairings of 4 teams
  // (the other two being "A vs C, B vs D" and "A vs D, B vs C"). Over 200
  // rolls we should see more than just the naive selection-order pairing.
  assert(seenOrders.size > 1, `expected multiple distinct pairings across 200 rolls, got ${[...seenOrders]}`);
  console.log('       distinct pairings observed:', [...seenOrders]);
});

console.log('\n=== Scenario: the bye is also randomized (3-team pool) ===');
check('every team gets the bye across enough trials, not always the same one', () => {
  const pool = [0, 1, 2]; // A, B, C
  const byeCounts = { 0: 0, 1: 0, 2: 0 };
  for (let i = 0; i < 300; i++) {
    const result = rollMatchups({ teams: TEAMS, matchups: [], pool });
    const byeMatch = result.matchups.find((m) => m.b == null);
    byeCounts[byeMatch.a]++;
  }
  console.log('       bye distribution over 300 rolls:', byeCounts);
  assert(byeCounts[0] > 0 && byeCounts[1] > 0 && byeCounts[2] > 0, 'every team should get the bye at least once across 300 trials');
});

console.log('\n=== Scenario: pool-scoped roll leaves teams outside the pool untouched ===');
check('rolling a 4-team pool out of 8 total does not touch the other 4', () => {
  const pool = [0, 1, 2, 3]; // only lock half the teams
  const before = { teams: TEAMS, matchups: [], pool };
  const result = rollMatchups(before);
  const touchedIdxs = new Set();
  result.matchups.forEach((m) => { touchedIdxs.add(m.a); if (m.b != null) touchedIdxs.add(m.b); });
  [4, 5, 6, 7].forEach((idx) => assert(!touchedIdxs.has(idx), `team ${idx} (outside the pool) should not appear in any matchup`));
  const realMatchCount = result.matchups.filter((m) => m.b != null).length;
  assert(realMatchCount === 2, `expected exactly 2 real matchups from the 4-team pool, got ${realMatchCount}`);
});

console.log('\n=== Scenario: locked matchups are never touched by a pool-scoped roll ===');
check('an existing locked matchup survives a pool roll untouched', () => {
  const existingLocked = [{ a: 6, b: 7, locked: true }];
  const pool = [0, 1, 2, 3];
  const result = rollMatchups({ teams: TEAMS, matchups: existingLocked, pool });
  assert(result.matchups.some((m) => m.a === 6 && m.b === 7 && m.locked === true), 'locked matchup 6 vs 7 should still be present, unchanged');
  const realMatchCount = result.matchups.filter((m) => m.b != null).length;
  assert(realMatchCount === 3, `expected 1 kept locked matchup + 2 new pool matchups = 3 real matchups, got ${realMatchCount}`);
});

console.log('\n=== Scenario: empty pool falls back to rolling all remaining (old behavior) ===');
check('empty pool + no existing matchups rolls every team, byes included on odd counts', () => {
  const sevenTeams = TEAMS.slice(0, 7);
  const result = rollMatchups({ teams: sevenTeams, matchups: [], pool: [] });
  const realMatchCount = result.matchups.filter((m) => m.b != null).length;
  const byeCount = result.matchups.filter((m) => m.b == null).length;
  assert(realMatchCount === 3, `expected 3 real 2-team matchups for 7 teams, got ${realMatchCount}`);
  assert(byeCount === 1, `expected exactly 1 bye for 7 teams, got ${byeCount}`);
});
check('empty pool + a locked matchup: locked kept, only the rest re-rolled', () => {
  const existingLocked = [{ a: 0, b: 1, locked: true }];
  const eightTeams = TEAMS;
  const result = rollMatchups({ teams: eightTeams, matchups: existingLocked, pool: [] });
  assert(result.matchups.some((m) => m.a === 0 && m.b === 1 && m.locked), 'locked 0 vs 1 should survive');
  const realMatchCount = result.matchups.filter((m) => m.b != null).length;
  assert(realMatchCount === 4, `expected 1 kept + 3 new = 4 total real matchups for 8 teams, got ${realMatchCount}`);
});

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
