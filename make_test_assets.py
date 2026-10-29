"""Build placeholder test media so the pipeline can run before real creator clips exist.

- "Creator": the public-domain NASA astronaut portrait bundled with scikit-image, gently animated.
- "Room": a procedurally drawn room filmed with simulated handheld shake.
- Audio: tones standing in for speech.
Replace these with real recordings to judge actual quality.
"""

import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
from skimage import data

ROOT = Path(__file__).parent
FPS = 24


def write_video(path: Path, frames, tone_hz: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w = frames[0].shape[:2]
    dur = len(frames) / FPS
    audio = (["-f", "lavfi", "-i", f"sine=frequency={tone_hz}:duration={dur}"] if tone_hz
             else ["-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={dur}"])
    enc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
         "-r", str(FPS), "-i", "-", *audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-shortest", str(path)], stdin=subprocess.PIPE)
    for f in frames:
        enc.stdin.write(np.ascontiguousarray(f).tobytes())
    enc.stdin.close()
    enc.wait()


def creator_clip(seconds: float, phase: float):
    """Astronaut portrait on a plain studio wall, with a slight sway as if talking."""
    img = cv2.cvtColor(data.astronaut(), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    frames = []
    for i in range(int(seconds * FPS)):
        t = i / FPS
        ang = 1.5 * np.sin(2 * np.pi * 0.7 * t + phase)
        m = cv2.getRotationMatrix2D((w / 2, h), ang, 1.0 + 0.01 * np.sin(2 * np.pi * 1.3 * t))
        frames.append(cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REPLICATE))
    return frames


def room_image(w=1400, h=2000) -> np.ndarray:
    rng = np.random.default_rng(7)
    img = np.zeros((h, w, 3), np.uint8)
    img[: int(h * 0.62)] = (178, 196, 214)  # wall
    img[int(h * 0.62):] = (70, 105, 140)  # wooden floor
    for y in range(int(h * 0.62), h, 60):  # floor boards
        cv2.line(img, (0, y), (w, y), (55, 85, 115), 3)
    cv2.rectangle(img, (120, 300), (560, 900), (235, 225, 200), -1)  # window
    cv2.rectangle(img, (120, 300), (560, 900), (90, 90, 90), 12)
    cv2.line(img, (340, 300), (340, 900), (90, 90, 90), 10)
    for _ in range(6):  # posters, give the tracker texture
        x, y = rng.integers(650, w - 260), rng.integers(150, int(h * 0.45))
        cv2.rectangle(img, (x, y), (x + 220, y + 300), tuple(int(c) for c in rng.integers(40, 220, 3)), -1)
        for _ in range(25):
            cx, cy = x + rng.integers(10, 210), y + rng.integers(10, 290)
            cv2.circle(img, (int(cx), int(cy)), int(rng.integers(4, 18)),
                       tuple(int(c) for c in rng.integers(0, 255, 3)), -1)
    cv2.rectangle(img, (900, int(h * 0.5)), (1300, int(h * 0.68)), (40, 60, 90), -1)  # sofa
    noise = rng.normal(0, 6, img.shape)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def room_clip(seconds: float):
    """Handheld phone footage: small drifting pan, tilt and wobble."""
    base = room_image()
    h, w = 1280, 720
    frames = []
    for i in range(int(seconds * FPS)):
        t = i / FPS
        cx = base.shape[1] / 2 + 60 * np.sin(2 * np.pi * 0.15 * t) + 6 * np.sin(2 * np.pi * 2.1 * t)
        cy = base.shape[0] / 2 + 25 * np.sin(2 * np.pi * 0.11 * t) + 5 * np.sin(2 * np.pi * 1.7 * t)
        m = cv2.getRotationMatrix2D((cx, cy), 1.2 * np.sin(2 * np.pi * 0.2 * t), 0.75)
        m[:, 2] += (w / 2 - cx, h / 2 - cy)
        frames.append(cv2.warpAffine(base, m, (w, h), borderMode=cv2.BORDER_REFLECT))
    return frames


def main() -> None:
    demo = ROOT / "creators" / "demo"
    (demo / "creator.json").parent.mkdir(parents=True, exist_ok=True)
    (demo / "creator.json").write_text(json.dumps({
        "display_name": "Demo Creator",
        "occasions": {"birthday": "Happy birthday", "exam_luck": "Good luck in your exams",
                      "workout": "Workout cheer"},
    }, indent=2))
    write_video(demo / "names" / "priya.mp4", creator_clip(1.5, 0.0), 440)
    write_video(demo / "names" / "_generic.mp4", creator_clip(1.5, 1.0), 392)
    write_video(demo / "occasions" / "birthday.mp4", creator_clip(3.5, 2.0), 523)
    write_video(ROOT / "samples" / "room.mp4", room_clip(6))
    print("Test assets written to creators/demo and samples/room.mp4")


if __name__ == "__main__":
    main()
