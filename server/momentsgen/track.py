"""Follow the scene as the camera moves, so a character placed on the first frame stays put in the room.

The camera motion is estimated from features tracked across the frames (outside the placement, where
the character will be), as a rotation + scale + shift per frame. That is enough for a phone moving
around a scene for a few seconds; it is not full 3D tracking.
"""

import cv2
import numpy as np

IDENTITY = np.eye(2, 3, dtype=np.float32)


def follow_scene(frames: np.ndarray, exclude: tuple[int, int, int, int] | None = None) -> np.ndarray:
    """(n, 2, 3) transforms taking a point in frame 0 to where that point of the scene is in frame i.

    `exclude` is a pixel box (x0, y0, x1, y1) to ignore, e.g. where the character goes. When too
    little can be tracked in a frame, the previous frame's motion is kept.
    """
    grey = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY) for f in frames]
    h, w = grey[0].shape
    allowed = np.full((h, w), 255, np.uint8)
    if exclude is not None:
        x0, y0, x1, y1 = exclude
        allowed[y0:y1, x0:x1] = 0

    motion = [IDENTITY.copy()]
    points = cv2.goodFeaturesToTrack(grey[0], maxCorners=400, qualityLevel=0.01, minDistance=6, mask=allowed)
    start = points
    for i in range(1, len(grey)):
        found = None
        if points is not None and len(points) >= 8:
            moved, ok, _ = cv2.calcOpticalFlowPyrLK(grey[i - 1], grey[i], points, None, winSize=(21, 21), maxLevel=3)
            ok = ok.ravel() == 1
            points, start = moved[ok], start[ok]
            if len(points) >= 8:
                found, _ = cv2.estimateAffinePartial2D(start, points, method=cv2.RANSAC, ransacReprojThreshold=2.0)
        motion.append(found.astype(np.float32) if found is not None else motion[-1].copy())
    return np.stack(motion)


def warp_mask(mask: np.ndarray, transform: np.ndarray) -> np.ndarray:
    """The mask moved by `transform` (2x3), same size."""
    h, w = mask.shape
    return cv2.warpAffine(mask, transform, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)


def rescale(transform: np.ndarray, sx: float, sy: float) -> np.ndarray:
    """The same motion expressed for frames scaled by (sx, sy), e.g. from working size to full size."""
    return in_region(transform, 0, 0, sx, sy)


def in_region(transform: np.ndarray, x0: float, y0: float, sx: float, sy: float) -> np.ndarray:
    """The same motion expressed in the coordinates of a crop starting at (x0, y0), scaled by (sx, sy)."""
    to_crop = np.array([[sx, 0, -x0 * sx], [0, sy, -y0 * sy], [0, 0, 1]])
    full = np.vstack([transform, [0, 0, 1]])
    return (to_crop @ full @ np.linalg.inv(to_crop))[:2].astype(np.float32)
