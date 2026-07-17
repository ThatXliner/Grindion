import { expect, test } from '@playwright/test';

test('starts a live arena and spends all Power on a shot', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'GRINDION' })).toBeVisible();

	await page.getByRole('button', { name: 'ENTER ARENA ⚔' }).click();
	await expect(page.getByText('SIMULATION LIVE')).toBeVisible();
	await expect(page.getByText('8 ACTIVE')).toBeVisible();
	await expect(page.getByText('Chain 5 of one color to unlock one rainbow switch.')).toBeVisible();

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
	await page.getByRole('button', { name: 'PLAY TUTORIAL ▶' }).click();
	await expect(page.getByText('LESSON 1 / 7')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();
	await expect(page.getByText('TRAINING MODE')).toBeVisible();
	await expect(page.locator('.player-hud')).toHaveCount(0);
	await expect(page.locator('.side-panel')).toHaveCount(0);
	await expect(page.locator('.quick-controls')).toHaveCount(0);
	await expect(page.getByText(/Press and hold on your hero/)).toBeVisible();

	const canvas = page.locator('canvas');
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	const worldToScreen = (x: number, y: number) => ({
		x: box!.x + box!.width / 2 + ((x - 720) * box!.width) / 570,
		y: box!.y + box!.height / 2 + ((y - 551.25) * box!.width) / 570
	});
	const route = [
		worldToScreen(720, 483.75),
		worldToScreen(787.5, 483.75),
		worldToScreen(787.5, 551.25)
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
	await expect(page.getByRole('heading', { name: 'Read your reach' })).toBeVisible();
	await expect(page.getByText('DASHED RING = CURRENT REACH')).toBeVisible();
	await expect(page.locator('.score-card')).toContainText('RANGE');
	await expect(page.locator('.power-card')).toHaveCount(0);
	await page.getByRole('button', { name: 'BUILD POWER →' }).click();
	await expect(page.getByRole('heading', { name: 'Charge Power' })).toBeVisible();
	await expect(page.locator('.power-card')).toBeVisible();
	await expect(page.locator('.heart-hud')).toHaveCount(0);
});

test('provides complete touch controls on a phone viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: 'ENTER ARENA ⚔' }).click();

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
