import { distance, normalize } from './arena';
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
	const alive = Object.values(state.arena.monsters).filter((monster) => monster.alive);
	const viable = alive.filter((monster) => hasPath(state, monster, state.config.minChain));
	return (viable.length ? viable : alive).sort(
		(a, b) =>
			distance(player.position, a.position) - distance(player.position, b.position) ||
			a.id.localeCompare(b.id)
	)[0];
}
function directionTo(from: Vec2, to: Vec2): Vec2 {
	return normalize({ x: to.x - from.x, y: to.y - from.y });
}

/** Deterministic 8 Hz bot brains. They only produce public GameIntents. */
export function createBotController(seed = 1): BotController {
	let lastUpdateMs = -Infinity,
		randomState = seed | 0 || 1;
	return {
		update(state) {
			if (state.timeMs - lastUpdateMs < 125 || state.roundEnded) return [];
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
					intents.push({ type: 'parry', playerId: player.id });
					continue;
				}
				if (player.chain.length) {
					const tail = state.arena.monsters[player.chain[player.chain.length - 1]!]!;
					const first = state.arena.monsters[player.chain[0]!]!;
					const candidates = tail.neighborIds
						.map((id) => state.arena.monsters[id]!)
						.filter(
							(monster) =>
								monster.alive &&
								monster.color === first.color &&
								!player.chain.includes(monster.id) &&
								distance(player.position, monster.position) <= player.reach
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
					distance(player.position, target.position) < 650 &&
					random.value > 0.72
				) {
					intents.push({
						type: 'fire',
						playerId: player.id,
						direction: directionTo(player.position, target.position)
					});
					continue;
				}
				const monster = nearestMonster(state, player);
				if (!monster) continue;
				if (distance(player.position, monster.position) <= player.reach) {
					intents.push({ type: 'move', playerId: player.id, direction: { x: 0, y: 0 } });
					intents.push({ type: 'chain-start', playerId: player.id, monsterId: monster.id });
				} else
					intents.push({
						type: 'move',
						playerId: player.id,
						direction: directionTo(player.position, monster.position)
					});
			}
			return intents;
		},
		reset() {
			lastUpdateMs = -Infinity;
			randomState = seed | 0 || 1;
		}
	};
}
