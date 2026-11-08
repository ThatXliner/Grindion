import { describe, expect, it } from 'vitest';
import { createGame, stepGame } from './engine';
import { createBotController } from './bots';
import { createChainMotionTiming } from './chainMotion';
import type { GameIntent, GameState } from './types';

function duel() {
	const state = createGame({ players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
	state.timeMs = 3000;
	for (const [id, cellId] of [
		['a', 'm0'],
		['b', 'm4'],
		['c', 'm18']
	] as const) {
		const cell = state.arena.monsters[cellId]!;
		cell.alive = false;
		Object.assign(state.players[id]!, {
			cellId,
			position: { ...cell.position },
			protectedUntilMs: 0
		});
	}
	for (const id of ['m1', 'm2', 'm3']) state.arena.monsters[id]!.color = 'coral';
	return state;
}

function commit(state = duel()) {
	const intents: GameIntent[] = [
		{ type: 'chain-start', playerId: 'a', monsterId: 'm1' },
		{ type: 'chain-extend', playerId: 'a', monsterId: 'm2' },
		{ type: 'chain-extend', playerId: 'a', monsterId: 'm3' },
		{ type: 'chain-target', playerId: 'a', targetId: 'b' },
		{ type: 'chain-commit', playerId: 'a' }
	];
	return stepGame(state, intents);
}

function land(state: GameState, intents: GameIntent[] = []) {
	const strike = Object.values(state.chainStrikes)[0]!;
	return stepGame(state, intents, strike.hitAtMs - state.timeMs);
}

describe('chain finishers', () => {
	it('stops on the final monster, spends one shot of Power, and telegraphs before dealing damage', () => {
		const initial = duel();
		const { state } = commit(initial);
		const strike = Object.values(state.chainStrikes)[0]!;
		expect(initial.players.a!.cellId).toBe('m0');
		expect(state.players.a!.cellId).toBe('m3');
		expect(state.players.b!.cellId).toBe('m4');
		expect(state.players.a!.power).toBe(15);
		expect(state.players.a!.mode).toBe('striking');
		expect(state.players.b!.health).toBe(100);
		expect(strike.hitAtMs - state.timeMs).toBe(createChainMotionTiming(3).totalMs + 600);
		const early = stepGame(state, [], strike.hitAtMs - state.timeMs - 1);
		expect(early.state.players.b!.health).toBe(100);
		const hit = stepGame(early.state, [], 1);
		expect(hit.state.players.b!.health).toBe(80);
		expect(hit.state.players.a!.mode).toBe('neutral');
		expect(hit.state.chainStrikes).toEqual({});
	});

	it('allows a parry arriving on the impact tick and staggers the attacker', () => {
		const result = land(commit().state, [{ type: 'parry', playerId: 'b' }]);
		expect(result.state.players.b!.health).toBe(100);
		expect(result.state.players.a!.mode).toBe('hit');
		expect(result.state.players.a!.hitUntilMs).toBe(result.state.timeMs + 400);
		expect(result.events).toContainEqual(
			expect.objectContaining({ type: 'chain-strike-ended', outcome: 'parried' })
		);
	});

	it('does not home after the victim chains away', () => {
		const { state } = commit();
		for (const id of ['m5', 'm6', 'm7']) state.arena.monsters[id]!.color = 'cyan';
		const escaped = stepGame(state, [
			{ type: 'chain-start', playerId: 'b', monsterId: 'm5' },
			{ type: 'chain-extend', playerId: 'b', monsterId: 'm6' },
			{ type: 'chain-extend', playerId: 'b', monsterId: 'm7' },
			{ type: 'chain-commit', playerId: 'b' }
		]);
		const result = land(escaped.state);
		expect(result.state.players.b!.cellId).toBe('m7');
		expect(result.state.players.b!.health).toBe(escaped.state.players.b!.health);
		expect(result.events).toContainEqual(
			expect.objectContaining({ type: 'chain-strike-ended', outcome: 'missed' })
		);
	});

	it('requires Power before the chain and respects protected targets', () => {
		for (const scenario of ['empty', 'protected', 'distant'] as const) {
			const state = duel();
			if (scenario === 'empty') state.players.a!.power = 0;
			if (scenario === 'protected') state.players.b!.protectedUntilMs = 10000;
			if (scenario === 'distant') state.players.b!.cellId = 'm100';
			const result = commit(state);
			expect(result.state.chainStrikes).toEqual({});
			expect(result.state.players.a!.power).toBe(scenario === 'empty' ? 15 : 30);
		}
	});

	it('locks attacker actions and cancels an attack when the attacker is hit', () => {
		const { state } = commit();
		const blocked = stepGame(state, [
			{ type: 'chain-start', playerId: 'a', monsterId: 'm2' },
			{ type: 'parry', playerId: 'a' },
			{ type: 'fire', playerId: 'a', direction: { x: 1, y: 0 } }
		]);
		expect(blocked.state.players.a!.mode).toBe('striking');
		expect(blocked.state.projectiles).toEqual({});
		const attacker = blocked.state.players.a!;
		blocked.state.projectiles.hit = {
			id: 'hit',
			ownerId: 'c',
			position: { ...attacker.position },
			velocity: { x: 0, y: 0 },
			power: 20,
			radius: 10,
			expiresAtMs: 10000
		};
		const interrupted = stepGame(blocked.state);
		expect(interrupted.state.chainStrikes).toEqual({});
		expect(interrupted.state.players.a!.health).toBe(attacker.health - 20);
		expect(interrupted.state.players.b!.health).toBe(100);
		expect(interrupted.events).toContainEqual(
			expect.objectContaining({ type: 'chain-strike-ended', outcome: 'interrupted' })
		);
	});

	it('allows only one pending finisher on each victim', () => {
		const { state } = commit();
		for (const id of ['m19', 'm20', 'm5']) state.arena.monsters[id]!.color = 'coral';
		const result = stepGame(state, [
			{ type: 'chain-start', playerId: 'c', monsterId: 'm19' },
			{ type: 'chain-extend', playerId: 'c', monsterId: 'm20' },
			{ type: 'chain-extend', playerId: 'c', monsterId: 'm5' },
			{ type: 'chain-target', playerId: 'c', targetId: 'b' },
			{ type: 'chain-commit', playerId: 'c' }
		]);
		expect(Object.values(result.state.chainStrikes)).toHaveLength(1);
		expect(result.state.players.c!.power).toBe(30);
	});

	it('lets bots recognize and parry an incoming finisher', () => {
		const { state } = commit();
		state.players.b!.isBot = true;
		state.timeMs = Object.values(state.chainStrikes)[0]!.hitAtMs - 100;
		const controller = createBotController(1, { parryChance: 1, thinkMs: 50 });
		const intents = controller.update(state);
		expect(intents).toContainEqual({ type: 'parry', playerId: 'b' });
		expect(land(state, intents).state.players.b!.health).toBe(100);
	});

	it('clears targeting when backtracking in the same tick', () => {
		const state = duel();
		state.players.a!.chain = ['m1', 'm2', 'm3'];
		state.players.a!.mode = 'chaining';
		const result = stepGame(state, [
			{ type: 'chain-target', playerId: 'a', targetId: 'b' },
			{ type: 'chain-extend', playerId: 'a', monsterId: 'm2' }
		]);
		expect(result.state.players.a!.chainTargetId).toBeNull();
		expect(result.state.players.a!.chain).toEqual(['m1', 'm2']);
	});

	it('does not land after round end and keeps kill credit for lethal strikes', () => {
		const state = commit().state;
		state.roundEndsAtMs = state.timeMs + 100;
		expect(land(state).state.players.b!.health).toBe(100);
		const lethal = commit().state;
		lethal.players.b!.health = 10;
		const result = land(lethal);
		expect(result.state.players.b!.mode).toBe('dead');
		expect(result.state.players.a!.kills).toBe(1);
	});
});
