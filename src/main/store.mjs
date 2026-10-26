// Task persistence: one JSON file in the user-data dir, owned by the main
// process. The renderer never touches the file; it asks over IPC and gets the
// updated task back.
//
// JSON rather than SQLite: a day's board is tens of tasks, the file stays
// readable by hand, and there is no native module to rebuild for every
// Electron upgrade. Writes are debounced and atomic (write, then rename).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { migrate, createTask, applyPatch, nextOrder } from '../shared/model.mjs';

const FILE = path.join(app.getPath('userData'), 'tasks.json');
const WRITE_DELAY_MS = 300;

let data = null;
let timer = null;

function load() {
  if (data) return data;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    // A file that exists but does not parse is kept aside rather than
    // overwritten by an empty board on the next save.
    if (e.code !== 'ENOENT') {
      try { fs.copyFileSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (_) {}
      console.error('store: could not read tasks.json', e);
    }
  }
  data = migrate(raw);
  return data;
}

function scheduleWrite() {
  clearTimeout(timer);
  timer = setTimeout(flush, WRITE_DELAY_MS);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!data) return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('store: could not save', e);
  }
}

// Live tasks only; tombstones stay on disk for a future sync.
export function list() {
  return load().tasks.filter((t) => !t.deletedAt);
}

export function create(fields) {
  const d = load();
  const task = createTask({ ...fields, order: nextOrder(d.tasks) });
  d.tasks.push(task);
  scheduleWrite();
  return task;
}

export function update(id, patch) {
  const d = load();
  const i = d.tasks.findIndex((t) => t.id === id);
  if (i < 0) return null;
  d.tasks[i] = applyPatch(d.tasks[i], patch);
  scheduleWrite();
  return d.tasks[i];
}

export function remove(id) {
  return update(id, { deletedAt: new Date().toISOString() });
}

export function restore(id) {
  return update(id, { deletedAt: null });
}

export const FILE_PATH = FILE;
