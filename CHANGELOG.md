# Changelog

## v0.2.1 — 2026-10-27

- **The blur behind the window actually shows.** macOS only blurs behind a
  frameless window that keeps a hidden title bar, so the window now uses one.
  Before this fix the background was see-through but never blurred.
- **Blur style** in Preferences: Subtle, Frosted (the default) or Vivid.
- **Lower default background opacity** (Light 35%, Dark 45%), so the blur can
  be seen. Opacity you set yourself is kept.
- **Plain text in Light mode:** black headings with no white highlight under
  them. In Dark mode the glow behind text is gone.
- Window corners match macOS's own.

## v0.2.0 — 2026-10-27

- **Preferences**, from the gear or ⌘,:
  - Appearance: theme, background opacity (separate for Light and Dark),
    blur behind the window, text size, weekday.
  - Behavior: always on top, Dock or menu bar only, launch at login, sort,
    spell checking in notes.
  - Data: show the data folder, export tasks, reset the window position.
  - A list of keyboard shortcuts.
- **Ongoing list** for long-term projects, in a tab beside To Do (and its own
  edge tab in the narrow layout).
  - Ongoing tasks keep their statuses and stay off today's board.
  - Move tasks between Today and Ongoing from the status picker or by
    dragging them.
- **New status: Awaiting Approval** (light blue). It sits between In
  Progress and On Hold.
- **Notes:**
  - The ≡ button now closes notes as well as opening them, so the X is gone.
  - Right-clicking in a note offers spelling suggestions, Look Up, speech,
    and writing direction (kept per note).
- **The live glass is gone, and with it the Screen Recording prompt.** The
  window now uses the system blur under a background you set yourself.

## v0.1.0 — 2026-10-26

First release.

- Liquid-glass window with Light, Dark and Follow System themes. It uses the
  token widget's refraction shader, with the system blur until Screen
  Recording is allowed.
- Date header in dd/mm/yyyy that rolls over at midnight.
- Tasks with four statuses:
  - the status fills the whole row
  - To Do sits in its own panel
  - In Progress, On Hold and Done are board sections
- High and Medium priority as glowing rings.
- Partial bold (⌘B), edit in place, delete with undo.
- A notes panel under each task: autosaved, resizable, closed by its X.
- Expanded and compact layouts.
- Sorting: by status, priority or creation time, or manual. Drag and drop
  within and between sections.
- Launch at login, always on top, and Dock or menu-bar-only modes.
