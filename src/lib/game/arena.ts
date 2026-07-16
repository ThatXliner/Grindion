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
		const random = randomFrom(randomState);
		randomState = random.state;
		monsters[`m${index}`] = {
			id: `m${index}`,
			position: {
				x: marginX + col * dx,
				y: marginY + row * dy
			},
			color: COLORS[Math.floor(random.value * COLORS.length)]!,
			neighborIds: [],
			alive: true,
			respawnAtMs: 0
		};
	}
	for (let index = 0; index < config.monsterCount; index++) {
		const row = Math.floor(index / columns);
		const col = index % columns;
		const neighbors = [
			row > 0 ? index - columns : -1,
			col > 0 ? index - 1 : -1,
			col < columns - 1 ? index + 1 : -1,
			row < rows - 1 ? index + columns : -1
		].filter((neighbor) => neighbor >= 0 && neighbor < config.monsterCount);
		monsters[`m${index}`]!.neighborIds = neighbors.map((neighbor) => `m${neighbor}`);
	}
	return { arena: { width: config.width, height: config.height, monsters }, randomState };
}
