import type { GameEvent, GameIntent, GameState } from '../game/types';

type Callbacks = {
	onStart: (state: GameState, playerId: string, code: string) => void;
	onSnapshot: (state: GameState, events: GameEvent[]) => void;
	onDisconnect: (message: string) => void;
};

export class ArenaClient {
	private closed = false;
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
			const timeout = setTimeout(() => {
				client.disconnect();
				reject(new Error('Arena connection timed out. Try again.'));
			}, 15000);
			socket.onmessage = (message) => {
				const value = JSON.parse(message.data);
				if (value.type === 'start') {
					clearTimeout(timeout);
					started = true;
					callbacks.onStart(value.state, value.playerId, value.code);
					resolve(client);
				} else if (value.type === 'snapshot') callbacks.onSnapshot(value.state, value.events ?? []);
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
		if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(intent));
	}

	disconnect() {
		this.closed = true;
		this.socket.close();
	}
}
