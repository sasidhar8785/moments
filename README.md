# Moments

Film a real scene, and a character joins it: they're generated into your footage, standing on
your table, reacting to what you do. Inspired by Simulon's "Reality-Aware Rendering".

Everything runs on open-source models on your own computer; no paid AI services.

```
 iPad / iPhone / Android app ──(Wi-Fi)──▶ Moments server on your Mac ──▶ Wan VACE video model
  film + place + direct                    jobs, progress, results         (open weights)
```

| Folder | What it is |
|---|---|
| `mobile/` | The app: one Expo / React Native codebase for iOS and Android. See `mobile/README.md`. |
| `server/` | The generation server and the `momentsgen` library. See `server/README.md`. |
| `notebooks/quality_test.ipynb` | Free quality test on Google Colab's GPU with your own clip ([open in Colab](https://colab.research.google.com/github/sasidhar8785/moments/blob/main/notebooks/quality_test.ipynb)). |
| `.claude/skills/` | Agent skills used when working on this repo. |

## Getting started

1. **Judge the quality first:** run the Colab notebook above on a clip of your own.
2. **Server on your Mac:** `server/README.md`.
3. **App on your iPad:** `mobile/README.md`.

## Status

- Generation: Wan2.1 VACE 1.3B by default (the 14B model is better but needs far more memory).
  The character is generated inside the box you place; the rest of the shot is untouched.
- Not yet: characters speaking (voice and lip-sync), reactions written from what you say,
  AR stand-in tracking while filming, a hosted server for use away from home.

## Earlier prototypes

`web/` (web AR page), `render.py`, `prep_ar.py`, `creators/` and `docs/creator-kit.md` are from
the first exploration (live AR compositing and a creator-video pilot). They are not used by the
app.
