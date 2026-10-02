// The compact "last synced" line under the Home greeting.
// syncLine() is pure (state → text); mountSyncLine(el, store) keeps one element up to date without redrawing the tab.

export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const changes = (n) => `${n} change${n === 1 ? '' : 's'} waiting`;

// state: store.syncState() → { text, kind: 'ok'|'busy'|'warn'|'error', retry } or null when the line should be hidden.
export function syncLine(state, now = Date.now()) {
  if (!state) return null;
  const pending = Number(state.pending) || 0;
  switch (state.status) {
    case 'syncing': return { text: 'Syncing…', kind: 'busy', retry: false };
    case 'error': return { text: 'Sync problem — tap to retry', kind: 'error', retry: true };
    case 'offline': return { text: pending ? `Offline — ${changes(pending)}` : 'Offline', kind: 'warn', retry: false };
    case 'idle': {
      if (pending) return { text: `${changes(pending)}`, kind: 'warn', retry: false };
      const a = state.at ? ago(state.at, now) : '';
      return a ? { text: `Synced ${a} ✓`, kind: 'ok', retry: false } : null;
    }
    default: return null; // 'local' (no account) and 'signed-out'
  }
}

let unsub = null;
let timer = null;
function stop() { unsub?.(); unsub = null; clearInterval(timer); timer = null; }

export function mountSyncLine(el, store) {
  stop();
  const paint = () => {
    if (!el.isConnected) { stop(); return; }
    const l = syncLine(store.syncState());
    el.hidden = !l;
    el.className = `sync-line${l ? ` ${l.kind}` : ''}`;
    el.textContent = l ? l.text : '';
    el.disabled = !l?.retry;
    el.tabIndex = l?.retry ? 0 : -1;
  };
  el.onclick = () => { if (store.syncState().status === 'error') store.syncNow().catch(() => {}); };
  unsub = store.onChange(paint);
  timer = setInterval(paint, 60000);
  paint();
}
