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

export function arenaGridMetrics(config: GameConfig) {
	const columns = config.monsterColumns;
	const rows = Math.ceil(config.monsterCount / columns);
	const cellSize = Math.min((config.width - 90) / columns, (config.height - 90) / rows);
	return {
		columns,
		rows,
		cellSize,
		originX: (config.width - columns * cellSize) / 2 + cellSize / 2,
		originY: (config.height - rows * cellSize) / 2 + cellSize / 2
	};
}

export function createArena(
	config: GameConfig,
	initialRandomState: number
): { arena: Arena; randomState: number } {
	const monsters: Arena['monsters'] = {};
	let randomState = initialRandomState;
	const { columns, rows, cellSize, originX, originY } = arenaGridMetrics(config);
	for (let index = 0; index < config.monsterCount; index++) {
		const row = Math.floor(index / columns),
			col = index % columns;
		const random = randomFrom(randomState);
		randomState = random.state;
		monsters[`m${index}`] = {
			id: `m${index}`,
			position: {
				x: originX + col * cellSize,
				y: originY + row * cellSize
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
