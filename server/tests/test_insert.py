"""insert_character, run end to end with a tiny randomly initialised Wan VACE (the same dummy
components diffusers uses in its own tests). The model draws noise, so these tests check what must
hold whatever it draws: output shape, audio, and that nothing outside the placement is touched."""

import subprocess
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from momentsgen import Placement, insert_character
from momentsgen import clip

torch = pytest.importorskip("torch")
diffusers = pytest.importorskip("diffusers")


@pytest.fixture(scope="module")
def tiny_pipe():
    from diffusers import AutoencoderKLWan, FlowMatchEulerDiscreteScheduler, WanVACEPipeline, WanVACETransformer3DModel
    from transformers import AutoConfig, AutoTokenizer, T5EncoderModel

    torch.manual_seed(0)
    vae = AutoencoderKLWan(base_dim=3, z_dim=16, dim_mult=[1, 1, 1, 1], num_res_blocks=1,
                           temperal_downsample=[False, True, True])
    text_encoder = T5EncoderModel(AutoConfig.from_pretrained("hf-internal-testing/tiny-random-t5")).eval()
    tokenizer = AutoTokenizer.from_pretrained("hf-internal-testing/tiny-random-t5")
    transformer = WanVACETransformer3DModel(
        patch_size=(1, 2, 2), num_attention_heads=2, attention_head_dim=12, in_channels=16, out_channels=16,
        text_dim=32, freq_dim=256, ffn_dim=32, num_layers=3, cross_attn_norm=True,
        qk_norm="rms_norm_across_heads", rope_max_seq_len=32, vace_layers=[0, 2], vace_in_channels=96,
    )
    return WanVACEPipeline(transformer=transformer, vae=vae, scheduler=FlowMatchEulerDiscreteScheduler(shift=7.0),
                           text_encoder=text_encoder, tokenizer=tokenizer, transformer_2=None)


def make_clip(path: Path, seconds: float, w: int = 96, h: int = 160) -> Path:
    """A portrait test clip (moving test pattern) with a tone on the audio track."""
    subprocess.run([clip.FFMPEG, "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate=30:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10", "-c:a", "aac", "-shortest", str(path)],
                   check=True)
    return path


BOX = Placement(left=0.5, top=0.4, width=0.4, height=0.5)
REFERENCE = Image.new("RGB", (40, 60), (200, 30, 30))


def run(pipe, src: Path, out: Path, seconds: float = 1.1) -> Path:
    return insert_character(pipe, src, REFERENCE, BOX, "a small red figure waves", out,
                            max_seconds=seconds, steps=2, size=(32, 32))


def test_result_keeps_the_clips_size_and_audio(tiny_pipe, tmp_path):
    out = run(tiny_pipe, make_clip(tmp_path / "in.mp4", 2.0), tmp_path / "out.mp4")

    assert clip.frame_size(out) == (96, 160)
    assert len(clip.read_frames(out, 16)) == 17  # 1.1 s at 16 fps, rounded down to 4k+1 frames
    assert clip.has_audio(out)


def test_nothing_outside_the_placement_changes(tiny_pipe, tmp_path):
    src = make_clip(tmp_path / "in.mp4", 2.0)
    out = run(tiny_pipe, src, tmp_path / "out.mp4")

    before = clip.read_frames(src, 16, max_frames=17).astype(int)
    after = clip.read_frames(out, 16).astype(int)
    x0, y0, x1, y1 = BOX.pixels(96, 160, grow=0.08)
    outside = np.ones((160, 96), bool)
    outside[max(0, y0 - 3):y1 + 3, max(0, x0 - 3):x1 + 3] = False  # allow for codec bleed at the box edge
    inside = ~outside

    assert np.abs(after - before)[:, outside].mean() < 3       # only re-encoding noise
    assert np.abs(after - before)[:, inside].mean() > 10       # the model really painted the box


def test_with_a_cut_out_character_only_their_outline_is_painted(tiny_pipe, tmp_path):
    # A thin upright figure: the model may paint its outline (plus room to move), not the whole box.
    figure = Image.new("RGBA", (40, 120), (0, 0, 0, 0))
    figure.paste((200, 30, 30, 255), (14, 0, 26, 120))
    src = make_clip(tmp_path / "in.mp4", 2.0)
    out = insert_character(tiny_pipe, src, figure, BOX, "a thin red figure waves", tmp_path / "out.mp4",
                           max_seconds=1.1, steps=2, size=(32, 32))

    before = clip.read_frames(src, 16, max_frames=17).astype(int)
    after = clip.read_frames(out, 16).astype(int)
    x0, y0, x1, y1 = BOX.pixels(96, 160)
    corner = (slice(y0, y0 + 12), slice(x0, x0 + 6))   # inside the box, well away from the figure
    figure_middle = (slice((y0 + y1) // 2 - 6, (y0 + y1) // 2 + 6), slice((x0 + x1) // 2 - 2, (x0 + x1) // 2 + 2))

    assert np.abs(after - before)[:, corner[0], corner[1]].mean() < 3
    assert np.abs(after - before)[:, figure_middle[0], figure_middle[1]].mean() > 10


def test_a_clip_shorter_than_five_model_frames_is_rejected(tiny_pipe, tmp_path):
    with pytest.raises(ValueError, match="too short"):
        run(tiny_pipe, make_clip(tmp_path / "in.mp4", 0.2), tmp_path / "out.mp4", seconds=0.2)


def test_progress_is_reported_after_every_step(tiny_pipe, tmp_path):
    steps = []
    insert_character(tiny_pipe, make_clip(tmp_path / "in.mp4", 2.0), REFERENCE, BOX, "waves", tmp_path / "out.mp4",
                     max_seconds=1.1, steps=3, size=(32, 32), on_step=lambda done, total: steps.append((done, total)))

    assert steps == [(1, 3), (2, 3), (3, 3)]
