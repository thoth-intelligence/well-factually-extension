# Run Live Fact-Check Sidebar locally with LM Studio

This guide gets you running the Live Fact-Check Sidebar without an Anthropic API key. The model runs on your own computer, captions never leave your machine, and there's no per-hour cost after the one-time download.

Setup takes about 10 minutes and a ~7 GB model download.

## Before you start

You'll need a reasonably modern computer. The recommended model (Gemma 3, 12 B parameters) is on the heavier side:

- **macOS** — Apple Silicon (M1 / M2 / M3 / M4) with **16 GB unified memory or more**. Older Intel Macs are not supported.
- **Windows / Linux** — 16 GB RAM and a discrete GPU with **at least 8 GB VRAM** (NVIDIA RTX 3060 or better is a comfortable floor). CPU-only works but will be slow.
- **Disk** — about **10 GB free** for LM Studio plus the model.

If you have an 8 GB machine, swap the recommended model for **Gemma 3, 4 B** at step 3 below. It fits in half the memory and runs faster, at a small accuracy cost.

## 1. Install LM Studio

LM Studio is a free desktop app that runs language models on your computer.

1. Open **https://lmstudio.ai/** in your browser.
2. Click **Download** — the site auto-detects your OS.
3. Open the downloaded installer and follow the prompts. On macOS, drag **LM Studio.app** into your **Applications** folder. On Windows, run the installer.
4. Launch LM Studio. The first launch may take a few seconds.

## 2. Download the model

1. In LM Studio, click the **Discover** icon in the left sidebar (it looks like a magnifying glass).
2. In the search bar, type `gemma 3 12b instruct`.
3. Find the result labeled **`lmstudio-community/gemma-3-12b-it-GGUF`** (or a similarly named GGUF build from `google/`).
4. From the **quantization** dropdown on the right, pick **`Q4_K_M`** — it's the best size/quality trade-off (~7 GB).
5. Click **Download**. Expect 10–30 minutes depending on your connection. You'll see progress at the bottom of the window.

> **Lower-memory option:** if you're on an 8 GB Mac or have less than 8 GB VRAM, search for `gemma 3 4b instruct` and download the **Q4_K_M** build instead — about 2.5 GB, comfortable on most laptops.

## 3. Start the local server

LM Studio can act as a local API server that the extension talks to over HTTP. It doesn't run by default — you turn it on once.

1. Click the **Developer** icon in the left sidebar (a chevron / `</>` symbol).
2. At the top of the panel, click **Select a model to load** and pick the Gemma 3 model you just downloaded. Wait for it to finish loading (you'll see "Model loaded" once it's ready — usually 5–20 seconds).
3. Flip the **Status: Running** toggle (top right of the Developer panel) so it shows green.
4. Confirm the server address. It should read **`http://127.0.0.1:1234`**. Keep that window open — closing LM Studio stops the server.

If you see "Port 1234 already in use," click the gear icon on the Developer panel and change the port to something free (e.g., 1235). You'll need to put the same address into the extension in the next step.

## 4. Point the extension at LM Studio

1. Right-click the **Live Fact-Check Sidebar** icon in your Chrome toolbar and choose **Options**. (If you don't see the icon, click the puzzle-piece icon and pin it.)
2. Under **Backend**, choose **LM Studio (local — free, runs on your computer)**.
3. **Endpoint** — leave as **`http://127.0.0.1:1234`** unless you changed the port in step 3.
4. **Model** — type **`gemma-3-12b-it`** (or `gemma-3-4b-it` if you went with the smaller one).
5. Click **Save**.

## 5. Try it

1. Open any YouTube video at `youtube.com/watch?v=…`.
2. Turn on **CC** using the captions button on the YouTube player.
3. **Reload the tab** (⌘R on macOS, Ctrl+R on Windows). The sidebar appears on the right.
4. Play the video. After ~18 seconds of caption activity, fact-flag cards begin to stream in.

The status line at the top of the sidebar should read **"receiving captions · t=00:18"** while it's working. If it says **"⚠ no API key"** in the mode tag, the extension is still set to the Anthropic backend — recheck step 4.

## Troubleshooting

**The sidebar says "ERROR · HTTP request failed" or similar.**
LM Studio's server isn't reachable. Make sure LM Studio is running, the Developer panel toggle is green, and the model is loaded. If you changed the port, double-check the extension's Endpoint field matches.

**Cards show up but the text is garbled or the model rambles.**
You're probably on the 4 B model under a noisy/multi-speaker video. Try the 12 B model if your hardware can handle it. Failing that, switch the extension's **Mode** to **Fact-flag** (the default) — it has the tightest format guard.

**The Mac fan is screaming.**
Expected during heavy use — running a 12 B model is a lot. Quit LM Studio when you're done watching, or switch to the 4 B model.

**"No CC available for this video."**
The extension only sees YouTube's caption track. If the video has no captions (auto-generated or manual), there's nothing to fact-check. Try a different video.

**Service-worker errors after Chrome updates.**
Open `chrome://extensions`, find **Live Fact-Check Sidebar**, and click the circular **reload** icon on its card. Then reload your YouTube tab.

## What's actually happening, in one paragraph

The extension reads YouTube's live caption track from the page DOM, batches lines into ~60-second sliding windows, and POSTs each window to your local LM Studio server. LM Studio runs Gemma on your CPU/GPU and returns a short fact-flag or a "skip" decision. The extension renders cards in the sidebar. Nothing leaves your computer.
