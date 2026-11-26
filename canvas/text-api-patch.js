(() => {
  "use strict";

  // 「文本API来源设置」：插在「图片API来源设置」上方的独立 tab，只放第三方文本 API 配置。
  // 不改压缩 bundle：tab 与分区在 React 之外追加；启用某个配置后劫持 fetch 把文本节点的
  // chat/completions 改写到它；浏览器直连被跨域拦截时回退本机 server.py 的 /__textapi/ 转发。
  // 界面结构与「图片API来源设置」一致：内置云雾卡 + 任意第三方卡，同时只启用一个。
  // 云雾的文本接口 Key/Base URL 需自行填写（与图片接口分开），不再自动跟随图片配置。
  const TEXT_PROFILES_KEY = "manshiguang:canvas-text-api-profiles";
  const STYLE_ID = "ms-text-api-style";
  const TAB_ID = "ms-text-api-tab-btn";
  const SECTION_ID = "ms-text-api-section";
  const VIEW_CLASS = "ms-text-api-view";
  const COMFY_VIEW_CLASS = "ms-comfy-view";
  const BUILTIN_ID = "yunwu";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const BUILTIN_APPLY_URL = "https://api.openlux.ai/register?aff=MYE2";
  const PROXY_PREFIX = "/__textapi/";
  const MODELS_DEBOUNCE_MS = 700;

  let textState = null;
  let textActive = false;
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

  // 图片/视频模型名黑名单。视频链路一律是 SSE，理论上已被 stream 判定挡掉；
  // 这里再按名字兜底，宁可漏接管也不误伤生图/生视频请求。
  const IMAGE_MODEL_RE = /image|banana|imagen|flux|dall|stable-diffusion|sdxl|seedream|seededit|kolors|midjourney|^mj[-_.]|draw|paint|video|i2v|t2v|kling|sora|veo|wan\d|wan-|hailuo|minimax|seedance|jimeng|animated|frame|motion|embed/i;
  const NON_TEXT_MODEL_RE = /embedding|rerank|moderation|whisper|tts|audio|speech|realtime|transcri|ocr|safety/i;

  // 图片/视频链路同样可能命中 chat/completions，这里按模型名再兜底一次，
  // 避免把生图、生视频请求改写到文本配置上造成误扣费。
  function isImageOrVideoModel(model) {
    const id = String(model || "");
    return Boolean(id) && IMAGE_MODEL_RE.test(id);
  }

  function isTextModel(model) {
    const id = String(model || "");
    if (!id || NON_TEXT_MODEL_RE.test(id)) return false;
    return !IMAGE_MODEL_RE.test(id);
  }

  const createId = () =>
    `txt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function blankProfile(index) {
    return {
      id: createId(),
      name: `第三方文本 API ${index}`,
      apiKey: "",
      baseUrl: "",
      applyUrl: "",
      textModel: "",
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
      textModel: "",
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
            : `第三方文本 API ${index}`,
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
      applyUrl: typeof source.applyUrl === "string" ? source.applyUrl : "",
      textModel: typeof source.textModel === "string" ? source.textModel.trim() : "",
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

  function readTextState() {
    let stored = null;
    try {
      const raw = window.localStorage.getItem(TEXT_PROFILES_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    const list = Array.isArray(stored?.profiles) ? stored.profiles : [];
    // 内置云雾卡始终排在最前，并回填用户填过的文本接口 Key/Base URL，
    // 否则刷新后云雾配置会被重置成空。
    const defaults = builtinProfile();
    const savedBuiltin = list.find((item) => item?.id === BUILTIN_ID) || {};
    const profiles = [
      normalizeProfile({
        ...defaults,
        ...savedBuiltin,
        id: BUILTIN_ID,
        // 早期版本把内置卡命名成「云雾（跟随图片API）」，现在云雾独立配置文本接口，
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

  function saveTextState() {
    if (!textState) return;
    try {
      window.localStorage.setItem(TEXT_PROFILES_KEY, JSON.stringify(textState));
    } catch {}
    publishActiveText();
  }

  function profileFor(id) {
    return textState?.profiles.find((profile) => profile.id === id) || null;
  }

  function activeTextProfile() {
    return textState?.activeId ? profileFor(textState.activeId) : null;
  }

  function publishActiveText() {
    const active = activeTextProfile();
    window.__MS_TEXT_API__ = {
      activeId: active?.id || "",
      name: active?.name || "",
      baseUrl: active ? normalizeBaseUrl(active.baseUrl) : "",
      apiKey: active?.apiKey || "",
      model: active?.textModel || "",
      builtin: Boolean(active?.builtin),
      updatedAt: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent("manshiguang:text-api-changed", { detail: window.__MS_TEXT_API__ }),
    );
  }
  function setStatus(id, text, kind = "") {
    if (!text) runtime.status.delete(id);
    else runtime.status.set(id, { text, kind });
    applyStatusToDom(id);
  }

  function showStatus(text, kind = "") {
    const element = document.querySelector("#" + SECTION_ID + " .ms-text-api__message");
    if (!element) return;
    element.textContent = text;
    element.className = "ms-text-api__message" + (kind ? " is-" + kind : "");
  }

  function applyStatusToDom(id) {
    const card = section?.querySelector('[data-text-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    const element = card.querySelector(".ms-text-api__result");
    if (element) {
      const status = runtime.status.get(id);
      element.textContent = status?.text || "";
      element.className = "ms-text-api__result" + (status?.kind ? " is-" + status.kind : "");
      element.hidden = !status?.text;
    }
    const button = card.querySelector('[data-ms-text-action="models-refresh"]');
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
      #${TAB_ID} .ms-text-api-tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; font-size: 13px; }
      .ms-text-api__body { display: flex; flex-direction: column; gap: 14px; }
      .ms-text-api__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-text-api__status { display: flex; align-items: center; gap: 8px; color: #6d5e52; font-size: 12px; line-height: 1.6; }
      .ms-text-api__dot { width: 8px; height: 8px; border-radius: 999px; background: #ff6a1a; box-shadow: 0 0 0 4px #ff6a1a1a; }
      .ms-text-api__add { height: 32px; padding: 0 14px; border: 1px solid #ff6a1a; border-radius: 999px; background: #fff; color: #e85c12; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
      .ms-text-api__add:hover { background: #ff6a1a; color: #fff; }
      .ms-text-api__message { display: none; padding: 9px 12px; border-radius: 12px; background: #e9f7ef; color: #217a50; font-size: 12px; line-height: 1.6; }
      .ms-text-api__message:not(:empty) { display: block; }
      .ms-text-api__message.is-error { background: #fff1ee; color: #b42318; }
      .ms-text-api__list { display: flex; flex-direction: column; gap: 14px; }
      .ms-text-api-card { display: flex; flex-direction: column; gap: 16px; padding: 18px; border: 1px solid #8f7c681f; border-radius: 22px; background: #ffffff8f; box-shadow: inset 0 1px #ffffff80; }
      .ms-text-api-card.is-active { border-color: #ff6a1a80; box-shadow: inset 0 1px #ffffff80, 0 0 0 3px #ff6a1a12; }
      .ms-text-api-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ms-text-api-card__identity { display: flex; align-items: center; min-width: 0; gap: 8px; }
      .ms-text-api-card__icon { color: #ff6a1a; font-size: 18px; line-height: 1; }
      .ms-text-api-card__name { overflow: hidden; color: #2f251c; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .ms-text-api-card__badge { padding: 3px 8px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 11px; white-space: nowrap; }
      .ms-text-api-card__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .ms-text-api-card__button { height: 30px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 160ms ease, background 160ms ease, color 160ms ease; }
      .ms-text-api-card__button:hover:not(:disabled) { transform: translateY(-1px); }
      .ms-text-api-card__button--apply { border: 1px solid #ff6a1a; background: #ff6a1a; color: #fff; }
      .ms-text-api-card__button--apply:hover:not(:disabled) { border-color: #e85c12; background: #e85c12; }
      .ms-text-api-card__button--enable { border: 1px solid #d8c9bb; background: #fff; color: #6d5e52; }
      .ms-text-api-card__button--enable.is-active { border-color: #2b9a66; background: #e9f7ef; color: #217a50; }
      .ms-text-api-card__button--primary { justify-self: start; border: 1px solid #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-text-api-card__button:disabled { cursor: not-allowed; opacity: .55; }
      .ms-text-api-card__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .ms-text-api-card__field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
      .ms-text-api-card__field--wide { grid-column: 1 / -1; }
      .ms-text-api-card__label { color: #5f5146; font-size: 12px; font-weight: 600; }
      .ms-text-api__input { width: 100%; height: 38px; box-sizing: border-box; padding: 0 12px; border: 1px solid #8f7c6829; border-radius: 11px; outline: none; background: #fff; color: #2f251c; font: inherit; font-size: 13px; }
      .ms-text-api__input:focus { border-color: #ff6a1a; box-shadow: 0 0 0 3px #ff6a1a14; }
      .ms-text-api-card__secret { position: relative; display: block; }
      .ms-text-api-card__secret .ms-text-api__input { padding-right: 44px; }
      .ms-text-api-card__secret-toggle { position: absolute; top: 50%; right: 6px; display: grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #8d7868; cursor: pointer; transform: translateY(-50%); transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease; }
      .ms-text-api-card__secret-toggle:hover { background: #8f7c6814; color: #ff6a1a; }
      .ms-text-api-card__secret-toggle:focus-visible { outline: 0; box-shadow: 0 0 0 3px #ff6a1a2e; color: #ff6a1a; }
      .ms-text-api-card__secret-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      .ms-text-api-card__secret-icon--hide { display: none; }
      .ms-text-api-card__secret-toggle[aria-pressed="true"] .ms-text-api-card__secret-icon--show { display: none; }
      .ms-text-api-card__secret-toggle[aria-pressed="true"] .ms-text-api-card__secret-icon--hide { display: block; }
      .ms-text-api-card__models { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid #8f7c681f; }
      .ms-text-api-models__toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-text-api-models__heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .ms-text-api-models__title { color: #4b3d33; font-size: 13px; font-weight: 700; }
      .ms-text-api-models__count, .ms-text-api-models__time { color: #8d7868; font-size: 11px; }
      .ms-text-api-models__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ms-text-api-models__button { height: 28px; padding: 0 12px; border: 1px solid #d8c9bb; border-radius: 999px; background: #fff; color: #6d5e52; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
      .ms-text-api-models__button--primary { border-color: #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-text-api-models__button:disabled { cursor: not-allowed; opacity: .52; }
      .ms-text-api-models__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; max-height: 236px; overflow: auto; overflow-anchor: none; padding: 2px; }
      .ms-text-api-model { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #8f7c681f; border-radius: 10px; background: #ffffffa6; color: #3a2f27; cursor: pointer; }
      .ms-text-api-model:hover { border-color: #ff6a1a59; background: #fffaf6; }
      .ms-text-api-model input { width: 14px; height: 14px; margin: 0; accent-color: #ff6a1a; flex: 0 0 auto; }
      .ms-text-api-model__name { min-width: 0; overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .ms-text-api-model__tag { margin-left: auto; padding: 2px 6px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 9px; line-height: 1.4; flex: 0 0 auto; }
      .ms-text-api-model__tag.is-current { background: #e9f7ef; color: #217a50; }
      .ms-text-api-models__empty, .ms-text-api-models__note { color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-text-api-models__note.is-error { color: #b42318; }
      .ms-text-api-card__hint { grid-column: 1 / -1; margin: 0; color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-text-api__result { grid-column: 1 / -1; margin: 0; font-size: 11px; line-height: 1.6; color: #8d7868; word-break: break-all; }
      .ms-text-api__result.is-ok { color: #217a50; }
      .ms-text-api__result.is-error { color: #b42318; }
      .ms-text-api__result.is-muted { color: #8d7868; }
      .ms-text-api-card__remove { grid-column: 1 / -1; justify-self: start; padding: 0; border: 0; background: transparent; color: #b42318; font: inherit; font-size: 11px; cursor: pointer; }
      .ms-text-api__footnote { margin: 0; padding: 0 4px; color: #8d7868; font-size: 11px; line-height: 1.7; }
    `;
    document.head.appendChild(style);
  }

  function settingsNav() {
    return document.querySelector(".settings-sidebar__nav");
  }

  function settingsBody() {
    return document.querySelector(".settings-modal__body");
  }

  // 原生 bundle 的标签叫「API 来源设置」，api-profiles 补丁会改名成「图片API来源设置」；
  // 两种写法都要匹配，否则改名之前挂不上就永远插不进 tab。
  function findImageApiTab(nav) {
    // 只认真正的「图片API」项：先排除文本/视频补丁自己注入的按钮，
    // 否则回退正则会先命中「文本API来源设置」，把视频 tab 插到图片上方。
    const items = [...nav.querySelectorAll(".settings-sidebar__item")].filter(
      (item) =>
        item.id !== TAB_ID &&
        item.id !== "ms-text-api-tab-btn" &&
        item.id !== "ms-video-api-tab-btn",
    );
    return (
      items.find((item) => /图片API来源设置/.test(item.textContent || "")) ||
      items.find((item) => /^\s*API\s*来源设置\s*$/.test((item.textContent || "").trim())) ||
      items.find((item) => /API\s*来源设置/.test(item.textContent || "")) ||
      null
    );
  }

  function mountTabButton() {
    const nav = settingsNav();
    if (!nav) return false;
    if (tabButton && tabButton.isConnected && tabButton.parentElement === nav) return true;
    const existing = document.getElementById(TAB_ID);
    if (existing && existing.parentElement === nav) {
      tabButton = existing;
      return true;
    }
    const imageTab = findImageApiTab(nav);
    if (!imageTab) return false;
    const button = document.createElement("button");
    button.type = "button";
    button.id = TAB_ID;
    button.className = "settings-sidebar__item";
    button.dataset.msTextTab = "true";
    button.innerHTML =
      '<span class="ms-text-api-tab-icon" aria-hidden="true">✍️</span><span>文本API来源设置</span>';
    nav.insertBefore(button, imageTab);
    tabButton = button;
    return true;
  }
  function selectedTextModels(profile) {
    const allowed = new Set(profile.modelCatalog.filter(isTextModel));
    return uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model));
  }

  function renderModelSection(profile) {
    const loading = runtime.loading.has(profile.id);
    const models = profile.modelCatalog.filter(isTextModel);
    const selected = new Set(profile.selectedModels);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const rows = models
      .map(
        (model) => `
          <label class="ms-text-api-model" title="${escapeHtml(model)}">
            <input type="checkbox" data-ms-text-model="${escapeHtml(model)}" ${selected.has(model) ? "checked" : ""} />
            <span class="ms-text-api-model__name">${escapeHtml(model)}</span>
            <span class="ms-text-api-model__tag${model === profile.textModel ? " is-current" : ""}">${model === profile.textModel ? "当前" : "文本"}</span>
          </label>`,
      )
      .join("");
    return `
      <div class="ms-text-api-models__toolbar">
        <div class="ms-text-api-models__heading">
          <span class="ms-text-api-models__title">模型列表</span>
          <span class="ms-text-api-models__count">已选择 ${selected.size} 个 / 共 ${models.length} 个</span>
          ${fetchedAt ? `<span class="ms-text-api-models__time">最近拉取 ${escapeHtml(fetchedAt)}</span>` : ""}
        </div>
        <div class="ms-text-api-models__actions">
          <button type="button" class="ms-text-api-models__button ms-text-api-models__button--primary" data-ms-text-action="models-refresh" ${loading ? "disabled" : ""}>${loading ? "拉取中…" : "拉取全部模型"}</button>
          <button type="button" class="ms-text-api-models__button" data-ms-text-action="models-text" ${models.length && !loading ? "" : "disabled"}>全选文本</button>
          <button type="button" class="ms-text-api-models__button" data-ms-text-action="models-clear" ${selected.size ? "" : "disabled"}>清空</button>
        </div>
      </div>
      <div class="ms-text-api-models__note">${
        profile.builtin
          ? "勾选＝该 Key 实际可用的文本模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，留空则保持画布原生行为。"
          : "勾选＝该 Key 实际可用的文本模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，再兜底第一个勾选项。"
      }</div>
      ${profile.modelsError ? `<div class="ms-text-api-models__note is-error">拉取失败：${escapeHtml(profile.modelsError)}</div>` : ""}
      ${models.length
        ? `<div class="ms-text-api-models__list">${rows}</div>`
        : `<div class="ms-text-api-models__empty">${loading ? "正在从平台拉取模型列表…" : "填好 API 密钥后会自动拉取；也可以点「拉取全部模型」。"}</div>`}
    `;
  }

  function modelHintText(profile) {
    const textModels = profile.modelCatalog.filter(isTextModel);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const tail = textModels.length
      ? `已拉取 ${textModels.length} 个可用文本模型${fetchedAt ? `（${fetchedAt}）` : ""}。`
      : profile.builtin ? "填好 API 密钥后会自动拉取模型列表（Base URL 留空即走云雾默认地址）。" : "填好密钥与 Base URL 后会自动拉取模型列表。";
    if (profile.builtin) {
      return `云雾的文本接口与图片接口分开配置，请自行填写 API Key 与 Base URL。模型名留空时沿用画布自带的云雾文本模型，填写后改用该模型名。${tail}`;
    }
    return `第三方需兼容 OpenAI 风格 POST /v1/chat/completions。必须选定文本模型名才会接管，画布文本节点会改用这里的 Key、Base URL 与模型名；未选定则仍走「图片API来源设置」。${tail}`;
  }

  // 拉模型是异步的，用户可能还在同一张卡里打字；这里只就地更新下拉与说明文案，
  // 不整块重渲染，否则输入框失焦、光标跳走。
  function refreshModelUi(profile) {
    if (!section || !textActive) return;
    const card = section.querySelector('[data-text-id="' + CSS.escape(profile.id) + '"]');
    if (!card) return;
    const modelsSection = card.querySelector("[data-ms-model-section]");
    if (modelsSection) {
      const next = renderModelSection(profile);
      if (modelsSection.innerHTML !== next) modelsSection.innerHTML = next;
    }
    const input = card.querySelector('[data-ms-text-field="textModel"]');
    if (input && input !== document.activeElement) input.value = profile.textModel;
    const hint = card.querySelector(".ms-text-api-card__hint");
    const hintText = modelHintText(profile);
    if (hint && hint.textContent !== hintText) hint.textContent = hintText;
    applyStatusToDom(profile.id);
  }

  // 与「图片API来源设置」保持一致：同时只启用一个，启用中的按钮置灰
  function renderCard(profile) {
    const isActive = profile.id === textState.activeId;
    const enableButton =
      `<button type="button" class="ms-text-api-card__button ms-text-api-card__button--enable` +
      (isActive ? " is-active" : "") + `" data-ms-text-action="enable"` +
      (isActive ? " disabled" : "") + `>` +
      (isActive ? "已启用" : "启用") +
      `</button>`;
    return `
      <article class="ms-text-api-card` + (isActive ? " is-active" : "") + `" data-text-id="${escapeHtml(profile.id)}">
        <div class="ms-text-api-card__header">
          <div class="ms-text-api-card__identity">
            <span class="ms-text-api-card__icon" aria-hidden="true">${profile.builtin ? "☁" : "✍"}</span>
            <span class="ms-text-api-card__name">${escapeHtml(profile.name)}</span>
            <span class="ms-text-api-card__badge">${profile.builtin ? "内置兼容" : "第三方"}</span>
          </div>
          <div class="ms-text-api-card__actions">
            <button type="button" class="ms-text-api-card__button ms-text-api-card__button--apply" data-ms-text-action="apply"
              title="${profile.applyUrl.trim() ? "打开申请地址" : "请先填写申请地址"}"` +
              (profile.applyUrl.trim() ? "" : " disabled") +
              `>申请</button>
            ${enableButton}
          </div>
        </div>
        <div class="ms-text-api-card__form">
          <label class="ms-text-api-card__field">
            <span class="ms-text-api-card__label">配置名称</span>
            <input class="ms-text-api__input" data-ms-text-field="name" value="${escapeHtml(profile.name)}" placeholder="例如：DeepSeek / 通义 / Kimi" />
          </label>
          <label class="ms-text-api-card__field">
            <span class="ms-text-api-card__label">申请地址（可选）</span>
            <input class="ms-text-api__input" data-ms-text-field="applyUrl" value="${escapeHtml(profile.applyUrl)}" placeholder="https://example.com/register" />
          </label>
          <div class="ms-text-api-card__field">
            <label class="ms-text-api-card__label" for="ms-text-api-key-${escapeHtml(profile.id)}">API 密钥</label>
            <span class="ms-text-api-card__secret">
              <input
                id="ms-text-api-key-${escapeHtml(profile.id)}"
                class="ms-text-api__input"
                data-ms-text-field="apiKey"
                type="password"
                autocomplete="off"
                value="${escapeHtml(profile.apiKey)}"
                placeholder="sk-..."
              />
              <button
                type="button"
                class="ms-text-api-card__secret-toggle"
                data-ms-text-action="toggle-secret"
                aria-label="显示 API 密钥"
                aria-pressed="false"
                title="显示 API 密钥"
              >
                <svg class="ms-text-api-card__secret-icon ms-text-api-card__secret-icon--show" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.43-6 9.5-6 9.5 6 9.5 6-3.43 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.75"></circle>
                </svg>
                <svg class="ms-text-api-card__secret-icon ms-text-api-card__secret-icon--hide" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3l18 18"></path>
                  <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.07 0 9.5 6 9.5 6a17.8 17.8 0 0 1-3.1 3.8"></path>
                  <path d="M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.43 6 9.5 6c1.3 0 2.5-.28 3.55-.72"></path>
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                </svg>
              </button>
            </span>
          </div>
          <label class="ms-text-api-card__field">
            <span class="ms-text-api-card__label">接口地址（Base URL）</span>
            <input class="ms-text-api__input" data-ms-text-field="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="${escapeHtml(profile.builtin ? DEFAULT_BASE_URL : "https://api.example.com/v1")}" />
          </label>
          <label class="ms-text-api-card__field">
            <span class="ms-text-api-card__label">模型名（请求中 model 字段的实际值）</span>
            <input class="ms-text-api__input" data-ms-text-field="textModel" value="${escapeHtml(profile.textModel)}" placeholder="${profile.builtin ? "留空则沿用画布云雾文本模型" : "例如 deepseek-chat / glm-4.6"}" />
          </label>
          <p class="ms-text-api-card__hint">${escapeHtml(modelHintText(profile))}</p>
          <p class="ms-text-api__result" hidden></p>
          ${profile.builtin ? "" : '<button type="button" class="ms-text-api-card__remove" data-ms-text-action="remove">删除此配置</button>'}
        </div>
        <section class="ms-text-api-card__models" data-ms-model-section>${renderModelSection(profile)}</section>
      </article>`;
  }

  function renderSection(force = false) {
    installStyles();
    const body = settingsBody();
    if (!body || !textState) return;
    if (!section || !section.isConnected) {
      section = document.getElementById(SECTION_ID) || document.createElement("section");
      section.id = SECTION_ID;
    }
    section.className = "settings-section";
    const active = activeTextProfile();
    const nextHtml = `
      <div class="settings-section__header">
        <h3>文本API来源设置</h3>
        <p>为画布「文本节点」单独配置 API，界面与「图片API来源设置」一致：内置云雾 + 任意第三方，同时只启用一个。云雾的文本接口需自行填写 Key 与 Base URL。</p>
      </div>
      <div class="ms-text-api__body">
        <div class="ms-text-api__toolbar">
          <div class="ms-text-api__status">
            <span class="ms-text-api__dot"></span>
            <span>当前启用：${escapeHtml(active?.name || "未配置")}</span>
          </div>
          <button type="button" class="ms-text-api__add" data-ms-text-action="add">＋ 新增第三方 API</button>
        </div>
        <p class="ms-text-api__message" role="status" aria-live="polite"></p>
        <div class="ms-text-api__list">${textState.profiles.map((profile) => renderCard(profile)).join("")}</div>
        <p class="ms-text-api__footnote">
          同一时间只会启用一个文本配置；启用云雾但未填密钥或 Base URL 时，文本节点保持画布原生行为。配置与密钥只保存在当前浏览器 localStorage["${TEXT_PROFILES_KEY}"]。
          浏览器直连第三方被跨域拦截时会自动改走本机 server.py 的 ${PROXY_PREFIX} 转发，使用第三方地址请保持 start.bat 处于运行状态。
        </p>
      </div>
    `;
    if (force || section.__msTextHtml !== nextHtml) {
      section.innerHTML = nextHtml;
      section.__msTextHtml = nextHtml;
    }
    if (section.parentElement !== body || body.lastElementChild !== section) body.appendChild(section);
    textState.profiles.forEach((profile) => applyStatusToDom(profile.id));
  }
  function activate() {
    const body = settingsBody();
    if (!body || !textState) return;
    if (!mountTabButton()) {
      showStatus("尚未找到「图片API来源设置」入口，请重新打开设置面板。", "error");
      return;
    }
    textActive = true;
    document
      .querySelectorAll(".settings-sidebar__nav .settings-sidebar__item")
      .forEach((item) => item.classList.remove("is-active"));
    tabButton.classList.add("is-active");
    renderSection(true);
    body.classList.add(VIEW_CLASS);
    body.scrollTop = 0;
  }

  function deactivate() {
    textActive = false;
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
        textActive = false;
        tabButton = null;
        section = null;
      }
      return;
    }
    if (!modalWasOpen) {
      modalWasOpen = true;
      textActive = false;
    }
    // ComfyUI 分区接管 body 时让位，避免两个自定义 tab 同时占住面板
    if (textActive && body.classList.contains(COMFY_VIEW_CLASS)) textActive = false;
    mountTabButton();
    if (textActive && tabButton) {
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
    const card = target?.closest?.("[data-text-id]");
    if (!card) return null;
    const profile = profileFor(card.dataset.textId);
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

  // 浏览器直连第三方文本 API 常被 CORS 拦掉；失败时改走本机 server.py 转发，
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
        throw new Error("本机 server.py 还是旧版本，未包含文本 API 转发接口，请重启 start.bat 后再试。");
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
    if (!profile.apiKey.trim()) {
      setStatus(profile.id, "请先填写 API 密钥。", "error");
      return;
    }
    runtime.loading.add(profile.id);
    setStatus(profile.id, "正在拉取模型列表…", "muted");
    if (afterRender) applyStatusToDom(profile.id);
    const headers = { Accept: "application/json", Authorization: `Bearer ${profile.apiKey.trim()}` };
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
    if (profile.textModel && !models.includes(profile.textModel)) profile.textModel = "";
    saveTextState();
    const textCount = models.filter(isTextModel).length;
    setStatus(profile.id, `已拉取 ${models.length} 个模型，其中 ${textCount} 个可作为文本模型。`, "ok");
    refreshModelUi(profile);
  }

  function scheduleModelsFetch(profile) {
    const previous = runtime.timers.get(profile.id);
    if (previous) window.clearTimeout(previous);
    if (!effectiveBase(profile) || !profile.apiKey.trim()) return;
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
  /* ---------- 文本节点请求改写 ---------- */

  // 必须在 model-patch.js 之后加载：这里接住的是它包装过的 fetch，
  // 图片端点仍由 model-patch 处理，本补丁只改写 chat/completions。
  const innerFetch = window.fetch.bind(window);

  function isTextChatEndpoint(rawUrl) {
    const path = String(rawUrl || "").split("?")[0];
    return /\/chat\/completions\/?$/i.test(path);
  }

  function buildRewrite(init) {
    const profile = activeTextProfile();
    if (!profile) return null;
    const base = effectiveBase(profile);
    const apiKey = profile.apiKey.trim();
    const model = profile.textModel.trim();
    const selected = selectedTextModels(profile);
    if (!base || !apiKey) return null;
    // 第三方必须给出可用模型（勾选或手填模型名）才接管：避免用画布的图片/视频模型名
    // 去撞第三方接口，也避免「启用了却没生效」的困惑。内置云雾两者都空则沿用画布模型名。
    if (!profile.builtin && !model && !selected.length) return null;
    if (typeof init?.body !== "string") return null;
    let payload = null;
    try {
      payload = JSON.parse(init.body);
    } catch {
      return null;
    }
    if (!payload || !Array.isArray(payload.messages)) return null;
    // 原请求带图片/视频模型名说明不是文本节点，交给图片链路处理
    if (isImageOrVideoModel(payload.model)) return null;
    // 图片/视频链路也走 chat/completions，但它们要求 SSE 流式；这里只接管非流式的文本请求，
    // 避免把生图或生视频请求误改写到文本配置上。
    if (payload.stream === true) return null;
    const accept =
      typeof init?.headers?.get === "function"
        ? init.headers.get("Accept") || ""
        : String(init?.headers?.Accept || "");
    if (/text\/event-stream/i.test(accept)) return null;
    // 勾选集合决定哪些模型名可以直送第三方：节点原本选中的模型若已勾选就沿用，
    // 否则退到「模型名」输入框，再退到第一个勾选项。
    let nextModel = "";
    if (selected.length) {
      const requested = String(payload.model || "");
      if (selected.includes(requested)) nextModel = requested;
      else if (selected.includes(model)) nextModel = model;
      else if (!profile.builtin) nextModel = selected[0];
    }
    if (!nextModel && model) nextModel = model;
    if (nextModel) payload.model = nextModel;
    return {
      url: `${base}/v1/chat/completions`,
      init: {
        method: String(init.method || "POST").toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        credentials: "omit",
      },
    };
  }

  window.fetch = async function patchedTextApiFetch(input, init) {
    const rawUrl =
      typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    const proxied = rawUrl.startsWith(PROXY_PREFIX) || rawUrl.includes(`${PROXY_PREFIX}proxy`);
    if (!rawUrl || proxied || !isTextChatEndpoint(rawUrl)) return innerFetch(input, init);
    const rewrite = buildRewrite(init);
    if (!rewrite) return innerFetch(input, init);
    try {
      return await requestUpstream(rewrite.url, rewrite.init);
    } catch (error) {
      return new Response(
        JSON.stringify({ error: { message: error?.message || String(error) } }),
        { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } },
      );
    }
  };

  /* ---------- 事件 ---------- */

  function handleClick(event) {
    const navItem = event.target?.closest?.(".settings-sidebar__item");
    if (navItem) {
      if (navItem.id === TAB_ID) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      } else if (textActive) {
        deactivate();
      }
      return;
    }
    if (!section || !section.contains(event.target)) return;
    const button = event.target.closest("[data-ms-text-action]");
    if (!button) return;
    const action = button.dataset.msTextAction;

    if (action === "add") {
      event.preventDefault();
      event.stopPropagation();
      const profile = blankProfile(textState.profiles.filter((item) => !item.builtin).length + 1);
      textState.profiles.push(profile);
      saveTextState();
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
        .closest(".ms-text-api-card__secret")
        ?.querySelector('[data-ms-text-field="apiKey"]');
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
      if (textState.activeId === profile.id) return;
      const missing = [];
      if (!profile.apiKey.trim()) missing.push("API 密钥");
      if (!effectiveBase(profile)) missing.push("Base URL");
      // 内置云雾的模型名可留空（沿用画布自带的云雾文本模型），第三方必须显式选定
      if (!profile.builtin && !profile.textModel.trim() && !selectedTextModels(profile).length) {
        missing.push("文本模型（勾选模型或填写模型名）");
      }
      if (missing.length) {
        setStatus(profile.id, "启用前请先填写：" + missing.join("、") + "。", "error");
        showStatus("该配置还缺少" + missing.join("、") + "，暂不能启用。", "error");
        return;
      }
      textState.activeId = profile.id;
      saveTextState();
      renderSection(true);
      showStatus(`已启用「${profile.name}」，画布文本节点将改用该配置。`);
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

    if (action === "models-text") {
      profile.selectedModels = profile.modelCatalog.filter(isTextModel);
      if (!profile.textModel) profile.textModel = profile.selectedModels[0] || "";
      saveTextState();
      refreshModelUi(profile);
      showStatus(`已勾选 ${profile.selectedModels.length} 个文本模型。`);
      return;
    }

    if (action === "models-clear") {
      profile.selectedModels = [];
      saveTextState();
      refreshModelUi(profile);
      showStatus("已清空模型勾选；接管时将只使用「模型名」输入框里的模型。");
      return;
    }
    if (action === "remove") {
      if (profile.builtin) return;
      if (!window.confirm(`确认删除「${profile.name}」？`)) return;
      textState.profiles = textState.profiles.filter((item) => item.id !== profile.id);
      if (textState.activeId === profile.id) textState.activeId = BUILTIN_ID;
      runtime.status.delete(profile.id);
      const timer = runtime.timers.get(profile.id);
      if (timer) window.clearTimeout(timer);
      runtime.timers.delete(profile.id);
      saveTextState();
      renderSection(true);
      showStatus(`已删除「${profile.name}」。`);
    }
  }

  function handleInput(event) {
    const field = event.target?.closest?.("[data-ms-text-field]");
    if (!field || !section?.contains(field)) return;
    const found = cardFor(field);
    if (!found) return;
    const key = field.dataset.msTextField;
    if (!["name", "apiKey", "baseUrl", "applyUrl", "textModel"].includes(key)) return;
    found.profile[key] = field.value;
    if (key === "name") {
      const label = found.card.querySelector(".ms-text-api-card__name");
      if (label) label.textContent = field.value || "未命名文本 API";
    }
    if (key === "baseUrl" || key === "apiKey") scheduleModelsFetch(found.profile);
    saveTextState();
  }

  function handleChange(event) {
    const checkbox = event.target?.closest?.("[data-ms-text-model]");
    if (!checkbox || !section?.contains(checkbox)) return;
    const found = cardFor(checkbox);
    if (!found) return;
    const { profile } = found;
    const allowed = new Set(profile.modelCatalog.filter(isTextModel));
    const selected = new Set(uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model)));
    if (checkbox.checked) selected.add(checkbox.dataset.msTextModel);
    else selected.delete(checkbox.dataset.msTextModel);
    profile.selectedModels = profile.modelCatalog.filter(
      (model) => allowed.has(model) && selected.has(model),
    );
    // 「模型名」保持与勾选一致：当前值失效就自动切到第一个勾选项。
    if (profile.textModel && !selected.has(profile.textModel) && profile.selectedModels.length) {
      profile.textModel = profile.selectedModels[0];
    } else if (!profile.textModel && profile.selectedModels.length) {
      profile.textModel = profile.selectedModels[0];
    }
    const input = found.card.querySelector('[data-ms-text-field="textModel"]');
    if (input && input !== document.activeElement) input.value = profile.textModel;
    saveTextState();
    refreshModelUi(profile);
    setStatus(
      profile.id,
      profile.selectedModels.length
        ? `已勾选 ${profile.selectedModels.length} 个文本模型，当前使用 ${profile.textModel}。`
        : "尚未勾选文本模型，接管时只会使用「模型名」输入框的值。",
      profile.selectedModels.length ? "ok" : "muted",
    );
  }

  window.__MS_TEXT_API_PATCH__ = {
    version: "20261114-8",
    state: () => textState,
    active: () => textActive,
    open: () => {
      activate();
      return textActive;
    },
    close: deactivate,
    // 文本节点弹框选择模型时写入当前启用的文本配置，保证请求真正使用该模型。
    setModel: (model) => {
      const value = String(model || "").trim();
      const profile = activeTextProfile();
      if (!value || !profile) return false;
      profile.textModel = value;
      saveTextState();
      refreshModelUi(profile);
      return true;
    },
    // 文本节点弹框标题用：当前启用文本配置的生效 Base URL（内置云雾留空时回落默认地址）。
    activeBaseUrl: () => {
      const profile = activeTextProfile();
      return profile ? effectiveBase(profile) : "";
    },
  };

  function init() {
    textState = readTextState();
    saveTextState();
    installStyles();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    // 跨同源 frame 同步：画布与「设置」是两个独立 iframe，各自缓存 textState。
    // 任一 frame 写 localStorage 时，其它 frame 收到 storage 事件重读，否则一边改另一边不生效。
    window.addEventListener("storage", (event) => {
      if (event.key !== TEXT_PROFILES_KEY) return;
      textState = readTextState();
      publishActiveText();
      if (textActive) renderSection(true);
    });
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


