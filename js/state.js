// state.js — THE SINGLE SOURCE OF TRUTH.
// The only module that declares persistent game state and DOM element refs.
// Every other module reads/writes these; none declare their own game state.

// THE most important line: one array holding every unit on the board.
// Each unit is an object that remembers where it stands AND which team it's on.
let units = [];

// Combat state: whether a fight is happening, the repeating timer that
// drives it, and a safety counter so a stuck battle can't loop forever.
let inCombat = false;
let combatTimer = null;
let tickCount = 0;

// True while the batch simulator (sim.js) is running headless battles. Combat
// mutates the same globals as the live game, so render() checks this flag and
// skips all DOM work — that's what makes running thousands of fights fast.
let SIM_MODE = false;

// Round system: which round we're on (1..5) and how many rounds each player
// has won. The number of units you may place each round equals the round number.
let roundNumber = 1;
let roundWins = { player1: 0, player2: 0 };

// Phase C: each player's chip stack. Winning a round steals chips; at game end
// the winner is whoever has more (the net difference is the payout).
let chips = { player1: 100, player2: 100 };

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
// spring it. Single-use: a trap is spliced out the moment it triggers. Rebuilt each
// fight (cleared at battle start, like strikeMarks), so nothing carries between rounds.
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

// Phase E: true only on the results screen, when players may click their
// leftover cards to mark them "held" for next round. A held card carries a
// `held` flag on the card object itself. Off during placement and combat.
let holdMode = false;

// Grab the page elements we'll update.
const board = document.getElementById("board");
const counter = document.getElementById("counter");
const turnStatus = document.getElementById("turnStatus");
const message = document.getElementById("message");
const startButton = document.getElementById("startButton");
const resetButton = document.getElementById("resetButton");
const nextButton = document.getElementById("nextButton");
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

// How many units each player places THIS round: the round number, capped at
// PLAY_CAP. Rounds 1..5 → 1..5; rounds 6-7 stay at 5 (the board cap). This is the
// single source of truth for "army size" — every placement check reads it, so the
// cap lives in one place.
function armySize() {
  return Math.min(roundNumber, PLAY_CAP);
}

// ── Damage tracking (balance instrumentation) ────────────────────────────────
// The whole point: you can't balance what you can't measure. Every point of
// damage in the game is BOOKED here through recordDamage(), so the numbers are
// one source of truth (no per-module tallies to drift apart).
//
// Two scopes are kept side by side:
//   • round   — zeroed at every Round Start; drives the LIVE side panel so you
//               can watch dealt/taken tick up during a fight.
//   • session — accumulates across EVERY fight since the page loaded (or the
//               last Reset), broken down by suit. THIS is the balance signal:
//               over many games, is one suit doing a lopsided share of the work?
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
  round:   { player1: blankTeamStat(), player2: blankTeamStat() },
  session: { player1: blankTeamStat(), player2: blankTeamStat() },
};

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
  ["round", "session"].forEach(function (scope) {
    const s = dmgStats[scope];
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
  });
}

// Zero the per-ROUND stats (call at Round Start). Session totals are untouched.
function resetRoundStats() {
  dmgStats.round = { player1: blankTeamStat(), player2: blankTeamStat() };
}

// Zero EVERYTHING, round and session (call on a new game / Reset).
function resetAllStats() {
  dmgStats.round   = { player1: blankTeamStat(), player2: blankTeamStat() };
  dmgStats.session = { player1: blankTeamStat(), player2: blankTeamStat() };
}
