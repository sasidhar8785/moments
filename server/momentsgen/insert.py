"""Insert a character into a real clip with Wan VACE (open weights, Apache-2.0).

How it works: the clip is resampled to the model's 16 fps and working size; the region where the
character should be (the placement box) is masked and greyed out; the model regenerates that
region with the character from the reference image, consistent with the rest of the scene; the
regenerated region is then blended back into the original full-resolution frames, so everything
outside the box stays exactly as filmed.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from . import clip

MODEL_FPS = 16
DEFAULT_MODEL = "Wan-AI/Wan2.1-VACE-1.3B-diffusers"
NEGATIVE_PROMPT = (
    "blurry, distorted, deformed, disfigured, extra limbs, extra fingers, bad anatomy, floating, "
    "duplicate character, static, still picture, overexposed, low quality, watermark, subtitles, text"
)


@dataclass(frozen=True)
class Placement:
    """Where the character goes, as a box in 0..1 frame coordinates (left, top, width, height)."""

    left: float
    top: float
    width: float
    height: float

    def pixels(self, w: int, h: int, grow: float = 0.0) -> tuple[int, int, int, int]:
        """(x0, y0, x1, y1) in pixels, grown by `grow` of the box size on every side, clipped to the frame."""
        gx, gy = self.width * grow, self.height * grow
        x0 = max(0, round((self.left - gx) * w))
        y0 = max(0, round((self.top - gy) * h))
        x1 = min(w, round((self.left + self.width + gx) * w))
        y1 = min(h, round((self.top + self.height + gy) * h))
        return x0, y0, x1, y1


def working_size(width: int, height: int, long_side: int = 832, short_side: int = 480) -> tuple[int, int]:
    """The model's working resolution (w, h), matching the clip's orientation. 480p is what the 1.3B model is trained for."""
    return (short_side, long_side) if height >= width else (long_side, short_side)


def usable_frame_count(available: int, limit: int) -> int:
    """Wan needs 4k+1 frames. The largest such count within both limits (at least 5)."""
    n = min(available, limit)
    if n < 5:
        raise ValueError(f"The clip is too short: {available} frames at {MODEL_FPS} fps, need at least 5.")
    return (n - 1) // 4 * 4 + 1


def prepare_reference(image: Image.Image, remove_background: bool = True) -> Image.Image:
    """The character on a plain white background, which is what VACE's reference input expects."""
    if remove_background and image.mode != "RGBA":
        from rembg import remove  # optional dependency: momentsgen[cutout]

        image = remove(image.convert("RGB"))
    if image.mode == "RGBA":
        white = Image.new("RGBA", image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(white, image)
    return image.convert("RGB")


def load_pipeline(model_id: str = DEFAULT_MODEL, device: str | None = None, dtype=None):
    """Load Wan VACE on the best available device: CUDA (Colab, rented GPU), Apple MPS, else CPU."""
    import torch
    from diffusers import AutoencoderKLWan, UniPCMultistepScheduler, WanVACEPipeline

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    if dtype is None:
        if device == "cuda":
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        else:
            dtype = torch.bfloat16 if device == "mps" else torch.float32
    vae = AutoencoderKLWan.from_pretrained(model_id, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanVACEPipeline.from_pretrained(model_id, vae=vae, torch_dtype=dtype)
    # flow_shift 3.0 is the recommended setting for 480p.
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=3.0)
    if device == "cuda":
        pipe.enable_model_cpu_offload()  # keeps a 16 GB card (free Colab T4) within memory
    else:
        pipe.to(device)
    return pipe


def insert_character(
    pipe,
    clip_path: Path,
    reference: Image.Image,
    placement: Placement,
    prompt: str,
    out_path: Path,
    *,
    max_seconds: float = 5.0,
    steps: int = 30,
    guidance: float = 5.0,
    seed: int = 0,
    size: tuple[int, int] | None = None,
) -> Path:
    """Write `out_path`: the clip with the character generated inside `placement`, original audio kept.

    `reference` should already be prepared (see `prepare_reference`). `size` overrides the model's
    working resolution (tests use a tiny one).
    """
    import torch

    full_w, full_h = clip.frame_size(clip_path)
    work_w, work_h = size or working_size(full_w, full_h)

    full = clip.read_frames(clip_path, MODEL_FPS, max_frames=round(max_seconds * MODEL_FPS) + 1)
    n = usable_frame_count(len(full), round(max_seconds * MODEL_FPS) + 1)
    full = full[:n]
    work = clip.read_frames(clip_path, MODEL_FPS, max_frames=n, size=(work_w, work_h))

    x0, y0, x1, y1 = placement.pixels(work_w, work_h, grow=0.08)
    mask = Image.new("L", (work_w, work_h), 0)
    mask.paste(255, (x0, y0, x1, y1))
    video = []
    for f in work:
        frame = Image.fromarray(f)
        frame.paste((128, 128, 128), (x0, y0, x1, y1))  # VACE expects the region to fill as mid-grey
        video.append(frame)

    result = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        video=video,
        mask=[mask] * n,
        reference_images=[reference],
        height=work_h,
        width=work_w,
        num_frames=n,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=torch.Generator().manual_seed(seed),
        output_type="np",
    ).frames[0]
    if not np.isfinite(result).all():
        raise FloatingPointError("The model produced invalid pixels (numerical overflow). Retry with float32.")

    generated = (np.clip(result, 0, 1) * 255).round().astype(np.uint8)
    composed = _blend_back(full, generated, placement)
    return clip.write_video(composed, MODEL_FPS, out_path, audio_from=clip_path)


def _blend_back(full: np.ndarray, generated: np.ndarray, placement: Placement) -> np.ndarray:
    """Keep the original pixels outside the placement box; use the generated ones inside, with a soft edge."""
    n, h, w, _ = full.shape
    x0, y0, x1, y1 = placement.pixels(w, h, grow=0.08)
    feather = max(2, round(0.02 * max(w, h)))
    m = Image.new("L", (w, h), 0)
    # Shrink the hard box by the feather width so the blur stays inside the masked region.
    m.paste(255, (x0 + feather, y0 + feather, max(x0 + feather, x1 - feather), max(y0 + feather, y1 - feather)))
    alpha = np.asarray(m.filter(ImageFilter.GaussianBlur(feather / 2)), np.float32)[None, :, :, None] / 255
    up = np.stack([np.asarray(Image.fromarray(g).resize((w, h), Image.LANCZOS)) for g in generated])
    return (full * (1 - alpha) + up * alpha).round().astype(np.uint8)
