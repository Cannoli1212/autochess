// state.js — THE SINGLE SOURCE OF TRUTH.
// The only module that declares persistent game state and DOM element refs.
// Every other module reads/writes these; none declare their own game state.

// THE most important line: one array holding every unit on the board.
// Each unit is an object that remembers where it stands AND which team it's on.
let units = [];

// A NAME TAG FOR THE VIEW (week 4, the motion pass). Every unit gets a `uid` — just a
// number that counts up — stamped on it in buildUnit. The ENGINE never reads it: nothing
// in combat, pathing or the abilities cares which unit is which, only where they stand.
//
// The renderer does care. Once each unit owns a lasting piece of the page that WALKS from
// square to square (instead of being erased and re-drawn every tick), the drawing code has
// to be able to ask "which unit is this shape for?" and get the same answer next tick. The
// unit object itself can't answer that: a replay hands the board a fresh COPY of every unit
// each frame, so comparing objects would say "all new units" sixty times a second. A plain
// number survives being copied, so a replayed copy and the original agree.
//
// Never reset. Uids are unique for as long as the page is open, so two different recordings
// can't accidentally claim the same shape on screen.
let nextUid = 1;

// Which tick's MOVEMENT are we in? Bumped once at the top of every combatStep. The motion
// pass uses it to tell "this unit already stepped this tick, add to its route" from "this is
// a brand new tick, start a fresh route" (see noteStep in combat.js).
//
// Deliberately NOT tickCount: tickCount is incremented at the END of combatStep, after the
// board is drawn, and a recorded replay frame stores the already-incremented value — so a
// replayed frame's tickCount is one ahead of what it was when the unit actually moved, and
// a comparison against it would silently never match during a replay.
let moveSeq = 0;

// Combat state: whether a fight is happening, the repeating timer that
// drives it, and a safety counter so a stuck battle can't loop forever.
let inCombat = false;
let combatTimer = null;
let tickCount = 0;

// True while the batch simulator (sim.js) is running headless battles. Combat
// mutates the same globals as the live game, so render() checks this flag and
// skips all DOM work — that's what makes running thousands of fights fast.
let SIM_MODE = false;

// VISUAL FX QUEUE (Week 1 of the effects pass). Combat doesn't draw anything — it
// EMITS what happened as plain data (see emitFx in fx.js), one entry per event, and
// the view drains this list once a tick to animate it. Same inversion as the ability
// hooks: the engine reports, the renderer decides how it looks. Always emptied by
// playFx() at the end of a tick, so it never grows; emitFx is a no-op in SIM_MODE, so
// a headless 10k-game scan never touches it.
let fxEvents = [];

// RECORDING FX FOR REPLAY (week 3). The table's "watch" tabs replay the two fights you
// didn't personally fight, and those run headless — SIM_MODE on — so until now they
// recorded no effects whatsoever and replayed as glyphs sliding silently around a board.
//
// The obvious fix (just let emitFx run in SIM_MODE) would tax every balance scan, which
// is thousands of games where nobody is watching. So there are TWO flags, not one:
//
//   SIM_MODE   "there is no screen"    → skip DOM work
//   RECORD_FX  "but keep the events"   → someone will want to WATCH this later
//
// Only runHeadlessMatchups turns RECORD_FX on, around the two fights that get recorded.
// simTableScan and sim.js never touch it, so a 10,000-game scan is exactly as fast as
// before. The two questions really are separate, which is why they're separate flags.
let RECORD_FX = false;

// The events from the tick that just finished, kept back after playFx drains the queue.
//
// The ordering problem this solves: a tick's snapshot is taken AFTER combatStep runs, and
// combatStep ends by calling playFx — which empties fxEvents. So by the time anything
// tries to record the tick, the events are already gone. playFx stashes them here on its
// way out, and snapshotFrame picks them up. One mechanism, and it works identically for
// the live fight and the headless ones.
let lastTickFx = [];

// Round system: which round we're on (1..5) and how many rounds each player
// has won. The number of units you may place each round equals the round number.
let roundNumber = 1;
let roundWins = { player1: 0, player2: 0 };

// Phase C: each player's chip stack. Winning a round steals chips; at game end
// the winner is whoever has more (the net difference is the payout).
let chips = { player1: 100, player2: 100 };

// The SECOND currency (see COMPS_INCOME in config.js). Comps are MINTED each round,
// never stolen and never scored — they exist only to be spent in the shop (rerolls,
// packs, jokers). Start at 0: you earn your first comps by finishing round 1, so the
// shop opens on round 2. Survives nextRound (it's a bank, like chips); zeroed only by
// resetGame. Per-SEAT stacks live on the seat objects, same as chips.
let comps = { player1: 0, player2: 0 };

// The jokers each player has CLAIMED — kept for the rest of the game, capped at
// JOKER_SLOTS. A claimed joker leaves the shoe permanently (that's what "pick it up
// and keep it" means); one swapped out goes to the discard pile and can be redrawn.
// Survives nextRound, cleared by resetGame. Per-SEAT copies live on the seats.
let jokers = { player1: [], player2: [] };

// Two-step swap when the joker row is full: holds the HAND joker waiting for you to
// pick which claimed joker it replaces (null = no swap in progress). Purely an input
// mode, like tapSel — it never survives a round change.
let jokerSwapPending = null;

// A joker that has just been DRAWN and is being offered, or null. Shape:
// { team, card, stage, done } — `stage` is "choose" (accept/decline) or "replace" (the
// row is full, pick which held joker it takes over from), and `done` is the callback
// continuation fired exactly once when the player resolves it. Like jokerSwapPending
// this is pure input state and never survives a round change; unlike it, it BLOCKS —
// the dim behind the panel swallows clicks, so nothing else can happen until you choose.
let jokerOffer = null;

// An ACTIVATED joker mid-use (The Tailor): { key, team, card }. Most jokers are passive
// numeric fields, but a few need you to CHOOSE — which card, which suit — and that's a
// multi-click input mode, not a number. `card` is null until you've picked the card to act
// on; picking it reveals the suit chooser. Null = nothing being activated. Like
// jokerSwapPending this is pure input state and never survives a round change.
let jokerActionPending = null;

// Which activated jokers each team has already fired THIS round, by joker key. An
// activated joker is once per round — otherwise The Tailor would just recut your whole
// hand and the choice would be fake. Reset by nextRound, cleared by resetGame.
let jokerUsedThisRound = { player1: [], player2: [] };

// PERMANENT stat growth banked on a rank / a suit, per team: { player1: {9: 0.3}, ... }.
// The Grinder and The Believer fill these — every card of that rank (or suit) a team fields
// adds to the bank at round end, and applySynergies reads it every round after.
//
// Two deliberate properties:
//   · It accumulates only WHILE the joker is held, but applies whether or not it still is.
//     Growth you earned is yours — "permanently buffs" means permanently.
//   · It survives nextRound (that's the whole point) and is cleared only by resetGame. Which
//     makes it the first joker state that has to be NEUTRALIZED in simInstall, not merely
//     snapshotted, or a headless fight would inherit the live player's ramp.
let rankGrowth = { player1: {}, player2: {} };
let suitGrowth = { player1: {}, player2: {} };

// The suit each team's Dealer called for this round, or null. Unlike The Tailor — which
// resolves the moment you pick — The Dealer's choice is a STANDING ORDER: the community
// board isn't dealt until Round Start (growCommunity, after placement locks), so the
// conversion can only happen then. Reset by nextRound with the rest of the round state.
let jokerSuitPick = { player1: null, player2: null };

// How many EXTRA rerolls each player has bought THIS round. Only used to price the
// next one (COMPS_REROLL_COSTS escalates), so it resets every round with the free
// redraws. The bought reroll itself is just +1 to redrawsLeft — rerollHand is unchanged.
let rerollsBought = { player1: 0, player2: 0 };

// An open joker pack awaiting a pick: { team, cards: [...] }, or null. Pack jokers are
// MINTED by the shop rather than drawn from the shoe, so the ones you don't pick simply
// don't exist — nothing to return anywhere. Cleared on pick, round change and reset.
let packOffer = null;

// Cumulative count of LOW cards (ranks 2-5) each team has PLAYED this game. Bumped
// in playCard, never decremented, reset only on a new game (resetGame). Drives the
// King of Spades' uncapped attack scaling — the more cheap bodies you've fielded
// all game, the harder the King hits.
let weakCardsPlayed = { player1: 0, player2: 0 };

// The "house" pot — a neutral chip sink (the casino). The Queen of Spades (Hearts'
// Black Lady) bleeds chips here when a player ends a round still holding her. Only
// grows during a game; reset on a new game (resetGame).
let house = 0;

// King of Clubs' "airstrike": squares each team has marked on the ENEMY zone this
// round (blind, during placement). Each entry is { x, y }. At Round Start — after
// the enemy army appears — any enemy unit standing on a marked square dies. Cleared
// every round (marks are single-use). See strikeAllowance / resolveStrikes.
let strikeMarks = { player1: [], player2: [] };

// Rank 8 Trapline: live board traps during a fight. Each entry is
// { x, y, team, damage, slow } where `team` is the OWNER — only that team's ENEMIES
// spring it. Single-use: a trap is spliced out the moment it triggers. Traps belong to
// ONE fight: finishRound empties this the instant combat ends, so un-sprung bombs never
// survive onto the results screen or the next round's placement board.
let traps = [];

// Phase D: each player has their own shoe. `hands` = cards in hand; `draw` =
// the shoe to draw from; `discard` = spent cards; `played` = cards currently on
// the board this round (they move to discard when the round ends).
let hands = { player1: [], player2: [] };
let draw = { player1: [], player2: [] };
let discard = { player1: [], player2: [] };
let played = { player1: [], player2: [] };

// Phase E: the shared community flop (3 cards) and the deck it's drawn from.
// Flop suits count toward BOTH players' synergies (they never become units).
let flop = [];
let communityDeck = [];
let flopRevealed = false;   // the flop stays face-down until Round Start

// What is currently being dragged: a hand card, or a unit from the board.
let dragData = null;

// TAP-TO-PLACE selection — the touch-friendly twin of dragData (see placement.js).
// iOS fires no HTML5 drag events at all, so on an iPad the drag-only input made the
// game literally unplayable. Tapping a source SELECTS it, tapping a destination
// completes the same action a drop would have. Shape mirrors dragData, except a card
// selection holds the card OBJECT rather than its index: hands get spliced and
// reordered (play, fuse, redraw), and an index would quietly point at a different
// card afterwards. `null` = nothing selected.
let tapSel = null;

// True while players may edit the board (drag cards/units). False during a
// fight and while a round's result is still on screen.
let placementOpen = true;

// Part B (multiplayer), step 1: is Player 2 the computer? When true, the AI in
// ai.js places Player 2's army at Round Start and the human only manages Player 1.
// Toggle it off to go back to two-human hotseat. (A per-player flag once we scale
// past two players; a single boolean is enough for the first vs-computer step.)
let player2IsAI = true;

// P2 has THREE modes now, cycled by the toggle button: "computer" (AI places P2),
// "human" (hotseat — you place both sides), and "playtest" (a sandbox: you place both
// sides AND a card picker lets you field ANY suit+rank, with the per-round unit cap
// lifted so you can build arbitrary test scenarios). `player2IsAI` stays in sync
// (true only in "computer" mode) so every existing check keeps working untouched.
let p2Mode = "computer";                       // "computer" | "human" | "playtest"
function isPlaytest() { return p2Mode === "playtest"; }

// ── Phase D (6-seat table, live) ─────────────────────────────────────────────
// The live table. A SEAT is a player at the table (you = seat 0, seats 1-5 are AI);
// a SIDE is player1/player2, all combat understands (see table.js for the split).
// Each round you're PAIRED with one seat (opponentSeat) and fight it live on the
// board; the other four seats fight two headless matchups. `tableActive` gates the
// whole 6-seat flow — it's on for vs-computer and OFF for the classic 2-player
// testing modes (human hotseat / playtest), which stay exactly as they were.
let seats = [];              // 6 live seats; index 0 is you
let tableActive = false;     // true = 6-seat table flow; false = classic 2-player
let opponentSeat = 1;        // which seat is on the player2 side THIS round
let tablePairing = null;     // { opponentSeat, headless: [[a,b],[c,d]] } for the round
let tableRecap = [];         // last round's result lines, shown in the table panel

// Phase D2 — "tab to watch" the other fights. Combat is never re-run; instead each
// fight is RECORDED tick-by-tick (a list of board snapshots) so it can be replayed on
// the real board. `matchRecordings` holds this round's three fights (yours first);
// `liveFrames` accumulates YOUR fight's snapshots as its combat timer ticks;
// `viewingTab` is which fight the tab bar is showing; `replayTimer` drives playback.
let matchRecordings = [];    // [{ label, frames, ... }] for the round just fought
let liveFrames = [];         // your live fight's snapshots, packaged at finishRound
let viewingTab = 0;          // active tab in the match-tabs bar
let replayTimer = null;      // setInterval driving a replay (null = not replaying)
// True while a recorded fight is being played back on the board. render() gates the lunge
// and flinch animations on `inCombat`, which finishRound switches off before any replay is
// watchable — so without this flag the units in a replay would slide around without ever
// swinging at each other. See board.js.
let replaying = false;

// Display identity for each seat (index 0 = you). Purely cosmetic — seats carry no
// persistent deck in D1 (AI opponents draft a fresh hand each matchup, like the sim).
const SEAT_NAMES  = ["You", "Seat 2", "Seat 3", "Seat 4", "Seat 5", "Seat 6"];
const SEAT_COLORS = ["#5b8def", "#e0655b", "#e0a15b", "#5bbf7a", "#a15be0", "#e05bb0"];

// Build a fresh table of NUM_SEATS live seats at the starting stack. Called on a new
// game (resetGame) and when switching into table mode.
function makeLiveSeats() {
  seats = [];
  for (let i = 0; i < NUM_SEATS; i++) {
    seats.push({
      id: i, chips: SEAT_START_CHIPS, comps: 0, jokers: [], isHuman: i === 0,
      name: SEAT_NAMES[i], color: SEAT_COLORS[i],
    });
  }
  opponentSeat = 1;
  tablePairing = null;
  tableRecap = [];
}

// Phase E: true only on the results screen, when players may click their
// leftover cards to mark them "held" for next round. A held card carries a
// `held` flag on the card object itself. Off during placement and combat.
// (Superseded by auto-carry — leftovers now always carry — so this stays false.)
let holdMode = false;

// Redraws remaining THIS round for each player (a "redraw" rerolls the whole hand).
// Reset to REDRAWS_PER_ROUND at the start of every round; spent by rerollHand().
let redrawsLeft = { player1: REDRAWS_PER_ROUND, player2: REDRAWS_PER_ROUND };

// Grab the page elements we'll update.
const board = document.getElementById("board");
const counter = document.getElementById("counter");
const turnStatus = document.getElementById("turnStatus");
const message = document.getElementById("message");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");
const nextButton = document.getElementById("nextButton");
const redrawButton = document.getElementById("redrawButton");
const roundInfo = document.getElementById("roundInfo");
const dmgPanel = document.getElementById("dmgPanel");

// Turn a team code into a human-friendly label.
function label(team) {
  if (team === "player1") return "Player 1 (blue)";
  return "Player 2 (red)";
}

// Count how many units a team currently has on the board.
function countUnits(team) {
  return units.filter(function (u) { return u.team === team; }).length;
}

// Sim/table harnesses (simAIBattle, tableMatch) set this to FORCE an exact placement
// count for a headless fight; null means "use the round schedule below". It lives in
// the simInstall/simRestore snapshot, so it never leaks into live play.
let armyOverride = null;

// How many units each player places THIS round. Normally the ARMY_SCHEDULE entry for
// the current round (rounds 1..7 → 2,2,3,3,4,4,5); the harnesses can override it to a
// fixed count. This is the single source of truth for "army size" — every placement
// check reads it, so the schedule lives in one place (edit ARMY_SCHEDULE in config.js).
function armySize() {
  if (armyOverride !== null) return armyOverride;
  return ARMY_SCHEDULE[roundNumber] || PLAY_CAP;
}

// ── Damage tracking (balance instrumentation) ────────────────────────────────
// The whole point: you can't balance what you can't measure. Every point of
// damage in the game is BOOKED here through recordDamage(), so the numbers are
// one source of truth (no per-module tallies to drift apart).
//
// ONE scope: the current round. It's zeroed at Round Start — not at Next Round —
// so the fight's numbers stay on screen afterwards for you to read, and only
// wipe when the next fight actually begins. It drives the LIVE side panel, so
// you can watch dealt/taken tick up while the fight runs.
//
// There used to be a second `session` scope accumulating across every fight
// since page load. It was balance instrumentation, but it made the panel
// unreadable during play (round 5 was a blur of every fight so far, including
// the headless table matchups, which book into the same totals). Balance work
// runs through simTableScan now, which reads the round scope. So: round only.
function blankTeamStat() {
  return {
    dealt: 0,   // damage this team's units DID to the enemy
    taken: 0,   // damage this team's units RECEIVED
    bySuit: { hearts: 0, diamonds: 0, clubs: 0, spades: 0 },       // dealt, split by dealer suit
    byCard: {},                                                    // dealt, split by card ("suit-rank")
    takenBySuit: { hearts: 0, diamonds: 0, clubs: 0, spades: 0 },  // taken, split by VICTIM suit
    takenByCard: {},                                               // taken, split by VICTIM card
  };
}
let dmgStats = {
  round: { player1: blankTeamStat(), player2: blankTeamStat() },
};

// How many units each team LOST this fight, counted in combatStep as bodies are removed.
// One tally serves both trigger jokers, from opposite ends: your own count is what Dead
// Man's Hand pays on, the enemy's count is your kills and what The Enforcer pays on. Zeroed
// by resetRoundStats, so it covers exactly one fight — live or headless.
//
// Deaths rather than kills because death is the unambiguous event: a unit dies once, whereas
// "who killed it" is murky when poison, a redirected hit and thorns all contributed.
let roundDeaths = { player1: 0, player2: 0 };

// Book `amount` damage from `dealer` onto `victim` (both are UNIT objects, or
// null). It's credited as DEALT to the dealer's team — at team, suit, AND card
// level — and symmetrically as TAKEN by the victim's team at the same three
// levels. `dealerTeamFallback` covers source-less damage like poison, where
// there's no dealer unit but we still want the enemy team's DEALT total to
// balance the victim's TAKEN. Called wherever HP actually drops.
function recordDamage(dealer, victim, amount, dealerTeamFallback) {
  if (!(amount > 0)) return;            // ignore 0 / negatives (e.g. a fully-soaked hit)
  const dealerTeam = dealer ? dealer.team : dealerTeamFallback;
  const victimTeam = victim ? victim.team : null;
  const s = dmgStats.round;
  if (dealerTeam) {
    s[dealerTeam].dealt += amount;
    if (dealer) {                                  // card-level only when we know the source
      s[dealerTeam].bySuit[dealer.suit] += amount;
      const k = dealer.suit + "-" + dealer.rank;   // "suit-rank" convention (cf. UNIQUE_CARDS)
      s[dealerTeam].byCard[k] = (s[dealerTeam].byCard[k] || 0) + amount;
    }
  }
  if (victimTeam) {
    s[victimTeam].taken += amount;
    if (victim) {
      s[victimTeam].takenBySuit[victim.suit] += amount;
      const vk = victim.suit + "-" + victim.rank;
      s[victimTeam].takenByCard[vk] = (s[victimTeam].takenByCard[vk] || 0) + amount;
    }
  }
}

// Zero the per-ROUND stats (call at Round Start).
function resetRoundStats() {
  dmgStats.round = { player1: blankTeamStat(), player2: blankTeamStat() };
  roundDeaths = { player1: 0, player2: 0 };
}

// Zero every damage stat (call on a new game / Reset). Same thing as
// resetRoundStats now that round is the only scope, but kept separate because
// the CALL SITES mean different things — one is "new fight", one is "new game".
function resetAllStats() {
  dmgStats.round = { player1: blankTeamStat(), player2: blankTeamStat() };
}
