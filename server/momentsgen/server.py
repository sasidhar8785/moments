"""HTTP API the Moments app talks to. Run it on the computer with the GPU (an Apple Silicon Mac works):

    moments-server            # listens on port 8000 on your local network

Jobs run one at a time on a background thread (one GPU). Everything is kept under MOMENTS_DATA
(default ~/MomentsData): each job's clip, character image, status and result.
"""

import json
import os
import queue
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image

from .insert import Placement

CHARACTERS_DIR = Path(__file__).resolve().parent / "characters"

# generate(clip, reference_image, placement, prompt, out_path, on_progress) -> None
Generator = Callable[[Path, Image.Image, Placement, str, Path, Callable[[float], None]], None]


@dataclass
class Job:
    id: str
    character: str
    direction: str
    placement: dict
    status: str = "queued"  # queued | running | done | failed
    progress: float = 0.0
    error: str | None = None
    created: float = field(default_factory=time.time)

    def public(self) -> dict:
        data = asdict(self)
        data["result_url"] = f"/jobs/{self.id}/result" if self.status == "done" else None
        return data


def load_characters(folder: Path = CHARACTERS_DIR) -> dict[str, dict]:
    """Characters shipped with the server: <id>/character.json plus <id>/image.png."""
    found = {}
    for meta in sorted(folder.glob("*/character.json")):
        info = json.loads(meta.read_text())
        found[meta.parent.name] = {"id": meta.parent.name, **info, "image": meta.parent / "image.png"}
    return found


def build_prompt(character: dict, direction: str) -> str:
    """What the video model is asked to show: who the character is, then what they do."""
    what = direction.strip() or character.get("default_action", "reacts to the person filming")
    return (f"{character['description']} {what}. Photorealistic, the character is physically part of the scene, "
            f"lit by the room's light, with natural contact shadows and correct scale.")


def create_app(generate: Generator, data_dir: Path | None = None, characters: dict | None = None) -> FastAPI:
    data_dir = Path(data_dir or os.environ.get("MOMENTS_DATA", Path.home() / "MomentsData"))
    jobs_dir = data_dir / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    characters = load_characters() if characters is None else characters

    app = FastAPI(title="Moments")
    jobs: dict[str, Job] = {}
    work: "queue.Queue[str]" = queue.Queue()
    lock = threading.Lock()

    def save(job: Job) -> None:
        (jobs_dir / job.id / "job.json").write_text(json.dumps(asdict(job)))

    # Pick up earlier jobs after a restart; unfinished ones failed with the old process.
    for path in jobs_dir.glob("*/job.json"):
        job = Job(**json.loads(path.read_text()))
        if job.status in ("queued", "running"):
            job.status, job.error = "failed", "The server restarted before this finished."
            save(job)
        jobs[job.id] = job

    def worker() -> None:
        while True:
            job_id = work.get()
            job = jobs[job_id]
            folder = jobs_dir / job_id

            def progress(p: float) -> None:
                with lock:
                    job.progress = round(min(max(p, 0.0), 1.0), 3)

            try:
                with lock:
                    job.status = "running"
                save(job)
                reference = Image.open(folder / "character.png")
                prompt = build_prompt(job_character(job), job.direction)
                generate(folder / "input.mp4", reference, Placement(**job.placement), prompt,
                         folder / "result.mp4", progress)
                with lock:
                    job.status, job.progress = "done", 1.0
            except Exception as e:  # report any failure to the app instead of dying
                with lock:
                    job.status, job.error = "failed", f"{type(e).__name__}: {e}"
            save(job)

    def job_character(job: Job) -> dict:
        if job.character in characters:
            return characters[job.character]
        return {"description": "The character from the reference image."}

    threading.Thread(target=worker, daemon=True).start()

    @app.get("/health")
    def health():
        return {"ok": True, "queued": work.qsize()}

    @app.get("/characters")
    def list_characters():
        return [{"id": c["id"], "name": c["name"], "tagline": c.get("tagline", ""),
                 "default_action": c.get("default_action", ""),
                 "image_url": f"/characters/{c['id']}/image"} for c in characters.values()]

    @app.get("/characters/{character_id}/image")
    def character_image(character_id: str):
        if character_id not in characters:
            raise HTTPException(404, "Unknown character")
        return FileResponse(characters[character_id]["image"], media_type="image/png")

    @app.post("/jobs", status_code=201)
    def create_job(
        video: UploadFile = File(...),
        placement: str = Form(..., description='JSON: {"left", "top", "width", "height"} in 0..1'),
        character_id: str | None = Form(None),
        character_image: UploadFile | None = File(None),
        direction: str = Form(""),
    ):
        try:
            box = json.loads(placement)
            box = {k: float(box[k]) for k in ("left", "top", "width", "height")}
        except (ValueError, KeyError, TypeError):
            raise HTTPException(422, "placement must be JSON with left, top, width and height")
        if not (0 <= box["left"] < 1 and 0 <= box["top"] < 1 and 0 < box["width"] <= 1 and 0 < box["height"] <= 1):
            raise HTTPException(422, "placement values must be fractions of the frame (0 to 1)")
        if character_image is None and character_id not in characters:
            raise HTTPException(404, "Unknown character: pick one from /characters or upload character_image")

        job = Job(id=uuid.uuid4().hex[:12], character=character_id or "custom", direction=direction, placement=box)
        folder = jobs_dir / job.id
        folder.mkdir()
        with open(folder / "input.mp4", "wb") as f:
            shutil.copyfileobj(video.file, f)
        if character_image is not None:
            from .insert import prepare_reference

            prepare_reference(Image.open(character_image.file)).save(folder / "character.png")
        else:
            Image.open(characters[character_id]["image"]).convert("RGB").save(folder / "character.png")
        jobs[job.id] = job
        save(job)
        work.put(job.id)
        return job.public()

    @app.get("/jobs")
    def list_jobs():
        return [j.public() for j in sorted(jobs.values(), key=lambda j: j.created, reverse=True)]

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str):
        if job_id not in jobs:
            raise HTTPException(404, "Unknown job")
        with lock:
            return jobs[job_id].public()

    @app.get("/jobs/{job_id}/result")
    def get_result(job_id: str):
        job = jobs.get(job_id)
        if job is None or job.status != "done":
            raise HTTPException(404, "No result yet")
        return FileResponse(jobs_dir / job_id / "result.mp4", media_type="video/mp4", filename=f"moment-{job_id}.mp4")

    return app


def vace_generator(model_id: str | None = None, steps: int = 25, seconds: float = 5.0) -> Generator:
    """The real generator: Wan VACE, loaded once on first use."""
    from .insert import DEFAULT_MODEL, insert_character, load_pipeline

    pipe = None

    def generate(clip_path, reference, placement, prompt, out_path, on_progress):
        nonlocal pipe
        if pipe is None:
            pipe = load_pipeline(model_id or DEFAULT_MODEL)
        insert_character(pipe, clip_path, reference, placement, prompt, out_path,
                         max_seconds=seconds, steps=steps, on_step=lambda done, total: on_progress(done / total))

    return generate


def main() -> None:
    import argparse

    # Apple GPUs (MPS) lack a few operations; let PyTorch run those on the CPU instead of failing.
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    import uvicorn

    p = argparse.ArgumentParser(description="Run the Moments generation server.")
    p.add_argument("--host", default="0.0.0.0", help="0.0.0.0 lets phones on your Wi-Fi reach it")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--model", default=None, help="Hugging Face model id (default: Wan2.1 VACE 1.3B)")
    p.add_argument("--steps", type=int, default=25)
    p.add_argument("--seconds", type=float, default=5.0, help="longest part of a clip to use")
    args = p.parse_args()
    app = create_app(vace_generator(args.model, args.steps, args.seconds))
    uvicorn.run(app, host=args.host, port=args.port)
