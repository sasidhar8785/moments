"""Insert a character into a real clip with Wan VACE (open weights, Apache-2.0).

How it works: the clip is resampled to the model's 16 fps and working size; the region where the
character should be (the placement box) is masked and greyed out; the model regenerates that
region with the character from the reference image, consistent with the rest of the scene; the
regenerated region is then blended back into the original full-resolution frames, so everything
outside the box stays exactly as filmed.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from . import clip
from .track import IDENTITY, follow_scene, rescale, warp_mask

MODEL_FPS = 16
DEFAULT_MODEL = "Wan-AI/Wan2.1-VACE-1.3B-diffusers"
NEGATIVE_PROMPT = (
    "blurry, distorted, deformed, disfigured, extra limbs, extra fingers, bad anatomy, floating, "
    "duplicate character, static, still picture, overexposed, low quality, watermark, subtitles, text"
)


@dataclass(frozen=True)
class Mode:
    """How the model is run: `fast` uses a 4-step distilled version of the 1.3B model."""

    steps: int
    guidance: float
    flow_shift: float
    lora: tuple[str, str] | None = None  # (Hugging Face repo, file)


# Self-Forcing (Apache-2.0) distilled into a LoRA for Wan2.1 1.3B: 4 steps, no classifier-free guidance.
FAST = Mode(steps=4, guidance=1.0, flow_shift=5.0, lora=(
    "Kijai/WanVideo_comfy", "LoRAs/Wan2_1_self_forcing_1_3B/Wan2_1_self_forcing_dmd_1_3B_lora_rank_32_fp16.safetensors"))
# The model as released: slower (about 12x the work), sometimes more detailed.
BEST = Mode(steps=25, guidance=5.0, flow_shift=3.0)


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
    """The character cut out of their photo (RGBA). The cut-out's shape is also where the model may paint."""
    if remove_background and image.mode != "RGBA":
        from rembg import remove  # optional dependency: momentsgen[cutout]

        image = remove(image.convert("RGB"))
    return image.convert("RGBA") if "A" in image.getbands() else image.convert("RGB")


def on_white(image: Image.Image) -> Image.Image:
    """The character on a plain white background, which is what VACE's reference input expects."""
    if "A" in image.getbands():
        white = Image.new("RGBA", image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(white, image.convert("RGBA"))
    return image.convert("RGB")


def character_mask(reference: Image.Image, placement: Placement, size: tuple[int, int], room: float = 0.12) -> np.ndarray:
    """Where the model may paint (uint8, 255 = paint), for a frame of `size` (w, h).

    With a cut-out reference, that is the character's own outline fitted into the placement (standing
    on its bottom edge), widened by `room` of the box size so they can move. Everything else in the
    box, like the furniture behind them, is kept from the real footage. Without a cut-out, the whole box.
    """
    w, h = size
    mask = np.zeros((h, w), np.uint8)
    if "A" not in reference.getbands():
        x0, y0, x1, y1 = placement.pixels(w, h, grow=0.08)
        mask[y0:y1, x0:x1] = 255
        return mask
    x0, y0, x1, y1 = placement.pixels(w, h)
    alpha = reference.getchannel("A")
    alpha = alpha.crop(alpha.getbbox() or (0, 0, *alpha.size))
    scale = min((x1 - x0) / alpha.width, (y1 - y0) / alpha.height)
    fw, fh = max(1, round(alpha.width * scale)), max(1, round(alpha.height * scale))
    fitted = np.asarray(alpha.resize((fw, fh), Image.BILINEAR)) > 127
    left, top = x0 + (x1 - x0 - fw) // 2, y1 - fh
    mask[top:top + fh, left:left + fw][fitted] = 255
    r = max(1, round(room * max(x1 - x0, y1 - y0)))
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))


def load_pipeline(model_id: str = DEFAULT_MODEL, device: str | None = None, dtype=None, mode: Mode = FAST):
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
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=mode.flow_shift)
    if mode.lora:
        if model_id != DEFAULT_MODEL:
            raise ValueError("Fast mode is made for the 1.3B model; use mode=BEST with other models.")
        repo, file = mode.lora
        pipe.load_lora_weights(repo, weight_name=file, adapter_name="fast")
        pipe.fuse_lora()
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
    on_step: Callable[[int, int], None] | None = None,
    follow_camera: bool = True,
) -> Path:
    """Write `out_path`: the clip with the character generated inside `placement`, original audio kept.

    `reference` should already be prepared (see `prepare_reference`). `size` overrides the model's
    working resolution (tests use a tiny one). `on_step(done, total)` is called after each denoising step.
    With `follow_camera`, the character stays at the same spot in the scene as the camera moves.
    """
    import torch

    full_w, full_h = clip.frame_size(clip_path)
    work_w, work_h = size or working_size(full_w, full_h)

    full = clip.read_frames(clip_path, MODEL_FPS, max_frames=round(max_seconds * MODEL_FPS) + 1)
    n = usable_frame_count(len(full), round(max_seconds * MODEL_FPS) + 1)
    full = full[:n]
    work = clip.read_frames(clip_path, MODEL_FPS, max_frames=n, size=(work_w, work_h))

    painted = character_mask(reference, placement, (work_w, work_h))
    track = _camera_motion(full, placement) if follow_camera else np.tile(IDENTITY, (n, 1, 1))
    masks, video = [], []
    for f, m in zip(work, track):
        frame_mask = np.where(warp_mask(painted, rescale(m, work_w / full_w, work_h / full_h)) > 127, 255, 0)
        frame_mask = frame_mask.astype(np.uint8)
        frame = f.copy()
        frame[frame_mask > 0] = 128  # VACE expects the region to fill as mid-grey
        masks.append(Image.fromarray(frame_mask))
        video.append(Image.fromarray(frame))

    def step_end(_pipe, i, _t, kwargs):
        if on_step:
            on_step(i + 1, steps)
        return kwargs

    result = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        video=video,
        mask=masks,
        reference_images=[on_white(reference)],
        height=work_h,
        width=work_w,
        num_frames=n,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=torch.Generator().manual_seed(seed),
        output_type="np",
        callback_on_step_end=step_end,
    ).frames[0]
    if not np.isfinite(result).all():
        raise FloatingPointError("The model produced invalid pixels (numerical overflow). Retry with float32.")

    generated = (np.clip(result, 0, 1) * 255).round().astype(np.uint8)
    composed = _blend_back(full, generated, character_mask(reference, placement, (full_w, full_h)), track)
    return clip.write_video(composed, MODEL_FPS, out_path, audio_from=clip_path)


def _camera_motion(full: np.ndarray, placement: Placement, long_side: int = 640) -> np.ndarray:
    """Per-frame scene motion in full-resolution pixels, tracked on frames at most `long_side` wide or tall."""
    h, w = full.shape[1:3]
    k = min(1.0, long_side / max(w, h))
    small = full if k == 1.0 else np.stack([cv2.resize(f, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
                                            for f in full])
    sh, sw = small.shape[1:3]
    motion = follow_scene(small, exclude=placement.pixels(sw, sh, grow=0.08))
    return np.stack([rescale(m, w / sw, h / sh) for m in motion])


def _blend_back(full: np.ndarray, generated: np.ndarray, painted: np.ndarray, motion: list[np.ndarray]) -> np.ndarray:
    """Keep the original pixels outside the painted region (moving with the camera); use the generated ones inside, with a soft edge."""
    n, h, w, _ = full.shape
    feather = max(2, round(0.02 * max(w, h)))
    # Shrink by the feather width so the soft edge stays inside the region the model painted.
    core = cv2.erode(painted, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * feather + 1, 2 * feather + 1)))
    out = np.empty_like(full)
    for i in range(n):
        alpha = cv2.GaussianBlur(warp_mask(core, motion[i]), (0, 0), feather / 2).astype(np.float32)[:, :, None] / 255
        up = cv2.resize(generated[i], (w, h), interpolation=cv2.INTER_LANCZOS4)
        out[i] = (full[i] * (1 - alpha) + up * alpha).round().astype(np.uint8)
    return out
