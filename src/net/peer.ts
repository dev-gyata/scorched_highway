// The internet transport: WebRTC data channels between browsers, introduced by PeerJS's free public broker (it
// only passes the handshakes; game traffic goes straight between players). Each pair of players has two channels:
// a reliable one (lobby, events) and an unordered one for the stream of controls and snapshots, so one late packet
// doesn't hold up the ones behind it.
//
// Some networks (strict mobile carriers, offices) can't connect two browsers directly. A TURN relay fixes that: set
// VITE_TURN_URL, VITE_TURN_USER and VITE_TURN_PASS when building (see README.md, "Multiplayer").
import { type DataConnection, Peer } from 'peerjs';
import type { Transport, Wire } from './types';

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const env = import.meta.env;
if (env.VITE_TURN_URL) ICE.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });

/** Why a connection failed, in words a player can act on. */
export function netError(e: unknown): string {
  const type = (e as { type?: string })?.type || (e as Error)?.message || '';
  if (type === 'peer-unavailable') return 'No game with that code. Check it and try again.';
  if (type === 'unavailable-id') return 'That room code is taken.';
  if (type === 'browser-incompatible') return 'This browser can’t play online.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') return 'Can’t reach the matchmaking server. Check your connection.';
  if (type === 'timeout') return 'Couldn’t connect. Some networks block direct connections between players.';
  return 'Couldn’t connect (' + (type || 'unknown error') + ').';
}

interface Link { r?: DataConnection; u?: DataConnection; up: boolean }

/** Register address `id` with the broker. */
export function peerTransport(id: string): Promise<Transport> {
  const peer = new Peer(id, { config: { iceServers: ICE }, debug: 0 });
  const links = new Map<string, Link>(), waiting = new Map<string, { ok: () => void; fail: (e: unknown) => void }>();
  let closing = false;
  const link = (to: string) => { let l = links.get(to); if (!l) { l = { up: false }; links.set(to, l); } return l; };
  const lost = (to: string) => {
    const l = links.get(to); if (!l) return;
    links.delete(to); l.r?.close(); l.u?.close();
    waiting.get(to)?.fail({ type: 'timeout' }); waiting.delete(to);
    if (l.up && !closing) t.onclose(to); // leaving: our own links dropping isn't news
  };
  /** Wire up one of a pair's two channels; the link is up once both are open. */
  const adopt = (c: DataConnection) => {
    const l = link(c.peer), had = c.label === 'u' ? l.u : l.r;
    if (had && had !== c) { c.close(); return; } // already linked to that address: a second caller using it isn't them
    if (c.label === 'u') l.u = c; else l.r = c;
    c.on('open', () => {
      if (l.up || !l.r?.open || !l.u?.open) return;
      l.up = true; t.onopen(c.peer); waiting.get(c.peer)?.ok(); waiting.delete(c.peer);
    });
    c.on('data', d => t.onmessage(c.peer, d as Wire));
    c.on('close', () => lost(c.peer));
    c.on('error', () => lost(c.peer));
  };
  peer.on('connection', adopt);
  const t: Transport = {
    id,
    connect(to) {
      if (links.get(to)?.up) return Promise.resolve();
      return new Promise((ok, fail) => {
        const timer = setTimeout(() => { if (waiting.has(to)) lost(to); fail({ type: 'timeout' }); }, 12000);
        waiting.set(to, { ok: () => { clearTimeout(timer); ok(); }, fail: e => { clearTimeout(timer); fail(e); } });
        adopt(peer.connect(to, { label: 'r', reliable: true, serialization: 'raw' }));
        adopt(peer.connect(to, { label: 'u', reliable: false, serialization: 'raw' }));
      });
    },
    send(to, d, reliable) {
      const l = links.get(to); if (!l?.up) return;
      const c = reliable ? l.r : l.u;
      try { c?.send(d); } catch { lost(to); }
    },
    links: () => [...links].filter(([, l]) => l.up).map(([to]) => to),
    drop: lost,
    close() { closing = true; for (const to of [...links.keys()]) lost(to); peer.destroy(); },
    onmessage: () => { }, onopen: () => { }, onclose: () => { },
  };
  return new Promise((ok, fail) => {
    peer.on('open', () => ok(t));
    peer.on('error', e => {
      // a link that can't be made fails its connect(); anything else before the address is ours fails the whole thing
      if (e.type === 'peer-unavailable') { for (const [to, w] of [...waiting]) if (e.message.includes(to)) { waiting.delete(to); w.fail(e); lost(to); } return; }
      if (!peer.open) { peer.destroy(); fail(e); }
    });
  });
}
