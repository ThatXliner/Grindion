import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { GameEvent, GameIntent, GameState, PlayerSetup } from '$lib/game';

export type RoomRole = 'host' | 'guest';

export type RoomMember = {
	playerId: string;
	name: string;
	role: RoomRole;
	joinedAt: number;
};

export type RoomConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export type RealtimeRoomCallbacks = {
	onConnection?: (state: RoomConnectionState, message?: string) => void;
	onRoster?: (members: RoomMember[]) => void;
	onIntent?: (intent: GameIntent) => void;
	onStart?: (state: GameState) => void;
	onSnapshot?: (state: GameState, events: GameEvent[]) => void;
};

type IntentEnvelope = {
	playerId: string;
	sequence: number;
	intent: GameIntent;
};

type StateEnvelope = {
	hostId: string;
	state: GameState;
	events?: GameEvent[];
};

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 18;

export function normalizeRoomCode(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, ROOM_CODE_LENGTH);
}

export function createRoomCode(randomValues?: Uint32Array): string {
	const values = randomValues ?? crypto.getRandomValues(new Uint32Array(ROOM_CODE_LENGTH));
	return Array.from(values.slice(0, ROOM_CODE_LENGTH), (value) =>
		ROOM_ALPHABET.charAt(value % ROOM_ALPHABET.length)
	).join('');
}

export function cleanPlayerName(value: string): string {
	const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
	return cleaned || 'Wanderer';
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isGameIntent(value: unknown): value is GameIntent {
	if (!isObject(value) || typeof value.playerId !== 'string' || typeof value.type !== 'string')
		return false;
	switch (value.type) {
		case 'chain-start':
		case 'chain-extend':
			return typeof value.monsterId === 'string';
		case 'chain-commit':
			return value.conversion === 'score' || value.conversion === 'power';
		case 'chain-cancel':
		case 'parry':
			return true;
		case 'fire':
			return (
				isObject(value.direction) &&
				typeof value.direction.x === 'number' &&
				Number.isFinite(value.direction.x) &&
				typeof value.direction.y === 'number' &&
				Number.isFinite(value.direction.y)
			);
		default:
			return false;
	}
}

export function isGameState(value: unknown): value is GameState {
	return (
		isObject(value) &&
		typeof value.seed === 'number' &&
		typeof value.tick === 'number' &&
		typeof value.timeMs === 'number' &&
		isObject(value.players) &&
		isObject(value.arena) &&
		isObject(value.projectiles)
	);
}

function isGameEvent(value: unknown): value is GameEvent {
	if (!isObject(value) || typeof value.type !== 'string') return false;
	if (value.type === 'round-ended') return true;
	if (typeof value.playerId !== 'string') return false;
	switch (value.type) {
		case 'chain-committed':
			return (
				(value.conversion === 'score' || value.conversion === 'power') &&
				typeof value.length === 'number' &&
				typeof value.value === 'number' &&
				isObject(value.origin) &&
				Array.isArray(value.monsterIds) &&
				value.monsterIds.every((id) => typeof id === 'string')
			);
		case 'chain-truncated':
			return typeof value.length === 'number';
		case 'projectile-fired':
			return typeof value.projectileId === 'string' && typeof value.power === 'number';
		case 'projectile-parried':
			return typeof value.projectileId === 'string';
		case 'player-damaged':
			return typeof value.byPlayerId === 'string' && typeof value.damage === 'number';
		case 'player-died':
			return typeof value.byPlayerId === 'string' && typeof value.scoreLost === 'number';
		case 'player-respawned':
			return true;
		default:
			return false;
	}
}

function parseMember(value: unknown): RoomMember | null {
	if (
		!isObject(value) ||
		typeof value.playerId !== 'string' ||
		typeof value.name !== 'string' ||
		(value.role !== 'host' && value.role !== 'guest') ||
		typeof value.joinedAt !== 'number'
	)
		return null;
	return {
		playerId: value.playerId,
		name: cleanPlayerName(value.name),
		role: value.role,
		joinedAt: value.joinedAt
	};
}

export function rosterFromPresence(state: Record<string, unknown>): RoomMember[] {
	const byPlayer = new Map<string, RoomMember>();
	for (const presences of Object.values(state)) {
		if (!Array.isArray(presences)) continue;
		for (const value of presences) {
			const member = parseMember(value);
			if (!member) continue;
			const existing = byPlayer.get(member.playerId);
			if (!existing || member.joinedAt < existing.joinedAt) byPlayer.set(member.playerId, member);
		}
	}
	return [...byPlayer.values()].sort(
		(a, b) => a.joinedAt - b.joinedAt || a.playerId.localeCompare(b.playerId)
	);
}

export function playerSetupsForRoster(members: RoomMember[], targetPlayers = 8): PlayerSetup[] {
	const humans = members.slice(0, targetPlayers).map((member) => ({
		id: member.playerId,
		name: member.name,
		isBot: false
	}));
	return [
		...humans,
		...Array.from({ length: Math.max(0, targetPlayers - humans.length) }, (_, index) => ({
			id: `bot-${index + 1}`,
			name: `Bot ${index + 1}`,
			isBot: true
		}))
	];
}

function payloadOf(value: unknown): unknown {
	return isObject(value) && 'payload' in value ? value.payload : undefined;
}

export class RealtimeRoom {
	readonly code: string;
	readonly member: RoomMember;

	private readonly channel: RealtimeChannel;
	private readonly callbacks: RealtimeRoomCallbacks;
	private roster: RoomMember[] = [];
	private sendSequence = 0;
	private readonly receivedSequences = new Map<string, number>();
	private latestTick = -1;
	private closed = false;

	private constructor(
		private readonly supabase: SupabaseClient,
		code: string,
		member: RoomMember,
		callbacks: RealtimeRoomCallbacks
	) {
		this.code = code;
		this.member = member;
		this.callbacks = callbacks;
		this.channel = supabase.channel(`grindion:${code}`, {
			config: {
				broadcast: { ack: true, self: false },
				presence: { key: member.playerId, enabled: true }
			}
		});
	}

	static async connect(options: {
		supabase: SupabaseClient;
		code: string;
		playerId: string;
		name: string;
		role: RoomRole;
		callbacks?: RealtimeRoomCallbacks;
	}): Promise<RealtimeRoom> {
		const code = normalizeRoomCode(options.code);
		if (code.length !== ROOM_CODE_LENGTH) throw new Error('Room codes are six characters.');
		const room = new RealtimeRoom(
			options.supabase,
			code,
			{
				playerId: options.playerId,
				name: cleanPlayerName(options.name),
				role: options.role,
				joinedAt: Date.now()
			},
			options.callbacks ?? {}
		);
		await room.subscribe();
		return room;
	}

	get members(): RoomMember[] {
		return [...this.roster];
	}

	private subscribe(): Promise<void> {
		this.callbacks.onConnection?.('connecting');
		this.channel
			.on('presence', { event: 'sync' }, () => {
				this.roster = rosterFromPresence(
					this.channel.presenceState() as unknown as Record<string, unknown>
				);
				this.callbacks.onRoster?.([...this.roster]);
			})
			.on('broadcast', { event: 'intent' }, (message) => this.receiveIntent(payloadOf(message)))
			.on('broadcast', { event: 'start' }, (message) => this.receiveState(payloadOf(message), true))
			.on('broadcast', { event: 'snapshot' }, (message) =>
				this.receiveState(payloadOf(message), false)
			);

		return new Promise((resolve, reject) => {
			let settled = false;
			this.channel.subscribe(async (status, error) => {
				if (status === 'SUBSCRIBED') {
					const result = await this.channel.track(this.member);
					if (result !== 'ok') {
						const message = `Presence failed: ${result}`;
						this.callbacks.onConnection?.('error', message);
						if (!settled) reject(new Error(message));
						settled = true;
						return;
					}
					this.callbacks.onConnection?.('connected');
					if (!settled) resolve();
					settled = true;
				} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
					const message = error?.message ?? `Realtime channel ${status.toLowerCase()}`;
					this.callbacks.onConnection?.('error', message);
					if (!settled) reject(new Error(message));
					settled = true;
				} else if (status === 'CLOSED' && !this.closed) {
					this.callbacks.onConnection?.('disconnected', 'Realtime channel closed.');
				}
			});
		});
	}

	private receiveIntent(value: unknown): void {
		if (this.member.role !== 'host' || !isObject(value)) return;
		const envelope = value as Partial<IntentEnvelope>;
		const sequence = envelope.sequence;
		if (
			typeof envelope.playerId !== 'string' ||
			typeof sequence !== 'number' ||
			!Number.isSafeInteger(sequence) ||
			sequence < 0 ||
			!isGameIntent(envelope.intent) ||
			!this.roster.some((member) => member.playerId === envelope.playerId)
		)
			return;
		const previous = this.receivedSequences.get(envelope.playerId) ?? -1;
		if (sequence <= previous) return;
		this.receivedSequences.set(envelope.playerId, sequence);
		this.callbacks.onIntent?.({ ...envelope.intent, playerId: envelope.playerId } as GameIntent);
	}

	private receiveState(value: unknown, starting: boolean): void {
		if (this.member.role !== 'guest' || !isObject(value)) return;
		const envelope = value as Partial<StateEnvelope>;
		const host = this.roster.find((member) => member.role === 'host');
		if (
			typeof envelope.hostId !== 'string' ||
			envelope.hostId !== host?.playerId ||
			!isGameState(envelope.state) ||
			(!starting && envelope.state.tick < this.latestTick) ||
			!envelope.state.players[this.member.playerId]
		)
			return;
		this.latestTick = envelope.state.tick;
		if (starting) this.callbacks.onStart?.(envelope.state);
		else
			this.callbacks.onSnapshot?.(
				envelope.state,
				Array.isArray(envelope.events) ? envelope.events.filter(isGameEvent) : []
			);
	}

	async sendIntent(intent: GameIntent): Promise<void> {
		if (this.member.role !== 'guest' || this.closed) return;
		const result = await this.channel.send({
			type: 'broadcast',
			event: 'intent',
			payload: {
				playerId: this.member.playerId,
				sequence: ++this.sendSequence,
				intent: { ...intent, playerId: this.member.playerId }
			} satisfies IntentEnvelope
		});
		if (result !== 'ok') this.callbacks.onConnection?.('error', `Intent send failed: ${result}`);
	}

	async start(state: GameState): Promise<void> {
		if (this.member.role !== 'host' || this.closed) return;
		this.latestTick = state.tick;
		await this.sendState('start', state, []);
	}

	async publish(state: GameState, events: GameEvent[]): Promise<void> {
		if (this.member.role !== 'host' || this.closed || state.tick <= this.latestTick) return;
		this.latestTick = state.tick;
		await this.sendState('snapshot', state, events);
	}

	private async sendState(event: 'start' | 'snapshot', state: GameState, events: GameEvent[]) {
		const result = await this.channel.send({
			type: 'broadcast',
			event,
			payload: {
				hostId: this.member.playerId,
				state,
				...(events.length ? { events } : {})
			} satisfies StateEnvelope
		});
		if (result !== 'ok') this.callbacks.onConnection?.('error', `Snapshot send failed: ${result}`);
	}

	async disconnect(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.channel.untrack();
		await this.supabase.removeChannel(this.channel);
		this.callbacks.onConnection?.('disconnected');
	}
}
