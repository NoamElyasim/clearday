// Imported first by main.mjs, before anything reads the user-data path:
// CLEARDAY_USER_DATA points a dev run or the screenshot harness at a scratch
// folder, so testing never touches the real board.
import { app } from 'electron';

if (process.env.CLEARDAY_USER_DATA) app.setPath('userData', process.env.CLEARDAY_USER_DATA);
