// The renderer's copy of the board, plus UI-only state. Every change goes to
// the main process first (which owns tasks.json) and the task it returns
// replaces the local one, so the two never drift.
const api = window.clearday;

export const state = {
  tasks: new Map(),       // id → Task (live tasks only)
  sort: 'default',
  selectedId: null,
  editingId: null,
  openNotes: new Set(),   // ids whose notes panel is open
  compact: false,
  side: 'todo',           // side tab showing: 'todo' | 'ongoing'
  spellcheck: true,       // spelling in notes (Preferences)
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
export function changed(opts = {}) { for (const fn of listeners) fn(opts); }

export async function load() {
  const tasks = await api.tasks.list();
  state.tasks = new Map(tasks.map((t) => [t.id, t]));
}

export async function createTask(fields) {
  const t = await api.tasks.create(fields);
  state.tasks.set(t.id, t);
  return t;
}

export async function updateTask(id, patch) {
  const t = await api.tasks.update(id, patch);
  if (t && !t.deletedAt) state.tasks.set(t.id, t);
  return t;
}

export async function removeTask(id) {
  const t = await api.tasks.remove(id);
  state.tasks.delete(id);
  state.openNotes.delete(id);
  if (state.selectedId === id) state.selectedId = null;
  return t;
}

export async function restoreTask(id) {
  const t = await api.tasks.restore(id);
  if (t) state.tasks.set(t.id, t);
  return t;
}
