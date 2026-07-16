/**
 * Public deterministic game-engine API.
 *
 * - `createGame` creates a serializable authoritative snapshot.
 * - `stepGame` immutably advances one fixed step from intents.
 * - `FixedStepGame` adapts variable render-frame deltas to the 20 Hz simulation.
 * - `createBotController` emits ordinary player intents at 8 Hz.
 * - tuning helpers are shared by UI previews and authoritative simulation.
 */
export { createGame, stepGame, FixedStepGame } from './engine';
export { createBotController, type BotController } from './bots';
export {
	DEFAULT_CONFIG,
	growthForScore,
	reachForScore,
	maxHealthForScore,
	powerEfficiency,
	chainValue,
	powerGain
} from './tuning';
export { distance, normalize } from './arena';
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
