// pathing.js — BFS ("flood fill") movement. Fixes two problems with the old
// one-step-toward-the-nearest-enemy mover: (1) a unit whose direct step was
// blocked just froze in place, and (2) units marched at the closest enemy as
// the crow flies even when that enemy was walled off and a farther one was
// wide open. A flood fill labels every square with the TRUE number of steps
// to reach it walking AROUND other units, so both problems fall out of one map.
// Depends on: config (ROWS/COLS), state (units).

// The 8 directions a unit can step (diagonals count as one step — the same
// Chebyshev world the range checks use). Fixed clockwise-from-north order so
// path choices are deterministic: replaying a fight gives the same moves.
const PATH_DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

// Flood fill outward from the unit's square, like a ripple in water: squares
// one step away get 1, their neighbors get 2, and so on — flowing around other
// units (every OTHER unit is a wall). Returns flat arrays indexed y*COLS+x:
//   dist[i]     = steps to reach square i (Infinity = unreachable)
//   cameFrom[i] = which square the ripple entered i from (lets us trace a path
//                 backwards from any goal to the unit — see firstStepToward)
function bfsFrom(unit) {
  const size = ROWS * COLS;
  const dist = new Array(size).fill(Infinity);
  const cameFrom = new Array(size).fill(-1);

  // Mark every occupied square as a wall (except the mover's own square).
  const wall = new Array(size).fill(false);
  for (let i = 0; i < units.length; i++) {
    if (units[i] === unit) continue;
    wall[units[i].y * COLS + units[i].x] = true;
  }

  // Classic BFS queue: an array we push discoveries onto, read with a moving
  // head index (cheaper than shift(), which re-copies the whole array).
  const start = unit.y * COLS + unit.x;
  dist[start] = 0;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head]; head++;
    const cx = idx % COLS;
    const cy = (idx - cx) / COLS;
    for (let d = 0; d < PATH_DIRS.length; d++) {
      const nx = cx + PATH_DIRS[d].dx;
      const ny = cy + PATH_DIRS[d].dy;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;  // off-board
      const nidx = ny * COLS + nx;
      if (wall[nidx]) continue;                 // occupied → can't walk through
      if (dist[nidx] !== Infinity) continue;    // already reached (sooner or equal)
      dist[nidx] = dist[idx] + 1;
      cameFrom[nidx] = idx;
      queue.push(nidx);
    }
  }
  return { dist: dist, cameFrom: cameFrom };
}

// Pick the enemy this unit should WALK toward: the one whose "attack ring"
// (any square within the unit's attack range of it) costs the fewest real
// steps to reach. An enemy sealed off by bodies has an Infinity-cost ring and
// is skipped — that's the "go for the more accessible enemy" behavior.
// Ties (two enemies equally many steps away) go to the straight-line-closer
// one, then to whichever comes first in the units array (deterministic).
// Returns { enemy, squareIdx, steps } or null if NO enemy is reachable.
function choosePathTarget(unit, bfs) {
  let best = null;
  for (let i = 0; i < units.length; i++) {
    const enemy = units[i];
    if (enemy.team === unit.team) continue;

    // Cheapest reachable square within attack range of this enemy. Occupied
    // squares are automatically excluded (their dist stayed Infinity).
    const r = unit.range;
    let bestSq = -1;
    let bestSteps = Infinity;
    for (let y = Math.max(0, enemy.y - r); y <= Math.min(ROWS - 1, enemy.y + r); y++) {
      for (let x = Math.max(0, enemy.x - r); x <= Math.min(COLS - 1, enemy.x + r); x++) {
        const idx = y * COLS + x;
        if (bfs.dist[idx] < bestSteps) { bestSteps = bfs.dist[idx]; bestSq = idx; }
      }
    }
    if (bestSteps === Infinity) continue;   // fully walled off → not a candidate

    const crow = Math.max(Math.abs(enemy.x - unit.x), Math.abs(enemy.y - unit.y));
    if (best === null || bestSteps < best.steps ||
        (bestSteps === best.steps && crow < best.crow)) {
      best = { enemy: enemy, squareIdx: bestSq, steps: bestSteps, crow: crow };
    }
  }
  return best;
}

// Trace the flood fill backwards from the goal square (following cameFrom
// links) until we reach the square right next to the unit — that's this
// tick's step. Free by construction: the ripple only flowed through empty
// squares. Returns {x, y}, or null if the chain is broken (shouldn't happen).
function firstStepToward(unit, squareIdx, bfs) {
  const start = unit.y * COLS + unit.x;
  let idx = squareIdx;
  while (bfs.cameFrom[idx] !== start) {
    idx = bfs.cameFrom[idx];
    if (idx === -1) return null;
  }
  return { x: idx % COLS, y: (idx - (idx % COLS)) / COLS };
}

// The one call combat.js makes: which adjacent square should this unit step to
// this tick? null = no enemy's attack ring is reachable at all (walled in) —
// the caller falls back to the old straight-line shuffle so behavior can never
// be WORSE than before.
function pathStep(unit) {
  const bfs = bfsFrom(unit);
  const choice = choosePathTarget(unit, bfs);
  if (choice === null) return null;
  return firstStepToward(unit, choice.squareIdx, bfs);
}
