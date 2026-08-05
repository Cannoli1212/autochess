// cards.js — what a card is + the finite shoe (draw/discard/shuffle).
// Depends on: config, state.

// Turn a rank number (2–14) into its card label (2–10, J, Q, K, A).
function rankLabel(rank) {
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  if (rank === 14) return "A";
  return String(rank);
}

// The figure glyph for a FUSED card: the two ranks followed by the ONE suit it
// actually functions as (its onto-suit) — e.g. 72♥ — in that suit's colour. Shows
// the unit's true identity at a glance; the tooltip still names both original parts.
// Ranks come from the FUSABLE_HANDS entry so the order is stable (always 72, not 27).
// `colorField` is "cardColor" (hand view) or "unitColor" (board view).
function fusedGlyphHTML(card, colorField) {
  const entry = FUSABLE_HANDS[card.fusedKey];
  const ranks = entry ? entry.ranks : card.parts.map(function (p) { return p.rank; });
  const s = SUITS[card.suit];   // the single functional suit
  const glyph = ranks.map(function (r) { return rankLabel(r); }).join("") + s.symbol;
  return '<span style="color:' + s[colorField] + '">' + glyph + '</span>';
}

// Build one card of a specific suit + rank. Stats = base × rank × STAT_SCALE.
function makeCardOf(suit, rank) {
  const s = SUITS[suit];
  const card = {
    suit: suit,
    rank: rank,
    range: s.range,
    attack: s.attack * rank * STAT_SCALE,
    hp: s.hp * rank * STAT_SCALE,
  };
  // Target Dummy (rank 3): a pure reflect-wall — ZERO attack, HP boosted by
  // DUMMY_HP_MULT. Baked in at card creation so the hand shows its real "0/big"
  // stats; combatStep skips its turn so it never moves or attacks (only Thorns).
  if (cardIsInert(card)) {
    card.attack = 0;
    card.hp = Math.round(card.hp * DUMMY_HP_MULT);
  }
  return card;
}

// A random card — only a safety fallback now that we draw from a real shoe.
function makeCard() {
  const suit = SUIT_NAMES[Math.floor(Math.random() * SUIT_NAMES.length)];
  const rank = 2 + Math.floor(Math.random() * 13);   // 2..14 inclusive
  return makeCardOf(suit, rank);
}

// Build one player's shoe: DECKS copies of all 52 suit+rank combos, shuffled.
function buildShoe() {
  const cards = [];
  for (let d = 0; d < DECKS; d++) {
    for (let si = 0; si < SUIT_NAMES.length; si++) {
      for (let rank = 2; rank <= 14; rank++) {
        cards.push(makeCardOf(SUIT_NAMES[si], rank));
      }
    }
  }
  shuffle(cards);
  return cards;
}

// Fisher–Yates shuffle, in place.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

// ── Jokers ────────────────────────────────────────────────────────────────────

// Is this card a joker? The ONE predicate everything else guards on. A joker has no
// suit and no rank, so any code path that reads either must check this first.
function cardIsJoker(card) {
  return !!card && card.kind === "joker";
}

// Build one joker card. Deliberately NOT shaped like a unit card — no suit, rank,
// range, attack or hp — so that anything which tries to treat it as a unit fails
// loudly at the guard rather than quietly spawning a broken body on the board.
function makeJokerCard(key) {
  return { kind: "joker", jokerKey: key, name: JOKERS[key].name };
}

// Shuffle JOKERS_PER_DECK × DECKS jokers into a shoe, in place.
//
// This is deliberately NOT part of buildShoe(). buildShoe also builds the COMMUNITY
// FLOP deck (flop.js) and the balance sim's deck (sim.js) — seeding jokers there
// would deal jokers onto the community board and poison every seeded balance number.
// initShoes() is the only caller, so jokers reach players' hands and nowhere else.
function seedJokers(shoe) {
  const n = JOKERS_PER_DECK * DECKS;
  for (let i = 0; i < n; i++) {
    // Duplicates are allowed: two of the same joker in a shoe is a real outcome, and
    // a real deck's two jokers are identical anyway.
    shoe.push(makeJokerCard(JOKER_KEYS[Math.floor(Math.random() * JOKER_KEYS.length)]));
  }
  shuffle(shoe);
  return shoe;
}

// Give both players a fresh shoe; empty their discard and played piles.
function initShoes() {
  draw = { player1: seedJokers(buildShoe()), player2: seedJokers(buildShoe()) };
  discard = { player1: [], player2: [] };
  played = { player1: [], player2: [] };
}

// Fold a player's discard pile back into their draw pile and reshuffle.
function reshuffle(team) {
  draw[team] = discard[team];
  discard[team] = [];
  shuffle(draw[team]);
}

// Draw one card from a player's shoe (reshuffling the discard if it empties).
function drawCard(team) {
  if (draw[team].length === 0) reshuffle(team);
  if (draw[team].length === 0) draw[team] = buildShoe();   // extreme safety
  return draw[team].pop();
}

// ── Fusion ("made hands") ─────────────────────────────────────────────────────

// Which FUSABLE_HANDS entry (if any) a pair of cards forms. Ranks match unordered;
// neither card may itself already be a fusion (no fusing a fused card). Returns the
// entry's KEY (e.g. "sevenTwo") or null. Used by the hand UI to know if a drop fuses.
function fusableKeyFor(cardA, cardB) {
  if (!cardA || !cardB || cardA.fused || cardB.fused) return null;
  const keys = Object.keys(FUSABLE_HANDS);
  for (let i = 0; i < keys.length; i++) {
    const entry = FUSABLE_HANDS[keys[i]];
    const want = entry.ranks;
    // Unordered pair match: the two wanted ranks are exactly this card pair.
    const ranksMatch =
      (cardA.rank === want[0] && cardB.rank === want[1]) ||
      (cardA.rank === want[1] && cardB.rank === want[0]);
    if (!ranksMatch) continue;
    // Offsuit-only hands (e.g. the 2-3 Dirty Diaper) refuse a SUITED pair — the two
    // cards must be different suits to fuse. Keep scanning in case another entry fits.
    if (entry.offsuitOnly && cardA.suit === cardB.suit) continue;
    return keys[i];
  }
  return null;
}

// Build ONE fused card from two parts. `onto` is the card dragged-onto — its SUIT
// wins (so the player chooses the fused unit's family). Stats = the SUM of both
// parts, each multiplied by the entry's tax knob (<1). The two originals ride along
// in `parts` — NOT to be re-split (fusion is permanent), but so the tooltip/display
// can name them and damage tracking keeps a stable key. A fused card is otherwise a
// normal card object (valid suit + a numeric rank = the onto card's, for the few
// engine spots that read a bare rank), so it flows shoe→hand→discard unchanged.
function makeFusedCard(key, onto, other) {
  const entry = FUSABLE_HANDS[key];
  const s = SUITS[onto.suit];
  return {
    suit: onto.suit,
    rank: onto.rank,               // a real numeric rank for bare-rank reads (display uses the label)
    range: s.range,
    attack: Math.round((onto.attack + other.attack) * entry.atkMult),
    hp: Math.round((onto.hp + other.hp) * entry.hpMult),
    fused: true,
    fusedKey: key,
    parts: [onto, other],          // the two originals, kept for display/tracking only
  };
}

// Fuse the two hand cards at indexes i and j (order-independent) for `team`, if
// they form a fusable pair. The card dropped ONTO (index `onto`) keeps its suit.
// Splices both out and drops the single fused card where the onto-card was, so the
// shoe's card objects are conserved AS the fused card (two go in, one comes back).
// Returns true if it fused. Timing (placement only) is enforced by the caller.
function fuseCards(team, onto, other) {
  const hand = hands[team];
  if (onto === other) return false;
  const cOnto = hand[onto];
  const cOther = hand[other];
  const key = fusableKeyFor(cOnto, cOther);
  if (key === null) return false;
  const fused = makeFusedCard(key, cOnto, cOther);
  // Remove the higher index first so the lower index stays valid.
  const hi = Math.max(onto, other);
  const lo = Math.min(onto, other);
  hand.splice(hi, 1);
  hand.splice(lo, 1);
  hand.splice(lo, 0, fused);       // put the fused card where the pair was
  return true;
}
