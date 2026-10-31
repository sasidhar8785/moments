"""Following the scene as the camera moves, so the character stays put in the room."""

import numpy as np

from momentsgen.track import follow_scene, warp_mask


def panning_clip(n: int, step: tuple[float, float], w: int = 160, h: int = 120) -> np.ndarray:
    """A textured scene filmed by a camera that moves `step` pixels per frame (the scene drifts the other way)."""
    rng = np.random.default_rng(0)
    scene = (rng.random((h + 80, w + 80, 3)) * 255).astype(np.uint8)
    # Blur into blobs so it looks like a scene rather than per-pixel noise.
    import cv2

    scene = cv2.GaussianBlur(scene, (0, 0), 2)
    frames = []
    for i in range(n):
        x, y = 40 + round(step[0] * i), 40 + round(step[1] * i)
        frames.append(scene[y:y + h, x:x + w])
    return np.stack(frames)


def test_a_still_camera_gives_no_motion():
    frames = np.repeat(panning_clip(1, (0, 0)), 5, axis=0)

    motion = follow_scene(frames, exclude=(60, 40, 100, 80))

    assert motion.shape == (5, 2, 3)
    np.testing.assert_allclose(motion, np.tile(np.eye(2, 3), (5, 1, 1)), atol=0.05)


def test_a_point_in_the_scene_is_followed_as_the_camera_pans():
    frames = panning_clip(9, (2, 1))  # camera moves right and down: the scene moves left and up

    motion = follow_scene(frames, exclude=(60, 40, 100, 80))

    where = motion[-1] @ np.array([80.0, 60.0, 1.0])
    np.testing.assert_allclose(where, [80 - 16, 60 - 8], atol=1.0)


def test_a_mask_moves_with_the_scene():
    mask = np.zeros((120, 160), np.uint8)
    mask[40:80, 60:100] = 255
    shift = np.array([[1, 0, -10], [0, 1, 5]], np.float32)

    moved = warp_mask(mask, shift)

    ys, xs = np.nonzero(moved > 127)
    assert (xs.min(), xs.max(), ys.min(), ys.max()) == (50, 89, 45, 84)
