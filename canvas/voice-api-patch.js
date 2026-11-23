(() => {
  "use strict";

  // 「语音API来源设置」：插在「视频API来源设置」下方的独立 tab，只放第三方语音（TTS）配置。
  // 界面结构与「文本API来源设置」一致：内置云雾卡 + 任意第三方卡，同时只启用一个。
  // 画布语音节点走 bundle 内部 tx(minimax)，而厂商表里只有 yunwu：缺 minimax 时它直接抛
  // Missing vendor config，语音节点根本发不出请求。所以启用语音配置时要把 minimax 注册进
  // 厂商表与 vendorConfigs（并塞进 bundle 的隐藏集合，避免原生面板多冒一张厂商卡），同时
  // 劫持 fetch 改写 /t2a_v2；浏览器直连被跨域拦截时回退本机 server.py 的 /__textapi/ 转发。
  const VOICE_PROFILES_KEY = "manshiguang:canvas-voice-api-profiles";
  const STYLE_ID = "ms-voice-api-style";
  const TAB_ID = "ms-voice-api-tab-btn";
  const SECTION_ID = "ms-voice-api-section";
  const VIEW_CLASS = "ms-voice-api-view";
  const COMFY_VIEW_CLASS = "ms-comfy-view";
  const TEXT_VIEW_CLASS = "ms-text-api-view";
  const VIDEO_VIEW_CLASS = "ms-video-api-view";
  const BUILTIN_ID = "yunwu";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const BUILTIN_APPLY_URL = "https://api.openlux.ai/register?aff=MYE2";
  const PROXY_PREFIX = "/__textapi/";
  const MODELS_DEBOUNCE_MS = 700;

  let voiceState = null;
  let voiceActive = false;
  let tabButton = null;
  let section = null;
  let syncQueued = false;
  let modalWasOpen = false;
  const runtime = { loading: new Set(), timers: new Map(), status: new Map() };

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
    );

  function normalizeBaseUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      const path = url.pathname
        .replace(/\/v1\/chat\/completions$/i, "")
        .replace(/\/t2a_v2\/?$/i, "")
        .replace(/\/v1\/audio\/speech\/?$/i, "")
        .replace(/\/v1\/models(\/.*)?$/i, "")
        .replace(/\/v1beta(\/.*)?$/i, "")
        .replace(/\/v1$/i, "")
        .replace(/\/models$/i, "")
        .replace(/\/+$/, "");
      return `${url.origin}${path}`;
    } catch {
      return text.replace(/\/+$/, "");
    }
  }

  // 语音模型口径：只认 TTS / 音色类模型名。聊天、生图、生视频模型一律排除，
  // 否则「全选语音」会把文本模型勾进来，接管后拿聊天模型去撞 TTS 接口会误扣费。
  const VOICE_MODEL_RE =
    /tts|text-to-speech|speech|voice|audio[-_.]?(?:gen|synthesis)|t2a|cosyvoice|sambert|volctts|minimax[-_.]?tts|eleven|fish[-_.]?speech|chat[-_.]?tts|doubao[-_.]?speech|paraformer/i;
  const NON_VOICE_MODEL_RE =
    /embedding|rerank|moderation|realtime|ocr|safety|transcri|asr|whisper|image|banana|imagen|flux|dall|stable-diffusion|sdxl|seedream|seededit|kolors|midjourney|draw|paint|video|kling|sora|veo|seedance|jimeng|grokvideo|motion|animated|frame|\bchat\b|\btext\b|reason|deepseek|kimi|\bglm\b/i;

  // 图片/视频链路同样可能命中 chat/completions，这里按模型名再兜底一次，
  // 避免把生图、生视频请求改写到文本配置上造成误扣费。
  function isVoiceModel(model) {
    const id = String(model || "");
    if (!id || NON_VOICE_MODEL_RE.test(id)) return false;
    return VOICE_MODEL_RE.test(id);
  }

  const createId = () =>
    `vo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function blankProfile(index) {
    return {
      id: createId(),
      name: `第三方语音 API ${index}`,
      apiKey: "",
      baseUrl: "",
      applyUrl: "",
      voiceModel: "",
      voiceName: "",
      builtin: false,
      modelCatalog: [],
      selectedModels: [],
      modelsFetchedAt: 0,
      modelsError: "",
      modelsBaseUrl: "",
    };
  }

  function builtinProfile() {
    return {
      id: BUILTIN_ID,
      name: "云雾",
      apiKey: "",
      baseUrl: "",
      applyUrl: BUILTIN_APPLY_URL,
      voiceModel: "",
      voiceName: "",
      builtin: true,
      modelCatalog: [],
      selectedModels: [],
      modelsFetchedAt: 0,
      modelsError: "",
      modelsBaseUrl: "",
    };
  }

  function uniqueStringList(value) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const output = [];
    for (const item of list) {
      const text = typeof item === "string" ? item.trim() : "";
      if (!text || seen.has(text)) continue;
      seen.add(text);
      output.push(text);
    }
    return output;
  }

  function normalizeProfile(value, index) {
    const source = value && typeof value === "object" ? value : {};
    const builtin = source.id === BUILTIN_ID;
    const catalog = Array.isArray(source.modelCatalog)
      ? source.modelCatalog.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : [];
    return {
      id: typeof source.id === "string" && source.id ? source.id : createId(),
      name:
        typeof source.name === "string" && source.name.trim()
          ? source.name.trim()
          : builtin
            ? "云雾"
            : `第三方语音 API ${index}`,
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
      applyUrl: typeof source.applyUrl === "string" ? source.applyUrl : "",
      voiceModel: typeof source.voiceModel === "string" ? source.voiceModel.trim() : "",
      voiceName: typeof source.voiceName === "string" ? source.voiceName.trim() : "",
      builtin,
      modelCatalog: [...new Set(catalog)],
      selectedModels: uniqueStringList(source.selectedModels).filter((model) => catalog.includes(model)),
      modelsFetchedAt: Number.isFinite(source.modelsFetchedAt) ? source.modelsFetchedAt : 0,
      modelsError: typeof source.modelsError === "string" ? source.modelsError : "",
      modelsBaseUrl: typeof source.modelsBaseUrl === "string" ? source.modelsBaseUrl : "",
    };
  }

  function sanitizeBuiltinName(value) {
    const name = typeof value === "string" ? value.replace(/\s*[（(]\s*跟随图片\s*API\s*[）)]/gi, "").trim() : "";
    return name || "云雾";
  }

  function readVoiceState() {
    let stored = null;
    try {
      const raw = window.localStorage.getItem(VOICE_PROFILES_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    const list = Array.isArray(stored?.profiles) ? stored.profiles : [];
    // 内置云雾卡始终排在最前，并回填用户填过的语音接口 Key/Base URL，
    // 否则刷新后云雾配置会被重置成空。
    const defaults = builtinProfile();
    const savedBuiltin = list.find((item) => item?.id === BUILTIN_ID) || {};
    const profiles = [
      normalizeProfile({
        ...defaults,
        ...savedBuiltin,
        id: BUILTIN_ID,
        // 早期版本把内置卡命名成「云雾（跟随图片API）」，现在云雾独立配置语音接口，
        // 读取时一律清洗回「云雾」，避免旧存储把过时文案带回卡片标题与配置名称。
        name: sanitizeBuiltinName(savedBuiltin.name),
        applyUrl: savedBuiltin.applyUrl || defaults.applyUrl,
      }, 0),
    ];
    list
      .filter((item) => item?.id !== BUILTIN_ID)
      .forEach((item, index) => profiles.push(normalizeProfile(item, index + 1)));
    const activeId = profiles.some((profile) => profile.id === stored?.activeId)
      ? stored.activeId
      : BUILTIN_ID;
    return { version: 3, activeId, profiles };
  }

  function saveVoiceState() {
    if (!voiceState) return;
    try {
      window.localStorage.setItem(VOICE_PROFILES_KEY, JSON.stringify(voiceState));
    } catch {}
    publishActiveVoice();
  }

  function profileFor(id) {
    return voiceState?.profiles.find((profile) => profile.id === id) || null;
  }

  function activeVoiceProfile() {
    return voiceState?.activeId ? profileFor(voiceState.activeId) : null;
  }

  function publishActiveVoice() {
    const active = activeVoiceProfile();
    // 启用中的配置决定 bundle 内部 tx(minimax) 实际拿到的 Key/Base URL。
    if (!applyNativeVoiceVendor(active)) {
      clearNativeVoiceVendor();
      window.__MS_VOICE_NATIVE_TAKEOVER__ = false;
    } else {
      window.__MS_VOICE_NATIVE_TAKEOVER__ = true;
    }
    window.__MS_VOICE_API__ = {
      activeId: active?.id || "",
      name: active?.name || "",
      baseUrl: active ? voiceApiRoot(effectiveVoiceBase(active)) : "",
      apiKey: active?.apiKey || "",
      model: active?.voiceModel || "",
      builtin: Boolean(active?.builtin),
      updatedAt: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent("manshiguang:voice-api-changed", { detail: window.__MS_VOICE_API__ }),
    );
  }
  function setStatus(id, text, kind = "") {
    if (!text) runtime.status.delete(id);
    else runtime.status.set(id, { text, kind });
    applyStatusToDom(id);
  }

  function showStatus(text, kind = "") {
    const element = document.querySelector("#" + SECTION_ID + " .ms-voice-api__message");
    if (!element) return;
    element.textContent = text;
    element.className = "ms-voice-api__message" + (kind ? " is-" + kind : "");
  }

  function applyStatusToDom(id) {
    const card = section?.querySelector('[data-voice-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    const element = card.querySelector(".ms-voice-api__result");
    if (element) {
      const status = runtime.status.get(id);
      element.textContent = status?.text || "";
      element.className = "ms-voice-api__result" + (status?.kind ? " is-" + status.kind : "");
      element.hidden = !status?.text;
    }
    const button = card.querySelector('[data-ms-voice-action="models-refresh"]');
    if (button) {
      const loading = runtime.loading.has(id);
      button.disabled = loading;
      button.textContent = loading ? "拉取中…" : "拉取全部模型";
    }
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .settings-modal__body.${VIEW_CLASS} > *:not(#${SECTION_ID}) { display: none !important; }
      #${SECTION_ID} { display: none; }
      .settings-modal__body.${VIEW_CLASS} > #${SECTION_ID} { display: flex !important; }
      #${TAB_ID} .ms-voice-api-tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; font-size: 13px; }
      .ms-voice-api__body { display: flex; flex-direction: column; gap: 14px; }
      .ms-voice-api__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-voice-api__status { display: flex; align-items: center; gap: 8px; color: #6d5e52; font-size: 12px; line-height: 1.6; }
      .ms-voice-api__dot { width: 8px; height: 8px; border-radius: 999px; background: #ff6a1a; box-shadow: 0 0 0 4px #ff6a1a1a; }
      .ms-voice-api__add { height: 32px; padding: 0 14px; border: 1px solid #ff6a1a; border-radius: 999px; background: #fff; color: #e85c12; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
      .ms-voice-api__add:hover { background: #ff6a1a; color: #fff; }
      .ms-voice-api__message { display: none; padding: 9px 12px; border-radius: 12px; background: #e9f7ef; color: #217a50; font-size: 12px; line-height: 1.6; }
      .ms-voice-api__message:not(:empty) { display: block; }
      .ms-voice-api__message.is-error { background: #fff1ee; color: #b42318; }
      .ms-voice-api__list { display: flex; flex-direction: column; gap: 14px; }
      .ms-voice-api-card { display: flex; flex-direction: column; gap: 16px; padding: 18px; border: 1px solid #8f7c681f; border-radius: 22px; background: #ffffff8f; box-shadow: inset 0 1px #ffffff80; }
      .ms-voice-api-card.is-active { border-color: #ff6a1a80; box-shadow: inset 0 1px #ffffff80, 0 0 0 3px #ff6a1a12; }
      .ms-voice-api-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ms-voice-api-card__identity { display: flex; align-items: center; min-width: 0; gap: 8px; }
      .ms-voice-api-card__icon { color: #ff6a1a; font-size: 18px; line-height: 1; }
      .ms-voice-api-card__name { overflow: hidden; color: #2f251c; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .ms-voice-api-card__badge { padding: 3px 8px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 11px; white-space: nowrap; }
      .ms-voice-api-card__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .ms-voice-api-card__button { height: 30px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 160ms ease, background 160ms ease, color 160ms ease; }
      .ms-voice-api-card__button:hover:not(:disabled) { transform: translateY(-1px); }
      .ms-voice-api-card__button--apply { border: 1px solid #ff6a1a; background: #ff6a1a; color: #fff; }
      .ms-voice-api-card__button--apply:hover:not(:disabled) { border-color: #e85c12; background: #e85c12; }
      .ms-voice-api-card__button--enable { border: 1px solid #d8c9bb; background: #fff; color: #6d5e52; }
      .ms-voice-api-card__button--enable.is-active { border-color: #2b9a66; background: #e9f7ef; color: #217a50; }
      .ms-voice-api-card__button--primary { justify-self: start; border: 1px solid #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-voice-api-card__button:disabled { cursor: not-allowed; opacity: .55; }
      .ms-voice-api-card__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .ms-voice-api-card__field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
      .ms-voice-api-card__field--wide { grid-column: 1 / -1; }
      .ms-voice-api-card__label { color: #5f5146; font-size: 12px; font-weight: 600; }
      .ms-voice-api__input { width: 100%; height: 38px; box-sizing: border-box; padding: 0 12px; border: 1px solid #8f7c6829; border-radius: 11px; outline: none; background: #fff; color: #2f251c; font: inherit; font-size: 13px; }
      .ms-voice-api__input:focus { border-color: #ff6a1a; box-shadow: 0 0 0 3px #ff6a1a14; }
      .ms-voice-api-card__secret { position: relative; display: block; }
      .ms-voice-api-card__secret .ms-voice-api__input { padding-right: 44px; }
      .ms-voice-api-card__secret-toggle { position: absolute; top: 50%; right: 6px; display: grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #8d7868; cursor: pointer; transform: translateY(-50%); transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease; }
      .ms-voice-api-card__secret-toggle:hover { background: #8f7c6814; color: #ff6a1a; }
      .ms-voice-api-card__secret-toggle:focus-visible { outline: 0; box-shadow: 0 0 0 3px #ff6a1a2e; color: #ff6a1a; }
      .ms-voice-api-card__secret-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      .ms-voice-api-card__secret-icon--hide { display: none; }
      .ms-voice-api-card__secret-toggle[aria-pressed="true"] .ms-voice-api-card__secret-icon--show { display: none; }
      .ms-voice-api-card__secret-toggle[aria-pressed="true"] .ms-voice-api-card__secret-icon--hide { display: block; }
      .ms-voice-api-card__models { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid #8f7c681f; }
      .ms-voice-api-models__toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-voice-api-models__heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .ms-voice-api-models__title { color: #4b3d33; font-size: 13px; font-weight: 700; }
      .ms-voice-api-models__count, .ms-voice-api-models__time { color: #8d7868; font-size: 11px; }
      .ms-voice-api-models__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ms-voice-api-models__button { height: 28px; padding: 0 12px; border: 1px solid #d8c9bb; border-radius: 999px; background: #fff; color: #6d5e52; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
      .ms-voice-api-models__button--primary { border-color: #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-voice-api-models__button:disabled { cursor: not-allowed; opacity: .52; }
      .ms-voice-api-models__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; max-height: 236px; overflow: auto; overflow-anchor: none; padding: 2px; }
      .ms-voice-api-model { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #8f7c681f; border-radius: 10px; background: #ffffffa6; color: #3a2f27; cursor: pointer; }
      .ms-voice-api-model:hover { border-color: #ff6a1a59; background: #fffaf6; }
      .ms-voice-api-model input { width: 14px; height: 14px; margin: 0; accent-color: #ff6a1a; flex: 0 0 auto; }
      .ms-voice-api-model__name { min-width: 0; overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .ms-voice-api-model__tag { margin-left: auto; padding: 2px 6px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 9px; line-height: 1.4; flex: 0 0 auto; }
      .ms-voice-api-model__tag.is-current { background: #e9f7ef; color: #217a50; }
      .ms-voice-api-models__empty, .ms-voice-api-models__note { color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-voice-api-models__note.is-error { color: #b42318; }
      .ms-voice-api-card__hint { grid-column: 1 / -1; margin: 0; color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-voice-api__result { grid-column: 1 / -1; margin: 0; font-size: 11px; line-height: 1.6; color: #8d7868; word-break: break-all; }
      .ms-voice-api__result.is-ok { color: #217a50; }
      .ms-voice-api__result.is-error { color: #b42318; }
      .ms-voice-api__result.is-muted { color: #8d7868; }
      .ms-voice-api-card__remove { grid-column: 1 / -1; justify-self: start; padding: 0; border: 0; background: transparent; color: #b42318; font: inherit; font-size: 11px; cursor: pointer; }
      .ms-voice-api__footnote { margin: 0; padding: 0 4px; color: #8d7868; font-size: 11px; line-height: 1.7; }
    `;
    document.head.appendChild(style);
  }

  function settingsNav() {
    return document.querySelector(".settings-sidebar__nav");
  }

  function settingsBody() {
    return document.querySelector(".settings-modal__body");
  }

  // tab 锚点：语音排在 API 组最后一条。优先贴在「视频API来源设置」后面，
  // 视频补丁还没注入时退回图片 API 后面。匹配时必须先排掉三个补丁自己
  // 注入的按钮，否则回退正则会命中「文本API来源设置」插错位置。
  function findApiAnchorTab(nav) {
    const items = [...nav.querySelectorAll(".settings-sidebar__item")].filter(
      (item) => item.id !== TAB_ID && item.id !== "ms-text-api-tab-btn",
    );
    return (
      items.find((item) => item.id === "ms-video-api-tab-btn") ||
      items.find((item) => /视频API来源设置/.test(item.textContent || "")) ||
      items.find((item) => /图片API来源设置/.test(item.textContent || "")) ||
      items.find((item) => /^\s*API\s*来源设置\s*$/.test((item.textContent || "").trim())) ||
      items.find((item) => /API\s*来源设置/.test(item.textContent || "")) ||
      null
    );
  }

  // 每次同步都重新贴到锚点下方，保证顺序始终是
  // 文本API → 图片API → 视频API → 语音API → ComfyUI。
  function mountTabButton() {
    const nav = settingsNav();
    if (!nav) return false;
    const anchor = findApiAnchorTab(nav);
    if (!anchor) return false;
    let button = tabButton?.isConnected ? tabButton : document.getElementById(TAB_ID);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = TAB_ID;
      button.className = "settings-sidebar__item";
      button.dataset.msVoiceTab = "true";
      button.innerHTML =
        '<span class="ms-voice-api-tab-icon" aria-hidden="true">🔊</span><span>语音API来源设置</span>';
    }
    if (anchor.nextElementSibling !== button) anchor.after(button);
    tabButton = button;
    return true;
  }
  function selectedVoiceModels(profile) {
    const allowed = new Set(profile.modelCatalog.filter(isVoiceModel));
    return uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model));
  }

  function renderModelSection(profile) {
    const loading = runtime.loading.has(profile.id);
    const models = profile.modelCatalog.filter(isVoiceModel);
    const selected = new Set(profile.selectedModels);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const rows = models
      .map(
        (model) => `
          <label class="ms-voice-api-model" title="${escapeHtml(model)}">
            <input type="checkbox" data-ms-voice-model="${escapeHtml(model)}" ${selected.has(model) ? "checked" : ""} />
            <span class="ms-voice-api-model__name">${escapeHtml(model)}</span>
            <span class="ms-voice-api-model__tag${model === profile.voiceModel ? " is-current" : ""}">${model === profile.voiceModel ? "当前" : "语音"}</span>
          </label>`,
      )
      .join("");
    return `
      <div class="ms-voice-api-models__toolbar">
        <div class="ms-voice-api-models__heading">
          <span class="ms-voice-api-models__title">模型列表</span>
          <span class="ms-voice-api-models__count">已选择 ${selected.size} 个 / 共 ${models.length} 个</span>
          ${fetchedAt ? `<span class="ms-voice-api-models__time">最近拉取 ${escapeHtml(fetchedAt)}</span>` : ""}
        </div>
        <div class="ms-voice-api-models__actions">
          <button type="button" class="ms-voice-api-models__button ms-voice-api-models__button--primary" data-ms-voice-action="models-refresh" ${loading ? "disabled" : ""}>${loading ? "拉取中…" : "拉取全部模型"}</button>
          <button type="button" class="ms-voice-api-models__button" data-ms-voice-action="models-voice" ${models.length && !loading ? "" : "disabled"}>全选语音</button>
          <button type="button" class="ms-voice-api-models__button" data-ms-voice-action="models-clear" ${selected.size ? "" : "disabled"}>清空</button>
        </div>
      </div>
      <div class="ms-voice-api-models__note">${
        profile.builtin
          ? "勾选＝该 Key 实际可用的语音模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，留空则保持画布原生行为。"
          : "勾选＝该 Key 实际可用的语音模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，再兜底第一个勾选项。"
      }</div>
      ${profile.modelsError ? `<div class="ms-voice-api-models__note is-error">拉取失败：${escapeHtml(profile.modelsError)}</div>` : ""}
      ${models.length
        ? `<div class="ms-voice-api-models__list">${rows}</div>`
        : `<div class="ms-voice-api-models__empty">${loading ? "正在从平台拉取模型列表…" : "填好 API 密钥后会自动拉取；也可以点「拉取全部模型」。"}</div>`}
    `;
  }

  function modelHintText(profile) {
    const voiceModels = profile.modelCatalog.filter(isVoiceModel);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const tail = voiceModels.length
      ? `已拉取 ${voiceModels.length} 个可用语音模型${fetchedAt ? `（${fetchedAt}）` : ""}。`
      : profile.builtin ? "填好 API 密钥后会自动拉取模型列表（Base URL 留空即走云雾默认地址）。" : "填好密钥与 Base URL 后会自动拉取模型列表。";
    if (profile.builtin) {
      return `云雾的语音接口与图片、文本接口分开配置，请自行填写 API Key 与 Base URL。模型名留空时沿用画布自带的语音模型（speech-2.8-hd），填写后改用该模型名。${tail}`;
    }
    return `第三方需兼容 MiniMax 风格 POST /v1/t2a_v2（或 OpenAI 风格 /v1/audio/speech）。必须选定语音模型名才会接管，画布语音节点会改用这里的 Key、Base URL 与模型名。${tail}`;
  }

  // 拉模型是异步的，用户可能还在同一张卡里打字；这里只就地更新下拉与说明文案，
  // 不整块重渲染，否则输入框失焦、光标跳走。
  function refreshModelUi(profile) {
    if (!section || !voiceActive) return;
    const card = section.querySelector('[data-voice-id="' + CSS.escape(profile.id) + '"]');
    if (!card) return;
    const modelsSection = card.querySelector("[data-ms-model-section]");
    if (modelsSection) {
      const next = renderModelSection(profile);
      if (modelsSection.innerHTML !== next) modelsSection.innerHTML = next;
    }
    const input = card.querySelector('[data-ms-voice-field="voiceModel"]');
    if (input && input !== document.activeElement) input.value = profile.voiceModel;
    const hint = card.querySelector(".ms-voice-api-card__hint");
    const hintText = modelHintText(profile);
    if (hint && hint.textContent !== hintText) hint.textContent = hintText;
    applyStatusToDom(profile.id);
  }

  // 与「图片API来源设置」保持一致：同时只启用一个，启用中的按钮置灰
  function renderCard(profile) {
    const isActive = profile.id === voiceState.activeId;
    const enableButton =
      `<button type="button" class="ms-voice-api-card__button ms-voice-api-card__button--enable` +
      (isActive ? " is-active" : "") + `" data-ms-voice-action="enable"` +
      (isActive ? " disabled" : "") + `>` +
      (isActive ? "已启用" : "启用") +
      `</button>`;
    return `
      <article class="ms-voice-api-card` + (isActive ? " is-active" : "") + `" data-voice-id="${escapeHtml(profile.id)}">
        <div class="ms-voice-api-card__header">
          <div class="ms-voice-api-card__identity">
            <span class="ms-voice-api-card__icon" aria-hidden="true">${profile.builtin ? "☁" : "🔊"}</span>
            <span class="ms-voice-api-card__name">${escapeHtml(profile.name)}</span>
            <span class="ms-voice-api-card__badge">${profile.builtin ? "内置兼容" : "第三方"}</span>
          </div>
          <div class="ms-voice-api-card__actions">
            <button type="button" class="ms-voice-api-card__button ms-voice-api-card__button--apply" data-ms-voice-action="apply"
              title="${profile.applyUrl.trim() ? "打开申请地址" : "请先填写申请地址"}"` +
              (profile.applyUrl.trim() ? "" : " disabled") +
              `>申请</button>
            ${enableButton}
          </div>
        </div>
        <div class="ms-voice-api-card__form">
          <label class="ms-voice-api-card__field">
            <span class="ms-voice-api-card__label">配置名称</span>
            <input class="ms-voice-api__input" data-ms-voice-field="name" value="${escapeHtml(profile.name)}" placeholder="例如：MiniMax / 火山引擎 / 阿里云" />
          </label>
          <label class="ms-voice-api-card__field">
            <span class="ms-voice-api-card__label">申请地址（可选）</span>
            <input class="ms-voice-api__input" data-ms-voice-field="applyUrl" value="${escapeHtml(profile.applyUrl)}" placeholder="https://example.com/register" />
          </label>
          <div class="ms-voice-api-card__field">
            <label class="ms-voice-api-card__label" for="ms-voice-api-key-${escapeHtml(profile.id)}">API 密钥</label>
            <span class="ms-voice-api-card__secret">
              <input
                id="ms-voice-api-key-${escapeHtml(profile.id)}"
                class="ms-voice-api__input"
                data-ms-voice-field="apiKey"
                type="password"
                autocomplete="off"
                value="${escapeHtml(profile.apiKey)}"
                placeholder="sk-..."
              />
              <button
                type="button"
                class="ms-voice-api-card__secret-toggle"
                data-ms-voice-action="toggle-secret"
                aria-label="显示 API 密钥"
                aria-pressed="false"
                title="显示 API 密钥"
              >
                <svg class="ms-voice-api-card__secret-icon ms-voice-api-card__secret-icon--show" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.43-6 9.5-6 9.5 6 9.5 6-3.43 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.75"></circle>
                </svg>
                <svg class="ms-voice-api-card__secret-icon ms-voice-api-card__secret-icon--hide" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3l18 18"></path>
                  <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.07 0 9.5 6 9.5 6a17.8 17.8 0 0 1-3.1 3.8"></path>
                  <path d="M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.43 6 9.5 6c1.3 0 2.5-.28 3.55-.72"></path>
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                </svg>
              </button>
            </span>
          </div>
          <label class="ms-voice-api-card__field">
            <span class="ms-voice-api-card__label">接口地址（Base URL）</span>
            <input class="ms-voice-api__input" data-ms-voice-field="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="${escapeHtml(profile.builtin ? DEFAULT_BASE_URL : "https://api.example.com/v1")}" />
          </label>
          <label class="ms-voice-api-card__field">
            <span class="ms-voice-api-card__label">模型名（请求中 model 字段的实际值）</span>
            <input class="ms-voice-api__input" data-ms-voice-field="voiceModel" value="${escapeHtml(profile.voiceModel)}" placeholder="${profile.builtin ? "留空则沿用画布云雾语音模型" : "例如 speech-2.8-hd / tts-1"}" />
          </label>
          <label class="ms-voice-api-card__field">
            <span class="ms-voice-api-card__label">音色 voice（可选，留空用默认；elevenlabs 等需填有效 voice id）</span>
            <input class="ms-voice-api__input" data-ms-voice-field="voiceName" value="${escapeHtml(profile.voiceName || "")}" placeholder="例如 elevenlabs 的 voice_id / OpenAI 的 alloy" />
          </label>
          <p class="ms-voice-api-card__hint">${escapeHtml(modelHintText(profile))}</p>
          <p class="ms-voice-api__result" hidden></p>
          ${profile.builtin ? "" : '<button type="button" class="ms-voice-api-card__remove" data-ms-voice-action="remove">删除此配置</button>'}
        </div>
        <section class="ms-voice-api-card__models" data-ms-model-section>${renderModelSection(profile)}</section>
      </article>`;
  }

  function renderSection(force = false) {
    installStyles();
    const body = settingsBody();
    if (!body || !voiceState) return;
    if (!section || !section.isConnected) {
      section = document.getElementById(SECTION_ID) || document.createElement("section");
      section.id = SECTION_ID;
    }
    section.className = "settings-section";
    const active = activeVoiceProfile();
    const nextHtml = `
      <div class="settings-section__header">
        <h3>语音API来源设置</h3>
        <p>为画布「语音节点」单独配置 API，界面与「文本API来源设置」一致：内置云雾 + 任意第三方，同时只启用一个。云雾的语音接口需自行填写 Key 与 Base URL，留空则沿用画布原生语音链路。</p>
      </div>
      <div class="ms-voice-api__body">
        <div class="ms-voice-api__toolbar">
          <div class="ms-voice-api__status">
            <span class="ms-voice-api__dot"></span>
            <span>当前启用：${escapeHtml(active?.name || "未配置")}</span>
          </div>
          <button type="button" class="ms-voice-api__add" data-ms-voice-action="add">＋ 新增第三方 API</button>
        </div>
        <p class="ms-voice-api__message" role="status" aria-live="polite"></p>
        <div class="ms-voice-api__list">${voiceState.profiles.map((profile) => renderCard(profile)).join("")}</div>
        <p class="ms-voice-api__footnote">
          同一时间只会启用一个语音配置；启用云雾但未填密钥或 Base URL 时，语音节点保持画布原生行为。配置与密钥只保存在当前浏览器 localStorage["${VOICE_PROFILES_KEY}"]。
          浏览器直连第三方被跨域拦截时会自动改走本机 server.py 的 ${PROXY_PREFIX} 转发，使用第三方地址请保持 start.bat 处于运行状态。
        </p>
      </div>
    `;
    if (force || section.__msVoiceHtml !== nextHtml) {
      section.innerHTML = nextHtml;
      section.__msVoiceHtml = nextHtml;
    }
    if (section.parentElement !== body || body.lastElementChild !== section) body.appendChild(section);
    voiceState.profiles.forEach((profile) => applyStatusToDom(profile.id));
  }
  function activate() {
    const body = settingsBody();
    if (!body || !voiceState) return;
    if (!mountTabButton()) {
      showStatus("尚未找到 API 来源设置入口，请重新打开设置面板。", "error");
      return;
    }
    voiceActive = true;
    document
      .querySelectorAll(".settings-sidebar__nav .settings-sidebar__item")
      .forEach((item) => item.classList.remove("is-active"));
    tabButton.classList.add("is-active");
    renderSection(true);
    body.classList.add(VIEW_CLASS);
    body.scrollTop = 0;
  }

  function deactivate() {
    voiceActive = false;
    settingsBody()?.classList.remove(VIEW_CLASS);
    tabButton?.classList.remove("is-active");
    section?.remove();
    section = null;
  }

  function sync() {
    syncQueued = false;
    const body = settingsBody();
    const nav = settingsNav();
    if (!body || !nav) {
      if (modalWasOpen) {
        modalWasOpen = false;
        voiceActive = false;
        tabButton = null;
        section = null;
      }
      return;
    }
    if (!modalWasOpen) {
      modalWasOpen = true;
      voiceActive = false;
    }
    // ComfyUI / 文本 / 视频分区接管 body 时让位，避免多个 tab 同时占住面板
    if (
      voiceActive &&
      (body.classList.contains(COMFY_VIEW_CLASS) ||
        body.classList.contains(TEXT_VIEW_CLASS) ||
        body.classList.contains(VIDEO_VIEW_CLASS))
    ) {
      voiceActive = false;
    }
    mountTabButton();
    if (voiceActive && tabButton) {
      tabButton.classList.add("is-active");
      renderSection();
      body.classList.add(VIEW_CLASS);
    } else {
      body.classList.remove(VIEW_CLASS);
      if (section) {
        section.remove();
        section = null;
      }
    }
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    window.requestAnimationFrame(sync);
  }

  function cardFor(target) {
    const card = target?.closest?.("[data-voice-id]");
    if (!card) return null;
    const profile = profileFor(card.dataset.voiceId);
    return profile ? { card, profile } : null;
  }

  function extractModelIds(payload) {
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
    const ids = raw
      .map((item) =>
        typeof item === "string" ? item : String(item?.id || item?.name || item?.model || "").trim(),
      )
      .filter(Boolean);
    return [...new Set(ids)];
  }

  // 浏览器直连第三方语音 API 常被 CORS 拦掉；失败时改走本机 server.py 转发，
  // 两条路都失败才报错，不静默假装成功。
  async function requestUpstream(url, init) {
    let directError = null;
    try {
      return await innerFetch(url, init);
    } catch (error) {
      directError = error;
    }
    const proxied = `${PROXY_PREFIX}proxy?url=${encodeURIComponent(url)}`;
    let response;
    try {
      response = await innerFetch(proxied, { ...init, mode: "same-origin" });
    } catch (proxyError) {
      throw new Error(
        `请求失败：${directError?.message || directError}；本机转发同样失败（${
          proxyError?.message || proxyError
        }），请确认 start.bat 已启动。`,
      );
    }
    // 旧版 server.py 没有 /__textapi/，会回 404「接口不存在」；这里翻成可执行的中文提示
    if (response.status === 404) {
      const text = await response.clone().text().catch(() => "");
      if (text.includes("接口不存在")) {
        throw new Error("本机 server.py 还是旧版本，未包含 API 转发接口，请重启 start.bat 后再试。");
      }
    }
    return response;
  }

  function effectiveBase(profile) {
    return normalizeBaseUrl(profile.baseUrl) || (profile.builtin ? normalizeBaseUrl(DEFAULT_BASE_URL) : "");
  }

  async function fetchModels(profile, afterRender = true) {
    const base = effectiveBase(profile);
    if (!base) {
      setStatus(profile.id, "请先填写接口地址（Base URL）。", "error");
      return;
    }
    const fetchKey = nativeVoiceKey(profile);
    if (!fetchKey) {
      setStatus(profile.id, "请先填写 API 密钥（云韾卡留空则沿用画布图片 API 的云韾密钥）。", "error");
      return;
    }
    runtime.loading.add(profile.id);
    setStatus(profile.id, "正在拉取模型列表…", "muted");
    if (afterRender) applyStatusToDom(profile.id);
    const headers = { Accept: "application/json", Authorization: `Bearer ${fetchKey}` };
    const candidates = [`${base}/v1/models`, `${base}/models`];
    let models = [];
    let failure = "";
    for (const candidate of candidates) {
      try {
        const response = await requestUpstream(candidate, { method: "GET", headers, credentials: "omit" });
        const text = await response.text();
        if (!response.ok) {
          failure = `HTTP ${response.status}：${text.slice(0, 160)}`;
          continue;
        }
        let payload = null;
        try {
          payload = JSON.parse(text);
        } catch {
          failure = "返回内容不是 JSON，请确认 Base URL 指向接口根地址。";
          continue;
        }
        models = extractModelIds(payload);
        if (models.length) break;
        failure = "模型列表为空。";
      } catch (error) {
        failure = error?.message || String(error);
      }
    }
    runtime.loading.delete(profile.id);
    if (!models.length) {
      profile.modelsError = failure || "未能获取模型列表。";
      setStatus(profile.id, `拉取失败：${profile.modelsError}`, "error");
      refreshModelUi(profile);
      return;
    }
    profile.modelCatalog = models;
    profile.selectedModels = uniqueStringList(profile.selectedModels).filter((model) => models.includes(model));
    profile.modelsError = "";
    profile.modelsBaseUrl = base;
    profile.modelsFetchedAt = Date.now();
    if (profile.voiceModel && !models.includes(profile.voiceModel)) profile.voiceModel = "";
    saveVoiceState();
    const voiceCount = models.filter(isVoiceModel).length;
    setStatus(profile.id, `已拉取 ${models.length} 个模型，其中 ${voiceCount} 个可作为语音模型。`, "ok");
    refreshModelUi(profile);
  }

  function scheduleModelsFetch(profile) {
    const previous = runtime.timers.get(profile.id);
    if (previous) window.clearTimeout(previous);
    if (!effectiveBase(profile) || !nativeVoiceKey(profile)) return;
    const timer = window.setTimeout(() => {
      runtime.timers.delete(profile.id);
      const current = profileFor(profile.id);
      if (current) void fetchModels(current);
    }, MODELS_DEBOUNCE_MS);
    runtime.timers.set(profile.id, timer);
  }

  async function openApplyUrl(url) {
    if (!url) {
      showStatus("请先填写申请地址。", "error");
      return;
    }
    try {
      if (window.electronAPI?.openExternalUrl) {
        await window.electronAPI.openExternalUrl(url);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      showStatus("申请页面未能打开，请检查地址或浏览器弹窗权限。", "error");
    }
  }
  /* ---------- 语音节点请求改写 ---------- */

  // 画布语音节点走 bundle 内部函数取厂商配置，而厂商表里只有 yunwu：
  // 缺 minimax 时它直接抛 Missing vendor config，语音节点根本发不出请求。
  // 因此启用语音配置时做两件事：
  //   1) 把 minimax 注册进 bundle 厂商表与 vendorConfigs，并加入它自己的隐藏集合，
  //      避免原生设置面板多冒出一张厂商卡；
  //   2) 包装 fetch 改写语音端点，直连被跨域拦掉时回退本机 /__textapi/ 转发。
  const innerFetch = window.fetch.bind(window);
  const NATIVE_VOICE_VENDOR_ID = "minimax";
  const NATIVE_VOICE_VENDOR_LABEL = "语音服务";
  const CANVAS_SETTINGS_KEY = "canvas-api-settings";
  const API_PROFILES_KEY = "manshiguang:canvas-api-profiles";

  function readCanvasStore() {
    try {
      return typeof window.Jh === "function" && typeof window.Jh.getState === "function"
        ? window.Jh
        : null;
    } catch {
      return null;
    }
  }

  function readVendorRegistry() {
    try {
      return window.vm && typeof window.vm === "object" ? window.vm : null;
    } catch {
      return null;
    }
  }

  // bundle 用这个 Set 决定哪些厂商不在原生面板展示，借来避免注入后多冒卡。
  function readHiddenVendors() {
    try {
      return window.gm instanceof Set ? window.gm : null;
    } catch {
      return null;
    }
  }

  // 语音厂商不会自动补 /v1，注入的地址必须是完整接口根。
  function voiceApiRoot(base) {
    const normalized = normalizeBaseUrl(base);
    if (!normalized) return "";
    return /\/v\d+(?:beta\d*)?$/i.test(normalized) ? normalized : normalized + "/v1";
  }
  // 云雾卡允许密钥留空：回退到画布原生配置里的云雾密钥（与图片 API 同一把 Key）。
  function nativeVoiceKey(profile) {
    const own = String(profile?.apiKey || "").trim();
    if (own) return own;
    if (!profile?.builtin) return "";
    // 运行时 store 才是画布当前真正使用的配置；localStorage 在重载/迁移后
    // 可能已被 bundle 改写成其它形态，只能作为兜底。
    try {
      const store = readCanvasStore();
      const runtimeKey = String(
        store?.getState?.()?.vendorConfigs?.[BUILTIN_ID]?.apiKey || "",
      ).trim();
      if (runtimeKey) return runtimeKey;
    } catch {}
    try {
      const raw = window.localStorage.getItem(API_PROFILES_KEY);
      const profiles = raw ? JSON.parse(raw)?.profiles : null;
      const profileKey = Array.isArray(profiles)
        ? String(profiles.find((item) => item?.id === BUILTIN_ID)?.apiKey || "").trim()
        : "";
      if (profileKey) return profileKey;
    } catch {}
    try {
      const raw = window.localStorage.getItem(CANVAS_SETTINGS_KEY);
      const persisted = raw ? JSON.parse(raw) : null;
      const persistedKey = String(
        persisted?.state?.vendorConfigs?.[BUILTIN_ID]?.apiKey || "",
      ).trim();
      if (persistedKey) return persistedKey;
    } catch {}
    // bundle 初始化时可能重写 canvas-api-settings 并抹掉云雾配置；
    // minimax 是本补丁刚写入的隐藏语音厂商，Key 与云雾卡一致，可用来恢复。
    try {
      const store = readCanvasStore();
      const recoveredRuntimeKey = String(
        store?.getState?.()?.vendorConfigs?.[NATIVE_VOICE_VENDOR_ID]?.apiKey || "",
      ).trim();
      if (recoveredRuntimeKey) return recoveredRuntimeKey;
    } catch {}
    try {
      const raw = window.localStorage.getItem(CANVAS_SETTINGS_KEY);
      const persisted = raw ? JSON.parse(raw) : null;
      return String(
        persisted?.state?.vendorConfigs?.[NATIVE_VOICE_VENDOR_ID]?.apiKey || "",
      ).trim();
    } catch {
      return "";
    }
  }

  function effectiveVoiceBase(profile) {
    return profile ? effectiveBase(profile) : "";
  }

  function canUseVoiceProfile(profile) {
    if (!profile) return false;
    return Boolean(effectiveVoiceBase(profile) && nativeVoiceKey(profile));
  }

  // 把语音厂商写进 bundle：bundle 内部按厂商 id 取 Key 与 Base URL，
  // 不注册就发不出请求。返回 false 表示运行时拿不到 bundle 内部对象，
  // 调用方必须明确报错，不能假装接管成功。
  function applyNativeVoiceVendor(profile) {
    if (!canUseVoiceProfile(profile)) return false;
    const registry = readVendorRegistry();
    const store = readCanvasStore();
    const root = voiceApiRoot(effectiveVoiceBase(profile));
    const apiKey = nativeVoiceKey(profile);
    if (!registry || !store || !root || !apiKey) return false;
    registry[NATIVE_VOICE_VENDOR_ID] = {
      id: NATIVE_VOICE_VENDOR_ID,
      name: NATIVE_VOICE_VENDOR_LABEL,
      baseUrl: root,
      authType: "Bearer",
    };
    readHiddenVendors()?.add?.(NATIVE_VOICE_VENDOR_ID);
    store.setState({
      vendorConfigs: {
        ...(store.getState().vendorConfigs || {}),
        [NATIVE_VOICE_VENDOR_ID]: { enabled: true, apiKey, baseUrlOverride: root },
      },
    });
    return true;
  }

  function clearNativeVoiceVendor() {
    const registry = readVendorRegistry();
    const store = readCanvasStore();
    if (registry) delete registry[NATIVE_VOICE_VENDOR_ID];
    if (store) {
      const configs = { ...(store.getState().vendorConfigs || {}) };
      delete configs[NATIVE_VOICE_VENDOR_ID];
      store.setState({ vendorConfigs: configs });
    }
  }

  // bundle 的语音请求形如 https://<base>/t2a_v2，端点识别只认这个尾巴。
  function isVoiceEndpoint(rawUrl) {
    return /\/t2a_v2\/?$/i.test(String(rawUrl || "").split("?")[0]);
  }

  // 勾选集合决定最终发出去的模型名：节点原本选的若已勾选就沿用，
  // 否则退到「模型名」输入框，第三方再兜底第一个勾选项。
  function pickVoiceModel(profile, requested) {
    const selected = selectedVoiceModels(profile);
    const typed = String(profile.voiceModel || "").trim();
    const want = String(requested || "");
    let next = "";
    if (selected.length) {
      if (selected.includes(want)) next = want;
      else if (selected.includes(typed)) next = typed;
      else next = selected[0];
    }
    if (!next && typed) next = typed;
    return next;
  }
  /* ---------- 语音协议适配 ---------- */
  // 画布语音节点固定发 MiniMax 协议（POST <base>/t2a_v2，响应要求 { data: { audio: hex } }）。
  // 云雾网关上的语音模型是 gemini-*-tts，只认 Gemini 原生端点并返回 base64；
  // 直接打 /t2a_v2 会 503 protocol_unsupported。这里按模型名决定尝试顺序，
  // 任一协议拿到音频就回灌成节点认识的 MiniMax 结构，全部失败才合并报错。
  const GEMINI_DEFAULT_VOICE = "Kore";
  const OPENAI_DEFAULT_VOICE = "alloy";

  function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  function base64ToBytes(value) {
    const binary = window.atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function voiceOrigin(root) {
    try {
      return new URL(root).origin;
    } catch {
      return "";
    }
  }
  // MiniMax 的 voice_id（如 zh）与 Gemini / [OI] 音色名不通用：能识别就透传，
  // 否则退回该协议的默认音色，避免整条请求只因音色名不匹配而失败。
  function geminiVoiceName(value) {
    const text = String(value || "").trim();
    return /^[A-Z][A-Za-z]+$/.test(text) ? text : GEMINI_DEFAULT_VOICE;
  }

  function openaiVoiceName(value) {
    const text = String(value || "").trim();
    return /^[a-z][a-z0-9_-]{1,31}$/i.test(text) && !/^zh$/i.test(text) ? text : OPENAI_DEFAULT_VOICE;
  }

  function mimeToFormat(mime) {
    const text = String(mime || "").toLowerCase();
    if (text.includes("wav")) return "wav";
    if (text.includes("ogg")) return "ogg";
    if (text.includes("flac")) return "flac";
    if (text.includes("pcm")) return "pcm";
    return "mp3";
  }

  function hexToBytes(hex) {
    const text = String(hex || "").replace(/[^0-9a-f]/gi, "");
    const bytes = new Uint8Array(Math.floor(text.length / 2));
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }
  function voiceText(payload) {
    return String(payload?.text || "").trim();
  }

  function geminiVoiceBody(text, voiceName, nested) {
    const generationConfig = { responseModalities: ["AUDIO"] };
    const voiceConfig = { prebuiltVoiceConfig: { voiceName } };
    if (nested) generationConfig.speechConfig = { voiceConfig };
    else generationConfig.voiceConfig = voiceConfig;
    return { contents: [{ role: "user", parts: [{ text }] }], generationConfig };
  }

  function geminiInlineAudio(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      const data = typeof inline?.data === "string" ? inline.data.trim() : "";
      if (data) return { data, mime: inline?.mimeType || inline?.mime_type || "" };
    }
    return null;
  }
  // Gemini 返回 200+JSON 却没有 inlineData 时，把响应里的诊断字段抽出来，
  // 否则只剩「没有返回音频数据」看不出是安全拦截 / 额度 / 模型不是 TTS / 空补全。
  function geminiNoAudioHint(payload) {
    const bits = [];
    if (!payload || typeof payload !== "object") return "（响应不是 JSON 对象）";
    bits.push("顶层字段=[" + Object.keys(payload).join(",") + "]");
    const candidate = payload?.candidates?.[0];
    if (candidate?.finishReason) bits.push("finishReason=" + candidate.finishReason);
    const block = payload?.promptFeedback?.blockReason;
    if (block) bits.push("blockReason=" + block);
    const err = payload?.error?.message || payload?.error || payload?.message;
    if (err) bits.push("error=" + String(typeof err === "object" ? JSON.stringify(err) : err).slice(0, 160));
    // Gemini 原生：candidates[0].content.parts[]
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      const shapes = parts.map(p => Object.keys(p || {}).join("/")).join(" , ");
      bits.push("parts结构=[" + shapes.slice(0, 160) + "]");
      const text = parts.map(p => (typeof p?.text === "string" ? p.text : "")).join("").trim();
      if (text) bits.push("仅文本=" + text.slice(0, 60));
    }
    // OpenAI chat/completions 信封：choices[0].message.audio.data（base64）
    const choice = payload?.choices?.[0];
    if (choice) {
      const audio = choice?.message?.audio;
      if (audio && typeof audio.data === "string" && audio.data.length) {
        bits.push("★choices[0].message.audio 有 base64 音频(" + audio.data.length + " 字符, fmt=" + (audio.format || "?") + ")，本补丁按 Gemini 结构解析所以漏读");
      } else {
        bits.push("choices[0].message keys=[" + Object.keys(choice?.message || {}).join(",") + "]");
      }
    }
    // 钻到 data 内部（openlux images 风格信封）
    const dv = payload?.data;
    if (typeof dv === "string") bits.push("data=base64串(" + dv.length + " 字符)");
    else if (Array.isArray(dv)) bits.push("data[]长度=" + dv.length + " 首项键=[" + Object.keys(dv[0] || {}).join(",") + "]");
    else if (dv && typeof dv === "object") bits.push("data对象键=[" + Object.keys(dv).join(",") + "]");
    if (payload?.output?.length) bits.push("有 output 数组(Responses 风格)");
    return "（" + bits.join(" · ") + "）";
  }

  // openlux 等网关会把 gemini tts 输出包成 OpenAI images 风格 {created, data:[{b64_json|url}]}，
  // 而非官方 candidates。这里兼容多种字段名，返回 {base64} 或 {url}，取不到返回 null。
  function head(v) { return String(v == null ? "" : v).slice(0, 48); }
  function geminiRawShape(payload) {
    const info = { topKeys: Object.keys(payload || {}) };
    const dv = payload?.data;
    if (Array.isArray(dv)) {
      info.dataLen = dv.length;
      info.data0 = dv[0] && typeof dv[0] === "object"
        ? Object.fromEntries(Object.entries(dv[0]).map(([k, v]) => [k, typeof v === "string" ? head(v) + `…(${v.length})` : v]))
        : head(dv[0]);
    } else if (dv && typeof dv === "object") {
      info.dataKeys = Object.keys(dv);
      info.dataSample = Object.fromEntries(Object.entries(dv).map(([k, v]) => [k, typeof v === "string" ? head(v) + `…(${v.length})` : v]));
    } else {
      info.dataType = typeof dv;
      info.dataHead = head(dv);
    }
    const ch = payload?.choices?.[0]?.message;
    if (ch) info.messageKeys = Object.keys(ch);
    if (payload?.error) info.error = payload.error;
    return info;
  }

  function pickAudioFromEnvelope(payload) {
    const raw = payload?.data;
    const items = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? [raw] : (typeof raw === "string" ? [raw] : []));
    for (const item of items) {
      if (typeof item === "string") {
        if (/^https?:/i.test(item)) return { url: item };
        if (item.length > 64) return { base64: item };
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const b64 = item.b64_json || item.audio_base64 || item.audio || item.data;
      if (typeof b64 === "string" && b64.length > 64) return { base64: b64, mime: item.mime_type || item.mimeType };
      const url = item.url || item.audio_url || item.signed_url;
      if (typeof url === "string" && /^https?:/i.test(url)) return { url, mime: item.mime_type || item.mimeType };
    }
    return null;
  }

  // OpenAI chat/completions 信封：choices[0].message.audio.data(base64) 或 .url
  function pickAudioFromChoices(payload) {
    const audio = payload?.choices?.[0]?.message?.audio;
    if (!audio || typeof audio !== "object") return null;
    if (typeof audio.data === "string" && audio.data.length > 64) return { base64: audio.data, mime: audio.mime_type };
    if (typeof audio.url === "string" && /^https?:/i.test(audio.url)) return { url: audio.url };
    return null;
  }

  // 按文件头识别真实容器；识别不了当作裸 PCM（Gemini 原生输出），补 WAV 头。
  function sniffAudioFormat(bytes) {
    const head = [...bytes.slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = String.fromCharCode(...bytes.slice(0, 4));
    const tag = { len: bytes.length, head, ascii };
    if (ascii === "RIFF") return { format: "wav", tag };
    if (ascii === "OggS") return { format: "ogg", tag };
    if (ascii === "fLaC") return { format: "flac", tag };
    if (ascii === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { format: "mp3", tag };
    // 图片：网关把 TTS 请求路由到出图渠道时会返回这些
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { format: "image", kind: "png", tag };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { format: "image", kind: "jpg", tag };
    if (ascii === "GIF8") return { format: "image", kind: "gif", tag };
    if (ascii === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { format: "image", kind: "webp", tag };
    return { format: null, tag }; // 无容器头：裸 PCM
  }

  function wrapPcmToWav(pcm, sampleRate, channels) {
    const rate = sampleRate || 24000, ch = channels || 1;
    const out = new Uint8Array(44 + pcm.length);
    const dv = new DataView(out.buffer);
    const ascii = (off, s) => { for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i); };
    ascii(0, "RIFF"); dv.setUint32(4, 36 + pcm.length, true); ascii(8, "WAVE");
    ascii(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    ascii(36, "data"); dv.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  }

  // data 里可能是远端音频 URL，取回成字节并按真实格式返回。
  async function fetchAudioBytes(url, key) {
    const resp = await requestUpstream(url, { method: "GET", headers: key ? { Authorization: "Bearer " + key } : {}, credentials: "omit" });
    if (!resp.ok) throw new Error("音频下载失败 HTTP " + resp.status);
    const type = resp.headers.get("Content-Type") || "";
    const buf = await resp.arrayBuffer();
    if (!buf.byteLength) throw new Error("音频下载为空");
    const bytes = new Uint8Array(buf);
    const sniff = sniffAudioFormat(bytes);
    if (sniff.format === "image") {
      throw new Error("网关返回的是图片(" + (sniff.kind || type || "image") + ")，不是音频——该模型在此渠道被当成出图处理，没有走语音输出，请换其它 TTS 模型或稍后重试");
    }
    // HTML/JSON 错误页：前 4 字节是 "<" 或 "{"，明确报错而不是存成坏文件
    const ascii4 = sniff.tag.ascii;
    if (ascii4.startsWith("<") || ascii4.startsWith("{")) {
      throw new Error("音频 URL 返回的不是音频（疑似错误页/JSON）：" + String.fromCharCode(...bytes.slice(0, 80)));
    }
    if (sniff.format) return { bytes, format: sniff.format };
    // 裸 PCM：按 Gemini 原生 24k 单声道补 WAV 头
    return { bytes: wrapPcmToWav(bytes, 24000, 1), format: "wav" };
  }

  // 协议二：Gemini 原生 generateContent。云雾的 gemini-*-tts 只认这条，
  // 返回 candidates[0].content.parts[].inlineData(base64 + mimeType)。
  async function tryGeminiVoice(ctx) {
    const origin = voiceOrigin(ctx.root);
    const model = String(ctx.model || "").replace(/^models\//i, "");
    if (!origin || !model) return { ok: false, error: "缺少 Gemini 端点或模型名。" };
    const customVoice = String(ctx.profile?.voiceName || "").trim();
    const voice = customVoice || geminiVoiceName(ctx.payload?.voice_setting?.voice_id);
    const text = voiceText(ctx.payload);
    const url = origin + "/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
    const attempts = [false, true];
    let lastError = "";
    for (const nested of attempts) {
      const response = await requestUpstream(url, {
        method: "POST",
        headers: voiceJsonHeaders(ctx.key),
        body: JSON.stringify(geminiVoiceBody(text, voice, nested)),
        credentials: "omit",
      });
      if (!response.ok) {
        lastError = "Gemini " + (await voiceFailureText(response));
        continue;
      }
      let data = null;
      try {
        data = await response.json();
      } catch {
        lastError = "Gemini 返回内容不是 JSON。";
        continue;
      }
      const audio = geminiInlineAudio(data);
      if (audio) {
        return { ok: true, bytes: base64ToBytes(audio.data), format: mimeToFormat(audio.mime) };
      }
      // 官方结构没有 → 试网关常见信封（{created,data} images 风格 / choices[].message.audio）
      const env = pickAudioFromEnvelope(data) || pickAudioFromChoices(data);
      if (env) {
        try {
          if (env.base64) {
            const b = base64ToBytes(env.base64);
            const s = sniffAudioFormat(b);
            if (s.format === "image") throw new Error("网关返回的是图片(" + (s.kind || "image") + ")，不是音频，该模型未走语音输出");
            return { ok: true, bytes: s.format ? b : wrapPcmToWav(b, 24000, 1), format: s.format || "wav" };
          }
          const fetched = await fetchAudioBytes(env.url, ctx.key);
          return { ok: true, bytes: fetched.bytes, format: fetched.format };
        } catch (e) {
          lastError = "Gemini 信封里有音频但取回失败：" + ((e && e.message) || e);
          continue;
        }
      }
      lastError = "Gemini 没有返回音频数据" + geminiNoAudioHint(data) + "。";
    }
    return { ok: false, error: lastError || "Gemini 生成失败。" };
  }
  // 协议三：[OI] /v1/audio/speech，返回音频二进制本身。
  async function tryOpenAiSpeechVoice(ctx) {
    const base = voiceApiRoot(effectiveVoiceBase(ctx.profile));
    if (!base) return { ok: false, error: "缺少接口地址。" };
    const customVoice = String(ctx.profile?.voiceName || "").trim();
    const voice = customVoice || openaiVoiceName(ctx.payload?.voice_setting?.voice_id);
    const body = { model: ctx.model, input: voiceText(ctx.payload), voice };
    const response = await requestUpstream(base + "/audio/speech", {
      method: "POST",
      headers: voiceJsonHeaders(ctx.key, "audio/*"),
      body: JSON.stringify(body),
      credentials: "omit",
    });
    if (!response.ok) return { ok: false, error: "[OI] 语音 " + (await voiceFailureText(response)) };
    const type = response.headers.get("Content-Type") || "";
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return { ok: false, error: "[OI] 语音没有返回音频数据。" };
    return { ok: true, bytes: new Uint8Array(buffer), format: mimeToFormat(type) };
  }
  // 模型名能看出厂商时优先走对应协议，其余按 MiniMax → Gemini → [OI] 兜底。
  function voiceProtocolOrder(ctx) {
    const model = String(ctx.model || "").toLowerCase();
    if (model.includes("gemini")) return ["gemini", "minimax", "openai"];
    if (model.includes("eleven")) return ["openai", "minimax", "gemini"];
    if (model.includes("minimax") || model.includes("speech-") || model.includes("hailuo")) return ["minimax", "openai"];
    return ["minimax", "gemini", "openai"];
  }

  async function generateVoiceAudio(ctx) {
    const runners = {
      minimax: () => tryMiniMaxVoice(ctx),
      gemini: () => tryGeminiVoice(ctx),
      openai: () => tryOpenAiSpeechVoice(ctx),
    };
    const errors = [];
    for (const name of voiceProtocolOrder(ctx)) {
      try {
        const result = await runners[name]();
        if (result.ok) return result;
        if (result.error) errors.push(result.error);
      } catch (error) {
        errors.push(`${name}：${error?.message || String(error)}`);
      }
    }
    throw new Error(`语音生成失败（模型「${ctx.model || "未选定"}」）。${errors.join("；")}`);
  }
  // 回灌成节点认识的 MiniMax 响应结构，节点自己会把 hex 还原成 Blob。
  function voiceResponseFromAudio(result) {
    return new Response(
      JSON.stringify({
        data: { audio: bytesToHex(result.bytes) },
        extra_info: { audio_format: result.format || "mp3", audio_length: result.bytes.length },
        base_resp: { status_code: 0, status_msg: "success" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  window.fetch = async function patchedVoiceApiFetch(input, init) {
    let ctx = null;
    try {
      ctx = buildVoiceRewrite(input, init);
    } catch {
      ctx = null;
    }
    if (!ctx) return innerFetch(input, init);
    try {
      return voiceResponseFromAudio(await generateVoiceAudio(ctx));
    } catch (error) {
      return new Response(
        JSON.stringify({ error: { message: error?.message || String(error) } }),
        { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } },
      );
    }
  };
  function buildVoiceRewrite(input, init) {
    const profile = activeVoiceProfile();
    if (!canUseVoiceProfile(profile)) return null;
    const rawUrl =
      typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    if (!rawUrl) return null;
    if (rawUrl.startsWith(PROXY_PREFIX) || rawUrl.includes(PROXY_PREFIX + "proxy")) return null;
    if (!isVoiceEndpoint(rawUrl)) return null;
    if (typeof init?.body !== "string") return null;
    let payload = null;
    try {
      payload = JSON.parse(init.body);
    } catch {
      return null;
    }
    if (!payload || typeof payload !== "object" || typeof payload.text !== "string") return null;
    if (!payload.text.trim()) return null;
    const model = pickVoiceModel(profile, payload.model);
    if (model) payload.model = model;
    return {
      profile,
      payload,
      model: model || String(payload.model || "").trim(),
      key: nativeVoiceKey(profile),
      root: voiceApiRoot(effectiveVoiceBase(profile)),
    };
  }
  function voiceJsonHeaders(key, accept) {
    return {
      "Content-Type": "application/json",
      Accept: accept || "application/json",
      Authorization: "Bearer " + key,
    };
  }

  async function voiceFailureText(response) {
    const text = await response.text().catch(() => "");
    try {
      const parsed = JSON.parse(text);
      const message =
        parsed?.error?.message || parsed?.base_resp?.status_msg || parsed?.message || parsed?.detail || "";
      if (message) return `HTTP ${response.status}：${String(message).slice(0, 200)}`;
    } catch {}
    return `HTTP ${response.status}：${String(text || "").slice(0, 200)}`;
  }

  function minimaxEndpointCandidates(ctx) {
    const urls = [];
    try {
      const origin = new URL(ctx.root).origin;
      // openlux 网关按厂商前缀路由 MiniMax：https://api.openlux.ai/minimax/v1/t2a_v2
      if (/openlux\.ai/i.test(origin)) urls.push(origin + "/minimax/v1/t2a_v2");
    } catch (_) { /* 非标准 root 就只走兜底 */ }
    urls.push(ctx.root + "/t2a_v2");
    return [...new Set(urls)];
  }

  // 协议一：MiniMax /t2a_v2，节点原生格式，命中真实 MiniMax 或兼容网关时直接可用。
  async function tryMiniMaxVoice(ctx) {
    const body = { ...ctx.payload, output_format: "hex" };
    if (ctx.model) body.model = ctx.model;
    let response = null;
    let lastError = "";
    for (const endpoint of minimaxEndpointCandidates(ctx)) {
      response = await requestUpstream(endpoint, {
        method: "POST",
        headers: voiceJsonHeaders(ctx.key),
        body: JSON.stringify(body),
        credentials: "omit",
      });
      // 404 Invalid URL = 网关没这个路径，换下一个候选端点再试
      if (response.status === 404) { lastError = "MiniMax " + (await voiceFailureText(response)); continue; }
      break;
    }
    if (!response.ok) return { ok: false, error: "MiniMax " + (await voiceFailureText(response)) };
    let data = null;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: "MiniMax 返回内容不是 JSON。" };
    }
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return { ok: false, error: "MiniMax：" + (data.base_resp.status_msg || "生成失败") };
    }
    const hex = typeof data?.data?.audio === "string" ? data.data.audio.trim() : "";
    if (!hex) return { ok: false, error: "MiniMax 没有返回音频数据。" };
    return { ok: true, bytes: hexToBytes(hex), format: data?.extra_info?.audio_format || "mp3" };
  }

  /* ---------- 事件 ---------- */

  function handleClick(event) {
    const navItem = event.target?.closest?.(".settings-sidebar__item");
    if (navItem) {
      if (navItem.id === TAB_ID) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      } else if (voiceActive) {
        deactivate();
      }
      return;
    }
    if (!section || !section.contains(event.target)) return;
    const button = event.target.closest("[data-ms-voice-action]");
    if (!button) return;
    const action = button.dataset.msVoiceAction;

    if (action === "add") {
      event.preventDefault();
      event.stopPropagation();
      const profile = blankProfile(voiceState.profiles.filter((item) => !item.builtin).length + 1);
      voiceState.profiles.push(profile);
      saveVoiceState();
      renderSection(true);
      showStatus(`已添加「${profile.name}」，填写密钥与 Base URL 后点「启用」。`);
      return;
    }

    const found = cardFor(button);
    if (!found) return;
    const { profile } = found;
    event.preventDefault();
    event.stopPropagation();

    if (action === "toggle-secret") {
      const input = button
        .closest(".ms-voice-api-card__secret")
        ?.querySelector('[data-ms-voice-field="apiKey"]');
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      const secretLabel = visible ? "隐藏 API 密钥" : "显示 API 密钥";
      button.setAttribute("aria-label", secretLabel);
      button.title = secretLabel;
      return;
    }
    if (action === "enable") {
      if (voiceState.activeId === profile.id) return;
      const missing = [];
      if (!nativeVoiceKey(profile)) missing.push("API 密钥");
      if (!effectiveBase(profile)) missing.push("Base URL");
      // 内置云雾的模型名可留空（沿用画布自带的云雾语音模型），第三方必须显式选定
      if (!profile.builtin && !profile.voiceModel.trim() && !selectedVoiceModels(profile).length) {
        missing.push("语音模型（勾选模型或填写模型名）");
      }
      if (missing.length) {
        setStatus(profile.id, "启用前请先填写：" + missing.join("、") + "。", "error");
        showStatus("该配置还缺少" + missing.join("、") + "，暂不能启用。", "error");
        return;
      }
      voiceState.activeId = profile.id;
      saveVoiceState();
      renderSection(true);
      showStatus(`已启用「${profile.name}」，画布语音节点将改用该配置。`);
      return;
    }
    if (action === "apply") {
      void openApplyUrl(profile.applyUrl.trim());
      return;
    }
    if (action === "models" || action === "models-refresh") {
      void fetchModels(profile);
      return;
    }

    if (action === "models-voice") {
      profile.selectedModels = profile.modelCatalog.filter(isVoiceModel);
      if (!profile.voiceModel) profile.voiceModel = profile.selectedModels[0] || "";
      saveVoiceState();
      refreshModelUi(profile);
      showStatus(`已勾选 ${profile.selectedModels.length} 个语音模型。`);
      return;
    }

    if (action === "models-clear") {
      profile.selectedModels = [];
      saveVoiceState();
      refreshModelUi(profile);
      showStatus("已清空模型勾选；接管时将只使用「模型名」输入框里的模型。");
      return;
    }
    if (action === "remove") {
      if (profile.builtin) return;
      if (!window.confirm(`确认删除「${profile.name}」？`)) return;
      voiceState.profiles = voiceState.profiles.filter((item) => item.id !== profile.id);
      if (voiceState.activeId === profile.id) voiceState.activeId = BUILTIN_ID;
      runtime.status.delete(profile.id);
      const timer = runtime.timers.get(profile.id);
      if (timer) window.clearTimeout(timer);
      runtime.timers.delete(profile.id);
      saveVoiceState();
      renderSection(true);
      showStatus(`已删除「${profile.name}」。`);
    }
  }

  function handleInput(event) {
    const field = event.target?.closest?.("[data-ms-voice-field]");
    if (!field || !section?.contains(field)) return;
    const found = cardFor(field);
    if (!found) return;
    const key = field.dataset.msVoiceField;
    if (!["name", "apiKey", "baseUrl", "applyUrl", "voiceModel", "voiceName"].includes(key)) return;
    found.profile[key] = field.value;
    if (key === "name") {
      const label = found.card.querySelector(".ms-voice-api-card__name");
      if (label) label.textContent = field.value || "未命名语音 API";
    }
    if (key === "baseUrl" || key === "apiKey") scheduleModelsFetch(found.profile);
    saveVoiceState();
  }

  function handleChange(event) {
    const checkbox = event.target?.closest?.("[data-ms-voice-model]");
    if (!checkbox || !section?.contains(checkbox)) return;
    const found = cardFor(checkbox);
    if (!found) return;
    const { profile } = found;
    const allowed = new Set(profile.modelCatalog.filter(isVoiceModel));
    const selected = new Set(uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model)));
    if (checkbox.checked) selected.add(checkbox.dataset.msVoiceModel);
    else selected.delete(checkbox.dataset.msVoiceModel);
    profile.selectedModels = profile.modelCatalog.filter(
      (model) => allowed.has(model) && selected.has(model),
    );
    // 「模型名」保持与勾选一致：当前值失效就自动切到第一个勾选项。
    if (profile.voiceModel && !selected.has(profile.voiceModel) && profile.selectedModels.length) {
      profile.voiceModel = profile.selectedModels[0];
    } else if (!profile.voiceModel && profile.selectedModels.length) {
      profile.voiceModel = profile.selectedModels[0];
    }
    const input = found.card.querySelector('[data-ms-voice-field="voiceModel"]');
    if (input && input !== document.activeElement) input.value = profile.voiceModel;
    saveVoiceState();
    refreshModelUi(profile);
    setStatus(
      profile.id,
      profile.selectedModels.length
        ? `已勾选 ${profile.selectedModels.length} 个语音模型，当前使用 ${profile.voiceModel}。`
        : "尚未勾选语音模型，接管时只会使用「模型名」输入框的值。",
      profile.selectedModels.length ? "ok" : "muted",
    );
  }

  window.__MS_VOICE_API_PATCH__ = {
    version: "20261114-8",
    state: () => voiceState,
    active: () => voiceActive,
    open: () => {
      activate();
      return voiceActive;
    },
    close: deactivate,
    refresh: publishActiveVoice,
    // 节点标签显示用：bundle 默认 audioModelId（speech-2.8-hd）不在勾选集合时，
    // 实际发送走 pickVoiceModel 兜底；这里导出同一份判定，显示=实发。
    effectiveModel: (requested) => {
      const profile = activeVoiceProfile();
      if (!profile || !canUseVoiceProfile(profile)) return String(requested || "").trim();
      return pickVoiceModel(profile, requested) || String(requested || "").trim();
    },
    debug: () => {
      const profile = activeVoiceProfile();
      let persistedKey = "";
      try {
        const raw = window.localStorage.getItem(CANVAS_SETTINGS_KEY);
        persistedKey = String(JSON.parse(raw)?.state?.vendorConfigs?.[BUILTIN_ID]?.apiKey || "");
      } catch {}
      return {
        activeId: voiceState?.activeId || "",
        profile,
        canUse: canUseVoiceProfile(profile),
        base: profile ? voiceApiRoot(effectiveVoiceBase(profile)) : "",
        keyPresent: Boolean(nativeVoiceKey(profile)),
        persistedKeyPresent: Boolean(persistedKey.trim()),
        fetchName: window.fetch?.name || "",
        nativeTakeover: Boolean(window.__MS_VOICE_NATIVE_TAKEOVER__),
      };
    },
    rewrite: () => {
      const ctx = buildVoiceRewrite("https://api.openlux.ai/v1/t2a_v2", {
        method: "POST",
        body: JSON.stringify({ text: "probe", model: "gemini-3.8-flash-tts" }),
      });
      return ctx
        ? { ok: true, model: ctx.model, root: ctx.root, keyPresent: Boolean(ctx.key) }
        : { ok: false };
    },
    // 控制台探针：await __MS_VOICE_API_PATCH__.probe("模型名")
    // 用当前启用配置的 Key 实打 OpenAI speech / MiniMax t2a / Gemini 原生三种协议，
    // 原样返回各家 HTTP 状态 + Content-Type + 响应体（文本截断/二进制标注），
    // 据此判断网关到底走哪条协议、返回什么结构，而不是靠猜。
    probe: async (model) => {
      const profile = activeVoiceProfile();
      if (!profile) return { ok: false, error: "没有启用的语音配置" };
      const root = voiceApiRoot(effectiveVoiceBase(profile));
      const key = nativeVoiceKey(profile);
      const target = String(model || pickVoiceModel(profile, "") || "").trim();
      const out = { ok: true, model: target, root, keyPresent: Boolean(key), calls: {} };
      if (!target) { out.error = "没传模型名，且当前配置没有已勾选模型"; return out; }
      const safe = async (name, url, init) => {
        try {
          const resp = await requestUpstream(url, init);
          const type = resp.headers.get("Content-Type") || "";
          let body = "";
          if (/json|text|html/i.test(type)) body = (await resp.text()).slice(0, 700);
          else { const buf = await resp.arrayBuffer(); body = "<binary " + buf.byteLength + " bytes>"; }
          out.calls[name] = { status: resp.status, contentType: type, body };
        } catch (e) {
          out.calls[name] = { error: String((e && e.message) || e) };
        }
      };
      await safe("openai_speech", root + "/audio/speech", {
        method: "POST", headers: voiceJsonHeaders(key, "audio/*"), credentials: "omit",
        body: JSON.stringify({ model: target, input: "你好", voice: "alloy" }),
      });
      await safe("minimax_t2a", minimaxEndpointCandidates({ root })[0], {
        method: "POST", headers: voiceJsonHeaders(key), credentials: "omit",
        body: JSON.stringify({
          model: target, text: "你好", stream: false,
          voice_setting: { voice_id: "Chinese (Mandarin)_Lin_Xiao_Xia", speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 2 },
        }),
      });
      try {
        const origin = new URL(root).origin;
        await safe("gemini_native", origin + "/v1beta/models/" + encodeURIComponent(target) + ":generateContent", {
          method: "POST", headers: voiceJsonHeaders(key), credentials: "omit",
          body: JSON.stringify(geminiVoiceBody("你好", "Kore", true)),
        });
      } catch (e) { out.calls.gemini_native = { error: String((e && e.message) || e) }; }
      return out;
    },
    // 控制台：__MS_VOICE_API_PATCH__.voices().then(console.log)
    // 试各厂商前缀的「列音色」端点，找到能用的就把 voice id + 名字列出来，
    // 用户不用再凭空猜 voice_id。
    voices: async () => {
      const profile = activeVoiceProfile();
      if (!profile) return { ok: false, error: "没有启用的语音配置" };
      const root = voiceApiRoot(effectiveVoiceBase(profile));
      const key = nativeVoiceKey(profile);
      if (!root || !key) return { ok: false, error: "缺少 Base URL 或 Key" };
      const origin = voiceOrigin(root);
      const candidates = [
        root + "/voices",
        origin + "/elevenlabs/v1/voices",
        origin + "/v1/elevenlabs/voices",
        origin + "/eleven/v1/voices",
      ];
      const out = { ok: true, tried: [] };
      for (const url of candidates) {
        const entry = { url };
        try {
          const resp = await requestUpstream(url, { method: "GET", headers: { Accept: "application/json", Authorization: "Bearer " + key }, credentials: "omit" });
          const text = (await resp.text()).slice(0, 3000);
          entry.status = resp.status;
          if (resp.ok) {
            try {
              const parsed = JSON.parse(text);
              const list = Array.isArray(parsed) ? parsed : (parsed?.voices || parsed?.data || []);
              entry.voices = (Array.isArray(list) ? list : []).slice(0, 60).map(v =>
                typeof v === "string" ? v : { id: v.voice_id || v.id || v.name, name: v.name });
            } catch { entry.body = text.slice(0, 300); }
          } else {
            entry.body = text.slice(0, 200);
          }
        } catch (e) { entry.error = String((e && e.message) || e); }
        out.tried.push(entry);
      }
      return out;
    },
  };

  function init() {
    voiceState = readVoiceState();
    saveVoiceState();
    installStyles();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    new MutationObserver(queueSync).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    queueSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();


