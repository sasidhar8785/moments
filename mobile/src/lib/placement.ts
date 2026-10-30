/** Where the character goes: a box in 0..1 frame coordinates. Matches the server's Placement. */
export type Box = { left: number; top: number; width: number; height: number };

/** Smallest box side, as a fraction of the frame, so the box stays grabbable. */
export const MIN_SIDE = 0.08;

export const DEFAULT_BOX: Box = { left: 0.3, top: 0.3, width: 0.4, height: 0.55 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Move the box by (dx, dy), keeping it fully inside the frame. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  return {
    ...box,
    left: clamp(box.left + dx, 0, 1 - box.width),
    top: clamp(box.top + dy, 0, 1 - box.height),
  };
}

/** Resize from the bottom-right corner by (dx, dy), keeping a minimum size and staying inside the frame. */
export function resizeBox(box: Box, dx: number, dy: number): Box {
  return {
    ...box,
    width: clamp(box.width + dx, MIN_SIDE, 1 - box.left),
    height: clamp(box.height + dy, MIN_SIDE, 1 - box.top),
  };
}

/**
 * Convert a box drawn over a camera preview that fills the screen ("cover") into a box on the
 * recorded video, which shows a different part of the scene when the aspect ratios differ.
 * `screen` and `video` are aspect ratios (width / height).
 */
export function screenBoxToVideoBox(box: Box, screen: number, video: number): Box {
  let { left, top, width, height } = box;
  if (video > screen) {
    // The video is wider than the screen: the preview cropped its sides.
    const visible = screen / video;
    left = (1 - visible) / 2 + left * visible;
    width = width * visible;
  } else if (video < screen) {
    // The video is taller than the screen: the preview cropped its top and bottom.
    const visible = video / screen;
    top = (1 - visible) / 2 + top * visible;
    height = height * visible;
  }
  return moveBox({ left, top, width, height }, 0, 0);
}
