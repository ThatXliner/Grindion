<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createBotController,
		createGame,
		maxHealthForScore,
		reachForScore,
		stepGame
	} from '$lib/game';
	import type {
		GameEvent,
		GameIntent,
		GameState,
		Monster,
		MonsterColor,
		PlayerState
	} from '$lib/game';

	type Point = { x: number; y: number };
	type WithoutPlayer<T> = T extends { playerId: string } ? Omit<T, 'playerId'> : never;
	type HumanIntent = WithoutPlayer<GameIntent>;
	type GameMode = 'title' | 'arena' | 'tutorial';

	const TUTORIAL_STEPS = [
		{ title: 'Choose a route', copy: 'Drag through the 3 glowing coral creatures.' },
		{ title: 'Move + bank', copy: 'Release to claim Score and land on the final creature.' },
		{
			title: 'Charge Power',
			copy: 'Build another chain. Hold Shift as you release to convert it to Power.'
		},
		{
			title: 'Take the shot',
			copy: 'Hold right mouse to scout and aim. Release to fire every volt.'
		},
		{ title: 'Parry', copy: 'The dummy is firing. Press Space just before the shot reaches you.' },
		{
			title: 'Training complete',
			copy: 'You know the loop. Enter the live arena when you are ready.'
		}
	] as const;

	let canvas: HTMLCanvasElement;
	let game = $state<GameState | null>(null);
	let humanId = $state('human');
	let mode = $state<GameMode>('title');
	let isRunning = $state(false);
	let isDragging = $state(false);
	let isAiming = $state(false);
	let pointerWorld = $state<Point>({ x: 720, y: 450 });
	let latestChainMonster = '';
	let commitAfterTick: 'score' | 'power' | null = null;
	let eventFeed = $state<{ id: number; text: string; tone: string }[]>([]);
	let eventId = 0;
	let tutorialStep = $state(0);
	let tutorialShotAt = 0;
	let tutorialRouteIds = $state<string[]>([]);
	let camera = { x: 720, y: 450, viewWidth: 570 };
	let spriteSheet: HTMLImageElement | null = null;
	const SPRITE_FRAMES = [
		{ x: 55, y: 185, width: 305, height: 315 },
		{ x: 414, y: 180, width: 300, height: 315 },
		{ x: 760, y: 185, width: 320, height: 305 },
		{ x: 1165, y: 185, width: 230, height: 310 },
		{ x: 1448, y: 235, width: 285, height: 220 },
		{ x: 1740, y: 180, width: 300, height: 330 }
	] as const;
	const botController = createBotController(8_172);

	const players = $derived(game ? Object.values(game.players) : []);
	const monsters = $derived(game ? Object.values(game.arena.monsters) : []);
	const projectiles = $derived(game ? Object.values(game.projectiles) : []);
	const me = $derived(players.find((player) => player.id === humanId) ?? players[0]);
	const score = $derived(Math.round(me?.score ?? 0));
	const maxHealth = $derived(me?.maxHealth ?? maxHealthForScore(me?.score ?? 0));
	const health = $derived(Math.max(0, me?.health ?? maxHealth));
	const power = $derived(Math.max(0, me?.power ?? 0));
	const reach = $derived(me?.reach ?? reachForScore(me?.score ?? 0));
	const chainLength = $derived(me?.chain.length ?? 0);
	const secondsLeft = $derived(
		Math.max(0, Math.ceil(((game?.roundEndsAtMs ?? 300_000) - (game?.timeMs ?? 0)) / 1000))
	);
	const timerText = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);
	const leaderboard: (PlayerState & { rank: number })[] = $derived(
		[...players]
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			.slice(0, 8)
			.map((player, index) => ({ ...player, rank: index + 1 }))
	);

	function stageTutorialRoute(
		state: GameState,
		color: Exclude<MonsterColor, 'gold'>,
		preferredIds?: string[]
	) {
		const human = state.players.human!;
		const alive = Object.values(state.arena.monsters).filter((monster) => monster.alive);
		for (const monster of alive) monster.color = 'gold';
		const withinReach = (monster: Monster) =>
			Math.hypot(monster.position.x - human.position.x, monster.position.y - human.position.y) <=
			human.reach;
		let route = (preferredIds ?? [])
			.map((id) => state.arena.monsters[id])
			.filter((monster): monster is Monster => Boolean(monster?.alive && withinReach(monster)));
		if (route.length < 3) {
			route = [];
			const candidates = alive
				.filter(withinReach)
				.sort(
					(a, b) =>
						Math.hypot(a.position.x - human.position.x, a.position.y - human.position.y) -
							Math.hypot(b.position.x - human.position.x, b.position.y - human.position.y) ||
						a.id.localeCompare(b.id)
				);
			for (const first of candidates) {
				for (const secondId of first.neighborIds) {
					const second = state.arena.monsters[secondId];
					if (!second?.alive || !withinReach(second)) continue;
					const third = second.neighborIds
						.map((id) => state.arena.monsters[id])
						.find((monster) => monster?.alive && monster.id !== first.id && withinReach(monster));
					if (third) {
						route = [first, second, third];
						break;
					}
				}
				if (route.length === 3) break;
			}
		}
		for (const monster of route) monster.color = color;
		tutorialRouteIds = route.map((monster) => monster.id);
	}

	function prepareTutorial(state: GameState) {
		const human = state.players.human!;
		const dummy = state.players.dummy!;
		human.position = { x: 720, y: 580 };
		human.power = 0;
		dummy.position = { x: 1080, y: 450 };
		dummy.power = 120;
		dummy.protectedUntilMs = Number.POSITIVE_INFINITY;
		stageTutorialRoute(state, 'coral', ['m96', 'm97', 'm98']);
		return state;
	}

	function startArena() {
		game = createGame({ seed: Math.floor(Math.random() * 2 ** 30), botCount: 7 });
		humanId = Object.values(game.players).find((player) => !player.isBot)?.id ?? 'player';
		startSession('arena');
	}

	function startTutorial() {
		game = prepareTutorial(
			createGame({
				seed: 0x4752494e,
				players: [
					{ id: 'human', name: 'You', color: '#ffe36e' },
					{ id: 'dummy', name: 'Training dummy', isBot: true, color: '#ff6b66' }
				],
				config: { roundDurationMs: 600_000, monsterRefillMs: 900 }
			})
		);
		humanId = 'human';
		tutorialStep = 0;
		tutorialShotAt = 0;
		startSession('tutorial');
	}

	function startSession(nextMode: 'arena' | 'tutorial') {
		mode = nextMode;
		eventFeed = [];
		isRunning = true;
		isDragging = false;
		isAiming = false;
		if (game) {
			const position = game.players[humanId]?.position ?? { x: 720, y: 450 };
			camera = { ...position, viewWidth: 570 };
		}
	}

	function addEvent(event: GameEvent) {
		let text = '';
		let tone = 'neutral';
		if (event.type === 'projectile-parried') {
			text = 'PERFECT PARRY';
			tone = 'cyan';
		} else if (event.type === 'projectile-fired' && event.playerId === humanId) {
			text = 'POWER COMMITTED';
			tone = 'coral';
		} else if (event.type === 'player-died') {
			text = 'PLAYER SHATTERED';
			tone = 'coral';
		} else if (event.type === 'chain-committed' && event.playerId === humanId) {
			text = event.conversion === 'power' ? 'CHAIN → POWER' : 'CHAIN BANKED';
			tone = event.conversion === 'power' ? 'violet' : 'acid';
		}
		if (text) eventFeed = [{ id: eventId++, text, tone }, ...eventFeed].slice(0, 3);

		if (mode !== 'tutorial') return;
		if (tutorialStep === 4 && event.type === 'player-damaged' && event.playerId === humanId) {
			const human = game?.players[humanId];
			if (human) {
				human.health = human.maxHealth;
				human.mode = 'neutral';
			}
		}
		if (
			tutorialStep === 1 &&
			event.type === 'chain-committed' &&
			event.playerId === humanId &&
			event.conversion === 'score'
		) {
			if (game) stageTutorialRoute(game, 'cyan');
			tutorialStep = 2;
		} else if (
			tutorialStep === 2 &&
			event.type === 'chain-committed' &&
			event.playerId === humanId &&
			event.conversion === 'power'
		) {
			tutorialRouteIds = [];
			tutorialStep = 3;
		} else if (
			tutorialStep === 3 &&
			event.type === 'projectile-fired' &&
			event.playerId === humanId
		) {
			tutorialStep = 4;
			if (game?.players[humanId]) game.players[humanId]!.power = 15;
			tutorialShotAt = (game?.timeMs ?? 0) + 1100;
		} else if (
			tutorialStep === 4 &&
			event.type === 'projectile-parried' &&
			event.playerId === humanId
		)
			tutorialStep = 5;
	}

	let queuedIntents: GameIntent[] = [];
	function dispatch(intent: HumanIntent) {
		if (game && isRunning) queuedIntents.push({ ...intent, playerId: humanId } as GameIntent);
	}

	function viewport(rect: DOMRect) {
		const viewWidth = camera.viewWidth;
		const viewHeight = viewWidth * (rect.height / rect.width);
		return { viewWidth, viewHeight, scale: rect.width / viewWidth };
	}

	function canvasPoint(event: PointerEvent): Point {
		const rect = canvas.getBoundingClientRect();
		const view = viewport(rect);
		return {
			x: camera.x + (event.clientX - rect.left - rect.width / 2) / view.scale,
			y: camera.y + (event.clientY - rect.top - rect.height / 2) / view.scale
		};
	}

	function nearestMonster(point: Point) {
		let best: Monster | undefined;
		let bestDistance = 35;
		for (const monster of monsters) {
			if (!monster.alive) continue;
			const distance = Math.hypot(monster.position.x - point.x, monster.position.y - point.y);
			if (distance < bestDistance) {
				best = monster;
				bestDistance = distance;
			}
		}
		return best;
	}

	function onPointerDown(event: PointerEvent) {
		if (mode === 'title') return;
		canvas.setPointerCapture(event.pointerId);
		pointerWorld = canvasPoint(event);
		if (event.button === 2) {
			event.preventDefault();
			isAiming = true;
			return;
		}
		if (event.button !== 0) return;
		const monster = nearestMonster(pointerWorld);
		if (!monster) return;
		isDragging = true;
		latestChainMonster = monster.id;
		dispatch({ type: 'chain-start', monsterId: monster.id });
	}

	function onPointerMove(event: PointerEvent) {
		if (mode === 'title') return;
		pointerWorld = canvasPoint(event);
		if (!isDragging) return;
		const monster = nearestMonster(pointerWorld);
		if (monster && monster.id !== latestChainMonster) {
			latestChainMonster = monster.id;
			dispatch({ type: 'chain-extend', monsterId: monster.id });
		}
	}

	function onPointerUp(event: PointerEvent) {
		if (event.button === 2 && isAiming) {
			isAiming = false;
			pointerWorld = canvasPoint(event);
			const position = me?.position ?? { x: 0, y: 0 };
			const dx = pointerWorld.x - position.x;
			const dy = pointerWorld.y - position.y;
			const length = Math.hypot(dx, dy) || 1;
			dispatch({ type: 'fire', direction: { x: dx / length, y: dy / length } });
			return;
		}
		if (!isDragging || event.button !== 0) return;
		isDragging = false;
		latestChainMonster = '';
		commitAfterTick = event.shiftKey ? 'power' : 'score';
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.repeat) return;
		if (event.code === 'Space') {
			event.preventDefault();
			dispatch({ type: 'parry' });
		}
		if (event.key === 'Escape') {
			isDragging = false;
			isAiming = false;
			dispatch({ type: 'chain-cancel' });
		}
	}

	function cancelControls() {
		isDragging = false;
		isAiming = false;
	}

	function spriteIndex(color: string | undefined) {
		return color === 'coral' ? 1 : color === 'cyan' ? 2 : 3;
	}

	function drawSprite(
		context: CanvasRenderingContext2D,
		cell: number,
		x: number,
		y: number,
		size: number
	) {
		if (!spriteSheet?.complete) return false;
		const frame = SPRITE_FRAMES[cell];
		if (!frame) return false;
		context.imageSmoothingEnabled = false;
		context.drawImage(
			spriteSheet,
			frame.x,
			frame.y,
			frame.width,
			frame.height,
			Math.round(x - size / 2),
			Math.round(y - size / 2),
			size,
			size
		);
		return true;
	}

	function colorFor(value: string | undefined) {
		if (value?.startsWith('#')) return value;
		if (value === 'coral') return '#ff6b66';
		if (value === 'cyan') return '#46d9e8';
		if (value === 'gold') return '#ffe36e';
		return '#f8f2d4';
	}

	function draw() {
		if (!canvas || !game) return;
		const rect = canvas.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		if (
			canvas.width !== Math.floor(rect.width * dpr) ||
			canvas.height !== Math.floor(rect.height * dpr)
		) {
			canvas.width = Math.floor(rect.width * dpr);
			canvas.height = Math.floor(rect.height * dpr);
		}
		const context = canvas.getContext('2d');
		if (!context) return;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, rect.width, rect.height);
		camera.viewWidth += ((isAiming ? 760 : 570) - camera.viewWidth) * 0.1;
		const view = viewport(rect);
		const target = me?.position ?? { x: 720, y: 450 };
		const lookAhead = isAiming
			? { x: (pointerWorld.x - target.x) * 0.1, y: (pointerWorld.y - target.y) * 0.1 }
			: { x: 0, y: 0 };
		const cameraTarget = {
			x: Math.max(
				view.viewWidth / 2,
				Math.min(game.arena.width - view.viewWidth / 2, target.x + lookAhead.x)
			),
			y: Math.max(
				view.viewHeight / 2,
				Math.min(game.arena.height - view.viewHeight / 2, target.y + lookAhead.y)
			)
		};
		camera.x += (cameraTarget.x - camera.x) * 0.1;
		camera.y += (cameraTarget.y - camera.y) * 0.1;
		context.save();
		context.translate(rect.width / 2, rect.height / 2);
		context.scale(view.scale, view.scale);
		context.translate(-camera.x, -camera.y);

		context.fillStyle = '#172f3c';
		context.fillRect(0, 0, game.arena.width, game.arena.height);
		context.fillStyle = '#1e4150';
		for (let y = 0; y < game.arena.height; y += 72)
			for (let x = 0; x < game.arena.width; x += 72) {
				if ((x / 72 + y / 72) % 2) context.fillRect(x, y, 72, 72);
			}
		context.strokeStyle = '#315a61';
		context.lineWidth = 5;
		for (let y = 18; y < game.arena.height; y += 144) {
			context.beginPath();
			context.moveTo(0, y);
			for (let x = 0; x <= game.arena.width; x += 36) context.lineTo(x, y + Math.sin(x * 0.03) * 7);
			context.stroke();
		}

		if (me) {
			context.beginPath();
			context.arc(me.position.x, me.position.y, reach, 0, Math.PI * 2);
			context.strokeStyle = 'rgba(255,227,110,.25)';
			context.lineWidth = 3;
			context.setLineDash([8, 9]);
			context.stroke();
			context.setLineDash([]);
		}

		for (const player of players) {
			if (!player.chain.length) continue;
			const linked = player.chain
				.map((id) => game?.arena.monsters[id])
				.filter(Boolean) as Monster[];
			context.strokeStyle = player.id === humanId ? '#fff1a6' : colorFor(player.color);
			context.lineWidth = 12;
			context.lineCap = 'round';
			context.beginPath();
			linked.forEach((monster, index) =>
				index
					? context.lineTo(monster.position.x, monster.position.y)
					: context.moveTo(monster.position.x, monster.position.y)
			);
			context.stroke();
			context.strokeStyle = '#4b2533';
			context.lineWidth = 4;
			context.stroke();
		}

		for (const monster of monsters) {
			if (!monster.alive) continue;
			if (mode === 'tutorial' && tutorialRouteIds.includes(monster.id)) {
				const pulse = 27 + Math.sin((game?.timeMs ?? 0) * 0.008) * 3;
				context.fillStyle = 'rgba(255, 241, 166, 0.18)';
				context.fillRect(
					monster.position.x - pulse,
					monster.position.y - pulse,
					pulse * 2,
					pulse * 2
				);
				context.strokeStyle = '#fff1a6';
				context.lineWidth = 3;
				context.strokeRect(
					monster.position.x - pulse,
					monster.position.y - pulse,
					pulse * 2,
					pulse * 2
				);
			}
			if (
				!drawSprite(context, spriteIndex(monster.color), monster.position.x, monster.position.y, 45)
			) {
				context.fillStyle = colorFor(monster.color);
				context.fillRect(monster.position.x - 12, monster.position.y - 12, 24, 24);
			}
		}

		for (const projectile of projectiles) {
			context.save();
			context.translate(projectile.position.x, projectile.position.y);
			context.rotate(Math.atan2(projectile.velocity.y, projectile.velocity.x));
			drawSprite(context, 4, 0, 0, 30 + projectile.radius * 1.4);
			context.restore();
		}

		for (const player of players) {
			if (player.mode === 'dead') continue;
			const local = player.id === humanId;
			const playerMax = player.maxHealth ?? maxHealthForScore(player.score);
			const healthRatio = Math.max(0, player.health / playerMax);
			if (player.mode === 'parrying')
				drawSprite(context, 5, player.position.x, player.position.y, 78);
			drawSprite(context, 0, player.position.x, player.position.y, local ? 62 : 52);
			context.fillStyle = '#281d2b';
			context.fillRect(player.position.x - 27, player.position.y - 42, 54, 7);
			context.fillStyle =
				healthRatio > 0.35 ? (local ? '#ffe36e' : colorFor(player.color)) : '#ff665f';
			context.fillRect(player.position.x - 25, player.position.y - 40, 50 * healthRatio, 3);
			context.font = 'bold 10px monospace';
			context.textAlign = 'center';
			context.fillStyle = '#fff8dc';
			context.fillText(
				local ? 'YOU' : player.name.toUpperCase(),
				player.position.x,
				player.position.y - 49
			);
		}

		if (isAiming && me) {
			context.strokeStyle = '#fff8dc';
			context.lineWidth = 2;
			context.setLineDash([8, 8]);
			context.beginPath();
			context.moveTo(me.position.x, me.position.y);
			context.lineTo(pointerWorld.x, pointerWorld.y);
			context.stroke();
			context.setLineDash([]);
			context.strokeRect(pointerWorld.x - 9, pointerWorld.y - 9, 18, 18);
		}
		context.restore();
	}

	onMount(() => {
		spriteSheet = new Image();
		spriteSheet.src = '/assets/grindion-sprites.png';
		let frame = 0;
		let last = performance.now();
		let accumulator = 0;
		const loop = (now: number) => {
			const elapsed = Math.min(100, now - last);
			last = now;
			if (game && isRunning) {
				accumulator += elapsed;
				while (accumulator >= 50) {
					const intents = [...queuedIntents];
					queuedIntents = [];
					if (mode === 'arena') intents.push(...(botController.update?.(game) ?? []));
					if (
						mode === 'tutorial' &&
						tutorialStep === 4 &&
						tutorialShotAt &&
						game.timeMs >= tutorialShotAt
					) {
						const dummy = game.players.dummy!;
						const human = game.players.human!;
						dummy.power = 18;
						intents.push({
							type: 'fire',
							playerId: 'dummy',
							direction: {
								x: human.position.x - dummy.position.x,
								y: human.position.y - dummy.position.y
							}
						});
						tutorialShotAt = game.timeMs + 2100;
					}
					const result = stepGame($state.snapshot(game), intents, 50);
					game = result.state;
					for (const event of result.events) addEvent(event);
					if (commitAfterTick) {
						queuedIntents.push({
							type: 'chain-commit',
							playerId: humanId,
							conversion: commitAfterTick
						});
						commitAfterTick = null;
					}
					if (mode === 'tutorial' && tutorialStep === 0 && game.players.human!.chain.length >= 3)
						tutorialStep = 1;
					accumulator -= 50;
				}
				if (game.timeMs >= game.roundEndsAtMs) isRunning = false;
			}
			draw();
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});
</script>

<svelte:head>
	<title>Grindion — Chain. Power. Survive.</title>
	<meta name="description" content="A pixel-art multiplayer puzzle-combat prototype." />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onblur={cancelControls} />

<main class="shell">
	<header class="topbar">
		<div class="brand-lockup">
			<span class="brand-mark">G</span>
			<div><strong>GRINDION</strong><span>CHAIN BRAWLER</span></div>
		</div>
		<div class:urgent={secondsLeft <= 30} class="round-clock">
			<span>{mode === 'tutorial' ? 'TRAINING' : 'ROUND'}</span><strong>{timerText}</strong>
		</div>
		<div class="server-state"><i></i>{isRunning ? 'SIMULATION LIVE' : 'CAVERN READY'}</div>
	</header>

	<section class="play-layout">
		<div class="arena-column">
			{#if mode === 'tutorial'}
				<div class="tutorial-card">
					<div>
						<span>LESSON {Math.min(tutorialStep + 1, 6)} / 6</span>
						<h2>{TUTORIAL_STEPS[tutorialStep].title}</h2>
						<p>{TUTORIAL_STEPS[tutorialStep].copy}</p>
					</div>
					<div class="lesson-dots">
						{#each TUTORIAL_STEPS as step, index (step.title)}<i
								class:done={index < tutorialStep}
								class:current={index === tutorialStep}
							></i>{/each}
					</div>
					{#if tutorialStep === 5}<button onclick={startArena}>ENTER LIVE ARENA →</button>{/if}
				</div>
			{/if}
			<div
				class:dragging={isDragging}
				class:aiming={isAiming}
				class="arena-frame"
				role="application"
				aria-label="Grindion game arena"
			>
				<canvas
					bind:this={canvas}
					tabindex="0"
					onpointerdown={onPointerDown}
					onpointermove={onPointerMove}
					onpointerup={onPointerUp}
					onpointercancel={cancelControls}
					oncontextmenu={(event) => event.preventDefault()}
				></canvas>

				{#if mode !== 'title'}
					<div class="player-hud">
						<div
							class="heart-hud"
							aria-label={`Health ${Math.ceil(health)} of ${Math.ceil(maxHealth)}`}
						>
							<div>
								<b>VITALS</b><i
									><em style={`width:${Math.min(100, (health / Math.max(1, maxHealth)) * 100)}%`}
									></em></i
								>
							</div>
							<strong>{Math.ceil(health)}</strong>
						</div>
						<div class="score-card">
							<span>SCORE</span><strong>{score}</strong><small>RANGE {Math.round(reach)}</small>
						</div>
						<div class="power-card">
							<span>{isAiming ? 'ARMED · ALL IN' : 'POWER RESERVE'}</span><strong
								>{Math.floor(power)}</strong
							><i><em style={`width:${Math.min(100, (power / 120) * 100)}%`}></em></i>
						</div>
					</div>
				{/if}
				{#if isAiming}
					<div class="aim-callout">RELEASE TO FIRE ALL {Math.floor(power)} POWER</div>
				{/if}

				{#if chainLength > 0}
					<div class="chain-status">
						<span>{chainLength}×</span><strong>RELEASE: SCORE</strong><small
							>SHIFT + RELEASE: POWER</small
						>
					</div>
				{/if}
				<div class="event-feed" aria-live="polite">
					{#each eventFeed as event (event.id)}<div
							class:event-cyan={event.tone === 'cyan'}
							class:event-coral={event.tone === 'coral'}
							class:event-violet={event.tone === 'violet'}
						>
							{event.text}
						</div>{/each}
				</div>

				{#if mode === 'title'}
					<div class="start-overlay">
						<div class="crest">G</div>
						<div class="eyebrow">A SHARED-BOARD CHAIN BRAWLER</div>
						<h1>GRIND<span>ION</span></h1>
						<p>Weave greedy chains. Bank Score or forge Power. Every shot costs everything.</p>
						<div class="title-actions">
							<button onclick={startTutorial}>PLAY TUTORIAL <span>▶</span></button><button
								class="secondary"
								onclick={startArena}>ENTER ARENA <span>⚔</span></button
							>
						</div>
					</div>
				{:else if !isRunning}
					<div class="start-overlay compact">
						<div class="eyebrow">ROUND COMPLETE</div>
						<h1>
							{leaderboard[0]?.id === humanId
								? 'CAVERN CONQUERED'
								: `${leaderboard[0]?.name ?? 'A RIVAL'} WINS`}
						</h1>
						<button onclick={startArena}>PLAY AGAIN ↻</button>
					</div>
				{/if}
			</div>
			<div class="quick-controls">
				<span><kbd>DRAG</kbd> ROUTE + MOVE</span><span><kbd>⇧ RELEASE</kbd> POWER</span><span
					><kbd>HOLD RMB</kbd> AIM / SCOUT</span
				><span><kbd>RELEASE RMB</kbd> FIRE ALL</span><span><kbd>SPACE</kbd> PARRY</span>
			</div>
		</div>

		<aside class="side-panel">
			<section class="leaderboard-panel">
				<div class="panel-heading">
					<span>{mode === 'tutorial' ? 'TRAINING ROOM' : 'LIVE BOARD'}</span><small
						>{players.length || 8} ACTIVE</small
					>
				</div>
				<div class="leaders">
					{#each leaderboard as player (player.id)}<div
							class:you={player.id === humanId}
							class="leader-row"
						>
							<b>{String(player.rank).padStart(2, '0')}</b><i
								style={`--player-color:${player.id === humanId ? '#ffe36e' : colorFor(player.color)}`}
							></i><span>{player.id === humanId ? 'YOU' : player.name}</span><strong
								>{Math.round(player.score)}</strong
							>
						</div>{/each}
				</div>
			</section>
			<section class="rule-panel">
				<div class="panel-heading"><span>CAVERN RULES</span><small>THE LOOP</small></div>
				<ol>
					<li>
						<b>1</b>
						<div><strong>CHAIN</strong><span>Connect creatures of one color.</span></div>
					</li>
					<li>
						<b>2</b>
						<div><strong>CHOOSE</strong><span>Score grows reach + health. Power fights.</span></div>
					</li>
					<li>
						<b>3</b>
						<div>
							<strong>COMMIT</strong><span>A shot spends all Power. A parry rewards timing.</span>
						</div>
					</li>
				</ol>
			</section>
			<div class="risk-note">
				<span>GREED HAS A COST</span>
				<p>Long chains leave you still. Empty your Power and rivals know you cannot parry.</p>
			</div>
		</aside>
	</section>
</main>

<style>
	:global(body) {
		image-rendering: pixelated;
	}
	.shell {
		width: min(1080px, 100%);
		min-height: 100vh;
		margin: 0 auto;
		padding: 12px 18px 20px;
	}
	.topbar {
		height: 58px;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		margin-bottom: 12px;
		border: 4px solid #241b2b;
		border-width: 0 0 4px;
		color: #fff5d6;
	}
	.brand-lockup {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.brand-lockup div {
		display: flex;
		flex-direction: column;
	}
	.brand-lockup strong {
		color: #ffe36e;
		font: 900 17px/1 monospace;
		letter-spacing: 0.08em;
		text-shadow: 3px 3px #4b2533;
	}
	.brand-lockup div span,
	.server-state,
	.round-clock span {
		color: #9eb6ac;
		font: 700 8px monospace;
		letter-spacing: 0.13em;
	}
	.brand-mark,
	.crest {
		display: grid;
		place-items: center;
		color: #2a1c2d;
		background: #ffe36e;
		border: 4px solid #4b2533;
		box-shadow: 3px 3px 0 #130f19;
		font: 1000 19px monospace;
	}
	.brand-mark {
		width: 34px;
		height: 34px;
	}
	.round-clock {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.round-clock strong {
		font: 900 23px monospace;
	}
	.round-clock.urgent strong {
		color: #ff665f;
	}
	.server-state {
		justify-self: end;
	}
	.server-state i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 7px;
		background: #6be7ac;
		box-shadow: 2px 2px 0 #20544b;
	}
	.play-layout {
		display: grid;
		grid-template-columns: minmax(0, 720px) 260px;
		justify-content: center;
		gap: 14px;
	}
	.arena-column {
		min-width: 0;
	}
	.arena-frame {
		position: relative;
		width: 100%;
		height: min(78vh, 860px);
		min-height: 620px;
		overflow: hidden;
		border: 5px solid #281d2b;
		border-radius: 4px;
		background: #17313d;
		box-shadow:
			7px 7px 0 #0a0d14,
			inset 0 0 0 3px #5d4656;
	}
	.arena-frame::after {
		content: '';
		position: absolute;
		z-index: 2;
		inset: 0;
		pointer-events: none;
		box-shadow: inset 0 0 70px #081019aa;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
		image-rendering: pixelated;
	}
	.dragging canvas {
		cursor: grabbing;
	}
	.aiming canvas {
		cursor: none;
	}
	.player-hud {
		position: absolute;
		z-index: 4;
		left: 50%;
		top: 14px;
		transform: translateX(-50%);
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: stretch;
		width: min(540px, calc(100% - 28px));
		min-height: 58px;
		color: #dffcff;
		background: rgba(7, 18, 27, 0.9);
		border: 2px solid #315a61;
		border-top-color: #64dce5;
		box-shadow:
			0 6px 0 rgba(6, 9, 15, 0.75),
			inset 0 0 0 2px rgba(100, 220, 229, 0.08);
		backdrop-filter: blur(4px);
	}
	.heart-hud,
	.score-card,
	.power-card {
		position: relative;
		background: transparent;
		border: 0;
		box-shadow: none;
		color: inherit;
	}
	.heart-hud {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 14px;
	}
	.heart-hud div {
		flex: 1;
	}
	.heart-hud strong {
		color: #ff7a76;
		font: 1000 18px monospace;
	}
	.heart-hud b,
	.power-card span,
	.score-card span {
		display: block;
		font: 900 8px monospace;
		letter-spacing: 0.12em;
	}
	.heart-hud i,
	.power-card i {
		display: block;
		height: 5px;
		margin-top: 5px;
		background: #182833;
		border: 1px solid #31505a;
	}
	.heart-hud em,
	.power-card em {
		display: block;
		height: 100%;
		background: #ff665f;
	}
	.score-card {
		display: grid;
		grid-template-columns: auto auto;
		align-items: center;
		gap: 0 12px;
		padding: 8px 18px;
		border-right: 2px solid #31505a;
		border-left: 2px solid #31505a;
	}
	.score-card strong {
		grid-row: 1 / 3;
		grid-column: 2;
		color: #ffe36e;
		font: 1000 25px monospace;
		text-shadow: 2px 2px #3b3424;
	}
	.score-card small {
		font: 700 7px monospace;
		color: #c7b39f;
	}
	.power-card {
		width: auto;
		padding: 9px 14px;
	}
	.power-card strong {
		position: absolute;
		right: 10px;
		top: 7px;
		color: #64dce5;
		font: 1000 17px monospace;
	}
	.power-card em {
		background: #64dce5;
	}
	.chain-status {
		position: absolute;
		z-index: 5;
		left: 50%;
		bottom: 88px;
		transform: translateX(-50%);
		display: grid;
		grid-template-columns: auto auto;
		padding: 8px 12px;
		background: #fff0ad;
		color: #2a1c2d;
		border: 4px solid #50303e;
		box-shadow: 4px 4px 0 #120e17;
	}
	.aim-callout {
		position: absolute;
		z-index: 5;
		left: 50%;
		top: auto;
		bottom: 88px;
		transform: translateX(-50%);
		padding: 7px 10px;
		color: #fff0ad;
		background: #2c2030;
		border: 3px solid #64dce5;
		box-shadow: 3px 3px 0 #110d16;
		font: 1000 9px monospace;
		letter-spacing: 0.08em;
	}
	.chain-status span {
		grid-row: 1 / 3;
		margin-right: 10px;
		color: #d45150;
		font: 1000 23px monospace;
	}
	.chain-status strong,
	.chain-status small {
		font: 900 8px monospace;
	}
	.event-feed {
		position: absolute;
		z-index: 5;
		right: 14px;
		bottom: 15px;
		display: flex;
		flex-direction: column;
		align-items: end;
		gap: 4px;
	}
	.event-feed div {
		padding: 5px 7px;
		color: #ffe36e;
		background: #281d2b;
		border: 3px solid currentColor;
		font: 900 8px monospace;
	}
	.event-cyan {
		color: #64dce5 !important;
	}
	.event-coral {
		color: #ff665f !important;
	}
	.event-violet {
		color: #c293e8 !important;
	}
	.start-overlay {
		position: absolute;
		z-index: 9;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px;
		text-align: center;
		background: radial-gradient(circle at 50% 35%, #2c5360 0, #152b38 45%, #0b1420 100%);
	}
	.start-overlay::before {
		content: '';
		position: absolute;
		inset: 0;
		opacity: 0.14;
		background-image:
			linear-gradient(45deg, #fff 25%, transparent 25%),
			linear-gradient(-45deg, #fff 25%, transparent 25%);
		background-size: 8px 8px;
	}
	.start-overlay > * {
		position: relative;
	}
	.crest {
		width: 70px;
		height: 70px;
		margin-bottom: 20px;
		font-size: 40px;
		transform: rotate(-3deg);
	}
	.eyebrow {
		color: #64dce5;
		font: 900 9px monospace;
		letter-spacing: 0.18em;
	}
	.start-overlay h1 {
		margin: 8px 0 12px;
		color: #fff0ad;
		font: 1000 clamp(50px, 9vw, 84px)/0.85 monospace;
		letter-spacing: -0.09em;
		text-shadow:
			5px 5px #6c3046,
			8px 8px #1f1723;
	}
	.start-overlay h1 span {
		color: #ffe36e;
	}
	.start-overlay p {
		max-width: 440px;
		color: #d8d1b6;
		font: 700 12px/1.6 monospace;
	}
	.title-actions {
		display: flex;
		gap: 10px;
		margin-top: 18px;
	}
	button {
		padding: 13px 15px;
		color: #281d2b;
		background: #ffe36e;
		border: 4px solid #4b2533;
		box-shadow: 4px 4px 0 #110d16;
		font: 1000 10px monospace;
		letter-spacing: 0.07em;
		cursor: pointer;
	}
	button:hover {
		transform: translate(-1px, -1px);
		box-shadow: 6px 6px 0 #110d16;
	}
	button.secondary {
		color: #fff2cd;
		background: #d34e52;
	}
	.start-overlay.compact h1 {
		font-size: 44px;
	}
	.tutorial-card {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 8px 20px;
		width: 100%;
		min-height: 76px;
		margin-bottom: 10px;
		padding: 10px 14px;
		color: #2a1c2d;
		background: #fff0ad;
		border: 4px solid #4b2f3d;
		box-shadow: 5px 5px 0 #110e17;
	}
	.tutorial-card > div:first-child > span {
		color: #b1454b;
		font: 1000 8px monospace;
		letter-spacing: 0.13em;
	}
	.tutorial-card h2 {
		margin: 3px 0;
		font: 1000 20px monospace;
		text-transform: uppercase;
	}
	.tutorial-card p {
		margin: 0;
		font: 700 10px/1.4 monospace;
	}
	.lesson-dots {
		display: flex;
		gap: 4px;
		margin: 0;
	}
	.lesson-dots i {
		width: 22px;
		height: 4px;
		background: #c6ab88;
	}
	.lesson-dots i.done {
		background: #d34e52;
	}
	.lesson-dots i.current {
		background: #2f7b78;
	}
	.tutorial-card button {
		grid-column: 2;
		padding: 9px 12px;
	}
	.quick-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 7px 12px;
		padding: 12px 2px 0;
		color: #9eb6ac;
		font: 800 8px monospace;
	}
	kbd {
		padding: 3px 5px;
		color: #fff0ad;
		background: #2c2030;
		border: 2px solid #573b4d;
		font: inherit;
	}
	.side-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.side-panel section,
	.risk-note {
		overflow: hidden;
		color: #f7edce;
		background: #332432;
		border: 4px solid #1b151f;
		box-shadow: 4px 4px 0 #0c0b10;
	}
	.panel-heading {
		display: flex;
		justify-content: space-between;
		padding: 11px 12px;
		background: #523241;
		border-bottom: 4px solid #1b151f;
	}
	.panel-heading span,
	.risk-note > span {
		color: #ffe36e;
		font: 1000 9px monospace;
		letter-spacing: 0.1em;
	}
	.panel-heading small {
		color: #b9a99b;
		font: 700 8px monospace;
	}
	.leaders {
		padding: 5px;
	}
	.leader-row {
		display: grid;
		grid-template-columns: 23px 7px 1fr auto;
		align-items: center;
		gap: 8px;
		min-height: 37px;
		padding: 0 7px;
		color: #d9ceb5;
		font: 800 10px monospace;
	}
	.leader-row b {
		color: #856c73;
	}
	.leader-row i {
		width: 7px;
		height: 7px;
		background: var(--player-color);
	}
	.leader-row strong {
		color: #ffe36e;
	}
	.leader-row.you {
		color: #2a1c2d;
		background: #ffe36e;
	}
	.leader-row.you b,
	.leader-row.you strong {
		color: #2a1c2d;
	}
	.rule-panel ol {
		list-style: none;
		margin: 0;
		padding: 5px 12px 9px;
	}
	.rule-panel li {
		display: grid;
		grid-template-columns: 25px 1fr;
		gap: 7px;
		padding: 11px 0;
		border-bottom: 2px dashed #5e4150;
	}
	.rule-panel li:last-child {
		border: 0;
	}
	.rule-panel li > b {
		color: #d34e52;
		font: 1000 15px monospace;
	}
	.rule-panel li div {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.rule-panel li strong {
		color: #64dce5;
		font: 1000 10px monospace;
	}
	.rule-panel li span {
		color: #b9ad9c;
		font: 700 9px/1.45 monospace;
	}
	.risk-note {
		padding: 13px;
	}
	.risk-note p {
		margin: 7px 0 0;
		color: #b9ad9c;
		font: 700 9px/1.55 monospace;
	}
	@media (max-width: 850px) {
		.play-layout {
			grid-template-columns: minmax(0, 620px);
		}
		.side-panel {
			display: none;
		}
		.arena-frame {
			min-height: 600px;
			height: 78vh;
		}
		.server-state {
			display: none;
		}
		.topbar {
			grid-template-columns: 1fr auto;
		}
	}
	@media (max-width: 520px) {
		.shell {
			padding: 6px;
		}
		.arena-frame {
			min-height: 560px;
			border-width: 3px;
		}
		.title-actions {
			flex-direction: column;
		}
		.player-hud {
			top: 8px;
			width: calc(100% - 16px);
			grid-template-columns: 1fr auto 1fr;
		}
		.heart-hud,
		.power-card {
			padding-inline: 8px;
		}
		.score-card {
			padding-inline: 10px;
		}
		.tutorial-card {
			grid-template-columns: 1fr;
			gap: 8px;
		}
		.tutorial-card button {
			grid-column: 1;
		}
	}
</style>
