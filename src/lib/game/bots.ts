import { distance, normalize } from './arena';
import { canExtendWithColor } from './chainRules';
import { hashSeed, randomFrom } from './prng';
import type { GameIntent, GameState, Monster, PlayerState, Vec2 } from './types';

export interface BotController {
	update(state: GameState): GameIntent[];
	reset(): void;
}

function hasPath(
	state: GameState,
	monster: Monster,
	length: number,
	visited = new Set<string>()
): boolean {
	if (length <= 1) return true;
	visited.add(monster.id);
	for (const id of monster.neighborIds) {
		const next = state.arena.monsters[id];
		if (
			next?.alive &&
			next.color === monster.color &&
			!visited.has(id) &&
			hasPath(state, next, length - 1, new Set(visited))
		)
			return true;
	}
	return false;
}

function nearestMonster(state: GameState, player: PlayerState): Monster | undefined {
	const origin = state.arena.monsters[player.cellId];
	if (!origin) return undefined;
	const alive = origin.neighborIds
		.map((id) => state.arena.monsters[id]!)
		.filter((monster) => monster.alive);
	const viable = alive.filter((monster) => hasPath(state, monster, state.config.minChain));
	return (viable.length ? viable : alive).sort((a, b) => a.id.localeCompare(b.id))[0];
}
function directionTo(from: Vec2, to: Vec2): Vec2 {
	return normalize({ x: to.x - from.x, y: to.y - from.y });
}

export interface BotDifficulty {
	/** Milliseconds between decisions; each decision adds at most one monster to a chain. */
	thinkMs: number;
	/** Chance per decision to fire at a target within `fireRange`. */
	fireChance: number;
	fireRange: number;
	/** Largest aim error either side of the target, in radians. */
	aimError: number;
	/** Chance to parry a shot the bot notices in time. */
	parryChance: number;
}

/** Forgiving defaults: slow routes, rare and inaccurate shots, unreliable parries. */
export const DEFAULT_BOT_DIFFICULTY: Readonly<BotDifficulty> = Object.freeze({
	thinkMs: 300,
	fireChance: 0.12,
	fireRange: 520,
	aimError: 0.22,
	parryChance: 0.35
});

/** Deterministic bot brains. They only produce public GameIntents. */
export function createBotController(
	seed = 1,
	difficulty: Partial<BotDifficulty> = {}
): BotController {
	const tuning = { ...DEFAULT_BOT_DIFFICULTY, ...difficulty };
	let lastUpdateMs = -Infinity,
		randomState = seed | 0 || 1;
	const roll = () => {
		const next = randomFrom(randomState);
		randomState = next.state;
		return next.value;
	};
	return {
		update(state) {
			if (state.timeMs - lastUpdateMs < tuning.thinkMs || state.roundEnded) return [];
			lastUpdateMs = state.timeMs;
			const intents: GameIntent[] = [];
			for (const player of Object.values(state.players)
				.filter((candidate) => candidate.isBot)
				.sort((a, b) => a.id.localeCompare(b.id))) {
				if (player.mode === 'dead' || player.mode === 'hit') continue;
				const random = randomFrom(hashSeed(randomState, state.tick + player.id.length));
				randomState = random.state;
				const hostile = Object.values(state.projectiles).find((projectile) => {
					if (projectile.ownerId === player.id) return false;
					const toPlayer = {
						x: player.position.x - projectile.position.x,
						y: player.position.y - projectile.position.y
					};
					return (
						distance(player.position, projectile.position) < 140 &&
						projectile.velocity.x * toPlayer.x + projectile.velocity.y * toPlayer.y > 0
					);
				});
				if (hostile && player.chain.length) {
					intents.push({ type: 'chain-cancel', playerId: player.id });
					continue;
				}
				if (
					hostile &&
					player.power >= state.config.parryMinimum &&
					state.timeMs >= player.parryCooldownUntilMs
				) {
					if (roll() < tuning.parryChance) intents.push({ type: 'parry', playerId: player.id });
					continue;
				}
				if (player.chain.length) {
					const tail = state.arena.monsters[player.chain[player.chain.length - 1]!]!;
					const chainColors = player.chain.map((id) => state.arena.monsters[id]!.color);
					const candidates = tail.neighborIds
						.map((id) => state.arena.monsters[id]!)
						.filter(
							(monster) =>
								monster.alive &&
								canExtendWithColor(chainColors, monster.color, state.config.grindstoneStreak) &&
								!player.chain.includes(monster.id)
						)
						.sort((a, b) => a.id.localeCompare(b.id));
					if (candidates.length && (player.chain.length < 6 || random.value > 0.4))
						intents.push({
							type: 'chain-extend',
							playerId: player.id,
							monsterId: candidates[Math.floor(random.value * candidates.length)]!.id
						});
					else if (player.chain.length >= state.config.minChain)
						intents.push({
							type: 'chain-commit',
							playerId: player.id,
							conversion: player.power < 35 ? 'power' : 'score'
						});
					else intents.push({ type: 'chain-cancel', playerId: player.id });
					continue;
				}
				const target = Object.values(state.players)
					.filter((candidate) => candidate.id !== player.id && candidate.mode !== 'dead')
					.sort(
						(a, b) => distance(player.position, a.position) - distance(player.position, b.position)
					)[0];
				if (
					target &&
					player.power >= 30 &&
					distance(player.position, target.position) < tuning.fireRange &&
					roll() < tuning.fireChance
				) {
					const aim = directionTo(player.position, target.position);
					const error = (roll() * 2 - 1) * tuning.aimError;
					intents.push({
						type: 'fire',
						playerId: player.id,
						direction: {
							x: aim.x * Math.cos(error) - aim.y * Math.sin(error),
							y: aim.x * Math.sin(error) + aim.y * Math.cos(error)
						}
					});
					continue;
				}
				const monster = nearestMonster(state, player);
				if (!monster) continue;
				if (distance(player.position, monster.position) <= player.reach) {
					intents.push({ type: 'chain-start', playerId: player.id, monsterId: monster.id });
				}
			}
			return intents;
		},
		reset() {
			lastUpdateMs = -Infinity;
			randomState = seed | 0 || 1;
		}
	};
}
