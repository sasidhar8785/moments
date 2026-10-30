"""Reading and writing video with the ffmpeg binary that imageio-ffmpeg ships (works on Colab,
macOS and Linux without a system ffmpeg). Phone rotation metadata is applied on decode."""

import io
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def _run(args: list[str], stdin: bytes | None = None) -> bytes:
    proc = subprocess.run([FFMPEG, "-loglevel", "error", *args], input=stdin, capture_output=True)
    if proc.returncode:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout


def frame_size(path: Path) -> tuple[int, int]:
    """(width, height) of the clip as it is meant to be shown (after rotation)."""
    png = _run(["-i", str(path), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"])
    return Image.open(io.BytesIO(png)).size


def read_frames(path: Path, fps: float, max_frames: int | None = None,
                size: tuple[int, int] | None = None) -> np.ndarray:
    """Decode to an (n, h, w, 3) uint8 array at `fps`, optionally scaled to `size` (w, h)."""
    w, h = size or frame_size(path)
    filters = f"fps={fps},scale={w}:{h}:flags=lanczos"
    args = ["-i", str(path), "-vf", filters, "-f", "rawvideo", "-pix_fmt", "rgb24"]
    if max_frames:
        args += ["-frames:v", str(max_frames)]
    raw = _run([*args, "-"])
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def has_audio(path: Path) -> bool:
    proc = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True)
    return b"Audio:" in proc.stderr


def write_video(frames: np.ndarray, fps: float, out: Path, audio_from: Path | None = None) -> Path:
    """Encode (n, h, w, 3) uint8 frames as H.264, taking the audio track from `audio_from` if it has one."""
    out.parent.mkdir(parents=True, exist_ok=True)
    n, h, w, _ = frames.shape
    args = ["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-"]
    if audio_from is not None and has_audio(audio_from):
        args += ["-i", str(audio_from), "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-t", f"{n / fps:.3f}"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", str(out)]
    _run(args, stdin=np.ascontiguousarray(frames).tobytes())
    return out
