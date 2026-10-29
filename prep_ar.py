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

from render import FPS, matte_clip

WEB = Path(__file__).parent / "web" / "ar" / "creators"
MAX_H = 960  # height of the colour half; total frame is twice this


def load_rgba(src: Path) -> list[np.ndarray]:
    if src.is_dir():
        return [cv2.imread(str(p), cv2.IMREAD_UNCHANGED) for p in sorted(src.glob("*.png"))]
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
    rgba = {k: load_rgba(v) for k, v in sources.items()}

    # One shared crop box (union of every clip), padded so nothing touches the edge.
    alpha = np.max([f[:, :, 3] for frames in rgba.values() for f in frames], axis=0)
    ys, xs = np.where(alpha > 10)
    pad = 8
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, alpha.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, alpha.shape[1])
    scale = min(1.0, MAX_H / (y1 - y0))
    w, h = int((x1 - x0) * scale) // 2 * 2, int((y1 - y0) * scale) // 2 * 2

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
        "aspect": w / h,
        "names": names,
        "occasions": meta["occasions"],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("wrote", out_dir / "manifest.json")


if __name__ == "__main__":
    main()
