import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = 8787;
const WAITING_ROOM_TTL_MS = 90_000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let waitingRoom = null;

function createRoomCode() {
	const bytes = randomBytes(6);
	return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

function json(response, status, body) {
	response.writeHead(status, {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
		'X-Content-Type-Options': 'nosniff'
	});
	response.end(JSON.stringify(body));
}

async function readJson(request) {
	let body = '';
	for await (const chunk of request) {
		body += chunk;
		if (body.length > 2048) throw new Error('Request body is too large.');
	}
	return body ? JSON.parse(body) : {};
}

function isPlayerId(value) {
	return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

createServer(async (request, response) => {
	if (request.method === 'GET' && request.url === '/health') {
		json(response, 200, { ok: true });
		return;
	}

	if (request.method !== 'POST' || request.url !== '/matchmake') {
		json(response, 404, { error: 'Not found.' });
		return;
	}

	try {
		const { playerId, excludeCode } = await readJson(request);
		if (!isPlayerId(playerId)) {
			json(response, 400, { error: 'A valid player ID is required.' });
			return;
		}

		const now = Date.now();
		if (waitingRoom && (waitingRoom.expiresAt <= now || waitingRoom.code === excludeCode)) {
			waitingRoom = null;
		}

		if (waitingRoom?.hostId === playerId) {
			waitingRoom.expiresAt = now + WAITING_ROOM_TTL_MS;
			json(response, 200, { code: waitingRoom.code, role: 'host' });
			return;
		}

		if (waitingRoom) {
			const assignment = { code: waitingRoom.code, role: 'guest' };
			waitingRoom = null;
			json(response, 200, assignment);
			return;
		}

		waitingRoom = {
			code: createRoomCode(),
			hostId: playerId,
			expiresAt: now + WAITING_ROOM_TTL_MS
		};
		json(response, 200, { code: waitingRoom.code, role: 'host' });
	} catch {
		json(response, 400, { error: 'Invalid matchmaking request.' });
	}
}).listen(PORT, '0.0.0.0', () => {
	console.log(`Grindion matchmaker listening on ${PORT}`);
});
