import { describe, expect, it } from 'vitest';
import { canExtendWithColor, grindstoneState } from './chainRules';

describe('grindstone color switching', () => {
	it('holds one rainbow switch until an off-color monster consumes it', () => {
		expect(grindstoneState(['coral', 'coral', 'coral', 'coral', 'coral'])).toMatchObject({
			activeColor: 'coral',
			streak: 5,
			ready: true
		});
		expect(canExtendWithColor(Array(8).fill('coral'), 'cyan')).toBe(true);
		expect(grindstoneState(['coral', 'coral', 'coral', 'coral', 'coral', 'cyan'])).toMatchObject({
			activeColor: 'cyan',
			streak: 1,
			ready: false
		});
	});

	it('does not allow an early switch', () => {
		expect(canExtendWithColor(['gold', 'gold', 'gold', 'gold'], 'cyan')).toBe(false);
		expect(canExtendWithColor(['gold', 'gold', 'gold', 'gold'], 'gold')).toBe(true);
	});
});
