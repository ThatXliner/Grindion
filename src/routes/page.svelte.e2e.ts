import { expect, test, type Page } from '@playwright/test';

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
	await page.getByText('PRIVATE ROOMS').click();
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

test('starts a live arena and spends all Power on a shot', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'GRINDION' })).toBeVisible();

	await page.getByRole('button', { name: /SOLO ARENA/ }).click();
	await expect(page.getByText('SIMULATION LIVE')).toBeVisible();
	await expect(page.getByText('8 ACTIVE')).toBeVisible();
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
	await expect(page.getByText('RELEASE TO FIRE ALL 15 POWER')).toBeVisible();
	await page.mouse.up({ button: 'right' });
	await expect(page.getByText('POWER COMMITTED')).toBeVisible();
	await expect(page.locator('.power-card strong')).toHaveText('0');
});

test('offers a deterministic guided tutorial', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await page.getByRole('button', { name: /PLAY TUTORIAL/ }).click();
	await expect(page.getByText('LESSON 1 / 7')).toBeVisible();
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
	await expect(page.getByRole('heading', { name: 'Move + bank' })).toBeVisible();
	await page.mouse.move(route[1]!.x, route[1]!.y, { steps: 5 });
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.mouse.move(route[2]!.x, route[2]!.y, { steps: 5 });
	await expect(page.locator('.chain-status span')).toHaveText('3×');
	await expect(page.locator('.score-card')).toBeVisible();
	await expect(page.locator('.power-card')).toHaveCount(0);
	await page.mouse.up();
	await expect(page.getByRole('heading', { name: 'Grow tougher' })).toBeVisible();
	await expect(page.getByText('ADJACENT PATHS · UNLIMITED DISTANCE')).toBeVisible();
	await expect(page.locator('.score-card')).toContainText('NO PATH LIMIT');
	await expect(page.locator('.power-card')).toHaveCount(0);
	await page.getByRole('button', { name: 'BUILD POWER →' }).click();
	await expect(page.getByRole('heading', { name: 'Charge Power' })).toBeVisible();
	await expect(page.locator('.power-card')).toBeVisible();
	await expect(page.locator('.heart-hud')).toHaveCount(0);
});

test('starts, chains, revises, and banks with zero pointer input', async ({ page }) => {
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
	await expect(page.getByRole('heading', { name: 'Move + bank' })).toBeVisible();

	// The reverse direction selects an earlier monster, shortening the planned route.
	await page.keyboard.press('8');
	await expect(page.locator('.chain-status span')).toHaveText('2×');
	await page.keyboard.press('2');
	await expect(page.locator('.chain-status span')).toHaveText('3×');

	await page.keyboard.press('5');
	await expect(page.getByRole('heading', { name: 'Grow tougher' })).toBeVisible();
	await expect(page.locator('.score-card strong')).toHaveText('3');
});

test('right-dragging from the hero stores a chain as Power', async ({ page }) => {
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
	await page.mouse.down({ button: 'right' });
	for (const point of route) await page.mouse.move(point.x, point.y, { steps: 4 });
	await expect(page.locator('.chain-status')).toContainText('STORE POWER');
	await page.mouse.up({ button: 'right' });

	await expect(page.getByText('CHAIN → POWER')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();
});

test('provides complete touch controls on a phone viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: /SOLO ARENA/ }).click();

	const controls = page.getByRole('group', { name: 'Touch game controls' });
	await expect(controls).toBeVisible();
	await expect(page.getByRole('button', { name: 'BANK SCORE' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('button', { name: 'FORGE POWER' }).click();
	await expect(page.getByRole('button', { name: 'FORGE POWER' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByRole('button', { name: 'PARRY' })).toBeVisible();

	await page.getByRole('button', { name: 'AIM + FIRE' }).click();
	await expect(page.getByRole('button', { name: 'CANCEL AIM' })).toBeVisible();
	await expect(page.getByText('RELEASE TO FIRE ALL 15 POWER')).toBeVisible();
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
