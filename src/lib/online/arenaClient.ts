import type { GameEvent, GameIntent, GameState } from '../game/types';
import { expandSnapshot } from './snapshot';

type Callbacks = {
	onStart: (state: GameState, playerId: string, code: string) => void;
	onSnapshot: (state: GameState, events: GameEvent[]) => void;
	onInputProcessed?: (sequence: number) => void;
	onDisconnect: (message: string) => void;
};

export class ArenaClient {
	private closed = false;
	private sequence = 0;
	supportsPrediction = false;
	private constructor(private socket: WebSocket) {}

	static connect(name: string, code: string, callbacks: Callbacks): Promise<ArenaClient> {
		const url = new URL('/api/arena', window.location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		url.searchParams.set('name', name);
		if (code) url.searchParams.set('arena', code);
		const socket = new WebSocket(url);
		const client = new ArenaClient(socket);
		return new Promise((resolve, reject) => {
			let started = false;
			let board: GameState['arena'] | null = null;
			let playerId = '';
			const timeout = setTimeout(() => {
				client.disconnect();
				reject(new Error('Arena connection timed out. Try again.'));
			}, 15000);
			socket.onmessage = (message) => {
				const value = JSON.parse(message.data);
				if (value.type === 'start') {
					clearTimeout(timeout);
					started = true;
					board = value.state.arena;
					playerId = value.playerId;
					callbacks.onStart(value.state, value.playerId, value.code);
					resolve(client);
				} else if (value.type === 'snapshot' && board) {
					client.supportsPrediction = Boolean(value.processedSequences);
					callbacks.onSnapshot(expandSnapshot(value.state, board), value.events ?? []);
					const processed = value.processedSequences?.[playerId];
					if (typeof processed === 'number') callbacks.onInputProcessed?.(processed);
				}
			};
			socket.onclose = (event) => {
				clearTimeout(timeout);
				const message = event.reason || 'Arena connection lost. Rejoin to keep playing.';
				if (!started) reject(new Error(message));
				else if (!client.closed) callbacks.onDisconnect(message);
			};
			socket.onerror = () => {
				if (!started) {
					clearTimeout(timeout);
					client.disconnect();
					reject(new Error('Could not connect to the arena.'));
				}
			};
		});
	}

	sendIntent(intent: GameIntent) {
		if (this.socket.readyState !== WebSocket.OPEN) return;
		const sequence = ++this.sequence;
		this.socket.send(JSON.stringify({ ...intent, sequence }));
		return sequence;
	}

	disconnect() {
		this.closed = true;
		this.socket.close();
	}
}
