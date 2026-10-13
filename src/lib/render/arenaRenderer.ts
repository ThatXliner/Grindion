import {
	arenaGridMetrics,
	createChainMotionTiming,
	grindstoneState,
	maxHealthForScore,
	powerGain,
	sampleChainMotion
} from '$lib/game';
import type {
	ChainMotionTiming,
	GameConfig,
	GameEvent,
	GameState,
	Monster,
	PlayerState
} from '$lib/game';
import { Effects } from './effects';

export type Point = { x: number; y: number };
export type ChainAnimation = {
	playerId: string;
	origin: Point;
	nodes: { id: string; position: Point; color: Monster['color'] }[];
	startedAt: number;
	timing: ChainMotionTiming;
};
export type Camera = { x: number; y: number; scale: number };

export interface Scene {
	game: GameState;
	humanId: string;
	now: number;
	/** Canvas size in CSS pixels. */
	width: number;
	height: number;
	camera: Camera;
	chainAnimations: ReadonlyMap<string, ChainAnimation>;
	tutorialRouteIds: readonly string[];
	/** Monsters the local player may legally add next. */
	legalTargetIds: ReadonlySet<string>;
	/** Label for the "start here" ring around the hero, or null to hide it. */
	startCue: string | null;
	aim: { target: Point; power: number } | null;
	chainPreview: { text: string; color: string } | null;
	/** When true, draws no local-player affordances (title-screen attract mode). */
	spectating: boolean;
}

export const PALETTE = {
	coral: '#ff6b66',
	cyan: '#46d9e8',
	gold: '#ffd25e',
	you: '#ffe36e',
	ink: '#0b0716',
	parchment: '#fff1c4',
	energy: '#7ff3ff',
	danger: '#ff4d5e'
} as const;

const RAINBOW = ['#ff665f', '#ffe36e', '#6be7ac', '#64dce5', '#c293e8'] as const;
export const SPRITE_FRAMES = [
	{ x: 55, y: 185, width: 305, height: 315 },
	{ x: 414, y: 180, width: 300, height: 315 },
	{ x: 760, y: 185, width: 320, height: 305 },
	{ x: 1165, y: 185, width: 230, height: 310 },
	{ x: 1448, y: 235, width: 285, height: 220 },
	{ x: 1740, y: 180, width: 300, height: 330 }
] as const;
export const SPRITE = { hero: 0, coral: 1, cyan: 2, gold: 3, bolt: 4, parry: 5 } as const;
const MONSTER_SIZE = 46;
const FLOOR_MARGIN = 160;

export function colorFor(value: string | undefined): string {
	if (value?.startsWith('#')) return value;
	if (value === 'coral') return PALETTE.coral;
	if (value === 'cyan') return PALETTE.cyan;
	if (value === 'gold') return PALETTE.gold;
	return PALETTE.parchment;
}

export function playerColor(player: PlayerState, humanId: string): string {
	return player.id === humanId ? PALETTE.you : colorFor(player.color);
}

export function animatedPlayerPosition(
	player: PlayerState,
	animations: ReadonlyMap<string, ChainAnimation>,
	now: number
): Point {
	const animation = animations.get(player.id);
	if (!animation?.nodes.length) return player.position;
	const sample = sampleChainMotion(animation.timing, Math.max(0, now - animation.startedAt));
	const eased = 1 - Math.pow(1 - sample.progress, 3);
	const from =
		sample.segment === 0 ? animation.origin : animation.nodes[sample.segment - 1]!.position;
	const to = animation.nodes[sample.segment]!.position;
	return {
		x: from.x + (to.x - from.x) * eased,
		y: from.y + (to.y - from.y) * eased - Math.sin(sample.progress * Math.PI) * 16
	};
}

function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 16777619);
	}
	return (value >>> 0) / 4294967295;
}

function seeded(seed: number) {
	let state = seed >>> 0 || 1;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function easeOutBack(t: number) {
	const c = 1.70158;
	return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** Projects a projectile against a target; returns seconds to closest approach and the miss distance. */
function approach(target: Point, position: Point, velocity: Point) {
	const rx = target.x - position.x;
	const ry = target.y - position.y;
	const speedSquared = velocity.x ** 2 + velocity.y ** 2 || 1;
	const seconds = (rx * velocity.x + ry * velocity.y) / speedSquared;
	const miss = Math.hypot(rx - velocity.x * seconds, ry - velocity.y * seconds);
	return { seconds, miss };
}

export class ArenaRenderer {
	readonly effects = new Effects();
	private sprites: HTMLImageElement | null = null;
	private floor: HTMLCanvasElement | null = null;
	private floorKey = '';
	private monsterBornAt = new Map<string, number>();
	private monsterWasAlive = new Map<string, boolean>();
	private animationHits = new WeakMap<ChainAnimation, number>();
	private lastFrameAt = 0;

	load(src: string) {
		const image = new Image();
		image.src = src;
		this.sprites = image;
	}

	reset() {
		this.effects.clear();
		this.monsterBornAt.clear();
		this.monsterWasAlive.clear();
	}

	handleEvent(event: GameEvent, game: GameState, humanId: string) {
		const fx = this.effects;
		const at = (playerId: string) => game.players[playerId]?.position;
		if (event.type === 'chain-committed') {
			const endpoint = game.arena.monsters[event.monsterIds.at(-1) ?? '']?.position;
			if (!endpoint) return;
			const delay = createChainMotionTiming(event.length).totalMs;
			const player = game.players[event.playerId];
			const isYou = event.playerId === humanId;
			if (event.conversion === 'score')
				fx.float(endpoint, `+${event.value}`, PALETTE.gold, { delay, size: isYou ? 1.2 : 0.8 });
			else
				fx.float(
					endpoint,
					`+${powerGain(event.length, player?.score ?? 0, game.config)} PWR`,
					PALETTE.energy,
					{ delay, size: isYou ? 1.1 : 0.75 }
				);
		} else if (event.type === 'projectile-fired') {
			const origin = at(event.playerId);
			if (!origin) return;
			fx.burst(origin, PALETTE.energy, 12, { speed: 220, gravity: 0, life: 320 });
			fx.ring(origin, PALETTE.energy, { from: 14, to: 52, life: 260 });
			if (event.playerId === humanId) fx.kick(5);
		} else if (event.type === 'projectile-parried') {
			const origin = at(event.playerId);
			if (!origin) return;
			fx.ring(origin, PALETTE.energy, { from: 20, to: 90, life: 420, width: 6 });
			fx.burst(origin, '#ffffff', 16, { speed: 260, gravity: 0, life: 380 });
			fx.float(origin, 'PARRY!', PALETTE.energy, { size: 1.1 });
			if (event.playerId === humanId) {
				fx.flashScreen('rgba(127,243,255,0.9)', 320);
				fx.kick(7);
			}
		} else if (event.type === 'player-damaged') {
			const origin = at(event.playerId);
			if (!origin) return;
			fx.float(origin, `-${Math.round(event.damage)}`, PALETTE.danger, {
				size: event.playerId === humanId ? 1.3 : 1
			});
			fx.burst(origin, PALETTE.coral, 14, { speed: 200 });
			if (event.playerId === humanId) {
				fx.flashScreen('rgba(255,40,70,0.95)', 380);
				fx.kick(14);
			} else if (event.byPlayerId === humanId) fx.kick(4);
		} else if (event.type === 'player-died') {
			const player = game.players[event.playerId];
			if (!player) return;
			const color = playerColor(player, humanId);
			fx.burst(player.position, color, 36, { speed: 320, size: 6, life: 800 });
			fx.burst(player.position, '#ffffff', 14, { speed: 240, life: 500 });
			fx.ring(player.position, color, { from: 16, to: 120, life: 520, width: 8 });
			if (event.byPlayerId === humanId) fx.float(player.position, 'SHATTERED', PALETTE.you);
			if (event.playerId === humanId || event.byPlayerId === humanId) fx.kick(16);
		} else if (event.type === 'player-respawned') {
			const origin = at(event.playerId);
			if (origin) fx.ring(origin, PALETTE.energy, { from: 80, to: 18, life: 420, width: 5 });
		}
	}

	draw(context: CanvasRenderingContext2D, scene: Scene) {
		const { game, now, width, height, camera } = scene;
		const dt = this.lastFrameAt ? Math.min(100, now - this.lastFrameAt) : 16;
		this.lastFrameAt = now;
		this.effects.update(dt);
		this.trackMonsterSpawns(game, now);

		context.fillStyle = '#07050f';
		context.fillRect(0, 0, width, height);

		const shake = this.effects.shakeOffset();
		context.save();
		context.translate(width / 2 + shake.x, height / 2 + shake.y);
		context.scale(camera.scale, camera.scale);
		context.translate(-camera.x, -camera.y);

		this.drawFloor(context, game.config);
		this.drawTutorialRoute(context, scene);
		this.drawChains(context, scene);
		this.drawMonsters(context, scene);
		this.drawChainAnimations(context, scene);
		this.drawProjectiles(context, scene);
		this.drawPlayers(context, scene);
		const threat = scene.spectating ? null : this.drawThreat(context, scene);
		this.drawAim(context, scene);
		this.drawChainPreview(context, scene);
		this.effects.drawWorld(context);
		context.restore();

		if (threat) this.drawOffscreenThreat(context, scene, threat);
		this.drawVignette(context, width, height);
		this.effects.drawScreen(context, width, height);
	}

	private trackMonsterSpawns(game: GameState, now: number) {
		for (const monster of Object.values(game.arena.monsters)) {
			const wasAlive = this.monsterWasAlive.get(monster.id);
			if (monster.alive && wasAlive === false) this.monsterBornAt.set(monster.id, now);
			this.monsterWasAlive.set(monster.id, monster.alive);
		}
	}

	private sprite(
		context: CanvasRenderingContext2D,
		cell: number,
		x: number,
		y: number,
		size: number
	) {
		if (!this.sprites?.complete || !this.sprites.naturalWidth) return false;
		const frame = SPRITE_FRAMES[cell];
		if (!frame) return false;
		const scale = size / Math.max(frame.width, frame.height);
		const drawWidth = frame.width * scale;
		const drawHeight = frame.height * scale;
		context.imageSmoothingEnabled = false;
		context.drawImage(
			this.sprites,
			frame.x,
			frame.y,
			frame.width,
			frame.height,
			Math.round(x - drawWidth / 2),
			Math.round(y - drawHeight / 2),
			Math.round(drawWidth),
			Math.round(drawHeight)
		);
		return true;
	}

	private shadow(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
		context.fillStyle = 'rgba(4, 2, 10, 0.45)';
		context.beginPath();
		context.ellipse(x, y, radius, radius * 0.32, 0, 0, Math.PI * 2);
		context.fill();
	}

	private drawFloor(context: CanvasRenderingContext2D, config: GameConfig) {
		const key = `${config.width}x${config.height}:${config.monsterColumns}:${config.monsterCount}`;
		if (this.floorKey !== key || !this.floor) {
			this.floor = buildFloor(config);
			this.floorKey = key;
		}
		context.imageSmoothingEnabled = false;
		context.drawImage(this.floor, -FLOOR_MARGIN, -FLOOR_MARGIN);
	}

	private drawTutorialRoute(context: CanvasRenderingContext2D, scene: Scene) {
		const me = scene.game.players[scene.humanId];
		if (!me || !scene.tutorialRouteIds.length) return;
		const route = scene.tutorialRouteIds
			.map((id) => scene.game.arena.monsters[id])
			.filter((monster): monster is Monster => Boolean(monster));
		if (!route.length) return;
		const pulse = 0.55 + Math.sin(scene.now * 0.006) * 0.25;
		context.save();
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.strokeStyle = `rgba(127, 243, 255, ${pulse})`;
		context.lineWidth = 5;
		context.setLineDash([2, 12]);
		context.lineDashOffset = -scene.now * 0.04;
		context.beginPath();
		context.moveTo(me.position.x, me.position.y);
		for (const monster of route) context.lineTo(monster.position.x, monster.position.y);
		context.stroke();
		context.setLineDash([]);
		for (const [index, monster] of route.entries()) {
			const size = 30 + Math.sin(scene.now * 0.008 + index) * 2;
			context.fillStyle = 'rgba(127, 243, 255, 0.12)';
			context.strokeStyle = index === 0 ? PALETTE.energy : 'rgba(255, 241, 196, 0.8)';
			context.lineWidth = 3;
			roundedRect(
				context,
				monster.position.x - size,
				monster.position.y - size,
				size * 2,
				size * 2,
				8
			);
			context.fill();
			context.stroke();
			context.fillStyle = PALETTE.ink;
			context.beginPath();
			context.arc(monster.position.x + size - 4, monster.position.y - size + 4, 9, 0, Math.PI * 2);
			context.fill();
			context.fillStyle = PALETTE.energy;
			context.font = '700 12px "Pixelify Sans", monospace';
			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.fillText(
				String(index + 1),
				monster.position.x + size - 4,
				monster.position.y - size + 5
			);
		}
		context.restore();
	}

	private drawChains(context: CanvasRenderingContext2D, scene: Scene) {
		const { game, now } = scene;
		context.save();
		context.lineCap = 'round';
		context.lineJoin = 'round';
		for (const player of Object.values(game.players)) {
			if (!player.chain.length || player.mode === 'dead') continue;
			const linked = player.chain
				.map((id) => game.arena.monsters[id])
				.filter((monster): monster is Monster => Boolean(monster));
			const color = playerColor(player, scene.humanId);
			const local = player.id === scene.humanId;
			const trace = () => {
				context.beginPath();
				context.moveTo(player.position.x, player.position.y);
				for (const monster of linked) context.lineTo(monster.position.x, monster.position.y);
			};
			trace();
			context.strokeStyle = 'rgba(11, 7, 22, 0.8)';
			context.lineWidth = local ? 17 : 13;
			context.stroke();
			context.shadowColor = color;
			context.shadowBlur = local ? 16 : 8;
			context.strokeStyle = color;
			context.lineWidth = local ? 8 : 5;
			context.stroke();
			context.shadowBlur = 0;
			context.strokeStyle = 'rgba(255, 255, 255, 0.75)';
			context.lineWidth = 2;
			context.setLineDash([6, 12]);
			context.lineDashOffset = -now * 0.08;
			context.stroke();
			context.setLineDash([]);
			for (const monster of linked) {
				context.fillStyle = color;
				context.strokeStyle = PALETTE.ink;
				context.lineWidth = 3;
				context.beginPath();
				context.arc(monster.position.x, monster.position.y + 20, local ? 6 : 4, 0, Math.PI * 2);
				context.fill();
				context.stroke();
			}
			const endpoint = linked.at(-1);
			if (endpoint && playerGrindstoneReady(game, player))
				drawRainbowAura(context, endpoint.position.x, endpoint.position.y, 32, now);
		}
		context.restore();
	}

	private drawMonsters(context: CanvasRenderingContext2D, scene: Scene) {
		const { game, now } = scene;
		const chainedBy = new Map<string, string>();
		for (const player of Object.values(game.players))
			for (const id of player.chain) chainedBy.set(id, playerColor(player, scene.humanId));
		const myChain = new Set(game.players[scene.humanId]?.chain ?? []);
		const legalPulse = 0.45 + Math.sin(now * 0.012) * 0.25;

		for (const monster of Object.values(game.arena.monsters)) {
			if (!monster.alive) continue;
			const { x, y } = monster.position;
			const seed = hash(monster.id);
			const bornAt = this.monsterBornAt.get(monster.id);
			const spawn = bornAt === undefined ? 1 : Math.min(1, (now - bornAt) / 300);
			const scale = spawn < 1 ? Math.max(0, easeOutBack(spawn)) : 1;
			const chainColor = chainedBy.get(monster.id);
			const lift = myChain.has(monster.id) ? -4 : 0;
			const bob = Math.sin(now * 0.0026 + seed * Math.PI * 2) * 1.6 + lift;

			if (chainColor) {
				context.fillStyle = chainColor + '33';
				context.strokeStyle = chainColor;
				context.lineWidth = 3;
				roundedRect(context, x - 28, y - 28, 56, 56, 10);
				context.fill();
				context.stroke();
			} else if (scene.legalTargetIds.has(monster.id)) {
				context.strokeStyle = `rgba(255, 241, 196, ${legalPulse})`;
				context.lineWidth = 3;
				context.setLineDash([8, 6]);
				context.lineDashOffset = -now * 0.03;
				roundedRect(context, x - 27, y - 27, 54, 54, 10);
				context.stroke();
				context.setLineDash([]);
			}

			this.shadow(context, x, y + 19, 15 * scale);
			const size = MONSTER_SIZE * scale * (myChain.has(monster.id) ? 1.08 : 1);
			if (size < 1) continue;
			if (!this.sprite(context, SPRITE[monster.color], x, y + bob, size)) {
				context.fillStyle = colorFor(monster.color);
				context.fillRect(x - size / 4, y - size / 4 + bob, size / 2, size / 2);
			}
		}
	}

	private drawChainAnimations(context: CanvasRenderingContext2D, scene: Scene) {
		const { game, now } = scene;
		for (const animation of scene.chainAnimations.values()) {
			const elapsed = Math.max(0, now - animation.startedAt);
			const hitCount = animation.timing.arrivalTimes.filter((arrival) => elapsed >= arrival).length;
			const previousHits = this.animationHits.get(animation) ?? 0;
			for (let index = previousHits; index < hitCount; index++) {
				const node = animation.nodes[index]!;
				this.effects.burst(node.position, colorFor(node.color), 9, { speed: 170, size: 5 });
				if (animation.playerId === scene.humanId) this.effects.kick(1.5 + index * 0.25);
			}
			this.animationHits.set(animation, hitCount);
			for (const node of animation.nodes.slice(hitCount)) {
				if (game.arena.monsters[node.id]?.alive) continue;
				this.shadow(context, node.position.x, node.position.y + 19, 15);
				this.sprite(context, SPRITE[node.color], node.position.x, node.position.y, MONSTER_SIZE);
			}
			for (let index = Math.max(0, hitCount - 2); index < hitCount; index++) {
				const node = animation.nodes[index]!;
				const age = elapsed - animation.timing.arrivalTimes[index]!;
				if (age < 0 || age > 200) continue;
				const t = age / 200;
				context.save();
				context.strokeStyle = `rgba(255, 227, 110, ${1 - t})`;
				context.lineWidth = 5 - t * 3;
				context.beginPath();
				context.arc(node.position.x, node.position.y, 12 + t * 36, 0, Math.PI * 2);
				context.stroke();
				for (let ray = 0; ray < 8; ray++) {
					const angle = (Math.PI * 2 * ray) / 8 + 0.2;
					const inner = 16 + t * 16;
					const outer = 26 + t * 32;
					context.beginPath();
					context.moveTo(
						node.position.x + Math.cos(angle) * inner,
						node.position.y + Math.sin(angle) * inner
					);
					context.lineTo(
						node.position.x + Math.cos(angle) * outer,
						node.position.y + Math.sin(angle) * outer
					);
					context.stroke();
				}
				context.restore();
			}
		}
	}

	private drawProjectiles(context: CanvasRenderingContext2D, scene: Scene) {
		for (const projectile of Object.values(scene.game.projectiles)) {
			const { x, y } = projectile.position;
			const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y) || 1;
			const direction = { x: projectile.velocity.x / speed, y: projectile.velocity.y / speed };
			const trail = 70 + projectile.power * 0.6;
			const owner = scene.game.players[projectile.ownerId];
			const tint = owner ? playerColor(owner, scene.humanId) : PALETTE.energy;
			context.save();
			const gradient = context.createLinearGradient(
				x - direction.x * trail,
				y - direction.y * trail,
				x,
				y
			);
			gradient.addColorStop(0, 'rgba(127, 243, 255, 0)');
			gradient.addColorStop(1, 'rgba(127, 243, 255, 0.85)');
			context.strokeStyle = gradient;
			context.lineCap = 'round';
			context.lineWidth = projectile.radius * 1.6;
			context.beginPath();
			context.moveTo(x - direction.x * trail, y - direction.y * trail);
			context.lineTo(x, y);
			context.stroke();
			const glow = context.createRadialGradient(x, y, 0, x, y, projectile.radius * 3.2);
			glow.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
			glow.addColorStop(0.35, 'rgba(127, 243, 255, 0.55)');
			glow.addColorStop(1, 'rgba(127, 243, 255, 0)');
			context.fillStyle = glow;
			context.beginPath();
			context.arc(x, y, projectile.radius * 3.2, 0, Math.PI * 2);
			context.fill();
			context.strokeStyle = tint;
			context.lineWidth = 2;
			context.beginPath();
			context.arc(x, y, projectile.radius + 3, 0, Math.PI * 2);
			context.stroke();
			context.translate(x, y);
			context.rotate(Math.atan2(direction.y, direction.x));
			this.sprite(context, SPRITE.bolt, 0, 0, 32 + projectile.radius * 1.6);
			context.restore();
		}
	}

	private drawPlayers(context: CanvasRenderingContext2D, scene: Scene) {
		const { game, now, humanId } = scene;
		const players = Object.values(game.players)
			.filter((player) => player.mode !== 'dead')
			.sort((a, b) => (a.id === humanId ? 1 : b.id === humanId ? -1 : a.position.y - b.position.y));
		for (const player of players) {
			const local = player.id === humanId && !scene.spectating;
			const { x, y } = animatedPlayerPosition(player, scene.chainAnimations, now);
			const color = playerColor(player, humanId);
			const size = local ? 60 : 52;

			this.shadow(context, x, y + 24, 20);
			context.save();
			context.strokeStyle = color;
			context.fillStyle = color + '2a';
			context.lineWidth = local ? 3 : 2;
			context.beginPath();
			context.ellipse(x, y + 24, local ? 26 : 22, local ? 9 : 7.5, 0, 0, Math.PI * 2);
			context.fill();
			context.stroke();
			context.restore();

			if (playerGrindstoneReady(game, player)) drawRainbowAura(context, x, y, local ? 42 : 36, now);
			if (player.mode === 'parrying') this.sprite(context, SPRITE.parry, x, y, 84);
			const flicker = player.mode === 'hit' && Math.floor(now / 55) % 2 === 0;
			if (!flicker) this.sprite(context, SPRITE.hero, x, y, size);

			if (game.timeMs < player.protectedUntilMs) {
				context.save();
				context.globalAlpha = 0.35 + Math.sin(now * 0.015) * 0.15;
				context.strokeStyle = PALETTE.energy;
				context.lineWidth = 3;
				context.setLineDash([4, 6]);
				context.lineDashOffset = now * 0.03;
				context.beginPath();
				context.arc(x, y, 38, 0, Math.PI * 2);
				context.stroke();
				context.restore();
			}

			this.drawNameplate(context, player, x, y, color, local, game.config);
			if (local && scene.startCue) this.drawStartCue(context, { x, y }, scene.startCue, now);
		}
	}

	private drawNameplate(
		context: CanvasRenderingContext2D,
		player: PlayerState,
		x: number,
		y: number,
		color: string,
		local: boolean,
		config: GameConfig
	) {
		const label = local ? 'YOU' : player.name;
		const barWidth = 46;
		const top = y - 50;
		context.save();
		context.font = `700 ${local ? 12 : 11}px "Pixelify Sans", monospace`;
		if (!local) context.globalAlpha = 0.88;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const textWidth = Math.min(110, context.measureText(label).width);
		const plateWidth = Math.max(barWidth + 8, textWidth + 14);
		context.fillStyle = 'rgba(11, 7, 22, 0.82)';
		roundedRect(context, x - plateWidth / 2, top - 8, plateWidth, 24, 4);
		context.fill();
		if (local) {
			context.strokeStyle = color;
			context.lineWidth = 1.5;
			context.stroke();
		}
		context.fillStyle = color;
		context.fillText(label, x, top, 110);

		const maxHealth = player.maxHealth || maxHealthForScore(player.score, config);
		const healthRatio = Math.max(0, Math.min(1, player.health / maxHealth));
		const barLeft = x - barWidth / 2;
		context.fillStyle = '#2a1a2e';
		context.fillRect(barLeft, top + 7, barWidth, 4);
		context.fillStyle = healthRatio > 0.35 ? '#6be7ac' : PALETTE.danger;
		context.fillRect(barLeft, top + 7, barWidth * healthRatio, 4);

		const powerRatio = Math.max(0, Math.min(1, player.power / config.powerCap));
		const armed = player.power >= config.minFirePower;
		context.fillStyle = '#16222e';
		context.fillRect(barLeft, top + 12, barWidth, 2);
		context.fillStyle = armed ? PALETTE.energy : '#3d7f8a';
		context.fillRect(barLeft, top + 12, barWidth * powerRatio, 2);
		context.restore();
	}

	/** Warns the local player about the most imminent incoming projectile. */
	private drawThreat(context: CanvasRenderingContext2D, scene: Scene) {
		const me = scene.game.players[scene.humanId];
		if (!me || me.mode === 'dead') return null;
		let soonest: { seconds: number; position: Point } | null = null;
		for (const projectile of Object.values(scene.game.projectiles)) {
			if (projectile.ownerId === me.id) continue;
			const { seconds, miss } = approach(me.position, projectile.position, projectile.velocity);
			if (seconds <= 0 || seconds > 1.4) continue;
			if (miss > scene.game.config.playerRadius + projectile.radius + 12) continue;
			if (!soonest || seconds < soonest.seconds)
				soonest = { seconds, position: projectile.position };
		}
		if (!soonest) return null;
		const { x, y } = me.position;
		const parryZone = soonest.seconds * 1000 <= scene.game.config.parryWindowMs + 120;
		context.save();
		context.lineWidth = parryZone ? 5 : 3;
		context.strokeStyle = parryZone ? PALETTE.energy : PALETTE.danger;
		context.shadowColor = context.strokeStyle;
		context.shadowBlur = parryZone ? 18 : 8;
		context.beginPath();
		context.arc(x, y, 34 + soonest.seconds * 120, 0, Math.PI * 2);
		context.stroke();
		context.shadowBlur = 0;
		context.globalAlpha = 0.6;
		context.lineWidth = 2;
		context.setLineDash([4, 5]);
		context.beginPath();
		context.arc(x, y, 34, 0, Math.PI * 2);
		context.stroke();
		context.restore();
		if (parryZone) {
			context.save();
			context.font = '700 15px "Pixelify Sans", monospace';
			context.textAlign = 'center';
			context.lineWidth = 4;
			context.strokeStyle = PALETTE.ink;
			context.strokeText('PARRY!', x, y + 54);
			context.fillStyle = PALETTE.energy;
			context.fillText('PARRY!', x, y + 54);
			context.restore();
		}
		return soonest;
	}

	private drawOffscreenThreat(
		context: CanvasRenderingContext2D,
		scene: Scene,
		threat: { position: Point }
	) {
		const { camera, width, height } = scene;
		const sx = width / 2 + (threat.position.x - camera.x) * camera.scale;
		const sy = height / 2 + (threat.position.y - camera.y) * camera.scale;
		const margin = 28;
		if (sx > margin && sx < width - margin && sy > margin && sy < height - margin) return;
		const angle = Math.atan2(sy - height / 2, sx - width / 2);
		const ex = Math.max(margin, Math.min(width - margin, sx));
		const ey = Math.max(margin, Math.min(height - margin, sy));
		context.save();
		context.translate(ex, ey);
		context.rotate(angle);
		context.fillStyle = PALETTE.danger;
		context.strokeStyle = PALETTE.ink;
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(14, 0);
		context.lineTo(-10, -11);
		context.lineTo(-5, 0);
		context.lineTo(-10, 11);
		context.closePath();
		context.stroke();
		context.fill();
		context.restore();
	}

	private drawAim(context: CanvasRenderingContext2D, scene: Scene) {
		const me = scene.game.players[scene.humanId];
		if (!scene.aim || !me) return;
		const origin = animatedPlayerPosition(me, scene.chainAnimations, scene.now);
		const dx = scene.aim.target.x - origin.x;
		const dy = scene.aim.target.y - origin.y;
		const length = Math.hypot(dx, dy) || 1;
		const range =
			(scene.game.config.projectileSpeed * scene.game.config.projectileLifetimeMs) / 1000;
		const armed = scene.aim.power >= scene.game.config.minFirePower;
		const color = armed ? PALETTE.energy : '#8a7f9c';
		context.save();
		context.lineCap = 'round';
		context.strokeStyle = color;
		context.globalAlpha = 0.28;
		context.lineWidth = 2;
		context.setLineDash([3, 10]);
		context.beginPath();
		context.moveTo(origin.x, origin.y);
		context.lineTo(origin.x + (dx / length) * range, origin.y + (dy / length) * range);
		context.stroke();
		context.globalAlpha = 1;
		context.lineWidth = 3;
		context.setLineDash([12, 8]);
		context.lineDashOffset = -scene.now * 0.06;
		context.shadowColor = color;
		context.shadowBlur = 10;
		context.beginPath();
		context.moveTo(origin.x, origin.y);
		context.lineTo(scene.aim.target.x, scene.aim.target.y);
		context.stroke();
		context.setLineDash([]);
		const { x, y } = scene.aim.target;
		const spin = scene.now * 0.003;
		for (let corner = 0; corner < 4; corner++) {
			const angle = spin + (corner * Math.PI) / 2;
			context.beginPath();
			context.arc(x, y, 14, angle, angle + 0.9);
			context.stroke();
		}
		context.shadowBlur = 0;
		context.font = '700 14px "Pixelify Sans", monospace';
		context.textAlign = 'left';
		context.textBaseline = 'middle';
		context.lineWidth = 4;
		context.strokeStyle = PALETTE.ink;
		const label = armed ? `ALL IN · ${Math.floor(scene.aim.power)}` : 'NEED POWER';
		context.strokeText(label, x + 22, y - 16);
		context.fillStyle = color;
		context.fillText(label, x + 22, y - 16);
		context.restore();
	}

	private drawChainPreview(context: CanvasRenderingContext2D, scene: Scene) {
		const me = scene.game.players[scene.humanId];
		const endpoint = me?.chain.length
			? scene.game.arena.monsters[me.chain.at(-1)!]?.position
			: undefined;
		if (!scene.chainPreview || !endpoint) return;
		context.save();
		context.font = '700 14px "Pixelify Sans", monospace';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const width = context.measureText(scene.chainPreview.text).width + 16;
		const top = endpoint.y - 58;
		context.fillStyle = PALETTE.ink;
		roundedRect(context, endpoint.x - width / 2, top - 12, width, 24, 6);
		context.fill();
		context.strokeStyle = scene.chainPreview.color;
		context.lineWidth = 2;
		context.stroke();
		context.fillStyle = scene.chainPreview.color;
		context.fillText(scene.chainPreview.text, endpoint.x, top + 1);
		context.restore();
	}

	private drawStartCue(
		context: CanvasRenderingContext2D,
		position: Point,
		label: string,
		now: number
	) {
		const pulse = 44 + Math.sin(now * 0.008) * 5;
		context.save();
		context.strokeStyle = PALETTE.energy;
		context.fillStyle = 'rgba(127, 243, 255, 0.08)';
		context.lineWidth = 3;
		context.setLineDash([7, 6]);
		context.lineDashOffset = -now * 0.02;
		context.beginPath();
		context.arc(position.x, position.y, pulse, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		context.setLineDash([]);
		context.font = '700 12px "Pixelify Sans", monospace';
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const width = context.measureText(label).width + 18;
		context.fillStyle = PALETTE.ink;
		roundedRect(context, position.x - width / 2, position.y + 52, width, 24, 6);
		context.fill();
		context.strokeStyle = PALETTE.energy;
		context.lineWidth = 2;
		context.stroke();
		context.fillStyle = '#dffcff';
		context.fillText(label, position.x, position.y + 65);
		context.restore();
	}

	private drawVignette(context: CanvasRenderingContext2D, width: number, height: number) {
		const gradient = context.createRadialGradient(
			width / 2,
			height / 2,
			Math.min(width, height) * 0.45,
			width / 2,
			height / 2,
			Math.hypot(width, height) * 0.6
		);
		gradient.addColorStop(0, 'rgba(7, 5, 15, 0)');
		gradient.addColorStop(1, 'rgba(7, 5, 15, 0.7)');
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);
	}
}

function playerGrindstoneReady(game: GameState, player: PlayerState) {
	return grindstoneState(
		player.chain
			.map((id) => game.arena.monsters[id]?.color)
			.filter((color): color is Monster['color'] => Boolean(color)),
		game.config.grindstoneStreak
	).ready;
}

function drawRainbowAura(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	now: number
) {
	const rotation = now * 0.004;
	context.save();
	context.lineWidth = 6;
	context.shadowBlur = 12;
	for (let index = 0; index < RAINBOW.length; index++) {
		const start = rotation + (index / RAINBOW.length) * Math.PI * 2;
		context.beginPath();
		context.arc(x, y, radius, start, start + Math.PI * 0.34);
		context.strokeStyle = RAINBOW[index]!;
		context.shadowColor = RAINBOW[index]!;
		context.stroke();
	}
	context.restore();
}

function roundedRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
) {
	context.beginPath();
	if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
	else context.rect(x, y, width, height);
}

/** Paints the static cavern floor once per arena shape. */
function buildFloor(config: GameConfig): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = config.width + FLOOR_MARGIN * 2;
	canvas.height = config.height + FLOOR_MARGIN * 2;
	const context = canvas.getContext('2d')!;
	const random = seeded(0x6a5c1d);
	context.translate(FLOOR_MARGIN, FLOOR_MARGIN);

	// Cavern wall beyond the arena.
	context.fillStyle = '#0d0919';
	context.fillRect(-FLOOR_MARGIN, -FLOOR_MARGIN, canvas.width, canvas.height);
	for (let index = 0; index < 260; index++) {
		const x = -FLOOR_MARGIN + random() * canvas.width;
		const y = -FLOOR_MARGIN + random() * canvas.height;
		const size = 10 + random() * 34;
		context.fillStyle = random() > 0.5 ? '#140e26' : '#181130';
		context.beginPath();
		context.moveTo(x, y - size / 2);
		context.lineTo(x + size / 2, y - size / 6);
		context.lineTo(x + size / 3, y + size / 2);
		context.lineTo(x - size / 3, y + size / 2.4);
		context.lineTo(x - size / 2, y);
		context.closePath();
		context.fill();
	}

	// Raised stone rim.
	context.fillStyle = '#1c1433';
	context.fillRect(0, 0, config.width, config.height);
	context.fillStyle = '#251b42';
	for (let y = 0; y < config.height; y += 18) {
		const offset = (y / 18) % 2 ? 0 : 18;
		for (let x = -offset; x < config.width; x += 36) context.fillRect(x + 1, y + 1, 34, 16);
	}

	const grid = arenaGridMetrics(config);
	const half = grid.cellSize / 2;
	const left = grid.originX - half;
	const top = grid.originY - half;
	const fieldWidth = grid.columns * grid.cellSize;
	const fieldHeight = grid.rows * grid.cellSize;
	context.fillStyle = '#120c22';
	context.fillRect(left - 8, top - 8, fieldWidth + 16, fieldHeight + 16);

	for (let row = 0; row < grid.rows; row++) {
		for (let column = 0; column < grid.columns; column++) {
			const x = Math.round(left + column * grid.cellSize);
			const y = Math.round(top + row * grid.cellSize);
			const size = Math.ceil(grid.cellSize);
			context.fillStyle = (row + column) % 2 ? '#2a1f48' : '#251a40';
			context.fillRect(x, y, size, size);
			context.fillStyle = '#34285a';
			context.fillRect(x, y, size, 2);
			context.fillRect(x, y, 2, size);
			context.fillStyle = '#1a1231';
			context.fillRect(x, y + size - 2, size, 2);
			context.fillRect(x + size - 2, y, 2, size);
			for (let speck = 0; speck < 4; speck++) {
				context.fillStyle = random() > 0.5 ? '#3a2d62' : '#1f1638';
				context.fillRect(
					x + 6 + Math.floor(random() * (size - 14)),
					y + 6 + Math.floor(random() * (size - 14)),
					2 + Math.floor(random() * 2),
					2
				);
			}
			if (random() > 0.86) {
				context.strokeStyle = '#1b1232';
				context.lineWidth = 2;
				context.beginPath();
				let cx = x + 10 + random() * (size - 20);
				let cy = y + 10 + random() * (size - 20);
				context.moveTo(cx, cy);
				for (let step = 0; step < 3; step++) {
					cx += (random() - 0.5) * 18;
					cy += (random() - 0.5) * 18;
					context.lineTo(cx, cy);
				}
				context.stroke();
			}
		}
	}
	context.strokeStyle = 'rgba(141, 98, 255, 0.55)';
	context.lineWidth = 3;
	context.strokeRect(left - 5, top - 5, fieldWidth + 10, fieldHeight + 10);

	// Crystal clusters growing from the walls.
	const crystalColors = [
		['#7c4dff', '#b69cff', '#4a2aa8'],
		['#c056f0', '#ec9dff', '#7a2a9c'],
		['#2fc6e0', '#9ff2ff', '#16778a']
	];
	const placeCluster = (x: number, y: number, scale: number) => {
		const palette = crystalColors[random() > 0.78 ? 2 : random() > 0.5 ? 1 : 0]!;
		const count = 2 + Math.floor(random() * 3);
		for (let index = 0; index < count; index++) {
			const height = (18 + random() * 34) * scale;
			const width = (7 + random() * 7) * scale;
			const lean = (random() - 0.5) * 0.9;
			const baseX = x + (index - count / 2) * width * 0.9;
			context.save();
			context.translate(baseX, y);
			context.rotate(lean);
			context.fillStyle = palette[2]!;
			context.beginPath();
			context.moveTo(-width / 2, 0);
			context.lineTo(-width / 2, -height * 0.75);
			context.lineTo(0, -height);
			context.lineTo(width / 2, -height * 0.75);
			context.lineTo(width / 2, 0);
			context.closePath();
			context.fill();
			context.fillStyle = palette[0]!;
			context.beginPath();
			context.moveTo(0, 0);
			context.lineTo(0, -height);
			context.lineTo(width / 2, -height * 0.75);
			context.lineTo(width / 2, 0);
			context.closePath();
			context.fill();
			context.fillStyle = palette[1]!;
			context.fillRect(-width / 4, -height * 0.7, 2 * scale, height * 0.45);
			context.restore();
		}
	};
	for (let index = 0; index < 70; index++) {
		const side = Math.floor(random() * 4);
		const along = random();
		const depth = random() * (FLOOR_MARGIN * 0.8);
		const scale = 0.7 + random() * 0.8;
		if (side === 0) placeCluster(along * config.width, -depth + 30, scale);
		else if (side === 1) placeCluster(along * config.width, config.height + depth, scale);
		else if (side === 2) placeCluster(-depth, along * config.height, scale);
		else placeCluster(config.width + depth, along * config.height, scale);
	}
	for (let index = 0; index < 16; index++) {
		const x = random() * config.width;
		const y = random() > 0.5 ? random() * (top - 12) + 14 : config.height - random() * (top - 12);
		placeCluster(x, y, 0.45);
	}
	return canvas;
}
