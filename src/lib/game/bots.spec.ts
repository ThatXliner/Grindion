import { describe, expect, it } from 'vitest';
import { createBotController } from './bots';
import { createGame, stepGame } from './engine';

describe('bot controller', () => {
	it('emits only normal intents at a throttled cadence and is deterministic', () => {
		const state = createGame({ seed: 99, botCount: 2 });
		const one = createBotController(5),
			two = createBotController(5);
		expect(one.update(state)).toEqual(two.update(state));
		expect(one.update(stepGame(state, [], 50).state)).toEqual([]);
	});

	it('waits the configured think time between decisions', () => {
		let state = createGame({ seed: 99, botCount: 2 });
		const controller = createBotController(5, { thinkMs: 400 });
		expect(controller.update(state)).not.toEqual([]);
		for (let elapsed = 50; elapsed < 400; elapsed += 50) {
			state = stepGame(state, [], 50).state;
			expect(controller.update(state)).toEqual([]);
		}
		state = stepGame(state, [], 50).state;
		expect(controller.update(state)).not.toEqual([]);
	});

	it('plays through ordinary intent processing', () => {
		let state = createGame({ seed: 14, botCount: 7 });
		const controller = createBotController(14);
		for (let tick = 0; tick < 400; tick++)
			state = stepGame(state, controller.update(state), 50).state;
		const bots = Object.values(state.players).filter((player) => player.isBot);
		expect(bots.some((bot) => bot.score > 0 || bot.power > state.config.initialPower)).toBe(true);
	});
});
