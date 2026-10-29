# Moments

Fans pay $4.99 for a personal moment from a creator, appearing in the fan's own room.
Built from the creator's **real recorded clips**: a fan-typed name only selects a clip the
creator recorded, and occasions are limited to the creator's approved list.

## Layout

| Path | What it is |
|---|---|
| `render.py` | Render pipeline: cut out creator → track fan's camera → colour match + shadow → label + audio |
| `make_test_assets.py` | Placeholder test media (NASA portrait + synthetic room); replace with real clips |
| `creators/<id>/` | One creator: `creator.json`, `names/*.mp4`, `names/_generic.mp4`, `occasions/*.mp4` |
| `web/` | Pre-order page (`index.html`) and after-payment upload page (`thanks.html`) |
| `docs/creator-kit.md` | Outreach message, interview script, recording guide, consent checklist |

## Run

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install "rembg[cpu]" opencv-python-headless scikit-image
python make_test_assets.py
python render.py --creator creators/demo --name Priya --occasion birthday --room samples/room.mp4 --out out/priya_birthday.mp4
```

The creator cut-out runs once per clip and is cached in `.cache/`; later renders reuse it.

## Pilot setup (no backend needed)

1. Create a Stripe Payment Link for $4.99 with custom fields "First name" (text) and "Occasion" (dropdown),
   and set its after-payment redirect to `thanks.html`. Put the link in `web/index.html`.
2. Create a Google Form or Tally form with a file upload for the room video; put its link in `web/thanks.html`.
3. Host `web/` on any static host (GitHub Pages, Netlify, Cloudflare Pages).
4. For each order, run `render.py` and email the video back.
