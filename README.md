# polytone

**AI Input Polisher & Tone Rewriter** (`polytone.user.js`) is a lightweight browser userscript that attaches a floating Shadow DOM toolbar to web input fields (`<input>`, `<textarea>`, and rich-text `contenteditable` editors such as X/Twitter, Facebook, and Mastodon). With one click or shortcut, it detects your input language, translates or fixes grammar, and rewrites the text in your chosen tone using your preferred AI API.

## Features

- **Multiple AI Providers**
  - **Cohere** (Native v2 API, default: `command-a-plus-05-2026`)
  - **Google Gemini** (Native API, default: `gemini-3.5-flash-lite`)
  - **OpenAI-Compatible** (OpenAI, DeepSeek, Ollama, etc., default: `gpt-6-luna`)
- **Tone Presets & Custom Persona**: Choose from *Native & Natural*, *Pedantic & Scholarly*, *Aloof & Minimalist*, *Street Slang*, *Dry & Sarcastic*, *Crisp Professional*, or define your own *Custom Persona* prompt.
- **Target Languages**: `English`, `日本語`, `简体中文`, `繁體中文`, `Español`, `Français`, `Deutsch`, `한국어`.
- **Keyboard Workflow**: Press `Option+J` (macOS) or `Alt+J` (Windows/Linux) to rewrite in place. Enable **Polish with Enter** if you also want `Enter` to send the draft to your AI provider for polishing. With the option off, `Enter` works as usual on the site.

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

1. Click into a supported text field or rich-text editor. A floating toolbar appears near the editor.
2. Click **⚙️** to open **AI Translation & Tone Settings**. Choose a provider, enter an API key if your provider requires one, and click **Save Settings**. When your userscript manager provides private storage, settings are saved across sites. Otherwise they last until you reload or close the page.
3. Pick your target language and tone from the floating toolbar, type your text, and click **✨ Polish** (or press `Option+J` / `Alt+J`).
4. Review the polished text and use the site's Send or Submit control when ready. Click Polytone's **Undo & Restore Original** button to restore the original text before making any further edits. The browser's native undo history may omit rich-text rewrites.

For an OpenAI-compatible server, enter the full HTTP or HTTPS base URL and select a model served at that endpoint. Leave the API key blank if the server accepts unauthenticated requests.

Polishing sends the current field's text to the configured provider. Open settings on a page you trust when entering an API key. If you used an earlier version without private userscript storage, the site may still have a copy of the settings in its local storage under `ai_rewriter_cfg`.
