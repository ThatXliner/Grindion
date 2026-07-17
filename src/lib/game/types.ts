export type EntityId = string;

export interface Vec2 {
	x: number;
	y: number;
}
export type MonsterColor = 'coral' | 'cyan' | 'gold';
export type PlayerMode = 'neutral' | 'chaining' | 'parrying' | 'hit' | 'dead';

export interface GameConfig {
	width: number;
	height: number;
	tickRate: number;
	roundDurationMs: number;
	monsterCount: number;
	monsterColumns: number;
	monsterRefillMs: number;
	playerRadius: number;
	minChain: number;
	baseReach: number;
	reachScale: number;
	scoreScale: number;
	baseHealth: number;
	healthScale: number;
	bankHealingPerValue: number;
	powerHandicap: number;
	powerPerValue: number;
	powerCap: number;
	initialPower: number;
	minFirePower: number;
	projectileSpeed: number;
	projectileLifetimeMs: number;
	parryMinimum: number;
	parryCost: number;
	parryWindowMs: number;
	parryCooldownMs: number;
	hitStunMs: number;
	respawnMs: number;
	spawnProtectionMs: number;
	deathScoreLoss: number;
}

export interface Monster {
	id: EntityId;
	position: Vec2;
	color: MonsterColor;
	neighborIds: EntityId[];
	alive: boolean;
	respawnAtMs: number;
}
export interface Arena {
	width: number;
	height: number;
	monsters: Record<EntityId, Monster>;
}

export interface PlayerState {
	id: EntityId;
	name: string;
	isBot: boolean;
	color: string;
	position: Vec2;
	score: number;
	health: number;
	maxHealth: number;
	reach: number;
	power: number;
	chain: EntityId[];
	mode: PlayerMode;
	parryUntilMs: number;
	parryCooldownUntilMs: number;
	hitUntilMs: number;
	respawnAtMs: number;
	protectedUntilMs: number;
	deaths: number;
	kills: number;
}

export interface Projectile {
	id: EntityId;
	ownerId: EntityId;
	position: Vec2;
	velocity: Vec2;
	power: number;
	radius: number;
	expiresAtMs: number;
}

export interface PlayerSetup {
	id: string;
	name?: string;
	isBot?: boolean;
	color?: string;
}
export interface CreateGameOptions {
	seed?: number;
	players?: PlayerSetup[];
	botCount?: number;
	config?: Partial<GameConfig>;
}

interface IntentBase {
	playerId: EntityId;
	sequence?: number;
}
export type GameIntent =
	| (IntentBase & { type: 'chain-start'; monsterId: EntityId })
	| (IntentBase & { type: 'chain-extend'; monsterId: EntityId })
	| (IntentBase & { type: 'chain-commit'; conversion: 'score' | 'power' })
	| (IntentBase & { type: 'chain-cancel' })
	| (IntentBase & { type: 'fire'; direction: Vec2 })
	| (IntentBase & { type: 'parry' });

export type GameEvent =
	| {
			type: 'chain-committed';
			playerId: string;
			conversion: 'score' | 'power';
			length: number;
			value: number;
	  }
	| { type: 'chain-truncated'; playerId: string; length: number }
	| { type: 'projectile-fired'; playerId: string; projectileId: string; power: number }
	| { type: 'projectile-parried'; playerId: string; projectileId: string }
	| { type: 'player-damaged'; playerId: string; byPlayerId: string; damage: number }
	| { type: 'player-died'; playerId: string; byPlayerId: string }
	| { type: 'player-respawned'; playerId: string }
	| { type: 'round-ended' };

export interface GameState {
	seed: number;
	randomState: number;
	tick: number;
	timeMs: number;
	roundEndsAtMs: number;
	roundEnded: boolean;
	nextProjectileId: number;
	config: GameConfig;
	arena: Arena;
	players: Record<EntityId, PlayerState>;
	projectiles: Record<EntityId, Projectile>;
}
export interface StepResult {
	state: GameState;
	events: GameEvent[];
}
