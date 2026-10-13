/**
 * Render-only juice: particles, floating numbers, screen shake, and flashes.
 * None of this feeds back into the deterministic simulation.
 */

type Point = { x: number; y: number };

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	size: number;
	color: string;
	gravity: number;
}

interface Floater {
	x: number;
	y: number;
	text: string;
	color: string;
	/** Milliseconds before the floater appears; lets popups wait for chain traversal. */
	delay: number;
	age: number;
	life: number;
	size: number;
}

interface Ring {
	x: number;
	y: number;
	color: string;
	age: number;
	life: number;
	from: number;
	to: number;
	width: number;
}

const MAX_PARTICLES = 600;

export class Effects {
	particles: Particle[] = [];
	floaters: Floater[] = [];
	rings: Ring[] = [];
	shake = 0;
	flash: { color: string; age: number; life: number } | null = null;

	burst(
		at: Point,
		color: string,
		count = 14,
		{ speed = 180, size = 4, life = 520, gravity = 380 } = {}
	) {
		for (let index = 0; index < count && this.particles.length < MAX_PARTICLES; index++) {
			const angle = Math.random() * Math.PI * 2;
			const velocity = speed * (0.35 + Math.random() * 0.65);
			this.particles.push({
				x: at.x,
				y: at.y,
				vx: Math.cos(angle) * velocity,
				vy: Math.sin(angle) * velocity - speed * 0.35,
				age: 0,
				life: life * (0.6 + Math.random() * 0.4),
				size: Math.max(2, Math.round(size * (0.6 + Math.random() * 0.6))),
				color,
				gravity
			});
		}
	}

	ring(at: Point, color: string, { from = 10, to = 60, life = 380, width = 4 } = {}) {
		this.rings.push({ x: at.x, y: at.y, color, age: 0, life, from, to, width });
	}

	float(at: Point, text: string, color: string, { delay = 0, size = 1 } = {}) {
		this.floaters.push({ x: at.x, y: at.y, text, color, delay, age: 0, life: 1100, size });
	}

	kick(amount: number) {
		this.shake = Math.max(this.shake, amount);
	}

	flashScreen(color: string, life = 260) {
		this.flash = { color, age: 0, life };
	}

	update(dtMs: number) {
		const dt = dtMs / 1000;
		for (const particle of this.particles) {
			particle.age += dtMs;
			particle.vy += particle.gravity * dt;
			particle.vx *= 0.985;
			particle.x += particle.vx * dt;
			particle.y += particle.vy * dt;
		}
		this.particles = this.particles.filter((particle) => particle.age < particle.life);
		for (const floater of this.floaters) {
			if (floater.delay > 0) floater.delay -= dtMs;
			else floater.age += dtMs;
		}
		this.floaters = this.floaters.filter((floater) => floater.age < floater.life);
		for (const ring of this.rings) ring.age += dtMs;
		this.rings = this.rings.filter((ring) => ring.age < ring.life);
		this.shake = Math.max(0, this.shake - dtMs * 0.045);
		if (this.flash) {
			this.flash.age += dtMs;
			if (this.flash.age >= this.flash.life) this.flash = null;
		}
	}

	shakeOffset(): Point {
		if (this.shake < 0.2) return { x: 0, y: 0 };
		return {
			x: (Math.random() * 2 - 1) * this.shake,
			y: (Math.random() * 2 - 1) * this.shake
		};
	}

	/** Draws particles, rings, and floaters in world space. */
	drawWorld(context: CanvasRenderingContext2D) {
		context.save();
		for (const ring of this.rings) {
			const t = ring.age / ring.life;
			const eased = 1 - (1 - t) ** 3;
			context.globalAlpha = 1 - t;
			context.strokeStyle = ring.color;
			context.lineWidth = ring.width * (1 - t * 0.6);
			context.beginPath();
			context.arc(ring.x, ring.y, ring.from + (ring.to - ring.from) * eased, 0, Math.PI * 2);
			context.stroke();
		}
		for (const particle of this.particles) {
			context.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
			context.fillStyle = particle.color;
			const half = particle.size / 2;
			context.fillRect(
				Math.round(particle.x - half),
				Math.round(particle.y - half),
				particle.size,
				particle.size
			);
		}
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		for (const floater of this.floaters) {
			if (floater.delay > 0) continue;
			const t = floater.age / floater.life;
			const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - Math.min(0.15, (t - 0.15) * 0.5);
			const rise = 46 * (1 - (1 - t) ** 2);
			context.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
			context.font = `700 ${Math.round(20 * floater.size * pop)}px "Pixelify Sans", monospace`;
			context.lineWidth = 5;
			context.strokeStyle = '#0b0716';
			context.strokeText(floater.text, floater.x, floater.y - 28 - rise);
			context.fillStyle = floater.color;
			context.fillText(floater.text, floater.x, floater.y - 28 - rise);
		}
		context.restore();
	}

	/** Draws full-screen flashes in screen space. */
	drawScreen(context: CanvasRenderingContext2D, width: number, height: number) {
		if (!this.flash) return;
		const t = this.flash.age / this.flash.life;
		const gradient = context.createRadialGradient(
			width / 2,
			height / 2,
			Math.min(width, height) * 0.25,
			width / 2,
			height / 2,
			Math.max(width, height) * 0.75
		);
		gradient.addColorStop(0, 'transparent');
		gradient.addColorStop(1, this.flash.color);
		context.save();
		context.globalAlpha = 0.55 * (1 - t);
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);
		context.restore();
	}

	clear() {
		this.particles = [];
		this.floaters = [];
		this.rings = [];
		this.shake = 0;
		this.flash = null;
	}
}
