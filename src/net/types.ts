// What online play is made of. One player's game is the host: it runs the match exactly as single-player does
// (game/match.js) and tells everyone else what happens; the others are guests, who send their controls and draw
// what the host tells them. Every player is linked to every other one, so if the host leaves, the next player in
// line takes over (migrate.ts) and the match goes on.
//
// - transport: how messages travel (peer.ts over WebRTC; local.ts between tabs, for tests and offline play). A
//   server could be one more transport: host.ts only needs a Transport, the match and the roster.
// - protocol.ts: the compact binary messages sent many times a second (controls, snapshots).
// - session.ts: who's in the room, the lobby, and which role this player has.
// - host.ts, guest.ts, migrate.ts: the two roles, and the handover between them.
import type { GameEvent } from '../engine/events';
import type { ResultsView } from '../game/results';

/** What travels: a JSON string (reliable messages) or bytes (protocol.ts). */
export type Wire = string | ArrayBuffer;

/** Links to other players, each with a reliable channel and a fast one that may arrive out of order. */
export interface Transport {
  /** This player's address; others link to it. */
  readonly id: string;
  /** Link to another player (resolves once both channels are open; rejects if it can't be reached). */
  connect(id: string): Promise<void>;
  send(to: string, data: Wire, reliable: boolean): void;
  /** Addresses linked right now. */
  links(): string[];
  /** Drop one link, or every link and the address itself. */
  drop(id: string): void;
  close(): void;
  onmessage: (from: string, data: Wire) => void;
  /** A link opened (either side asked) or closed. */
  onopen: (id: string) => void;
  onclose: (id: string) => void;
}

/** Someone in the room, in lobby order: the order in which they'd take over as host. */
export interface Player { id: string; name: string; car: string; ready: boolean; desktop: boolean; ping: number }
/** What the host picks for everyone. */
export interface MatchOpts { mode: string; map: string; difficulty: number; tod: string; bots: 'fill' | 'off' }
/** One car in a match, in pid order: a person (`id` their address) or a bot. */
export interface Seat { car: string; human: boolean; name: string; id?: string }

/** Reliable messages. */
export type Msg =
  | { t: 'hello'; name: string; car: string; desktop: boolean; v: number }
  | { t: 'busy'; why: string }
  | { t: 'moved'; to: string }
  | { t: 'lobby'; code: string; host: string; players: Player[]; opts: MatchOpts }
  | { t: 'me'; name?: string; car?: string; ready?: boolean }
  | { t: 'start'; seats: Seat[]; opts: MatchOpts }
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'over'; r: ResultsView }
  | { t: 'lobbyback' }
  | { t: 'ck'; d: string }
  | { t: 'hb'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'migrated'; host: string }
  | { t: 'bye' };

/** Version of the messages: players on different versions of the game can't play together. */
export const PROTOCOL = 1;
