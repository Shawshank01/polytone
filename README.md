# polytone

**AI Input Polisher & Tone Rewriter** (`polytone.user.js`) is a lightweight browser userscript that attaches a floating Shadow DOM toolbar to web input fields (`<input>`, `<textarea>`, and rich-text `contenteditable` editors such as X/Twitter, Facebook, and Mastodon). With one click or shortcut, it detects your input language, translates or fixes grammar, and rewrites the text in your chosen tone using your preferred AI API.

## Features

- **Multiple AI Providers**
  - **Cohere** (Native v2 API, default: `command-a-plus-05-2026`)
  - **Google Gemini** (Native API, default: `gemini-3.5-flash-lite`)
  - **OpenAI-Compatible** (OpenAI, DeepSeek, Ollama, etc., default: `gpt-6-luna`)
- **Tone Presets & Custom Persona**: Choose from *Native & Natural*, *Pedantic & Scholarly*, *Aloof & Minimalist*, *Street Slang*, *Dry & Sarcastic*, *Crisp Professional*, or define your own *Custom Persona* prompt.
- **Target Languages**: `English`, `日本語`, `简体中文`, `繁體中文`, `Español`, `Français`, `Deutsch`, `한국어`.
- **Keyboard Workflow**: Press `Option+J` (macOS) or `Alt+J` (Windows/Linux) to rewrite in place, click **↩** to undo back to the original text, or enable **Intercept Enter key** in settings to automatically polish and send on `Enter`.

## Installation

### Tampermonkey (Chrome, Edge, Firefox, Safari)

1. Install the **Tampermonkey** browser extension.
2. Click the direct install link: [https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js](https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js).
   Tampermonkey will detect the `.user.js` metadata and prompt you to click **Install** (and keep it updated via `@updateURL` / `@downloadURL`).
   - *Alternative*: Open the Tampermonkey Dashboard → **+** (Create a new script), replace the template with the contents of [`polytone.user.js`](./polytone.user.js), and save (`Cmd+S` / `Ctrl+S`).

### Userscripts (Safari on macOS / iOS)

1. Install the **Userscripts** app/extension for Safari and enable it in **Safari → Settings → Extensions** (granting access to websites).
2. Either:
   - Open [https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js](https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js) in Safari and click the Userscripts extension toolbar icon to install it, **or**
   - Save [`polytone.user.js`](./polytone.user.js) directly into the folder configured in the Userscripts extension settings.

## Usage

1. Click into any editable text box on a webpage — a compact floating toolbar appears near the input.
2. Click **⚙️** to open **AI Translation & Tone Settings**, select your **API Provider**, enter your **API Key** (and optionally customize the model or custom persona prompt), and click **Save Settings**. Settings are saved globally across sites.
3. Pick your target language and tone from the floating toolbar, type your text, and click **✨ Polish** (or press `Option+J` / `Alt+J`).
4. Click **↩** anytime before switching inputs to restore your original text.
