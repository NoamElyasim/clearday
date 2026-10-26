# ClearDay

A compact, Monday-style daily task board that floats on your Mac desktop in
liquid glass. One window, one day: set what's in progress, what's on hold,
what's done, and keep the to-do list beside it.

![ClearDay, dark](docs/expanded-dark.png)

| Light | Compact |
|---|---|
| ![ClearDay, light](docs/expanded-light.png) | ![ClearDay, compact](docs/compact-light.png) |

## Features

- **Liquid glass.** The window refracts and frosts the desktop behind it,
  using the same shader as
  [Claude Usage Limits Bar](https://github.com/NoamElyasim/Claude-usage-limits-bar).
  It has Light, Dark and Follow System themes. Until Screen Recording is
  allowed, it uses the system blur instead.
- **Statuses fill the row.** Click the round button on a row and pick To Do,
  In Progress, On Hold or Done. The whole row takes that colour.
- **To Do in its own panel.** The board lists In Progress first, then
  On Hold, then Done. A row moves to its new section, animated, when its
  status changes.
- **Priority rings.** Mark a task High (red) or Medium (orange) and a
  glowing ring appears on its right.
- **Partial bold.** Select a word and press ⌘B or the B button. With nothing
  selected, B bolds the whole row.
- **Notes.** The ≡ button opens a notes panel attached under the task. It
  saves as you type and resizes from its bottom edge. Only its X closes it,
  so it never closes by accident.
- **Responsive layout.**
  - A wide window shows the board and the To Do panel side by side.
  - A narrow window shows one column, with To Do in a drawer on the right
    edge and the row tools behind "…".
- **Sorting.** Default (by status), By priority, By creation time, or Manual.
  Default and Manual let you drag rows to reorder them, and drag rows between
  To Do and the board.
- **Undo.** A deleted task can be restored from the toast or with ⌘Z.
- **Your day carries over.** At midnight only the date changes. Nothing is
  cleared or archived.
- **Launches at login** (you can turn this off). It can show in the Dock or
  in the menu bar only, and can stay always on top.

### Keyboard

| Key | Action |
|---|---|
| Enter | Add the task you typed. On a selected row, edit it |
| ⌘N | Jump to the add field |
| ↑ / ↓ | Select a row |
| ⌘B | Bold the selection, or the whole row |
| ⌘⌫ | Delete the selected task |
| ⌘Z | Undo the last delete |
| Esc | Cancel an edit, close a picker or the drawer |

## Install

ClearDay needs macOS 13 or later. It isn't notarized, so build it yourself:

```bash
git clone https://github.com/NoamElyasim/clearday.git
cd clearday
npm install
npm run install:mac      # builds, signs locally, copies to /Applications, opens it
```

The first launch asks for **Screen Recording**. The live glass needs it to see
the desktop behind the window. Nothing is recorded or stored; frames go
straight to the shader. If you skip the prompt, you can allow it later from
the gear menu.

The build needs the Xcode command line tools (`xcode-select --install`) for
the small Swift capture helper.

## Develop

```bash
npm start                # run from source
npm test                 # unit tests for the task model
npm run e2e              # drives the real UI with clicks, keys and drags
npm run shots            # renders every look to tools/shots/out/
npm run shots -- --docs  # …and refreshes the README images
```

`CLEARDAY_USER_DATA=/some/folder npm start` runs against a scratch board.
Running it that way leaves your real board untouched.

### Layout

```
src/main/       main process: window, menus, tray, settings, task store, glass capture
src/preload.cjs the renderer's API (window.clearday)
src/shared/     the task model: plain functions shared by both sides
src/renderer/   the UI; theme.css holds every colour
native/         the ScreenCaptureKit helper behind the glass
```

### Data

Tasks are kept in `~/Library/Application Support/ClearDay/tasks.json`. The
format is plain, versioned JSON, ready for syncing to a phone later:

- every task has an ID, a `createdAt` and an `updatedAt` timestamp
- deleted tasks are kept as tombstones for 30 days

Window size, theme and the other settings live in a separate
`settings.json`, because they belong to this Mac.

## License

[MIT](LICENSE)
