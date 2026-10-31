"""The part of the frame the model works on, so small characters still get its full resolution."""

import numpy as np

from momentsgen import Placement
from momentsgen.insert import focus_region
from momentsgen.track import in_region


def test_a_small_placement_gets_a_tight_crop_with_the_working_shape():
    box = Placement(0.24, 0.46, 0.2, 0.32)

    x0, y0, x1, y1 = focus_region(box, (1280, 720), aspect=832 / 480)

    bx0, by0, bx1, by1 = box.pixels(1280, 720)
    assert x0 <= bx0 and y0 <= by0 and x1 >= bx1 and y1 >= by1      # the whole placement is in it
    assert (x1 - x0) < 1280 * 0.7                                    # much tighter than the frame
    assert abs((x1 - x0) / (y1 - y0) - 832 / 480) < 0.02             # the model's shape: no stretching
    assert 0 <= x0 and 0 <= y0 and x1 <= 1280 and y1 <= 720


def test_the_crop_covers_where_the_camera_motion_takes_the_placement():
    box = Placement(0.4, 0.4, 0.1, 0.2)
    drift = np.array([[[1, 0, 0], [0, 1, 0]], [[1, 0, 300], [0, 1, 0]]], np.float32)  # scene moves 300 px right

    x0, _, x1, _ = focus_region(box, (1280, 720), aspect=832 / 480, motion=drift)

    assert x0 <= 0.4 * 1280 and x1 >= 0.5 * 1280 + 300


def test_a_placement_too_big_for_a_crop_uses_the_whole_frame():
    assert focus_region(Placement(0.0, 0.0, 1.0, 0.9), (1280, 720), aspect=832 / 480) == (0, 0, 1280, 720)


def test_motion_in_crop_coordinates_matches_moving_the_point_then_cropping():
    shift = np.array([[1, 0, 10], [0, 1, -4]], np.float32)
    point = np.array([500.0, 300.0])

    local = in_region(shift, 400, 200, 2.0, 2.0) @ np.array([*(point - [400, 200]) * 2.0, 1.0])

    np.testing.assert_allclose(local, (point + [10, -4] - [400, 200]) * 2.0, atol=1e-4)
