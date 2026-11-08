import type { GameState, PlayerState } from './types';

export function canChainStrikeTarget(
	state: GameState,
	attacker: PlayerState,
	target: PlayerState,
	chain: readonly string[] = attacker.chain
): boolean {
	if (
		attacker.id === target.id ||
		attacker.power < state.config.shotCost ||
		Object.values(state.chainStrikes).some((strike) => strike.targetId === target.id) ||
		attacker.mode === 'dead' ||
		attacker.mode === 'hit' ||
		attacker.mode === 'striking' ||
		target.mode === 'dead' ||
		state.timeMs < target.protectedUntilMs ||
		chain.length < state.config.minChain
	)
		return false;
	const tail = state.arena.monsters[chain.at(-1) ?? ''];
	return Boolean(tail?.neighborIds.includes(target.cellId));
}
