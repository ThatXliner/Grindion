import { createGame, stepGame } from '../game/engine';
import { createBotController } from '../game/bots';
import type { GameEvent, GameIntent, GameState } from '../game/types';

/** One server-owned arena, including human seats and the bots filling every empty seat. */
export class ArenaRoom {
	state: GameState;
	private bots = createBotController();
	private intents: GameIntent[] = [];
	private endedForMs = 0;

	constructor(seed: number) {
		this.state = createGame({
			seed,
			players: Array.from({ length: 8 }, (_, i) => ({
				id: `bot-${i + 1}`,
				name: `Bot ${i + 1}`,
				isBot: true
			}))
		});
	}

	get humanCount() {
		return Object.values(this.state.players).filter((p) => !p.isBot).length;
	}

	join(id: string, name: string): boolean {
		const seat = Object.values(this.state.players).find((p) => p.isBot);
		if (!seat) return false;
		const fresh = createGame({ players: [{ id, name }] }).players[id]!;
		this.removeProjectiles(seat.id);
		delete this.state.players[seat.id];
		this.state.players[id] = {
			...fresh,
			color: seat.color,
			cellId: seat.cellId,
			position: { ...seat.position },
			protectedUntilMs: this.state.timeMs + this.state.config.spawnProtectionMs
		};
		return true;
	}

	leave(id: string) {
		const player = this.state.players[id];
		if (!player) return;
		player.isBot = true;
		player.name = 'Bot';
		player.chain = [];
		if (player.mode === 'chaining') player.mode = 'neutral';
		this.intents = this.intents.filter((intent) => intent.playerId !== id);
	}

	queue(id: string, intent: GameIntent) {
		if (
			this.state.players[id]?.isBot !== false ||
			this.intents.filter((i) => i.playerId === id).length >= 32
		)
			return;
		this.intents.push({ ...intent, playerId: id });
	}

	tick(): { events: GameEvent[]; restarted: boolean } {
		if (this.state.roundEnded) {
			this.endedForMs += 50;
			if (this.endedForMs < 3000) return { events: [], restarted: false };
			const players = Object.values(this.state.players).map(({ id, name, isBot }) => ({
				id,
				name,
				isBot
			}));
			this.state = createGame({ seed: this.state.seed + 1, players });
			this.bots.reset();
			this.intents = [];
			this.endedForMs = 0;
			return { events: [], restarted: true };
		}
		const result = stepGame(this.state, [...this.intents, ...this.bots.update(this.state)], 50);
		this.intents = [];
		this.state = result.state;
		return { events: result.events, restarted: false };
	}

	private removeProjectiles(id: string) {
		for (const [key, projectile] of Object.entries(this.state.projectiles)) {
			if (projectile.ownerId === id) delete this.state.projectiles[key];
		}
	}
}
