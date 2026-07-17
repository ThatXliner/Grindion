import { expect, test } from '@playwright/test';

test('starts a live arena and spends all Power on a shot', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'GRINDION' })).toBeVisible();

	await page.getByRole('button', { name: 'ENTER ARENA ⚔' }).click();
	await expect(page.getByText('SIMULATION LIVE')).toBeVisible();
	await expect(page.getByText('8 ACTIVE')).toBeVisible();

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
	await expect(page.getByText('LESSON 1 / 6')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Choose a route' })).toBeVisible();
	await expect(page.getByText('2 ACTIVE')).toBeVisible();

	const canvas = page.locator('canvas');
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	const worldToScreen = (x: number, y: number) => ({
		x: box!.x + box!.width / 2 + ((x - 720) * box!.width) / 570,
		y: box!.y + box!.height / 2 + ((y - 580) * box!.width) / 570
	});
	const route = [
		worldToScreen(630, 483.64),
		worldToScreen(720, 483.64),
		worldToScreen(810, 483.64)
	];
	await page.mouse.move(route[0]!.x, route[0]!.y);
	await page.mouse.down();
	await page.mouse.move(route[1]!.x, route[1]!.y, { steps: 5 });
	await page.mouse.move(route[2]!.x, route[2]!.y, { steps: 5 });
	await expect(page.getByRole('heading', { name: 'Move + bank' })).toBeVisible();
	await page.mouse.up();
	await expect(page.getByRole('heading', { name: 'Charge Power' })).toBeVisible();
});
