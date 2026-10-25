/*
 * Mech Merge
 * Core rules are plain functions that mutate a state object, so they can be
 * unit tested with Node (see game.test.js). The DOM code only runs in a browser.
 */

const GRID_SIZE = 5;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MAX_TIER = 6; // Reaching this tier (Titan) wins the game
const MAX_TURNS = 60;
const START_MECHS = 2;

const MECH_TYPES = [
  null, // index 0 is unused so tier numbers match array indexes
  { name: 'Scout', color: '#7dd3fc' },
  { name: 'Striker', color: '#4ade80' },
  { name: 'Guardian', color: '#facc15' },
  { name: 'Raider', color: '#fb923c' },
  { name: 'Juggernaut', color: '#f87171' },
  { name: 'Titan', color: '#c084fc' },
];

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

function updateStatus(state) {
  if (state.status !== 'playing') return;
  if (state.board.some((mech) => mech && mech.tier === MAX_TIER)) {
    state.status = 'won';
  } else if (state.turnsLeft <= 0) {
    state.status = 'lost';
  }
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
    turnsLeft: MAX_TURNS,
    score: 0,
    merges: 0,
    nextId: 1,
    status: 'playing',
  };
  for (let i = 0; i < START_MECHS; i++) placeRandomMech(state, rng);
  return state;
}

const fail = (reason) => ({ ok: false, reason });

function spendTurn(state) {
  state.turnsLeft -= 1;
  updateStatus(state);
}

function deployMech(state, rng = Math.random) {
  if (state.status !== 'playing') return fail('The game is over.');
  if (emptyIndexes(state.board).length === 0) {
    return fail('The hangar is full. Merge some mechs first.');
  }
  placeRandomMech(state, rng);
  spendTurn(state);
  return { ok: true };
}

function moveMech(state, from, to) {
  if (state.status !== 'playing') return fail('The game is over.');
  const source = state.board[from];
  if (!source) return fail('There is no mech in that cell.');
  if (from === to) return fail('Pick a different cell.');

  const target = state.board[to];
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

if (typeof document !== 'undefined') {
  const boardEl = document.getElementById('board');
  const turnsEl = document.getElementById('turns');
  const scoreEl = document.getElementById('score');
  const mergesEl = document.getElementById('merges');
  const deployBtn = document.getElementById('deploy-btn');
  const messageEl = document.getElementById('message');
  const overlayEl = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const restartBtn = document.getElementById('restart-btn');

  let state = createGame();
  let selected = null;

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
    if (state.status !== 'playing') return;
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
    if (state.status !== 'playing' || from === to) return;
    attemptMove(from, to);
    render();
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

  function renderOverlay() {
    if (state.status === 'playing') {
      overlayEl.classList.add('hidden');
      return;
    }
    overlayEl.classList.remove('hidden');
    if (state.status === 'won') {
      overlayTitle.textContent = 'Titan Built!';
      overlayText.textContent = `You won with ${state.turnsLeft} turns left. Score: ${state.score}`;
    } else {
      overlayTitle.textContent = 'Out of Turns';
      overlayText.textContent = `Score: ${state.score} · Merges: ${state.merges}`;
    }
  }

  function render() {
    boardEl.innerHTML = '';
    state.board.forEach((mech, index) => {
      const cell = createCellElement(index);
      if (mech) cell.appendChild(createMechElement(mech, index));
      boardEl.appendChild(cell);
    });

    turnsEl.textContent = state.turnsLeft;
    scoreEl.textContent = state.score;
    mergesEl.textContent = state.merges;

    const playing = state.status === 'playing';
    const boardFull = emptyIndexes(state.board).length === 0;
    deployBtn.disabled = !playing || boardFull;
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

  restartBtn.addEventListener('click', () => {
    state = createGame();
    selected = null;
    setMessage('New game started.');
    render();
  });

  setMessage('Click one mech, then click another to merge. Build a Titan!');
  render();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createGame,
    deployMech,
    moveMech,
    mergeScore,
    MAX_TIER,
    MAX_TURNS,
    CELL_COUNT,
    MECH_TYPES,
  };
}

