import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import {
	createGame,
	configureTutorialRoute,
	LIVE_ARENA_CONFIG,
	stepGame,
	type GameIntent
} from '../lib/game';
import { compactSnapshot } from '../lib/online/snapshot';

/** Maps arena coordinates to screen pixels once the follow camera has settled. */
async function arenaProjection(page: Page) {
	const canvas = page.locator('canvas');
	let previous = '';
	await expect
		.poll(
			async () => {
				const current = (await canvas.getAttribute('data-camera')) ?? '';
				const settled = current !== '' && current === previous;
				previous = current;
				return settled;
			},
			{ intervals: [150] }
		)
		.toBe(true);
	const [cameraX, cameraY, scale] = previous.split(',').map(Number) as [number, number, number];
	const box = (await canvas.boundingBox())!;
	return {
		scale,
		toScreen: (x: number, y: number) => ({
			x: box.x + box.width / 2 + (x - cameraX) * scale,
			y: box.y + box.height / 2 + (y - cameraY) * scale
		})
	};
}

test('offers immediate online play with legacy private rooms hidden', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByLabel('CALLSIGN')).toBeVisible();
	await expect(page.getByRole('button', { name: 'JOIN ONLINE ARENA' })).toBeEnabled();
	await expect(page.getByText('PLAY NOW · BOTS FILL EMPTY SEATS')).toBeVisible();
	await expect(page.getByLabel('Private room code')).toBeHidden();
	await expect(page.getByRole('button', { name: 'CREATE PRIVATE ROOM' })).toBeHidden();
	await page.getByText('PRIVATE ROOMS', { exact: true }).click();
	await expect(page.getByLabel('Private room code')).toBeVisible();
	const onlineEnabled = await page.getByRole('button', { name: 'JOIN PRIVATE' }).isEnabled();
	await expect(page.getByRole('button', { name: 'JOIN PRIVATE' })).toBeEnabled({
		enabled: onlineEnabled
	});
	await expect(page.getByRole('button', { name: 'CREATE PRIVATE ROOM' })).toBeEnabled({
		enabled: onlineEnabled
	});
	await expect(
		page.getByText('ADD THE TWO PUBLIC SUPABASE ENV VARS TO ENABLE PRIVATE ROOMS')
	).toBeVisible({ visible: !onlineEnabled });
});

test('starts a live arena and spends one shot of Power', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'GRINDION' })).toBeVisible();

	await page.getByRole('button', { name: /SOLO ARENA/ }).click();
	await expect(page.getByText('SIMULATION LIVE')).toBeVisible();
	await expect(page.getByText('1 ACTIVE')).toBeVisible();
	await expect(page.locator('.leader-row').filter({ hasText: 'Bot' })).toHaveCount(0);
	await page.keyboard.press('?');
	const help = page.getByRole('dialog', { name: 'Controls and rules' });
	await expect(help.getByText('Chain 5 of one color to unlock one rainbow switch')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(help).toHaveCount(0);

	const canvas = page.getByRole('application', { name: 'Grindion game arena' }).locator('canvas');
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;

	await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
	await page.mouse.down({ button: 'right' });
	await expect(page.getByText('RELEASE TO FIRE · −15 POWER · 20 DMG')).toBeVisible();
	await page.mouse.up({ button: 'right' });
	await expect(page.getByText('POWER COMMITTED')).toBeVisible();
	await expect(page.locator('.power-card strong')).toHaveText('0');
});

test('offers a deterministic guided tutorial', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();
	await expect(page.getByText('LESSON 1 / 6')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();
	await expect(page.getByText('TRAINING MODE')).toBeVisible();
	await expect(page.locator('.player-hud')).toHaveCount(0);
	await expect(page.locator('.leaderboard')).toHaveCount(0);
	await expect(page.locator('.hint-strip')).toHaveCount(0);
	await expect(page.getByText(/Drag from your hero/)).toBeVisible();
	await expect(page.getByText(/9 → 6 → 2 on the numpad\/number row/)).toBeVisible();

	const { toScreen: worldToScreen } = await arenaProjection(page);
	const route = [
		worldToScreen(787.5, 483.75),
		worldToScreen(855, 483.75),
		worldToScreen(855, 551.25)
	];
	const hero = worldToScreen(720, 551.25);

	// Starting on a monster is intentionally ignored; chaining is locomotion from the hero.
	await page.mouse.move(route[0]!.x, route[0]!.y);
	await page.mouse.down();
	await page.mouse.move(route[1]!.x, route[1]!.y);
	await page.mouse.up();
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();

	await page.mouse.move(hero.x, hero.y);
	await page.mouse.down();
	await page.mouse.move(route[0]!.x, route[0]!.y, { steps: 3 });
	await page.mouse.move(route[1]!.x, route[1]!.y, { steps: 5 });
	await page.mouse.move(route[2]!.x, route[2]!.y, { steps: 5 });
	await expect(page.getByRole('heading', { name: 'Move + charge' })).toBeVisible();
	await page.mouse.move(route[1]!.x, route[1]!.y, { steps: 5 });
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.mouse.move(route[2]!.x, route[2]!.y, { steps: 5 });
	await expect(page.locator('.chain-status span')).toHaveText('3×');
	await expect(page.locator('.power-card')).toBeVisible();
	await page.mouse.up();
	await expect(page.getByRole('heading', { name: 'Score' })).toBeVisible();
	await expect(page.locator('.power-card strong')).toHaveText('15');
	await expect(page.getByText('EVERY MONSTER = +1 SCORE · +5 POWER')).toBeVisible();
	await expect(page.locator('.score-card')).toHaveAttribute('aria-label', 'Score 3, Wanderer');
	await page.getByRole('button', { name: 'TAKE AIM →' }).click();
	await expect(page.getByRole('heading', { name: 'Take the shot' })).toBeVisible();
	await arenaProjection(page);
	const canvasBox = (await page.locator('canvas').boundingBox())!;
	await page.mouse.move(canvasBox.x + canvasBox.width * 0.75, canvasBox.y + canvasBox.height / 2);
	await page.mouse.down({ button: 'right' });
	await expect(page.getByText('RELEASE TO FIRE · −15 POWER · 20 DMG')).toBeVisible();
	await page.mouse.up({ button: 'right' });
	await expect(page.getByRole('heading', { name: 'Parry', exact: true })).toBeVisible();
});

test('starts, chains, revises, and charges with zero pointer input', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'GRINDION' })).toBeVisible();

	await page.keyboard.press('t');
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();

	// These are ordinary laptop number-row keys, not synthetic Numpad event codes.
	await page.keyboard.press('9');
	await expect(page.locator('.chain-status span')).toHaveText('1×');
	await page.keyboard.press('6');
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.keyboard.press('2');
	await expect(page.locator('.chain-status span')).toHaveText('3×');
	await expect(page.getByRole('heading', { name: 'Move + charge' })).toBeVisible();

	// The reverse direction selects an earlier monster, shortening the planned route.
	await page.keyboard.press('8');
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.keyboard.press('2');
	await expect(page.locator('.chain-status span')).toHaveText('3×');

	await page.keyboard.press('5');
	await expect(page.getByRole('heading', { name: 'Score' })).toBeVisible();
	await expect(page.locator('.power-card strong')).toHaveText('15');
});

test('holding Shift still commits the same automatic chain rewards', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();

	const { toScreen: worldToScreen } = await arenaProjection(page);
	const hero = worldToScreen(720, 551.25);
	const route = [
		worldToScreen(787.5, 483.75),
		worldToScreen(855, 483.75),
		worldToScreen(855, 551.25)
	];

	await page.mouse.move(hero.x, hero.y);
	await page.keyboard.down('Shift');
	await page.mouse.down();
	for (const point of route) await page.mouse.move(point.x, point.y, { steps: 4 });
	await expect(page.locator('.chain-status')).toContainText('+15 POWER');
	await page.mouse.up();
	await page.keyboard.up('Shift');

	await expect(page.locator('.event-feed')).toContainText('+15 POWER');
	await expect(page.locator('.score-card')).toHaveAttribute('aria-label', 'Score 3, Wanderer');
	await expect(page.getByRole('heading', { name: 'Score' })).toBeVisible();
});

test('provides complete touch controls on a phone viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: /SOLO ARENA/ }).click();

	const controls = page.getByRole('group', { name: 'Touch game controls' });
	await expect(controls).toBeVisible();
	await expect(page.getByRole('button', { name: 'BANK SCORE' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'FORGE POWER' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'PARRY' })).toBeVisible();

	await page.getByRole('button', { name: 'AIM + FIRE' }).click();
	await expect(page.getByRole('button', { name: 'CANCEL AIM' })).toBeVisible();
	await expect(page.getByText('RELEASE TO FIRE · −15 POWER · 20 DMG')).toBeVisible();
	const canvas = page.locator('canvas');
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.45);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width * 0.85, box!.y + box!.height * 0.35, { steps: 4 });
	await page.mouse.up();
	await expect(page.getByText('POWER COMMITTED')).toBeVisible();
	await expect(page.getByRole('button', { name: 'AIM + FIRE' })).toBeVisible();

	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	expect(hasHorizontalOverflow).toBe(false);
});

test('supports a diagonal chain on the enlarged phone grid', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();

	const { scale, toScreen } = await arenaProjection(page);
	const tile = scale * 67.5;
	const hero = toScreen(720, 551.25);
	// One sparse diagonal event lands beyond the monster's circular hitbox.
	// The swept hit-test must capture exactly the diagonal monster crossed by the segment.
	const beyondDiagonal = { x: hero.x + tile * 1.5, y: hero.y - tile * 1.5 };

	await page.mouse.move(hero.x, hero.y);
	await page.mouse.down();
	await page.mouse.move(beyondDiagonal.x, beyondDiagonal.y);
	await expect(page.locator('.chain-status span')).toHaveText('1×');
	await page.mouse.up();
});

test('shows a responsive death recap until the authoritative respawn', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/?respawn-demo=1');

	const recap = page.getByRole('dialog', { name: 'YOU WERE BROKEN' });
	await expect(recap).toBeVisible();
	await expect(recap.getByText('SHATTERED BY BOT 4')).toBeVisible();
	await expect(recap.getByText('−21')).toBeVisible();
	await expect(recap.getByText('84')).toBeVisible();
	await expect(recap.getByText('EMPTIED')).toBeVisible();
	await expect(page.getByRole('group', { name: 'Touch game controls' })).toHaveCount(0);

	const hasHorizontalOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth
	);
	expect(hasHorizontalOverflow).toBe(false);
});

test('plays immediately with bots, admits a friend mid-round, and keeps playing after departure', async ({
	browser,
	page
}) => {
	await page.goto('/');
	await page.getByLabel('CALLSIGN').fill('Alice');
	await page.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
	await expect(page.getByText('ARENA SERVER LIVE', { exact: true })).toBeVisible();
	await expect(page.locator('.leader-row').filter({ hasText: 'Bot' })).toHaveCount(7);
	const link = await page.getByRole('link', { name: /^ARENA / }).getAttribute('href');
	expect(link).toContain('?arena=');
	await expect.poll(() => page.locator('.round-clock strong').innerText()).not.toBe('5:00');
	const friend = await browser.newPage();
	await friend.goto(new URL(link!, page.url()).href);
	await friend.getByLabel('CALLSIGN').fill('Bob');
	await friend.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
	await expect(friend.getByText('ARENA SERVER LIVE', { exact: true })).toBeVisible();
	await expect(page.locator('.leader-row').filter({ hasText: 'Bob' })).toBeVisible();
	await expect(friend.locator('.leader-row').filter({ hasText: 'Alice' })).toBeVisible();
	await expect(page.locator('.leader-row').filter({ hasText: 'Bot' })).toHaveCount(6);
	await expect(friend.locator('.round-clock strong')).not.toHaveText('5:00');
	await friend.keyboard.press('Space');
	await expect(friend.locator('.power-card strong')).toHaveText('10');
	await page.close();
	await expect(friend.locator('.leader-row').filter({ hasText: 'Bot' })).toHaveCount(7);
	await expect(friend.getByText('ARENA SERVER LIVE', { exact: true })).toBeVisible();
	await expect(friend.locator('.leader-row')).toHaveCount(8);
	await friend.getByRole('button', { name: 'LEAVE ARENA' }).click();
	await expect(friend.getByRole('heading', { name: 'GRINDION' })).toBeVisible();
	await friend.close();
});

test('snaps to the closest legal circle beyond the old hit radius', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();
	const { toScreen } = await arenaProjection(page);
	const hero = toScreen(720, 551.25);
	const first = toScreen(787.5, 483.75);
	const squareCorner = toScreen(821, 449.75);
	const nearSecond = toScreen(855, 441.75);
	const overlap = toScreen(822.5, 483.75);
	await page.mouse.move(hero.x, hero.y);
	await page.mouse.down();
	await page.mouse.move(first.x, first.y);
	await expect(page.locator('.chain-status span')).toHaveText('1×');
	// This corner is inside a 68-unit square, but outside both circular targets.
	await page.mouse.move(squareCorner.x, squareCorner.y);
	await expect(page.locator('.chain-status span')).toHaveText('1×');
	await page.mouse.move(nearSecond.x, nearSecond.y);
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	// In the overlap, the closer current endpoint wins over the earlier node.
	await page.mouse.move(overlap.x, overlap.y);
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.mouse.move(first.x, first.y);
	await expect(page.locator('.chain-status span')).toHaveText('1×');
	await page.mouse.up();
});

test('draws a selected path without waiting for a simulation tick', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();
	const { toScreen } = await arenaProjection(page);
	await page.evaluate(() => {
		const raf = window.requestAnimationFrame.bind(window);
		const frozen = performance.now();
		window.requestAnimationFrame = (callback) => raf(() => callback(frozen));
		const lineTo = CanvasRenderingContext2D.prototype.lineTo;
		const stroke = CanvasRenderingContext2D.prototype.stroke;
		let endpoint = false;
		CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
			endpoint = x === 787.5 && y === 483.75;
			lineTo.call(this, x, y);
		};
		CanvasRenderingContext2D.prototype.stroke = function () {
			if (endpoint && this.lineWidth === 17) document.documentElement.dataset.pathDrawn = 'true';
			Reflect.apply(stroke, this, []);
		};
	});
	const hero = toScreen(720, 551.25);
	const first = toScreen(787.5, 483.75);
	await page.mouse.move(hero.x, hero.y);
	await page.mouse.down();
	await page.mouse.move(first.x, first.y);
	await expect(page.locator('html')).toHaveAttribute('data-path-drawn', 'true');
	await expect(page.locator('.chain-status span')).toHaveText('1×');
});

for (const accepted of [true, false]) {
	test(`animates an online release before acknowledgement and reconciles ${accepted ? 'acceptance' : 'rejection'}`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const state = createGame({ players: [{ id: 'human' }], config: LIVE_ARENA_CONFIG });
		const human = state.players.human!;
		const origin = Object.values(state.arena.monsters).reduce((a, b) =>
			Math.hypot(a.position.x - 720, a.position.y - 550) <
			Math.hypot(b.position.x - 720, b.position.y - 550)
				? a
				: b
		);
		human.cellId = origin.id;
		human.position = { ...origin.position };
		origin.alive = false;
		const route = configureTutorialRoute(state, 'human', 'coral');
		let socket: WebSocketRoute;
		const intents: GameIntent[] = [];
		await page.routeWebSocket('**/api/arena?*', (ws) => {
			socket = ws;
			ws.onMessage((message) => intents.push(JSON.parse(String(message))));
			ws.send(JSON.stringify({ type: 'start', state, playerId: 'human', code: 'ABCDE2' }));
			ws.send(
				JSON.stringify({
					type: 'snapshot',
					state: compactSnapshot(state),
					processedSequences: {},
					events: []
				})
			);
		});
		await page.goto('/');
		await page.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
		const { toScreen } = await arenaProjection(page);
		await page.evaluate(() => {
			const ellipse = CanvasRenderingContext2D.prototype.ellipse;
			CanvasRenderingContext2D.prototype.ellipse = function (...args) {
				if (args[2] === 26) {
					document.documentElement.dataset.heroX = String(args[0]);
					document.documentElement.dataset.heroY = String(args[1] - 24);
				}
				Reflect.apply(ellipse, this, args);
			};
		});
		const start = toScreen(human.position.x, human.position.y);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		for (const id of route) {
			const point = toScreen(
				state.arena.monsters[id]!.position.x,
				state.arena.monsters[id]!.position.y
			);
			await page.mouse.move(point.x, point.y, { steps: 3 });
		}
		await expect(page.locator('.chain-status span')).toHaveText('3×');
		await page.mouse.up();
		await expect
			.poll(async () => {
				const x = Number(await page.locator('html').getAttribute('data-hero-x'));
				const y = Number(await page.locator('html').getAttribute('data-hero-y'));
				return Math.hypot(x - human.position.x, y - human.position.y);
			})
			.toBeGreaterThan(5);
		await expect(page.locator('.power-card strong')).toHaveText('15');
		await expect.poll(() => intents.at(-1)?.type).toBe('chain-commit');
		const result = stepGame(state, accepted ? intents : [], 50);
		result.state.tick = 1;
		socket!.send(
			JSON.stringify({
				type: 'snapshot',
				state: compactSnapshot(result.state),
				events: result.events,
				processedSequences: { human: intents.at(-1)!.sequence }
			})
		);
		await expect(page.locator('.power-card strong')).toHaveText(accepted ? '30' : '15');
		const destination = result.state.players.human!.position;
		await expect
			.poll(async () => Number(await page.locator('html').getAttribute('data-hero-x')))
			.toBeCloseTo(destination.x, 1);
		await expect
			.poll(async () => Number(await page.locator('html').getAttribute('data-hero-y')))
			.toBeCloseTo(destination.y, 1);
	});
}

test('shows score and evolution progress from the authoritative snapshot', async ({
	page
}, testInfo) => {
	const state = createGame({ players: [{ id: 'human' }] });
	state.players.human!.score = 32;
	await page.routeWebSocket('**/api/arena?*', (ws) => {
		ws.send(JSON.stringify({ type: 'start', state, playerId: 'human', code: 'ABCDE2' }));
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
	await expect(page.locator('.score-card')).toHaveAttribute('aria-label', 'Score 32, Wanderer');
	await expect(page.locator('.score-card strong')).toHaveText('32');
	await expect(page.locator('.score-card .meter em')).toHaveAttribute('style', 'width: 64%;');
	await expect(page.locator('.form-info')).toContainText('NEXT FORM AT 50');
	await page.screenshot({ path: testInfo.outputPath('score-hud.png'), fullPage: true });
});

test('renders every hero form and follows score loss from a server snapshot', async ({
	page
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.addInitScript(() => {
		const drawImage = CanvasRenderingContext2D.prototype.drawImage;
		CanvasRenderingContext2D.prototype.drawImage = function (
			this: CanvasRenderingContext2D,
			...args: unknown[]
		) {
			const source = args[0];
			if (source instanceof HTMLImageElement && source.src.endsWith('/grindion-hero-forms.png')) {
				const frame = `${args[1]},${args[2]}`;
				const frames = new Set((document.documentElement.dataset.heroForms ?? '').split('|'));
				frames.add(frame);
				document.documentElement.dataset.heroForms = [...frames].sort().join('|');
			}
			Reflect.apply(drawImage, this, args);
		};
	});
	const state = createGame({
		players: [{ id: 'human' }, { id: 'runner' }, { id: 'knight' }, { id: 'grindion' }]
	});
	const scores = [0, 50, 150, 300];
	Object.values(state.players).forEach((player, index) => {
		player.score = scores[index]!;
		player.position = { x: 615 + (index % 2) * 150, y: 415 + Math.floor(index / 2) * 150 };
	});
	let socket: WebSocketRoute;
	await page.routeWebSocket('**/api/arena?*', (ws) => {
		socket = ws;
		ws.send(JSON.stringify({ type: 'start', state, playerId: 'human', code: 'ABCDE2' }));
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
	await expect
		.poll(
			async () =>
				(await page.locator('html').getAttribute('data-hero-forms'))?.split('|').filter(Boolean)
					.length
		)
		.toBe(4);
	await expect(page.getByRole('img', { name: 'Wanderer', exact: true })).toBeVisible();
	await expect(page.locator('.form-info')).toContainText('NEXT FORM AT 50');
	await arenaProjection(page);
	await page.screenshot({ path: testInfo.outputPath('hero-evolution-forms.png'), fullPage: true });

	for (const [score, name, next] of [
		[50, 'Chainrunner', 'NEXT FORM AT 150'],
		[150, 'Grindknight', 'NEXT FORM AT 300'],
		[300, 'Grindion', 'FINAL FORM'],
		[240, 'Grindknight', 'NEXT FORM AT 300'],
		[0, 'Wanderer', 'NEXT FORM AT 50']
	] as const) {
		state.tick++;
		state.players.human!.score = score;
		socket!.send(
			JSON.stringify({
				type: 'snapshot',
				state: compactSnapshot(state),
				events: [],
				processedSequences: {}
			})
		);
		await expect(page.getByRole('img', { name, exact: true })).toBeVisible();
		await expect(page.locator('.form-info')).toContainText(next);
	}
});

for (const controls of ['pointer', 'keyboard', 'touch'] as const) {
	test(`finishes a chain on an opponent with ${controls} controls`, async ({ page }, testInfo) => {
		await page.setViewportSize(
			controls === 'touch' ? { width: 390, height: 844 } : { width: 1440, height: 900 }
		);
		const state = createGame({ players: [{ id: 'human' }, { id: 'victim', name: 'Target' }] });
		state.timeMs = 3000;
		const human = state.players.human!;
		const origin = state.arena.monsters.m97!;
		human.cellId = origin.id;
		human.position = { ...origin.position };
		human.score = 50;
		human.power = 40;
		origin.alive = false;
		const route = configureTutorialRoute(state, 'human', 'coral');
		const tail = state.arena.monsters[route.at(-1)!]!;
		const cell = tail.neighborIds
			.map((id) => state.arena.monsters[id]!)
			.find((cell) => !route.includes(cell.id) && cell.id !== origin.id)!;
		cell.alive = false;
		Object.assign(state.players.victim!, {
			cellId: cell.id,
			position: { ...cell.position },
			protectedUntilMs: 0
		});
		let socket: WebSocketRoute;
		const intents: GameIntent[] = [];
		await page.routeWebSocket('**/api/arena?*', (ws) => {
			socket = ws;
			ws.onMessage((message) => intents.push(JSON.parse(String(message))));
			ws.send(JSON.stringify({ type: 'start', state, playerId: 'human', code: 'ABCDE2' }));
		});
		await page.goto('/');
		await page.getByRole('button', { name: 'JOIN ONLINE ARENA' }).click();
		const { toScreen } = await arenaProjection(page);
		if (controls === 'keyboard') {
			const keys: Record<string, string> = {
				'-1,-1': '7',
				'0,-1': '8',
				'1,-1': '9',
				'-1,0': '4',
				'1,0': '6',
				'-1,1': '1',
				'0,1': '2',
				'1,1': '3'
			};
			let previous = origin.position;
			for (const next of [
				...route.map((id) => state.arena.monsters[id]!.position),
				cell.position
			]) {
				await page.keyboard.press(
					keys[`${Math.sign(next.x - previous.x)},${Math.sign(next.y - previous.y)}`]!
				);
				previous = next;
			}
		} else {
			const start = toScreen(human.position.x, human.position.y);
			await page.mouse.move(start.x, start.y);
			await page.mouse.down();
			for (const next of [
				...route.map((id) => state.arena.monsters[id]!.position),
				cell.position
			]) {
				const point = toScreen(next.x, next.y);
				await page.mouse.move(point.x, point.y, { steps: 4 });
			}
		}
		await expect
			.poll(() =>
				intents.some((intent) => intent.type === 'chain-target' && intent.targetId === 'victim')
			)
			.toBe(true);
		if (controls !== 'keyboard')
			await expect(page.locator('.chain-status')).toContainText('RELEASE TO STRIKE · 20 DMG');
		if (controls === 'keyboard') await page.keyboard.press('Enter');
		else await page.mouse.up();
		await expect.poll(() => intents.at(-1)?.type).toBe('chain-commit');
		const pending = stepGame(state, intents);
		const strike = Object.values(pending.state.chainStrikes)[0]!;
		expect(strike).toBeDefined();
		expect(pending.state.players.human!.power).toBe(40);
		socket!.send(
			JSON.stringify({
				type: 'snapshot',
				state: compactSnapshot(pending.state),
				events: pending.events,
				processedSequences: {}
			})
		);
		await expect(page.getByRole('status')).toContainText('STRIKE COMMITTED · −15 POWER');
		await arenaProjection(page);
		await page.screenshot({
			path: testInfo.outputPath(`chain-strike-${controls}.png`),
			fullPage: true
		});
		const hit = stepGame(pending.state, [], strike.hitAtMs - pending.state.timeMs);
		expect(hit.state.players.victim!.health).toBe(80);
		socket!.send(
			JSON.stringify({
				type: 'snapshot',
				state: compactSnapshot(hit.state),
				events: hit.events,
				processedSequences: {}
			})
		);
		await expect(page.locator('.event-feed')).toContainText('STRIKE HIT');
	});
}

test('keeps Retina arena rendering within the pixel budget', async ({ browser }) => {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2
	});
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();
	await expect
		.poll(() =>
			page
				.locator('canvas')
				.evaluate(
					(canvas: HTMLCanvasElement) => canvas.width / canvas.getBoundingClientRect().width
				)
		)
		.toBeCloseTo(1.5, 2);
	await page.close();
});
