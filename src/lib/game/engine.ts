import { createArena, distance, normalize } from './arena';
import { canChainStrikeTarget } from './chainAttack';
import { createChainMotionTiming } from './chainMotion';
import { canExtendWithColor } from './chainRules';
import { randomFrom } from './prng';
import { chainScore, maxHealthForScore, powerGain, reachForScore } from './tuning';
import { DEFAULT_CONFIG } from './tuning';
import type {
	CreateGameOptions,
	GameConfig,
	GameEvent,
	GameIntent,
	GameState,
	PlayerSetup,
	PlayerState,
	StepResult,
	Vec2
} from './types';

const PLAYER_COLORS = [
	'#ff6b5e',
	'#55d6ff',
	'#ffd166',
	'#a78bfa',
	'#5ee6a8',
	'#ff8bc2',
	'#ff9f43',
	'#7ae582'
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function spawnPosition(index: number, count: number, config: GameConfig): Vec2 {
	const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
	return {
		x: config.width / 2 + Math.cos(angle) * config.width * 0.38,
		y: config.height / 2 + Math.sin(angle) * config.height * 0.35
	};
}

function makePlayer(
	setup: PlayerSetup,
	index: number,
	count: number,
	config: GameConfig
): PlayerState {
	const maxHealth = maxHealthForScore(0, config);
	return {
		id: setup.id,
		name: setup.name ?? setup.id,
		isBot: setup.isBot ?? false,
		color: setup.color ?? PLAYER_COLORS[index % PLAYER_COLORS.length]!,
		position: spawnPosition(index, count, config),
		cellId: '',
		score: 0,
		health: maxHealth,
		maxHealth,
		reach: reachForScore(0, config),
		power: config.initialPower,
		chain: [],
		chainTargetId: null,
		mode: 'neutral',
		parryUntilMs: 0,
		parryCooldownUntilMs: 0,
		hitUntilMs: 0,
		respawnAtMs: 0,
		protectedUntilMs: config.spawnProtectionMs,
		deaths: 0,
		kills: 0
	};
}

function placePlayerOnSpawnCell(
	player: PlayerState,
	index: number,
	count: number,
	state: Pick<GameState, 'arena' | 'players' | 'config'>
): void {
	const target = spawnPosition(index, count, state.config);
	const occupied = new Set(
		Object.values(state.players)
			.filter((candidate) => candidate.id !== player.id && candidate.mode !== 'dead')
			.map((candidate) => candidate.cellId)
	);
	const cell = Object.values(state.arena.monsters)
		.filter((monster) => !occupied.has(monster.id))
		.sort(
			(a, b) =>
				distance(a.position, target) - distance(b.position, target) || a.id.localeCompare(b.id)
		)[0];
	if (!cell) return;
	player.cellId = cell.id;
	player.position = { ...cell.position };
	cell.alive = false;
	cell.respawnAtMs = 0;
}

export function createGame(options: CreateGameOptions = {}): GameState {
	const config: GameConfig = { ...DEFAULT_CONFIG, ...options.config };
	const seed = (options.seed ?? 0x4752494e) | 0;
	const setups = options.players ?? [
		{ id: 'player', name: 'You' },
		...Array.from({ length: options.botCount ?? 7 }, (_, index) => ({
			id: `bot-${index + 1}`,
			name: `Bot ${index + 1}`,
			isBot: true
		}))
	];
	const arenaResult = createArena(config, seed || 1);
	const players: GameState['players'] = {};
	setups.forEach((setup, index) => {
		players[setup.id] = makePlayer(setup, index, setups.length, config);
	});
	const state: GameState = {
		seed,
		randomState: arenaResult.randomState,
		tick: 0,
		timeMs: 0,
		roundEndsAtMs: config.roundDurationMs,
		roundEnded: false,
		nextProjectileId: 1,
		config,
		arena: arenaResult.arena,
		players,
		projectiles: {},
		chainStrikes: {}
	};
	Object.values(players).forEach((player, index) =>
		placePlayerOnSpawnCell(player, index, setups.length, state)
	);
	return state;
}

function cloneState(state: GameState): GameState {
	return structuredClone(state);
}

function intentOrder(intent: GameIntent): number {
	// Path edits arrive continuously between fixed ticks and must exist before a
	// release/commit in that same tick. Actions then use their authoritative priority.
	if (
		intent.type === 'chain-start' ||
		intent.type === 'chain-extend' ||
		intent.type === 'chain-target'
	)
		return 0;
	if (intent.type === 'parry') return 2;
	if (intent.type === 'chain-cancel') return 3;
	if (intent.type === 'chain-commit') return 4;
	if (intent.type === 'fire') return 5;
	return 6;
}

function sortedIntents(intents: GameIntent[]): GameIntent[] {
	return intents
		.map((intent, index) => ({ intent, index }))
		.sort(
			(a, b) =>
				intentOrder(a.intent) - intentOrder(b.intent) ||
				(a.intent.sequence ?? a.index) - (b.intent.sequence ?? b.index) ||
				a.intent.playerId.localeCompare(b.intent.playerId)
		)
		.map(({ intent }) => intent);
}

function canAct(player: PlayerState): boolean {
	return player.mode !== 'dead' && player.mode !== 'hit' && player.mode !== 'striking';
}
function cancelChain(player: PlayerState): void {
	player.chain = [];
	player.chainTargetId = null;
	if (player.mode === 'chaining') player.mode = 'neutral';
}

function tryAddMonster(
	state: GameState,
	player: PlayerState,
	monsterId: string,
	starting: boolean
): void {
	if (!canAct(player) || (starting ? player.chain.length > 0 : player.chain.length === 0)) return;
	const monster = state.arena.monsters[monsterId];
	if (!monster?.alive) return;
	if (starting) {
		const origin = state.arena.monsters[player.cellId];
		if (!origin?.neighborIds.includes(monster.id)) return;
		player.chain = [monsterId];
		player.mode = 'chaining';
		player.protectedUntilMs = state.timeMs;
		return;
	}
	const existingIndex = player.chain.indexOf(monsterId);
	if (existingIndex >= 0) {
		player.chain = player.chain.slice(0, existingIndex + 1);
		player.chainTargetId = null;
		return;
	}
	const previous = state.arena.monsters[player.chain[player.chain.length - 1]!];
	const colors = player.chain.map((id) => state.arena.monsters[id]!.color);
	if (
		!previous ||
		!canExtendWithColor(colors, monster.color, state.config.grindstoneStreak) ||
		!previous.neighborIds.includes(monster.id)
	)
		return;
	player.chain.push(monsterId);
	player.chainTargetId = null;
}

function truncateUnavailable(state: GameState, player: PlayerState): boolean {
	const validLength = player.chain.findIndex((id) => !state.arena.monsters[id]?.alive);
	if (validLength < 0) return false;
	player.chain = player.chain.slice(0, validLength);
	player.chainTargetId = null;
	if (!player.chain.length) player.mode = 'neutral';
	return true;
}

function commitChain(state: GameState, player: PlayerState, events: GameEvent[]): void {
	if (!canAct(player)) return;
	truncateUnavailable(state, player);
	if (player.chain.length < state.config.minChain) {
		cancelChain(player);
		return;
	}
	const target = state.players[player.chainTargetId ?? ''];
	const attackTarget = target && canChainStrikeTarget(state, player, target) ? target : null;
	const ids = [...player.chain],
		length = ids.length,
		value = chainScore(length, state.config),
		origin = { ...player.position },
		destination = { ...state.arena.monsters[ids[length - 1]!]!.position };
	for (const id of ids) {
		const monster = state.arena.monsters[id]!;
		monster.alive = false;
		monster.respawnAtMs = state.timeMs + state.config.monsterRefillMs;
	}
	const scoreBefore = player.score;
	const powerGained = powerGain(length, state.config);
	const powerSpent = attackTarget ? state.config.shotCost : 0;
	player.score += value;
	player.maxHealth = maxHealthForScore(player.score, state.config);
	player.reach = reachForScore(player.score, state.config);
	player.health = Math.min(
		player.maxHealth,
		player.health + value * state.config.chainHealingPerScore
	);
	player.power += powerGained - powerSpent;
	// Committing the route is the player's only locomotion. The server resolves
	// the chain atomically and places the player on its final cell.
	player.position = destination;
	player.cellId = ids[length - 1]!;
	cancelChain(player);
	events.push({
		type: 'chain-committed',
		playerId: player.id,
		length,
		value,
		powerGained,
		powerSpent,
		scoreBefore,
		origin,
		monsterIds: ids
	});
	if (attackTarget) {
		const id = `c${state.nextProjectileId++}`;
		player.mode = 'striking';
		state.chainStrikes[id] = {
			id,
			ownerId: player.id,
			targetId: attackTarget.id,
			cellId: attackTarget.cellId,
			originCellId: player.cellId,
			damage: state.config.shotDamage,
			startedAtMs: state.timeMs,
			hitAtMs:
				state.timeMs + createChainMotionTiming(length).totalMs + state.config.chainStrikeWindupMs
		};
		events.push({
			type: 'chain-strike-started',
			playerId: player.id,
			targetId: attackTarget.id,
			strikeId: id
		});
	}
	for (const opponent of Object.values(state.players)) {
		if (opponent.id !== player.id && truncateUnavailable(state, opponent)) {
			events.push({
				type: 'chain-truncated',
				playerId: opponent.id,
				length: opponent.chain.length
			});
		}
	}
}

function beginParry(state: GameState, player: PlayerState): void {
	if (
		!canAct(player) ||
		player.chain.length ||
		player.power < state.config.parryMinimum ||
		state.timeMs < player.parryCooldownUntilMs
	)
		return;
	player.power = Math.max(0, player.power - state.config.parryCost);
	player.mode = 'parrying';
	player.parryUntilMs = state.timeMs + state.config.parryWindowMs;
	player.parryCooldownUntilMs = state.timeMs + state.config.parryCooldownMs;
}

function fire(state: GameState, player: PlayerState, direction: Vec2, events: GameEvent[]): void {
	if (!canAct(player) || player.chain.length || player.power < state.config.shotCost) return;
	const aim = normalize(direction);
	if (aim.x === 0 && aim.y === 0) return;
	const power = state.config.shotDamage;
	player.power -= state.config.shotCost;
	player.protectedUntilMs = state.timeMs;
	const id = `p${state.nextProjectileId++}`;
	const radius = 6 + 0.75 * Math.sqrt(power);
	state.projectiles[id] = {
		id,
		ownerId: player.id,
		position: {
			x: player.position.x + aim.x * (state.config.playerRadius + radius + 2),
			y: player.position.y + aim.y * (state.config.playerRadius + radius + 2)
		},
		velocity: { x: aim.x * state.config.projectileSpeed, y: aim.y * state.config.projectileSpeed },
		power,
		radius,
		expiresAtMs: state.timeMs + state.config.projectileLifetimeMs
	};
	events.push({ type: 'projectile-fired', playerId: player.id, projectileId: id, power });
}

function processIntent(state: GameState, intent: GameIntent, events: GameEvent[]): void {
	const player = state.players[intent.playerId];
	if (!player || state.roundEnded) return;
	switch (intent.type) {
		case 'chain-start':
			tryAddMonster(state, player, intent.monsterId, true);
			break;
		case 'chain-extend':
			tryAddMonster(state, player, intent.monsterId, false);
			break;
		case 'chain-target': {
			if (intent.targetId === null) {
				player.chainTargetId = null;
				break;
			}
			const target = state.players[intent.targetId];
			if (target && canChainStrikeTarget(state, player, target)) player.chainTargetId = target.id;
			break;
		}
		case 'chain-cancel':
			cancelChain(player);
			break;
		case 'chain-commit':
			commitChain(state, player, events);
			break;
		case 'parry':
			beginParry(state, player);
			break;
		case 'fire':
			fire(state, player, intent.direction, events);
			break;
	}
}

function updateModes(state: GameState): void {
	for (const player of Object.values(state.players)) {
		if (player.mode === 'parrying' && state.timeMs >= player.parryUntilMs) player.mode = 'neutral';
		if (player.mode === 'hit' && state.timeMs >= player.hitUntilMs) player.mode = 'neutral';
	}
}

function segmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
	const dx = end.x - start.x,
		dy = end.y - start.y,
		lengthSquared = dx * dx + dy * dy;
	if (!lengthSquared) return distance(point, start);
	const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
	return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function killPlayer(
	state: GameState,
	player: PlayerState,
	ownerId: string,
	events: GameEvent[]
): void {
	const previousScore = player.score;
	player.mode = 'dead';
	player.deaths++;
	player.respawnAtMs = state.timeMs + state.config.respawnMs;
	player.score = Math.floor(player.score * (1 - state.config.deathScoreLoss));
	player.maxHealth = maxHealthForScore(player.score, state.config);
	player.reach = reachForScore(player.score, state.config);
	player.health = 0;
	player.power = 0;
	player.cellId = '';
	cancelChain(player);
	player.mode = 'dead';
	const owner = state.players[ownerId];
	if (owner) owner.kills++;
	events.push({
		type: 'player-died',
		playerId: player.id,
		byPlayerId: ownerId,
		scoreLost: previousScore - player.score
	});
}

function damagePlayer(
	state: GameState,
	target: PlayerState,
	ownerId: string,
	damage: number,
	events: GameEvent[]
): void {
	cancelChain(target);
	target.health = Math.max(0, target.health - damage);
	events.push({
		type: 'player-damaged',
		playerId: target.id,
		byPlayerId: ownerId,
		damage: damage
	});
	if (target.health <= 0) killPlayer(state, target, ownerId, events);
	else {
		target.mode = 'hit';
		target.hitUntilMs = state.timeMs + state.config.hitStunMs;
	}
}

function updateChainStrikes(state: GameState, events: GameEvent[]): void {
	for (const strike of Object.values(state.chainStrikes).sort((a, b) => a.id.localeCompare(b.id))) {
		const owner = state.players[strike.ownerId];
		const target = state.players[strike.targetId];
		let outcome: 'hit' | 'missed' | 'parried' | 'interrupted';
		if (
			state.timeMs >= state.roundEndsAtMs ||
			!owner ||
			owner.mode !== 'striking' ||
			owner.cellId !== strike.originCellId
		)
			outcome = 'interrupted';
		else if (!target || target.mode === 'dead') outcome = 'missed';
		else if (state.timeMs < strike.hitAtMs) continue;
		else if (target.cellId !== strike.cellId || state.timeMs < target.protectedUntilMs)
			outcome = 'missed';
		else if (target.mode === 'parrying' && state.timeMs <= target.parryUntilMs) outcome = 'parried';
		else {
			outcome = 'hit';
			damagePlayer(state, target, strike.ownerId, strike.damage, events);
		}
		delete state.chainStrikes[strike.id];
		if (owner?.mode === 'striking') {
			owner.mode = outcome === 'parried' ? 'hit' : 'neutral';
			if (outcome === 'parried') owner.hitUntilMs = state.timeMs + state.config.hitStunMs * 2;
		}
		events.push({
			type: 'chain-strike-ended',
			playerId: strike.ownerId,
			targetId: strike.targetId,
			strikeId: strike.id,
			cellId: strike.cellId,
			outcome
		});
	}
}

function updateProjectiles(state: GameState, dtSeconds: number, events: GameEvent[]): void {
	for (const projectile of Object.values(state.projectiles).sort((a, b) =>
		a.id.localeCompare(b.id)
	)) {
		const start = { ...projectile.position };
		projectile.position.x += projectile.velocity.x * dtSeconds;
		projectile.position.y += projectile.velocity.y * dtSeconds;
		if (
			state.timeMs >= projectile.expiresAtMs ||
			projectile.position.x < -projectile.radius ||
			projectile.position.y < -projectile.radius ||
			projectile.position.x > state.config.width + projectile.radius ||
			projectile.position.y > state.config.height + projectile.radius
		) {
			delete state.projectiles[projectile.id];
			continue;
		}
		const targets = Object.values(state.players).filter(
			(player) =>
				player.id !== projectile.ownerId &&
				player.mode !== 'dead' &&
				state.timeMs >= player.protectedUntilMs
		);
		const target = targets.find(
			(player) =>
				segmentDistance(player.position, start, projectile.position) <=
				state.config.playerRadius + projectile.radius
		);
		if (!target) continue;
		delete state.projectiles[projectile.id];
		if (target.mode === 'parrying' && state.timeMs <= target.parryUntilMs) {
			events.push({ type: 'projectile-parried', playerId: target.id, projectileId: projectile.id });
			continue;
		}
		damagePlayer(state, target, projectile.ownerId, projectile.power, events);
	}
}

function updateRespawnsAndMonsters(state: GameState, events: GameEvent[]): void {
	const players = Object.values(state.players);
	for (const [index, player] of players.entries())
		if (player.mode === 'dead' && state.timeMs >= player.respawnAtMs) {
			placePlayerOnSpawnCell(player, index, players.length, state);
			player.health = player.maxHealth;
			player.power = state.config.initialPower;
			player.mode = 'neutral';
			player.protectedUntilMs = state.timeMs + state.config.spawnProtectionMs;
			events.push({ type: 'player-respawned', playerId: player.id });
		}
	const occupiedCells = new Set(
		players.filter((player) => player.mode !== 'dead').map((player) => player.cellId)
	);
	for (const monster of Object.values(state.arena.monsters))
		if (!monster.alive && !occupiedCells.has(monster.id) && state.timeMs >= monster.respawnAtMs) {
			const random = randomFrom(state.randomState);
			state.randomState = random.state;
			monster.color = (['coral', 'cyan', 'gold'] as const)[Math.floor(random.value * 3)]!;
			monster.alive = true;
			monster.respawnAtMs = 0;
		}
}

/** Advances one authoritative fixed step and returns a new state; the input is never mutated. */
export function stepGame(
	previous: GameState,
	intents: GameIntent[] = [],
	dtMs = 1000 / previous.config.tickRate
): StepResult {
	const state = cloneState(previous),
		events: GameEvent[] = [];
	if (dtMs <= 0 || !Number.isFinite(dtMs)) return { state, events };
	state.tick++;
	state.timeMs += dtMs;
	updateModes(state);
	for (const intent of sortedIntents(intents)) processIntent(state, intent, events);
	updateProjectiles(state, dtMs / 1000, events);
	updateChainStrikes(state, events);
	updateRespawnsAndMonsters(state, events);
	if (!state.roundEnded && state.timeMs >= state.roundEndsAtMs) {
		state.roundEnded = true;
		events.push({ type: 'round-ended' });
	}
	return { state, events };
}

/** Convenience accumulator for requestAnimationFrame-based clients. */
export class FixedStepGame {
	state: GameState;
	private accumulatorMs = 0;
	private pending: GameIntent[] = [];
	constructor(options: CreateGameOptions = {}) {
		this.state = createGame(options);
	}
	dispatch(intent: GameIntent): void {
		this.pending.push(intent);
	}
	update(elapsedMs: number): GameEvent[] {
		this.accumulatorMs += Math.min(Math.max(0, elapsedMs), 250);
		const events: GameEvent[] = [];
		const dt = 1000 / this.state.config.tickRate;
		while (this.accumulatorMs >= dt) {
			const result = stepGame(this.state, this.pending, dt);
			this.state = result.state;
			events.push(...result.events);
			this.pending = [];
			this.accumulatorMs -= dt;
		}
		return events;
	}
	get snapshot(): GameState {
		return this.state;
	}
}
