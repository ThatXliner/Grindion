import { describe, expect, it } from 'vitest';
import { createGame, stepGame } from './engine';
import { chainValue, maxHealthForScore, powerEfficiency, reachForScore } from './tuning';
import type { GameState } from './types';

function connectedChain(state: GameState, minimum = 3): string[] {
	for (const monster of Object.values(state.arena.monsters)) {
		const path = [monster.id];
		function walk(id: string): boolean {
			if (path.length >= minimum) return true;
			for (const nextId of state.arena.monsters[id]!.neighborIds) {
				const next = state.arena.monsters[nextId]!;
				if (next.alive && next.color === monster.color && !path.includes(nextId)) {
					path.push(nextId);
					if (walk(nextId)) return true;
					path.pop();
				}
			}
			return false;
		}
		if (walk(monster.id)) return path;
	}
	throw new Error('No connected chain');
}

describe('game engine', () => {
	it('creates identical arenas from the same seed', () => {
		expect(createGame({ seed: 42 })).toEqual(createGame({ seed: 42 }));
		expect(createGame({ seed: 42 }).arena).not.toEqual(createGame({ seed: 43 }).arena);
	});

	it('uses a square grid with orthogonal chain neighbors only', () => {
		const state = createGame({ seed: 42 });
		const columns = state.config.monsterColumns;
		for (const monster of Object.values(state.arena.monsters)) {
			const index = Number(monster.id.slice(1));
			for (const neighborId of monster.neighborIds) {
				const neighbor = Number(neighborId.slice(1));
				const rowDistance = Math.abs(Math.floor(index / columns) - Math.floor(neighbor / columns));
				const columnDistance = Math.abs((index % columns) - (neighbor % columns));
				expect(rowDistance + columnDistance).toBe(1);
			}
		}
	});

	it('uses logarithmic growth and power handicap', () => {
		expect(reachForScore(100)).toBeGreaterThan(reachForScore(0));
		expect(maxHealthForScore(1000) - maxHealthForScore(100)).toBeLessThan(
			9 * (maxHealthForScore(100) - maxHealthForScore(0))
		);
		expect(powerEfficiency(100)).toBeLessThan(powerEfficiency(0));
		expect(chainValue(8)).toBe(12);
	});

	it('builds and banks a valid same-color chain', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const chain = connectedChain(state);
		state.players.a!.position = { ...state.arena.monsters[chain[0]!]!.position };
		let result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: chain[0]! },
			...chain
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		result = stepGame(result.state, [{ type: 'chain-commit', playerId: 'a', conversion: 'score' }]);
		expect(result.state.players.a!.score).toBe(chainValue(chain.length));
		expect(result.state.players.a!.chain).toEqual([]);
		expect(chain.every((id) => !result.state.arena.monsters[id]!.alive)).toBe(true);
	});

	it('first commit consumes overlap and truncates the competing chain', () => {
		const state = createGame({ seed: 12, players: [{ id: 'a' }, { id: 'b' }] });
		const chain = connectedChain(state);
		for (const id of ['a', 'b']) {
			state.players[id]!.position = { ...state.arena.monsters[chain[0]!]!.position };
			state.players[id]!.chain = [...chain];
			state.players[id]!.mode = 'chaining';
		}
		const result = stepGame(state, [
			{ type: 'chain-commit', playerId: 'a', conversion: 'score', sequence: 1 },
			{ type: 'chain-commit', playerId: 'b', conversion: 'score', sequence: 2 }
		]);
		expect(result.state.players.a!.score).toBeGreaterThan(0);
		expect(result.state.players.b!.score).toBe(0);
		expect(
			result.events.some((event) => event.type === 'chain-truncated' && event.playerId === 'b')
		).toBe(true);
	});

	it('spends all power on a traveling shot and skill-parries it', () => {
		const state = createGame({ players: [{ id: 'a' }, { id: 'b' }] });
		state.players.a!.position = { x: 200, y: 200 };
		state.players.b!.position = { x: 260, y: 200 };
		state.players.a!.power = 40;
		state.players.b!.protectedUntilMs = 0;
		const result = stepGame(
			state,
			[
				{ type: 'parry', playerId: 'b' },
				{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }
			],
			50
		);
		expect(result.state.players.a!.power).toBe(0);
		expect(result.state.players.b!.health).toBe(result.state.players.b!.maxHealth);
		expect(result.events.some((event) => event.type === 'projectile-parried')).toBe(true);
	});

	it('fires projectiles at arbitrary angles independent of the grid', () => {
		const state = createGame({ players: [{ id: 'a' }] });
		state.players.a!.power = 40;
		const result = stepGame(
			state,
			[{ type: 'fire', playerId: 'a', direction: { x: 1, y: 1 } }],
			50
		);
		const projectile = Object.values(result.state.projectiles)[0]!;
		expect(projectile.velocity.x).toBeCloseTo(state.config.projectileSpeed / Math.sqrt(2));
		expect(projectile.velocity.y).toBeCloseTo(state.config.projectileSpeed / Math.sqrt(2));
	});

	it('damages, kills, loses score, and respawns with protection', () => {
		const state = createGame({ players: [{ id: 'a' }, { id: 'b' }] });
		Object.assign(state.players.a!, { position: { x: 200, y: 200 }, power: 120 });
		Object.assign(state.players.b!, {
			position: { x: 260, y: 200 },
			protectedUntilMs: 0,
			score: 100,
			health: 100
		});
		let result = stepGame(state, [{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }], 50);
		expect(result.state.players.b!.mode).toBe('dead');
		expect(result.state.players.b!.score).toBe(80);
		result = stepGame(result.state, [], 2_000);
		expect(result.state.players.b!.mode).toBe('neutral');
		expect(result.state.players.b!.protectedUntilMs).toBeGreaterThan(result.state.timeMs);
	});
});
