import type { MonsterColor } from './types';

export interface GrindstoneState {
	activeColor: MonsterColor | null;
	streak: number;
	ready: boolean;
}

/** Derives the single, non-stacking color pivot from the current chain. */
export function grindstoneState(
	colors: readonly MonsterColor[],
	requiredStreak = 5
): GrindstoneState {
	const activeColor = colors.at(-1) ?? null;
	let streak = 0;
	if (activeColor) {
		for (let index = colors.length - 1; index >= 0 && colors[index] === activeColor; index--)
			streak++;
	}
	return {
		activeColor,
		streak,
		ready: Boolean(activeColor && streak >= requiredStreak)
	};
}

export function canExtendWithColor(
	colors: readonly MonsterColor[],
	nextColor: MonsterColor,
	requiredStreak = 5
): boolean {
	const state = grindstoneState(colors, requiredStreak);
	return state.activeColor === null || nextColor === state.activeColor || state.ready;
}
