import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { ArenaRoom } from '../src/lib/server/arena';
import { compactSnapshot } from '../src/lib/online/snapshot';
import { cleanPlayerName, isGameIntent } from '../src/lib/supabase/realtimeRoom';
import type { GameEvent } from '../src/lib/game/types';

const port = Number(process.env.PORT ?? 8788);
const rooms = new Map<
	string,
	{ arena: ArenaRoom; clients: Map<WebSocket, string>; events: GameEvent[]; emptySince: number }
>();
const server = createServer((request, response) => {
	response.writeHead(request.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify({ ok: request.url === '/health' }));
});
const wss = new WebSocketServer({ server, path: '/arena', maxPayload: 4096 });

function send(socket: WebSocket, value: unknown) {
	sendRaw(socket, JSON.stringify(value));
}

function sendRaw(socket: WebSocket, payload: string) {
	if (socket.readyState !== WebSocket.OPEN) return;
	if (socket.bufferedAmount > 1_000_000) {
		socket.terminate();
		return;
	}
	socket.send(payload);
}

wss.on('connection', (socket, request) => {
	const url = new URL(request.url!, 'http://localhost');
	try {
		if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
			socket.close(1008, 'Unexpected origin.');
			return;
		}
	} catch {
		socket.close(1008, 'Invalid origin.');
		return;
	}

	const requestedCode = url.searchParams.get('arena');
	if (requestedCode && !/^[A-Z2-9]{6}$/.test(requestedCode)) {
		socket.close(1008, 'Invalid arena code.');
		return;
	}
	const name = cleanPlayerName(url.searchParams.get('name') ?? 'Wanderer');
	const available = [...rooms].find(([, room]) => room.arena.humanCount < 8);
	const code =
		requestedCode ??
		available?.[0] ??
		randomBytes(3).toString('hex').toUpperCase().replace(/[01]/g, 'A');
	let room = rooms.get(code);
	if (!room) {
		if (rooms.size >= 128) {
			socket.close(1013, 'Arenas are busy. Try again shortly.');
			return;
		}
		room = {
			arena: new ArenaRoom(randomBytes(4).readInt32LE()),
			clients: new Map(),
			events: [],
			emptySince: Date.now()
		};
		rooms.set(code, room);
	}
	const id = randomUUID();
	if (!room.arena.join(id, name)) {
		socket.close(1013, 'This arena is full.');
		return;
	}
	room.clients.set(socket, id);
	const activeRoom = room;
	send(socket, { type: 'start', code, playerId: id, state: room.arena.state });
	let windowStart = Date.now(),
		messages = 0;
	socket.on('message', (data) => {
		if (Date.now() - windowStart >= 1000) {
			windowStart = Date.now();
			messages = 0;
		}
		if (++messages > 150) {
			socket.close(1008, 'Too many actions.');
			return;
		}
		try {
			const value = JSON.parse(data.toString());
			if (value && isGameIntent({ ...value, playerId: id }))
				activeRoom.arena.queue(id, { ...value, playerId: id });
		} catch {
			socket.close(1008, 'Invalid action.');
		}
	});
	socket.on('error', () => socket.terminate());
	socket.on('close', () => {
		activeRoom.clients.delete(socket);
		activeRoom.arena.leave(id);
		if (!activeRoom.clients.size) activeRoom.emptySince = Date.now();
	});
});

setInterval(() => {
	for (const [code, room] of rooms) {
		if (!room.clients.size && Date.now() - room.emptySince > 60_000) {
			rooms.delete(code);
			continue;
		}
		const result = room.arena.tick();
		room.events.push(...result.events);
		if (!result.restarted && room.arena.state.tick % 2) continue;
		if (result.restarted) {
			for (const [socket, playerId] of room.clients)
				send(socket, { type: 'start', code, playerId, state: room.arena.state });
		} else {
			// The board itself went out with `start`; snapshots carry only what changes.
			const payload = JSON.stringify({
				type: 'snapshot',
				code,
				state: compactSnapshot(room.arena.state),
				events: room.events
			});
			for (const socket of room.clients.keys()) sendRaw(socket, payload);
		}
		room.events = [];
	}
}, 50);

// Ping detects vanished clients even when the browser cannot send a close frame.
const alive = new WeakSet<WebSocket>();
wss.on('connection', (socket) => {
	alive.add(socket);
	socket.on('pong', () => alive.add(socket));
});
setInterval(() => {
	for (const socket of wss.clients) {
		if (!alive.has(socket)) {
			socket.terminate();
			continue;
		}
		alive.delete(socket);
		socket.ping();
	}
}, 15_000);
server.listen(port, '0.0.0.0', () => console.log(`Grindion arena server listening on ${port}`));
