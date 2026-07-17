import { describe, expect, it } from 'vitest';
import { createGame } from './engine';
import { configureTutorialRoute } from './tutorial';

describe('tutorial route configuration', () => {
	it('isolates one short route while preserving a mixed board', () => {
		const state = createGame({
			seed: 0x4752494e,
			players: [{ id: 'human' }, { id: 'dummy', isBot: true }]
		});
		const human = state.players.human!;
		state.arena.monsters[human.cellId]!.alive = true;
		const start = state.arena.monsters.m112!;
		human.cellId = start.id;
		human.position = { ...start.position };
		start.alive = false;

		const route = configureTutorialRoute(state, 'human', 'coral', ['m97', 'm98', 'm113']);
		expect(route).toEqual(['m97', 'm98', 'm113']);
		expect(state.arena.monsters[human.cellId]!.neighborIds).toContain(route[0]);
		expect(route.every((id) => state.arena.monsters[id]!.color === 'coral')).toBe(true);

		const boundary = new Set(route.flatMap((id) => state.arena.monsters[id]!.neighborIds));
		for (const id of route) boundary.delete(id);
		expect(
			[...boundary]
				.filter((id) => state.arena.monsters[id]?.alive)
				.every((id) => state.arena.monsters[id]!.color !== 'coral')
		).toBe(true);
		expect(new Set(Object.values(state.arena.monsters).map((monster) => monster.color)).size).toBe(
			3
		);
	});
});
