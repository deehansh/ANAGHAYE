# ANAGHAYE AI

One Platform. Endless Possibilities.

## Included tools
- AI Chat, AI Writing Studio, Translator and Coding Assistant (Cloudflare Workers AI backend)
- AI Image Studio (Cloudflare Workers AI image model; returns JPEG)
- PDF Assistant: extracts selectable PDF text in the browser with PDF.js, then sends extracted text for AI summarization
- Text-to-Speech using voices available in the visitor’s browser/device (not cloud voice generation)
- Video Studio creates a script, storyboard and shot prompts only; it does not render video
- Browser utilities: word counter, case converter, text cleaner, text reverser, word frequency, percentage, age and BMI calculators, resume builder, SEO helper, caption helper and prompt builder

## Deploy on GitHub Pages
1. Upload all files in this folder to the root of the `ANAGHAYE` repository.
2. Open repository **Settings → Pages**.
3. Choose **Deploy from a branch**, select `main` and `/(root)`, then Save.
4. Wait for GitHub Pages to publish the site.

## Backend
The frontend is configured to use the deployed Cloudflare Worker at https://anaghaye-ai-api.anaghaye-ai.workers.dev. The Worker currently supports `/health`, `/api/chat`, `/api/write`, `/api/translate`, `/api/summarize`, `/api/code`, and `/api/image`.

The backend has a shared daily quota of 20 requests per IP. Do not put private API keys in this public repository.

## Honest feature status
- PDF upload itself is not sent to the backend; the browser extracts selectable text first. Scanned/image-only PDFs need OCR, which is not included.
- Voice uses browser speech synthesis. Available voices depend on the visitor’s device and browser.
- Video Studio produces text scripts/storyboards, not rendered video files.
- There are no user accounts, payment processing, saved history or cloud file storage.
- Verify all tools on the live site before sharing it publicly.
