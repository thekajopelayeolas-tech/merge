const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createGame,
  deployMech,
  moveMech,
  startBattle,
  buyUpgrade,
  buyTurns,
  upgradeCost,
  mergeScore,
  enemyCount,
  enemyStats,
  mechStats,
  MAX_TIER,
  MAX_LEVEL,
  MAX_UPGRADE_LEVEL,
  START_TURNS,
  TURN_PACK_SIZE,
  TURN_PACK_COST,
  COINS_PER_KILL,
  LEVEL_CLEAR_COINS,
  GUN_BONUS,
  HEALTH_BONUS,
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

test('new game starts with two mechs, full turns, level 1, and playing status', () => {
  const state = createGame(fixedRng);
  assert.equal(countMechs(state), 2);
  assert.equal(state.turnsLeft, START_TURNS);
  assert.equal(state.level, 1);
  assert.equal(state.status, 'playing');
});

test('deployMech adds a mech and spends one turn', () => {
  const state = emptyState();
  const result = deployMech(state, fixedRng);
  assert.equal(result.ok, true);
  assert.equal(countMechs(state), 1);
  assert.equal(state.turnsLeft, START_TURNS - 1);
});

test('deployMech fails on a full board without spending a turn', () => {
  const state = emptyState();
  state.board = state.board.map((_, i) => ({ id: i + 1, tier: 1 }));
  const result = deployMech(state, fixedRng);
  assert.equal(result.ok, false);
  assert.equal(state.turnsLeft, START_TURNS);
});

test('moveMech moves a mech into an empty cell', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: 2 };
  const result = moveMech(state, 0, 7);
  assert.equal(result.type, 'move');
  assert.equal(state.board[0], null);
  assert.deepEqual(state.board[7], { id: 1, tier: 2 });
  assert.equal(state.turnsLeft, START_TURNS - 1);
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

test('two Titans cannot merge into anything higher', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: MAX_TIER };
  state.board[1] = { id: 2, tier: MAX_TIER };
  const result = moveMech(state, 0, 1);
  assert.equal(result.ok, false);
  assert.equal(state.turnsLeft, START_TURNS);
});

test('moveMech rejects an empty source cell and a same-cell move', () => {
  const state = emptyState();
  state.board[3] = { id: 1, tier: 1 };
  assert.equal(moveMech(state, 0, 1).ok, false);
  assert.equal(moveMech(state, 3, 3).ok, false);
  assert.equal(state.turnsLeft, START_TURNS);
});

test('enemy count and stats scale with the battle level', () => {
  assert.equal(enemyCount(1), 2);
  assert.equal(enemyCount(3), 4);
  assert.equal(enemyCount(50), 6);
  assert.ok(enemyStats(5).hp > enemyStats(4).hp);
  assert.ok(enemyStats(5).attack > enemyStats(4).attack);
});

test('battle result includes a replay of every round', () => {
  const state = emptyState({ level: 2 });
  state.board[0] = { id: 1, tier: 3 };
  const result = startBattle(state);
  assert.ok(result.battle.rounds.length > 0);
  const first = result.battle.rounds[0];
  assert.equal(first.shots.length, 1 + enemyCount(2));
  assert.ok(first.shots.every((shot) => shot.damage > 0));
  assert.ok(first.shots.some((shot) => shot.from.side === 'enemy'));
});

test('upgrade costs rise with each level', () => {
  assert.equal(upgradeCost(0), 20);
  assert.ok(upgradeCost(1) > upgradeCost(0));
});

test('buyUpgrade spends coins and raises the level', () => {
  const state = emptyState({ coins: 100 });
  const result = buyUpgrade(state, 'guns');
  assert.equal(result.ok, true);
  assert.equal(state.upgrades.guns, 1);
  assert.equal(state.coins, 100 - upgradeCost(0));
});

test('buyUpgrade rejects an upgrade you cannot afford', () => {
  const state = emptyState({ coins: 5 });
  assert.equal(buyUpgrade(state, 'health').ok, false);
  assert.equal(state.upgrades.health, 0);
  assert.equal(state.coins, 5);
});

test('buyUpgrade rejects unknown keys and maxed upgrades', () => {
  const state = emptyState({ coins: 100000 });
  assert.equal(buyUpgrade(state, 'speed').ok, false);
  state.upgrades.armour = MAX_UPGRADE_LEVEL;
  assert.equal(buyUpgrade(state, 'armour').ok, false);
  assert.equal(state.coins, 100000);
});

test('buyTurns adds a turn pack for coins', () => {
  const state = emptyState({ coins: TURN_PACK_COST });
  const result = buyTurns(state);
  assert.equal(result.ok, true);
  assert.equal(state.turnsLeft, START_TURNS + TURN_PACK_SIZE);
  assert.equal(state.coins, 0);
});

test('buyTurns fails without enough coins', () => {
  const state = emptyState({ coins: TURN_PACK_COST - 1 });
  assert.equal(buyTurns(state).ok, false);
  assert.equal(state.turnsLeft, START_TURNS);
});

test('store purchases are blocked after the game is over', () => {
  const state = emptyState({ coins: 1000, status: 'lost' });
  assert.equal(buyUpgrade(state, 'guns').ok, false);
  assert.equal(buyTurns(state).ok, false);
});

test('a battle pays coins for kills and for clearing the level', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: MAX_TIER };
  const result = startBattle(state);
  const expected = result.battle.kills * COINS_PER_KILL + (result.battle.won ? LEVEL_CLEAR_COINS : 0);
  assert.equal(result.battle.coinsEarned, expected);
  assert.equal(state.coins, expected);
});

test('the Guns upgrade increases mech attack in battle', () => {
  const plain = emptyState();
  plain.board[0] = { id: 1, tier: 1 };
  const boosted = emptyState({ upgrades: { guns: 5, armour: 0, health: 0 } });
  boosted.board[0] = { id: 1, tier: 1 };
  const first = startBattle(plain).battle.rounds[0];
  const second = startBattle(boosted).battle.rounds[0];
  const plainShot = first.shots.find((shot) => shot.from.side === 'mech');
  const boostedShot = second.shots.find((shot) => shot.from.side === 'mech');
  assert.equal(boostedShot.damage, plainShot.damage + 5 * GUN_BONUS);
});

test('the Health upgrade raises max HP reported to the replay', () => {
  const state = emptyState({ upgrades: { guns: 0, armour: 0, health: 4 } });
  state.board[0] = { id: 1, tier: 2 };
  const result = startBattle(state);
  assert.equal(result.battle.mechs[0].maxHp, mechStats(2).hp + 4 * HEALTH_BONUS);
});

test('the Armour upgrade reduces damage taken but never below 1', () => {
  const state = emptyState({ level: 1, upgrades: { guns: 0, armour: MAX_UPGRADE_LEVEL, health: 0 } });
  state.board[0] = { id: 1, tier: 1 };
  const result = startBattle(state);
  const enemyShots = result.battle.rounds[0].shots.filter((shot) => shot.from.side === 'enemy');
  assert.ok(enemyShots.every((shot) => shot.damage >= 1));
  assert.ok(enemyShots.every((shot) => shot.damage < enemyStats(1).attack));
});

test('a battle with no mechs is rejected', () => {
  const state = emptyState();
  const result = startBattle(state);
  assert.equal(result.ok, false);
  assert.equal(state.level, 1);
});

test('a strong army wins the battle, clears the level, and earns a turn per kill', () => {
  const state = emptyState();
  state.board[0] = { id: 1, tier: MAX_TIER };
  const before = state.turnsLeft;
  const result = startBattle(state);
  assert.equal(result.ok, true);
  assert.equal(result.battle.won, true);
  assert.equal(result.battle.kills, enemyCount(1));
  assert.equal(state.turnsLeft, before + result.battle.kills);
  assert.equal(state.level, 2);
  assert.equal(state.status, 'playing');
});

test('a weak army loses the battle and the run ends', () => {
  const state = emptyState({ level: 5 });
  state.board[0] = { id: 1, tier: 1 };
  const result = startBattle(state);
  assert.equal(result.battle.won, false);
  assert.equal(state.status, 'lost');
  assert.equal(state.level, 5);
});

test('mechs that die in battle leave the hangar', () => {
  const state = emptyState({ level: 3 });
  state.board[0] = { id: 1, tier: 1 };
  state.board[1] = { id: 2, tier: MAX_TIER };
  startBattle(state);
  assert.ok(countMechs(state) < 2);
});

test('clearing the final level wins the game', () => {
  const state = emptyState({ level: MAX_LEVEL });
  state.board = state.board.map((_, i) => ({ id: i + 1, tier: MAX_TIER }));
  const result = startBattle(state);
  assert.equal(result.battle.won, true);
  assert.equal(state.status, 'won');
});

test('no actions are allowed after the game is over', () => {
  const state = emptyState({ status: 'won' });
  state.board[0] = { id: 1, tier: 1 };
  assert.equal(deployMech(state, fixedRng).ok, false);
  assert.equal(moveMech(state, 0, 1).ok, false);
  assert.equal(startBattle(state).ok, false);
});

test('mech stats grow with tier', () => {
  assert.ok(mechStats(3).hp > mechStats(2).hp);
  assert.ok(mechStats(3).attack > mechStats(2).attack);
});

test('mergeScore doubles with each tier', () => {
  assert.equal(mergeScore(2), 40);
  assert.equal(mergeScore(3), 80);
});
