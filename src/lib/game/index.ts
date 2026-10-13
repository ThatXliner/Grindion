/**
 * Public deterministic game-engine API.
 *
 * - `createGame` creates a serializable authoritative snapshot.
 * - `stepGame` immutably advances one fixed step from intents.
 * - `FixedStepGame` adapts variable render-frame deltas to the 20 Hz simulation.
 * - `createBotController` emits ordinary player intents at a tunable cadence.
 * - tuning helpers are shared by UI previews and authoritative simulation.
 */
export { createGame, stepGame, FixedStepGame } from './engine';
export {
	createBotController,
	DEFAULT_BOT_DIFFICULTY,
	type BotController,
	type BotDifficulty
} from './bots';
export {
	DEFAULT_CONFIG,
	LIVE_ARENA_CONFIG,
	growthForScore,
	reachForScore,
	maxHealthForScore,
	powerEfficiency,
	chainValue,
	powerGain
} from './tuning';
export { arenaGridMetrics, distance, normalize } from './arena';
export { configureTutorialRoute } from './tutorial';
export { canExtendWithColor, grindstoneState, type GrindstoneState } from './chainRules';
export {
	createChainMotionTiming,
	sampleChainMotion,
	type ChainMotionSample,
	type ChainMotionTiming
} from './chainMotion';
export type {
	Arena,
	CreateGameOptions,
	EntityId,
	GameConfig,
	GameEvent,
	GameIntent,
	GameState,
	Monster,
	MonsterColor,
	PlayerMode,
	PlayerSetup,
	PlayerState,
	Projectile,
	StepResult,
	Vec2
} from './types';
