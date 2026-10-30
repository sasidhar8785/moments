# Moments server

Puts the chosen character into the clips the app uploads, using the open-source **Wan VACE**
video model. It runs on your own computer: an Apple Silicon Mac with 32 GB+ memory, or any
machine with an NVIDIA GPU. The iPad/iPhone/Android app connects to it over your Wi-Fi.

## Set up on a Mac (once)

```bash
xcode-select --install          # command-line tools, if not already installed
brew install python@3.12        # needs Homebrew: https://brew.sh
git clone https://github.com/sasidhar8785/moments
cd moments/server
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[model,cutout,server]"
```

## Run

```bash
cd moments/server && source .venv/bin/activate
moments-server
```

The first generation downloads the model (about 19 GB). Leave the Terminal window open while
using the app.

In the app, enter the server address: `http://<your Mac's IP>:8000`. Find the IP in
**System Settings → Wi-Fi → Details… → IP address** (for example `192.168.1.20`). The iPad and
the Mac must be on the same Wi-Fi. If macOS asks whether Python may accept incoming network
connections, choose **Allow**.

Options: `moments-server --seconds 3` (shorter clips generate faster), `--steps 20` (faster,
rougher), `--model Wan-AI/Wan2.1-VACE-14B-diffusers` (better, needs far more memory and time).

## Develop

```bash
pip install -e ".[model,server,test]"
pytest
```

API: `GET /characters`, `POST /jobs` (multipart: `video`, `placement` JSON, `character_id` or
`character_image`, optional `direction`), `GET /jobs/{id}` (status, progress), `GET /jobs/{id}/result`.
