import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRanges, toggleBold, isRangeBold, segments, fromSegments, trimRich,
  createTask, applyPatch, validateTask, migrate, arrange, orderBetween, nextOrder,
  TOMBSTONE_TTL_MS,
} from '../src/shared/model.mjs';

test('normalizeRanges sorts, merges, clamps and drops empty ranges', () => {
  assert.deepEqual(normalizeRanges([[5, 8], [0, 2], [1, 3], [8, 9], [4, 4], [-3, 1], [9, 50]], 10),
    [[0, 3], [5, 10]]);
  assert.deepEqual(normalizeRanges([[3, 1]], 10), [[1, 3]]);
  assert.deepEqual(normalizeRanges('junk', 10), []);
  assert.deepEqual(normalizeRanges([[1, 'x'], [2, 4]], 10), [[2, 4]]);
});

test('toggleBold bolds one word, then un-bolds it', () => {
  const text = 'Call the bank today';
  let b = toggleBold([], 9, 13, text.length);
  assert.deepEqual(b, [[9, 13]]);
  assert.ok(isRangeBold(b, 9, 13));
  b = toggleBold(b, 9, 13, text.length);
  assert.deepEqual(b, []);
});

test('toggleBold over a partly bold range bolds all of it', () => {
  assert.deepEqual(toggleBold([[2, 4]], 0, 6, 10), [[0, 6]]);
});

test('toggleBold inside a bold range splits it', () => {
  assert.deepEqual(toggleBold([[0, 10]], 3, 5, 10), [[0, 3], [5, 10]]);
});

test('whole-row toggle', () => {
  assert.deepEqual(toggleBold([], 0, 5, 5), [[0, 5]]);
  assert.deepEqual(toggleBold([[0, 5]], 0, 5, 5), []);
});

test('segments and fromSegments round-trip', () => {
  const text = 'Ship the build tonight';
  const bold = [[5, 8], [15, 22]];
  const runs = segments(text, bold);
  assert.deepEqual(runs.map((r) => r.text).join(''), text);
  assert.deepEqual(runs.filter((r) => r.bold).map((r) => r.text), ['the', 'tonight']);
  assert.deepEqual(fromSegments(runs), { text, bold });
});

test('fromSegments merges adjacent bold runs', () => {
  assert.deepEqual(fromSegments([{ text: 'ab', bold: true }, { text: 'cd', bold: true }, { text: 'e', bold: false }]),
    { text: 'abcde', bold: [[0, 4]] });
});

test('trimRich keeps bold aligned with trimmed text', () => {
  assert.deepEqual(trimRich('  hello world ', [[2, 7]]), { text: 'hello world', bold: [[0, 5]] });
  assert.deepEqual(trimRich('  x ', [[0, 1]]), { text: 'x', bold: [] });
});

test('createTask defaults', () => {
  const t = createTask({ text: 'a' }, Date.parse('2026-10-26T10:00:00Z'));
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, null);
  assert.equal(t.deletedAt, null);
  assert.equal(t.createdAt, '2026-10-26T10:00:00.000Z');
  assert.equal(t.createdAt, t.updatedAt);
  assert.match(t.id, /^[0-9a-f-]{36}$/);
});

test('applyPatch validates fields and bumps updatedAt', () => {
  const t = createTask({ text: 'abc' }, 0);
  const n = applyPatch(t, { status: 'bogus', priority: 'urgent', bold: [[0, 99]], id: 'hijack', notesHeight: 5 }, 1000);
  assert.equal(n.status, 'todo');
  assert.equal(n.priority, null);
  assert.deepEqual(n.bold, [[0, 3]]);
  assert.equal(n.id, t.id);
  assert.equal(n.notesHeight, 72);
  assert.equal(n.updatedAt, new Date(1000).toISOString());
  assert.equal(applyPatch(t, { status: 'done', priority: 'high' }).status, 'done');
});

test('validateTask repairs or rejects', () => {
  assert.equal(validateTask(null), null);
  assert.equal(validateTask({ text: 'no id' }), null);
  const v = validateTask({ id: 'x', text: 'hi', status: 'weird', bold: [[0, 9]], createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(v.status, 'todo');
  assert.deepEqual(v.bold, [[0, 2]]);
  assert.equal(v.updatedAt, v.createdAt);
});

test('migrate keeps deviceId, drops expired tombstones', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  const old = new Date(now - TOMBSTONE_TTL_MS - 1).toISOString();
  const recent = new Date(now - 1000).toISOString();
  const f = migrate({
    deviceId: 'dev1',
    tasks: [
      { id: 'a', createdAt: recent },
      { id: 'b', createdAt: recent, deletedAt: old },
      { id: 'c', createdAt: recent, deletedAt: recent },
      'garbage',
    ],
  }, now);
  assert.equal(f.schemaVersion, 1);
  assert.equal(f.deviceId, 'dev1');
  assert.deepEqual(f.tasks.map((t) => t.id), ['a', 'c']);
  assert.ok(migrate(undefined).deviceId);
});

function mk(id, status, order, priority = null, createdAt = `2026-10-26T00:00:0${order}Z`) {
  return { ...createTask({ status, priority, order }), id, createdAt };
}

test('arrange: default groups board by status, To Do apart, Done last', () => {
  const tasks = [
    mk('d1', 'done', 1), mk('p2', 'in_progress', 3), mk('h1', 'on_hold', 2),
    mk('t1', 'todo', 4), mk('p1', 'in_progress', 1), { ...mk('x', 'in_progress', 0), deletedAt: 'z' },
  ];
  const a = arrange(tasks, 'default');
  assert.deepEqual(a.todo.map((t) => t.id), ['t1']);
  assert.deepEqual(a.sections.map((s) => s.status), ['in_progress', 'awaiting_approval', 'on_hold', 'done']);
  assert.deepEqual(a.sections.map((s) => s.tasks.map((t) => t.id)), [['p1', 'p2'], [], ['h1'], ['d1']]);
});

test('arrange: priority sort is one list, high then medium then none', () => {
  const tasks = [mk('n', 'done', 1), mk('m', 'in_progress', 2, 'medium'), mk('h', 'on_hold', 3, 'high')];
  const a = arrange(tasks, 'priority');
  assert.equal(a.sections.length, 1);
  assert.equal(a.sections[0].status, null);
  assert.deepEqual(a.sections[0].tasks.map((t) => t.id), ['h', 'm', 'n']);
});

test('arrange: created sort ignores drag order', () => {
  const tasks = [mk('b', 'done', 1, null, '2026-10-26T02:00:00Z'), mk('a', 'done', 9, null, '2026-10-26T01:00:00Z')];
  assert.deepEqual(arrange(tasks, 'created').sections[0].tasks.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(arrange(tasks, 'manual').sections[0].tasks.map((t) => t.id), ['b', 'a']);
});

test('orderBetween and nextOrder', () => {
  assert.equal(orderBetween(1, 2), 1.5);
  assert.equal(orderBetween(null, 2), 1);
  assert.equal(orderBetween(4, null), 5);
  assert.equal(orderBetween(null, null), 0);
  assert.equal(nextOrder([{ order: 3 }, { order: 7 }]), 8);
  assert.equal(nextOrder([]), 1);
});

test('Awaiting Approval sits between In Progress and On Hold', () => {
  const a = arrange([mk('h', 'on_hold', 1), mk('w', 'awaiting_approval', 2), mk('p', 'in_progress', 3)], 'default');
  assert.deepEqual(a.sections.filter((s) => s.tasks.length).map((s) => s.tasks[0].id), ['p', 'w', 'h']);
});

test('ongoing tasks stay off the board and To Do, ordered by status then drag order', () => {
  const on = (id, status, order) => ({ ...mk(id, status, order), list: 'ongoing' });
  const a = arrange([on('od', 'done', 1), on('ot', 'todo', 2), on('op2', 'in_progress', 4), on('op1', 'in_progress', 3),
    on('ow', 'awaiting_approval', 5), mk('t', 'todo', 6), mk('p', 'in_progress', 7)], 'default');
  assert.deepEqual(a.todo.map((t) => t.id), ['t']);
  assert.deepEqual(a.sections.flatMap((s) => s.tasks.map((t) => t.id)), ['p']);
  assert.deepEqual(a.ongoing.map((t) => t.id), ['op1', 'op2', 'ow', 'ot', 'od']);
  assert.deepEqual(arrange([on('b', 'done', 2), on('a', 'todo', 1)], 'manual').ongoing.map((t) => t.id), ['a', 'b']);
});

test('list and notesDir default, validate and survive a patch', () => {
  const t = createTask({ text: 'x' });
  assert.equal(t.list, 'today');
  assert.equal(t.notesDir, 'auto');
  assert.equal(createTask({ list: 'ongoing' }).list, 'ongoing');
  assert.equal(createTask({ list: 'bogus' }).list, 'today');
  const n = applyPatch(t, { list: 'ongoing', notesDir: 'rtl' });
  assert.equal(n.list, 'ongoing');
  assert.equal(n.notesDir, 'rtl');
  const bad = applyPatch(n, { list: 'nope', notesDir: 'up' });
  assert.equal(bad.list, 'ongoing');
  assert.equal(bad.notesDir, 'rtl');
  const v = validateTask({ id: 'old', text: 'from v0.1.0' });   // no list / notesDir on disk
  assert.equal(v.list, 'today');
  assert.equal(v.notesDir, 'auto');
});
