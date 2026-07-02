// Lets the time-series charts broadcast the hovered time without knowing about
// which other panels (map, grip circle, ...) care about it.
const listeners = [];

export function onCursorMove(fn) {
  listeners.push(fn);
}

export function moveCursor(tSec) {
  for (const fn of listeners) fn(tSec);
}

export function clearCursor() {
  for (const fn of listeners) fn(null);
}
