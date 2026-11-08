import type { GameConfig } from './types';

export const DEFAULT_CONFIG: Readonly<GameConfig> = Object.freeze({
	width: 1440,
	height: 900,
	tickRate: 20,
	roundDurationMs: 300_000,
	monsterCount: 180,
	monsterColumns: 15,
	monsterRefillMs: 1_250,
	playerRadius: 16,
	minChain: 3,
	baseReach: 180,
	reachScale: 24,
	reachScoreScale: 25,
	scoreScale: 100,
	grindstoneStreak: 5,
	baseHealth: 100,
	healthScale: 35,
	chainHealingPerScore: 0.35,
	powerPerMonster: 5,
	initialPower: 15,
	shotCost: 15,
	shotDamage: 20,
	chainStrikeWindupMs: 600,
	projectileSpeed: 520,
	projectileLifetimeMs: 2_500,
	parryMinimum: 5,
	parryCost: 5,
	parryWindowMs: 180,
	parryCooldownMs: 600,
	hitStunMs: 200,
	respawnMs: 2_000,
	spawnProtectionMs: 2_500,
	deathScoreLoss: 0.2
});

/** A larger board for live arenas: 24×18 cells at the default cell size. */
export const LIVE_ARENA_CONFIG: Readonly<Partial<GameConfig>> = Object.freeze({
	width: 1710,
	height: 1305,
	monsterColumns: 24,
	monsterCount: 432
});

export function growthForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return Math.log1p(Math.max(0, score) / config.scoreScale);
}
export function reachForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return (
		config.baseReach + config.reachScale * Math.log1p(Math.max(0, score) / config.reachScoreScale)
	);
}
export function maxHealthForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return config.baseHealth + config.healthScale * growthForScore(score, config);
}
export function powerGain(length: number, config: GameConfig = DEFAULT_CONFIG): number {
	return Math.max(0, length) * config.powerPerMonster;
}
/** Every monster in a committed chain is worth one point. */
export function chainScore(length: number, config: GameConfig = DEFAULT_CONFIG): number {
	return length < config.minChain ? 0 : length;
}
