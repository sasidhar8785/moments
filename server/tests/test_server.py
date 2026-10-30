"""The HTTP API, with a stand-in generator in place of the video model (the model's own
behaviour is covered by test_insert.py)."""

import json
import shutil
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from momentsgen.server import build_prompt, create_app

BOX = json.dumps({"left": 0.3, "top": 0.2, "width": 0.4, "height": 0.6})


def copy_generator(seen: list):
    """Stand-in for the model: records what it was asked and returns the input clip as the result."""
    def generate(clip_path, reference, placement, prompt, out_path, on_progress):
        seen.append({"placement": placement, "prompt": prompt, "reference_size": reference.size})
        on_progress(0.5)
        shutil.copy(clip_path, out_path)
    return generate


def failing_generator(clip_path, reference, placement, prompt, out_path, on_progress):
    raise RuntimeError("out of memory")


@pytest.fixture
def characters(tmp_path):
    folder = tmp_path / "chars" / "nigel"
    folder.mkdir(parents=True)
    Image.new("RGB", (300, 400), "white").save(folder / "image.png")
    return {"nigel": {"id": "nigel", "name": "Nigel", "description": "A grumpy little man in a tweed suit.",
                      "image": folder / "image.png"}}


def client_for(generator, tmp_path, characters):
    return TestClient(create_app(generator, data_dir=tmp_path / "data", characters=characters))


def wait_for(client, job_id, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] in ("done", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def post_job(client, **form):
    files = {"video": ("take.mp4", b"fake-mp4-bytes", "video/mp4")}
    if "character_image" in form:
        files["character_image"] = ("me.png", form.pop("character_image"), "image/png")
    return client.post("/jobs", data={"placement": BOX, **form}, files=files)


def test_a_job_runs_and_its_result_can_be_downloaded(tmp_path, characters):
    seen = []
    client = client_for(copy_generator(seen), tmp_path, characters)

    created = post_job(client, character_id="nigel", direction="complains about the paint work")
    job = wait_for(client, created.json()["id"])

    assert created.status_code == 201
    assert job["status"] == "done" and job["progress"] == 1.0
    result = client.get(job["result_url"])
    assert result.status_code == 200 and result.content == b"fake-mp4-bytes"
    assert seen[0]["placement"].left == 0.3
    assert "tweed suit" in seen[0]["prompt"] and "complains about the paint work" in seen[0]["prompt"]


def test_a_failed_generation_is_reported_not_lost(tmp_path, characters):
    client = client_for(failing_generator, tmp_path, characters)

    job = wait_for(client, post_job(client, character_id="nigel").json()["id"])

    assert job["status"] == "failed" and "out of memory" in job["error"]
    assert client.get(f"/jobs/{job['id']}/result").status_code == 404


def test_an_uploaded_photo_can_be_the_character(tmp_path, characters):
    seen = []
    client = client_for(copy_generator(seen), tmp_path, characters)
    png = tmp_path / "me.png"
    Image.new("RGBA", (320, 480), (0, 0, 0, 0)).save(png)  # already cut out, so no background removal

    job = wait_for(client, post_job(client, character_image=png.read_bytes()).json()["id"])

    assert job["status"] == "done" and seen[0]["reference_size"] == (320, 480)


@pytest.mark.parametrize("placement", ['{"left": 0.3}', '{"left": 2, "top": 0, "width": 1, "height": 1}', "not json"])
def test_a_bad_placement_is_refused(tmp_path, characters, placement):
    client = client_for(copy_generator([]), tmp_path, characters)

    response = client.post("/jobs", data={"placement": placement, "character_id": "nigel"},
                           files={"video": ("take.mp4", b"x", "video/mp4")})

    assert response.status_code == 422


def test_an_unknown_character_is_refused(tmp_path, characters):
    client = client_for(copy_generator([]), tmp_path, characters)

    assert post_job(client, character_id="nobody").status_code == 404


def test_characters_are_listed_with_their_images(tmp_path, characters):
    client = client_for(copy_generator([]), tmp_path, characters)

    listed = client.get("/characters").json()

    assert [c["name"] for c in listed] == ["Nigel"]
    assert client.get(listed[0]["image_url"]).headers["content-type"] == "image/png"


def test_jobs_survive_a_server_restart(tmp_path, characters):
    first = client_for(copy_generator([]), tmp_path, characters)
    job = wait_for(first, post_job(first, character_id="nigel").json()["id"])

    second = client_for(copy_generator([]), tmp_path, characters)

    assert second.get(f"/jobs/{job['id']}").json()["status"] == "done"
    assert second.get(job["result_url"]).status_code == 200


def test_prompt_falls_back_to_the_characters_default_action():
    prompt = build_prompt({"description": "A tiny knight.", "default_action": "waves hello"}, "  ")

    assert prompt.startswith("A tiny knight. waves hello.")
