import type { GameState, Monster, MonsterColor } from './types';

const COLORS: MonsterColor[] = ['coral', 'cyan', 'gold'];

/** Creates one isolated three-cell lesson route without flattening the board. */
export function configureTutorialRoute(
	state: GameState,
	playerId: string,
	color: MonsterColor,
	preferredIds: string[] = []
): string[] {
	const player = state.players[playerId];
	const origin = player && state.arena.monsters[player.cellId];
	if (!player || !origin) return [];
	const withinReach = (monster: Monster) =>
		Math.hypot(monster.position.x - player.position.x, monster.position.y - player.position.y) <=
		player.reach;
	const isValidRoute = (route: Monster[]) =>
		route.length === 3 &&
		route.every((monster) => monster.alive && withinReach(monster)) &&
		origin.neighborIds.includes(route[0]!.id) &&
		route[0]!.neighborIds.includes(route[1]!.id) &&
		route[1]!.neighborIds.includes(route[2]!.id);

	let route = preferredIds
		.map((id) => state.arena.monsters[id])
		.filter((monster): monster is Monster => Boolean(monster));
	if (!isValidRoute(route)) route = [];

	if (!route.length) {
		const starts = origin.neighborIds
			.map((id) => state.arena.monsters[id]!)
			.filter((monster) => monster.alive && withinReach(monster))
			.sort((a, b) => a.id.localeCompare(b.id));
		for (const first of starts) {
			for (const secondId of first.neighborIds) {
				const second = state.arena.monsters[secondId];
				if (!second?.alive || !withinReach(second) || second.id === origin.id) continue;
				const third = second.neighborIds
					.map((id) => state.arena.monsters[id])
					.find(
						(monster) =>
							monster?.alive &&
							monster.id !== origin.id &&
							monster.id !== first.id &&
							withinReach(monster)
					);
				if (third) {
					route = [first, second, third];
					break;
				}
			}
			if (route.length) break;
		}
	}

	if (!route.length) return [];
	const routeIds = new Set(route.map((monster) => monster.id));
	for (const monster of route) monster.color = color;

	// Only adjust the immediate boundary so the intended chain cannot extend.
	const alternatives = COLORS.filter((candidate) => candidate !== color);
	const boundary = [...new Set(route.flatMap((monster) => monster.neighborIds))]
		.filter((id) => !routeIds.has(id) && state.arena.monsters[id]?.alive)
		.sort();
	boundary.forEach((id, index) => {
		state.arena.monsters[id]!.color = alternatives[index % alternatives.length]!;
	});

	return [...routeIds];
}
