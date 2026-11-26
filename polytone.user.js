// ==UserScript==
// @name         AI Input Polisher & Tone Rewriter
// @namespace    https://github.com/Shawshank01/polytone
// @homepageURL  https://github.com/Shawshank01/polytone
// @supportURL   https://github.com/Shawshank01/polytone/issues
// @updateURL    https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js
// @downloadURL  https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js
// @version      0.1.5
// @description  A lightweight script for browsers that translates, fixes grammar, and rewrites text in any web input box with customisable tones with AI APIs.
// @match        *://*/*
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @connect      generativelanguage.googleapis.com
// @connect      api.openai.com
// @connect      api.cohere.com
// @connect      *
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  // Avoid duplicate mounting in ad iframes or tiny frames
  if (window.top !== window.self && window.innerWidth < 300) return;

  // ==================== Default Config & Tone Presets ====================
  const DEFAULT_CONFIG = {
    provider: 'cohere', // 'cohere' | 'gemini' | 'openai'
    cohereApiKey: '',
    cohereModel: 'command-a-plus-05-2026',
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-6-luna',
    targetLang: 'English',
    activeTone: 'natural',
    customTonePrompt: '',
    interceptEnter: false
  };

  const TONE_PRESETS = {
    natural: {
      name: 'Native & Natural',
      instruction: 'Fix all grammar/spelling errors and rewrite so it sounds completely natural, idiomatic, and effortless, like an educated native speaker.'
    },
    pedantic: {
      name: 'Pedantic & Scholarly',
      instruction: 'Fix grammar and rewrite in an overly pedantic, hyper-academic, erudite tone. Use precise, formal vocabulary, complex subordinate clauses, and scholarly nuance.'
    },
    aloof: {
      name: 'Aloof & Minimalist',
      instruction: 'Fix grammar and rewrite in an aloof, detached, minimalist, and coolly unbothered tone. Keep it concise, understated, and devoid of excessive enthusiasm or exclamation marks.'
    },
    slang: {
      name: 'Street Slang',
      instruction: 'Fix grammar errors while rewriting with authentic, current native street slang, casual contractions, and colloquialisms used in everyday online chat.'
    },
    sarcastic: {
      name: 'Dry & Sarcastic',
      instruction: 'Fix grammar and rewrite with sharp wit, dry irony, and subtle biting sarcasm while keeping the underlying core message intact.'
    },
    professional: {
      name: 'Crisp Professional',
      instruction: 'Fix grammar and rewrite in a polished, crisp, executive workplace tone that is polite, clear, and assertive without sounding robotic.'
    },
    custom: {
      name: 'Custom Persona',
      instruction: ''
    }
  };

  const TARGET_LANGUAGES = [
    'English',
    '日本語',
    '简体中文',
    '繁體中文',
    'Español',
    'Français',
    'Deutsch',
    '한국어'
  ];

  // ==================== Cross-Extension Storage Wrapper ====================
  const CONFIG_KEY = 'ai_rewriter_cfg';
  let canPersistConfig =
    typeof GM !== 'undefined' && typeof GM.getValue === 'function' && typeof GM.setValue === 'function';

  async function loadConfig() {
    if (!canPersistConfig) return { ...DEFAULT_CONFIG };
    let raw;
    try {
      raw = await GM.getValue(CONFIG_KEY, null);
    } catch {
      // Preserve existing settings if the extension cannot read them.
      canPersistConfig = false;
      return { ...DEFAULT_CONFIG };
    }
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const loaded = { ...DEFAULT_CONFIG, ...parsed };
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        if (typeof loaded[key] !== typeof value) loaded[key] = value;
      }
      if (!['cohere', 'gemini', 'openai'].includes(loaded.provider)) loaded.provider = DEFAULT_CONFIG.provider;
      if (!TARGET_LANGUAGES.includes(loaded.targetLang)) loaded.targetLang = DEFAULT_CONFIG.targetLang;
      if (!Object.prototype.hasOwnProperty.call(TONE_PRESETS, loaded.activeTone)) {
        loaded.activeTone = DEFAULT_CONFIG.activeTone;
      }
      return loaded;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  let pendingSave = Promise.resolve();

  function saveConfig(cfg) {
    if (!canPersistConfig) return Promise.resolve();
    const serialized = JSON.stringify(cfg);
    const saved = pendingSave.then(() => GM.setValue(CONFIG_KEY, serialized));
    pendingSave = saved.catch(() => { });
    return saved;
  }

  // ==================== Cross-Origin HTTP Request Wrapper ====================
  async function crossOriginPost(url, headers, bodyObj) {
    const payload = JSON.stringify(bodyObj);
    if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
      const res = await new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
          method: 'POST',
          url,
          headers,
          data: payload,
          responseType: 'text',
          timeout: 30000,
          onerror: () => reject(new Error('Network request failed')),
          ontimeout: () => reject(new Error('API request timed out (30s)')),
          onabort: () => reject(new Error('API request was canceled'))
        }).then(resolve, reject);
      });
      return parseResponse(res.status, res.responseText);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal
      });
      return parseResponse(res.status, await res.text());
    } catch (err) {
      if (controller.signal.aborted) throw new Error('API request timed out (30s)');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function parseResponse(status, body) {
    if (status < 200 || status >= 300) {
      throw new Error(`HTTP ${status}: ${(body || '').slice(0, 200)}`);
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error('API returned invalid JSON');
    }
  }

  // ==================== Prompt Builder & LLM Invocation ====================
  function buildSystemPrompt(cfg) {
    const toneObj = TONE_PRESETS[cfg.activeTone];
    const toneInstruction =
      cfg.activeTone === 'custom' && cfg.customTonePrompt.trim()
        ? cfg.customTonePrompt.trim()
        : toneObj.instruction || TONE_PRESETS.natural.instruction;

    return [
      'You are an expert multilingual translator, copyeditor, and tone stylist.',
      `Task: Detect the language of the user's input text, translate it into ${cfg.targetLang} (or rewrite it if it is already in ${cfg.targetLang}), repair all grammatical/typographical issues, and adapt the style strictly according to the requested tone.`,
      `Tone requirement: ${toneInstruction}`,
      'Strict rules:',
      '1. Output ONLY the final transformed text.',
      '2. Do NOT include explanations, alternatives, notes, quotation marks wrapping the output, or markdown code blocks.',
      '3. Preserve line breaks, @mentions, #hashtags, URLs, and emojis naturally.'
    ].join('\n');
  }

  function requireText(result, provider, truncated) {
    if (truncated) throw new Error(`${provider} response was cut off`);
    if (typeof result !== 'string' || !result.trim()) {
      throw new Error(`${provider} did not return valid text`);
    }
    return result.trim();
  }

  async function callProviderAPI(systemPrompt, userText, cfg) {
    if (cfg.provider === 'cohere') {
      if (!cfg.cohereApiKey.trim()) {
        throw new Error('Please click the gear icon to enter your Cohere API Key first');
      }
      const url = 'https://api.cohere.com/v2/chat';
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.cohereApiKey.trim()}`
      };
      const body = {
        model: cfg.cohereModel.trim() || DEFAULT_CONFIG.cohereModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ]
      };

      const data = await crossOriginPost(url, headers, body);
      const contentBlocks = data?.message?.content;
      const result = Array.isArray(contentBlocks)
        ? contentBlocks
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
        : typeof contentBlocks === 'string'
          ? contentBlocks
          : '';
      return requireText(result, 'Cohere', ['MAX_TOKENS', 'max_tokens'].includes(data?.finish_reason));
    } else if (cfg.provider === 'gemini') {
      if (!cfg.geminiApiKey.trim()) {
        throw new Error('Please click the gear icon to enter your Gemini API Key first');
      }
      const model = encodeURIComponent((cfg.geminiModel.trim() || DEFAULT_CONFIG.geminiModel).replace(/^models\//, ''));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': cfg.geminiApiKey.trim()
      };
      const body = {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }]
          }
        ]
      };

      const data = await crossOriginPost(url, headers, body);
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts;
      const result = Array.isArray(parts)
        ? parts.filter((part) => !part?.thought && typeof part?.text === 'string').map((part) => part.text).join('')
        : '';
      return requireText(result, 'Gemini', candidate?.finishReason === 'MAX_TOKENS');
    } else {
      let url;
      try {
        url = new URL(cfg.openaiBaseUrl.trim() || DEFAULT_CONFIG.openaiBaseUrl);
      } catch {
        throw new Error('Please enter a full HTTP or HTTPS API Base URL');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Please enter a full HTTP or HTTPS API Base URL');
      }
      const apiKey = cfg.openaiApiKey.trim();
      if (url.hostname === 'api.openai.com' && !apiKey) {
        throw new Error('Please click the gear icon to enter your OpenAI API Key first');
      }
      const path = url.pathname.replace(/\/+$/, '');
      url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const body = {
        model: cfg.openaiModel.trim() || DEFAULT_CONFIG.openaiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ]
      };

      const data = await crossOriginPost(url.href, headers, body);
      const choice = data?.choices?.[0];
      return requireText(choice?.message?.content, 'OpenAI-compatible API', choice?.finish_reason === 'length');
    }
  }

  // ==================== Input Reading & Framework-Compatible Writing ====================
  const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url'];
  const LEXICAL_EDITOR_SELECTOR = '[data-lexical-editor="true"]';
  const DRAFT_EDITOR_SELECTOR = '.public-DraftEditor-content, [data-testid^="tweetTextarea_"]';

  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return !el.matches(':disabled') && !el.readOnly;
    if (el.tagName === 'INPUT') {
      return TEXT_INPUT_TYPES.includes(el.type) && !el.matches(':disabled') && !el.readOnly;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getEditor(el) {
    if (!isEditableElement(el)) return null;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el;
    while (el.isContentEditable && el.parentElement?.isContentEditable) el = el.parentElement;
    return el;
  }

  function getFocusedEditor() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return getEditor(el);
  }

  function getElementText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    if (el.matches(LEXICAL_EDITOR_SELECTOR) && el.children.length) {
      // Read each block so browser-generated paragraph separators do not become draft text.
      return Array.from(el.children, (block) => {
        if (block.childNodes.length === 1 && block.firstChild.nodeName === 'BR') return '';
        return block.innerText ?? block.textContent ?? '';
      }).join('\n');
    }
    if (el.closest(DRAFT_EDITOR_SELECTOR)) {
      const blocks = el.querySelectorAll(':scope > [data-contents="true"] [data-block="true"]');
      if (blocks.length) {
        // Read Draft.js blocks directly to exclude line breaks added for rendering.
        return Array.from(blocks, (block) => {
          const text = block.textContent;
          return text === '\n' ? '' : text.replace(/\n\n$/, '\n');
        }).join('\n');
      }
    }
    return el.innerText ?? el.textContent ?? '';
  }

  async function replaceManagedEditorText(el, newText, expectedText, usePaste) {
    const selection = window.getSelection();
    if (!selection) return false;
    const previousRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', newText);

    const eventOptions = { bubbles: true, cancelable: true, composed: true };
    const replacement = usePaste
      ? new ClipboardEvent('paste', { ...eventOptions, clipboardData: dataTransfer })
      : new InputEvent('beforeinput', {
        ...eventOptions,
        inputType: 'insertReplacementText',
        data: newText, // WebKit may omit dataTransfer on a synthetic InputEvent.
        dataTransfer
      });

    selection.selectAllChildren(el);
    if (usePaste) {
      // Draft.js applies a paste to its cached selection, so sync it before dispatching.
      el.ownerDocument.dispatchEvent(new Event('selectionchange'));
      if (getFocusedEditor() !== el || getElementText(el) !== expectedText) return false;
    }
    el.dispatchEvent(replacement);
    await Promise.resolve(); // The editor can commit the edit in a microtask.

    if (getElementText(el) !== expectedText) return true;
    if (getFocusedEditor() === el) {
      selection.removeAllRanges();
      if (previousRange) selection.addRange(previousRange);
    }
    throw new Error('The editor did not accept the replacement');
  }

  async function setElementText(el, newText, expectedText) {
    if (getFocusedEditor() !== el) {
      el.focus();
      if (getFocusedEditor() !== el) return false;
    }
    // Focus handlers can change the draft synchronously.
    if (getElementText(el) !== expectedText) return false;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, newText);
      } else {
        el.value = newText;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const isLexical = el.matches(LEXICAL_EDITOR_SELECTOR);
    if (isLexical || el.closest(DRAFT_EDITOR_SELECTOR)) {
      return replaceManagedEditorText(el, newText, expectedText, !isLexical);
    }

    el.innerText = newText;
    window.getSelection()?.collapse(el, el.childNodes.length);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: newText
    }));
    return true;
  }

  // ==================== Shadow DOM Floating Pill & Settings Modal ====================
  let config = await loadConfig();
  let activeInput = null;
  let lastRewrite = null;
  let processingInput = null;
  let composingInput = null;

  const host = document.createElement('div');
  host.id = 'ai-tone-rewriter-host';
  const shadow = host.attachShadow({ mode: 'closed' });

  const SHADOW_CSS = `
    :host {
      all: initial;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
    .pill {
      position: fixed;
      display: none;
      align-items: center;
      flex-wrap: wrap;
      max-width: calc(100vw - 16px);
      gap: 4px;
      padding: 4px 6px;
      background: rgba(24, 24, 27, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 999px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
      font-size: 12px;
      pointer-events: auto;
      user-select: none;
      touch-action: none;
    }
    .pill.visible { display: flex; }
    .pill.dragging {
      cursor: grabbing;
    }
    .drag-handle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #71717a;
      font-size: 13px;
      line-height: 1;
      padding: 2px 2px 2px 4px;
      cursor: grab;
      touch-action: none;
    }
    .drag-handle:hover {
      color: #d4d4d8;
    }
    .pill.dragging .drag-handle {
      cursor: grabbing;
    }
    .pill select, .pill button {
      background: transparent;
      color: #f4f4f5;
      border: none;
      outline: none;
      font-size: 12px;
      cursor: pointer;
      border-radius: 999px;
      padding: 3px 6px;
    }
    .pill select:hover, .pill button:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .pill select { max-width: 100%; }
    .pill :focus-visible, .modal-actions :focus-visible {
      outline: 2px solid #93c5fd;
      outline-offset: 2px;
    }
    .pill select option {
      background: #18181b;
      color: #f4f4f5;
    }
    .btn-run {
      background: #3b82f6 !important;
      color: #fff !important;
      font-weight: 600;
      padding: 3px 10px !important;
    }
    .btn-run:hover { background: #2563eb !important; }
    .btn-run:disabled { opacity: 0.6; cursor: wait; }
    .undo-icon {
      display: inline-block;
      transform: scaleY(-1);
    }
    .divider {
      width: 1px;
      height: 14px;
      background: rgba(255, 255, 255, 0.16);
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #18181b;
      color: #fff;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.15);
      font-size: 13px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      pointer-events: auto;
      display: none;
      max-width: min(340px, calc(100vw - 48px));
      line-height: 1.4;
      overflow-wrap: anywhere;
      z-index: 1;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      display: none;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      background: #18181b;
      color: #f4f4f5;
      width: 420px;
      max-width: 92vw;
      max-height: 92vh;
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.14);
      padding: 18px 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
    .modal fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
    .field { margin-bottom: 11px; }
    .field label { display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px; }
    .field input, .field select, .field textarea, .btn-key {
      width: 100%;
      background: #27272a;
      color: #f4f4f5;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      padding: 7px 10px;
      font-size: 13px;
      outline: none;
    }
    .field input:focus, .field select:focus, .field textarea:focus {
      border-color: #3b82f6;
    }
    .btn-key { text-align: left; cursor: pointer; }
    .btn-key:hover, .btn-key:focus-visible { border-color: #3b82f6; }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #d4d4d8;
      margin-top: 6px;
      cursor: pointer;
    }
    .checkbox-row input { width: auto; }
    .test-status {
      margin-top: 10px;
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
      display: none;
    }
    .test-status.success { display: block; color: #4ade80; }
    .test-status.error { display: block; color: #f87171; }
    .test-status.info { display: block; color: #a1a1aa; }
    .modal-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
    .modal-actions button {
      padding: 7px 14px;
      border-radius: 8px;
      border: none;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-test {
      background: #27272a;
      color: #e4e4e7;
      border: 1px solid #3f3f46;
      margin-right: auto;
    }
    .btn-test:hover { background: #3f3f46; }
    .btn-test:disabled { opacity: 0.6; cursor: wait; }
    .btn-cancel { background: #27272a; color: #e4e4e7; }
    .btn-save { background: #3b82f6; color: #fff; font-weight: 600; }
  `;

  shadow.innerHTML = `
    <div class="pill" id="pill">
      <span class="drag-handle" id="drag-handle" title="Drag to move (double-click to reset)">⠿</span>
      <select id="quick-lang" title="Target Language"></select>
      <div class="divider"></div>
      <select id="quick-tone" title="Preset Tone"></select>
      <button class="btn-run" id="btn-run" title="Transform & Polish (Option+J / Alt+J)">✨ Polish</button>
      <button id="btn-undo" title="Undo & Restore Original" aria-label="Undo & Restore Original"><span class="undo-icon" aria-hidden="true">↩︎</span></button>
      <button id="btn-settings" title="API & Advanced Settings">⚙️</button>
    </div>

    <div class="toast" id="toast" role="status"></div>

    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h3 id="settings-title">AI Translation & Tone Settings</h3>
        <fieldset id="settings-fields">
          <div class="field">
            <label for="cfg-provider">API Provider</label>
            <select id="cfg-provider">
              <option value="cohere">Cohere API (Native v2)</option>
              <option value="gemini">Google Gemini API (Native)</option>
              <option value="openai">OpenAI-Compatible API (OpenAI / DeepSeek / Ollama)</option>
            </select>
          </div>

          <div id="cohere-fields">
            <div class="field">
              <label for="cfg-cohere-key">Cohere API Key</label>
              <button class="btn-key" type="button" id="cfg-cohere-key" data-config-key="cohereApiKey">Enter API key</button>
            </div>
            <div class="field">
              <label for="cfg-cohere-model">Cohere Model</label>
              <input type="text" id="cfg-cohere-model" placeholder="${DEFAULT_CONFIG.cohereModel}" />
            </div>
          </div>

          <div id="gemini-fields">
            <div class="field">
              <label for="cfg-gemini-key">Gemini API Key</label>
              <button class="btn-key" type="button" id="cfg-gemini-key" data-config-key="geminiApiKey">Enter API key</button>
            </div>
            <div class="field">
              <label for="cfg-gemini-model">Gemini Model</label>
              <input type="text" id="cfg-gemini-model" placeholder="${DEFAULT_CONFIG.geminiModel}" />
            </div>
          </div>

          <div id="openai-fields">
            <div class="field">
              <label for="cfg-openai-url">OpenAI-Compatible Base URL</label>
              <input type="text" id="cfg-openai-url" placeholder="${DEFAULT_CONFIG.openaiBaseUrl}" />
            </div>
            <div class="field">
              <label for="cfg-openai-key">API Key (if required by your server)</label>
              <button class="btn-key" type="button" id="cfg-openai-key" data-config-key="openaiApiKey">Enter API key</button>
            </div>
            <div class="field">
              <label for="cfg-openai-model">Model Name</label>
              <input type="text" id="cfg-openai-model" placeholder="${DEFAULT_CONFIG.openaiModel}" />
            </div>
          </div>

          <div class="field">
            <label for="cfg-custom-prompt">Custom Persona Prompt (active when "Custom Persona" is selected)</label>
            <textarea id="cfg-custom-prompt" rows="2" placeholder="e.g., Reply in the voice of a Victorian aristocrat with a touch of refined arrogance."></textarea>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" id="cfg-intercept-enter" />
            <span>Polish with Enter</span>
          </label>

          <div class="test-status" id="test-status" role="status"></div>

          <div class="modal-actions">
            <button class="btn-test" id="btn-test" type="button">Test API</button>
            <button class="btn-cancel" id="btn-cancel" type="button">Cancel</button>
            <button class="btn-save" id="btn-save" type="button">Save Settings</button>
          </div>
        </fieldset>
      </div>
    </div>
  `;

  // Use Constructable Stylesheets so strict CSP style-src sites (e.g. Mastodon) allow Shadow DOM styling
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SHADOW_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const styleEl = document.createElement('style');
    styleEl.textContent = SHADOW_CSS;
    shadow.appendChild(styleEl);
  }
  document.documentElement.appendChild(host);

  const pill = shadow.getElementById('pill');
  const dragHandle = shadow.getElementById('drag-handle');
  const quickLang = shadow.getElementById('quick-lang');
  const quickTone = shadow.getElementById('quick-tone');
  const btnRun = shadow.getElementById('btn-run');
  const btnUndo = shadow.getElementById('btn-undo');
  const btnSettings = shadow.getElementById('btn-settings');
  const toastEl = shadow.getElementById('toast');
  const modalBackdrop = shadow.getElementById('modal-backdrop');

  btnUndo.style.display = 'none';

  // Initialise dropdown options
  TARGET_LANGUAGES.forEach((lang) => {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    quickLang.appendChild(opt);
  });

  Object.entries(TONE_PRESETS).forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.name;
    quickTone.appendChild(opt);
  });
  quickLang.value = config.targetLang;
  quickTone.value = config.activeTone;

  let toastTimer;
  function showToast(msg, duration = 3200) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.display = 'none';
    }, duration);
  }

  let focusCheckTimer = null;
  let positionFrame = null;
  let isInteractingWithPill = false;
  let customPillPos = null;

  function hidePill() {
    if (composingInput === activeInput) composingInput = null;
    activeInput = null;
    isInteractingWithPill = false;
    pill.classList.remove('visible');
  }

  function isCurrentEditor(el) {
    return el && el === activeInput && el.isConnected && isEditableElement(el) &&
      !modalBackdrop.classList.contains('open') &&
      (getFocusedEditor() === el || document.activeElement === host);
  }

  function scheduleFocusCheck() {
    clearTimeout(focusCheckTimer);
    focusCheckTimer = setTimeout(() => {
      if (modalBackdrop.classList.contains('open') || isInteractingWithPill) return;
      if (!isCurrentEditor(activeInput)) {
        hidePill();
      }
    }, 0);
  }

  function updatePillPosition() {
    if (!activeInput) return;
    if (!activeInput.isConnected || !isEditableElement(activeInput)) {
      hidePill();
      return;
    }
    const rect = activeInput.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      pill.classList.remove('visible');
      return;
    }
    pill.classList.add('visible');
    const pillRect = pill.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - pillRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - pillRect.height - 8);

    let top;
    let left;
    if (customPillPos) {
      left = Math.min(maxLeft, Math.max(8, customPillPos.left));
      top = Math.min(maxTop, Math.max(8, customPillPos.top));
    } else {
      top = rect.top - pillRect.height - 6;
      if (top < 8) {
        const below = rect.bottom + 6;
        top = below + pillRect.height <= window.innerHeight - 8 ? below : 8;
      }
      top = Math.min(maxTop, top);
      left = Math.min(maxLeft, Math.max(8, rect.right - pillRect.width));
    }

    pill.style.top = `${top}px`;
    pill.style.left = `${left}px`;
  }

  function schedulePositionUpdate() {
    if (!activeInput || positionFrame !== null) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      updatePillPosition();
    });
  }

  // Prevent clicking/dragging floating toolbar from blurring the active input
  pill.addEventListener('mousedown', (e) => {
    if (e.target !== quickLang && e.target !== quickTone) {
      e.preventDefault();
    }
  });

  // Dragging support via drag handle or non-control pill area
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.isPrimary || pill.classList.contains('dragging')) return;
    if (e.target.closest('button, select, option')) return;

    const pillRect = pill.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const originLeft = pillRect.left;
    const originTop = pillRect.top;
    let moved = false;

    pill.classList.add('dragging');

    const onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== e.pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;

      const currentRect = pill.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - currentRect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - currentRect.height - 8);
      const nextLeft = Math.min(maxLeft, Math.max(8, originLeft + dx));
      const nextTop = Math.min(maxTop, Math.max(8, originTop + dy));

      customPillPos = { left: nextLeft, top: nextTop };
      pill.style.left = `${nextLeft}px`;
      pill.style.top = `${nextTop}px`;
    };

    const stopDragging = (endEvent) => {
      if (endEvent.pointerId !== e.pointerId) return;
      pill.classList.remove('dragging');
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', stopDragging, true);
      window.removeEventListener('pointercancel', stopDragging, true);
    };

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', stopDragging, true);
    window.addEventListener('pointercancel', stopDragging, true);
  });

  dragHandle.addEventListener('dblclick', () => {
    customPillPos = null;
    updatePillPosition();
  });

  function saveQuickSetting(key, value) {
    isInteractingWithPill = false;
    config = { ...config, [key]: value };
    if (activeInput?.isConnected && isEditableElement(activeInput)) activeInput.focus();
    updatePillPosition();
    saveConfig(config).catch(() => showToast('Could not save settings. This change applies to this tab.'));
  }

  quickLang.addEventListener('change', () => saveQuickSetting('targetLang', quickLang.value));
  quickTone.addEventListener('change', () => saveQuickSetting('activeTone', quickTone.value));

  // ==================== Main Transformation Flow ====================
  function updateUndoButton() {
    const canUndo = lastRewrite?.input === activeInput && getElementText(activeInput) === lastRewrite.result;
    btnUndo.style.display = canUndo ? '' : 'none';
  }

  async function executeRewrite() {
    const input = activeInput;
    if (processingInput || !isCurrentEditor(input) || composingInput === input) return;
    if (document.activeElement === host) {
      input.focus();
      if (getFocusedEditor() !== input) return;
    }
    const original = getElementText(input);
    if (!original.trim()) {
      showToast('Input is empty. Please enter some text first.');
      return;
    }

    processingInput = input;
    btnRun.disabled = true;
    const prevBtnText = btnRun.textContent;
    btnRun.textContent = '⏳ Processing...';
    updatePillPosition();

    try {
      const transformed = await callProviderAPI(buildSystemPrompt(config), original, config);
      if (!isCurrentEditor(input) || composingInput === input || getElementText(input) !== original) {
        showToast('The draft changed or lost focus. Polish it again when ready.');
        return;
      }

      if (original !== transformed && !(await setElementText(input, transformed, original))) {
        showToast('The draft changed while the editor regained focus.');
        return;
      }
      const result = getElementText(input);
      if (original !== transformed && result === original) {
        showToast('The editor did not accept the rewrite.');
        return;
      }
      const rewrite = { input, original, result };
      if (result !== original) lastRewrite = rewrite;
      updateUndoButton();
    } catch (err) {
      showToast(`Transformation failed: ${err?.message || String(err)}`, 4500);
    } finally {
      processingInput = null;
      btnRun.disabled = false;
      btnRun.textContent = prevBtnText;
      updatePillPosition();
    }
  }

  btnRun.addEventListener('click', executeRewrite);

  btnUndo.addEventListener('click', async () => {
    if (lastRewrite?.input === activeInput && isCurrentEditor(activeInput) &&
      composingInput !== activeInput && getElementText(activeInput) === lastRewrite.result) {
      const { input, original } = lastRewrite;
      btnUndo.disabled = true;
      try {
        if (await setElementText(input, original, lastRewrite.result)) {
          lastRewrite = null;
          showToast('Original text restored', 1800);
        }
      } catch (err) {
        showToast(`Undo failed: ${err?.message || String(err)}`);
      } finally {
        btnUndo.disabled = false;
        updateUndoButton();
        updatePillPosition();
      }
    }
  });

  // ==================== Settings Modal Logic ====================
  const cfgProvider = shadow.getElementById('cfg-provider');
  const geminiFields = shadow.getElementById('gemini-fields');
  const openaiFields = shadow.getElementById('openai-fields');
  const cohereFields = shadow.getElementById('cohere-fields');
  const testStatusEl = shadow.getElementById('test-status');
  const btnTest = shadow.getElementById('btn-test');
  const settingsFields = shadow.getElementById('settings-fields');
  const keyButtons = settingsFields.querySelectorAll('.btn-key');
  let testRevision = 0;

  function invalidateTestStatus() {
    testRevision += 1;
    setTestStatus('', '');
  }

  function setTestStatus(type, msg) {
    testStatusEl.className = type ? `test-status ${type}` : 'test-status';
    testStatusEl.textContent = msg || '';
  }

  function toggleProviderFields() {
    const provider = cfgProvider.value;
    cohereFields.style.display = provider === 'cohere' ? 'block' : 'none';
    geminiFields.style.display = provider === 'gemini' ? 'block' : 'none';
    openaiFields.style.display = provider === 'openai' ? 'block' : 'none';
  }

  cfgProvider.addEventListener('change', toggleProviderFields);
  settingsFields.addEventListener('input', invalidateTestStatus);

  for (const button of keyButtons) {
    button.addEventListener('click', () => {
      const input = document.createElement('input');
      input.id = button.id;
      input.type = 'password';
      input.autocomplete = 'off';
      input.value = config[button.dataset.configKey];
      button.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  btnSettings.addEventListener('click', () => {
    cfgProvider.value = config.provider;
    for (const button of keyButtons) {
      button.textContent = config[button.dataset.configKey] ? 'Change API key' : 'Enter API key';
    }
    shadow.getElementById('cfg-cohere-model').value = config.cohereModel;
    shadow.getElementById('cfg-gemini-model').value = config.geminiModel;
    shadow.getElementById('cfg-openai-url').value = config.openaiBaseUrl;
    shadow.getElementById('cfg-openai-model').value = config.openaiModel;
    shadow.getElementById('cfg-custom-prompt').value = config.customTonePrompt;
    shadow.getElementById('cfg-intercept-enter').checked = config.interceptEnter;
    invalidateTestStatus();
    toggleProviderFields();
    modalBackdrop.classList.add('open');
    cfgProvider.focus();
  });

  function readModalConfig() {
    const editedKeys = {};
    for (const button of keyButtons) {
      const field = shadow.getElementById(button.id);
      if (field !== button) editedKeys[button.dataset.configKey] = field.value.trim();
    }
    return {
      ...config,
      ...editedKeys,
      provider: cfgProvider.value,
      cohereModel: shadow.getElementById('cfg-cohere-model').value.trim() || DEFAULT_CONFIG.cohereModel,
      geminiModel: shadow.getElementById('cfg-gemini-model').value.trim() || DEFAULT_CONFIG.geminiModel,
      openaiBaseUrl: shadow.getElementById('cfg-openai-url').value.trim() || DEFAULT_CONFIG.openaiBaseUrl,
      openaiModel: shadow.getElementById('cfg-openai-model').value.trim() || DEFAULT_CONFIG.openaiModel,
      customTonePrompt: shadow.getElementById('cfg-custom-prompt').value,
      interceptEnter: shadow.getElementById('cfg-intercept-enter').checked
    };
  }

  function closeSettingsModal() {
    if (settingsFields.disabled) return;
    modalBackdrop.classList.remove('open');
    for (const button of keyButtons) {
      const field = shadow.getElementById(button.id);
      if (field !== button) {
        field.value = '';
        field.replaceWith(button);
      }
    }
    invalidateTestStatus();
    if (activeInput?.isConnected && isEditableElement(activeInput)) {
      activeInput.focus();
      updatePillPosition();
    } else {
      hidePill();
    }
  }

  btnTest.addEventListener('click', async () => {
    const draftCfg = readModalConfig();
    const revision = testRevision;
    btnTest.disabled = true;
    const prevText = btnTest.textContent;
    btnTest.textContent = 'Testing...';
    setTestStatus('info', 'Testing API connection...');
    const startedAt = Date.now();
    try {
      const reply = await callProviderAPI(
        'Reply with "OK" only.',
        'Connection test.',
        draftCfg
      );
      if (revision === testRevision) {
        const elapsed = Date.now() - startedAt;
        setTestStatus('success', `✓ API works (${elapsed}ms): ${reply.slice(0, 80)}`);
      }
    } catch (err) {
      if (revision === testRevision) setTestStatus('error', `✕ Test failed: ${err?.message || String(err)}`);
    } finally {
      btnTest.disabled = false;
      btnTest.textContent = prevText;
    }
  });

  shadow.getElementById('btn-cancel').addEventListener('click', closeSettingsModal);

  shadow.getElementById('btn-save').addEventListener('click', async () => {
    const draft = readModalConfig();
    invalidateTestStatus();
    settingsFields.disabled = true;
    try {
      await saveConfig(draft);
      config = draft;
    } catch {
      setTestStatus('error', 'Could not save settings. Try again.');
      return;
    } finally {
      settingsFields.disabled = false;
    }
    closeSettingsModal();
    showToast(canPersistConfig ? 'Settings saved globally ✓' : 'Settings applied for this tab only');
  });

  modalBackdrop.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsModal();
    } else if (e.key === 'Tab') {
      const controls = Array.from(settingsFields.querySelectorAll('button, input, select, textarea'))
        .filter((control) => !control.matches(':disabled') && control.getClientRects().length);
      const index = controls.indexOf(shadow.activeElement);
      if (index === -1 || (e.shiftKey ? index === 0 : index === controls.length - 1)) {
        e.preventDefault();
        const next = e.shiftKey ? controls[controls.length - 1] : controls[0];
        next?.focus();
      }
    }
  });

  // ==================== Global Event Listeners ====================
  pill.addEventListener('pointerdown', (e) => {
    isInteractingWithPill = e.target === quickLang || e.target === quickTone;
  }, true);

  document.addEventListener(
    'pointerdown',
    (e) => {
      const path = e.composedPath();
      if (path.includes(host)) return;
      isInteractingWithPill = false;
      if (activeInput && !path.includes(activeInput)) scheduleFocusCheck();
    },
    true
  );

  function activateEditor(editor) {
    if (editor !== activeInput) composingInput = null;
    activeInput = editor;
    updateUndoButton();
    updatePillPosition();
  }

  document.addEventListener(
    'focusin',
    (e) => {
      clearTimeout(focusCheckTimer);
      isInteractingWithPill = false;
      if (e.target === host || modalBackdrop.classList.contains('open')) return;
      const editor = getEditor(e.composedPath()[0]);
      if (editor) activateEditor(editor);
      else hidePill();
    },
    true
  );

  document.addEventListener(
    'focusout',
    () => {
      scheduleFocusCheck();
    },
    true
  );

  document.addEventListener('input', (e) => {
    if (lastRewrite && getEditor(e.composedPath()[0]) === lastRewrite.input &&
      getElementText(lastRewrite.input) !== lastRewrite.result) {
      lastRewrite = null;
      updateUndoButton();
      schedulePositionUpdate();
    }
  }, true);

  document.addEventListener('compositionstart', (e) => {
    composingInput = getEditor(e.composedPath()[0]);
  }, true);
  document.addEventListener('compositionend', () => {
    composingInput = null;
  }, true);

  window.addEventListener('scroll', schedulePositionUpdate, true);
  window.addEventListener('resize', schedulePositionUpdate);

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || e.defaultPrevented || e.isComposing ||
        !isCurrentEditor(activeInput) || composingInput === activeInput) return;

      // Shortcut Option + J (Mac) / Alt + J (Win/Linux) to transform in place
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyJ') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) executeRewrite();
        return;
      }

      // Optionally use Enter to polish the draft in place.
      if (
        config.interceptEnter &&
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        getEditor(e.composedPath()[0]) === activeInput &&
        getElementText(activeInput).trim()
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        if (processingInput && processingInput !== activeInput) {
          showToast('Wait for the current rewrite to finish.');
          return;
        }
        executeRewrite();
      }
    },
    true
  );

  const initialEditor = getFocusedEditor();
  if (initialEditor) activateEditor(initialEditor);
})();
