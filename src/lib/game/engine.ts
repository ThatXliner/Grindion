import { createArena, distance, normalize } from './arena';
import { randomFrom } from './prng';
import { chainValue, maxHealthForScore, powerGain, reachForScore } from './tuning';
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
		moveInput: { x: 0, y: 0 },
		score: 0,
		health: maxHealth,
		maxHealth,
		reach: reachForScore(0, config),
		power: config.initialPower,
		chain: [],
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
	return {
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
		projectiles: {}
	};
}

function cloneState(state: GameState): GameState {
	return structuredClone(state);
}

function intentOrder(intent: GameIntent): number {
	// Path edits arrive continuously between fixed ticks and must exist before a
	// release/commit in that same tick. Actions then use their authoritative
	// priority, followed by movement input.
	if (intent.type === 'chain-start' || intent.type === 'chain-extend') return 0;
	if (intent.type === 'parry') return 1;
	if (intent.type === 'chain-cancel') return 2;
	if (intent.type === 'chain-commit') return 3;
	if (intent.type === 'fire') return 4;
	return 5;
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
	return player.mode !== 'dead' && player.mode !== 'hit';
}
function cancelChain(player: PlayerState): void {
	player.chain = [];
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
	if (!monster?.alive || player.chain.includes(monsterId)) return;
	if (starting) {
		if (distance(player.position, monster.position) > player.reach) return;
		player.chain = [monsterId];
		player.mode = 'chaining';
		player.protectedUntilMs = state.timeMs;
		return;
	}
	const previous = state.arena.monsters[player.chain[player.chain.length - 1]!];
	const first = state.arena.monsters[player.chain[0]!];
	if (
		!previous ||
		!first ||
		monster.color !== first.color ||
		!previous.neighborIds.includes(monster.id)
	)
		return;
	// Reach is the player's leash from their stationary chaining position.
	if (distance(player.position, monster.position) > player.reach) return;
	player.chain.push(monsterId);
}

function truncateUnavailable(state: GameState, player: PlayerState): boolean {
	const validLength = player.chain.findIndex((id) => !state.arena.monsters[id]?.alive);
	if (validLength < 0) return false;
	player.chain = player.chain.slice(0, validLength);
	if (!player.chain.length) player.mode = 'neutral';
	return true;
}

function commitChain(
	state: GameState,
	player: PlayerState,
	conversion: 'score' | 'power',
	events: GameEvent[]
): void {
	truncateUnavailable(state, player);
	if (player.chain.length < state.config.minChain) {
		cancelChain(player);
		return;
	}
	const ids = [...player.chain],
		length = ids.length,
		value = chainValue(length);
	for (const id of ids) {
		const monster = state.arena.monsters[id]!;
		monster.alive = false;
		monster.respawnAtMs = state.timeMs + state.config.monsterRefillMs;
	}
	if (conversion === 'score') {
		player.score += value;
		player.maxHealth = maxHealthForScore(player.score, state.config);
		player.reach = reachForScore(player.score, state.config);
		player.health = Math.min(
			player.maxHealth,
			player.health + value * state.config.bankHealingPerValue
		);
	} else {
		player.power = Math.min(
			state.config.powerCap,
			player.power + powerGain(length, player.score, state.config)
		);
	}
	cancelChain(player);
	events.push({ type: 'chain-committed', playerId: player.id, conversion, length, value });
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
	if (!canAct(player) || player.chain.length || player.power < state.config.minFirePower) return;
	const aim = normalize(direction);
	if (aim.x === 0 && aim.y === 0) return;
	const power = player.power;
	player.power = 0;
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
		case 'move':
			player.moveInput = normalize(intent.direction);
			break;
		case 'chain-start':
			tryAddMonster(state, player, intent.monsterId, true);
			break;
		case 'chain-extend':
			tryAddMonster(state, player, intent.monsterId, false);
			break;
		case 'chain-cancel':
			cancelChain(player);
			break;
		case 'chain-commit':
			commitChain(state, player, intent.conversion, events);
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

function updateMovement(state: GameState, dtSeconds: number): void {
	for (const player of Object.values(state.players)) {
		if (player.mode === 'dead' || player.mode === 'hit' || player.chain.length) continue;
		player.position.x = clamp(
			player.position.x + player.moveInput.x * state.config.moveSpeed * dtSeconds,
			state.config.playerRadius,
			state.config.width - state.config.playerRadius
		);
		player.position.y = clamp(
			player.position.y + player.moveInput.y * state.config.moveSpeed * dtSeconds,
			state.config.playerRadius,
			state.config.height - state.config.playerRadius
		);
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
	player.mode = 'dead';
	player.deaths++;
	player.respawnAtMs = state.timeMs + state.config.respawnMs;
	player.score = Math.floor(player.score * (1 - state.config.deathScoreLoss));
	player.maxHealth = maxHealthForScore(player.score, state.config);
	player.reach = reachForScore(player.score, state.config);
	player.health = 0;
	player.power = 0;
	cancelChain(player);
	player.mode = 'dead';
	const owner = state.players[ownerId];
	if (owner) owner.kills++;
	events.push({ type: 'player-died', playerId: player.id, byPlayerId: ownerId });
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
		cancelChain(target);
		target.health = Math.max(0, target.health - projectile.power);
		events.push({
			type: 'player-damaged',
			playerId: target.id,
			byPlayerId: projectile.ownerId,
			damage: projectile.power
		});
		if (target.health <= 0) killPlayer(state, target, projectile.ownerId, events);
		else {
			target.mode = 'hit';
			target.hitUntilMs = state.timeMs + state.config.hitStunMs;
		}
	}
}

function updateRespawnsAndMonsters(state: GameState, events: GameEvent[]): void {
	const players = Object.values(state.players);
	for (const [index, player] of players.entries())
		if (player.mode === 'dead' && state.timeMs >= player.respawnAtMs) {
			player.position = spawnPosition(index, players.length, state.config);
			player.health = player.maxHealth;
			player.power = state.config.initialPower;
			player.mode = 'neutral';
			player.moveInput = { x: 0, y: 0 };
			player.protectedUntilMs = state.timeMs + state.config.spawnProtectionMs;
			events.push({ type: 'player-respawned', playerId: player.id });
		}
	for (const monster of Object.values(state.arena.monsters))
		if (!monster.alive && state.timeMs >= monster.respawnAtMs) {
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
	updateMovement(state, dtMs / 1000);
	updateProjectiles(state, dtMs / 1000, events);
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
