const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  deployMech,
  moveMech,
  mergeScore,
  MAX_TIER,
  MAX_TURNS,
  CELL_COUNT,
} = require('./game.js');

// Always rolls the lowest bucket, so spawned mechs are tier 1.
const fixedRng = () => 0.5;

// A game with an empty board so each test controls every mech.
function emptyState(overrides = {}) {
  const state = createGame(fixedRng);
  state.board = Array(CELL_COUNT).fill(null);
  return Object.assign(state, overrides);
}

const countMechs = (state) => state.board.filter(Boolean).length;

test('new game starts with two mechs, full turns, and playing status', () => {
  const state = createGame(fixedRng);
  assert.equal(countMechs(state), 2);
  assert.equal(state.turnsLeft, MAX_TURNS);
  assert.equal(state.status, 'playing');
  assert.equal(state.score, 0);
});

test('deployMech adds a mech and spends one turn', () => {
  const state = emptyState();
  const result = deployMech(state, fixedRng);
  assert.equal(result.ok, true);
  assert.equal(countMechs(state), 1);
  assert.equal(state.turnsLeft, MAX_TURNS - 1);
});

test('deployMech fails on a full board without spending a turn', () => {
  const state = emptyState();
  state.board = state.board.map((_, i) => ({ id: i + 1, tier: 1 }));
  const result = deployMech(state, fixedRng);
  assert.equal(result.ok, false);
  assert.equal(state.turnsLeft, MAX_TURNS);
});

test('moveMech moves a mech into an empty cell', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: 2 };
  const result = moveMech(state, 0, 7);
  assert.equal(result.type, 'move');
  assert.equal(state.board[0], null);
  assert.deepEqual(state.board[7], { id: 1, tier: 2 });
  assert.equal(state.turnsLeft, MAX_TURNS - 1);
});

test('merging same-tier mechs raises the tier and updates score and merges', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: 2 };
  state.board[1] = { id: 2, tier: 2 };
  const result = moveMech(state, 0, 1);
  assert.equal(result.type, 'merge');
  assert.equal(result.tier, 3);
  assert.equal(state.board[0], null);
  assert.equal(state.board[1].tier, 3);
  assert.equal(state.merges, 1);
  assert.equal(state.score, mergeScore(3));
  assert.equal(state.turnsLeft, MAX_TURNS - 1);
});

test('moving onto a different tier swaps the two mechs', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: 1 };
  state.board[1] = { id: 2, tier: 4 };
  const result = moveMech(state, 0, 1);
  assert.equal(result.type, 'swap');
  assert.deepEqual(state.board[0], { id: 2, tier: 4 });
  assert.deepEqual(state.board[1], { id: 1, tier: 1 });
  assert.equal(state.merges, 0);
});

test('moveMech rejects an empty source cell and a same-cell move', () => {
  const state = emptyState();
  state.board[3] = { id: 1, tier: 1 };
  assert.equal(moveMech(state, 0, 1).ok, false);
  assert.equal(moveMech(state, 3, 3).ok, false);
  assert.equal(state.turnsLeft, MAX_TURNS);
});

test('creating a Titan wins the game', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: MAX_TIER - 1 };
  state.board[1] = { id: 2, tier: MAX_TIER - 1 };
  moveMech(state, 0, 1);
  assert.equal(state.board[1].tier, MAX_TIER);
  assert.equal(state.status, 'won');
});

test('running out of turns loses the game', () => {
  const state = emptyState({ turnsLeft: 1 });
  state.board[0] = { id: 1, tier: 1 };
  state.board[1] = { id: 2, tier: 2 };
  moveMech(state, 0, 1);
  assert.equal(state.turnsLeft, 0);
  assert.equal(state.status, 'lost');
});

test('no actions are allowed after the game is over', () => {
  const state = emptyState({ status: 'won' });
  state.board[0] = { id: 1, tier: 1 };
  assert.equal(deployMech(state, fixedRng).ok, false);
  assert.equal(moveMech(state, 0, 1).ok, false);
  assert.equal(state.turnsLeft, MAX_TURNS);
});

test('mergeScore doubles with each tier', () => {
  assert.equal(mergeScore(2), 40);
  assert.equal(mergeScore(3), 80);
});
