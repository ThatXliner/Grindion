import { describe, expect, it } from 'vitest';
import { createGame } from '../game/engine';
import { LIVE_ARENA_CONFIG } from '../game/tuning';
import { compactSnapshot, expandSnapshot } from './snapshot';

describe('compact arena snapshots', () => {
	it('round-trips monster colors and availability against the start board', () => {
		const board = createGame({ seed: 3, config: LIVE_ARENA_CONFIG });
		const later = structuredClone(board);
		later.tick = 42;
		later.arena.monsters.m5!.alive = false;
		later.arena.monsters.m9!.color = later.arena.monsters.m9!.color === 'gold' ? 'cyan' : 'gold';

		const compact = compactSnapshot(later);
		expect(compact.cells).toHaveLength(Object.keys(board.arena.monsters).length);
		expect(compact).not.toHaveProperty('arena');

		const restored = expandSnapshot(JSON.parse(JSON.stringify(compact)), board.arena);
		expect(restored.tick).toBe(42);
		for (const [id, monster] of Object.entries(later.arena.monsters)) {
			expect(restored.arena.monsters[id]!.alive).toBe(monster.alive);
			expect(restored.arena.monsters[id]!.color).toBe(monster.color);
			expect(restored.arena.monsters[id]!.neighborIds).toEqual(monster.neighborIds);
		}
	});

	it('shrinks the per-tick payload for a live arena', () => {
		const state = createGame({ seed: 3, config: LIVE_ARENA_CONFIG });
		expect(JSON.stringify(compactSnapshot(state)).length).toBeLessThan(
			JSON.stringify(state).length / 5
		);
	});
});
