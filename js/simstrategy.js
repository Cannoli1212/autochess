// simstrategy.js — the STRATEGY ARCHETYPE tournament (a balance instrument, not gameplay).
//
// The problem it exists to solve: the game ships exactly ONE bot. Live P2, all five
// background table seats and both sides of every sim battle all run the same greedy
// `attack + hp` line in ai.js. So every balance number we have answers only "what
// happens when greed plays greed" — it can't tell us whether stacking pairs beats
// drafting big cards, or whether chasing a flush is viable at all.
//
// Here seven DRAFTING PERSONALITIES play each other. Two variables are deliberately
// pinned so drafting is the only thing that differs:
//   • POSITIONING is shared — every archetype uses ai.js's aiPickCell (melee front,
//     ranged back), so nobody wins on placement.
//   • NOBODY SEES THE COMMUNITY before placing. The live game re-randomizes the flop
//     each round and hides it until Round Start, so planning around it would be a
//     strategy the human player cannot use.
// Jokers are out of scope: makeCard never mints one, so headless hands are joker-free.
//
// Depends on: config, state, cards, synergies (pure evaluators), ai, sim, table.

// ── Scoring helpers ──────────────────────────────────────────────────────────
// Every scorer grades a WHOLE CANDIDATE ARMY, never one card, because a pair, a
// flush and a straight are properties of a set. They reuse synergies.js's pure
// evaluators (rankCounts / bestStraight / synergyTier), which take plain data and
// read no globals — that's what makes scoring a hypothetical hand possible.

// Raw stat total. Also the universal TIEBREAK: weighted at 1e-6 it can never
// outrank an archetype's real axis, but it keeps a strategy from playing garbage
// when its axis is unavailable (e.g. Set Miner holding no pair at all).
function statTotal(cards) {
  let t = 0;
  for (let i = 0; i < cards.length; i++) t += cards[i].attack + cards[i].hp;
  return t;
}
const STRAT_TIEBREAK = 1e-6;

function ranksOf(cards) { return cards.map(function (c) { return c.rank; }); }

function avgRank(cards) {
  if (cards.length === 0) return 0;
  return ranksOf(cards).reduce(function (s, r) { return s + r; }, 0) / cards.length;
}

// How many copies of the most common SUIT in this set.
function bestSuitCount(cards) {
  const bySuit = {};
  let best = 0;
  cards.forEach(function (c) {
    bySuit[c.suit] = (bySuit[c.suit] || 0) + 1;
    if (bySuit[c.suit] > best) best = bySuit[c.suit];
  });
  return best;
}

// Length of the longest run of consecutive ranks (0 if under 3 — bestStraight's floor).
function bestRunLength(cards) {
  const run = bestStraight(rankCounts(ranksOf(cards)));
  return run === null ? 0 : run.length;
}

// ── The seven archetypes ─────────────────────────────────────────────────────
// Each is { id, name, score(cards), wantsRedraw(cards) }.
//   score       — higher is better; the army with the top score gets played.
//   wantsRedraw — given the BEST army this hand can make, is the plan unmet? True
//                 spends one of the round's REDRAWS_PER_ROUND whole-hand rerolls,
//                 mirroring the live redraw rule (reroll first, then place).
//
// Where a scorer needs a number, it reads the GAME'S OWN reward tables rather than a
// hand-tuned constant, so an archetype keeps chasing whatever the game actually pays
// if those tables are retuned later.
const STRATEGIES = [
  {
    id: "highest", name: "Big Slick",
    desc: "always take the biggest ranks",
    score: function (cards) { return ranksOf(cards).reduce(function (s, r) { return s + r; }, 0); },
    wantsRedraw: function (cards) { return avgRank(cards) < 10; },
  },
  {
    id: "lowest", name: "Bottom Feeder",
    desc: "always take the smallest ranks",
    score: function (cards) { return ranksOf(cards).reduce(function (s, r) { return s + (16 - r); }, 0); },
    wantsRedraw: function (cards) { return avgRank(cards) > 6; },
  },
  {
    id: "middle", name: "Middle Management",
    desc: "hug the middle of the deck (rank 8)",
    score: function (cards) { return ranksOf(cards).reduce(function (s, r) { return s + (7 - Math.abs(r - 8)); }, 0); },
    wantsRedraw: function (cards) {
      if (cards.length === 0) return true;
      const off = ranksOf(cards).reduce(function (s, r) { return s + Math.abs(r - 8); }, 0) / cards.length;
      return off > 2;
    },
  },
  {
    id: "suited", name: "Flush Draw",
    desc: "stack one suit for the flush tiers",
    // Weighted by the SUIT SYNERGY ladder's own shape (2 of a suit / 3 / flush at 5
    // pay 1.0 / 2.5 / 6.0 in SYNERGIES.hearts), so it chases real breakpoints instead
    // of counting cards linearly. synergyTier is synergies.js's live tier function.
    score: function (cards) {
      const bySuit = {};
      cards.forEach(function (c) { bySuit[c.suit] = (bySuit[c.suit] || 0) + 1; });
      let total = 0;
      for (const su in bySuit) {
        const tier = synergyTier(bySuit[su]);
        total += (tier === 5) ? 6.0 : (tier === 3) ? 2.5 : (tier === 2) ? 1.0 : 0;
      }
      return total;
    },
    wantsRedraw: function (cards) { return bestSuitCount(cards) < 3; },
  },
  {
    id: "paired", name: "Set Miner",
    desc: "stack duplicate ranks for pair/trips/quads",
    // Reads POKER_HANDS.ofAKind directly — the exact table that pays the buff — and
    // multiplies by the number of cards carrying it, since the buff is per-card.
    score: function (cards) {
      const counts = rankCounts(ranksOf(cards));
      let total = 0;
      for (const r in counts) {
        const n = Math.min(counts[r], 4);
        const rung = POKER_HANDS.ofAKind[n];
        if (rung) total += counts[r] * rung.hpMult;
      }
      return total;
    },
    wantsRedraw: function (cards) {
      const counts = rankCounts(ranksOf(cards));
      for (const r in counts) if (counts[r] >= 2) return false;
      return true;
    },
  },
  {
    id: "connected", name: "Connector",
    desc: "chase runs of consecutive ranks",
    // Mirrors POKER_HANDS.shaped.straight: a 5+ run pays the `full` rate, a 3-4 run
    // the `small` rate, and the buff lands on every card in the run.
    score: function (cards) {
      const len = bestRunLength(cards);
      if (len === 0) return 0;
      const st = POKER_HANDS.shaped.straight;
      return len * ((len >= 5) ? st.full.hpMult : st.small.hpMult);
    },
    wantsRedraw: function (cards) { return bestRunLength(cards) < 3; },
  },
  {
    id: "control", name: "Greedy (today's AI)",
    desc: "the shipped bot: biggest attack + hp",
    // The CONTROL. Same score line as ai.js:50 and the same rank-8 redraw threshold as
    // aiMaybeReroll, so it reproduces the incumbent bot exactly. Without it we could
    // not tell whether any archetype actually beats the status quo.
    score: function (cards) { return statTotal(cards); },
    wantsRedraw: function (cards) { return avgRank(cards) < 8; },
  },
];

function strategyById(id) {
  for (let i = 0; i < STRATEGIES.length; i++) if (STRATEGIES[i].id === id) return STRATEGIES[i];
  return null;
}

// ── Choosing an army ─────────────────────────────────────────────────────────

// Every k-sized subset of arr. The hand is army+1 cards, so this tops out at 15
// subsets — brute force is exact and costs nothing, no heuristic needed.
function cardSubsets(arr, k) {
  const out = [];
  (function rec(start, cur) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); }
  })(0, []);
  return out;
}

// The best `size` cards in `hand` for this strategy, ordered strongest-first for
// placement (matching the greedy bot's placement order, so position is held constant).
// Called by ai.js's aiPlaceUnits when a strategy is supplied.
function strategyPickArmy(hand, size, strategy) {
  const playable = hand.filter(function (c) { return !cardIsJoker(c); });
  if (playable.length <= size) return playable.slice();

  const options = cardSubsets(playable, size);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const s = strategy.score(options[i]) + STRAT_TIEBREAK * statTotal(options[i]);
    if (s > bestScore) { bestScore = s; best = options[i]; }
  }
  return best.slice().sort(function (a, b) { return (b.attack + b.hp) - (a.attack + a.hp); });
}

// Draft a hand for one round, spending redraws the way the live player does.
// `carry` is last round's unplayed leftovers (the live economy carries them).
//
// NOTE it re-drafts with simDraftHand rather than calling rerollHand: rerollHand
// touches discard[team] and drawCard(team), and simInstall does NOT sandbox draw/
// discard/redrawsLeft — calling it inside a scan would corrupt the real player's shoe.
function strategyDraftHand(strategy, handSize, armySizeThisRound, carry) {
  let hand = (carry || []).slice();
  while (hand.length < handSize) hand.push(makeCard());

  for (let n = 0; n < REDRAWS_PER_ROUND; n++) {
    const plan = strategyPickArmy(hand, armySizeThisRound, strategy);
    if (!strategy.wantsRedraw(plan)) break;
    hand = simDraftHand(handSize);              // whole-hand reroll, as rerollHand does
  }
  return hand;
}

// ── Mode 1: head-to-head matrix ──────────────────────────────────────────────

// One isolated battle between two strategies at a given round's configuration.
// Mirrors simAIBattle's prep exactly, except each side drafts to its own plan and
// the community is sized by the TRUE round (so rounds 6-7 deal the 5-card river,
// which no existing scan has ever done).
function strategyBattle(stratA, stratB, round, aIsP1) {
  const size = ARMY_SCHEDULE[round] || PLAY_CAP;
  const handSize = HAND_SCHEDULE[round] || HAND_SCHEDULE[HAND_SCHEDULE.length - 1];
  const teamA = aIsP1 ? "player1" : "player2";
  const teamB = aIsP1 ? "player2" : "player1";

  units = [];
  tickCount = 0;
  traps = [];
  resetRoundStats();
  roundNumber = round;                          // real round → real community size
  armyOverride = size;
  weakCardsPlayed = { player1: 0, player2: 0 };
  played = { player1: [], player2: [] };
  hands = { player1: [], player2: [] };
  hands[teamA] = strategyDraftHand(stratA, handSize, size, []);
  hands[teamB] = strategyDraftHand(stratB, handSize, size, []);

  aiPlaceUnits("player1", aIsP1 ? stratA : stratB);
  aiPlaceUnits("player2", aIsP1 ? stratB : stratA);

  flop = [];
  growCommunity();
  applySynergies();
  for (let i = 0; i < units.length; i++) runAbilityHook(units[i], "onRoundStart", {});

  let result = null, guard = 0;
  while (result === null && guard < 1000) { result = combatStep(); guard++; }

  return { aWon: result === teamA, bWon: result === teamB, draw: result === "draw" || result === null };
}

// Every unordered PAIR of strategies, every round configuration, `games` battles each.
// Sides alternate within each pair so any side advantage cancels out.
function simStrategyScan(games) {
  games = games || 200;
  const saved = simInstall();
  SIM_MODE = true;
  const started = Date.now();

  function blankCells() {
    const c = {};
    STRATEGIES.forEach(function (a) {
      c[a.id] = {};
      STRATEGIES.forEach(function (b) { c[a.id][b.id] = { wins: 0, games: 0, draws: 0 }; });
    });
    return c;
  }

  const cell = blankCells();                    // cell[a][b] = {wins, games} across all rounds
  const rounds = {};                            // rounds[r][a][b] = the same, per round
  for (let r = 1; r <= MAX_ROUNDS; r++) rounds[r] = blankCells();

  function credit(c, A, B, o) {
    c[A.id][B.id].games++; c[B.id][A.id].games++;
    if (o.draw) { c[A.id][B.id].draws++; c[B.id][A.id].draws++; }
    else if (o.aWon) { c[A.id][B.id].wins++; }
    else { c[B.id][A.id].wins++; }
  }

  let battles = 0;
  for (let i = 0; i < STRATEGIES.length; i++) {
    for (let j = i + 1; j < STRATEGIES.length; j++) {
      const A = STRATEGIES[i], B = STRATEGIES[j];
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        for (let g = 0; g < games; g++) {
          const o = strategyBattle(A, B, round, g % 2 === 0);
          battles++;
          credit(cell, A, B, o);
          credit(rounds[round], A, B, o);
        }
      }
    }
  }

  SIM_MODE = false;
  simRestore(saved);
  render();

  const out = { games: games, battles: battles, elapsedMs: Date.now() - started,
                cell: cell, rounds: rounds };
  window.SIM_STRATEGY_RESULT = out;
  return out;
}

// ── Mode 2: 6-seat table games ───────────────────────────────────────────────

// One full 7-round table game with one archetype per seat. Uses the LIVE win rule
// (most chips after MAX_ROUNDS, nobody eliminated) rather than tableGame's headless
// elimination rule, so the ranking means what the shipped game means.
// `assign` maps seat index → strategy, rotated by the caller so no archetype is
// welded to a seat.
function strategyTableGame(assign) {
  const seats = assign.map(function (strat, i) {
    return { id: i, chips: SEAT_START_CHIPS, comps: 0, jokers: [], alive: true,
             strategy: strat, hand: [] };
  });

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const size = ARMY_SCHEDULE[round] || PLAY_CAP;
    const handSize = HAND_SCHEDULE[round] || HAND_SCHEDULE[HAND_SCHEDULE.length - 1];

    // Each seat drafts for itself, carrying last round's leftovers, spending its own
    // redraws. tableMatch takes seat.hand BY REFERENCE and playCard splices placed
    // cards out of it, so whatever survives is next round's carry.
    seats.forEach(function (s) {
      s.hand = strategyDraftHand(s.strategy, handSize, size, s.hand);
    });

    const pairing = pairSeats(seats);
    pairing.pairs.forEach(function (p) {
      tableMatch(p[0], p[1], size, null, round);   // 5th arg = the true round
    });
  }

  return seats.map(function (s) { return { strategy: s.strategy.id, chips: s.chips }; });
}

// Batch of table games. Reports each archetype's average chips, average finishing
// place, and outright win share.
function simStrategyTable(games) {
  games = games || 1000;
  const table = STRATEGIES.filter(function (s) { return s.id !== "control"; });   // 6 seats
  const saved = simInstall();
  SIM_MODE = true;
  const started = Date.now();

  const tally = {};
  table.forEach(function (s) { tally[s.id] = { chips: 0, place: 0, wins: 0, games: 0 }; });

  for (let g = 0; g < games; g++) {
    // Rotate the seat assignment so a seat-position artifact can't be read as a
    // strategy result.
    const assign = table.slice(g % table.length).concat(table.slice(0, g % table.length));
    const out = strategyTableGame(assign);

    const ranked = out.slice().sort(function (a, b) { return b.chips - a.chips; });
    ranked.forEach(function (r, idx) {
      const t = tally[r.strategy];
      t.chips += r.chips; t.place += idx + 1; t.games++;
      if (idx === 0) t.wins++;
    });
  }

  SIM_MODE = false;
  simRestore(saved);
  render();

  const rows = table.map(function (s) {
    const t = tally[s.id];
    return {
      id: s.id, name: s.name,
      avgChips: +(t.chips / t.games).toFixed(1),
      avgPlace: +(t.place / t.games).toFixed(2),
      winPct: +(100 * t.wins / t.games).toFixed(1),
    };
  }).sort(function (a, b) { return a.avgPlace - b.avgPlace; });

  const out = { games: games, elapsedMs: Date.now() - started, rows: rows };
  window.SIM_STRATEGY_TABLE = out;
  return out;
}

// ── Readouts ─────────────────────────────────────────────────────────────────

// The head-to-head matrix as rows of win% (row strategy vs column strategy), plus
// each strategy's overall win rate across every matchup.
function strategyMatrix(out) {
  out = out || window.SIM_STRATEGY_RESULT;
  if (!out) return "no strategy scan run yet";
  const ids = STRATEGIES.map(function (s) { return s.id; });
  const rows = ids.map(function (a) {
    const row = { strategy: a };
    let w = 0, g = 0;
    ids.forEach(function (b) {
      if (a === b) { row[b] = null; return; }
      const c = out.cell[a][b];
      row[b] = c.games ? +(100 * c.wins / c.games).toFixed(1) : 0;
      w += c.wins; g += c.games;
    });
    row.overall = g ? +(100 * w / g).toFixed(1) : 0;
    return row;
  }).sort(function (a, b) { return b.overall - a.overall; });
  return { games: out.games, battles: out.battles, rows: rows };
}

// Which street is this round? The community grows 3 → 4 → 5 across the game
// (COMMUNITY_SCHEDULE), which is what "flop / turn / river" names.
function streetOfRound(round) {
  const n = communityTarget(round);
  return (n >= 5) ? "river" : (n >= 4) ? "turn" : "flop";
}

// Each strategy's win rate BROKEN DOWN BY ROUND, plus the same grouped into streets.
//
// READ THIS WITH CARE: a round is not a clean experiment on community size. Advancing
// a round moves three dials at once — community (3/4/5), army (ARMY_SCHEDULE) and hand
// (HAND_SCHEDULE). So a strategy that climbs across streets may be gaining from the
// bigger community, the bigger board, or the wider hand. The per-round table reports
// all three so a jump can at least be attributed to the round where a dial moved.
function strategyByRound(out) {
  out = out || window.SIM_STRATEGY_RESULT;
  if (!out || !out.rounds) return "no per-round strategy scan run yet";
  const ids = STRATEGIES.map(function (s) { return s.id; });

  function winPct(cells, a) {
    let w = 0, g = 0;
    ids.forEach(function (b) {
      if (a === b) return;
      w += cells[a][b].wins; g += cells[a][b].games;
    });
    return { pct: g ? +(100 * w / g).toFixed(1) : 0, games: g };
  }

  const perRound = [];
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const row = {
      round: r, street: streetOfRound(r),
      community: communityTarget(r),
      army: ARMY_SCHEDULE[r] || PLAY_CAP,
      hand: HAND_SCHEDULE[r] || HAND_SCHEDULE[HAND_SCHEDULE.length - 1],
    };
    ids.forEach(function (a) { row[a] = winPct(out.rounds[r], a).pct; });
    perRound.push(row);
  }

  // Street rollup: pool the raw wins/games of every round on that street.
  const streets = ["flop", "turn", "river"].map(function (st) {
    const pooled = {};
    ids.forEach(function (a) { pooled[a] = { w: 0, g: 0 }; });
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      if (streetOfRound(r) !== st) continue;
      ids.forEach(function (a) {
        ids.forEach(function (b) {
          if (a === b) return;
          pooled[a].w += out.rounds[r][a][b].wins;
          pooled[a].g += out.rounds[r][a][b].games;
        });
      });
    }
    const row = { street: st, community: null, gamesPer: 0 };
    for (let r = 1; r <= MAX_ROUNDS; r++) if (streetOfRound(r) === st) row.community = communityTarget(r);
    ids.forEach(function (a) { row[a] = pooled[a].g ? +(100 * pooled[a].w / pooled[a].g).toFixed(1) : 0; });
    row.gamesPer = pooled[ids[0]].g;
    return row;
  });

  return { games: out.games, perRound: perRound, streets: streets };
}

// Sanity check, to run BEFORE trusting any tournament number: does each archetype
// actually play its plan? An archetype that silently fails to express itself still
// produces a confident, meaningless win rate.
function strategySamples(n, round) {
  n = n || 8;
  round = round || 5;
  const size = ARMY_SCHEDULE[round] || PLAY_CAP;
  const handSize = HAND_SCHEDULE[round] || HAND_SCHEDULE[HAND_SCHEDULE.length - 1];
  const saved = simInstall();
  SIM_MODE = true;
  const out = STRATEGIES.map(function (s) {
    const armies = [];
    for (let i = 0; i < n; i++) {
      const hand = strategyDraftHand(s, handSize, size, []);
      const army = strategyPickArmy(hand, size, s);
      armies.push(army.map(function (c) { return rankLabel(c.rank) + SUITS[c.suit].symbol; }).join(" "));
    }
    return { id: s.id, name: s.name, armies: armies };
  });
  SIM_MODE = false;
  simRestore(saved);
  return out;
}
