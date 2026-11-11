# Grindion — Game Design and Technical Architecture

Status: pre-production concept  
Last updated: 2026-11-08

## 1. High concept

Grindion is a competitive puzzle-combat game on a shared monster board.
Every completed chain moves the player, scores one point per monster, and
charges Power. Power has no cap, so players can bank several shots. Each shot
costs a fixed amount of Power and can be dodged or parried.

The central decisions are how far to extend a chain, when to shoot, and when
to cancel a route to defend.

## 2. Design pillars

### Simple actions, interacting deeply

The player primarily chains, shoots, and parries. Strategic depth should come
from how those actions interact, not from a large move list.

### Greed creates vulnerability

Longer chains are more valuable but take longer to complete and make the
player's route easier to predict. A chain has no value until it is committed.

### Leaders are powerful, not invincible

Score increases maximum health logarithmically. Every player earns the same
Power from an equivalent chain, every shot deals the same damage, and anyone
can nullify an attack with a correctly timed parry.

### Every attack is a commitment

Each shot costs Power that took a chain to earn. A missed, dodged, or parried
shot spends that work for nothing.

### Readability over simulation complexity

Projectile speed, parry timing, chain state, health, and stored Power must be
visually legible. Combat outcomes should be understandable without knowing the
underlying formulas.

## 3. Match structure

The target format is a session-based `.io` arena:

- Multiple players share one large monster field.
- Monsters continuously replenish to prevent the board from being exhausted.
- Players score points and climb a live leaderboard; the top score wins.
- Death causes a partial setback followed by a quick respawn.
- Sessions should be short enough to encourage replay and long enough for a
  leader to emerge.

Initial tuning targets, not final commitments:

- 8–12 players or bots in the first playable prototype
- 5-minute prototype rounds
- 20–40 players and 8–10 minute rounds as a later target

Before the live arena, a fixed-seed tutorial teaches chain-based traversal,
Power charging, scoring, aiming/firing, and parrying in a controlled
training room. Its progression is driven by actual simulation events rather
than timers.

## 4. Player state

Each player has:

- `score`: points earned within the current match
- `health`: current survivability
- `maxHealth`: derived logarithmically from score
- `reach`: legacy snapshot field; does not limit chain paths
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
current cell, then may continue through orthogonal or diagonal neighbors without
a distance cap from the starting cell. A
committed chain is the player's only source of movement: the avatar traverses
the chosen route and ends on its final cell. Aiming and projectile motion remain
continuous and are not snapped to the grid.

Committed traversal uses an accelerating smash cadence. The first few monsters
have a pronounced impact pause; each later beat becomes shorter until reaching
a readable minimum delay. Long chains should feel increasingly explosive while
their individual hits remain countable.

### Building a chain

- A chain begins on a monster directly adjacent to the player's current cell.
- Each added monster must satisfy the connection rules, initially expected to
  mean adjacency and matching color.
- Routes have no distance cap from the starting cell.
- Dragging back onto any earlier monster truncates the provisional route there,
  allowing the player to reconsider and continue in a different direction.
- A chain is provisional until committed.
- A player may cancel a chain at any time and receive no score or Power.
- Cancelling returns all provisional monsters to normal board availability.

### Rainbow Grindstone switch

The Grindstone is a route state rather than a physical board item:

- Five consecutive monsters of the active color unlock one rainbow switch.
- The player and chain endpoint glow rainbow while the switch is ready.
- The next adjacent monster may be a different color and consumes the switch.
- That monster becomes the first entry in the new color streak.
- Continuing the current color preserves readiness; switches do not stack.
- Adjacency, shared-board conflict, and commitment rules still apply.
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

## 6. Chain rewards

Every valid chain consumes its monsters, moves the player to its endpoint,
and gives 1 point and 5 Power per monster. A chain requires at least three
monsters. There is one commit action for all chains, and Power has no cap.
Cancelled or invalid routes grant no rewards.

Examples: three monsters grant 3 points and 15 Power. Ten grant 10 points and
50 Power. The rainbow Grindstone switch changes which routes are possible but
grants no bonus.

## 7. Score and growth

```text
score += chain length
power += 5 * chain length
maxHealth = 100 + 35 * ln(1 + score / 100)
```

Score also restores 0.35 health per point, up to maximum health. Long chains
restore a share of maximum health on top of that: 5% at six monsters, plus 5%
for each further monster, capped at 50% from fifteen monsters. The legacy
`reach` snapshot field retains its existing formula, but routes have no
distance cap. Death removes 20% of score. Knocking out a rival grants the
killer 10 points. A new round resets score. The
player with the highest score at round end wins.

### Character evolution

The hero's sprite follows its current score for every player, including bots.
The four forms share the masked face, yellow eyes, blue hair, and red scarf:

| Score   | Form        | Appearance                                                |
| ------- | ----------- | --------------------------------------------------------- |
| 0–49    | Wanderer    | Tunic, belt, and short scarf                              |
| 50–149  | Chainrunner | Long twin-tail scarf, chain bandolier, and steel bracers  |
| 150–299 | Grindknight | Broad pauldrons, grindstone chest emblem, and knee guards |
| 300+    | Grindion    | Full armor, stone wheel, and crimson cape                 |

Evolving into a higher form fully restores health, whether the score came from
a chain or a knockout. Regaining a form after losing it on death counts. The
score card shows the current form and the score
needed for the next one. Losing score can lower the form, so the appearance
always matches the current score. Forms are derived from the authoritative
score and shared thresholds in `src/lib/game/heroForms.ts`.

## 8. Shooting

- A player aims in a direction and fires immediately.
- Firing costs 15 Power and requires at least that much stored; there is no
  charge-to-fire timer. Leftover Power stays banked.
- Every projectile deals 20 damage.
- Projectile speed is fixed or nearly fixed so dodging and parry timing remain
  learnable.
- Projectiles visibly travel through the arena rather than resolving instantly.
- Shots have a finite lifetime or maximum range.
- Firing several shots in a row drains the bank, so a player who unloads
  everything cannot parry until they rebuild at least the minimum defensive
  Power.

Travel time makes prediction important. Players can lead a moving target or
fire along the visible route of someone building a long chain.

### Chain finishers

With at least 15 Power stored before committing, a player can end a chain of
three or more monsters on an opponent adjacent to the final monster. The
attacker stops on the final monster. Opponents are terminal targets and never
become ordinary chain nodes or occupied destinations.

A finisher costs 15 Power. Its monsters still earn score and Power as usual.
The strike deals 20 damage and lands
after the route's traversal duration plus 600 ms. It marks the victim's current
cell and does not follow them. Leaving the cell makes it miss. A timed parry
blocks it and staggers the attacker for 400 ms.

The attacker cannot chain, fire, or parry during windup. Taking damage interrupts
the strike. Dead and spawn-protected players cannot be targeted, and protection
is checked again at impact. A victim can have only one pending finisher. If a
selected target becomes invalid before commit, the route commits normally and
charges Power instead. Round end cancels pending finishers.

Mouse and touch players drag onto an adjacent opponent, then release. Keyboard
players select the opponent's direction and press 5 or Enter. Another direction
clears the player target; extending or backtracking through monsters also clears
it. A dashed red line shows selection. A red cell marker and progress bar show
pending strikes, turning cyan during the parry window. The victim receives a
warning to parry or chain away.

## 9. Parrying and defense

Parrying is timing-based, not a comparison between the defender's Power and the
projectile's Power.

- Parry requires a small minimum amount of stored Power.
- A correctly timed parry completely nullifies one incoming projectile.
- The projectile is not reflected in the MVP.
- A parry consumes a small, fixed amount of Power rather than the entire meter.
- A failed parry creates a short recovery/cooldown window.
- Shot strength does not reduce the valid parry window.

This ensures that a new or low-scoring player can defend against a leader through
skill. It also makes firing risky: after a target nullifies the shot, the target
usually retains Power while the initiator has spent theirs.

### Chaining under fire

Chaining is intentionally vulnerable:

- A player cannot shoot or parry while actively chaining.
- The player may cancel the unfinished chain to remain in place and defend.
- Cancelling forfeits all uncommitted chain value.
- Being hit breaks the unfinished chain.

A shot can therefore succeed strategically even when it misses, because it may
force an opponent to abandon a valuable chain.

## 10. Health, damage, death, and respawn

- Maximum health increases logarithmically with score.
- An unparried projectile deals a fixed 20 damage.
- Scoring from a chain restores a small amount of health.
- At zero health, the player dies and quickly respawns.
- Death should remove only part of the player's score, preserving comeback
  potential without erasing the consequences of failure.
- A short spawn-protection window should prevent immediate repeat kills. It ends
  when the player attacks or begins a chain.

Damage, healing, score loss, respawn time, and spawn protection
remain tunable through the shared game configuration.

## 11. Controls and interaction goals

The control scheme is not final, but the action budget should remain small:

- Drag through monsters to construct both a route and a chain
- Commit that route to move to its final cell
- Release the chain to score and charge Power
- Aim and fire one shot
- Parry
- Cancel the active chain

The game should not require a timed shot-charge mechanic. Holding the aim input
only changes the camera and targeting affordance; holding longer never increases
damage. Releasing aim fires one shot immediately.

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
- One point and 5 Power per chained monster, with no Power cap
- Logarithmic maximum-health growth
- Fixed-cost, fixed-damage traveling projectiles
- Dodge and timing-based nullifying parry
- Chain cancellation and interruption
- Cell-targeted, dodgeable and parryable chain finishers
- Damage, death, partial score loss, and respawn
- Live leaderboard
- Bots or a small multiplayer lobby for testing
- Fixed-seed guided tutorial
- Player-follow camera with temporary aim zoom-out
- Original pixel-art hero, monster, projectile, and parry sprites

### Explicitly excluded

- Power dash
- Physical collision combat beyond targeted chain finishers
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

Public arenas now run in a dedicated worker on `big-mac`. It advances the deterministic simulation at 20 Hz and sends WebSocket snapshots at 10 Hz. Joining replaces a bot with a fresh human, leaving returns the seat to bot control, and the eight-seat arena continues independently of browser lifetimes. Arena links support joining an existing round. Rounds restart automatically after three seconds; arenas without clients are retired after one minute.

The legacy private-room stack uses Supabase Realtime Presence for room rosters and Broadcast for intents, snapshots, and events. One browser hosts these private challenges only. Guests submit compact intents.

### Client responsibilities

- Render the board, players, chains, projectiles, and effects.
- Capture chain, fire, parry, and cancel intents.
- Predict local chain highlighting and committed-route traversal where safe.
- Interpolate remote players and server-owned projectiles.
- Display score, evolution progress, health, Power, leaderboard, and threat cues.
- Reconcile predicted state with authoritative server results.

### Server responsibilities

- Own the canonical match clock and simulation state.
- Derive player movement exclusively from validated chain commits.
- Validate chain adjacency, color, and monster availability.
- Resolve chain commits atomically and truncate conflicting provisional chains.
- Award score and Power using shared tuning formulas.
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
TargetChainPlayer(playerId | null)
CommitChain
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
- Chain ownership, hits, parries, score, Power, and health require server
  confirmation.
- The parry window may need latency compensation with a strict maximum rewind
  so high-latency players remain viable without enabling abuse.
- Bots should run through the same intent and validation paths as human players.

## 14. Prototype success criteria

The first playable is successful if it answers these questions:

1. Is creating a chain satisfying before combat is added?
2. Do long chains feel worth the exposure?
3. Can players understand who is dangerous and who has just fired?
4. Are traveling shots dodgeable and predictable without feeling slow?
5. Does cancelling a chain under fire feel tense rather than frustrating?
6. Does parrying make low-scoring players meaningfully competitive?
7. Does score-based health feel valuable without making leaders oppressive?
8. Does banking Power for several shots make fights too bursty?
9. Is there enough board space and monster replenishment for players to recover
   after firing or respawning?

## 15. Open design decisions

These should be resolved through the implementation plan or early prototypes:

- Engine/platform and networking stack
- Square-grid density and spacing
- Chain traversal timing, animation, and camera behavior
- Progression pacing and damage balance
- Chain scoring curve and combo bonuses
- Growth, healing, and damage constants
- Whether uncapped Power needs a cap or slow decay
- Parry cost, window, cooldown, and latency compensation
- Projectile range and interaction with arena geometry
- Death score penalty and whether any value drops into the world
- Round length, player count, and victory condition
- Monster replenishment rules and anti-starvation behavior
- Bot behavior required for repeatable balance testing

## 16. Working one-sentence pitch

Drag through monsters to score and charge Power. Bank shots, fire, parry, and
keep chaining before rivals catch you.
