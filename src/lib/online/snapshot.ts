import type { GameState, Monster, MonsterColor } from '../game/types';

/**
 * Arena snapshots without the static board. Monster positions and neighbor
 * lists never change during a round, so the server sends them once in the
 * `start` message and afterwards only one character per monster: its color,
 * uppercase while alive.
 */
export type CompactSnapshot = Omit<GameState, 'arena'> & { cells: string };

const COLOR_CODES: Record<MonsterColor, string> = { coral: 'c', cyan: 'y', gold: 'g' };
const CODE_COLORS: Record<string, MonsterColor> = { c: 'coral', y: 'cyan', g: 'gold' };

export function compactSnapshot(state: GameState): CompactSnapshot {
	const { arena, ...rest } = state;
	let cells = '';
	for (let index = 0; arena.monsters[`m${index}`]; index++) {
		const monster = arena.monsters[`m${index}`]!;
		const code = COLOR_CODES[monster.color];
		cells += monster.alive ? code.toUpperCase() : code;
	}
	return { ...rest, cells };
}

/** Rebuilds a full state from a compact snapshot and the board sent at round start. */
export function expandSnapshot(snapshot: CompactSnapshot, board: GameState['arena']): GameState {
	const { cells, ...rest } = snapshot;
	const monsters: Record<string, Monster> = {};
	for (const [id, monster] of Object.entries(board.monsters)) {
		const code = cells[Number(id.slice(1))];
		monsters[id] = code
			? {
					...monster,
					color: CODE_COLORS[code.toLowerCase()] ?? monster.color,
					alive: code !== code.toLowerCase(),
					respawnAtMs: 0
				}
			: monster;
	}
	return { ...rest, arena: { ...board, monsters } };
}
