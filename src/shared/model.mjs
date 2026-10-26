// The task model, shared by the main process (which owns the store) and the
// renderer (which applies the same changes optimistically). Pure functions
// only — no Electron, no DOM — so a future iPhone app can port it line for
// line, and sync only has to agree on this one shape.

export const SCHEMA_VERSION = 1;

export const STATUSES = ['todo', 'in_progress', 'on_hold', 'done'];
export const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Done',
};
// Main board sections, top to bottom. To Do has its own side panel.
export const BOARD_STATUSES = ['in_progress', 'on_hold', 'done'];

export const PRIORITIES = [null, 'medium', 'high'];
export const PRIORITY_LABELS = { null: 'None', medium: 'Medium', high: 'High' };
const PRIORITY_RANK = { high: 0, medium: 1, null: 2 };

export const SORTS = ['default', 'priority', 'created', 'manual'];
export const SORT_LABELS = {
  default: 'Default (by status)',
  priority: 'By priority',
  created: 'By creation time',
  manual: 'Manual (drag & drop)',
};

export const DEFAULT_NOTES_HEIGHT = 160;
// Deleted tasks are kept as tombstones so a future sync can tell "deleted on
// the Mac" from "never seen on the phone". Old ones are purged on load.
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const nowIso = (now = Date.now()) => new Date(now).toISOString();

export function uuid() {
  return globalThis.crypto.randomUUID();
}

// ─── Bold ranges ─────────────────────────────────────────────────────────────
// Task text is plain text plus a list of [start, end) character ranges that
// are bold. Kept sorted, non-overlapping and merged, so two equal-looking
// texts always have equal data.

export function normalizeRanges(ranges, length) {
  const clean = (Array.isArray(ranges) ? ranges : [])
    .filter((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]))
    .map(([a, b]) => [Math.max(0, Math.min(a, b, length)), Math.min(length, Math.max(a, b))])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of clean) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function isRangeBold(ranges, start, end) {
  if (end <= start) return false;
  return ranges.some(([a, b]) => a <= start && b >= end);
}

function subtract(ranges, start, end) {
  const out = [];
  for (const [a, b] of ranges) {
    if (b <= start || a >= end) { out.push([a, b]); continue; }
    if (a < start) out.push([a, start]);
    if (b > end) out.push([end, b]);
  }
  return out;
}

// The B button: bold the range, or un-bold it if it is already all bold.
export function toggleBold(ranges, start, end, length) {
  if (end <= start) return normalizeRanges(ranges, length);
  const next = isRangeBold(ranges, start, end)
    ? subtract(ranges, start, end)
    : [...ranges, [start, end]];
  return normalizeRanges(next, length);
}

// Text cut into runs of equal weight, for rendering.
export function segments(text, ranges) {
  const out = [];
  let pos = 0;
  for (const [a, b] of normalizeRanges(ranges, text.length)) {
    if (a > pos) out.push({ text: text.slice(pos, a), bold: false });
    out.push({ text: text.slice(a, b), bold: true });
    pos = b;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), bold: false });
  return out;
}

// The inverse: runs back into text + ranges (what an edited row serialises to).
export function fromSegments(runs) {
  let text = '';
  const bold = [];
  for (const r of runs) {
    if (r.bold && r.text) bold.push([text.length, text.length + r.text.length]);
    text += r.text;
  }
  return { text, bold: normalizeRanges(bold, text.length) };
}

// Trims the text and moves the ranges with it.
export function trimRich(text, bold) {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const shifted = bold.map(([a, b]) => [a - lead, b - lead]);
  return { text: trimmed, bold: normalizeRanges(shifted, trimmed.length) };
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export function createTask({ text = '', bold = [], status = 'todo', priority = null, order = 0 } = {}, now = Date.now()) {
  const t = String(text);
  const ts = nowIso(now);
  return {
    id: uuid(),
    text: t,
    bold: normalizeRanges(bold, t.length),
    status: STATUSES.includes(status) ? status : 'todo',
    priority: PRIORITIES.includes(priority) ? priority : null,
    notes: '',
    notesHeight: DEFAULT_NOTES_HEIGHT,
    order,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
}

const EDITABLE = ['text', 'bold', 'status', 'priority', 'notes', 'notesHeight', 'order', 'deletedAt'];

// Applies a partial update. Unknown keys are dropped and every field is
// validated, so a bad patch from either side can never corrupt the store.
export function applyPatch(task, patch, now = Date.now()) {
  const next = { ...task };
  for (const k of EDITABLE) if (k in patch) next[k] = patch[k];
  next.text = String(next.text ?? '');
  next.bold = normalizeRanges(next.bold, next.text.length);
  if (!STATUSES.includes(next.status)) next.status = task.status;
  if (!PRIORITIES.includes(next.priority)) next.priority = task.priority;
  next.notes = String(next.notes ?? '');
  next.notesHeight = clampNotesHeight(next.notesHeight);
  if (!Number.isFinite(next.order)) next.order = task.order;
  if (next.deletedAt !== null && typeof next.deletedAt !== 'string') next.deletedAt = task.deletedAt;
  next.updatedAt = nowIso(now);
  return next;
}

export function clampNotesHeight(h) {
  return Number.isFinite(h) ? Math.round(Math.min(800, Math.max(72, h))) : DEFAULT_NOTES_HEIGHT;
}

// Repairs anything loaded from disk into a valid task, or null if it cannot be.
export function validateTask(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const created = Date.parse(raw.createdAt);
  const createdAt = Number.isFinite(created) ? new Date(created).toISOString() : nowIso();
  const updated = Date.parse(raw.updatedAt);
  const text = String(raw.text ?? '');
  return {
    id: raw.id,
    text,
    bold: normalizeRanges(raw.bold, text.length),
    status: STATUSES.includes(raw.status) ? raw.status : 'todo',
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : null,
    notes: String(raw.notes ?? ''),
    notesHeight: clampNotesHeight(raw.notesHeight),
    order: Number.isFinite(raw.order) ? raw.order : created || 0,
    createdAt,
    updatedAt: Number.isFinite(updated) ? new Date(updated).toISOString() : createdAt,
    deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : null,
  };
}

// Whatever was on disk → the current file shape. Version 1 is the first, so
// this only validates for now; later versions add steps here.
export function migrate(file, now = Date.now()) {
  const src = file && typeof file === 'object' ? file : {};
  const tasks = (Array.isArray(src.tasks) ? src.tasks : [])
    .map(validateTask)
    .filter(Boolean)
    .filter((t) => !t.deletedAt || now - Date.parse(t.deletedAt) < TOMBSTONE_TTL_MS);
  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: typeof src.deviceId === 'string' && src.deviceId ? src.deviceId : uuid(),
    tasks,
  };
}

// ─── Ordering ────────────────────────────────────────────────────────────────

const byOrder = (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const byCreated = (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byOrder(a, b);

export function comparator(sort) {
  if (sort === 'priority') return byPriority;
  if (sort === 'created') return byCreated;
  return byOrder; // 'default' and 'manual' both follow the drag order
}

// What the window shows. Default sort groups the main board by status; the
// others show it as one list in that order. To Do is always its own panel.
//   → { todo: Task[], sections: [{ status, tasks }] }  (status null = one flat list)
export function arrange(tasks, sort = 'default') {
  const live = tasks.filter((t) => !t.deletedAt);
  const cmp = comparator(sort);
  const todo = live.filter((t) => t.status === 'todo').sort(cmp);
  const board = live.filter((t) => t.status !== 'todo');
  const sections = sort === 'default'
    ? BOARD_STATUSES.map((status) => ({ status, tasks: board.filter((t) => t.status === status).sort(cmp) }))
    : [{ status: null, tasks: board.sort(cmp) }];
  return { todo, sections };
}

// Drag-and-drop works in Default (within and across sections) and Manual.
export function canDrag(sort) {
  return sort === 'default' || sort === 'manual';
}

// The `order` for a task dropped between two neighbours (either may be
// missing at the ends of a list). Midpoints keep every other task untouched.
export function orderBetween(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

export function nextOrder(tasks) {
  return tasks.reduce((m, t) => Math.max(m, t.order), 0) + 1;
}
