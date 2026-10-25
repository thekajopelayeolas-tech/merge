/*
 * Mech Merge
 * Merge mechs in your hangar to build an army, then press Play to fight.
 * Enemy level always matches your current level.
 * Rules are plain functions so they can be unit tested with Node (see
 * game.test.js). The DOM code only runs in a browser.
 */

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MAX_TIER = 6; // Highest mech tier (Titan)
const MAX_LEVEL = 10; // Clearing this level wins the game
const START_TURNS = 10;
const START_MECHS = 2;
const MAX_ENEMIES = 6;

const MECH_TYPES = [
  null, // index 0 is unused so tier numbers match array indexes
  { name: 'Scout', color: '#7dd3fc' },
  { name: 'Striker', color: '#4ade80' },
  { name: 'Guardian', color: '#facc15' },
  { name: 'Raider', color: '#fb923c' },
  { name: 'Juggernaut', color: '#f87171' },
  { name: 'Titan', color: '#c084fc' },
];

// A mech's power comes from its tier. Enemies scale with the battle level.
function mechStats(tier) {
  return { hp: 20 * tier, attack: 5 * tier };
}

function enemyStats(level) {
  return { hp: 15 * level, attack: 4 * level };
}

function enemyCount(level) {
  return Math.min(level + 1, MAX_ENEMIES);
}

function mergeScore(newTier) {
  return 10 * 2 ** newTier;
}

function randomSpawnTier(rng) {
  const r = rng();
  if (r < 0.7) return 1;
  if (r < 0.95) return 2;
  return 3;
}

function emptyIndexes(board) {
  const result = [];
  board.forEach((mech, index) => {
    if (mech === null) result.push(index);
  });
  return result;
}

function countMechs(board) {
  return board.filter(Boolean).length;
}

function placeRandomMech(state, rng) {
  const empties = emptyIndexes(state.board);
  if (empties.length === 0) return false;
  const index = empties[Math.floor(rng() * empties.length)];
  state.board[index] = { id: state.nextId++, tier: randomSpawnTier(rng) };
  return true;
}

function createGame(rng = Math.random) {
  const state = {
    board: Array(CELL_COUNT).fill(null),
    turnsLeft: START_TURNS,
    score: 0,
    merges: 0,
    level: 1,
    nextId: 1,
    status: 'playing',
  };
  for (let i = 0; i < START_MECHS; i++) placeRandomMech(state, rng);
  return state;
}

const fail = (reason) => ({ ok: false, reason });

// Deploying and moving cost a turn. Battles do not.
function checkCanAct(state) {
  if (state.status !== 'playing') return fail('The game is over.');
  if (state.turnsLeft <= 0) return fail('No turns left. Press Play to fight for more.');
  return null;
}

function spendTurn(state) {
  state.turnsLeft -= 1;
}

function deployMech(state, rng = Math.random) {
  const blocked = checkCanAct(state);
  if (blocked) return blocked;
  if (emptyIndexes(state.board).length === 0) {
    return fail('The hangar is full. Merge some mechs first.');
  }
  placeRandomMech(state, rng);
  spendTurn(state);
  return { ok: true };
}

function moveMech(state, from, to) {
  const blocked = checkCanAct(state);
  if (blocked) return blocked;
  const source = state.board[from];
  if (!source) return fail('There is no mech in that cell.');
  if (from === to) return fail('Pick a different cell.');

  const target = state.board[to];
  if (target && target.tier === source.tier && source.tier >= MAX_TIER) {
    return fail('Titans are already the highest tier.');
  }

  let result;
  if (!target) {
    state.board[to] = source;
    state.board[from] = null;
    result = { ok: true, type: 'move' };
  } else if (target.tier === source.tier) {
    target.tier += 1;
    state.board[from] = null;
    state.merges += 1;
    state.score += mergeScore(target.tier);
    result = { ok: true, type: 'merge', tier: target.tier };
  } else {
    state.board[to] = source;
    state.board[from] = target;
    result = { ok: true, type: 'swap' };
  }

  spendTurn(state);
  return result;
}

// Every mech is fully repaired before each battle.
function createMechUnits(board) {
  const units = [];
  board.forEach((mech, index) => {
    if (!mech) return;
    const { hp, attack } = mechStats(mech.tier);
    units.push({ index, hp, attack });
  });
  return units;
}

function createEnemies(level) {
  const { hp, attack } = enemyStats(level);
  return Array.from({ length: enemyCount(level) }, (_, index) => ({ index, hp, attack }));
}

// Each round both sides strike at once. Your army focuses the front enemy,
// and the enemies focus your front mech. Extra damage on a dead target is wasted.
// Every round deals damage, so the loop always ends.
// Returns one entry per round listing every shot and any unit that fell,
// so the UI can replay the exact fight.
function simulateBattle(mechUnits, enemies) {
  const rounds = [];
  for (;;) {
    const liveMechs = mechUnits.filter((unit) => unit.hp > 0);
    const liveEnemies = enemies.filter((enemy) => enemy.hp > 0);
    if (liveMechs.length === 0 || liveEnemies.length === 0) return rounds;

    const enemyTarget = liveEnemies[0];
    const mechTarget = liveMechs[0];
    const damageToEnemy = liveMechs.reduce((sum, unit) => sum + unit.attack, 0);
    const damageToMech = liveEnemies.reduce((sum, enemy) => sum + enemy.attack, 0);

    const shots = [
      ...liveMechs.map((unit) => ({
        from: { side: 'mech', index: unit.index },
        to: { side: 'enemy', index: enemyTarget.index },
        damage: unit.attack,
      })),
      ...liveEnemies.map((enemy) => ({
        from: { side: 'enemy', index: enemy.index },
        to: { side: 'mech', index: mechTarget.index },
        damage: enemy.attack,
      })),
    ];

    enemyTarget.hp -= damageToEnemy;
    mechTarget.hp -= damageToMech;
    const downs = [];
    if (enemyTarget.hp <= 0) downs.push({ side: 'enemy', index: enemyTarget.index });
    if (mechTarget.hp <= 0) downs.push({ side: 'mech', index: mechTarget.index });
    rounds.push({ shots, downs });
  }
}

// Fights the current level. Each enemy killed gives one turn.
// Clearing every enemy wins the level. If any enemy survives, the run ends.
function startBattle(state) {
  if (state.status !== 'playing') return fail('The game is over.');
  const mechUnits = createMechUnits(state.board);
  if (mechUnits.length === 0) {
    return fail('Deploy a mech before starting a battle.');
  }

  const enemies = createEnemies(state.level);
  const rounds = simulateBattle(mechUnits, enemies);

  const kills = enemies.filter((enemy) => enemy.hp <= 0).length;
  const losses = mechUnits.filter((unit) => unit.hp <= 0).length;
  // Destroyed mechs leave the hangar. Survivors stay where they are.
  mechUnits.forEach((unit) => {
    if (unit.hp <= 0) state.board[unit.index] = null;
  });

  state.turnsLeft += kills;
  const won = kills === enemies.length;
  const battle = { level: state.level, enemyCount: enemies.length, kills, losses, won, rounds };
  state.lastBattle = battle;

  if (!won) {
    state.status = 'lost';
  } else if (state.level >= MAX_LEVEL) {
    state.status = 'won';
  } else {
    state.level += 1;
  }
  return { ok: true, battle };
}

if (typeof document !== 'undefined') {
  const boardEl = document.getElementById('board');
  const arenaEl = document.getElementById('arena');
  const enemiesEl = document.getElementById('enemies');
  const fxEl = document.getElementById('fx');
  const levelEl = document.getElementById('level');
  const turnsEl = document.getElementById('turns');
  const scoreEl = document.getElementById('score');
  const mergesEl = document.getElementById('merges');
  const deployBtn = document.getElementById('deploy-btn');
  const playBtn = document.getElementById('play-btn');
  const messageEl = document.getElementById('message');
  const overlayEl = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const restartBtn = document.getElementById('restart-btn');

  const SHOT_MS = 380; // flight time of one projectile
  const ROUND_GAP_MS = 250; // pause between rounds
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let state = createGame();
  let selected = null;
  let busy = false; // true while a battle is playing back
  let displayBoard = null; // pre-battle board shown during playback
  let mechHp = {}; // { [boardIndex]: { hp, max } } during playback
  let enemyHp = []; // current hp of each enemy during playback
  let enemyMax = 0;

  function setMessage(text, isError = false) {
    messageEl.textContent = text;
    messageEl.classList.toggle('error', isError);
  }

  function attemptMove(from, to) {
    const result = moveMech(state, from, to);
    selected = null;
    if (!result.ok) {
      setMessage(result.reason, true);
    } else if (result.type === 'merge') {
      setMessage(`Merged into ${MECH_TYPES[result.tier].name}!`);
    } else if (result.type === 'swap') {
      setMessage('Swapped mechs.');
    } else {
      setMessage('Mech moved.');
    }
  }

  function onCellClick(index) {
    if (busy || state.status !== 'playing') return;
    if (selected === null) {
      if (state.board[index]) {
        selected = index;
        setMessage('Now click another cell to move, swap, or merge.');
      }
    } else if (selected === index) {
      selected = null;
    } else {
      attemptMove(selected, index);
    }
    render();
  }

  function onDrop(from, to) {
    if (busy || state.status !== 'playing' || from === to) return;
    attemptMove(from, to);
    render();
  }

  function percent(hp, max) {
    return Math.max(0, Math.min(100, (hp / max) * 100));
  }

  function createHpBar(hp, max) {
    const bar = document.createElement('div');
    bar.className = 'hp-bar';
    const fill = document.createElement('div');
    fill.className = 'hp-fill';
    fill.style.width = `${percent(hp, max)}%`;
    bar.appendChild(fill);
    return bar;
  }

  function createMechElement(mech, index) {
    const type = MECH_TYPES[mech.tier];
    const el = document.createElement('div');
    el.className = `mech tier-${mech.tier}`;
    el.draggable = true;
    el.style.background = type.color;

    const tierEl = document.createElement('span');
    tierEl.className = 'mech-tier';
    tierEl.textContent = `T${mech.tier}`;

    const nameEl = document.createElement('span');
    nameEl.className = 'mech-name';
    nameEl.textContent = type.name;

    el.append(tierEl, nameEl);
    const hp = mechHp[index];
    if (hp) el.appendChild(createHpBar(hp.hp, hp.max));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });
    return el;
  }

  function createCellElement(index) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (index === selected) cell.classList.add('selected');
    cell.addEventListener('click', () => onCellClick(index));
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('text/plain');
      if (raw === '') return;
      onDrop(Number(raw), index);
    });
    return cell;
  }

  function drawBoard(board) {
    boardEl.innerHTML = '';
    board.forEach((mech, index) => {
      const cell = createCellElement(index);
      if (mech) cell.appendChild(createMechElement(mech, index));
      boardEl.appendChild(cell);
    });
  }

  function drawEnemies(count, level) {
    enemiesEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const card = document.createElement('div');
      card.className = 'enemy';
      card.dataset.index = String(i);
      card.style.animationDelay = `${i * 120}ms`;
      const name = document.createElement('span');
      name.className = 'enemy-name';
      name.textContent = `Drone L${level}`;
      card.append(name, createHpBar(enemyHp[i], enemyMax));
      enemiesEl.appendChild(card);
    }
  }

  function unitEl(unit) {
    if (unit.side === 'mech') {
      const cell = boardEl.children[unit.index];
      return cell ? cell.querySelector('.mech') : null;
    }
    return enemiesEl.querySelector(`[data-index="${unit.index}"]`);
  }

  function rectCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Launches a projectile from one unit toward another. Resolves on impact.
  function fireShot(fromEl, toEl, side) {
    const from = rectCenter(fromEl);
    const to = rectCenter(toEl);
    const shot = document.createElement('div');
    shot.className = `shot ${side}-shot`;
    shot.style.left = `${from.x}px`;
    shot.style.top = `${from.y}px`;
    fxEl.appendChild(shot);
    const flight = shot.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px)` },
      ],
      { duration: SHOT_MS, easing: 'linear', fill: 'forwards' }
    );
    return flight.finished.then(() => shot.remove());
  }

  function showDamage(targetEl, damage) {
    const { x, y } = rectCenter(targetEl);
    const num = document.createElement('div');
    num.className = 'dmg';
    num.textContent = `-${damage}`;
    num.style.left = `${x + (Math.random() - 0.5) * 30}px`;
    num.style.top = `${y}px`;
    fxEl.appendChild(num);
    num.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        { transform: 'translate(-50%, -150%)', opacity: 0 },
      ],
      { duration: 800, easing: 'ease-out', fill: 'forwards' }
    ).finished.then(() => num.remove());
  }

  function hpFill(el, hp, max) {
    if (!el) return;
    el.querySelector('.hp-fill').style.width = `${percent(hp, max)}%`;
  }

  function flash(el) {
    if (!el) return;
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 150);
  }

  function shakeBoard() {
    boardEl.classList.remove('shake');
    void boardEl.offsetWidth; // restart the animation
    boardEl.classList.add('shake');
  }

  // Updates the stored hp for a shot's target and refreshes its bar.
  function applyDamage(shot) {
    const { side, index } = shot.to;
    if (side === 'enemy') {
      enemyHp[index] = Math.max(0, enemyHp[index] - shot.damage);
      hpFill(unitEl(shot.to), enemyHp[index], enemyMax);
    } else {
      const hp = mechHp[index];
      hp.hp = Math.max(0, hp.hp - shot.damage);
      hpFill(unitEl(shot.to), hp.hp, hp.max);
    }
  }

  function showBanner(text) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    fxEl.appendChild(el);
    el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      ],
      { duration: 300, easing: 'ease-out', fill: 'forwards' }
    );
    setTimeout(() => el.remove(), 1100);
  }

  // Plays one round: all shots fly at once, then fallen units fade out.
  async function playRound(round) {
    await Promise.all(
      round.shots.map(async (shot) => {
        const fromEl = unitEl(shot.from);
        const toEl = unitEl(shot.to);
        if (!fromEl || !toEl) return;
        await fireShot(fromEl, toEl, shot.from.side);
        applyDamage(shot);
        flash(toEl);
        showDamage(toEl, shot.damage);
        if (shot.to.side === 'mech') shakeBoard();
      })
    );
    round.downs.forEach((unit) => {
      const el = unitEl(unit);
      if (el) el.classList.add('dead');
    });
    await sleep(ROUND_GAP_MS);
  }

  // Replays a finished battle on top of the pre-battle board.
  // The state was already updated by startBattle, so the board is drawn from the snapshot.
  async function playBattle(snapshot, battle) {
    busy = true;
    displayBoard = snapshot;
    enemyMax = enemyStats(battle.level).hp;
    enemyHp = Array(battle.enemyCount).fill(enemyMax);
    mechHp = {};
    snapshot.forEach((mech, index) => {
      if (!mech) return;
      const { hp } = mechStats(mech.tier);
      mechHp[index] = { hp, max: hp };
    });

    render();
    drawEnemies(battle.enemyCount, battle.level);
    showBanner('FIGHT!');
    await sleep(900);

    for (const round of battle.rounds) {
      await playRound(round);
    }

    await sleep(400);
    showBanner(battle.won ? 'LEVEL CLEARED' : 'DEFEATED');
    await sleep(1200);
    busy = false;
    displayBoard = null;
    mechHp = {};
  }

  function renderOverlay() {
    if (busy || state.status === 'playing') {
      overlayEl.classList.add('hidden');
      return;
    }
    overlayEl.classList.remove('hidden');
    if (state.status === 'won') {
      overlayTitle.textContent = 'Victory!';
      overlayText.textContent = `You cleared level ${state.level} and won the campaign. Score: ${state.score}`;
    } else {
      overlayTitle.textContent = 'Defeated';
      overlayText.textContent = `You fell on level ${state.level}. Score: ${state.score} · Merges: ${state.merges}`;
    }
  }

  function render() {
    drawBoard(displayBoard || state.board);
    arenaEl.classList.toggle('hidden', !busy);

    levelEl.textContent = state.level;
    turnsEl.textContent = state.turnsLeft;
    scoreEl.textContent = state.score;
    mergesEl.textContent = state.merges;

    const playing = state.status === 'playing' && !busy;
    const boardFull = emptyIndexes(state.board).length === 0;
    const hasMechs = countMechs(state.board) > 0;
    deployBtn.disabled = !playing || boardFull || state.turnsLeft <= 0;
    playBtn.disabled = !playing || !hasMechs;
    renderOverlay();
  }

  deployBtn.addEventListener('click', () => {
    const result = deployMech(state);
    if (result.ok) {
      setMessage('New mech deployed.');
    } else {
      setMessage(result.reason, true);
    }
    selected = null;
    render();
  });

  playBtn.addEventListener('click', async () => {
    if (busy) return;
    // startBattle removes the fallen mechs, so keep the board as it looked before.
    const snapshot = state.board.slice();
    const result = startBattle(state);
    selected = null;
    if (!result.ok) {
      setMessage(result.reason, true);
      render();
      return;
    }
    const { level, kills, losses, won } = result.battle;
    const bonus = kills === 1 ? '1 turn' : `${kills} turns`;
    const lossText = losses === 1 ? '1 mech lost' : `${losses} mechs lost`;
    if (!won) {
      setMessage(`Level ${level} lost. You destroyed ${kills} enemies and ${lossText}.`, true);
    } else if (state.status === 'won') {
      setMessage(`Level ${level} cleared! ${lossText}. Earned ${bonus}.`);
    } else {
      setMessage(`Level ${level} cleared! ${lossText}. Earned ${bonus}. Now level ${state.level}.`);
    }
    await playBattle(snapshot, result.battle);
    render();
  });

  restartBtn.addEventListener('click', () => {
    state = createGame();
    selected = null;
    setMessage('New campaign started.');
    render();
  });

  setMessage('Deploy mechs, merge them, then press Play Battle.');
  render();
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGame,
    deployMech,
    moveMech,
    startBattle,
    mergeScore,
    enemyCount,
    enemyStats,
    mechStats,
    MAX_TIER,
    MAX_LEVEL,
    START_TURNS,
    CELL_COUNT,
    MECH_TYPES,
  };
}

