import { describe, expect, it } from 'vitest';
import { createGame, stepGame } from './engine';
import { chainScore, maxHealthForScore, powerGain, reachForScore } from './tuning';
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

function placePlayerBesideChain(state: GameState, playerId: string, chain: string[]): void {
	const originId = state.arena.monsters[chain[0]!]!.neighborIds.find(
		(id) => !chain.includes(id) && state.arena.monsters[id]!.alive
	);
	if (!originId) throw new Error('No free origin beside chain');
	const origin = state.arena.monsters[originId]!;
	state.players[playerId]!.cellId = origin.id;
	state.players[playerId]!.position = { ...origin.position };
	origin.alive = false;
}

describe('game engine', () => {
	it('creates identical arenas from the same seed', () => {
		expect(createGame({ seed: 42 })).toEqual(createGame({ seed: 42 }));
		expect(createGame({ seed: 42 }).arena).not.toEqual(createGame({ seed: 43 }).arena);
	});

	it('uses all eight adjacent cells as square-grid chain neighbors', () => {
		const state = createGame({ seed: 42 });
		const columns = state.config.monsterColumns;
		let foundDiagonal = false;
		for (const monster of Object.values(state.arena.monsters)) {
			const index = Number(monster.id.slice(1));
			for (const neighborId of monster.neighborIds) {
				const neighbor = Number(neighborId.slice(1));
				const rowDistance = Math.abs(Math.floor(index / columns) - Math.floor(neighbor / columns));
				const columnDistance = Math.abs((index % columns) - (neighbor % columns));
				expect(Math.max(rowDistance, columnDistance)).toBe(1);
				if (rowDistance === 1 && columnDistance === 1) foundDiagonal = true;
			}
		}
		expect(foundDiagonal).toBe(true);
		expect(state.arena.monsters.m1!.position.x - state.arena.monsters.m0!.position.x).toBeCloseTo(
			state.arena.monsters[`m${columns}`]!.position.y - state.arena.monsters.m0!.position.y
		);
	});

	it('keeps logarithmic growth and flat per-monster rewards', () => {
		expect(reachForScore(100)).toBeGreaterThan(reachForScore(0));
		expect(reachForScore(0)).toBe(180);
		expect(reachForScore(10)).toBeCloseTo(188, 0);
		expect(reachForScore(1000)).toBeCloseTo(269, 0);
		expect(maxHealthForScore(1000) - maxHealthForScore(100)).toBeLessThan(
			9 * (maxHealthForScore(100) - maxHealthForScore(0))
		);
		expect(powerGain(3)).toBe(15);
		expect(chainScore(2)).toBe(0);
		expect(chainScore(3)).toBe(3);
		expect(chainScore(10)).toBe(10);
	});

	it('spends one shot of power for flat damage and banks the rest', () => {
		for (const power of [15, 120]) {
			const state = createGame({ players: [{ id: 'a' }, { id: 'b' }] });
			Object.assign(state.players.a!, { position: { x: 200, y: 200 }, power, score: 400 });
			Object.assign(state.players.b!, { position: { x: 260, y: 200 }, protectedUntilMs: 0 });
			const result = stepGame(state, [{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }]);
			expect(result.state.players.b!.health).toBe(80);
			expect(result.state.players.a!.power).toBe(power - 15);
			expect(result.events).toContainEqual({
				type: 'player-damaged',
				playerId: 'b',
				byPlayerId: 'a',
				damage: 20
			});
		}
	});

	it('refuses to fire below one shot of power', () => {
		const state = createGame({ players: [{ id: 'a' }] });
		state.players.a!.power = 14;
		const result = stepGame(state, [{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }]);
		expect(result.state.projectiles).toEqual({});
		expect(result.state.players.a!.power).toBe(14);
	});

	it('banks power without a cap, rejects short chains, and earns no rewards for cancellation', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const chain = connectedChain(state);
		state.players.a!.power = 115;
		state.players.a!.chain = chain;
		state.players.a!.mode = 'chaining';
		const committed = stepGame(state, [{ type: 'chain-commit', playerId: 'a' }]);
		expect(committed.state.players.a!.power).toBe(130);
		expect(committed.state.players.a!.score).toBe(3);
		state.players.a!.chain = chain.slice(0, 2);
		const short = stepGame(state, [{ type: 'chain-commit', playerId: 'a' }]);
		expect(short.state.players.a!.power).toBe(115);
		expect(short.state.players.a!.score).toBe(0);
		expect(short.events).toEqual([]);
		state.players.a!.chain = chain;
		const cancelled = stepGame(state, [{ type: 'chain-cancel', playerId: 'a' }]);
		expect(cancelled.state.players.a!.power).toBe(115);
		expect(cancelled.state.players.a!.score).toBe(0);
	});

	function commitRoute(state: GameState, length: number) {
		const chain = Array.from({ length }, (_, index) => `m${index}`);
		Object.assign(state.players.a!, { chain, mode: 'chaining' });
		return stepGame(state, [{ type: 'chain-commit', playerId: 'a' }]).state.players.a!;
	}

	it('heals a share of max health for long chains, capped at half', () => {
		const heal = (length: number) => {
			const state = createGame({ seed: 7, players: [{ id: 'a' }] });
			Object.assign(state.players.a!, { score: 60, health: 1 });
			return commitRoute(state, length).health - 1;
		};
		const maxHealth = (gained: number) => maxHealthForScore(60 + gained);
		expect(heal(5)).toBeCloseTo(5 * 0.35);
		expect(heal(6)).toBeCloseTo(6 * 0.35 + 0.05 * maxHealth(6));
		expect(heal(10)).toBeCloseTo(10 * 0.35 + 0.25 * maxHealth(10));
		expect(heal(20)).toBeCloseTo(20 * 0.35 + 0.5 * maxHealth(20));
	});

	it('fully heals when a chain evolves the hero', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		Object.assign(state.players.a!, { score: 48, health: 5 });
		const player = commitRoute(state, 3);
		expect(player.score).toBe(51);
		expect(player.health).toBe(player.maxHealth);
	});

	it('unlocks one color switch after five consecutive monsters', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const route = ['m0', 'm1', 'm2', 'm17', 'm32', 'm31', 'm30'];
		const origin = state.arena.monsters.m16!;
		state.players.a!.cellId = origin.id;
		state.players.a!.position = { ...origin.position };
		origin.alive = false;
		for (const id of route.slice(0, 5)) state.arena.monsters[id]!.color = 'coral';
		for (const id of route.slice(5)) state.arena.monsters[id]!.color = 'cyan';

		const result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: route[0]! },
			...route
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		expect(result.state.players.a!.chain).toEqual(route);
	});

	it('rejects a color switch before the five-monster streak', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const route = ['m0', 'm1', 'm2', 'm17', 'm32'];
		const origin = state.arena.monsters.m16!;
		state.players.a!.cellId = origin.id;
		state.players.a!.position = { ...origin.position };
		origin.alive = false;
		for (const id of route.slice(0, 4)) state.arena.monsters[id]!.color = 'gold';
		state.arena.monsters[route[4]!]!.color = 'cyan';

		const result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: route[0]! },
			...route
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		expect(result.state.players.a!.chain).toEqual(route.slice(0, 4));
	});

	it('backtracks to an earlier monster and allows a different route', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const route = ['m0', 'm1', 'm2', 'm17', 'm32'];
		const origin = state.arena.monsters.m16!;
		state.players.a!.cellId = origin.id;
		state.players.a!.position = { ...origin.position };
		origin.alive = false;
		for (const id of [...route, 'm18']) state.arena.monsters[id]!.color = 'coral';
		state.arena.monsters.m33!.color = 'cyan';

		let result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: route[0]! },
			...route
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		result = stepGame(result.state, [
			{ type: 'chain-extend', playerId: 'a', monsterId: 'm2' },
			{ type: 'chain-extend', playerId: 'a', monsterId: 'm18' },
			{ type: 'chain-extend', playerId: 'a', monsterId: 'm33' }
		]);

		expect(result.state.players.a!.chain).toEqual(['m0', 'm1', 'm2', 'm18']);
	});

	it('extends and charges from an adjacent path beyond the starting reach', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const route = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
		const origin = state.arena.monsters.m16!;
		state.players.a!.cellId = origin.id;
		state.players.a!.position = { ...origin.position };
		origin.alive = false;
		for (const id of route) state.arena.monsters[id]!.color = 'coral';
		expect(
			Math.hypot(
				state.arena.monsters.m7!.position.x - origin.position.x,
				state.arena.monsters.m7!.position.y - origin.position.y
			)
		).toBeGreaterThan(state.players.a!.reach);
		let result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: route[0]! },
			...route
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		expect(result.state.players.a!.chain).toEqual(route);
		result = stepGame(result.state, [{ type: 'chain-commit', playerId: 'a' }]);
		expect(result.state.players.a!.cellId).toBe('m7');
		expect(result.state.players.a!.score).toBe(route.length);
		expect(result.state.players.a!.power).toBe(state.config.initialPower + route.length * 5);
	});

	it('scores and charges power from a valid minimum chain', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const chain = connectedChain(state);
		placePlayerBesideChain(state, 'a', chain);
		const origin = { ...state.players.a!.position };
		const destination = { ...state.arena.monsters[chain[chain.length - 1]!]!.position };
		let result = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: chain[0]! },
			...chain
				.slice(1)
				.map((monsterId) => ({ type: 'chain-extend' as const, playerId: 'a', monsterId }))
		]);
		result = stepGame(result.state, [{ type: 'chain-commit', playerId: 'a' }]);
		expect(result.state.players.a!.score).toBe(3);
		expect(result.state.players.a!.power).toBe(state.config.initialPower + 15);
		expect(result.state.players.a!.position).toEqual(destination);
		expect(result.state.players.a!.chain).toEqual([]);
		expect(result.events).toContainEqual(
			expect.objectContaining({
				type: 'chain-committed',
				playerId: 'a',
				origin,
				monsterIds: chain
			})
		);
		expect(chain.every((id) => !result.state.arena.monsters[id]!.alive)).toBe(true);
	});

	it('reports the score before the chain so clients can show evolutions', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const chain = connectedChain(state, 5);
		Object.assign(state.players.a!, { score: 20, power: 120, chain, mode: 'chaining' });
		const result = stepGame(state, [{ type: 'chain-commit', playerId: 'a' }]);
		expect(result.state.players.a!.score).toBe(25);
		expect(result.state.players.a!.power).toBe(145);
		expect(result.events).toContainEqual(
			expect.objectContaining({
				type: 'chain-committed',
				value: 5,
				powerGained: 25,
				powerSpent: 0,
				scoreBefore: 20
			})
		);
	});

	it('requires a chain to begin on a cell adjacent to the character', () => {
		const state = createGame({ seed: 7, players: [{ id: 'a' }] });
		const origin = state.arena.monsters[state.players.a!.cellId]!;
		const distant = Object.values(state.arena.monsters).find(
			(monster) => monster.alive && !origin.neighborIds.includes(monster.id)
		)!;
		const result = stepGame(state, [{ type: 'chain-start', playerId: 'a', monsterId: distant.id }]);
		expect(result.state.players.a!.chain).toEqual([]);
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
			{ type: 'chain-commit', playerId: 'a', sequence: 1 },
			{ type: 'chain-commit', playerId: 'b', sequence: 2 }
		]);
		expect(result.state.players.a!.power).toBe(state.config.initialPower + 15);
		expect(result.state.players.b!.score).toBe(0);
		expect(
			result.events.some((event) => event.type === 'chain-truncated' && event.playerId === 'b')
		).toBe(true);
	});

	it('spends one shot of power on a traveling shot and skill-parries it', () => {
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
		expect(result.state.players.a!.power).toBe(25);
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
		Object.assign(state.players.a!, { position: { x: 200, y: 200 }, power: 120, score: 400 });
		Object.assign(state.players.b!, {
			position: { x: 260, y: 200 },
			protectedUntilMs: 0,
			score: 100,
			health: 20
		});
		let result = stepGame(state, [{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }], 50);
		expect(result.state.players.b!.mode).toBe('dead');
		expect(result.state.players.b!.score).toBe(80);
		expect(result.events).toContainEqual({
			type: 'player-died',
			playerId: 'b',
			byPlayerId: 'a',
			scoreLost: 20,
			knockoutScore: 10
		});
		expect(result.state.players.a!.score).toBe(410);
		result = stepGame(result.state, [], 2_000);
		expect(result.state.players.b!.mode).toBe('neutral');
		expect(result.state.players.b!.protectedUntilMs).toBeGreaterThan(result.state.timeMs);
	});

	it('fully heals a knockout scorer whose bonus evolves the hero', () => {
		const state = createGame({ players: [{ id: 'a' }, { id: 'b' }] });
		Object.assign(state.players.a!, {
			position: { x: 200, y: 200 },
			power: 120,
			score: 45,
			health: 30
		});
		Object.assign(state.players.b!, {
			position: { x: 260, y: 200 },
			protectedUntilMs: 0,
			health: 20
		});
		const result = stepGame(
			state,
			[{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }],
			50
		);
		expect(result.state.players.a!.score).toBe(55);
		expect(result.state.players.a!.health).toBe(result.state.players.a!.maxHealth);
	});
});
