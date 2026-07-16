# Grindion

Playable vertical slice of a competitive `.io` puzzle-combat game. Build
same-color monster chains, convert them into Score or Power, and spend all of
your Power on one dodgeable, parryable shot.

See [GAME_DESIGN.md](./GAME_DESIGN.md) for the complete rules and architecture.

## Run the prototype

```bash
npm install
npm run dev
```

The local prototype contains a fixed-seed six-step tutorial plus a live arena
with one human player and seven bots. Supabase is not required to play it.

The game uses a close player-following camera. Holding aim zooms out to reveal
more of the arena; releasing fires the player's entire Power reserve.

### Controls

| Input                                        | Action                                  |
| -------------------------------------------- | --------------------------------------- |
| WASD / arrows                                | Move                                    |
| Left-drag through matching adjacent monsters | Build a chain                           |
| Release                                      | Bank the chain as Score                 |
| Shift + release                              | Convert the chain to Power              |
| Hold right mouse                             | Aim and zoom out                        |
| Release right mouse                          | Fire all stored Power toward the cursor |
| Space                                        | Parry                                   |
| Escape                                       | Cancel the active chain                 |

The original pixel-art sprite sheet is in
[`static/assets/grindion-sprites.png`](./static/assets/grindion-sprites.png),
with the generated source sheet retained beside it for future art iteration.

## Verification

```bash
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
npm run build
```

## Architecture

Game rules live in `src/lib/game` as a deterministic, fixed-step TypeScript
simulation. The Svelte page renders snapshots and sends the same intent objects
that a future network client will send to an authoritative match worker.

### Supabase

Supabase is deliberately limited to low-frequency durable data:

- player profiles
- match lifecycle metadata and membership
- final match results

Movement, monster claims, chains, projectiles, parries, damage, and other
high-frequency simulation must be handled by an authoritative game server.
Postgres and Presence are not the authoritative per-frame simulation. A future
match worker should validate intents and broadcast snapshots/events through a
private Realtime channel.

The app remains functional when Supabase is not configured. To enable its
browser client, copy `.env.example` to `.env` and provide the browser-safe
project URL and publishable key. Never expose a secret/service-role key through
`PUBLIC_*`.

For local development (Docker required):

```sh
npx supabase start
npx supabase db reset
npx supabase status
```

Use the API URL and publishable/anon key reported by `supabase status` in
`.env`. The browser client is available from
`src/lib/supabase/client.ts`; it returns `null` when those values are absent.

Database migrations live in `supabase/migrations`. Create future migrations
with `npx supabase migration new <descriptive_name>` before editing the generated
file. Client-facing writes are protected by RLS. Final results have no client
write policy and are intended to be recorded by the future authoritative game
service.
