// Run with: npm test   (Node 22.18+ runs TypeScript directly)
import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_SIDE, moveBox, resizeBox, screenBoxToVideoBox } from "./placement.ts";

const box = { left: 0.2, top: 0.3, width: 0.4, height: 0.5 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("moving keeps the box inside the frame", () => {
  const moved = moveBox(box, 0.1, -0.1);
  near(moved.left, 0.3);
  near(moved.top, 0.2);
  assert.deepEqual(moveBox(box, 5, 5), { left: 0.6, top: 0.5, width: 0.4, height: 0.5 });
  assert.deepEqual(moveBox(box, -5, -5), { left: 0, top: 0, width: 0.4, height: 0.5 });
});

test("resizing stops at the frame edge and at the minimum size", () => {
  assert.deepEqual(resizeBox(box, 5, 5), { left: 0.2, top: 0.3, width: 0.8, height: 0.7 });
  assert.deepEqual(resizeBox(box, -5, -5), { left: 0.2, top: 0.3, width: MIN_SIDE, height: MIN_SIDE });
});

test("a box drawn on a 3:4 iPad preview maps onto the matching part of a 9:16 video", () => {
  // The 9:16 video is narrower than the 3:4 screen, so the preview crops its top and bottom:
  // only the middle 75% of the video's height is on screen.
  const v = screenBoxToVideoBox({ left: 0.25, top: 0, width: 0.5, height: 1 }, 3 / 4, 9 / 16);
  near(v.left, 0.25);
  near(v.width, 0.5);
  near(v.top, 0.125);
  near(v.height, 0.75);
});

test("when the video is wider than the screen, the box narrows into the visible middle", () => {
  const v = screenBoxToVideoBox({ left: 0, top: 0.2, width: 1, height: 0.5 }, 9 / 16, 3 / 4);
  near(v.left, 0.125);
  near(v.width, 0.75);
  near(v.top, 0.2);
  near(v.height, 0.5);
});
