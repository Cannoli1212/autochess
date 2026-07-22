// table.js — the 6-SEAT TABLE layer (Phase C, headless-first).
//
// THE ONE IDEA in this file is the SEAT-vs-SIDE split:
//   • a SIDE is "player1" / "player2" — the only thing combat.js understands. A
//     fight always has exactly two sides. combat.js is UNTOUCHED by this file.
//   • a SEAT is a player at the table: its own chip stack and alive/dead flag.
//     A full table has NUM_SEATS (6) of them.
//
// Each round we PAIR the alive seats and fight every pairing as an ordinary
// 2-side combat: we load pairing seat A onto side "player1" and seat B onto
// side "player2", run the real engine to a result, then credit chips back to the
// SEATS. Loading two armies onto the player1/player2 globals and reading the
// winner back is exactly the trick sim.js already uses (simInstall/simRestore +
// simAIBattle) — this file reuses that machinery, it does not reinvent combat.
//
// "Headless-first": there is NO UI here yet. This file proves the table logic by
// running whole games in a batch (simTableScan), the same way sim.js validates
// card balance. The live 6-seat board comes in a later slice.
//
// Depends on: config, state, cards, ai (aiPlaceUnits), flop (growCommunity),
// synergies (applySynergies), combat (combatStep), sim (simInstall/simRestore).
// Loaded AFTER sim.js.

// ── Seat model ────────────────────────────────────────────────────────────────

// One seat at the table. `id` is 0..NUM_SEATS-1 (stable identity for stats),
// `chips` is its stack, `alive` flips false the moment it's busted. That's all a
// headless seat needs; a live seat will later also carry its own deck/hand.
function makeSeat(id) {
  return { id: id, chips: SEAT_START_CHIPS, alive: true };
}

// A fresh table of n seats (defaults to NUM_SEATS).
function makeTable(n) {
  n = n || NUM_SEATS;
  const seats = [];
  for (let i = 0; i < n; i++) seats.push(makeSeat(i));
  return seats;
}

// The seats still in the game.
function aliveSeats(seats) {
  return seats.filter(function (s) { return s.alive; });
}

// ── Pairing ─────────────────────────────────────────────────────────────────

// Fisher–Yates shuffle (in place) — the honest way to randomise pairings so no
// seat has a fixed opponent. Returns the same array for chaining.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Pair up this round's alive seats. Shuffle, then take them two at a time. If an
// odd number are alive, the last one drawn gets a BYE (sits the round, no fight,
// no chip change) — the honest way to handle 5 or 3 survivors. Returns
// { pairs: [[seatA, seatB], ...], bye: seat|null }.
function pairSeats(seats) {
  const pool = shuffle(aliveSeats(seats).slice());   // copy so we don't reorder the table
  const pairs = [];
  let bye = null;
  if (pool.length % 2 === 1) bye = pool.pop();        // odd one out sits this round
  for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
  return { pairs: pairs, bye: bye };
}

// ── One match (two seats fight, headless) ─────────────────────────────────────

// Fight seatA vs seatB at the given army size and settle the chips.
//
// This mirrors sim.js/simAIBattle's prep exactly (it's the same headless combat
// setup) with two table-specific twists:
//   1. we load each SEAT's chip stack onto its SIDE (chips.player1/2) before the
//      fight, so gold-scaling abilities (e.g. the Midas King) read the real
//      stack — not the neutral 100 that a pure card-scan uses.
//   2. after the result we do the chip STEAL on the seat objects themselves,
//      the same margin-of-victory math as gameflow.finishRound: the winner takes
//      CHIPS_PER_SURVIVOR per surviving unit, capped at what the loser has.
//
// Returns { winnerId, loserId, steal, survivors, draw } for the caller to log.
// Phase D2: pass an array as `frames` and a board snapshot is pushed each tick, so
// the fight can be replayed on the real board later. Omit it (balance scans do) and
// nothing is recorded — behavior is otherwise identical.
function tableMatch(seatA, seatB, armySizeThisRound, frames) {
  // Side assignment: A is always player1, B always player2 for this match. (Which
  // physical zone that is doesn't bias anything — the AI mirrors its placement.)
  units = [];
  tickCount = 0;
  resetRoundStats();
  roundNumber = armySizeThisRound;                 // aiPlaceUnits fills until countUnits==armySize()
  weakCardsPlayed = { player1: 0, player2: 0 };
  played = { player1: [], player2: [] };
  chips = { player1: seatA.chips, player2: seatB.chips };   // seat stacks drive gold abilities
  hands = {
    player1: simDraftHand(2 * armySizeThisRound),  // a fresh random hand, like a real draw
    player2: simDraftHand(2 * armySizeThisRound),
  };

  aiPlaceUnits("player1");
  aiPlaceUnits("player2");

  flop = [];
  growCommunity();                                 // this round's community (renderFlop is gated by SIM_MODE)
  applySynergies();                                // bake suit + poker buffs on the placed teams
  for (let i = 0; i < units.length; i++) runAbilityHook(units[i], "onRoundStart", {});

  if (frames) frames.push(snapshotFrame());        // opening board (units placed, pre-fight)
  let result = null, guard = 0;
  while (result === null && guard < 1000) {
    result = combatStep(); guard++;
    if (frames) frames.push(snapshotFrame());      // one snapshot per tick, for replay
  }

  // Settle chips at the SEAT level. A draw moves nothing.
  if (result === "draw" || result === null) {
    return { winnerId: null, loserId: null, steal: 0, survivors: 0, draw: true };
  }
  const winnerSeat = (result === "player1") ? seatA : seatB;
  const loserSeat  = (result === "player1") ? seatB : seatA;
  const survivors = countUnits(result);
  const steal = Math.min(survivors * CHIPS_PER_SURVIVOR, loserSeat.chips);
  winnerSeat.chips += steal;
  loserSeat.chips  -= steal;
  return {
    winnerId: winnerSeat.id, loserId: loserSeat.id,
    steal: steal, survivors: survivors, draw: false,
  };
}

// ── One whole table game ──────────────────────────────────────────────────────

// NOTE: this batch runner keeps the ELIMINATION model (bust at 0 chips) for balance
// scans. The LIVE Phase D game (gameflow.js) uses a different win condition —
// most chips after MAX_ROUNDS, nobody eliminated — so it drives tableMatch directly
// and never calls tableGame. The two intentionally differ.
//
// Play a full table to completion and report the outcome. Each round: pair the
// alive seats, fight every pairing, then eliminate any seat that hit 0 chips.
// The game ends when one seat is left OR we reach TABLE_ROUND_CAP rounds (then the
// richest alive seat wins — the safety cap so a batch run can't loop forever).
//
// Returns {
//   winnerId, rounds, elimOrder (seat ids, first knocked out first),
//   finalChips (id -> chips), byWins (id -> match wins)
// }.
function tableGame(numSeats) {
  const seats = makeTable(numSeats);
  const elimOrder = [];
  const byWins = {};
  seats.forEach(function (s) { byWins[s.id] = 0; });

  let round = 0;
  while (aliveSeats(seats).length > 1 && round < TABLE_ROUND_CAP) {
    round++;
    // Army size grows with the round exactly like the live game (armySize()):
    // rounds 1..5 field 1..5 units, then plateau at PLAY_CAP.
    const armySizeThisRound = Math.min(round, PLAY_CAP);

    const { pairs } = pairSeats(seats);            // (bye seat simply isn't fought)
    pairs.forEach(function (pair) {
      const out = tableMatch(pair[0], pair[1], armySizeThisRound);
      if (!out.draw) byWins[out.winnerId]++;
    });

    // Eliminate the busted. Record them in knock-out order (all this round's
    // casualties share an order slot; that's fine for aggregate stats).
    aliveSeats(seats).forEach(function (s) {
      if (s.chips <= 0) { s.alive = false; elimOrder.push(s.id); }
    });
  }

  // Winner = last seat standing, or (if the cap hit with several alive) the
  // richest. Ties broken by seat id, deterministically.
  const survivorsLeft = aliveSeats(seats).sort(function (a, b) {
    return b.chips - a.chips || a.id - b.id;
  });
  const winner = survivorsLeft[0];
  // Everyone still alive but not the winner ranks above the eliminated; push them
  // onto elimOrder (richest-first among them) so elimOrder + winner covers all seats.
  for (let i = survivorsLeft.length - 1; i >= 1; i--) elimOrder.push(survivorsLeft[i].id);

  const finalChips = {};
  seats.forEach(function (s) { finalChips[s.id] = s.chips; });
  return {
    winnerId: winner ? winner.id : null,
    rounds: round,
    elimOrder: elimOrder,
    finalChips: finalChips,
    byWins: byWins,
  };
}

// ── The batch scan (the headless-first deliverable) ───────────────────────────

// Run many whole table games and aggregate. This is to the 6-seat table what
// simCardScan / simAIScan are to card balance: proof the logic runs end-to-end,
// plus signal on how games play out (do they resolve? how long? is any seat POSITION
// advantaged — it must NOT be, seats are symmetric, so a flat ~1/NUM_SEATS win rate
// per seat is the health check). Reuses simInstall/simRestore to sandbox the globals.
//
// Returns { games, numSeats, elapsedMs, avgRounds, drawGames, seatWinPct[], sample }.
function simTableScan(games, numSeats) {
  games = games || 2000;
  numSeats = numSeats || NUM_SEATS;
  const saved = simInstall();                      // swap live globals for the sandbox
  SIM_MODE = true;
  const started = Date.now();

  const seatWins = {};
  for (let i = 0; i < numSeats; i++) seatWins[i] = 0;
  let totalRounds = 0, cappedGames = 0, sample = null;

  for (let g = 0; g < games; g++) {
    const out = tableGame(numSeats);
    if (out.winnerId != null) seatWins[out.winnerId]++;
    totalRounds += out.rounds;
    if (out.rounds >= TABLE_ROUND_CAP && aliveCountFromChips(out.finalChips) > 1) cappedGames++;
    if (g === 0) sample = out;                      // keep the first game verbatim to eyeball
  }

  SIM_MODE = false;
  simRestore(saved);                               // restore the player's real board

  // Seat win% — should hover near 100/numSeats for every seat if position is fair.
  const seatWinPct = [];
  for (let i = 0; i < numSeats; i++) {
    seatWinPct.push({ seat: i, wins: seatWins[i], pct: Math.round((seatWins[i] / games) * 1000) / 10 });
  }

  const out = {
    games: games,
    numSeats: numSeats,
    elapsedMs: Date.now() - started,
    avgRounds: Math.round((totalRounds / games) * 100) / 100,
    cappedGames: cappedGames,                       // games that hit the round cap with >1 alive
    seatWinPct: seatWinPct,
    sample: sample,                                 // the first game's full outcome, for a sanity read
  };
  window.SIM_TABLE_RESULT = out;
  return out;
}

// How many seats ended a game with chips left — a tiny helper so the scan can flag
// games that reached the cap without a clean last-seat-standing finish.
function aliveCountFromChips(finalChips) {
  let n = 0;
  for (const k in finalChips) if (finalChips[k] > 0) n++;
  return n;
}
