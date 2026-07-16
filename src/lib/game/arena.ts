import { randomFrom } from './prng';
import type { Arena, GameConfig, MonsterColor, Vec2 } from './types';

const COLORS: MonsterColor[] = ['coral', 'cyan', 'gold'];
export function distance(a: Vec2, b: Vec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
export function normalize(v: Vec2): Vec2 {
	const length = Math.hypot(v.x, v.y);
	return length > 0 ? { x: v.x / length, y: v.y / length } : { x: 0, y: 0 };
}

export function createArena(
	config: GameConfig,
	initialRandomState: number
): { arena: Arena; randomState: number } {
	const monsters: Arena['monsters'] = {};
	let randomState = initialRandomState;
	const columns = config.monsterColumns;
	const rows = Math.ceil(config.monsterCount / columns);
	const marginX = 90,
		marginY = 80,
		dx = (config.width - marginX * 2) / Math.max(1, columns - 1);
	const dy = (config.height - marginY * 2) / Math.max(1, rows - 1);
	for (let index = 0; index < config.monsterCount; index++) {
		const row = Math.floor(index / columns),
			col = index % columns;
		let random = randomFrom(randomState);
		randomState = random.state;
		const jitterX = (random.value - 0.5) * dx * 0.22;
		random = randomFrom(randomState);
		randomState = random.state;
		const jitterY = (random.value - 0.5) * dy * 0.22;
		random = randomFrom(randomState);
		randomState = random.state;
		monsters[`m${index}`] = {
			id: `m${index}`,
			position: {
				x: marginX + col * dx + (row % 2 ? dx * 0.35 : 0) + jitterX,
				y: marginY + row * dy + jitterY
			},
			color: COLORS[Math.floor(random.value * COLORS.length)]!,
			neighborIds: [],
			alive: true,
			respawnAtMs: 0
		};
	}
	const all = Object.values(monsters);
	const threshold = Math.hypot(dx, dy) * 1.22;
	for (let a = 0; a < all.length; a++)
		for (let b = a + 1; b < all.length; b++) {
			if (distance(all[a]!.position, all[b]!.position) <= threshold) {
				all[a]!.neighborIds.push(all[b]!.id);
				all[b]!.neighborIds.push(all[a]!.id);
			}
		}
	return { arena: { width: config.width, height: config.height, monsters }, randomState };
}
