import { describe, expect, it } from 'vitest';
import { createGame } from '$lib/game';
import {
	cleanPlayerName,
	createRoomCode,
	isGameIntent,
	normalizeRoomCode,
	playerSetupsForRoster,
	rosterFromPresence
} from './realtimeRoom';

describe('Realtime room protocol', () => {
	it('creates readable six-character room codes deterministically', () => {
		expect(createRoomCode(new Uint32Array([0, 1, 2, 3, 4, 5]))).toBe('234567');
		expect(normalizeRoomCode(' ab-cd 9! ')).toBe('ABCD9');
	});

	it('normalizes callsigns and presence into one stable roster entry per player', () => {
		expect(cleanPlayerName('   Cave    Runner   ')).toBe('Cave Runner');
		const roster = rosterFromPresence({
			first: [
				{ playerId: 'guest', name: 'Guest', role: 'guest', joinedAt: 20 },
				{ playerId: 'guest', name: 'Second tab', role: 'guest', joinedAt: 30 }
			],
			host: [{ playerId: 'host', name: 'Host', role: 'host', joinedAt: 10 }],
			junk: [{ playerId: 17 }]
		});

		expect(roster).toEqual([
			{ playerId: 'host', name: 'Host', role: 'host', joinedAt: 10 },
			{ playerId: 'guest', name: 'Guest', role: 'guest', joinedAt: 20 }
		]);
	});

	it('fills unused arena seats with ordinary deterministic bots', () => {
		const players = playerSetupsForRoster(
			[
				{ playerId: 'host', name: 'Host', role: 'host', joinedAt: 1 },
				{ playerId: 'guest', name: 'Guest', role: 'guest', joinedAt: 2 }
			],
			4
		);

		expect(players).toEqual([
			{ id: 'host', name: 'Host', isBot: false },
			{ id: 'guest', name: 'Guest', isBot: false },
			{ id: 'bot-1', name: 'Bot 1', isBot: true },
			{ id: 'bot-2', name: 'Bot 2', isBot: true }
		]);
	});

	it('rejects malformed or non-finite network intents', () => {
		expect(isGameIntent({ type: 'parry', playerId: 'p1' })).toBe(true);
		expect(isGameIntent({ type: 'fire', playerId: 'p1', direction: { x: 1, y: Number.NaN } })).toBe(
			false
		);
		expect(isGameIntent({ type: 'chain-commit', playerId: 'p1', conversion: 'steal' })).toBe(false);
	});

	it('keeps a full eight-player snapshot inside the Realtime payload budget', () => {
		const state = createGame({ botCount: 7 });
		const bytes = new TextEncoder().encode(JSON.stringify({ hostId: 'host', state })).byteLength;
		expect(bytes).toBeLessThan(200_000);
	});
});
