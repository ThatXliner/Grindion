<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { ArenaClient } from '$lib/online/arenaClient';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		canExtendWithColor,
		chainValue,
		configureTutorialRoute,
		createBotController,
		createChainMotionTiming,
		createGame,
		grindstoneState,
		LIVE_ARENA_CONFIG,
		maxHealthForScore,
		powerGain,
		stepGame
	} from '$lib/game';
	import type { GameEvent, GameIntent, GameState, Monster, PlayerState } from '$lib/game';
	import {
		animatedPlayerPosition,
		ArenaRenderer,
		PALETTE,
		playerColor,
		SPRITE,
		SPRITE_FRAMES
	} from '$lib/render/arenaRenderer';
	import type { Camera, ChainAnimation, Point } from '$lib/render/arenaRenderer';
	import { getSupabaseBrowserClient, isSupabaseConfigured } from '$lib/supabase/client';
	import {
		cleanPlayerName,
		createRoomCode,
		normalizeRoomCode,
		playerSetupsForRoster,
		RealtimeRoom
	} from '$lib/supabase/realtimeRoom';
	import type { RoomConnectionState, RoomMember, RoomRole } from '$lib/supabase/realtimeRoom';

	type WithoutPlayer<T> = T extends { playerId: string } ? Omit<T, 'playerId'> : never;
	type HumanIntent = WithoutPlayer<GameIntent>;
	type GameMode = 'title' | 'arena' | 'tutorial';
	type DeathRecap = { killerName: string; scoreLost: number };
	type LobbyStatus = 'idle' | 'connecting' | 'lobby';
	type FeedTone = 'gold' | 'energy' | 'coral' | 'violet' | 'neutral';

	const TUTORIAL_STEPS = [
		{
			title: 'Choose a route',
			copy: 'Drag from your hero, or play entirely on keyboard: 9 → 6 → 2 on the numpad/number row (E → D → X on a laptop).',
			mobileCopy:
				'Press and hold on your hero—not a monster—then drag into the cyan-outlined coral.'
		},
		{
			title: 'Move + bank',
			copy: 'Release—or press 5, S, or Enter—to claim Score and land on the final creature.',
			mobileCopy: 'Release to claim Score and land on the final creature.'
		},
		{
			title: 'Grow tougher',
			copy: 'Paths have no distance limit. Banking Score increases max health logarithmically: early points help most.'
		},
		{
			title: 'Charge Power',
			copy: 'Right-drag from your hero through another chain, or press Numpad +, to store it as Power.',
			mobileCopy: 'Power mode is selected below. Build another chain and release to convert it.'
		},
		{
			title: 'Take the shot',
			copy: 'Hold right mouse to scout and aim. Release to fire every volt.',
			mobileCopy: 'Tap Aim + Fire, drag across the board to aim, then release to fire every volt.'
		},
		{
			title: 'Parry',
			copy: 'The dummy is firing. Press Space when the warning ring turns cyan.',
			mobileCopy: 'The dummy is firing. Tap Parry when the warning ring turns cyan.'
		},
		{
			title: 'Training complete',
			copy: 'You know the loop. Enter the live arena when you are ready.'
		}
	] as const;

	const HOW_TO_PLAY = [
		{
			sprite: SPRITE.coral,
			title: 'Chain',
			copy: 'Drag from your hero through matching neighbors. The route is how you move.'
		},
		{
			sprite: SPRITE.gold,
			title: 'Choose',
			copy: 'Release to bank Score and grow tougher, or right-drag to store the chain as Power.'
		},
		{
			sprite: SPRITE.bolt,
			title: 'Commit',
			copy: 'A shot spends all your Power. A well-timed parry stops any shot.'
		},
		{
			sprite: SPRITE.cyan,
			title: 'Grind',
			copy: 'Chain 5 of one color to unlock one rainbow switch to any neighbor.'
		}
	] as const;

	let canvas: HTMLCanvasElement;
	let game = $state<GameState | null>(null);
	let humanId = $state('human');
	let mode = $state<GameMode>('title');
	let isRunning = $state(false);
	let isDragging = $state(false);
	let dragConversion = $state<'score' | 'power'>('score');
	let dragButton = 0;
	let isAiming = $state(false);
	let pointerOverPlayer = $state(false);
	let hasCommittedChain = $state(false);
	let useTouchControls = $state(false);
	let mobileAimArmed = $state(false);
	let mobileConversion = $state<'score' | 'power'>('score');
	let deathRecap = $state<DeathRecap | null>(null);
	let pointerWorld = $state<Point>({ x: 720, y: 450 });
	let showHelp = $state(false);
	let showStandings = $state(false);
	let latestChainMonster = '';
	let optimisticChainIds: string[] = [];
	let previousDragPoint: Point | null = null;
	let commitAfterTick: 'score' | 'power' | null = null;
	let eventFeed = $state<{ id: number; text: string; tone: FeedTone }[]>([]);
	let eventId = 0;
	let tutorialStep = $state(0);
	let tutorialShotAt = 0;
	let tutorialRouteIds = $state<string[]>([]);
	let lobbyStatus = $state<LobbyStatus>('idle');
	let lobbyRole = $state<RoomRole | null>(null);
	let lobbyMembers = $state<RoomMember[]>([]);
	let lobbyError = $state('');
	let roomCode = $state('');
	let joinCode = $state('');
	let playerName = $state('Wanderer');
	let localPlayerId = $state('');
	let publicArena = $state(false);
	let multiplayerRoom: RealtimeRoom | null = null;
	let serverArena = $state<ArenaClient | null>(null);
	let sharedArenaUrl = $state('');
	let shareMessage = $state('');
	let remoteIntents: GameIntent[] = [];
	let pendingNetworkEvents: GameEvent[] = [];
	let lastPublishedTimeMs = -Infinity;
	// World units visible across the short axis of the screen.
	const DESKTOP_VIEW = 1080;
	const DESKTOP_AIM_VIEW = 1280;
	const TITLE_VIEW = 1100;
	const MOBILE_VIEW_WIDTH = 460;
	const MOBILE_AIM_VIEW_WIDTH = 590;
	const CAMERA_EDGE_PADDING = 70;
	const NUMPAD_DIRECTIONS: Record<string, Point> = {
		Numpad7: { x: -1, y: -1 },
		Numpad8: { x: 0, y: -1 },
		Numpad9: { x: 1, y: -1 },
		Numpad4: { x: -1, y: 0 },
		Numpad6: { x: 1, y: 0 },
		Numpad1: { x: -1, y: 1 },
		Numpad2: { x: 0, y: 1 },
		Numpad3: { x: 1, y: 1 }
	};
	const KEYBOARD_DIRECTIONS: Record<string, Point> = {
		...NUMPAD_DIRECTIONS,
		Digit7: { x: -1, y: -1 },
		Digit8: { x: 0, y: -1 },
		Digit9: { x: 1, y: -1 },
		Digit4: { x: -1, y: 0 },
		Digit6: { x: 1, y: 0 },
		Digit1: { x: -1, y: 1 },
		Digit2: { x: 0, y: 1 },
		Digit3: { x: 1, y: 1 },
		KeyQ: { x: -1, y: -1 },
		KeyW: { x: 0, y: -1 },
		KeyE: { x: 1, y: -1 },
		KeyA: { x: -1, y: 0 },
		KeyD: { x: 1, y: 0 },
		KeyZ: { x: -1, y: 1 },
		KeyX: { x: 0, y: 1 },
		KeyC: { x: 1, y: 1 }
	};
	const KEY_VALUE_DIRECTIONS: Record<string, Point> = {
		'7': { x: -1, y: -1 },
		'8': { x: 0, y: -1 },
		'9': { x: 1, y: -1 },
		'4': { x: -1, y: 0 },
		'6': { x: 1, y: 0 },
		'1': { x: -1, y: 1 },
		'2': { x: 0, y: 1 },
		'3': { x: 1, y: 1 },
		q: { x: -1, y: -1 },
		w: { x: 0, y: -1 },
		e: { x: 1, y: -1 },
		a: { x: -1, y: 0 },
		d: { x: 1, y: 0 },
		z: { x: -1, y: 1 },
		x: { x: 0, y: 1 },
		c: { x: 1, y: 1 },
		Home: { x: -1, y: -1 },
		ArrowUp: { x: 0, y: -1 },
		PageUp: { x: 1, y: -1 },
		ArrowLeft: { x: -1, y: 0 },
		ArrowRight: { x: 1, y: 0 },
		End: { x: -1, y: 1 },
		ArrowDown: { x: 0, y: 1 },
		PageDown: { x: 1, y: 1 }
	};
	const chainAnimations = new SvelteMap<string, ChainAnimation>();
	let camera: Camera = { x: 720, y: 450, scale: 1 };
	const renderer = new ArenaRenderer();
	const botController = createBotController(8_172);
	const attractBots = createBotController(0x41545452);

	const players = $derived(game ? Object.values(game.players) : []);
	const monsters = $derived(game ? Object.values(game.arena.monsters) : []);
	const me = $derived(players.find((player) => player.id === humanId) ?? players[0]);
	const score = $derived(Math.round(me?.score ?? 0));
	const maxHealth = $derived(me?.maxHealth ?? maxHealthForScore(me?.score ?? 0));
	const health = $derived(Math.max(0, me?.health ?? maxHealth));
	const power = $derived(Math.max(0, me?.power ?? 0));
	const powerCap = $derived(game?.config.powerCap ?? 120);
	const minFirePower = $derived(game?.config.minFirePower ?? 10);
	const chainLength = $derived(me?.chain.length ?? 0);
	const isDead = $derived(me?.mode === 'dead');
	const respawnRemainingMs = $derived(
		isDead && game && me ? Math.max(0, me.respawnAtMs - game.timeMs) : 0
	);
	const respawnSeconds = $derived(Math.max(1, Math.ceil(respawnRemainingMs / 1000)));
	const respawnProgress = $derived(
		game ? Math.max(0, Math.min(100, 100 - (respawnRemainingMs / game.config.respawnMs) * 100)) : 0
	);
	const grindstoneReady = $derived(me ? playerGrindstone(me).ready : false);
	const secondsLeft = $derived(
		Math.max(0, Math.ceil(((game?.roundEndsAtMs ?? 300_000) - (game?.timeMs ?? 0)) / 1000))
	);
	const timerText = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);
	const standings: (PlayerState & { rank: number })[] = $derived(
		[...players]
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			.map((player, index) => ({ ...player, rank: index + 1 }))
	);
	const leaderboard = $derived(standings.slice(0, 8));
	const myRank = $derived(standings.find((player) => player.id === humanId)?.rank ?? 0);
	const statusText = $derived(
		serverArena
			? isRunning
				? 'ARENA SERVER LIVE'
				: 'REJOIN ARENA'
			: lobbyRole && mode === 'arena'
				? isRunning
					? lobbyRole === 'host'
						? 'NETWORK HOST LIVE'
						: 'SYNCED TO HOST'
					: 'NETWORK ROUND ENDED'
				: isRunning
					? 'SIMULATION LIVE'
					: 'CAVERN READY'
	);

	function stageTutorialRoute(state: GameState, color: 'coral' | 'cyan', preferredIds?: string[]) {
		tutorialRouteIds = configureTutorialRoute(state, 'human', color, preferredIds);
	}

	function tutorialStepCopy() {
		const step = TUTORIAL_STEPS[tutorialStep];
		return useTouchControls && 'mobileCopy' in step ? step.mobileCopy : step.copy;
	}

	function prepareTutorial(state: GameState) {
		const human = state.players.human!;
		const dummy = state.players.dummy!;
		const previousCell = state.arena.monsters[human.cellId];
		if (previousCell) {
			previousCell.alive = true;
			previousCell.respawnAtMs = 0;
		}
		const startCell = state.arena.monsters.m112!;
		human.cellId = startCell.id;
		human.position = { ...startCell.position };
		startCell.alive = false;
		startCell.respawnAtMs = 0;
		human.power = 0;
		const previousDummyCell = state.arena.monsters[dummy.cellId];
		if (previousDummyCell) {
			previousDummyCell.alive = true;
			previousDummyCell.respawnAtMs = 0;
		}
		const dummyCell = state.arena.monsters.m116!;
		dummy.cellId = dummyCell.id;
		dummy.position = { ...dummyCell.position };
		dummyCell.alive = false;
		dummyCell.respawnAtMs = 0;
		dummy.power = 120;
		dummy.protectedUntilMs = Number.POSITIVE_INFINITY;
		stageTutorialRoute(state, 'coral', ['m98', 'm99', 'm114']);
		return state;
	}

	/** A bot-only match that plays behind the title screen. */
	function startAttract() {
		game = createGame({
			seed: Math.floor(Math.random() * 2 ** 30),
			players: Array.from({ length: 8 }, (_, index) => ({
				id: `bot-${index + 1}`,
				name: `Bot ${index + 1}`,
				isBot: true
			})),
			config: { ...LIVE_ARENA_CONFIG, roundDurationMs: 3_600_000 }
		});
		humanId = '';
		attractBots.reset();
		renderer.reset();
		chainAnimations.clear();
		camera = { x: game.arena.width / 2, y: game.arena.height / 2, scale: camera.scale };
	}

	function startArena(roundDurationMs?: number) {
		lobbyRole = null;
		game = createGame({
			seed: Math.floor(Math.random() * 2 ** 30),
			botCount: 7,
			config: roundDurationMs ? { ...LIVE_ARENA_CONFIG, roundDurationMs } : LIVE_ARENA_CONFIG
		});
		humanId = Object.values(game.players).find((player) => !player.isBot)?.id ?? 'player';
		botController.reset();
		startSession('arena');
	}

	function onRoomConnection(state: RoomConnectionState, message?: string) {
		if (state === 'error') lobbyError = message ?? 'Realtime connection failed.';
		if (state === 'disconnected' && multiplayerRoom && mode === 'arena') {
			isRunning = false;
			lobbyError = message ?? 'The multiplayer room disconnected.';
		}
	}

	function acceptRemoteStart(state: GameState) {
		if (!localPlayerId || !state.players[localPlayerId]) {
			lobbyError = 'That round is already in progress. Join the next room.';
			return;
		}
		humanId = localPlayerId;
		game = state;
		startSession('arena');
	}

	function acceptRemoteSnapshot(state: GameState, events: GameEvent[]) {
		if (mode === 'title' || !game || state.tick < game.tick) return;
		game = state;
		for (const event of events) addEvent(event);
		if (state.roundEnded || state.timeMs >= state.roundEndsAtMs) isRunning = false;
	}

	async function joinOnlineArena() {
		if (lobbyStatus === 'connecting') return;
		lobbyStatus = 'connecting';
		lobbyError = '';
		try {
			localStorage.setItem('grindion-player-name', cleanPlayerName(playerName));
			const code = new URL(window.location.href).searchParams.get('arena') ?? '';
			serverArena = await ArenaClient.connect(cleanPlayerName(playerName), code, {
				onStart: (state, playerId, code) => {
					humanId = playerId;
					lobbyRole = 'guest';
					roomCode = code;
					publicArena = true;
					game = state;
					sharedArenaUrl = new URL(`/?arena=${code}`, window.location.href).href;
					startSession('arena');
				},
				onSnapshot: acceptRemoteSnapshot,
				onDisconnect: (message) => {
					isRunning = false;
					lobbyError = message;
				}
			});
			lobbyStatus = 'lobby';
		} catch (error) {
			lobbyStatus = 'idle';
			lobbyError = error instanceof Error ? error.message : 'Could not join the arena.';
		}
	}

	async function shareArena() {
		try {
			await navigator.clipboard.writeText(sharedArenaUrl);
			shareMessage = 'LINK COPIED';
		} catch {
			shareMessage = 'USE THE ARENA LINK';
		}
	}

	async function connectRoom(
		role: RoomRole,
		requestedCode?: string,
		isPublicMatch = false
	): Promise<boolean> {
		lobbyError = '';
		const supabase = getSupabaseBrowserClient();
		if (!supabase) {
			lobbyError = 'Online play needs PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
			return false;
		}
		const code = requestedCode
			? normalizeRoomCode(requestedCode)
			: role === 'host'
				? createRoomCode()
				: normalizeRoomCode(joinCode);
		if (code.length !== 6) {
			lobbyError = 'Enter the full six-character room code.';
			return false;
		}
		lobbyStatus = 'connecting';
		localStorage.setItem('grindion-player-name', cleanPlayerName(playerName));
		lobbyRole = role;
		lobbyMembers = [];
		roomCode = code;
		publicArena = isPublicMatch;
		try {
			const connectedRoom = await RealtimeRoom.connect({
				supabase,
				code,
				playerId: localPlayerId,
				name: cleanPlayerName(playerName),
				role,
				callbacks: {
					onConnection: onRoomConnection,
					onRoster: (members) => {
						lobbyMembers = members;
						if (
							role === 'guest' &&
							lobbyStatus === 'lobby' &&
							!members.some((member) => member.role === 'host')
						) {
							lobbyError = 'The host left this room.';
							if (mode === 'arena') isRunning = false;
						}
					},
					onIntent: (intent) => remoteIntents.push(intent),
					onStart: acceptRemoteStart,
					onSnapshot: acceptRemoteSnapshot
				}
			});
			multiplayerRoom = connectedRoom;
			if (role === 'guest') {
				await new Promise((resolve) => setTimeout(resolve, 900));
				if (!connectedRoom.members.some((member) => member.role === 'host')) {
					await connectedRoom.disconnect();
					throw new Error('No host is present in that room.');
				}
			}
			playerName = connectedRoom.member.name;
			lobbyStatus = 'lobby';
			return true;
		} catch (error) {
			multiplayerRoom = null;
			lobbyStatus = 'idle';
			lobbyRole = null;
			lobbyMembers = [];
			publicArena = false;
			lobbyError = error instanceof Error ? error.message : 'Could not join the room.';
			return false;
		}
	}

	async function leaveRoom() {
		serverArena?.disconnect();
		serverArena = null;
		sharedArenaUrl = '';
		shareMessage = '';
		const room = multiplayerRoom;
		multiplayerRoom = null;
		if (room) await room.disconnect();
		lobbyStatus = 'idle';
		lobbyRole = null;
		lobbyMembers = [];
		roomCode = '';
		publicArena = false;
		remoteIntents = [];
		pendingNetworkEvents = [];
		lobbyError = '';
		if (mode === 'arena') {
			mode = 'title';
			game = null;
			isRunning = false;
		}
	}

	async function exitToTitle() {
		showHelp = false;
		showStandings = false;
		cancelControls();
		if (serverArena || multiplayerRoom) {
			await leaveRoom();
			return;
		}
		lobbyRole = null;
		deathRecap = null;
		isRunning = false;
		mode = 'title';
		game = null;
	}

	async function startMultiplayerMatch() {
		if (!multiplayerRoom || lobbyRole !== 'host' || !lobbyMembers.length) return;
		const seed = Math.floor(Math.random() * 2 ** 30);
		game = createGame({ seed, players: playerSetupsForRoster(lobbyMembers) });
		humanId = localPlayerId;
		remoteIntents = [];
		pendingNetworkEvents = [];
		lastPublishedTimeMs = -Infinity;
		botController.reset();
		startSession('arena');
		await multiplayerRoom.start($state.snapshot(game));
	}

	function startRespawnPreview() {
		game = createGame({ seed: 0x52455350, botCount: 7, config: { respawnMs: 10_000 } });
		humanId = Object.values(game.players).find((player) => !player.isBot)?.id ?? 'player';
		startSession('arena');
		const human = game.players[humanId]!;
		human.score = 84;
		human.health = 0;
		human.power = 0;
		human.mode = 'dead';
		human.respawnAtMs = game.timeMs + game.config.respawnMs;
		deathRecap = { killerName: 'Bot 4', scoreLost: 21 };
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

	function continueAfterGrowthLesson() {
		if (mode !== 'tutorial' || tutorialStep !== 2 || !game) return;
		stageTutorialRoute(game, 'cyan');
		mobileConversion = 'power';
		tutorialStep = 3;
	}

	function startSession(nextMode: 'arena' | 'tutorial') {
		mode = nextMode;
		eventFeed = [];
		isRunning = true;
		isDragging = false;
		dragButton = 0;
		dragConversion = 'score';
		isAiming = false;
		pointerOverPlayer = false;
		hasCommittedChain = false;
		mobileAimArmed = false;
		mobileConversion = 'score';
		deathRecap = null;
		showHelp = false;
		showStandings = false;
		optimisticChainIds = [];
		chainAnimations.clear();
		renderer.reset();
		if (game) {
			const position = game.players[humanId]?.position ?? { x: 720, y: 450 };
			const scale = canvas ? desiredScale(canvas.getBoundingClientRect(), false) : camera.scale;
			camera = { ...clampCamera(position, scale, canvas?.getBoundingClientRect()), scale };
		}
	}

	function desiredScale(rect: DOMRect, aiming = isAiming) {
		if (!rect.width || !rect.height) return 1;
		if (mode === 'title') return Math.min(rect.width, rect.height * 1.6) / TITLE_VIEW;
		if (useTouchControls)
			return (
				Math.min(rect.width, rect.height * 1.2) /
				(aiming ? MOBILE_AIM_VIEW_WIDTH : MOBILE_VIEW_WIDTH)
			);
		return Math.min(rect.width, rect.height * 1.6) / (aiming ? DESKTOP_AIM_VIEW : DESKTOP_VIEW);
	}

	function clampCamera(target: Point, scale: number, rect: DOMRect | undefined): Point {
		if (!game || !rect) return target;
		const clampAxis = (value: number, view: number, size: number) => {
			const min = view / 2 - CAMERA_EDGE_PADDING;
			const max = size - view / 2 + CAMERA_EDGE_PADDING;
			return min > max ? size / 2 : Math.max(min, Math.min(max, value));
		};
		return {
			x: clampAxis(target.x, rect.width / scale, game.arena.width),
			y: clampAxis(target.y, rect.height / scale, game.arena.height)
		};
	}

	function addEvent(event: GameEvent) {
		if (game) renderer.handleEvent(event, game, humanId);
		if (event.type === 'chain-committed' && game) {
			if (event.playerId === humanId) hasCommittedChain = true;
			const nodes = event.monsterIds
				.map((id) => game?.arena.monsters[id])
				.filter(Boolean)
				.map((monster) => ({
					id: monster!.id,
					position: { ...monster!.position },
					color: monster!.color
				}));
			if (nodes.length) {
				chainAnimations.set(event.playerId, {
					playerId: event.playerId,
					origin: { ...event.origin },
					nodes,
					startedAt: performance.now(),
					timing: createChainMotionTiming(nodes.length)
				});
			}
		}
		let text = '';
		let tone: FeedTone = 'neutral';
		if (event.type === 'projectile-parried') {
			text = event.playerId === humanId ? 'PERFECT PARRY' : 'SHOT PARRIED';
			tone = 'energy';
		} else if (event.type === 'projectile-fired' && event.playerId === humanId) {
			text = 'POWER COMMITTED';
			tone = 'coral';
		} else if (event.type === 'player-died') {
			const victim = event.playerId === humanId ? 'YOU' : game?.players[event.playerId]?.name;
			const killer = event.byPlayerId === humanId ? 'YOU' : game?.players[event.byPlayerId]?.name;
			text = `${killer ?? 'A RIVAL'} SHATTERED ${victim ?? 'A RIVAL'}`;
			tone = 'coral';
		} else if (event.type === 'chain-committed' && event.playerId === humanId) {
			text = event.conversion === 'power' ? 'CHAIN → POWER' : 'CHAIN BANKED';
			tone = event.conversion === 'power' ? 'violet' : 'gold';
		}
		if (text) addFeedMessage(text, tone);
		if (event.type === 'player-died' && event.playerId === humanId) {
			deathRecap = {
				killerName: game?.players[event.byPlayerId]?.name ?? 'Unknown rival',
				scoreLost: event.scoreLost
			};
			cancelControls();
			queuedIntents = [];
			commitAfterTick = null;
		} else if (event.type === 'player-respawned' && event.playerId === humanId) {
			deathRecap = null;
			addFeedMessage(
				`REDEPLOYED · ${Math.ceil((game?.config.spawnProtectionMs ?? 0) / 1000)}S SHIELD`,
				'energy'
			);
		}

		if (mode !== 'tutorial') return;
		if (tutorialStep === 5 && event.type === 'player-damaged' && event.playerId === humanId) {
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
			tutorialRouteIds = [];
			tutorialStep = 2;
		} else if (
			tutorialStep === 1 &&
			event.type === 'chain-committed' &&
			event.playerId === humanId &&
			event.conversion === 'power' &&
			game
		) {
			stageTutorialRoute(game, 'coral');
			tutorialStep = 0;
		} else if (
			tutorialStep === 3 &&
			event.type === 'chain-committed' &&
			event.playerId === humanId &&
			event.conversion === 'power'
		) {
			tutorialRouteIds = [];
			tutorialStep = 4;
		} else if (
			tutorialStep === 4 &&
			event.type === 'projectile-fired' &&
			event.playerId === humanId
		) {
			tutorialStep = 5;
			if (game?.players[humanId]) game.players[humanId]!.power = 15;
			tutorialShotAt = (game?.timeMs ?? 0) + 1100;
		} else if (
			tutorialStep === 5 &&
			event.type === 'projectile-parried' &&
			event.playerId === humanId
		)
			tutorialStep = 6;
	}

	function addFeedMessage(text: string, tone: FeedTone) {
		eventFeed = [{ id: eventId++, text, tone }, ...eventFeed].slice(0, 4);
	}

	let queuedIntents: GameIntent[] = [];
	function dispatch(intent: HumanIntent) {
		if (!game || !isRunning || isDead) return;
		const gameIntent = { ...intent, playerId: humanId } as GameIntent;
		if (serverArena) serverArena.sendIntent(gameIntent);
		else if (lobbyRole === 'guest' && multiplayerRoom) void multiplayerRoom.sendIntent(gameIntent);
		else queuedIntents.push(gameIntent);
	}

	function canvasPoint(event: PointerEvent): Point {
		const rect = canvas.getBoundingClientRect();
		return {
			x: camera.x + (event.clientX - rect.left - rect.width / 2) / camera.scale,
			y: camera.y + (event.clientY - rect.top - rect.height / 2) / camera.scale
		};
	}

	function segmentHit(monster: Monster, start: Point, end: Point) {
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const lengthSquared = dx * dx + dy * dy;
		const progress = lengthSquared
			? Math.max(
					0,
					Math.min(
						1,
						((monster.position.x - start.x) * dx + (monster.position.y - start.y) * dy) /
							lengthSquared
					)
				)
			: 0;
		const nearest = { x: start.x + dx * progress, y: start.y + dy * progress };
		return {
			progress,
			distance: Math.hypot(monster.position.x - nearest.x, monster.position.y - nearest.y)
		};
	}

	function isLegalChainTarget(monster: Monster) {
		if (!game || !me || !monster.alive || monster.id === optimisticChainIds.at(-1)) return false;
		if (!optimisticChainIds.length) {
			return Boolean(game.arena.monsters[me.cellId]?.neighborIds.includes(monster.id));
		}
		if (optimisticChainIds.includes(monster.id)) return true;
		const previous = game.arena.monsters[optimisticChainIds.at(-1)!];
		const colors = optimisticChainIds
			.map((id) => game?.arena.monsters[id]?.color)
			.filter(Boolean) as Monster['color'][];
		return Boolean(
			previous?.neighborIds.includes(monster.id) &&
			canExtendWithColor(colors, monster.color, game.config.grindstoneStreak)
		);
	}

	/** Monsters the local player could add next, for on-board highlighting. */
	function legalTargetIds(): Set<string> {
		const ids: string[] = [];
		if (!game || !me || mode === 'title' || isDead || isAiming) return new Set(ids);
		const chain = optimisticChainIds.length ? optimisticChainIds : me.chain;
		if (!chain.length && !isDragging) return new Set(ids);
		const source = game.arena.monsters[chain.at(-1) ?? me.cellId];
		const colors = chain
			.map((id) => game?.arena.monsters[id]?.color)
			.filter(Boolean) as Monster['color'][];
		for (const id of source?.neighborIds ?? []) {
			const monster = game.arena.monsters[id];
			if (!monster?.alive || chain.includes(id)) continue;
			if (!chain.length || canExtendWithColor(colors, monster.color, game.config.grindstoneStreak))
				ids.push(id);
		}
		return new Set(ids);
	}

	function chainPreview() {
		if (!game || !me || !me.chain.length || mode === 'title') return null;
		const length = me.chain.length;
		if (length < game.config.minChain)
			return { text: `${length}/${game.config.minChain} TO COMMIT`, color: '#c9bde6' };
		const conversion = useTouchControls ? mobileConversion : isDragging ? dragConversion : null;
		const scoreGain = chainValue(length);
		const powerGained = powerGain(length, me.score, game.config);
		if (conversion === 'score') return { text: `+${scoreGain} SCORE`, color: PALETTE.gold };
		if (conversion === 'power') return { text: `+${powerGained} POWER`, color: PALETTE.energy };
		return { text: `+${scoreGain} SCORE · +${powerGained} PWR`, color: PALETTE.parchment };
	}

	function chainTargetsAlong(start: Point, end: Point) {
		// Keep mobile circles large enough for a thumb, but below the 47.7-unit
		// center-to-corner distance so orthogonal tiles cannot steal a diagonal swipe.
		const hitRadius = useTouchControls ? 40 : 35;
		return monsters
			.map((monster) => ({ monster, ...segmentHit(monster, start, end) }))
			.filter(({ monster, distance }) => monster.alive && distance <= hitRadius)
			.sort(
				(a, b) =>
					a.progress - b.progress ||
					a.distance - b.distance ||
					a.monster.id.localeCompare(b.monster.id)
			);
	}

	function selectChainTarget(monster: Monster) {
		if (!isLegalChainTarget(monster)) return false;
		const intentType = optimisticChainIds.length ? 'chain-extend' : 'chain-start';
		const existingIndex = optimisticChainIds.indexOf(monster.id);
		optimisticChainIds =
			existingIndex >= 0
				? optimisticChainIds.slice(0, existingIndex + 1)
				: [...optimisticChainIds, monster.id];
		latestChainMonster = monster.id;
		dispatch({ type: intentType, monsterId: monster.id });
		return true;
	}

	function onPointerDown(event: PointerEvent) {
		if (mode === 'title' || isDead || chainAnimations.has(humanId)) return;
		canvas.setPointerCapture(event.pointerId);
		pointerWorld = canvasPoint(event);
		if (!me) return;
		const distanceFromPlayer = Math.hypot(
			pointerWorld.x - me.position.x,
			pointerWorld.y - me.position.y
		);
		const startsOnPlayer =
			distanceFromPlayer <=
			Math.max(useTouchControls ? 52 : 38, (game?.config.playerRadius ?? 18) * 2);
		const mobileShot = useTouchControls && mobileAimArmed && event.button === 0;
		if (mobileShot || (event.button === 2 && !startsOnPlayer)) {
			event.preventDefault();
			isAiming = true;
			return;
		}
		if ((event.button !== 0 && event.button !== 2) || !startsOnPlayer) return;
		if (event.button === 2) event.preventDefault();
		isDragging = true;
		dragButton = event.button;
		dragConversion =
			event.button === 2 || (useTouchControls && mobileConversion === 'power') ? 'power' : 'score';
		latestChainMonster = '';
		optimisticChainIds = [];
		previousDragPoint = pointerWorld;
	}

	function updatePointerState(point: Point) {
		pointerWorld = point;
		pointerOverPlayer = Boolean(
			me &&
			Math.hypot(pointerWorld.x - me.position.x, pointerWorld.y - me.position.y) <=
				Math.max(useTouchControls ? 52 : 38, (game?.config.playerRadius ?? 18) * 2)
		);
		if (!isDragging) return;
		const start = previousDragPoint ?? pointerWorld;
		for (const { monster } of chainTargetsAlong(start, pointerWorld)) {
			selectChainTarget(monster);
		}
		previousDragPoint = pointerWorld;
	}

	function onPointerMove(event: PointerEvent) {
		if (mode === 'title') return;
		const coalesced = event.getCoalescedEvents?.() ?? [];
		const samples = coalesced.length ? coalesced : [event];
		for (const sample of samples) updatePointerState(canvasPoint(sample));
	}

	function onPointerUp(event: PointerEvent) {
		const mobileShot = useTouchControls && mobileAimArmed && event.button === 0;
		if ((event.button === 2 || mobileShot) && isAiming) {
			isAiming = false;
			mobileAimArmed = false;
			pointerWorld = canvasPoint(event);
			const position = me?.position ?? { x: 0, y: 0 };
			const dx = pointerWorld.x - position.x;
			const dy = pointerWorld.y - position.y;
			const length = Math.hypot(dx, dy) || 1;
			dispatch({ type: 'fire', direction: { x: dx / length, y: dy / length } });
			return;
		}
		if (!isDragging || event.button !== dragButton) return;
		isDragging = false;
		dragButton = 0;
		previousDragPoint = null;
		if (!latestChainMonster) {
			dispatch({ type: 'chain-cancel' });
			return;
		}
		latestChainMonster = '';
		optimisticChainIds = [];
		const conversion = event.shiftKey ? 'power' : dragConversion;
		if (lobbyRole === 'guest') dispatch({ type: 'chain-commit', conversion });
		else commitAfterTick = conversion;
	}

	function toggleMobileAim() {
		if (!game || !me || mode === 'title' || isDead || isDragging || chainAnimations.has(humanId))
			return;
		mobileAimArmed = !mobileAimArmed;
		isAiming = mobileAimArmed;
		if (mobileAimArmed) pointerWorld = { x: me.position.x + 120, y: me.position.y };
	}

	function selectNumpadDirection(direction: Point) {
		if (!game || !me || mode === 'title' || isDead || isAiming || chainAnimations.has(humanId))
			return;
		if (!optimisticChainIds.length && me.chain.length) optimisticChainIds = [...me.chain];
		const sourceId = optimisticChainIds.at(-1) ?? me.cellId;
		const source = game.arena.monsters[sourceId];
		if (!source) return;
		const target = source.neighborIds
			.map((id) => game?.arena.monsters[id])
			.find(
				(monster) =>
					monster &&
					Math.sign(monster.position.x - source.position.x) === direction.x &&
					Math.sign(monster.position.y - source.position.y) === direction.y
			);
		if (target) selectChainTarget(target);
	}

	function resetOptimisticChain() {
		optimisticChainIds = [];
		latestChainMonster = '';
		previousDragPoint = null;
	}

	function commitNumpadChain(conversion: 'score' | 'power') {
		if (!optimisticChainIds.length && !me?.chain.length) return;
		dispatch({ type: 'chain-commit', conversion });
		resetOptimisticChain();
	}

	function cancelActiveChain() {
		dispatch({ type: 'chain-cancel' });
		resetOptimisticChain();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (mode === 'title') {
			if (event.target instanceof HTMLInputElement) return;
			if (event.code === 'KeyT') {
				event.preventDefault();
				startTutorial();
			} else if (event.code === 'KeyA') {
				event.preventDefault();
				startArena();
			}
			return;
		}
		if (event.key === '?' || event.code === 'KeyH') {
			event.preventDefault();
			showHelp = !showHelp;
			return;
		}
		if (showHelp && event.key === 'Escape') {
			showHelp = false;
			return;
		}
		const direction =
			KEYBOARD_DIRECTIONS[event.code] ??
			KEY_VALUE_DIRECTIONS[event.key.toLowerCase()] ??
			KEY_VALUE_DIRECTIONS[event.key];
		if (direction) {
			event.preventDefault();
			selectNumpadDirection(direction);
			return;
		}
		if (event.repeat) return;
		if (
			event.code === 'Numpad5' ||
			event.code === 'Digit5' ||
			event.code === 'KeyS' ||
			event.code === 'NumpadEnter' ||
			event.code === 'Enter' ||
			event.key === '5' ||
			event.key.toLowerCase() === 's' ||
			event.key === 'Enter'
		) {
			event.preventDefault();
			commitNumpadChain('score');
			return;
		}
		if (
			event.code === 'NumpadAdd' ||
			event.code === 'KeyF' ||
			event.key === '+' ||
			event.key.toLowerCase() === 'f'
		) {
			event.preventDefault();
			commitNumpadChain('power');
			return;
		}
		if (
			event.code === 'Numpad0' ||
			event.code === 'NumpadDecimal' ||
			event.code === 'NumpadSubtract' ||
			event.key === '0'
		) {
			event.preventDefault();
			cancelActiveChain();
			return;
		}
		if (event.code === 'Space') {
			event.preventDefault();
			dispatch({ type: 'parry' });
		}
		if (event.key === 'Escape') {
			isDragging = false;
			isAiming = false;
			cancelActiveChain();
		}
	}

	function cancelControls() {
		isDragging = false;
		dragButton = 0;
		dragConversion = 'score';
		isAiming = false;
		mobileAimArmed = false;
		pointerOverPlayer = false;
		optimisticChainIds = [];
		previousDragPoint = null;
	}

	function playerGrindstone(player: PlayerState) {
		return grindstoneState(
			player.chain
				.map((id) => game?.arena.monsters[id]?.color)
				.filter(Boolean) as Monster['color'][],
			game?.config.grindstoneStreak ?? 5
		);
	}

	function draw(now: number) {
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
		for (const [playerId, animation] of chainAnimations) {
			if (now - animation.startedAt > animation.timing.totalMs + 220)
				chainAnimations.delete(playerId);
		}
		camera.scale += (desiredScale(rect) - camera.scale) * 0.16;
		let focus: Point;
		if (mode === 'title') {
			focus = {
				x: game.arena.width / 2 + Math.sin(now / 9000) * 300,
				y: game.arena.height / 2 + Math.sin(now / 6500) * 160
			};
		} else {
			const target = me ? animatedPlayerPosition(me, chainAnimations, now) : camera;
			focus = isAiming
				? {
						x: target.x + (pointerWorld.x - target.x) * 0.12,
						y: target.y + (pointerWorld.y - target.y) * 0.12
					}
				: target;
		}
		const cameraTarget = clampCamera(focus, camera.scale, rect);
		const follow = mode === 'title' ? 0.03 : 0.1;
		camera.x += (cameraTarget.x - camera.x) * follow;
		camera.y += (cameraTarget.y - camera.y) * follow;
		canvas.dataset.camera = `${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.scale.toFixed(4)}`;

		const playing = mode !== 'title';
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		renderer.draw(context, {
			game,
			humanId: playing ? humanId : '',
			now,
			width: rect.width,
			height: rect.height,
			camera,
			chainAnimations,
			tutorialRouteIds: mode === 'tutorial' ? tutorialRouteIds : [],
			legalTargetIds: playing ? legalTargetIds() : new Set(),
			startCue:
				playing && me && !hasCommittedChain && !isDragging && !me.chain.length && !isDead
					? useTouchControls
						? 'HOLD + DRAG FROM HERO'
						: 'DRAG FROM YOUR HERO'
					: null,
			aim: playing && isAiming ? { target: pointerWorld, power } : null,
			chainPreview: playing ? chainPreview() : null,
			spectating: !playing
		});
	}

	onMount(() => {
		localPlayerId =
			localStorage.getItem('grindion-player-id') ??
			(typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `player-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		localStorage.setItem('grindion-player-id', localPlayerId);
		playerName = localStorage.getItem('grindion-player-name') ?? 'Wanderer';
		const touchQuery = window.matchMedia('(pointer: coarse), (max-width: 700px)');
		const updateTouchControls = () => (useTouchControls = touchQuery.matches);
		updateTouchControls();
		touchQuery.addEventListener('change', updateTouchControls);
		renderer.load('/assets/grindion-sprites.png');
		if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
			const params = new URLSearchParams(window.location.search);
			if (params.has('respawn-demo')) startRespawnPreview();
			else if (params.has('short-round')) startArena(4_000);
		}
		let frame = 0;
		let last = performance.now();
		let accumulator = 0;
		let attractAccumulator = 0;
		const loop = (now: number) => {
			const elapsed = Math.min(100, now - last);
			last = now;
			if (mode === 'title') {
				if (!game) startAttract();
				attractAccumulator += elapsed;
				while (game && attractAccumulator >= 50) {
					const result = stepGame($state.snapshot(game), attractBots.update(game), 50);
					game = result.state;
					for (const event of result.events) renderer.handleEvent(event, game, '');
					for (const event of result.events) {
						if (event.type !== 'chain-committed') continue;
						chainAnimations.set(event.playerId, {
							playerId: event.playerId,
							origin: { ...event.origin },
							nodes: event.monsterIds.map((id) => ({
								id,
								position: { ...game!.arena.monsters[id]!.position },
								color: game!.arena.monsters[id]!.color
							})),
							startedAt: now,
							timing: createChainMotionTiming(event.monsterIds.length)
						});
					}
					attractAccumulator -= 50;
				}
			} else if (game && isRunning) {
				attractAccumulator = 0;
				if (lobbyRole === 'guest') accumulator = 0;
				else accumulator += elapsed;
				while (accumulator >= 50) {
					const intents = [...queuedIntents, ...(lobbyRole === 'host' ? remoteIntents : [])];
					queuedIntents = [];
					if (lobbyRole === 'host') remoteIntents = [];
					if (mode === 'arena') intents.push(...(botController.update?.(game) ?? []));
					if (
						mode === 'tutorial' &&
						tutorialStep === 5 &&
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
					if (lobbyRole === 'host') pendingNetworkEvents.push(...result.events);
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
					if (lobbyRole === 'host' && multiplayerRoom && game.timeMs - lastPublishedTimeMs >= 100) {
						lastPublishedTimeMs = game.timeMs;
						const events = pendingNetworkEvents;
						pendingNetworkEvents = [];
						void multiplayerRoom.publish($state.snapshot(game), events);
					}
					accumulator -= 50;
				}
				if (game.timeMs >= game.roundEndsAtMs) isRunning = false;
			}
			draw(now);
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => {
			cancelAnimationFrame(frame);
			touchQuery.removeEventListener('change', updateTouchControls);
			void multiplayerRoom?.disconnect();
			serverArena?.disconnect();
		};
	});
</script>

<svelte:head>
	<title>Grindion — Chain. Power. Survive.</title>
	<meta
		name="description"
		content="A pixel-art multiplayer puzzle brawler. Chain monsters, bank Score or forge Power, and spend everything on one shot."
	/>
</svelte:head>

<svelte:window onkeydown={onKeyDown} onblur={cancelControls} />

{#snippet sprite(cell: number, size: number)}
	{@const frame = SPRITE_FRAMES[cell]!}
	{@const k = size / Math.max(frame.width, frame.height)}
	<span
		class="sprite"
		aria-hidden="true"
		style:width={`${size}px`}
		style:height={`${size}px`}
		style:background-size={`${2172 * k}px ${724 * k}px`}
		style:background-position={`${-frame.x * k + (size - frame.width * k) / 2}px ${-frame.y * k + (size - frame.height * k) / 2}px`}
	></span>
{/snippet}

{#snippet keycap(label: string)}<kbd>{label}</kbd>{/snippet}

<main class="game" class:touch={useTouchControls} data-mode={mode}>
	<div
		class:dragging={isDragging}
		class:aiming={isAiming}
		class:dead={isDead}
		class:player-hover={pointerOverPlayer}
		class="stage"
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
	</div>

	{#if mode === 'title'}
		<div class="title-screen">
			<div class="title-column">
				<header class="hero">
					<img
						class="hero-art"
						src="/assets/grindion-banner.webp"
						alt=""
						width="1600"
						height="533"
						fetchpriority="high"
					/>
					<h1 class="visually-hidden">GRINDION</h1>
					<p class="tagline">Chain monsters. Choose your payoff. <em>Spend everything.</em></p>
				</header>

				<section class="play-card panel" aria-label="Play">
					{#if lobbyStatus === 'lobby'}
						<div class="lobby">
							<div class="lobby-heading">
								<span class="label">{publicArena ? 'PUBLIC ARENA' : 'ROOM CODE'}</span>
								<strong
									>{publicArena
										? lobbyMembers.length >= 2
											? 'MATCH FOUND'
											: 'SEARCHING…'
										: roomCode}</strong
								>
							</div>
							<ul aria-label="Room players">
								{#each lobbyMembers as member (member.playerId)}
									<li>
										<i></i>{member.playerId === localPlayerId ? 'YOU' : member.name}<small
											>{publicArena ? 'READY' : member.role === 'host' ? 'HOST' : 'READY'}</small
										>
									</li>
								{/each}
							</ul>
							{#if publicArena}
								<p>
									{lobbyMembers.length >= 2
										? 'Rival found. Dropping into the arena…'
										: 'Searching for another real player…'}
								</p>
							{:else if lobbyRole === 'host'}
								<button class="btn primary wide" onclick={startMultiplayerMatch}
									>START ONLINE MATCH</button
								>
							{:else}
								<p>Waiting for the host to start the round…</p>
							{/if}
							<button class="btn ghost" onclick={leaveRoom}>LEAVE ROOM</button>
						</div>
					{:else}
						<label class="callsign">
							<span class="label">CALLSIGN</span>
							<input maxlength="18" autocomplete="nickname" bind:value={playerName} />
						</label>
						<button
							class="btn primary wide join"
							disabled={lobbyStatus === 'connecting'}
							onclick={joinOnlineArena}
						>
							{lobbyStatus === 'connecting' ? 'ENTERING ARENA…' : 'JOIN ONLINE ARENA'}
						</button>
						<p class="join-note"><i class="live-dot"></i>PLAY NOW · BOTS FILL EMPTY SEATS</p>

						<div class="solo-row">
							<button class="btn" onclick={startTutorial}>
								PLAY TUTORIAL {@render keycap('T')}
							</button>
							<button class="btn" onclick={() => startArena()}>
								SOLO ARENA {@render keycap('A')}
							</button>
						</div>

						<details class="private-rooms">
							<summary>PRIVATE ROOMS</summary>
							<div class="private-room-actions">
								<div class="join-room">
									<input
										aria-label="Private room code"
										placeholder="ROOM CODE"
										maxlength="6"
										bind:value={joinCode}
									/>
									<button
										class="btn small"
										disabled={!isSupabaseConfigured() || lobbyStatus === 'connecting'}
										onclick={() => connectRoom('guest')}>JOIN PRIVATE</button
									>
								</div>
								<button
									class="btn small"
									disabled={!isSupabaseConfigured() || lobbyStatus === 'connecting'}
									onclick={() => connectRoom('host')}>CREATE PRIVATE ROOM</button
								>
								{#if !isSupabaseConfigured()}
									<small>ADD THE TWO PUBLIC SUPABASE ENV VARS TO ENABLE PRIVATE ROOMS</small>
								{/if}
							</div>
						</details>
					{/if}
					{#if lobbyError}<p class="error" role="alert">{lobbyError}</p>{/if}
				</section>

				<ol class="how-to-play" aria-label="How to play">
					{#each HOW_TO_PLAY as step, index (step.title)}
						<li class="panel">
							{@render sprite(step.sprite, 44)}
							<div>
								<strong><b>{index + 1}</b>{step.title}</strong>
								<span>{step.copy}</span>
							</div>
						</li>
					{/each}
				</ol>
			</div>
		</div>
	{:else}
		<header class="hud-top">
			<div class="hud-left">
				<button class="btn icon" onclick={exitToTitle} aria-label="Back to title">
					<span aria-hidden="true">◂</span>
				</button>
				<div class="wordmark" aria-hidden="true">GRINDION</div>
				{#if mode === 'arena'}
					<div class="status-pill" class:offline={!isRunning}><i></i>{statusText}</div>
				{:else}
					<div class="status-pill training"><i></i>TRAINING MODE</div>
				{/if}
			</div>
			{#if mode === 'arena'}
				<div class="round-clock" class:urgent={secondsLeft <= 30}>
					<span>ROUND</span><strong>{timerText}</strong>
				</div>
			{/if}
			<div class="hud-right">
				{#if mode === 'arena' && myRank}
					<button
						class="rank-chip"
						aria-expanded={showStandings}
						aria-controls="leaderboard"
						onclick={() => (showStandings = !showStandings)}
					>
						<small>RANK</small><strong>#{myRank}</strong><small>/ {standings.length}</small>
					</button>
				{/if}
				<button
					class="btn icon"
					aria-label="Controls and rules"
					aria-expanded={showHelp}
					onclick={() => (showHelp = !showHelp)}>?</button
				>
			</div>
		</header>

		{#if mode === 'tutorial'}
			<section class="tutorial-card panel" aria-live="polite">
				<div class="lesson-meta">
					<span class="label"
						>LESSON {Math.min(tutorialStep + 1, TUTORIAL_STEPS.length)} / {TUTORIAL_STEPS.length}</span
					>
					<div class="lesson-dots" aria-hidden="true">
						{#each TUTORIAL_STEPS as step, index (step.title)}<i
								class:done={index < tutorialStep}
								class:current={index === tutorialStep}
							></i>{/each}
					</div>
				</div>
				<h2>{TUTORIAL_STEPS[tutorialStep].title}</h2>
				<p>{tutorialStepCopy()}</p>
				{#if tutorialStep === 2}<button class="btn primary" onclick={continueAfterGrowthLesson}
						>BUILD POWER →</button
					>{/if}
				{#if tutorialStep === 6}<button class="btn primary" onclick={() => startArena()}
						>ENTER LIVE ARENA →</button
					>{/if}
			</section>
		{/if}

		{#if mode === 'arena'}
			<aside
				id="leaderboard"
				class="leaderboard panel"
				class:open={showStandings}
				aria-label="Leaderboard"
			>
				<div class="panel-heading">
					<span>LIVE BOARD</span><small>{players.length || 8} ACTIVE</small>
				</div>
				<div class="leaders">
					{#each leaderboard as player (player.id)}<div
							class:you={player.id === humanId}
							class:down={player.mode === 'dead'}
							class="leader-row"
						>
							<b>{player.rank}</b><i style:--player-color={playerColor(player, humanId)}></i><span
								>{player.id === humanId ? 'YOU' : player.name}</span
							><strong>{Math.round(player.score)}</strong>
						</div>{/each}
				</div>
				{#if serverArena && isRunning}
					<div class="arena-social">
						<button class="btn small primary" onclick={shareArena}
							>{shareMessage || 'INVITE FRIENDS'}</button
						>
						<a href={resolve(`/?arena=${roomCode}`)}>ARENA {roomCode}</a>
						<button class="btn small ghost" onclick={leaveRoom}>LEAVE ARENA</button>
					</div>
				{/if}
			</aside>
		{/if}

		{#if mode === 'arena' || tutorialStep > 0}
			<div class:tutorial-hud={mode === 'tutorial'} class="player-hud panel">
				{#if mode === 'arena' || tutorialStep >= 5}
					<div
						class="heart-hud"
						class:low={health / Math.max(1, maxHealth) < 0.35}
						aria-label={`Health ${Math.ceil(health)} of ${Math.ceil(maxHealth)}`}
					>
						<span class="label">VITALS</span>
						<strong>{Math.ceil(health)}<small>/{Math.ceil(maxHealth)}</small></strong>
						<i class="meter"
							><em style:width={`${Math.min(100, (health / Math.max(1, maxHealth)) * 100)}%`}
							></em></i
						>
					</div>
				{/if}
				{#if mode === 'arena' || tutorialStep >= 1}
					<div class="score-card">
						<span class="label">SCORE</span><strong>{score}</strong>
						{#if mode === 'tutorial' && tutorialStep === 2}<small>NO PATH LIMIT</small>{/if}
					</div>
				{/if}
				{#if mode === 'arena' || tutorialStep >= 3}
					<div class="power-card" class:armed={power >= minFirePower}>
						<span class="label">{isAiming ? 'ARMED · ALL IN' : 'POWER'}</span><strong
							>{Math.floor(power)}</strong
						>
						<i class="meter"
							><em style:width={`${Math.min(100, (power / powerCap) * 100)}%`}></em><b
								style:left={`${(minFirePower / powerCap) * 100}%`}
							></b></i
						>
					</div>
				{/if}
			</div>
		{/if}

		{#if mode === 'tutorial' && tutorialStep === 2}
			<div class="callout">ADJACENT PATHS · UNLIMITED DISTANCE</div>
		{/if}
		{#if isAiming}
			<div class="callout aim">RELEASE TO FIRE ALL {Math.floor(power)} POWER</div>
		{:else if chainLength > 0}
			<div class="chain-status" class:grindstone={grindstoneReady}>
				<span>{chainLength}×</span>
				<div>
					{#if grindstoneReady}
						<strong>GRINDSTONE READY</strong><small>NEXT MONSTER MAY BE ANY COLOR</small>
					{:else if mode === 'tutorial' && tutorialStep === 0}
						<strong>KEEP DRAGGING</strong><small>CONNECT THE HIGHLIGHTED ROUTE</small>
					{:else if mode === 'tutorial' && tutorialStep === 1}
						<strong>RELEASE TO {dragConversion === 'power' ? 'STORE POWER' : 'BANK SCORE'}</strong
						><small
							>{dragConversion === 'power'
								? 'RIGHT-DRAG CONVERTS THE ROUTE TO POWER'
								: 'YOU LAND ON THE LAST CREATURE'}</small
						>
					{:else if mode === 'tutorial' && tutorialStep === 3 && useTouchControls}
						<strong>POWER MODE SELECTED</strong><small>RELEASE TO FORGE POWER</small>
					{:else if mode === 'tutorial' && tutorialStep === 3}
						<strong>RIGHT-DRAG + RELEASE</strong><small>STORE THIS CHAIN AS POWER</small>
					{:else if useTouchControls}
						<strong>RELEASE: {mobileConversion === 'power' ? 'FORGE POWER' : 'BANK SCORE'}</strong
						><small>CHOOSE MODE BEFORE STARTING A CHAIN</small>
					{:else if isDragging}
						<strong>RELEASE: {dragConversion === 'power' ? 'STORE POWER' : 'BANK SCORE'}</strong
						><small>LMB SCORES · RMB STORES POWER</small>
					{:else}
						<strong>5 / ENTER BANKS · + / F STORES</strong><small>0 OR ESC CANCELS</small>
					{/if}
				</div>
			</div>
		{/if}

		<div class="event-feed" aria-live="polite">
			{#each eventFeed as event (event.id)}<div class={`feed-item tone-${event.tone}`}>
					{event.text}
				</div>{/each}
		</div>

		{#if !useTouchControls && mode === 'arena'}
			<div class="hint-strip" aria-hidden="true">
				<span>{@render keycap('LMB')} drag hero · Score</span>
				<span>{@render keycap('RMB')} drag hero · Power</span>
				<span>{@render keycap('RMB')} hold · Aim</span>
				<span>{@render keycap('SPACE')} Parry</span>
				<span>{@render keycap('?')} Controls</span>
			</div>
		{/if}

		{#if showHelp}
			<div class="sheet-backdrop" role="presentation" onclick={() => (showHelp = false)}></div>
			<div class="help-sheet panel" role="dialog" aria-modal="true" aria-label="Controls and rules">
				<div class="sheet-heading">
					<h2>How to play</h2>
					<button class="btn icon" aria-label="Close" onclick={() => (showHelp = false)}>✕</button>
				</div>
				<div class="help-grid">
					<section>
						<h3>The loop</h3>
						<ol class="rules">
							{#each HOW_TO_PLAY as step, index (step.title)}
								<li>
									{@render sprite(step.sprite, 34)}
									<div>
										<strong>{index + 1}. {step.title}</strong><span>{step.copy}</span>
									</div>
								</li>
							{/each}
						</ol>
					</section>
					{#if useTouchControls}
						<section>
							<h3>Touch</h3>
							<dl class="binds">
								<dt>Hold hero + drag</dt>
								<dd>Build a route</dd>
								<dt>Release</dt>
								<dd>Commit as the selected reward</dd>
								<dt>Bank / Forge</dt>
								<dd>Pick Score or Power before chaining</dd>
								<dt>Aim + Fire</dt>
								<dd>Drag to aim, release to fire all Power</dd>
								<dt>Parry</dt>
								<dd>Tap when the warning ring turns cyan</dd>
							</dl>
						</section>
					{:else}
						<section>
							<h3>Mouse</h3>
							<dl class="binds">
								<dt>{@render keycap('LMB')} drag from hero</dt>
								<dd>Route, release banks Score</dd>
								<dt>{@render keycap('RMB')} drag from hero</dt>
								<dd>Route, release stores Power</dd>
								<dt>Drag back</dt>
								<dd>Shorten the route</dd>
								<dt>{@render keycap('RMB')} hold off hero</dt>
								<dd>Aim and scout</dd>
								<dt>Release aim</dt>
								<dd>Fire every point of Power</dd>
								<dt>{@render keycap('SPACE')}</dt>
								<dd>Parry. Time it to the cyan ring</dd>
							</dl>
						</section>
						<section>
							<h3>Keyboard</h3>
							<div class="numpad" aria-label="Numpad directions">
								{#each ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as key (key)}
									<kbd class:bank={key === '5'}>{key}</kbd>
								{/each}
							</div>
							<dl class="binds">
								<dt>{@render keycap('QWE')} {@render keycap('AD')} {@render keycap('ZXC')}</dt>
								<dd>Laptop directions</dd>
								<dt>{@render keycap('5')} {@render keycap('S')} {@render keycap('ENTER')}</dt>
								<dd>Bank Score</dd>
								<dt>{@render keycap('+')} {@render keycap('F')}</dt>
								<dd>Store Power</dd>
								<dt>{@render keycap('0')} {@render keycap('ESC')}</dt>
								<dd>Cancel the chain</dd>
							</dl>
						</section>
					{/if}
				</div>
				<p class="risk-note">
					<strong>Greed has a cost.</strong> While you chain you cannot shoot or parry. After you fire,
					everyone can see you are empty.
				</p>
			</div>
		{/if}

		{#if mode === 'arena' && isDead}
			<div class="overlay respawn" role="dialog" aria-modal="true" aria-labelledby="respawn-title">
				<div class="overlay-card panel">
					<div class="eyebrow danger">SHATTERED BY {deathRecap?.killerName ?? 'A RIVAL'}</div>
					<h2 id="respawn-title">YOU WERE BROKEN</h2>
					<div class="stat-row">
						<div>
							<span>SCORE LOST</span><strong class="danger">−{deathRecap?.scoreLost ?? 0}</strong>
						</div>
						<div><span>SCORE REMAINING</span><strong class="gold">{score}</strong></div>
						<div><span>POWER</span><strong class="energy">EMPTIED</strong></div>
					</div>
					<div class="respawn-status">
						<div><span>REDEPLOYING TO A SAFE CELL</span><strong>{respawnSeconds}</strong></div>
						<i class="meter"><em style:width={`${respawnProgress}%`}></em></i>
					</div>
					<p>
						You return at full health with {Math.ceil(
							(game?.config.spawnProtectionMs ?? 0) / 1000
						)}s of spawn protection.
					</p>
				</div>
			</div>
		{/if}

		{#if !isRunning && mode === 'arena'}
			<div class="overlay results" role="dialog" aria-modal="true" aria-labelledby="results-title">
				<div class="overlay-card panel wide">
					<div class="eyebrow">ROUND COMPLETE</div>
					<h2 id="results-title">
						{leaderboard[0]?.id === humanId
							? 'CAVERN CONQUERED'
							: `${leaderboard[0]?.name ?? 'A RIVAL'} WINS`}
					</h2>
					{#if myRank}<p class="placement">
							You placed <strong>#{myRank}</strong> of {standings.length}
						</p>{/if}
					<table class="standings">
						<thead><tr><th>#</th><th>PLAYER</th><th>SCORE</th><th>KOS</th><th>FALLS</th></tr></thead
						>
						<tbody>
							{#each standings as player (player.id)}
								<tr class:you={player.id === humanId}>
									<td>{player.rank}</td>
									<td
										><i style:--player-color={playerColor(player, humanId)}></i>{player.id ===
										humanId
											? 'YOU'
											: player.name}</td
									>
									<td>{Math.round(player.score)}</td>
									<td>{player.kills}</td>
									<td>{player.deaths}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div class="overlay-actions">
						{#if serverArena}
							<p>{lobbyError || 'Next round starts in a moment…'}</p>
						{:else if lobbyRole === 'host'}
							<button class="btn primary" onclick={startMultiplayerMatch}>HOST REMATCH ↻</button>
						{:else if lobbyRole === 'guest'}
							<p>Waiting for the host to launch a rematch…</p>
						{:else}
							<button class="btn primary" onclick={() => startArena()}>PLAY AGAIN ↻</button>
						{/if}
						{#if lobbyRole}<button class="btn ghost" onclick={leaveRoom}>LEAVE ROOM</button
							>{:else}<button class="btn ghost" onclick={exitToTitle}>MAIN MENU</button>{/if}
					</div>
				</div>
			</div>
		{/if}

		{#if useTouchControls && isRunning && !isDead}
			<div class="mobile-controls" role="group" aria-label="Touch game controls">
				{#if mode === 'arena' || tutorialStep === 3}
					<div class="mobile-conversion" aria-label="Chain reward">
						<button
							class:active={mobileConversion === 'score'}
							aria-pressed={mobileConversion === 'score'}
							onclick={() => (mobileConversion = 'score')}>BANK SCORE</button
						><button
							class:active={mobileConversion === 'power'}
							aria-pressed={mobileConversion === 'power'}
							onclick={() => (mobileConversion = 'power')}>FORGE POWER</button
						>
					</div>
				{/if}
				<div class="mobile-actions">
					{#if mode === 'arena' || tutorialStep === 4}
						<button
							class="aim-control"
							class:active={mobileAimArmed}
							aria-pressed={mobileAimArmed}
							onclick={toggleMobileAim}>{mobileAimArmed ? 'CANCEL AIM' : 'AIM + FIRE'}</button
						>
					{/if}
					{#if mode === 'arena' || tutorialStep === 5}
						<button class="parry-control" onclick={() => dispatch({ type: 'parry' })}>PARRY</button>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</main>

<style>
	.game {
		position: fixed;
		inset: 0;
		overflow: hidden;
		color: var(--ink);
		background: var(--bg);
		user-select: none;
		-webkit-user-select: none;
	}
	.stage {
		position: absolute;
		inset: 0;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
		image-rendering: pixelated;
		outline: none;
	}
	.player-hover canvas {
		cursor: grab;
	}
	.dragging canvas {
		cursor: grabbing;
	}
	.aiming canvas {
		cursor: none;
	}

	/* ---------- shared ---------- */
	.panel {
		background: var(--panel);
		border: 2px solid var(--line);
		border-radius: 6px;
		box-shadow:
			0 4px 0 rgba(0, 0, 0, 0.35),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.label {
		color: var(--muted);
		font: 600 11px/1 var(--font-pixel);
		letter-spacing: 0.08em;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.sprite {
		display: inline-block;
		flex: none;
		background-image: url('/assets/grindion-sprites.png');
		background-repeat: no-repeat;
		image-rendering: pixelated;
	}
	.meter {
		position: relative;
		display: block;
		height: 8px;
		overflow: hidden;
		background: rgba(4, 2, 10, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 2px;
	}
	.meter em {
		display: block;
		height: 100%;
		background: var(--mint);
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.25);
		transition: width 120ms ease-out;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 10px 16px;
		color: var(--ink);
		background: #2b2150;
		border: 2px solid #4a3a85;
		border-radius: 6px;
		box-shadow:
			inset 0 -4px 0 rgba(0, 0, 0, 0.3),
			0 3px 0 rgba(0, 0, 0, 0.35);
		font: 700 14px/1 var(--font-pixel);
		letter-spacing: 0.05em;
		cursor: pointer;
		transition:
			transform 80ms,
			background 120ms,
			border-color 120ms;
	}
	.btn:hover:not(:disabled) {
		background: #35296a;
		border-color: #6a55c0;
		transform: translateY(-1px);
	}
	.btn:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.3);
	}
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.btn.primary {
		color: #2a1600;
		background: var(--gold);
		border-color: #ffefa8;
		box-shadow:
			inset 0 -4px 0 #c78a1c,
			0 3px 0 rgba(0, 0, 0, 0.4),
			0 0 24px rgba(255, 210, 94, 0.25);
	}
	.btn.primary:hover:not(:disabled) {
		background: #ffdf7e;
		border-color: #fff6cf;
	}
	.btn.ghost {
		color: var(--muted);
		background: transparent;
		border-color: transparent;
		box-shadow: none;
	}
	.btn.ghost:hover:not(:disabled) {
		color: var(--ink);
		background: rgba(255, 255, 255, 0.06);
		border-color: transparent;
	}
	.btn.small {
		min-height: 36px;
		padding: 8px 12px;
		font-size: 12px;
	}
	.btn.wide {
		width: 100%;
	}
	.btn.icon {
		width: 40px;
		min-height: 40px;
		padding: 0;
		font-size: 18px;
	}
	kbd {
		display: inline-block;
		min-width: 1.6em;
		padding: 3px 5px 4px;
		color: var(--ink);
		background: #1b1434;
		border: 1px solid #4a3a85;
		border-bottom-width: 3px;
		border-radius: 4px;
		font: 600 11px/1 var(--font-pixel);
		text-align: center;
	}
	.btn kbd {
		color: inherit;
		background: rgba(0, 0, 0, 0.2);
		border-color: rgba(0, 0, 0, 0.25);
	}

	/* ---------- title ---------- */
	.title-screen {
		position: absolute;
		inset: 0;
		z-index: 10;
		overflow-y: auto;
		background:
			radial-gradient(ellipse at 50% 30%, rgba(7, 5, 15, 0.2), rgba(7, 5, 15, 0.82) 70%),
			linear-gradient(rgba(7, 5, 15, 0.35), rgba(7, 5, 15, 0.75));
	}
	.title-column {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 22px;
		width: min(980px, 100%);
		min-height: 100%;
		margin: 0 auto;
		padding: clamp(16px, 4vh, 48px) 16px 32px;
	}
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}
	.hero-art {
		display: block;
		width: min(760px, 100%);
		height: auto;
		aspect-ratio: 1600 / 533;
		border-radius: 10px;
		border: 2px solid rgba(170, 140, 255, 0.35);
		box-shadow:
			0 0 0 6px rgba(7, 5, 15, 0.6),
			0 18px 60px rgba(124, 77, 255, 0.35);
		image-rendering: pixelated;
		animation: rise 600ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.tagline {
		margin: 18px 0 0;
		color: var(--ink);
		font: 600 clamp(16px, 2.4vw, 22px) / 1.3 var(--font-pixel);
		text-align: center;
		text-shadow: 0 2px 0 #000;
	}
	.tagline em {
		color: var(--gold);
		font-style: normal;
	}
	.play-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: min(460px, 100%);
		padding: 18px;
		background: rgba(18, 12, 34, 0.9);
		animation: rise 600ms 80ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.callsign {
		display: grid;
		gap: 6px;
	}
	input {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 10px 12px;
		color: var(--gold);
		background: #0c0819;
		border: 2px solid #3a2d6a;
		border-radius: 6px;
		outline: none;
		font: 600 16px var(--font-pixel);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	input:focus {
		border-color: var(--violet);
		box-shadow: 0 0 0 3px rgba(141, 98, 255, 0.25);
	}
	input::placeholder {
		color: #5c4f85;
	}
	.join {
		min-height: 58px;
		font-size: 18px;
	}
	.join-note {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin: -2px 0 2px;
		color: var(--mint);
		font: 600 11px var(--font-pixel);
		letter-spacing: 0.08em;
	}
	.live-dot,
	.status-pill i,
	.lobby li i {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--mint);
		box-shadow: 0 0 8px var(--mint);
		animation: pulse 1.6s ease-in-out infinite;
	}
	.solo-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.private-rooms summary {
		color: var(--muted);
		font: 600 12px var(--font-pixel);
		letter-spacing: 0.08em;
		text-align: center;
		cursor: pointer;
		list-style-position: inside;
	}
	.private-rooms summary:hover {
		color: var(--ink);
	}
	.private-room-actions {
		display: grid;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.private-room-actions small {
		color: var(--coral);
		font: 600 10px/1.4 var(--font-pixel);
		letter-spacing: 0.05em;
		text-align: center;
	}
	.join-room {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
	}
	.join-room input {
		min-height: 36px;
		padding-block: 6px;
		font-size: 14px;
		letter-spacing: 0.15em;
	}
	.lobby {
		display: grid;
		gap: 10px;
		text-align: center;
	}
	.lobby-heading {
		display: grid;
		gap: 6px;
	}
	.lobby-heading strong {
		color: var(--gold);
		font: 700 32px var(--font-pixel);
		letter-spacing: 0.16em;
	}
	.lobby ul {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.lobby li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 4px;
		font: 600 14px var(--font-pixel);
		text-align: left;
	}
	.lobby li small {
		color: var(--energy);
		font-size: 11px;
	}
	.lobby p,
	.overlay-actions p {
		margin: 0;
		color: var(--muted);
		font-size: 14px;
	}
	.error {
		margin: 0;
		padding: 8px 10px;
		color: #ffb3ba;
		background: rgba(255, 77, 94, 0.12);
		border: 1px solid rgba(255, 77, 94, 0.4);
		border-radius: 4px;
		font-size: 13px;
	}
	.how-to-play {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
		animation: rise 600ms 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}
	.how-to-play li {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px;
	}
	.how-to-play strong {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
		color: var(--ink);
		font: 700 15px var(--font-pixel);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.how-to-play strong b {
		color: var(--gold);
	}
	.how-to-play span:not(.sprite) {
		color: var(--muted);
		font-size: 13px;
		line-height: 1.4;
	}

	/* ---------- HUD ---------- */
	.hud-top {
		position: absolute;
		z-index: 6;
		top: 0;
		left: 0;
		right: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		pointer-events: none;
		background: linear-gradient(rgba(7, 5, 15, 0.75), transparent);
	}
	.hud-top > * {
		pointer-events: auto;
	}
	.hud-left,
	.hud-right {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.hud-right {
		grid-column: 3;
		justify-content: flex-end;
	}
	.wordmark {
		color: var(--gold);
		font: 700 20px var(--font-pixel);
		letter-spacing: 0.06em;
		text-shadow:
			0 2px 0 #7a3b12,
			0 3px 0 #000;
	}
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		color: var(--muted);
		background: rgba(18, 12, 34, 0.7);
		border: 1px solid var(--line);
		border-radius: 999px;
		font: 600 11px var(--font-pixel);
		letter-spacing: 0.08em;
		white-space: nowrap;
	}
	.status-pill.offline i {
		background: var(--muted);
		box-shadow: none;
		animation: none;
	}
	.status-pill.training i {
		background: var(--energy);
		box-shadow: 0 0 8px var(--energy);
	}
	.round-clock {
		grid-column: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4px 18px 6px;
		background: rgba(18, 12, 34, 0.85);
		border: 2px solid var(--line);
		border-radius: 6px;
	}
	.round-clock span {
		color: var(--muted);
		font: 600 10px var(--font-pixel);
		letter-spacing: 0.15em;
	}
	.round-clock strong {
		font: 700 28px/1 var(--font-pixel);
		font-variant-numeric: tabular-nums;
	}
	.round-clock.urgent strong {
		color: var(--danger);
		animation: pulse 1s steps(2) infinite;
	}
	.rank-chip {
		display: none;
		align-items: baseline;
		gap: 4px;
		min-height: 40px;
		padding: 6px 12px;
		color: var(--ink);
		background: rgba(18, 12, 34, 0.85);
		border: 2px solid var(--line);
		border-radius: 6px;
		font-family: var(--font-pixel);
		cursor: pointer;
	}
	.rank-chip strong {
		color: var(--gold);
		font-size: 20px;
	}
	.rank-chip small {
		color: var(--muted);
		font-size: 11px;
	}

	.leaderboard {
		position: absolute;
		z-index: 5;
		top: 84px;
		right: 16px;
		width: 236px;
		overflow: hidden;
	}
	.panel-heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--line);
	}
	.panel-heading span {
		color: var(--gold);
		font: 700 13px var(--font-pixel);
		letter-spacing: 0.08em;
	}
	.panel-heading small {
		color: var(--muted);
		font: 600 11px var(--font-pixel);
	}
	.leaders {
		padding: 4px;
	}
	.leader-row {
		display: grid;
		grid-template-columns: 18px 10px 1fr auto;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		padding: 0 8px;
		border-radius: 4px;
		font: 600 14px var(--font-pixel);
		transition: background 200ms;
	}
	.leader-row b {
		color: var(--muted);
		font-weight: 600;
		text-align: right;
	}
	.leader-row i,
	.standings i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--player-color);
		box-shadow: 0 0 6px var(--player-color);
	}
	.leader-row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.leader-row strong {
		color: var(--gold);
		font-variant-numeric: tabular-nums;
	}
	.leader-row.you {
		background: rgba(255, 227, 110, 0.14);
		box-shadow: inset 2px 0 0 var(--you);
	}
	.leader-row.down span {
		color: var(--muted);
		text-decoration: line-through;
	}
	.arena-social {
		display: grid;
		gap: 6px;
		padding: 10px;
		border-top: 1px solid var(--line);
	}
	.arena-social a {
		color: var(--energy);
		font: 600 12px var(--font-pixel);
		letter-spacing: 0.08em;
		text-align: center;
		text-decoration: none;
	}
	.arena-social a:hover {
		text-decoration: underline;
	}

	.player-hud {
		position: absolute;
		z-index: 5;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		display: grid;
		grid-template-columns: 200px auto 200px;
		align-items: stretch;
		background: rgba(18, 12, 34, 0.88);
	}
	.player-hud.tutorial-hud {
		grid-template-columns: repeat(3, auto);
	}
	.player-hud > div {
		display: grid;
		align-content: center;
		gap: 6px;
		padding: 10px 16px;
	}
	.player-hud > div + div {
		border-left: 1px solid var(--line);
	}
	.heart-hud {
		grid-template-columns: 1fr auto;
	}
	.heart-hud .meter,
	.power-card .meter {
		grid-column: 1 / -1;
	}
	.heart-hud strong {
		font: 700 20px/1 var(--font-pixel);
		font-variant-numeric: tabular-nums;
	}
	.heart-hud strong small {
		color: var(--muted);
		font-size: 13px;
	}
	.heart-hud.low strong {
		color: var(--danger);
	}
	.heart-hud.low .meter em {
		background: var(--danger);
		animation: pulse 0.8s ease-in-out infinite;
	}
	.score-card {
		justify-items: center;
		min-width: 110px;
	}
	.score-card strong {
		color: var(--gold);
		font: 700 34px/1 var(--font-pixel);
		font-variant-numeric: tabular-nums;
		text-shadow: 0 2px 0 #7a3b12;
	}
	.score-card small {
		color: var(--energy);
		font: 600 10px var(--font-pixel);
		letter-spacing: 0.08em;
	}
	.power-card {
		grid-template-columns: 1fr auto;
	}
	.power-card strong {
		color: #6aa9b3;
		font: 700 20px/1 var(--font-pixel);
		font-variant-numeric: tabular-nums;
	}
	.power-card .meter em {
		background: #3d7f8a;
	}
	.power-card .meter b {
		position: absolute;
		top: -1px;
		bottom: -1px;
		width: 2px;
		background: rgba(255, 255, 255, 0.5);
	}
	.power-card.armed strong {
		color: var(--energy);
		text-shadow: 0 0 10px rgba(127, 243, 255, 0.6);
	}
	.power-card.armed .meter em {
		background: var(--energy);
		box-shadow: 0 0 10px var(--energy);
	}

	.callout,
	.chain-status {
		position: absolute;
		z-index: 5;
		left: 50%;
		bottom: 104px;
		transform: translateX(-50%);
		pointer-events: none;
	}
	.callout {
		padding: 9px 14px;
		color: var(--energy);
		background: rgba(18, 12, 34, 0.92);
		border: 2px solid var(--energy);
		border-radius: 6px;
		font: 700 14px var(--font-pixel);
		letter-spacing: 0.06em;
		white-space: nowrap;
		box-shadow: 0 0 20px rgba(127, 243, 255, 0.25);
	}
	.chain-status {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px 8px 12px;
		color: #2a1600;
		background: var(--parchment);
		border: 2px solid #fff;
		border-radius: 6px;
		box-shadow:
			inset 0 -4px 0 rgba(0, 0, 0, 0.12),
			0 4px 0 rgba(0, 0, 0, 0.4);
		animation: pop 160ms ease-out;
	}
	.chain-status.grindstone {
		background: linear-gradient(90deg, #ffd2cf, #fff3b0, #c9f7df, #c4f1f5, #e8d5f7);
	}
	.chain-status span {
		color: #c2353f;
		font: 700 32px/1 var(--font-pixel);
	}
	.chain-status div {
		display: grid;
		gap: 3px;
	}
	.chain-status strong {
		font: 700 15px/1 var(--font-pixel);
		letter-spacing: 0.04em;
	}
	.chain-status small {
		color: #6b5440;
		font: 600 11px/1 var(--font-pixel);
		letter-spacing: 0.04em;
	}

	.event-feed {
		position: absolute;
		z-index: 5;
		left: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		gap: 6px;
		pointer-events: none;
	}
	.feed-item {
		padding: 7px 12px;
		color: var(--ink);
		background: rgba(18, 12, 34, 0.85);
		border-left: 3px solid currentColor;
		border-radius: 0 4px 4px 0;
		font: 700 13px var(--font-pixel);
		letter-spacing: 0.05em;
		animation: slide-in 220ms ease-out;
	}
	.feed-item:nth-child(n + 3) {
		opacity: 0.55;
	}
	.tone-gold {
		color: var(--gold);
	}
	.tone-energy {
		color: var(--energy);
	}
	.tone-coral {
		color: var(--coral);
	}
	.tone-violet {
		color: #c4a8ff;
	}

	.hint-strip {
		padding: 10px 12px;
		background: rgba(18, 12, 34, 0.72);
		border-radius: 6px;
		position: absolute;
		z-index: 4;
		left: 16px;
		bottom: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		color: var(--muted);
		font: 600 12px var(--font-pixel);
		pointer-events: none;
	}
	.hint-strip kbd {
		min-width: 3.3em;
		margin-right: 6px;
	}

	.tutorial-card {
		position: absolute;
		z-index: 6;
		top: 72px;
		left: 50%;
		transform: translateX(-50%);
		display: grid;
		gap: 6px;
		width: min(560px, calc(100% - 32px));
		padding: 14px 18px 16px;
		background: rgba(18, 12, 34, 0.92);
		border-color: rgba(127, 243, 255, 0.35);
	}
	.lesson-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.lesson-meta .label {
		color: var(--energy);
	}
	.lesson-dots {
		display: flex;
		gap: 4px;
	}
	.lesson-dots i {
		width: 20px;
		height: 5px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.12);
	}
	.lesson-dots i.done {
		background: var(--mint);
	}
	.lesson-dots i.current {
		background: var(--energy);
		box-shadow: 0 0 8px var(--energy);
	}
	.tutorial-card h2 {
		margin: 2px 0 0;
		color: var(--gold);
		font: 700 24px/1.1 var(--font-pixel);
		text-transform: uppercase;
	}
	.tutorial-card p {
		margin: 0;
		color: var(--ink);
		font-size: 15px;
		line-height: 1.45;
	}
	.tutorial-card .btn {
		justify-self: start;
		margin-top: 4px;
	}

	/* ---------- help sheet ---------- */
	.sheet-backdrop {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: rgba(7, 5, 15, 0.6);
	}
	.help-sheet {
		position: absolute;
		z-index: 21;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(980px, calc(100% - 32px));
		max-height: calc(100% - 32px);
		overflow-y: auto;
		padding: 18px 20px;
		background: rgba(18, 12, 34, 0.97);
		animation: pop 160ms ease-out;
	}
	.sheet-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.sheet-heading h2 {
		margin: 0;
		color: var(--gold);
		font: 700 26px var(--font-pixel);
	}
	.help-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
		gap: 20px;
		margin-top: 12px;
	}
	.help-grid h3 {
		margin: 0 0 10px;
		color: var(--energy);
		font: 700 14px var(--font-pixel);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.rules {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rules li {
		display: flex;
		gap: 10px;
	}
	.rules strong {
		display: block;
		font: 700 14px var(--font-pixel);
	}
	.rules span:not(.sprite) {
		color: var(--muted);
		font-size: 13px;
		line-height: 1.4;
	}
	.binds {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px 12px;
		align-items: center;
		margin: 0;
		font-size: 13px;
	}
	.binds dt {
		font: 600 13px var(--font-pixel);
		white-space: nowrap;
	}
	.binds dd {
		margin: 0;
		color: var(--muted);
	}
	.numpad {
		display: grid;
		grid-template-columns: repeat(3, 34px);
		gap: 4px;
		margin-bottom: 12px;
	}
	.numpad kbd {
		padding: 8px 0;
		font-size: 14px;
	}
	.numpad kbd.bank {
		color: #2a1600;
		background: var(--gold);
		border-color: #c78a1c;
	}
	.risk-note {
		margin: 18px 0 0;
		padding: 10px 12px;
		color: var(--muted);
		background: rgba(255, 77, 94, 0.08);
		border-left: 3px solid var(--coral);
		border-radius: 0 4px 4px 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.risk-note strong {
		color: var(--coral);
	}

	/* ---------- overlays ---------- */
	.overlay {
		position: absolute;
		z-index: 15;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 16px;
		overflow-y: auto;
		background: rgba(7, 5, 15, 0.72);
		backdrop-filter: blur(4px) saturate(0.6);
		-webkit-backdrop-filter: blur(4px) saturate(0.6);
		animation: fade 220ms ease-out;
	}
	.overlay.respawn {
		background:
			radial-gradient(circle at 50% 45%, rgba(255, 77, 94, 0.18), transparent 50%),
			rgba(7, 5, 15, 0.78);
	}
	.overlay-card {
		width: min(460px, 100%);
		padding: 26px 24px 22px;
		text-align: center;
		background: rgba(18, 12, 34, 0.96);
		animation: pop 220ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
	}
	.overlay-card.wide {
		width: min(560px, 100%);
	}
	.respawn .overlay-card {
		border-color: rgba(255, 77, 94, 0.5);
		border-top: 4px solid var(--danger);
	}
	.eyebrow {
		color: var(--energy);
		font: 600 12px var(--font-pixel);
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.eyebrow.danger {
		color: var(--coral);
	}
	.overlay-card h2 {
		margin: 6px 0 18px;
		color: var(--parchment);
		font: 700 clamp(30px, 6vw, 44px) / 1 var(--font-pixel);
		text-shadow:
			0 3px 0 #7a1f2e,
			0 5px 0 #000;
	}
	.results .overlay-card h2 {
		color: var(--gold);
		text-shadow:
			0 3px 0 #7a3b12,
			0 5px 0 #000;
	}
	.stat-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-bottom: 18px;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.stat-row div {
		min-width: 0;
		padding: 10px 6px;
	}
	.stat-row div + div {
		border-left: 1px solid var(--line);
	}
	.stat-row span,
	.respawn-status span {
		display: block;
		color: var(--muted);
		font: 600 10px var(--font-pixel);
		letter-spacing: 0.08em;
	}
	.stat-row strong {
		display: block;
		margin-top: 6px;
		font: 700 20px var(--font-pixel);
	}
	.danger {
		color: var(--danger);
	}
	.gold {
		color: var(--gold);
	}
	.energy {
		color: var(--energy);
	}
	.stat-row strong.energy {
		font-size: 15px;
	}
	.respawn-status > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		text-align: left;
	}
	.respawn-status strong {
		color: var(--parchment);
		font: 700 28px var(--font-pixel);
	}
	.respawn-status .meter {
		height: 12px;
	}
	.respawn-status .meter em {
		background: repeating-linear-gradient(90deg, var(--energy) 0 14px, #3cb4c1 14px 18px);
		transition: width 50ms linear;
	}
	.overlay-card p {
		margin: 14px 0 0;
		color: var(--muted);
		font-size: 14px;
	}
	.placement {
		margin: -8px 0 14px !important;
		font: 600 16px var(--font-pixel) !important;
	}
	.placement strong {
		color: var(--gold);
	}
	.standings {
		width: 100%;
		border-collapse: collapse;
		font: 600 14px var(--font-pixel);
		font-variant-numeric: tabular-nums;
	}
	.standings th {
		padding: 6px 8px;
		color: var(--muted);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-align: right;
		border-bottom: 1px solid var(--line);
	}
	.standings td {
		padding: 6px 8px;
		text-align: right;
	}
	.standings th:nth-child(2),
	.standings td:nth-child(2) {
		text-align: left;
	}
	.standings td:nth-child(2) i {
		margin-right: 8px;
	}
	.standings td:first-child {
		color: var(--muted);
	}
	.standings td:nth-child(3) {
		color: var(--gold);
	}
	.standings tr.you td {
		background: rgba(255, 227, 110, 0.12);
	}
	.overlay-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 10px;
		margin-top: 18px;
	}

	/* ---------- touch ---------- */
	.mobile-controls {
		position: absolute;
		z-index: 8;
		left: 0;
		right: 0;
		bottom: 0;
		display: grid;
		gap: 8px;
		padding: 24px 10px max(10px, env(safe-area-inset-bottom));
		background: linear-gradient(transparent, rgba(7, 5, 15, 0.92) 35%);
	}
	.mobile-conversion {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 3px;
		background: rgba(18, 12, 34, 0.9);
		border: 2px solid var(--line);
		border-radius: 8px;
	}
	.mobile-actions {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 8px;
	}
	.mobile-controls button {
		min-width: 0;
		min-height: 44px;
		padding: 8px 6px;
		color: var(--muted);
		background: transparent;
		border: 0;
		border-radius: 6px;
		font: 700 14px var(--font-pixel);
		letter-spacing: 0.05em;
		touch-action: manipulation;
	}
	.mobile-conversion button.active {
		color: #2a1600;
		background: var(--gold);
		box-shadow: inset 0 -3px 0 #c78a1c;
	}
	.mobile-conversion button:last-child.active {
		background: var(--energy);
		box-shadow: inset 0 -3px 0 #2a9aa8;
	}
	.mobile-actions button {
		min-height: 56px;
		color: var(--ink);
		background: #2b2150;
		border: 2px solid #4a3a85;
		box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.3);
		font-size: 16px;
	}
	.mobile-actions button:active {
		transform: translateY(2px);
	}
	.mobile-actions .aim-control.active {
		color: #062026;
		background: var(--energy);
		border-color: #fff;
	}
	.mobile-actions .parry-control {
		color: #2a1600;
		background: var(--gold);
		border-color: #ffefa8;
		box-shadow: inset 0 -4px 0 #c78a1c;
	}

	/* ---------- responsive ---------- */
	@media (max-width: 1100px) {
		.hint-strip {
			display: none;
		}
	}
	@media (max-width: 860px) {
		.how-to-play {
			grid-template-columns: 1fr 1fr;
		}
		.wordmark {
			display: none;
		}
		.player-hud {
			grid-template-columns: 150px auto 150px;
		}
	}
	.touch .hud-top {
		padding: 8px 10px;
		gap: 8px;
	}
	.touch .status-pill {
		display: none;
	}
	.touch .round-clock {
		padding: 2px 12px 4px;
	}
	.touch .round-clock strong {
		font-size: 22px;
	}
	.touch .solo-row kbd {
		display: none;
	}
	.touch .rank-chip {
		display: inline-flex;
	}
	.touch .leaderboard {
		top: 64px;
		right: 10px;
		display: none;
	}
	.touch .leaderboard.open {
		display: block;
		z-index: 9;
	}
	.touch .player-hud {
		top: 60px;
		bottom: auto;
		width: calc(100% - 20px);
		grid-template-columns: 1fr auto 1fr;
	}
	.touch .player-hud.tutorial-hud {
		width: auto;
		grid-template-columns: repeat(3, auto);
	}
	.touch .player-hud > div {
		padding: 8px 10px;
	}
	.touch .score-card {
		min-width: 70px;
	}
	.touch .score-card strong {
		font-size: 26px;
	}
	.touch .heart-hud strong,
	.touch .power-card strong {
		font-size: 17px;
	}
	.touch .heart-hud strong small {
		display: none;
	}
	.touch .event-feed {
		top: auto;
		bottom: 150px;
		left: 10px;
		transform: none;
	}
	.touch .feed-item {
		font-size: 11px;
	}
	.touch .callout,
	.touch .chain-status {
		bottom: 150px;
	}
	.touch .tutorial-card {
		top: 60px;
		width: calc(100% - 20px);
		padding: 10px 12px 12px;
	}
	.touch .player-hud.tutorial-hud {
		top: auto;
		bottom: 214px;
	}
	.touch .tutorial-card h2 {
		font-size: 19px;
	}
	.touch .tutorial-card p {
		font-size: 13px;
	}
	.touch .chain-status span {
		font-size: 26px;
	}
	@media (max-width: 520px) {
		.title-column {
			gap: 16px;
		}
		.how-to-play {
			grid-template-columns: 1fr;
		}
		.play-card {
			padding: 14px;
		}
		.stat-row strong {
			font-size: 17px;
		}
		.standings {
			font-size: 13px;
		}
		.standings th:nth-child(5),
		.standings td:nth-child(5) {
			display: none;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			scale: 0.94;
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateX(-12px);
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
