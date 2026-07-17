# Grindion — Game Design and Technical Architecture

Status: pre-production concept  
Last updated: 2026-07-16

## 1. High concept

Grindion is a competitive `.io` puzzle-combat game played on one large,
continuously replenishing board. Players route through connected monsters to
build chains, then convert each completed chain into either permanent Score or
temporary combat Power.

Score makes a player gradually tougher and extends their reach. Power can be
spent on a single, all-in projectile. Projectiles travel through the arena and
can be dodged or nullified with a well-timed parry. Firing leaves the attacker
without enough Power to defend until they build another Power chain.

The central decisions are:

- How long can I safely extend this chain?
- Do I turn it into long-term growth or short-term combat Power?
- Is this shot worth leaving myself unable to parry?
- Should I finish my chain, or cancel it to defend against an incoming shot?

## 2. Design pillars

### Simple actions, interacting deeply

The player primarily chains, shoots, and parries. Strategic depth should come
from how those actions interact, not from a large move list.

### Greed creates vulnerability

Longer chains are more valuable but take longer to complete and make the
player's route easier to predict. A chain has no value until it is committed.

### Leaders are powerful, not invincible

Score increases reach and maximum health logarithmically, while also reducing
Power-generation efficiency. A smaller player cannot match a leader's board
control, but can recharge faster and can nullify any attack with a correctly
timed parry.

### Every attack is a commitment

Shooting consumes all stored Power. A missed, dodged, or parried shot creates a
clear counterattack window.

### Readability over simulation complexity

Projectile speed, parry timing, chain state, health, and stored Power must be
visually legible. Combat outcomes should be understandable without knowing the
underlying formulas.

## 3. Match structure

The target format is a session-based `.io` arena:

- Multiple players share one large monster field.
- Monsters continuously replenish to prevent the board from being exhausted.
- Players earn Score, climb a live leaderboard, and become harder to kill.
- Death causes a partial setback followed by a quick respawn.
- Sessions should be short enough to encourage replay and long enough for a
  leader to emerge.

Initial tuning targets, not final commitments:

- 8–12 players or bots in the first playable prototype
- 5-minute prototype rounds
- 20–40 players and 8–10 minute rounds as a later target

Before the live arena, a fixed-seed tutorial teaches chain-based traversal,
Score chaining, Power chaining, aiming/firing, and parrying in a controlled
training room. Its progression is driven by actual simulation events rather
than timers.

## 4. Player state

Each player has:

- `score`: persistent progression within the current match
- `health`: current survivability
- `maxHealth`: derived logarithmically from Score
- `reach`: maximum legal chain distance, derived logarithmically from Score
- `power`: stored combat resource
- `cellId`: the square-grid cell currently occupied by the player
- `chain`: the player's current uncommitted route, if any
- `mode`: neutral, chaining, aiming, parrying, hit, or dead

Power should be public information. Opponents must be able to recognize when a
player can attack or parry and when a recent attacker is defenseless.

## 5. Board and chaining

### Board

The arena places monsters and players on one shared, visually aligned square
grid. A chain must begin on one of the eight cells surrounding the player's
current cell, then may continue through orthogonal or diagonal neighbors. A
committed chain is the player's only source of movement: the avatar traverses
the chosen route and ends on its final cell. Aiming and projectile motion remain
continuous and are not snapped to the grid.

### Building a chain

- A chain begins on a monster directly adjacent to the player's current cell.
- Each added monster must satisfy the connection rules, initially expected to
  mean adjacency and matching color.
- The route cannot exceed the player's current Reach.
- A chain is provisional until committed.
- A player may cancel a chain at any time and receive no Score or Power.
- Cancelling returns all provisional monsters to normal board availability.

### Rainbow Grindstone switch

The Grindstone is a route state rather than a physical board item:

- Five consecutive monsters of the active color unlock one rainbow switch.
- The player and chain endpoint glow rainbow while the switch is ready.
- The next adjacent monster may be a different color and consumes the switch.
- That monster becomes the first entry in the new color streak.
- Continuing the current color preserves readiness; switches do not stack.
- Adjacency, Reach, shared-board conflict, and commitment rules still apply.
- Being hit cancels the unfinished chain and its rainbow opportunity.

This keeps the original game's color-pivot route planning without requiring a
shared pickup whose ownership would be difficult to read fairly in real time.

### Shared-board conflicts

Several players may provisionally route through the same monster. Ownership is
resolved authoritatively when a chain is committed:

- The first valid commit claims the overlapping monsters.
- A competing in-progress chain truncates at its first newly unavailable
  monster rather than necessarily failing in full.
- Network latency must not allow clients to decide ownership locally.

This rule should be playtested. Fully reserving monsters as soon as they enter a
chain is a fallback if provisional overlap proves visually confusing.

## 6. Converting a chain

A completed chain has two mutually exclusive outcomes.

### Bank for Score

- The chain's monsters are consumed.
- The player receives permanent match Score.
- Maximum health and Reach are recalculated.
- Banking restores a small amount of health, subject to playtesting.
- The chain grants no Power.

### Convert to Power

- The chain's monsters are consumed.
- The player gains stored Power instead of Score.
- Power gained is reduced as Score increases.
- Power does not decay in the MVP. A cap or slow overflow decay may be added
  only if hoarding creates stagnant play.

The input for selecting Score versus Power remains an interaction-design task.
A likely desktop scheme is normal release to bank and modifier + release to
convert to Power.

## 7. Growth and comeback model

Score has diminishing returns. Exact constants must be determined through
simulation and playtesting, but the intended family of formulas is:

```text
reach(score) = baseReach + reachScale * ln(1 + score / reachScoreScale)

maxHealth(score) = baseHealth + healthScale * ln(1 + score / scoreScale)

powerEfficiency(score) = 1 / (1 + handicapScale * ln(1 + score / scoreScale))

powerGained = chainPowerValue * powerEfficiency(score)
```

Consequences:

- A leader can access more routing options and survive more damage.
- Growth never grants proportionally unlimited Reach or health.
- Smaller players produce more Power from an equivalent chain.
- Timing-based parries remain effective regardless of attacker Score or shot
  strength.

Reach uses a smaller, independent score scale so its early gains are immediately
noticeable while its late-game result remains close to the original curve.
Health and Power efficiency retain their shared, slower growth scale. The Score
advantage must stay noticeable but modest to avoid runaway snowballing.

## 8. Shooting

- A player aims in a direction and fires immediately.
- Firing consumes all stored Power; there is no charge-to-fire timer.
- The projectile's damage is based on the Power spent.
- Projectile speed is fixed or nearly fixed so dodging and parry timing remain
  learnable.
- Projectiles visibly travel through the arena rather than resolving instantly.
- Shots have a finite lifetime or maximum range.
- After firing, the attacker has zero Power and cannot parry until they rebuild
  at least the minimum defensive Power.

Travel time makes prediction important. Players can lead a moving target or
fire along the visible route of someone building a long chain.

## 9. Parrying and defense

Parrying is timing-based, not a comparison between the defender's Power and the
projectile's Power.

- Parry requires a small minimum amount of stored Power.
- A correctly timed parry completely nullifies one incoming projectile.
- The projectile is not reflected in the MVP.
- A parry consumes a small, fixed amount of Power rather than the entire meter.
- A failed parry creates a short recovery/cooldown window.
- Shot strength does not reduce the valid parry window.

This ensures that a new or low-Score player can defend against a leader through
skill. It also makes firing risky: after a target nullifies the shot, the target
usually retains Power while the initiator has none.

### Chaining under fire

Chaining is intentionally vulnerable:

- A player cannot shoot or parry while actively chaining.
- The player may cancel the unfinished chain to remain in place and defend.
- Cancelling forfeits all uncommitted chain value.
- Being hit breaks the unfinished chain.

A shot can therefore succeed strategically even when it misses, because it may
force an opponent to abandon a valuable chain.

## 10. Health, damage, death, and respawn

- Maximum health increases logarithmically with Score.
- An unparried projectile damages health according to the Power spent on it.
- Banking a Score chain is the current preferred source of limited healing.
- At zero health, the player dies and quickly respawns.
- Death should remove only part of the player's Score, preserving comeback
  potential without erasing the consequences of failure.
- A short spawn-protection window should prevent immediate repeat kills. It ends
  when the player attacks or begins a chain.

Exact damage scaling, healing, Score loss, respawn time, and spawn protection
duration remain open tuning decisions.

## 11. Controls and interaction goals

The control scheme is not final, but the action budget should remain small:

- Drag through monsters to construct both a route and a chain
- Commit that route to move to its final cell
- Commit the chain as Score or Power
- Aim and fire all Power
- Parry
- Cancel the active chain

The game should not require a timed shot-charge mechanic. Holding the aim input
only changes the camera and targeting affordance; holding longer never increases
damage. Releasing aim fires all stored Power immediately.

Normal play uses a close player-follow camera that reveals only the local part
of the shared board. Holding aim smoothly zooms out by roughly 25–30% and may
add a small cursor-directed look-ahead. The HUD remains screen-space, while one
shared camera transform controls both rendering and pointer-to-world input. The
game does not switch into a separate first-person mode.

The visual direction is original chunky pixel art with colorful, readable
monster silhouettes, a cave-like portrait playfield, and substantial fantasy
HUD framing. Grindstone is a readability and presentation reference only; its
characters, assets, UI symbols, and layouts must not be copied.

Mobile and controller layouts must be considered before the control model is
locked, especially for quick switching between routing, aiming, and parrying.

## 12. MVP scope

### Included

- One shared arena
- Monster generation and replenishment
- Same-color connected chains
- Score/Power conversion choice
- Logarithmic Reach and maximum-health growth
- Decreasing Power efficiency as Score rises
- All-Power traveling projectiles
- Dodge and timing-based nullifying parry
- Chain cancellation and interruption
- Damage, death, partial Score loss, and respawn
- Live leaderboard
- Bots or a small multiplayer lobby for testing
- Fixed-seed guided tutorial
- Player-follow camera with temporary aim zoom-out
- Original pixel-art hero, monster, projectile, and parry sprites

### Explicitly excluded

- Power dash
- Physical collision combat
- Cutting another player's chain by dashing through it
- Projectile reflection or repeated counter-parries
- Multiple weapons or projectile types
- Character classes, loadouts, and equipment
- Power-ups and elaborate status effects
- Long-term metagame progression
- Ranked matchmaking

Dashing should only return if playtesting shows that chain-based traversal lacks
a necessary escape or engagement tool.

## 13. Technical architecture

No engine or networking stack has been selected. The architecture should remain
server-authoritative regardless of implementation technology.

### Client responsibilities

- Render the board, players, chains, projectiles, and effects.
- Capture chain, conversion, fire, parry, and cancel intents.
- Predict local chain highlighting and committed-route traversal where safe.
- Interpolate remote players and server-owned projectiles.
- Display Score, health, Power, chain value, leaderboard, and threat cues.
- Reconcile predicted state with authoritative server results.

### Server responsibilities

- Own the canonical match clock and simulation state.
- Derive player movement exclusively from validated chain commits and Reach.
- Validate chain adjacency, color, and monster availability.
- Resolve chain commits atomically and truncate conflicting provisional chains.
- Convert chains into Score or Power using shared tuning formulas.
- Simulate projectile travel and collision.
- Validate parry timing and apply nullification, damage, healing, and death.
- Replenish the board and manage spawn selection/protection.
- Maintain the leaderboard and match lifecycle.
- Reject impossible or out-of-order client actions.

### Shared deterministic rules

The client and server should share definitions for:

- Entity and message types
- Chain validation rules
- Growth and Power formulas
- Tuning constants
- Projectile parameters
- Player state-machine transitions
- Match configuration

Shared code improves prediction and UI feedback, but only the server result is
authoritative.

### Suggested logical modules

```text
client
  input
  rendering
  prediction
  hud
  audio

server
  match-session
  board-simulation
  chain-system
  combat-system
  player-system
  leaderboard
  bots

shared
  protocol
  entities
  rules
  formulas
  configuration
```

### Network intents

Clients should send compact intentions rather than arbitrary state updates:

```text
StartChain
ExtendChain(monsterId)
CommitChain(Score | Power)
CancelChain
Fire(direction)
BeginParry / EndParry
```

The server broadcasts snapshots plus discrete events such as chain committed,
chain truncated, projectile spawned, projectile parried, player damaged, player
died, and player respawned.

### Simulation and latency

- Begin with a fixed server simulation tick, likely 20–30 Hz.
- Snapshot frequency can be lower if clients interpolate movement smoothly.
- Provisional chain selection and committed-route traversal should feel immediate.
- Chain ownership, hits, parries, Score, Power, and health require server
  confirmation.
- The parry window may need latency compensation with a strict maximum rewind
  so high-latency players remain viable without enabling abuse.
- Bots should run through the same intent and validation paths as human players.

## 14. Prototype success criteria

The first playable is successful if it answers these questions:

1. Is creating a chain satisfying before combat is added?
2. Does choosing Score versus Power create genuine hesitation?
3. Can players understand who is dangerous and who has just fired?
4. Are traveling shots dodgeable and predictable without feeling slow?
5. Does cancelling a chain under fire feel tense rather than frustrating?
6. Does parrying make low-Score players meaningfully competitive?
7. Do logarithmic Reach and health rewards feel valuable without making leaders
   oppressive?
8. Does the all-in shot create a real counterattack window?
9. Is there enough board space and monster replenishment for players to recover
   after firing or respawning?

## 15. Open design decisions

These should be resolved through the implementation plan or early prototypes:

- Engine/platform and networking stack
- Square-grid density and spacing
- Chain traversal timing, animation, and camera behavior
- Exact Score-versus-Power commit controls
- Chain scoring curve and combo bonuses
- Growth, handicap, healing, and damage constants
- Power cap and whether overflow should slowly decay
- Parry cost, window, cooldown, and latency compensation
- Projectile range and interaction with arena geometry
- Death Score penalty and whether any value drops into the world
- Round length, player count, and victory condition
- Monster replenishment rules and anti-starvation behavior
- Bot behavior required for repeatable balance testing

## 16. Working one-sentence pitch

Build risky monster chains for growth or ammunition, then spend all your Power
on a single predictive shot—knowing your target can parry it and punish you while
you scramble to recharge.
