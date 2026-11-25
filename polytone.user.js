// ==UserScript==
// @name         AI Input Polisher & Tone Rewriter
// @namespace    https://github.com/Shawshank01/polytone
// @homepageURL  https://github.com/Shawshank01/polytone
// @supportURL   https://github.com/Shawshank01/polytone/issues
// @updateURL    https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js
// @downloadURL  https://raw.githubusercontent.com/Shawshank01/polytone/main/polytone.user.js
// @version      0.0.2
// @description  A lightweight script for browsers that translates, fixes grammar, and rewrites text in any web input box with customisable tones with AI APIs
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @connect      generativelanguage.googleapis.com
// @connect      api.openai.com
// @connect      api.cohere.com
// @connect      api.cohere.ai
// @connect      *
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // Avoid duplicate mounting in ad iframes or tiny frames
  if (window.top !== window.self && window.innerWidth < 300) return;

  // ==================== Default Config & Tone Presets ====================
  const DEFAULT_CONFIG = {
    provider: 'gemini', // 'gemini' | 'openai' | 'cohere'
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    cohereApiKey: '',
    cohereModel: 'command-a-plus-05-2026',
    targetLang: 'English',
    activeTone: 'natural',
    customTonePrompt: '',
    interceptEnter: false, // Whether to intercept Enter key to auto-transform and send
    temperature: 0.7
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
  async function loadConfig() {
    try {
      let raw = null;
      if (typeof GM_getValue === 'function') {
        raw = GM_getValue('ai_rewriter_cfg', null);
      } else if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
        raw = await GM.getValue('ai_rewriter_cfg', null);
      } else {
        raw = localStorage.getItem('ai_rewriter_cfg');
      }
      if (!raw) return { ...DEFAULT_CONFIG };
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async function saveConfig(cfg) {
    const serialized = JSON.stringify(cfg);
    if (typeof GM_setValue === 'function') {
      GM_setValue('ai_rewriter_cfg', serialized);
    } else if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
      await GM.setValue('ai_rewriter_cfg', serialized);
    } else {
      localStorage.setItem('ai_rewriter_cfg', serialized);
    }
  }

  // ==================== Cross-Origin HTTP Request Wrapper ====================
  function crossOriginPost(url, headers, bodyObj) {
    const payload = JSON.stringify(bodyObj);
    const xhrFn =
      typeof GM_xmlhttpRequest === 'function'
        ? GM_xmlhttpRequest
        : typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function'
          ? GM.xmlHttpRequest
          : null;

    if (xhrFn) {
      return new Promise((resolve, reject) => {
        xhrFn({
          method: 'POST',
          url,
          headers,
          data: payload,
          timeout: 30000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                resolve(JSON.parse(res.responseText));
              } catch (e) {
                reject(new Error('Failed to parse response JSON: ' + res.responseText.slice(0, 120)));
              }
            } else {
              reject(new Error(`HTTP ${res.status}: ${res.responseText.slice(0, 200)}`));
            }
          },
          onerror: (err) => reject(new Error('Network request failed: ' + JSON.stringify(err))),
          ontimeout: () => reject(new Error('API request timed out (30s)'))
        });
      });
    }

    return fetch(url, {
      method: 'POST',
      headers,
      body: payload
    }).then(async (res) => {
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text);
    });
  }

  // ==================== Prompt Builder & LLM Invocation ====================
  function buildSystemPrompt(cfg) {
    const toneObj = TONE_PRESETS[cfg.activeTone] || TONE_PRESETS.natural;
    const toneInstruction =
      cfg.activeTone === 'custom' && cfg.customTonePrompt.trim()
        ? cfg.customTonePrompt.trim()
        : toneObj.instruction;

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

  async function transformText(text, cfg) {
    const systemPrompt = buildSystemPrompt(cfg);

    if (cfg.provider === 'gemini') {
      if (!cfg.geminiApiKey.trim()) {
        throw new Error('Please click the gear icon to enter your Gemini API Key first');
      }
      const model = encodeURIComponent(cfg.geminiModel.trim() || 'gemini-3.5-flash-lite');
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
            parts: [{ text }]
          }
        ],
        generationConfig: {
          temperature: Number(cfg.temperature) || 0.7
        }
      };

      const data = await crossOriginPost(url, headers, body);
      const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!result) throw new Error('Gemini did not return valid text');
      return result.trim();
    } else if (cfg.provider === 'cohere') {
      if (!cfg.cohereApiKey.trim()) {
        throw new Error('Please click the gear icon to enter your Cohere API Key first');
      }
      const url = 'https://api.cohere.com/v2/chat';
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.cohereApiKey.trim()}`
      };
      const body = {
        model: cfg.cohereModel.trim() || 'command-a-plus-05-2026',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: Number(cfg.temperature) || 0.7
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
      if (!result.trim()) throw new Error('Cohere did not return valid text');
      return result.trim();
    } else {
      if (!cfg.openaiApiKey.trim()) {
        throw new Error('Please click the gear icon to enter your OpenAI-compatible API Key first');
      }
      let baseUrl = (cfg.openaiBaseUrl.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.openaiApiKey.trim()}`
      };
      const body = {
        model: cfg.openaiModel.trim() || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: Number(cfg.temperature) || 0.7
      };

      const data = await crossOriginPost(url, headers, body);
      const result = data?.choices?.[0]?.message?.content;
      if (!result) throw new Error('OpenAI-compatible API did not return valid text');
      return result.trim();
    }
  }

  // ==================== Input Reading & Framework-Compatible Writing ====================
  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('#ai-tone-rewriter-host')) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      const validTypes = ['text', 'search', 'email', 'url', ''];
      return validTypes.includes((el.type || '').toLowerCase()) && !el.disabled && !el.readOnly;
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getElementText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value || '';
    }
    return el.innerText || el.textContent || '';
  }

  function setElementText(el, newText) {
    if (!el) return;
    el.focus();

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
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (el.isContentEditable) {
      // Support rich-text frameworks such as Lexical (X/Twitter), Slate (Discord), ProseMirror (ChatGPT)
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, newText);
      if (!inserted) {
        el.textContent = newText;
        el.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: newText
          })
        );
      }
    }
  }

  // ==================== Shadow DOM Floating Pill & Settings Modal ====================
  let config = { ...DEFAULT_CONFIG };
  let activeInput = null;
  let lastOriginalText = '';
  let lastModifiedInput = null;
  let isProcessing = false;
  let bypassEnterOnce = false;

  const host = document.createElement('div');
  host.id = 'ai-tone-rewriter-host';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const SHADOW_CSS = `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      z-index: 2147483647;
      pointer-events: none;
    }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
    .pill {
      position: fixed;
      display: none;
      align-items: center;
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
      transition: opacity 0.15s ease;
      user-select: none;
    }
    .pill.visible { display: flex; }
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
      max-width: 340px;
      line-height: 1.4;
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
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.14);
      padding: 18px 20px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .modal h3 { margin: 0 0 14px; font-size: 15px; font-weight: 600; }
    .field { margin-bottom: 11px; }
    .field label { display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px; }
    .field input, .field select, .field textarea {
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
    .modal-actions {
      display: flex;
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
    .btn-cancel { background: #27272a; color: #e4e4e7; }
    .btn-save { background: #3b82f6; color: #fff; font-weight: 600; }
  `;

  shadow.innerHTML = `
    <div class="pill" id="pill">
      <select id="quick-lang" title="Target Language"></select>
      <div class="divider"></div>
      <select id="quick-tone" title="Preset Tone"></select>
      <button class="btn-run" id="btn-run" title="Transform & Polish (Option+J / Alt+J)">✨ Polish</button>
      <button id="btn-undo" title="Undo & Restore Original">↩</button>
      <button id="btn-settings" title="API & Advanced Settings">⚙️</button>
    </div>

    <div class="toast" id="toast"></div>

    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <h3>AI Translation & Tone Settings</h3>
        <div class="field">
          <label>API Provider</label>
          <select id="cfg-provider">
            <option value="gemini">Google Gemini API (Native)</option>
            <option value="openai">OpenAI-Compatible API (OpenAI / DeepSeek / Ollama)</option>
            <option value="cohere">Cohere API (Native v2)</option>
          </select>
        </div>

        <div id="gemini-fields">
          <div class="field">
            <label>Gemini API Key</label>
            <input type="password" id="cfg-gemini-key" placeholder="AIzaSy..." />
          </div>
          <div class="field">
            <label>Gemini Model</label>
            <input type="text" id="cfg-gemini-model" placeholder="gemini-3.5-flash-lite" />
          </div>
        </div>

        <div id="openai-fields">
          <div class="field">
            <label>OpenAI-Compatible Base URL</label>
            <input type="text" id="cfg-openai-url" placeholder="https://api.openai.com/v1" />
          </div>
          <div class="field">
            <label>API Key</label>
            <input type="password" id="cfg-openai-key" placeholder="sk-..." />
          </div>
          <div class="field">
            <label>Model Name</label>
            <input type="text" id="cfg-openai-model" placeholder="gpt-4o-mini / deepseek-chat" />
          </div>
        </div>

        <div id="cohere-fields">
          <div class="field">
            <label>Cohere API Key</label>
            <input type="password" id="cfg-cohere-key" placeholder="Cohere API Key" />
          </div>
          <div class="field">
            <label>Cohere Model</label>
            <input type="text" id="cfg-cohere-model" placeholder="command-a-plus-05-2026" />
          </div>
        </div>

        <div class="field">
          <label>Custom Persona Prompt (active when "Custom Persona" is selected)</label>
          <textarea id="cfg-custom-prompt" rows="2" placeholder="e.g., Reply in the voice of a Victorian aristocrat with a touch of refined arrogance."></textarea>
        </div>

        <label class="checkbox-row">
          <input type="checkbox" id="cfg-intercept-enter" />
          <span>Intercept Enter key: automatically transform and send on Enter</span>
        </label>

        <div class="modal-actions">
          <button class="btn-cancel" id="btn-cancel">Cancel</button>
          <button class="btn-save" id="btn-save">Save Settings</button>
        </div>
      </div>
    </div>
  `;

  // Use Constructable Stylesheets so strict CSP style-src sites (e.g. Mastodon) allow Shadow DOM styling
  if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet === 'function') {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SHADOW_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const styleEl = document.createElement('style');
      styleEl.textContent = SHADOW_CSS;
      shadow.appendChild(styleEl);
    }
  } else {
    const styleEl = document.createElement('style');
    styleEl.textContent = SHADOW_CSS;
    shadow.appendChild(styleEl);
  }

  const pill = shadow.getElementById('pill');
  const quickLang = shadow.getElementById('quick-lang');
  const quickTone = shadow.getElementById('quick-tone');
  const btnRun = shadow.getElementById('btn-run');
  const btnUndo = shadow.getElementById('btn-undo');
  const btnSettings = shadow.getElementById('btn-settings');
  const toastEl = shadow.getElementById('toast');
  const modalBackdrop = shadow.getElementById('modal-backdrop');

  btnUndo.style.display = 'none';

  // Initialize dropdown options
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

  function showToast(msg, duration = 3200) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.style.display = 'none';
    }, duration);
  }

  let focusCheckTimer = null;
  let isInteractingWithPill = false;

  function hidePill() {
    activeInput = null;
    isInteractingWithPill = false;
    pill.classList.remove('visible');
  }

  function isFocusWithinActiveOrUI() {
    const active = document.activeElement;
    if (!active) return false;
    if (active === host || host.contains(active)) return true;
    if (activeInput && (active === activeInput || activeInput.contains(active))) return true;
    return isEditableElement(active);
  }

  function scheduleFocusCheck() {
    clearTimeout(focusCheckTimer);
    focusCheckTimer = setTimeout(() => {
      if (modalBackdrop.classList.contains('open') || isInteractingWithPill) return;
      if (!isFocusWithinActiveOrUI()) {
        hidePill();
      }
    }, 0);
  }

  function updatePillPosition() {
    if (!activeInput || !document.body.contains(activeInput)) {
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
    let top = rect.bottom + 6;
    if (top + pillRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - pillRect.height - 6);
    }
    let left = Math.min(
      window.innerWidth - pillRect.width - 12,
      Math.max(8, rect.right - pillRect.width)
    );
    pill.style.top = `${top}px`;
    pill.style.left = `${left}px`;
  }

  // Prevent clicking floating toolbar buttons/background from blurring the active input
  pill.addEventListener('mousedown', (e) => {
    if (e.target !== quickLang && e.target !== quickTone) {
      e.preventDefault();
    }
  });

  quickLang.addEventListener('change', async () => {
    isInteractingWithPill = false;
    config.targetLang = quickLang.value;
    await saveConfig(config);
    if (activeInput) activeInput.focus();
  });

  quickTone.addEventListener('change', async () => {
    isInteractingWithPill = false;
    config.activeTone = quickTone.value;
    await saveConfig(config);
    if (activeInput) activeInput.focus();
  });

  // ==================== Main Transformation Flow ====================
  async function executeRewrite(autoSubmitAfter = false) {
    if (!activeInput || isProcessing) return;
    const rawText = getElementText(activeInput).trim();
    if (!rawText) {
      showToast('Input is empty. Please enter some text first.');
      return;
    }

    isProcessing = true;
    btnRun.disabled = true;
    const prevBtnText = btnRun.textContent;
    btnRun.textContent = '⏳ Processing...';

    try {
      const targetEl = activeInput;
      const transformed = await transformText(rawText, config);
      lastOriginalText = rawText;
      lastModifiedInput = targetEl;
      setElementText(targetEl, transformed);
      btnUndo.style.display = 'inline-block';

      if (autoSubmitAfter) {
        setTimeout(() => {
          bypassEnterOnce = true;
          targetEl.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            })
          );
        }, 60);
      }
    } catch (err) {
      showToast(`Transformation failed: ${err.message}`, 4500);
    } finally {
      isProcessing = false;
      btnRun.disabled = false;
      btnRun.textContent = prevBtnText;
    }
  }

  btnRun.addEventListener('click', () => executeRewrite(false));

  btnUndo.addEventListener('click', () => {
    if (lastModifiedInput && lastOriginalText) {
      setElementText(lastModifiedInput, lastOriginalText);
      btnUndo.style.display = 'none';
      showToast('Original text restored', 1800);
    }
  });

  // ==================== Settings Modal Logic ====================
  const cfgProvider = shadow.getElementById('cfg-provider');
  const geminiFields = shadow.getElementById('gemini-fields');
  const openaiFields = shadow.getElementById('openai-fields');
  const cohereFields = shadow.getElementById('cohere-fields');

  function toggleProviderFields() {
    const provider = cfgProvider.value;
    geminiFields.style.display = provider === 'gemini' ? 'block' : 'none';
    openaiFields.style.display = provider === 'openai' ? 'block' : 'none';
    cohereFields.style.display = provider === 'cohere' ? 'block' : 'none';
  }

  cfgProvider.addEventListener('change', toggleProviderFields);
  toggleProviderFields();

  btnSettings.addEventListener('click', () => {
    cfgProvider.value = config.provider;
    shadow.getElementById('cfg-gemini-key').value = config.geminiApiKey;
    shadow.getElementById('cfg-gemini-model').value = config.geminiModel;
    shadow.getElementById('cfg-openai-url').value = config.openaiBaseUrl;
    shadow.getElementById('cfg-openai-key').value = config.openaiApiKey;
    shadow.getElementById('cfg-openai-model').value = config.openaiModel;
    shadow.getElementById('cfg-cohere-key').value = config.cohereApiKey;
    shadow.getElementById('cfg-cohere-model').value = config.cohereModel;
    shadow.getElementById('cfg-custom-prompt').value = config.customTonePrompt;
    shadow.getElementById('cfg-intercept-enter').checked = config.interceptEnter;
    toggleProviderFields();
    modalBackdrop.classList.add('open');
  });

  function closeSettingsModal() {
    modalBackdrop.classList.remove('open');
    if (activeInput && document.body.contains(activeInput)) {
      activeInput.focus();
      updatePillPosition();
    } else {
      hidePill();
    }
  }

  shadow.getElementById('btn-cancel').addEventListener('click', closeSettingsModal);

  shadow.getElementById('btn-save').addEventListener('click', async () => {
    config.provider = cfgProvider.value;
    config.geminiApiKey = shadow.getElementById('cfg-gemini-key').value.trim();
    config.geminiModel = shadow.getElementById('cfg-gemini-model').value.trim() || 'gemini-3.5-flash-lite';
    config.openaiBaseUrl = shadow.getElementById('cfg-openai-url').value.trim() || 'https://api.openai.com/v1';
    config.openaiApiKey = shadow.getElementById('cfg-openai-key').value.trim();
    config.openaiModel = shadow.getElementById('cfg-openai-model').value.trim() || 'gpt-4o-mini';
    config.cohereApiKey = shadow.getElementById('cfg-cohere-key').value.trim();
    config.cohereModel = shadow.getElementById('cfg-cohere-model').value.trim() || 'command-a-plus-05-2026';
    config.customTonePrompt = shadow.getElementById('cfg-custom-prompt').value;
    config.interceptEnter = shadow.getElementById('cfg-intercept-enter').checked;
    await saveConfig(config);
    closeSettingsModal();
    showToast('Settings saved globally ✓');
  });

  // ==================== Global Event Listeners ====================
  document.addEventListener(
    'pointerdown',
    (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.includes(host) || e.target === host) {
        isInteractingWithPill = path.includes(quickLang) || path.includes(quickTone);
        return;
      }
      isInteractingWithPill = false;
      if (activeInput && !path.includes(activeInput) && !activeInput.contains(e.target)) {
        scheduleFocusCheck();
      }
    },
    true
  );

  document.addEventListener(
    'focusin',
    (e) => {
      clearTimeout(focusCheckTimer);
      isInteractingWithPill = false;
      const target = e.target;
      if (isEditableElement(target)) {
        activeInput = target;
        if (lastModifiedInput !== target) {
          btnUndo.style.display = 'none';
        }
        updatePillPosition();
      } else if (!e.composedPath?.().includes(host) && !modalBackdrop.classList.contains('open')) {
        hidePill();
      }
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

  window.addEventListener('scroll', updatePillPosition, true);
  window.addEventListener('resize', updatePillPosition);

  document.addEventListener(
    'keydown',
    (e) => {
      // Shortcut Option + J (Mac) / Alt + J (Win/Linux) to transform in place
      if (e.altKey && e.code === 'KeyJ' && activeInput) {
        e.preventDefault();
        e.stopPropagation();
        executeRewrite(false);
        return;
      }

      // Optional: intercept Enter key to auto-transform before sending
      if (
        config.interceptEnter &&
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.isComposing &&
        activeInput &&
        isEditableElement(e.target)
      ) {
        if (bypassEnterOnce) {
          bypassEnterOnce = false;
          return;
        }
        const text = getElementText(activeInput).trim();
        if (text) {
          e.preventDefault();
          e.stopImmediatePropagation();
          executeRewrite(true);
        }
      }
    },
    true
  );

  // Load initial config
  loadConfig().then((loaded) => {
    config = loaded;
    quickLang.value = config.targetLang;
    quickTone.value = config.activeTone;
  });
})();
