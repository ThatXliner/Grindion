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
	baseReach: 150,
	reachScale: 50,
	scoreScale: 100,
	baseHealth: 100,
	healthScale: 35,
	bankHealingPerValue: 0.35,
	powerHandicap: 0.5,
	powerPerValue: 5,
	powerCap: 120,
	initialPower: 15,
	minFirePower: 10,
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

export function growthForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return Math.log1p(Math.max(0, score) / config.scoreScale);
}
export function reachForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return config.baseReach + config.reachScale * growthForScore(score, config);
}
export function maxHealthForScore(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return config.baseHealth + config.healthScale * growthForScore(score, config);
}
export function powerEfficiency(score: number, config: GameConfig = DEFAULT_CONFIG): number {
	return 1 / (1 + config.powerHandicap * growthForScore(score, config));
}
export function chainValue(length: number): number {
	return length < 1 ? 0 : Math.round(length * (1 + 0.1 * Math.max(0, length - 3)));
}
export function powerGain(
	length: number,
	score: number,
	config: GameConfig = DEFAULT_CONFIG
): number {
	return Math.round(config.powerPerValue * chainValue(length) * powerEfficiency(score, config));
}
