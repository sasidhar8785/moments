"""Convert a creator's clips into "stacked alpha" videos for the web AR page.

Each output frame holds the colour image in the top half and the cut-out mask in the
bottom half, so a plain H.264 MP4 carries transparency and plays on every browser.
All of a creator's clips share one crop box, so the creator stays the same size and
position when the page switches from the name clip to the occasion clip.

Input clips are either videos (the creator is cut out with rembg, cached) or folders
of transparent PNG frames.

Usage:
    python prep_ar.py creators/robot --height-m 1.2
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from render import FPS, matte_clip, read_frames

WEB = Path(__file__).parent / "web" / "ar" / "creators"
MAX_H = 960  # height of the colour half; total frame is twice this


def chroma_key(frame: np.ndarray) -> np.ndarray:
    """Green-screen key with spill suppression. Returns BGRA."""
    f = frame.astype(np.float32) / 255
    b, g, r = f[:, :, 0], f[:, :, 1], f[:, :, 2]
    spill = g - np.maximum(r, b)
    alpha = 1 - np.clip((spill - 0.06) / (0.22 - 0.06), 0, 1)
    # Clean the matte: drop specks, then soften the edge by a pixel.
    a8 = (alpha * 255).astype(np.uint8)
    a8 = cv2.morphologyEx(a8, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    a8 = cv2.erode(a8, np.ones((2, 2), np.uint8))
    a8 = cv2.GaussianBlur(a8, (3, 3), 0)
    # Keep only the biggest blob (the person), so stray marks on the screen vanish.
    n, labels, stats, _ = cv2.connectedComponentsWithStats((a8 > 128).astype(np.uint8))
    if n > 1:
        keep = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        body = cv2.dilate((labels == keep).astype(np.uint8), np.ones((9, 9), np.uint8))
        a8 = a8 * body
    # Despill: green may not exceed the brighter of red and blue.
    g = np.minimum(g, np.maximum(r, b) + 0.02)
    out = (np.dstack([b, g, r]) * 255).clip(0, 255).astype(np.uint8)
    return np.dstack([out, a8])


def load_rgba(src: Path, keying: str) -> list[np.ndarray]:
    if src.is_dir():
        return [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in sorted(src.glob("*.png"))]
    if keying == "green":
        return [chroma_key(f) for f in read_frames(src)]
    return matte_clip(src)


def find_clips(creator: Path) -> dict[str, Path]:
    """Map 'names/priya' -> source (video file or PNG folder)."""
    clips = {}
    for group in ("names", "occasions"):
        for p in sorted((creator / group).iterdir()):
            if p.is_dir() or p.suffix.lower() in {".mp4", ".mov", ".webm"}:
                clips[f"{group}/{p.stem}"] = p
    return clips


def encode(frames: list[np.ndarray], audio_src: Path | None, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    h, w = frames[0].shape[:2]
    dur = len(frames) / FPS
    audio = (["-i", str(audio_src)] if audio_src and audio_src.is_file()
             else ["-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={dur}"])
    enc = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
         "-r", str(FPS), "-i", "-", *audio, "-map", "0:v", "-map", "1:a?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-profile:v", "main",
         "-c:a", "aac", "-t", f"{dur:.3f}", "-movflags", "+faststart", str(out)],
        stdin=subprocess.PIPE)
    for f in frames:
        enc.stdin.write(f.tobytes())
    enc.stdin.close()
    if enc.wait():
        raise SystemExit(f"ffmpeg failed for {out}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("creator", type=Path)
    p.add_argument("--height-m", type=float, default=1.7, help="creator's real height in metres")
    args = p.parse_args()

    meta = json.loads((args.creator / "creator.json").read_text())
    sources = find_clips(args.creator)
    rgba = {k: load_rgba(v, meta.get("keying", "ai")) for k, v in sources.items()}

    # One shared crop box (union of every clip), padded so nothing touches the edge.
    alpha = np.max([f[:, :, 3] for frames in rgba.values() for f in frames], axis=0)
    ys, xs = np.where(alpha > 10)
    pad = 8
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, alpha.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, alpha.shape[1])
    scale = min(1.0, MAX_H / (y1 - y0))
    w, h = int((x1 - x0) * scale) // 2 * 2, int((y1 - y0) * scale) // 2 * 2

    # Where the person stands across the frame: centre of the lowest quarter (legs), which
    # outstretched arms don't move. The page centres this over the floor marker.
    legs = np.concatenate([f[y1 - (y1 - y0) // 4:y1, x0:x1, 3] for frames in rgba.values() for f in frames[::6]])
    cols = (legs > 128).sum(axis=0).astype(np.float64)
    anchor_x = float((cols * np.arange(len(cols))).sum() / max(cols.sum(), 1) / len(cols))

    out_dir = WEB / args.creator.name
    for key, frames in rgba.items():
        stacked = []
        for f in frames:
            crop = cv2.resize(f[y0:y1, x0:x1], (w, h), interpolation=cv2.INTER_AREA)
            a = crop[:, :, 3:4].astype(np.float32) / 255
            colour = (crop[:, :, :3] * a).astype(np.uint8)  # premultiplied: no halo from the old background
            mask = cv2.cvtColor(crop[:, :, 3], cv2.COLOR_GRAY2BGR)
            stacked.append(np.vstack([colour, mask]))
        src = sources[key]
        encode(stacked, src if src.is_file() else None, out_dir / f"{key}.mp4")
        print("wrote", out_dir / f"{key}.mp4", len(stacked), "frames")

    names = sorted(k.split("/")[1] for k in sources if k.startswith("names/") and not k.endswith("/_generic"))
    manifest = {
        "display_name": meta["display_name"],
        "height_m": args.height_m,
        # Clips framed above the feet float this high, fading out into the hologram base.
        "base_m": meta.get("base_m", 0.0),
        "aspect": w / h,
        "anchor_x": round(anchor_x, 4),
        "names": names,
        "occasions": meta["occasions"],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("wrote", out_dir / "manifest.json")


if __name__ == "__main__":
    main()
