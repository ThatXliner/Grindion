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
		const neighbors: number[] = [];
		for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
			for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
				if (rowOffset === 0 && columnOffset === 0) continue;
				const neighborRow = row + rowOffset;
				const neighborColumn = col + columnOffset;
				const neighbor = neighborRow * columns + neighborColumn;
				if (
					neighborRow >= 0 &&
					neighborRow < rows &&
					neighborColumn >= 0 &&
					neighborColumn < columns &&
					neighbor < config.monsterCount
				)
					neighbors.push(neighbor);
			}
		}
		monsters[`m${index}`]!.neighborIds = neighbors.map((neighbor) => `m${neighbor}`);
	}
	return { arena: { width: config.width, height: config.height, monsters }, randomState };
}
