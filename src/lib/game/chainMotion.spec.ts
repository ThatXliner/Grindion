import { describe, expect, it } from 'vitest';
import { createChainMotionTiming, sampleChainMotion } from './chainMotion';

describe('chain smash cadence', () => {
	it('starts slowly, accelerates, and keeps a readable minimum beat', () => {
		const timing = createChainMotionTiming(16);
		expect(timing.segmentDurations.slice(0, 4)).toEqual([205, 176, 152, 130]);
		expect(timing.segmentDurations.at(-1)).toBe(72);
		for (let index = 1; index < timing.segmentDurations.length; index++) {
			expect(timing.segmentDurations[index]).toBeLessThanOrEqual(
				timing.segmentDurations[index - 1]!
			);
		}
	});

	it('arrives early in each beat and pauses on the smashed monster', () => {
		const timing = createChainMotionTiming(3);
		const firstArrival = timing.arrivalTimes[0]!;
		expect(sampleChainMotion(timing, firstArrival)).toMatchObject({ segment: 0, progress: 1 });
		expect(sampleChainMotion(timing, firstArrival + 40)).toMatchObject({
			segment: 0,
			progress: 1
		});
		expect(sampleChainMotion(timing, timing.segmentStarts[1]!)).toMatchObject({
			segment: 1,
			progress: 0
		});
	});
});
