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
	await expect(page.getByText(/Press on your hero/)).toBeVisible();

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
