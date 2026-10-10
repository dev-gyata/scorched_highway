// A transport between tabs of one browser (BroadcastChannel): online play without the internet, for the tests
// and for development. Open the game with ?net=local in two tabs; add &lag=80 to delay every message by 80 ms each
// way and feel what a real connection does.
import type { Transport, Wire } from './types';

type Note =
  | { k: 'claim'; id: string; nonce: number }
  | { k: 'taken'; id: string; nonce: number }
  | { k: 'open' | 'ack' | 'close'; from: string; to: string }
  | { k: 'data'; from: string; to: string; d: Wire };

const CHANNEL = 'scorched-net';

/** Take address `id` among the open tabs; fails if another tab has it. */
export function localTransport(id: string, lag = 0): Promise<Transport> {
  const bc = new BroadcastChannel(CHANNEL), nonce = Math.random(), linked = new Set<string>();
  const waiting = new Map<string, () => void>();
  const post = (n: Note) => { if (lag) setTimeout(() => bc.postMessage(n), lag); else bc.postMessage(n); };
  let claimed = false, closed = false;
  const t: Transport = {
    id,
    connect(to) {
      if (linked.has(to)) return Promise.resolve();
      return new Promise((res, rej) => {
        const timer = setTimeout(() => { waiting.delete(to); rej(new Error('peer-unavailable')); }, 3000);
        waiting.set(to, () => { clearTimeout(timer); res(); });
        post({ k: 'open', from: id, to });
      });
    },
    send(to, d) { if (linked.has(to)) post({ k: 'data', from: id, to, d }); },
    links: () => [...linked],
    drop(to) { if (!linked.delete(to)) return; post({ k: 'close', from: id, to }); if (!closed) t.onclose(to); },
    close() {
      if (closed) return; closed = true; // leaving: tell the others, but don't report our own links dropping
      for (const to of [...linked]) t.drop(to);
      removeEventListener('beforeunload', bye); removeEventListener('pagehide', bye);
      setTimeout(() => bc.close(), lag + 50);
    },
    onmessage: () => { }, onopen: () => { }, onclose: () => { },
  };
  const bye = () => t.close();
  // Announce while the document is still live; pagehide alone can race Chromium's tab teardown.
  addEventListener('beforeunload', bye);
  addEventListener('pagehide', bye);
  bc.onmessage = ({ data: n }: MessageEvent<Note>) => {
    if (closed) return;
    if (n.k === 'claim') { if (n.id === id && n.nonce !== nonce && claimed) post({ k: 'taken', id, nonce: n.nonce }); return; }
    if (n.k === 'taken') { if (n.id === id && n.nonce === nonce) taken(); return; }
    if (n.to !== id) return;
    if (n.k === 'open') { linked.add(n.from); post({ k: 'ack', from: id, to: n.from }); t.onopen(n.from); }
    else if (n.k === 'ack') { if (!linked.has(n.from)) { linked.add(n.from); t.onopen(n.from); } waiting.get(n.from)?.(); waiting.delete(n.from); }
    else if (n.k === 'close') { if (linked.delete(n.from)) t.onclose(n.from); }
    else if (n.k === 'data' && linked.has(n.from)) t.onmessage(n.from, n.d);
  };
  let taken = () => { };
  return new Promise((res, rej) => {
    taken = () => { closed = true; bc.close(); rej(new Error('unavailable-id')); };
    post({ k: 'claim', id, nonce });
    setTimeout(() => { if (!closed) { claimed = true; res(t); } }, 150 + lag * 2);
  });
}
