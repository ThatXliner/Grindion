<script lang="ts">
	import { tick } from 'svelte';

	// ?v= busts caches whenever the film is replaced (v5: hybrid trailer with score-era gameplay).
	const VIDEO_SRC = '/assets/grindion-cinematic.mp4?v=5';
	const POSTER_SRC = '/assets/grindion-cinematic-poster.jpg?v=5';

	// The video element (and its download) only exists after a deliberate click.
	let playing = $state(false);
	let posterFailed = $state(false);
	let video: HTMLVideoElement | undefined = $state();

	async function play() {
		playing = true;
		await tick();
		video?.focus();
		try {
			await video?.play();
		} catch {
			// Playback was refused (rare after a click); the native controls stay available.
		}
	}
</script>

<section class="trailer" aria-labelledby="trailer-title" data-trailer>
	<div class="copy">
		<span class="eyebrow">TRAILER · 0:28</span>
		<h2 id="trailer-title">Playable Echo</h2>
		<p>Chain monsters, build Power, and turn the fight with one perfect parry.</p>
	</div>

	<div class="screen">
		{#if playing}
			<!-- The trailer has no dialogue; music and effects only. -->
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={video}
				src={VIDEO_SRC}
				poster={POSTER_SRC}
				controls
				playsinline
				preload="auto"
				aria-label="Grindion trailer"
			></video>
		{:else}
			<button
				class="poster"
				type="button"
				onclick={play}
				aria-label="Play the Grindion trailer, 28 seconds, with sound"
			>
				{#if !posterFailed}
					<img
						src={POSTER_SRC}
						alt=""
						loading="lazy"
						decoding="async"
						width="1280"
						height="720"
						onerror={() => (posterFailed = true)}
					/>
				{/if}
				<span class="shade" aria-hidden="true"></span>
				<span class="play" aria-hidden="true"><i></i></span>
				<span class="label" aria-hidden="true">PLAY TRAILER</span>
			</button>
		{/if}
	</div>
</section>

<style>
	.trailer {
		display: grid;
		grid-template-columns: minmax(200px, 0.75fr) minmax(0, 2fr);
		align-items: center;
		gap: 20px;
		width: 100%;
		margin-top: 6px;
		padding: 18px;
		background: rgba(18, 12, 34, 0.9);
		border: 2px solid var(--line, #3a2d6a);
		border-radius: 6px;
		box-shadow:
			0 4px 0 rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		animation: rise 600ms 240ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.copy {
		display: grid;
		gap: 8px;
		align-content: center;
	}
	.eyebrow {
		color: var(--energy, #7ff3ff);
		font: 600 12px/1 var(--font-pixel, monospace);
		letter-spacing: 0.12em;
	}
	h2 {
		margin: 0;
		color: var(--gold, #ffd25e);
		font: 700 clamp(32px, 4vw, 44px) / 1 var(--font-pixel, monospace);
		letter-spacing: 0.02em;
		text-shadow:
			0 2px 0 #7a3b12,
			0 4px 0 #000;
	}
	p {
		margin: 0;
		color: var(--muted, #b9a8d9);
		font-size: 15px;
		line-height: 1.45;
	}
	.screen {
		position: relative;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border: 2px solid rgba(170, 140, 255, 0.35);
		border-radius: 8px;
		background: #07050f url('/assets/grindion-banner.webp') center / cover no-repeat;
		box-shadow:
			0 0 0 4px rgba(7, 5, 15, 0.6),
			0 14px 40px rgba(0, 0, 0, 0.45);
	}
	video {
		display: block;
		width: 100%;
		height: 100%;
		background: #000;
	}
	.poster {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.poster img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		image-rendering: pixelated;
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(7, 5, 15, 0) 55%, rgba(7, 5, 15, 0.7));
		transition: background 160ms;
	}
	.play {
		position: relative;
		display: grid;
		place-items: center;
		width: 84px;
		height: 84px;
		background: var(--gold, #ffd25e);
		border: 3px solid #0b0716;
		border-radius: 10px;
		box-shadow:
			inset 0 -6px 0 #c78a1c,
			0 5px 0 rgba(0, 0, 0, 0.45);
		transition: transform 120ms;
	}
	.play i {
		display: block;
		width: 0;
		height: 0;
		margin-left: 8px;
		border-top: 17px solid transparent;
		border-bottom: 17px solid transparent;
		border-left: 26px solid #0b0716;
	}
	.label {
		position: absolute;
		left: 14px;
		bottom: 12px;
		padding: 7px 10px;
		color: var(--ink, #fff1c4);
		background: rgba(11, 7, 22, 0.85);
		border-left: 3px solid var(--gold, #ffd25e);
		border-radius: 0 4px 4px 0;
		font: 700 13px/1 var(--font-pixel, monospace);
		letter-spacing: 0.08em;
	}
	.poster:hover .play {
		transform: translateY(-2px) scale(1.04);
	}
	.poster:hover .shade {
		background: linear-gradient(180deg, rgba(7, 5, 15, 0) 40%, rgba(7, 5, 15, 0.55));
	}
	.poster:active .play {
		transform: translateY(2px);
	}
	.poster:focus-visible {
		outline: 3px solid var(--energy, #7ff3ff);
		outline-offset: -5px;
	}
	video:focus-visible {
		outline: 3px solid var(--energy, #7ff3ff);
		outline-offset: -3px;
	}
	@media (max-width: 760px) {
		.trailer {
			grid-template-columns: 1fr;
			gap: 14px;
			padding: 14px;
		}
		.play {
			width: 68px;
			height: 68px;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.trailer {
			animation: none;
		}
		.play,
		.shade {
			transition: none;
		}
	}
</style>
