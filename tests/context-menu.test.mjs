import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate } from '../src/main/context-menu.mjs';

const calls = [];
const act = {
  replace: (w) => calls.push(['replace', w]),
  learn: (w) => calls.push(['learn', w]),
  lookUp: () => calls.push(['lookUp']),
  setDir: (d) => calls.push(['dir', d]),
  setSpellcheck: (on) => calls.push(['spell', on]),
};
const labels = (items) => items.map((i) => i.label || i.type);
const editable = { isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } };

test('misspelled word: suggestions first, then Learn Spelling', () => {
  calls.length = 0;
  const t = buildTemplate({ ...editable, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea', 'tech', 'tee', 'ted'] },
    { field: 'notes' }, act);
  assert.deepEqual(labels(t).slice(0, 7), ['the', 'ten', 'tea', 'tech', 'tee', 'Learn Spelling', 'separator']);
  t[0].click();
  t[5].click();
  assert.deepEqual(calls, [['replace', 'the'], ['learn', 'teh']]);
});

test('no suggestions says so', () => {
  const t = buildTemplate({ ...editable, misspelledWord: 'qzxv', dictionarySuggestions: [] }, { field: 'input' }, act);
  assert.equal(t[0].label, 'No Guesses Found');
  assert.equal(t[0].enabled, false);
});

test('notes get Writing Direction with the current one checked, and the spelling toggle', () => {
  calls.length = 0;
  const t = buildTemplate(editable, { field: 'notes', notesDir: 'rtl', spellcheck: false }, act);
  const dir = t.find((i) => i.label === 'Writing Direction');
  assert.deepEqual(dir.submenu.map((i) => [i.label, i.checked]), [['Default', false], ['Left to Right', false], ['Right to Left', true]]);
  dir.submenu[1].click();
  const spell = t.find((i) => i.label === 'Check Spelling While Typing');
  assert.equal(spell.checked, false);
  spell.click({ checked: true });
  assert.deepEqual(calls, [['dir', 'ltr'], ['spell', true]]);
});

test('other fields have no Writing Direction', () => {
  for (const field of ['text', 'input']) {
    assert.ok(!labels(buildTemplate(editable, { field }, act)).includes('Writing Direction'));
  }
});

test('edit items follow edit flags; Look Up appears with a selection', () => {
  const t = buildTemplate({ isEditable: true, selectionText: 'burndown chart', editFlags: { canCut: true, canCopy: true, canPaste: false, canSelectAll: true } },
    { field: 'notes' }, act);
  assert.equal(t[0].label, 'Look Up “burndown chart”');
  assert.equal(t.find((i) => i.label === 'Paste').enabled, false);
  assert.equal(t.find((i) => i.label === 'Cut').enabled, true);
});

test('non-editable: copy and look up a selection, nothing without one', () => {
  assert.deepEqual(labels(buildTemplate({ isEditable: false, selectionText: 'Houston' }, { field: null }, act)),
    ['Copy', 'Look Up “Houston”']);
  assert.deepEqual(buildTemplate({ isEditable: false, selectionText: '' }, { field: null }, act), []);
});

test('no two separators in a row, none at the end of a section start', () => {
  const t = buildTemplate({ ...editable, misspelledWord: 'x', dictionarySuggestions: ['y'], selectionText: 'x' }, { field: 'notes' }, act);
  t.forEach((i, n) => { if (i.type === 'separator') assert.notEqual(t[n + 1]?.type, 'separator'); });
  assert.notEqual(t[0].type, 'separator');
});
