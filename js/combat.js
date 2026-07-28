// combat.js — the auto-battle simulation.
// INVERSION #1: combatStep() runs one tick and RETURNS a result
// ("player1" | "player2" | "draw" | null=ongoing). It does NOT call game flow —
// gameflow owns the interval and reacts to the return value.
// Depends on: config, state, board.

// Find the closest enemy of a given unit (or null if none are left).
// UNTARGETABLE (Ace of Spades' drop-aggro): an enemy whose `untargetableUntil` is still
// in the future is INVISIBLE to targeting — it's skipped here, so units pathing/swinging
// re-acquire the next-nearest foe and the vanished Ace loses its aggro. This is the ONLY
// place untargetable is honored (aggro = who units path to and hit), so AoE/poison — which
// don't route through nearestEnemy — can still catch a hidden unit. It can still deal damage
// while hidden; only INCOMING aggro drops.
function nearestEnemy(unit) {
  let best = null;
  let bestDistance = Infinity;
  for (let i = 0; i < units.length; i++) {
    const other = units[i];
    if (other.team === unit.team) continue;   // skip our own team
    if (tickCount < (other.untargetableUntil || 0)) continue;   // vanished → can't be aggroed
    // Distance = the larger of the horizontal/vertical gap (diagonal steps allowed).
    const distance = Math.max(Math.abs(other.x - unit.x), Math.abs(other.y - unit.y));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }
  return best;
}

// Find the FARTHEST enemy of a given unit (or null if none are left) — the mirror of
// nearestEnemy, used by the Ace of Clubs' sniper cast to pick the enemy "backline"
// (deepest = greatest Chebyshev distance from the shooter). Honors the same untargetable
// skip so a vanished unit isn't sniped either.
function farthestEnemy(unit) {
  let best = null;
  let bestDistance = -1;
  for (let i = 0; i < units.length; i++) {
    const other = units[i];
    if (other.team === unit.team || other.hp <= 0) continue;
    if (tickCount < (other.untargetableUntil || 0)) continue;
    const distance = Math.max(Math.abs(other.x - unit.x), Math.abs(other.y - unit.y));
    if (distance > bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }
  return best;
}

// The FIRST living enemy standing on the straight 8-direction line from `shooter` toward
// `target` — how the Ace of Clubs' sniper shot can be BLOCKED. Walks cell by cell from just
// in front of the shooter to the target; whoever the ray reaches first is who eats the bullet
// (a frontline body soaks a shot meant for the backline). Returns `target` itself if the line
// is clear all the way there, or null if the shot isn't on a clean 8-direction ray. Allies
// don't block — the bullet flies past its own team.
function firstEnemyOnLine(shooter, target) {
  const dx = Math.sign(target.x - shooter.x);
  const dy = Math.sign(target.y - shooter.y);
  if (dx === 0 && dy === 0) return target;                 // on top of it → just hit it
  // Only a clean 8-direction ray (orthogonal or perfect diagonal) can be traced cell by cell.
  const adx = Math.abs(target.x - shooter.x);
  const ady = Math.abs(target.y - shooter.y);
  if (adx !== 0 && ady !== 0 && adx !== ady) return target;   // off-axis → no blocker check, hit target
  let x = shooter.x + dx;
  let y = shooter.y + dy;
  while (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
    const u = findUnitAt(x, y);
    if (u && u.team !== shooter.team && u.hp > 0) return u;   // first enemy body on the ray
    if (x === target.x && y === target.y) break;             // reached the target's cell
    x = x + dx;
    y = y + dy;
  }
  return target;
}

// The nearest LIVING teammate of a unit (not itself), by the same Chebyshev
// distance movement/range use. null if it's the last of its team standing. Used
// by the rank-9 poison transfer to pick who inherits a dead carrier's stacks.
function nearestTeammate(unit) {
  let best = null;
  let bestDistance = Infinity;
  for (let i = 0; i < units.length; i++) {
    const other = units[i];
    if (other === unit || other.team !== unit.team || other.hp <= 0) continue;
    const distance = Math.max(Math.abs(other.x - unit.x), Math.abs(other.y - unit.y));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }
  return best;
}

// Units struck by a PIERCING shot (rank 9's Poison Volley): the aimed target, then every
// living ENEMY of the shooter on the straight 8-direction ray BEHIND it — the same
// direction the arrow travels (from shooter through target). Walks cell by cell to the
// board edge, collecting up to `maxPierce` bodies beyond the target. Allies and empty
// cells don't block or count; the arrow flies past them.
function unitsAlongLine(shooter, target, maxPierce) {
  const hits = [target];
  const dx = Math.sign(target.x - shooter.x);
  const dy = Math.sign(target.y - shooter.y);
  if (dx === 0 && dy === 0) return hits;          // shooter on top of target → just the target
  let x = target.x + dx;
  let y = target.y + dy;
  let pierced = 0;
  while (x >= 0 && x < COLS && y >= 0 && y < ROWS && pierced < maxPierce) {
    const u = findUnitAt(x, y);
    if (u && u.team !== shooter.team && u.hp > 0) {
      hits.push(u);
      pierced++;
    }
    x = x + dx;
    y = y + dy;
  }
  return hits;
}

// Units struck by a LIGHTNING CHAIN (rank 7's Slot Machine "chain" reel): the aimed target, then
// the bolt JUMPS to the nearest not-yet-hit living enemy within `jumpRange` (Chebyshev) of the LAST
// unit it struck, up to `maxJumps` extra bounces. Unlike a piercing volley (a straight line through
// the target), the chain zig-zags toward whichever enemy is closest at each hop. Allies never
// conduct. Returns the ordered hit list; the caller deals decaying damage down it (falloff per hop).
function chainTargets(caster, firstTarget, maxJumps, jumpRange) {
  const hits = [firstTarget];
  let last = firstTarget;
  for (let j = 0; j < maxJumps; j++) {
    let best = null, bestDist = Infinity;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.team === caster.team || u.hp <= 0) continue;   // enemies only, still alive
      if (hits.indexOf(u) !== -1) continue;                // already zapped this chain
      const d = Math.max(Math.abs(u.x - last.x), Math.abs(u.y - last.y));
      if (d <= jumpRange && d < bestDist) { bestDist = d; best = u; }
    }
    if (best === null) break;                              // nothing in reach → chain ends early
    hits.push(best);
    last = best;
  }
  return hits;
}

// Living ENEMIES of `unit` within `radius` cells of it (Chebyshev, same distance as
// range/movement). The self-centered mirror of unitsAlongLine: instead of a ray THROUGH a
// far target, this is "everything hugging me right now." Used by the melee rank-6 Hellfire
// Aura (burnAura) — and reusable by any future self-centered nova (e.g. a melee rank-9
// poison cloud). Reads live positions, so it catches whoever is adjacent at cast time.
function enemiesNear(unit, radius) {
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.team === unit.team || u.hp <= 0) continue;
    const d = Math.max(Math.abs(u.x - unit.x), Math.abs(u.y - unit.y));
    if (d <= radius) out.push(u);
  }
  return out;
}

// Drop ONE single-use trap for `team` on cell (tx, ty) — the shared placement primitive
// for BOTH rank-8 trap casts: Trapline (a forward line, melee ♥/♦) and Caltrops (a self-ring,
// ranged ♣/♠). Silently skips a cell that's off the board or already holds a same-team trap
// (no stacking). The trap's actual bite — minimal damage + a slow, then consumed — lives in
// combatStep's trap pass, because the hazard sits on the BOARD, not on a unit.
function dropTrap(team, tx, ty, damage, slow) {
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return;   // off the board
  for (let t = 0; t < traps.length; t++) {
    const tr = traps[t];
    if (tr.x === tx && tr.y === ty && tr.team === team) return;   // same-team trap already here
  }
  traps.push({ x: tx, y: ty, team: team, damage: damage, slow: slow });
}

// Find the empty board cell closest to (ox, oy), or null if the board is full.
// "Closest" uses the same Chebyshev distance as movement/range (diagonals count as
// one step). Scans every square and keeps the nearest empty one. Used by the Ace of
// Hearts to decide where a summoned bench card appears.
function nearestEmptyCell(ox, oy) {
  let best = null;
  let bestDistance = Infinity;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (findUnitAt(x, y) !== null) continue;   // occupied → skip
      const distance = Math.max(Math.abs(x - ox), Math.abs(y - oy));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: x, y: y };
      }
    }
  }
  return best;
}

// Resolve one attack, running ability hooks at each moment: dodge check →
// crit → outgoing-damage abilities → apply → target reacts → attacker reacts.
function attackTarget(attacker, target) {
  // ATTACK-MANA (casting Slice 2): a caster whose mana fills from SWINGING (manaPerAttack
  // > 0, e.g. the Queen of Clubs Cleric) banks mana here — once per swing, the moment it
  // commits, so a dodged/blanked hit still charges the bar (like TFT). Regen-mana casters
  // have manaPerAttack 0 and are unaffected; pure casters never reach this function.
  if (attacker.manaPerAttack) {
    attacker.mana = Math.min(attacker.manaMax, attacker.mana + attacker.manaPerAttack);
  }

  // FX (week 2 slice 1): the swing COMMITS here. Emitted BEFORE the dodge and
  // invulnerability checks below, so a shot that whiffs still shows the arrow
  // flying — the miss label is the point, not a missing tracer. Note this carries
  // `from` as well as the target square: the first event in the game that describes
  // a RELATIONSHIP rather than a thing that happened to one unit. fx.js decides what
  // a swing looks like (and whether a melee swing draws anything at all).
  emitFx("shot", {
    from: { x: attacker.x, y: attacker.y },
    x: target.x, y: target.y,
    team: attacker.team, suit: attacker.suit,
  });

  // FX (week 2 slice 2): remember WHICH WAY this unit just swung, for one tick. Unlike
  // the queue above this is a STAMP on the unit — it isn't a moment in time, it's a
  // property of how the unit should be drawn this tick, which is render()'s business.
  // Same tick-stamp pattern as castFlashUntil. Stamped for every attacker; render()
  // decides only melee units actually lunge (ranged already got a tracer).
  attacker.lungeX = target.x - attacker.x;
  attacker.lungeY = target.y - attacker.y;
  attacker.lungeUntil = tickCount + 1;

  // Dodge: the target may avoid the hit entirely (Slippery). A whiff deals no
  // damage and fires no on-hit effects (crit, thorns, lifesteal).
  const incoming = { attacker: attacker, dodged: false };
  runAbilityHook(target, "onIncomingHit", incoming);
  if (incoming.dodged) {
    emitFx("miss", { x: target.x, y: target.y });     // the swing came and did nothing — say so
    return;
  }

  // Invulnerability window (Q♥ mourning her fallen King) cancels the hit outright,
  // exactly like a dodge — no damage, no on-hit effects.
  if (tickCount < (target.invulnUntil || 0)) {
    emitFx("block", { x: target.x, y: target.y });    // blanked, not dodged — a different word
    return;
  }

  const s = SUITS[attacker.suit];
  const ctx = { target: target, damage: attacker.attack };

  // Crit (stat): chance to double damage (spade base + spade synergy, baked into
  // critChance at Round Start). Fall back to the suit's base crit.
  const critChance = (attacker.critChance !== undefined) ? attacker.critChance : (s.crit || 0);
  let didCrit = false;                                     // remembered only so the fx layer can flag it
  if (Math.random() < critChance) { ctx.damage = ctx.damage * 2; didCrit = true; }

  // TEMPORARY ATTACK BUFF (King of Hearts' rally on his Queen): a timed outgoing-damage
  // window, checked like invulnUntil/stunUntil. While `tickCount < atkBuffUntil`, the
  // attacker's swings are multiplied by `atkBuffMult` — auto-expiring, so no cleanup pass
  // and no permanent mutation of the base attack stat. Recasting just pushes the tick-stamp
  // out again. Only touches AUTO-attacks (this pipeline); it never boosts spell damage.
  if (tickCount < (attacker.atkBuffUntil || 0)) {
    ctx.damage = Math.round(ctx.damage * (attacker.atkBuffMult || 1));
  }

  // Attacker's outgoing-damage abilities can adjust the pending damage (Giant
  // Slayer). They read/write ctx.damage before it lands.
  runAbilityHook(attacker, "onAttack", ctx);

  // Target's flat mitigation (Bulwark set incoming.reduce in onIncomingHit),
  // applied AFTER crit/bonuses. Floored at 1 so a shield is never full immunity.
  if (incoming.reduce) ctx.damage = Math.max(1, ctx.damage - incoming.reduce);

  // Royal redirect (K♥ bodyguards Q♥): if the target is a guarded Queen whose King
  // still lives, the hit's HP loss — and everything downstream of it (his shield,
  // his onDamaged, and the kill credit) — lands on the KING instead. For any normal
  // unit royalSink returns null, so `sink` is just the target and nothing changes.
  const sink = royalSink(target) || target;

  // FX: the King just stepped in front of a hit meant for his Queen. Without an arrow
  // from her square to his, the damage simply appears on the wrong unit and the whole
  // bodyguard mechanic is invisible. `sink !== target` is exactly "a redirect happened".
  if (sink !== target) {
    emitFx("redirect", { from: { x: target.x, y: target.y }, x: sink.x, y: sink.y });
  }

  // Execute (rank 6's Executioner set ctx.execute in onAttack): the hit becomes
  // EXACTLY lethal — the sink's remaining HP plus any banked shield — so it kills
  // through Bulwark's floor-at-1 and the Aegis shield with no wasted overkill.
  // Math.max keeps a hit that was ALREADY lethal at its full number. Note the
  // royal redirect above: executing a guarded Queen kills her KING instead — the
  // bodyguard dies doing his job.
  if (ctx.execute) {
    ctx.damage = Math.max(ctx.damage, sink.hp + (sink.shield || 0));
    emitFx("execute", { x: sink.x, y: sink.y });   // this wasn't a big hit, it was an execution
  }

  // Shield (Ace of Diamonds' Aegis): a damage POOL on the unit ACTUALLY taking the
  // hit that soaks damage before HP. It absorbs up to its remaining value and
  // depletes by that much, so only the leftover reaches HP. Done before HP is
  // touched so a banked shield can fully negate a hit (unlike Bulwark, floored at 1).
  let absorbed = 0;                                        // hoisted so the fx layer can show it
  if (sink.shield > 0) {
    absorbed = Math.min(sink.shield, ctx.damage);
    sink.shield = sink.shield - absorbed;
    ctx.damage = ctx.damage - absorbed;
  }

  sink.hp = sink.hp - ctx.damage;

  // Balance instrumentation: book the HP actually lost (post-crit, post-shield)
  // as damage the ATTACKER dealt and the sink's team took. ctx.damage is 0 when a
  // shield fully soaked the hit, and recordDamage ignores 0 — soaked hits don't count.
  recordDamage(attacker, sink, ctx.damage);

  // Tell the fx layer what just landed (see fx.js). Emitting BEFORE the reaction
  // hooks run pins the numbers to where the hit actually happened. Two separate
  // numbers when a shield partly ate the swing — steel for the part the shield
  // swallowed, white for the part that reached HP — so armor visibly does its job.
  if (absorbed > 0)    emitFx("absorb", { x: sink.x, y: sink.y, amount: absorbed });
  if (ctx.damage > 0)  emitFx("hit",    { x: sink.x, y: sink.y, amount: ctx.damage, crit: didCrit });

  // FX: the unit that actually took the hit flinches for a tick (see render). Stamped
  // on the SINK, so when the King eats a hit meant for his Queen, HE is the one who
  // recoils — which is exactly the redirect you'd otherwise never see happening.
  // Auto-attacks only: poison ticks every single tick, and a permanently shaking unit
  // would read as noise rather than impact.
  if (ctx.damage > 0 || absorbed > 0) sink.flinchUntil = tickCount + 1;

  // The unit that took the damage reacts (Thorns reflect, Berserk ramp).
  runAbilityHook(sink, "onDamaged", { attacker: attacker, damage: ctx.damage });

  // Attacker reacts to dealing damage (Lifesteal). New effects plug in at these
  // hooks as DATA in abilities.js; this function never has to change again.
  runAbilityHook(attacker, "onDealDamage", { target: sink, damage: ctx.damage });

  // Did that hit KILL the unit that took it? If so, the attacker gets its on-kill
  // payoff (Ace of Diamonds banks a shield, Ace of Hearts summons a bench card).
  // Fired here, once, the moment HP crosses 0 — the dead unit is filtered out later
  // in combatStep, so this is the last chance to react to the kill.
  if (sink.hp <= 0) {
    runAbilityHook(attacker, "onKill", { target: sink });
  }
}

// Spell damage (casting Phase 2): how a CAST puts damage on a target — deliberately
// SEPARATE from the auto-attack pipeline in attackTarget. It respects the defenses that
// any HP loss respects (an invulnerability window, the K♥/Q♥ royal redirect, the Aegis
// shield) and it makes the victim REACT (Thorns reflect, Berserk ramp via onDamaged),
// but it does NOT crit, does NOT run the caster's onAttack, and does NOT lifesteal — a
// fireball is its own damage type, not a swing. A spell KILL still pays the caster's
// onKill so on-kill legendaries keep working. Raw + self-contained (the victim's
// onDamaged handlers only do raw HP math), so it can't recurse into another attack.
function dealSpellDamage(caster, target, amount) {
  if (!target || target.hp <= 0 || amount <= 0) return;
  if (tickCount < (target.invulnUntil || 0)) {              // invulnerable → blanked
    emitFx("block", { x: target.x, y: target.y });
    return;
  }
  const sink = royalSink(target) || target;                 // a guarded Queen redirects onto her King
  let dmg = amount;
  let soaked = 0;
  if (sink.shield > 0) {                                     // shield soaks before HP (like autos)
    soaked = Math.min(sink.shield, dmg);
    sink.shield = sink.shield - soaked;
    dmg = dmg - soaked;
  }
  sink.hp = sink.hp - dmg;
  sink.spellHitUntil = tickCount + FLASH_TICKS;             // Phase 4: flash the fireball impact
  recordDamage(caster, sink, dmg);                          // book it (ignores 0 = fully soaked)
  // Orange number so spell damage is unmistakably NOT a sword swing (see fx.js).
  if (soaked > 0) emitFx("absorb", { x: sink.x, y: sink.y, amount: soaked });
  if (dmg > 0)    emitFx("spell",  { x: sink.x, y: sink.y, amount: dmg });
  runAbilityHook(sink, "onDamaged", { attacker: caster, damage: dmg });
  if (sink.hp <= 0) runAbilityHook(caster, "onKill", { target: sink });
}

// Healing (casting Slice 2): the mirror of dealSpellDamage — restore HP, capped at the
// target's maxHp so a heal never over-fills. Deliberately simple: no shields, no crit,
// no hooks; a heal isn't damage, so it books nothing in the damage panel (there's no heal
// stat yet). Stamps healFlashUntil for the green render flash. Returns the amount healed.
function heal(healer, target, amount) {
  if (!target || target.hp <= 0 || amount <= 0) return 0;
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  target.healFlashUntil = tickCount + FLASH_TICKS;           // Slice 2: glow the mended unit green
  const healed = target.hp - before;
  // Green "+N" — the ACTUAL amount restored, not the amount requested, so an
  // overheal on a nearly-full ally honestly shows the small number it really was.
  if (healed > 0) emitFx("heal", { x: target.x, y: target.y, amount: healed });
  return healed;
}

// The most-WOUNDED living ally within `range` of `unit` (itself included — a Cleric can
// mend herself), measured by HP FRACTION so the heal lands where it matters most. Skips
// anyone already at full HP. null if nobody in range needs healing — the cast then holds.
function lowestHpAllyInRange(unit, range) {
  let best = null;
  let bestFrac = Infinity;
  for (let i = 0; i < units.length; i++) {
    const o = units[i];
    if (o.team !== unit.team || o.hp <= 0) continue;
    if (o.hp >= o.maxHp) continue;                           // full → doesn't need it
    const dist = Math.max(Math.abs(o.x - unit.x), Math.abs(o.y - unit.y));
    if (dist > range) continue;
    const frac = o.hp / o.maxHp;
    if (frac < bestFrac) { bestFrac = frac; best = o; }
  }
  return best;
}

// One "tick" of battle: every unit acts once, then we clean up and redraw.
// Returns the round result: a winner team, "draw", or null if still ongoing.
function combatStep() {
  // Loop over a COPY so removing the dead mid-loop doesn't skip anyone.
  const acting = units.slice();

  for (let i = 0; i < acting.length; i++) {
    const unit = acting[i];
    if (unit.hp <= 0) continue;               // already died this tick
    if (unit.inert) continue;                 // Target Dummy (rank 3): never moves or attacks — only reflects Thorns when hit
    if (tickCount < (unit.stunUntil || 0)) continue;   // STUNNED: frozen this tick — no move, no attack (see applyStun)

    const target = nearestEnemy(unit);
    if (target === null) continue;            // no enemies remain

    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));

    // A PURE CASTER (noAutoAttack) engages at its CAST range and never auto-attacks — it
    // holds once in range and the mana/cast pass deals its damage. Everyone else engages
    // at their ATTACK range and swings. (A hybrid caster — a caster that is NOT
    // noAutoAttack — takes the normal attack path here AND also casts from the pass.)
    const engageRange = unit.noAutoAttack ? unit.castRange : unit.range;
    if (distance <= engageRange) {
      if (!unit.noAutoAttack) {
        // In range → build attack charge by this unit's attack speed, and strike
        // each time it reaches a full period. Fast units (high attackSpeed) can
        // fill more than one period in a tick and hit multiple times.
        unit.attackCharge = (unit.attackCharge || 0) + unit.attackSpeed;
        while (unit.attackCharge >= ATTACK_PERIOD && target.hp > 0) {
          attackTarget(unit, target);                        // crit / lifesteal
          unit.attackCharge = unit.attackCharge - ATTACK_PERIOD;
        }
      }
      // pure caster in range → hold position; the mana/cast pass fires the spell.
    } else {
      // Not in range → step along a real path (pathing.js flood fill): walks
      // AROUND blockers and heads for the most REACHABLE enemy, not just the
      // closest as the crow flies. Only when the move cooldown has recharged.
      if (unit.moveCooldown > 0) {
        unit.moveCooldown = unit.moveCooldown - 1;         // still recharging
      } else {
        // A SLOWED unit (stepped on a Trapline) waits longer between steps.
        const slowed = tickCount < (unit.slowUntil || 0);
        const moveDelay = slowed ? SLOW_MOVE_COOLDOWN : MOVE_COOLDOWN_TICKS;
        // MOVE-SPEED BURST (melee rank-4 Kill Dash): a snowballing unit takes EXTRA steps this tick —
        // `moveSteps` (default 1) is how many. A slow pins it to a single step (the slow wins).
        // Units WITHOUT the burst have moveSteps 1, so this loop runs exactly once and behaves
        // identically to the old single-step move. Each step re-pathfinds from the new cell and
        // stops the instant the unit is close enough to swing, so a dash never overshoots range.
        const steps = slowed ? 1 : (unit.moveSteps || 1);
        let moved = false;
        for (let s = 0; s < steps; s++) {
          const d = Math.max(Math.abs(target.x - unit.x), Math.abs(target.y - unit.y));
          if (d <= engageRange) break;                     // in range now → stop, swing next tick
          const step = pathStep(unit);
          if (step !== null) {
            unit.x = step.x;
            unit.y = step.y;
            moved = true;
          } else {
            // No enemy reachable (walled in) → the old straight-line shuffle: try the direct
            // step toward the target, and end the dash if it's blocked. Keeps units pressed up
            // against the crowd so they pounce the moment a gap opens.
            const stepX = unit.x + Math.sign(target.x - unit.x);
            const stepY = unit.y + Math.sign(target.y - unit.y);
            if (findUnitAt(stepX, stepY) === null) {       // step only if the square is free
              unit.x = stepX;
              unit.y = stepY;
              moved = true;
            } else {
              break;                                       // blocked → end the dash
            }
          }
        }
        if (moved) unit.moveCooldown = moveDelay;          // recharge only if we actually stepped
      }
    }
  }

  // MANA / CAST PASS (pure mana-regen — casting Phase 1). Mirrors the poison pass
  // below: loop every living CASTER, regen its mana this tick (capped at manaMax), and
  // when the bar is full AND an enemy sits within cast range, fire its onCast hook and
  // spend the bar. Placed BEFORE the poison / onDeath / dead-filter blocks so a cast's
  // kills flow through the normal death handling this same tick. Phase 1 has no spell
  // kit yet — onCast dispatches to nothing — but the meter, the timing, and castsFired
  // are all real, so a mage card just needs to add an onCast kit (Phase 2).
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.hp <= 0 || !u.caster) continue;
    if (tickCount < (u.stunUntil || 0)) continue;         // stunned → can't channel (and the bar freezes: this skips regen too)
    u.mana = Math.min(u.manaMax, u.mana + u.manaRegen);   // regen every tick, capped
    if (u.mana < u.manaMax) continue;                     // not charged yet
    // SHIELD-HELD cast (rank 5 pair/trips Ward): a caster flagged holdCastWhileShielded sits on its
    // full bar until its current shield is FULLY spent — one shield at a time, never refreshing a
    // live one. (Quads leaves this flag off, so it stacks a fresh shield on each full bar instead.)
    if (u.holdCastWhileShielded && (u.shield || 0) > 0) continue;
    // WHO does this cast need in range? "enemy" (Fireball) must have a target within
    // castRange or it holds the charged bar; "self" (Trapline) fires the instant the bar
    // fills, no target required — the handler reads the caster's own position.
    const targeting = u.castTargeting || "enemy";
    let target = null;
    if (targeting === "enemy") {
      target = nearestEnemy(u);
      if (target === null) continue;                      // nothing to cast at
      const dist = Math.max(Math.abs(target.x - u.x), Math.abs(target.y - u.y));
      if (dist > u.castRange) continue;                   // full but out of range → hold the cast
    } else if (targeting === "ally") {
      target = lowestHpAllyInRange(u, u.castRange);        // most-wounded ally in range (self ok)
      if (target === null) continue;                      // nobody hurt in range → hold the bar
    }
    runAbilityHook(u, "onCast", { target: target });      // fire the spell
    u.castsFired = (u.castsFired || 0) + 1;
    u.castFlashUntil = tickCount + FLASH_TICKS;          // Phase 4: glow the caster while discharging
    u.mana = u.mana - u.manaMax;                          // spend the bar (capped, so → 0)
  }

  // TRAP PASS (rank 8 Trapline): any living unit standing on an ENEMY-owned trap cell
  // springs it — minimal damage + a lingering slow — then the trap is consumed (single
  // use). Environmental, like poison: no live dealer, so damage is booked to the OWNER
  // team via recordDamage's fallback and NO onDamaged fires (a trap can't proc Thorns).
  // An invulnerable victim (Q♥ mourning) still clears the trap but takes nothing. One
  // trap per unit per tick — a unit that walked onto overlapping lines eats them in
  // order over successive ticks.
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.hp <= 0) continue;
    for (let t = traps.length - 1; t >= 0; t--) {
      const trap = traps[t];
      if (trap.team === u.team) continue;                 // only the owner's ENEMIES trip it
      if (u.x !== trap.x || u.y !== trap.y) continue;     // not standing on this trap
      if (tickCount >= (u.invulnUntil || 0)) {            // invulnerable → springs but no effect
        if (trap.damage > 0) {
          u.hp = u.hp - trap.damage;
          recordDamage(null, u, trap.damage, trap.team);  // credit the trap owner's team
          emitFx("trap", { x: u.x, y: u.y, amount: trap.damage });   // amber number
        }
        if (trap.slow > 0) u.slowUntil = Math.max(u.slowUntil || 0, tickCount + trap.slow);
        u.trapSprungUntil = tickCount + FLASH_TICKS;      // flash the cell so you SEE it fire
      } else {
        emitFx("block", { x: u.x, y: u.y });              // invulnerable: the trap sprang for nothing
      }
      traps.splice(t, 1);                                 // single-use → gone once tripped
      break;                                              // one trap per unit per tick
    }
  }

  // Poison (rank 9): units carrying poison stacks lose that much HP each tick,
  // independent of who they're fighting. Handled here (engine) because the STATUS
  // lives on the victim, not on its own ability list. u.poison is fresh each round
  // (units are rebuilt), so nothing carries over between rounds.
  for (let i = 0; i < units.length; i++) {
    if (units[i].poison) {
      units[i].hp = units[i].hp - units[i].poison;
      // Purple tick-damage number: poison is the one damage source with no attacker,
      // so without this it looks like units are losing HP for no reason at all.
      emitFx("poison", { x: units[i].x, y: units[i].y, amount: units[i].poison });
      // Poison has no remembered source (stacks live on the victim), so there's no
      // dealer unit — pass null + the enemy team as the fallback so the enemy's
      // DEALT total still balances. The victim IS a unit, so its TAKEN is credited
      // at card level normally.
      const enemy = units[i].team === "player1" ? "player2" : "player1";
      recordDamage(null, units[i], units[i].poison, enemy);
    }
  }

  // Poison transfer (rank 9's plague rank-up): anyone dying this tick WHILE
  // carrying poison passes a fraction of its stacks to its nearest living
  // teammate. The fraction (u.poisonTransfer) was stamped on the victim by the
  // poisoner — 0 unless that team fielded enough 9s — and the stamp travels WITH
  // the stacks, so the plague keeps jumping as each new carrier falls. If the
  // carrier was the last of its team, the plague dies with it.
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.hp > 0 || !u.poison || !u.poisonTransfer) continue;
    const heir = nearestTeammate(u);
    if (heir === null) continue;
    const passed = Math.round(u.poison * u.poisonTransfer);
    if (passed <= 0) continue;
    heir.poison = (heir.poison || 0) + passed;
    if (u.poisonTransfer > (heir.poisonTransfer || 0)) heir.poisonTransfer = u.poisonTransfer;
  }

  // Let the dying react BEFORE they're removed: fire onDeath for anyone at 0 HP
  // (K♥'s Royal Vow grants Q♥ her invulnerability window here). Covers every cause
  // of death — a hit, a redirected hit, or poison — since it reads final HP.
  for (let i = 0; i < units.length; i++) {
    if (units[i].hp <= 0) runAbilityHook(units[i], "onDeath", {});
  }

  // Remove everyone who dropped to 0 hp this tick.
  units = units.filter(function (u) { return u.hp > 0; });
  render();
  playFx();     // drain this tick's effect queue over the board we just drew (fx.js)

  // Safety valve: if a battle somehow stalls, end it as a draw.
  tickCount = tickCount + 1;
  if (tickCount > 300) return "draw";

  // Report the result so gameflow can decide what to do next.
  const p1 = countUnits("player1");
  const p2 = countUnits("player2");
  if (p1 > 0 && p2 > 0) return null;   // both sides still standing → keep fighting
  if (p1 > 0) return "player1";
  if (p2 > 0) return "player2";
  return "draw";                        // everyone died
}
