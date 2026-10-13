import { describe, expect, it } from 'vitest';
import { ArenaRoom } from './arena';

describe('server arena seats and lifecycle', () => {
	it('starts with eight bots and replaces them with fresh humans without restarting the board', () => {
		const room = new ArenaRoom(14);
		for (let i = 0; i < 40; i++) room.tick();
		const before = room.state.tick;
		expect(room.join('a', 'Alice')).toBe(true);
		expect(room.humanCount).toBe(1);
		expect(Object.values(room.state.players).filter((p) => p.isBot)).toHaveLength(7);
		expect(room.state.tick).toBe(before);
		expect(room.state.players.a!.score).toBe(0);
		room.join('b', 'Bob');
		room.leave('a');
		room.tick();
		expect(room.state.players.a!.isBot).toBe(true);
		expect(room.state.players.b!.isBot).toBe(false);
		expect(Object.values(room.state.players)).toHaveLength(8);
		expect(room.state.tick).toBeGreaterThan(before);
	});

	it('caps arenas at eight humans', () => {
		const room = new ArenaRoom(14);
		for (let i = 0; i < 8; i++) expect(room.join(`p${i}`, 'Human')).toBe(true);
		expect(room.join('extra', 'Extra')).toBe(false);
	});

	it('binds actions to the connection owner and discards actions from departed players', () => {
		const room = new ArenaRoom(14);
		room.join('a', 'Alice');
		room.join('b', 'Bob');
		room.queue('a', { type: 'parry', playerId: 'b' });
		room.tick();
		expect(room.state.players.a!.power).toBe(10);
		expect(room.state.players.b!.power).toBe(15);
		room.queue('a', { type: 'parry', playerId: 'a' });
		room.leave('a');
		expect(room.state.players.a!.isBot).toBe(true);
	});

	it('automatically starts the next round while retaining connected humans', () => {
		const room = new ArenaRoom(14);
		room.join('a', 'Alice');
		room.state.roundEnded = true;
		for (let i = 0; i < 59; i++) expect(room.tick().restarted).toBe(false);
		expect(room.tick().restarted).toBe(true);
		expect(room.state.players.a!.name).toBe('Alice');
		expect(room.state.players.a!.isBot).toBe(false);
		expect(room.state.roundEnded).toBe(false);
		expect(room.state.tick).toBe(0);
	});
});
