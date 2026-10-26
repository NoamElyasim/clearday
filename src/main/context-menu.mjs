// The right-click menu for text fields: spelling, editing, Look Up, speech,
// and — in notes — writing direction. A pure function of what was clicked, so
// it can be tested without a window; main.mjs supplies the actions.
//
//   params  Electron's context-menu params (misspelledWord,
//           dictionarySuggestions, selectionText, isEditable, editFlags)
//   ctx     { field: 'notes' | 'text' | 'input' | null, notesDir, spellcheck }
//   act     { replace(word), learn(word), lookUp(), setDir(dir), setSpellcheck(on) }

const MAX_SUGGESTIONS = 5;

export function buildTemplate(params, ctx, act) {
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
  const sel = (params.selectionText || '').trim();
  const flags = params.editFlags || {};

  if (!params.isEditable) {
    // Plain text, e.g. a selected word in a row: copying and looking it up.
    if (!sel) return [];
    items.push({ label: 'Copy', role: 'copy' });
    items.push({ label: `Look Up “${short(sel)}”`, click: () => act.lookUp() });
    return items;
  }

  if (params.misspelledWord) {
    const words = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    if (words.length) for (const w of words) items.push({ label: w, click: () => act.replace(w) });
    else items.push({ label: 'No Guesses Found', enabled: false });
    items.push({ label: 'Learn Spelling', click: () => act.learn(params.misspelledWord) });
    sep();
  }

  if (sel) {
    items.push({ label: `Look Up “${short(sel)}”`, click: () => act.lookUp() });
    sep();
  }

  items.push(
    { label: 'Cut', role: 'cut', enabled: flags.canCut !== false },
    { label: 'Copy', role: 'copy', enabled: flags.canCopy !== false },
    { label: 'Paste', role: 'paste', enabled: flags.canPaste !== false },
    { label: 'Paste and Match Style', role: 'pasteAndMatchStyle', enabled: flags.canPaste !== false },
    { label: 'Select All', role: 'selectAll', enabled: flags.canSelectAll !== false },
  );
  sep();

  if (ctx.field === 'notes') {
    const dir = ctx.notesDir || 'auto';
    const radio = (label, value) => ({ label, type: 'radio', checked: dir === value, click: () => act.setDir(value) });
    items.push({
      label: 'Writing Direction',
      submenu: [radio('Default', 'auto'), radio('Left to Right', 'ltr'), radio('Right to Left', 'rtl')],
    });
    items.push({
      label: 'Check Spelling While Typing', type: 'checkbox', checked: ctx.spellcheck !== false,
      click: (item) => act.setSpellcheck(item.checked),
    });
  }
  items.push({
    label: 'Speech',
    submenu: [{ label: 'Start Speaking', role: 'startSpeaking' }, { label: 'Stop Speaking', role: 'stopSpeaking' }],
  });
  return items;
}

function short(text) {
  const one = text.replace(/\s+/g, ' ');
  return one.length > 24 ? `${one.slice(0, 23)}…` : one;
}
