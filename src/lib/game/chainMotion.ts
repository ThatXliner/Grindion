export interface ChainMotionTiming {
	segmentStarts: number[];
	segmentDurations: number[];
	arrivalTimes: number[];
	totalMs: number;
}

export interface ChainMotionSample {
	segment: number;
	progress: number;
	complete: boolean;
}

/** A weighty opening cadence that accelerates toward a readable minimum beat. */
export function createChainMotionTiming(length: number): ChainMotionTiming {
	const count = Math.max(0, Math.floor(length));
	const segmentStarts: number[] = [];
	const segmentDurations: number[] = [];
	const arrivalTimes: number[] = [];
	let cursor = 0;
	for (let index = 0; index < count; index++) {
		const duration = Math.max(72, Math.round(205 * 0.86 ** index));
		const travelMs = Math.max(42, Math.round(duration * 0.45));
		segmentStarts.push(cursor);
		segmentDurations.push(duration);
		arrivalTimes.push(cursor + travelMs);
		cursor += duration;
	}
	return { segmentStarts, segmentDurations, arrivalTimes, totalMs: cursor };
}

export function sampleChainMotion(timing: ChainMotionTiming, elapsedMs: number): ChainMotionSample {
	if (!timing.segmentDurations.length) return { segment: 0, progress: 1, complete: true };
	const elapsed = Math.max(0, elapsedMs);
	for (let segment = 0; segment < timing.segmentDurations.length; segment++) {
		const start = timing.segmentStarts[segment]!;
		const duration = timing.segmentDurations[segment]!;
		if (elapsed < start + duration) {
			const travelMs = timing.arrivalTimes[segment]! - start;
			return {
				segment,
				progress: Math.min(1, (elapsed - start) / travelMs),
				complete: false
			};
		}
	}
	return { segment: timing.segmentDurations.length - 1, progress: 1, complete: true };
}
