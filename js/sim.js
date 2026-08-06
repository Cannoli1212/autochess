// sim.js — headless BATCH SIMULATOR for the balance pass.
// Runs many auto-battles with no UI to gather statistics you can't trust from a
// single noisy fight (crit/dodge/gambler swing one game hard; 100 games average
// out). Reuses the REAL combat engine — simBattle drives combatStep() exactly
// like gameflow does, minus the 500ms timer and the DOM — so the numbers reflect
// the actual game, not a reimplementation. Depends on: everything (loaded last).
//
// FIRST TOOL: a 1v1 round-robin CARD SCAN. Every card fights every other card
// N times (sides swapped each game to cancel who-moves-first bias). It measures
// RAW card strength — with one unit per side, suit synergies (need 2+) and
// ally-dependent abilities (rally, bower, the Royal Couple) never fire, so
// enabler cards read weak here BY DESIGN. Team-based testing is the next tool.

// Every card in the game: ranks 2..14 across all four suits = 52 cards.
function simAllCards() {
  const cards = [];
  for (let si = 0; si < SUIT_NAMES.length; si++) {
    for (let rank = 2; rank <= 14; rank++) {
      cards.push(makeCardOf(SUIT_NAMES[si], rank));
    }
  }
  return cards;
}

// A card's stable key + label ("spades-14" / "A♠").
function simKey(card) { return card.suit + "-" + card.rank; }
function simLabel(card) { return rankLabel(card.rank) + SUITS[card.suit].symbol; }

// Each side's starting cell: its own front row, same column, 3 apart — so ranged
// (range 3) opens fire turn one and melee must close, symmetric for both sides.
function simFrontPos(team) {
  return team === "player1" ? { x: 3, y: 5 } : { x: 3, y: 2 };
}

// Run ONE 1v1 battle to completion and report the outcome + each side's damage.
// aIsP1 flips which board side card A occupies (we alternate it across games so
// neither the first-mover nor either zone gives a card a standing edge).
function simBattle(cardA, cardB, aIsP1) {
  const teamA = aIsP1 ? "player1" : "player2";
  const teamB = aIsP1 ? "player2" : "player1";
  const pa = simFrontPos(teamA);
  const pb = simFrontPos(teamB);

  units = [];
  tickCount = 0;
  resetRoundStats();                         // fresh per-battle damage tally

  const unitA = buildUnit(cardA, pa.x, pa.y, teamA);
  const unitB = buildUnit(cardB, pb.x, pb.y, teamB);
  // Push player1's unit first so it acts first each tick — aIsP1 alternates which
  // card that is, so first-move advantage splits evenly over a matchup's games.
  if (teamA === "player1") units.push(unitA, unitB);
  else units.push(unitB, unitA);

  // Same pre-fight prep as a real round (gameflow.startRound), minus flop / AI /
  // airstrikes — a controlled 1v1. applySynergies bakes stats (no-op auras with
  // one unit) and sets crit/speed; onRoundStart runs each card's own kit.
  applySynergies();
  for (let i = 0; i < units.length; i++) runAbilityHook(units[i], "onRoundStart", {});

  let result = null, guard = 0;
  while (result === null && guard < 1000) { result = combatStep(); guard++; }

  const r = dmgStats.round;
  return {
    result: result,
    aWon: result === teamA, bWon: result === teamB, draw: result === "draw",
    aDealt: r[teamA].dealt, aTaken: r[teamA].taken,
    bDealt: r[teamB].dealt, bTaken: r[teamB].taken,
    ticks: tickCount,
  };
}

// Swap the live game's globals out for a clean sim sandbox, returning what to
// restore. Combat writes to these same globals, so we hand it fresh neutral ones
// (baseline economy, empty bench/flop/marks, its own damage tally) and put the
// real ones back afterward — the player's board is untouched.
function simInstall() {
  const saved = {
    units: units, tickCount: tickCount, inCombat: inCombat,
    placementOpen: placementOpen, dmgStats: dmgStats, chips: chips, comps: comps,
    jokers: jokers,
    weakCardsPlayed: weakCardsPlayed, hands: hands, played: played,
    flop: flop, strikeMarks: strikeMarks, traps: traps, roundNumber: roundNumber,
    communityDeck: communityDeck, flopRevealed: flopRevealed,
    armyOverride: armyOverride, jokerUsedThisRound: jokerUsedThisRound,
    jokerSuitPick: jokerSuitPick, roundDeaths: roundDeaths,
    rankGrowth: rankGrowth, suitGrowth: suitGrowth,
  };
  armyOverride = null;                        // each sim battle sets its own forced size
  clearInterval(combatTimer);                // stop any live fight
  inCombat = false; placementOpen = false;
  chips = { player1: 100, player2: 100 };    // neutral: Midas King sits at baseline
  comps = { player1: 0, player2: 0 };        // neutral: a headless fight earns/spends no shop money,
                                             // and the live player's comps can't reach it
  jokers = { player1: [], player2: [] };     // neutral: YOUR jokers must never buff an AI-vs-AI
                                             // fight. Now that jokers have real effects, this line
                                             // is the only thing standing between the two.
  jokerUsedThisRound = { player1: [], player2: [] };   // sandboxed with the collection above, so an
                                             // activated joker's once-per-round budget can't leak
  jokerSuitPick = { player1: null, player2: null };     // ...nor a Dealer call, which growCommunity
                                             // would otherwise honor inside a headless fight
  roundDeaths = { player1: 0, player2: 0 };  // the trigger jokers' tally: a sim battle must not
                                             // add its casualties to the live round's count
  // The ramp jokers' banks. NEUTRALIZING these matters more than snapshotting them: a live
  // player seven rounds into a Grinder would otherwise hand every headless fight a +70% rank,
  // silently skewing both the balance scans and the AI seats' matchups.
  rankGrowth = { player1: {}, player2: {} };
  suitGrowth = { player1: {}, player2: {} };
  weakCardsPlayed = { player1: 0, player2: 0 };  // neutral: Warlord's Levy adds nothing
  hands = { player1: [], player2: [] };      // empty bench: Necromancer can't summon
  played = { player1: [], player2: [] };
  flop = [];                                 // no community cards muddy the 1v1
  flopRevealed = false;
  communityDeck = buildShoe();               // fresh flop deck for AI-vs-AI rounds
  strikeMarks = { player1: [], player2: [] };
  traps = [];                                // sandboxed too: a headless fight's rank-8 bombs
                                             // must never land on (or damage) the live board
  dmgStats = {
    round: { player1: blankTeamStat(), player2: blankTeamStat() },
  };
  return saved;
}

function simRestore(s) {
  units = s.units; tickCount = s.tickCount; inCombat = s.inCombat;
  placementOpen = s.placementOpen; dmgStats = s.dmgStats; chips = s.chips; comps = s.comps;
  jokers = s.jokers;
  weakCardsPlayed = s.weakCardsPlayed; hands = s.hands; played = s.played;
  flop = s.flop; strikeMarks = s.strikeMarks; traps = s.traps; roundNumber = s.roundNumber;
  communityDeck = s.communityDeck; flopRevealed = s.flopRevealed;
  armyOverride = s.armyOverride; jokerUsedThisRound = s.jokerUsedThisRound;
  jokerSuitPick = s.jokerSuitPick; roundDeaths = s.roundDeaths;
  rankGrowth = s.rankGrowth; suitGrowth = s.suitGrowth;
}

// THE CARD SCAN. Play every unordered card pair `games` times and tally, for each
// card: games / wins / draws / total damage dealt & taken. Also fills a win-rate
// matrix[keyA][keyB] = fraction of games A beat B. Returns everything for export.
function simCardScan(games) {
  games = games || 100;
  const saved = simInstall();
  SIM_MODE = true;
  const started = Date.now();

  const cards = simAllCards();
  const results = {};
  const matrix = {};
  cards.forEach(function (c) {
    results[simKey(c)] = {
      key: simKey(c), label: simLabel(c), suit: c.suit, rank: c.rank,
      games: 0, wins: 0, draws: 0, dealt: 0, taken: 0,
    };
    matrix[simKey(c)] = {};
  });

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const A = cards[i], B = cards[j];
      const ra = results[simKey(A)], rb = results[simKey(B)];
      let aWins = 0, bWins = 0;
      for (let g = 0; g < games; g++) {
        const o = simBattle(A, B, g % 2 === 0);   // alternate sides
        ra.games++; rb.games++;
        ra.dealt += o.aDealt; ra.taken += o.aTaken;
        rb.dealt += o.bDealt; rb.taken += o.bTaken;
        if (o.aWon) { ra.wins++; aWins++; }
        else if (o.bWon) { rb.wins++; bWins++; }
        else { ra.draws++; rb.draws++; }
      }
      matrix[simKey(A)][simKey(B)] = aWins / games;
      matrix[simKey(B)][simKey(A)] = bWins / games;
    }
  }

  SIM_MODE = false;
  simRestore(saved);
  render();                                   // repaint the real board

  const out = {
    games: games,
    elapsedMs: Date.now() - started,
    results: results,
    matrix: matrix,
  };
  window.SIM_RESULT = out;                     // stash full data for extraction
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECOND TOOL: AI-vs-AI SCAN. Both sides are the real greedy bot (ai.js). Each
// battle, both AIs draft a fresh random hand and place a full team, then fight —
// so this exercises MIXED teams with synergies/poker/flop firing, the way the
// game actually plays. It answers "which suit & card win most and deal the most
// damage in real team play." Complements the 1v1 scan (which isolates raw
// strength). CAVEAT: the AI places its STRONGEST cards (attack+hp), so high ranks
// appear far more than low ones — low-card samples are small and noisy here.
// ═══════════════════════════════════════════════════════════════════════════

// A random hand of n cards for an AI to draft from (uniform over all 52 cards,
// like a fresh draw). The bot then places the strongest `roundNumber` of them.
function simDraftHand(n) {
  const hand = [];
  for (let i = 0; i < n; i++) hand.push(makeCard());
  return hand;
}

// One AI-vs-AI round battle at a given team size. Both bots draft (2× the size,
// like a real hand) and place; then the real round-start prep runs (flop reveal,
// synergies, onRoundStart kits) before combat. Returns the winner, the pre-fight
// roster (units die and get filtered, so we snapshot who fought), and the damage.
function simAIBattle(teamSize) {
  units = [];
  tickCount = 0;
  resetRoundStats();
  roundNumber = teamSize;                    // sizes this battle's community deck (communityTarget)
  armyOverride = teamSize;                    // force aiPlaceUnits to place exactly teamSize units
  weakCardsPlayed = { player1: 0, player2: 0 };
  played = { player1: [], player2: [] };
  hands = { player1: simDraftHand(teamSize + 1), player2: simDraftHand(teamSize + 1) };  // hand = army + 1 (live HAND_SCHEDULE)

  aiPlaceUnits("player1");
  aiPlaceUnits("player2");

  flop = [];                                 // fresh community for each isolated sim battle
  growCommunity();                           // deal this round's community (renderFlop is gated)
  applySynergies();                          // bake suit + poker buffs (now real, teams are big)
  for (let i = 0; i < units.length; i++) runAbilityHook(units[i], "onRoundStart", {});

  const roster = units.map(function (u) {
    return { key: u.suit + "-" + u.rank, suit: u.suit, rank: u.rank, team: u.team };
  });

  let result = null, guard = 0;
  while (result === null && guard < 1000) { result = combatStep(); guard++; }
  return { result: result, roster: roster, dmg: dmgStats.round };
}

// Run many AI-vs-AI battles across a sweep of team sizes and aggregate, per SUIT
// and per CARD: appearances (units fielded), wins/losses/draws (was the unit on
// the winning team?), and total damage dealt & taken. `games` battles PER size.
function simAIScan(games, sizes) {
  games = games || 2000;
  sizes = sizes || [2, 3, 4, 5];             // rounds 2-5; size 1 is the 1v1 scan
  const saved = simInstall();
  SIM_MODE = true;
  const started = Date.now();

  const cards = simAllCards();
  const perCard = {};
  cards.forEach(function (c) {
    perCard[simKey(c)] = {
      key: simKey(c), label: simLabel(c), suit: c.suit, rank: c.rank,
      appearances: 0, wins: 0, losses: 0, draws: 0, dealt: 0, taken: 0,
    };
  });
  const perSuit = {};
  SUIT_NAMES.forEach(function (su) {
    perSuit[su] = { suit: su, appearances: 0, wins: 0, losses: 0, draws: 0, dealt: 0, taken: 0 };
  });
  let battles = 0, draws = 0;

  sizes.forEach(function (size) {
    for (let g = 0; g < games; g++) {
      const o = simAIBattle(size);
      battles++;
      if (o.result === "draw") draws++;
      // Appearances + win/loss/draw, credited from the pre-fight roster.
      o.roster.forEach(function (u) {
        const pc = perCard[u.key], ps = perSuit[u.suit];
        pc.appearances++; ps.appearances++;
        if (o.result === "draw") { pc.draws++; ps.draws++; }
        else if (u.team === o.result) { pc.wins++; ps.wins++; }
        else { pc.losses++; ps.losses++; }
      });
      // Damage dealt/taken, read from the battle's per-team tallies.
      ["player1", "player2"].forEach(function (t) {
        const b = o.dmg[t];
        SUIT_NAMES.forEach(function (su) {
          perSuit[su].dealt += b.bySuit[su];
          perSuit[su].taken += b.takenBySuit[su];
        });
        for (const k in b.byCard) perCard[k].dealt += b.byCard[k];
        for (const k in b.takenByCard) perCard[k].taken += b.takenByCard[k];
      });
    }
  });

  SIM_MODE = false;
  simRestore(saved);
  render();

  const out = {
    games: games, sizes: sizes, battles: battles, draws: draws,
    elapsedMs: Date.now() - started, perCard: perCard, perSuit: perSuit,
  };
  window.SIM_AI_RESULT = out;
  return out;
}

// Compact readable summary of an AI-vs-AI scan: suit table + top cards.
function simAISummary(out) {
  out = out || window.SIM_AI_RESULT;
  if (!out) return "no AI scan run yet";
  const suitRows = SUIT_NAMES.map(function (su) {
    const s = out.perSuit[su];
    return {
      suit: su,
      winPct: s.appearances ? Math.round((s.wins / s.appearances) * 100) : 0,
      dealt: s.dealt, taken: s.taken,
    };
  }).sort(function (a, b) { return b.dealt - a.dealt; });
  const cardRows = Object.keys(out.perCard).map(function (k) {
    const c = out.perCard[k];
    return {
      label: c.label, apps: c.appearances,
      winPct: c.appearances ? Math.round((c.wins / c.appearances) * 100) : 0,
      avgDealt: c.appearances ? Math.round(c.dealt / c.appearances) : 0,
    };
  }).filter(function (r) { return r.apps >= 20; });   // drop tiny samples
  const byWin = cardRows.slice().sort(function (a, b) { return b.winPct - a.winPct; });
  const byDmg = cardRows.slice().sort(function (a, b) { return b.avgDealt - a.avgDealt; });
  return {
    battles: out.battles, elapsedMs: out.elapsedMs, draws: out.draws,
    suits: suitRows,
    topByWin: byWin.slice(0, 8),
    topByAvgDamage: byDmg.slice(0, 8),
  };
}

// A quick human-readable summary (top/bottom by win rate) so a scan can be
// eyeballed without serializing the whole matrix.
function simSummary(out) {
  out = out || window.SIM_RESULT;
  if (!out) return "no scan run yet";
  const rows = Object.keys(out.results).map(function (k) {
    const r = out.results[k];
    return { label: r.label, winPct: Math.round((r.wins / r.games) * 100), avgDealt: Math.round(r.dealt / r.games) };
  }).sort(function (a, b) { return b.winPct - a.winPct; });
  return {
    games: out.games, elapsedMs: out.elapsedMs, cards: rows.length,
    strongest: rows.slice(0, 8),
    weakest: rows.slice(-8),
  };
}
