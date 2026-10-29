"""Render a personal "moment": a creator's real clips composited into a fan's room video.

Creator folder layout (recorded once at onboarding):
    creators/<id>/creator.json          {"display_name": ..., "occasions": {"birthday": "Happy birthday", ...}}
    creators/<id>/names/<name>.mp4      creator saying "Hey <Name>!" (one per common first name)
    creators/<id>/names/_generic.mp4    fallback for names the creator has not recorded
    creators/<id>/occasions/<key>.mp4   the occasion message itself

Nothing is synthesised: a fan-typed name only selects a clip the creator recorded,
so a fan can never make the creator say an arbitrary word.

Usage:
    python render.py --creator creators/demo --name Priya --occasion birthday \
        --room room.mp4 --out out/priya_birthday.mp4
"""

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

FPS = 24
OUT_H = 1280  # portrait 720x1280, the usual phone/story format
OUT_W = 720
CACHE = Path(__file__).parent / ".cache" / "mattes"


# ---------------------------------------------------------------- clip selection

def normalise_name(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.strip().lower())


def pick_clips(creator_dir: Path, name: str, occasion: str) -> list[Path]:
    meta = json.loads((creator_dir / "creator.json").read_text())
    if occasion not in meta["occasions"]:
        raise SystemExit(f"Occasion '{occasion}' is not on this creator's approved list: {list(meta['occasions'])}")
    name_clip = creator_dir / "names" / f"{normalise_name(name)}.mp4"
    if not name_clip.exists():
        name_clip = creator_dir / "names" / "_generic.mp4"
    return [name_clip, creator_dir / "occasions" / f"{occasion}.mp4"]


# ---------------------------------------------------------------- video io

def read_frames(path: Path, size: tuple[int, int] | None = None) -> list[np.ndarray]:
    """Decode a video (or still image) at FPS, optionally resized/cropped to fill `size` (w, h)."""
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
        frames = [cv2.imread(str(path))]
    else:
        cap = cv2.VideoCapture(str(path))
        src_fps = cap.get(cv2.CAP_PROP_FPS) or FPS
        frames, t, step = [], 0.0, src_fps / FPS
        i = 0
        while True:
            ok, f = cap.read()
            if not ok:
                break
            if i >= t:
                frames.append(f)
                t += step
            i += 1
        cap.release()
    if size:
        frames = [cover(f, size) for f in frames]
    return frames


def cover(img: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Scale and centre-crop so the image fills `size` (w, h)."""
    w, h = size
    s = max(w / img.shape[1], h / img.shape[0])
    img = cv2.resize(img, (round(img.shape[1] * s), round(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
    y, x = (img.shape[0] - h) // 2, (img.shape[1] - w) // 2
    return img[y:y + h, x:x + w]


def file_hash(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()[:16]


# ---------------------------------------------------------------- creator matting (cached)

_session = None


def matte_clip(path: Path) -> list[np.ndarray]:
    """Return BGRA frames with the creator cut out. Cached per clip, so it runs once at onboarding."""
    global _session
    cache = CACHE / file_hash(path)
    if cache.exists():
        return [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in sorted(cache.glob("*.png"))]
    from rembg import new_session, remove
    if _session is None:
        _session = new_session("u2net_human_seg")
    cache.mkdir(parents=True)
    out = []
    for i, f in enumerate(read_frames(path)):
        rgba = remove(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), session=_session)
        bgra = cv2.cvtColor(np.asarray(rgba), cv2.COLOR_RGBA2BGRA)
        cv2.imwrite(str(cache / f"{i:05d}.png"), bgra)
        out.append(bgra)
    return out


def trim_to_content(frames: list[np.ndarray]) -> list[np.ndarray]:
    """Crop every frame to the union bounding box of the creator, so scaling uses their real height."""
    alpha = np.max([f[:, :, 3] for f in frames], axis=0)
    ys, xs = np.where(alpha > 20)
    if len(ys) == 0:
        raise SystemExit("No person found in the creator clip.")
    return [f[ys.min():ys.max() + 1, xs.min():xs.max() + 1] for f in frames]


# ---------------------------------------------------------------- room camera tracking

def track_camera(frames: list[np.ndarray]) -> list[np.ndarray]:
    """2x3 transforms mapping frame-0 coordinates into each frame, so the creator stays put in the room."""
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    transforms = [np.eye(2, 3, dtype=np.float32)]
    acc = np.eye(3, dtype=np.float32)
    for prev, cur in zip(gray, gray[1:]):
        pts = cv2.goodFeaturesToTrack(prev, maxCorners=400, qualityLevel=0.01, minDistance=12)
        m = None
        if pts is not None and len(pts) >= 8:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None)
            good = st.ravel() == 1
            if good.sum() >= 8:
                m, _ = cv2.estimateAffinePartial2D(pts[good], nxt[good], method=cv2.RANSAC)
        step = np.vstack([m, [0, 0, 1]]).astype(np.float32) if m is not None else np.eye(3, dtype=np.float32)
        acc = step @ acc
        transforms.append(acc[:2].copy())
    return transforms


# ---------------------------------------------------------------- look matching

def match_colour(creator: np.ndarray, room: np.ndarray, strength: float = 0.6) -> np.ndarray:
    """Shift the creator's colour/brightness toward the room's (LAB mean/std transfer on visible pixels)."""
    bgr, a = creator[:, :, :3], creator[:, :, 3]
    mask = a > 128
    if mask.sum() < 50:
        return creator
    src = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    ref = cv2.cvtColor(room, cv2.COLOR_BGR2LAB).astype(np.float32).reshape(-1, 3)
    s_mean, s_std = src[mask].mean(0), src[mask].std(0) + 1e-6
    r_mean, r_std = ref.mean(0), ref.std(0) + 1e-6
    # Keep most of the creator's own contrast; only nudge toward the room.
    target_std = s_std * (1 - strength) + r_std * strength
    target_mean = s_mean * (1 - strength) + r_mean * strength
    out = (src - s_mean) / s_std * target_std + target_mean
    out = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    return np.dstack([out, a])


def add_shadow(frame: np.ndarray, foot_x: float, foot_y: float, width: float) -> None:
    """Soft contact shadow under the creator's feet (in place)."""
    shadow = np.zeros(frame.shape[:2], np.float32)
    cv2.ellipse(shadow, (int(foot_x), int(foot_y)), (int(width * 0.45), int(width * 0.08)), 0, 0, 360, 1.0, -1)
    shadow = cv2.GaussianBlur(shadow, (0, 0), sigmaX=width * 0.06)
    frame[:] = (frame * (1 - 0.45 * shadow[:, :, None])).astype(np.uint8)


def composite(frame: np.ndarray, layer: np.ndarray, x: int, y: int) -> None:
    """Alpha-blend a BGRA layer onto frame with its top-left at (x, y), clipped to the frame (in place)."""
    h, w = layer.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, frame.shape[1]), min(y + h, frame.shape[0])
    if x0 >= x1 or y0 >= y1:
        return
    part = layer[y0 - y:y1 - y, x0 - x:x1 - x]
    a = cv2.GaussianBlur(part[:, :, 3], (3, 3), 0).astype(np.float32)[:, :, None] / 255
    roi = frame[y0:y1, x0:x1]
    roi[:] = (part[:, :, :3] * a + roi * (1 - a)).astype(np.uint8)


def label(frame: np.ndarray, text: str) -> None:
    font, scale, th = cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1
    (tw, tht), _ = cv2.getTextSize(text, font, scale, th)
    x, y = frame.shape[1] - tw - 16, frame.shape[0] - 16
    cv2.rectangle(frame, (x - 8, y - tht - 8), (x + tw + 8, y + 8), (0, 0, 0), -1)
    cv2.putText(frame, text, (x, y), font, scale, (255, 255, 255), th, cv2.LINE_AA)


# ---------------------------------------------------------------- main render

def render(clips: list[Path], room: Path, out: Path, height_frac: float, pos_x: float, tag: str) -> None:
    creator = trim_to_content([f for c in clips for f in matte_clip(c)])
    room_frames = read_frames(room, (OUT_W, OUT_H))
    # Ping-pong the room footage if it is shorter than the creator's clips.
    while len(room_frames) < len(creator):
        room_frames += room_frames[::-1]
    room_frames = room_frames[:len(creator)]
    cams = track_camera(room_frames)

    ch, cw = creator[0].shape[:2]
    scale = OUT_H * height_frac / ch
    lw, lh = round(cw * scale), round(ch * scale)
    # Anchor = the creator's feet in frame-0 room coordinates.
    anchor = np.array([OUT_W * pos_x, OUT_H * 0.94, 1.0], np.float32)

    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        silent = Path(tmp) / "video.mp4"
        enc = subprocess.Popen(
            ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
             "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS), "-i", "-",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(silent)],
            stdin=subprocess.PIPE)
        for bg, layer, cam in zip(room_frames, creator, cams):
            frame = bg.copy()
            fx, fy = cam @ anchor
            zoom = float(np.sqrt(abs(np.linalg.det(cam[:, :2]))))
            w, h = round(lw * zoom), round(lh * zoom)
            person = match_colour(cv2.resize(layer, (w, h), interpolation=cv2.INTER_AREA), bg)
            add_shadow(frame, fx, fy, w)
            composite(frame, person, round(fx - w / 2), round(fy - h))
            label(frame, tag)
            enc.stdin.write(frame.tobytes())
        enc.stdin.close()
        enc.wait()

        # Audio: the creator's real clips, back to back.
        lst = Path(tmp) / "clips.txt"
        lst.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
        audio = Path(tmp) / "audio.m4a"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-vn", "-c:a", "aac", str(audio)], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(silent), "-i", str(audio),
                        "-c:v", "copy", "-c:a", "copy", "-shortest",
                        "-metadata", "comment=AI-assisted composite of real creator footage",
                        str(out)], check=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--creator", type=Path, required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--occasion", required=True)
    p.add_argument("--room", type=Path, required=True, help="fan's room video (or a still photo)")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--height", type=float, default=0.72, help="creator height as a fraction of the frame")
    p.add_argument("--x", type=float, default=0.5, help="horizontal position, 0 = left, 1 = right")
    args = p.parse_args()

    clips = pick_clips(args.creator, args.name, args.occasion)
    print("Using clips:", *[c.name for c in clips])
    render(clips, args.room, args.out, args.height, args.x, "AI-assisted")
    print("Wrote", args.out)


if __name__ == "__main__":
    main()
