/** Small serializable PRNG; the returned state makes replays deterministic. */
export function randomFrom(state: number): { value: number; state: number } {
	let next = state | 0;
	next ^= next << 13;
	next ^= next >>> 17;
	next ^= next << 5;
	return { value: (next >>> 0) / 4_294_967_296, state: next | 0 };
}
export function hashSeed(seed: number, salt: number): number {
	let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) | 0;
	value ^= value >>> 16;
	value = Math.imul(value, 0x21f0aaad);
	value ^= value >>> 15;
	return value || 0x6d2b79f5;
}
