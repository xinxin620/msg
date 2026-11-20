(() => {
  "use strict";

  // 「视频API来源设置」：插在「图片API来源设置」下方的独立 tab。
  // 与文本 API 一致：内置一张可编辑的云雾卡 + 任意第三方卡，同时只启用一个。
  // 不改压缩 bundle；启用后包装 fetch，接管视频节点提交、轮询与视频 SSE chat 请求。
  const VIDEO_PROFILES_KEY = "manshiguang:canvas-video-api-profiles";
  const STYLE_ID = "ms-video-api-style";
  const TAB_ID = "ms-video-api-tab-btn";
  const SECTION_ID = "ms-video-api-section";
  const VIEW_CLASS = "ms-video-api-view";
  const COMFY_VIEW_CLASS = "ms-comfy-view";
  const TEXT_VIEW_CLASS = "ms-text-api-view";
  const BUILTIN_ID = "yunwu";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const BUILTIN_APPLY_URL = "https://api.openlux.ai/register?aff=MYE2";
  const PROXY_PREFIX = "/__textapi/";
  const MODELS_DEBOUNCE_MS = 700;

  let videoState = null;
  let videoActive = false;
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
        .replace(/\/v2\/videos\/generations(?:\/.*)?$/i, "")
        .replace(/\/v1\/video\/generations(?:\/.*)?$/i, "")
        .replace(/\/v1\/videos(?:\/.*)?$/i, "")
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

  const VIDEO_MODEL_RE =
    /video|veo|kling|sora|hailuo|minimax|seedance|jimeng|wan\d|wan-|runway|pika|vidu|luma|i2v|t2v|grokvideo|animated|motion/i;
  const NON_VIDEO_MODEL_RE =
    /embedding|rerank|moderation|whisper|tts|audio|speech|transcri|ocr|chat|text|embed|image|banana|imagen|flux|dall|stable-diffusion|sdxl|seedream|seededit|kolors|midjourney|^mj[-_.]|draw|paint|gpt-4|gpt-3/i;

  function isVideoModel(model) {
    const id = String(model || "");
    if (!id || NON_VIDEO_MODEL_RE.test(id)) return false;
    return VIDEO_MODEL_RE.test(id);
  }

  const createId = () =>
    `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function blankProfile(index) {
    return {
      id: createId(),
      name: `第三方视频 API ${index}`,
      apiKey: "",
      baseUrl: "",
      applyUrl: "",
      videoModel: "",
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
      videoModel: "",
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
      ? source.modelCatalog
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim())
      : [];
    return {
      id: typeof source.id === "string" && source.id ? source.id : createId(),
      name:
        typeof source.name === "string" && source.name.trim()
          ? source.name.trim()
          : builtin
            ? "云雾"
            : `第三方视频 API ${index}`,
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
      applyUrl: typeof source.applyUrl === "string" ? source.applyUrl : "",
      videoModel: typeof source.videoModel === "string" ? source.videoModel.trim() : "",
      builtin,
      modelCatalog: [...new Set(catalog)],
      selectedModels: uniqueStringList(source.selectedModels).filter((model) => catalog.includes(model)),
      modelsFetchedAt: Number.isFinite(source.modelsFetchedAt) ? source.modelsFetchedAt : 0,
      modelsError: typeof source.modelsError === "string" ? source.modelsError : "",
      modelsBaseUrl: typeof source.modelsBaseUrl === "string" ? source.modelsBaseUrl : "",
    };
  }

  function readVideoState() {
    let stored = null;
    try {
      const raw = window.localStorage.getItem(VIDEO_PROFILES_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    const list = Array.isArray(stored?.profiles) ? stored.profiles : [];
    const defaults = builtinProfile();
    const savedBuiltin = list.find((item) => item?.id === BUILTIN_ID) || {};
    const profiles = [
      normalizeProfile(
        {
          ...defaults,
          ...savedBuiltin,
          id: BUILTIN_ID,
          name: "云雾",
          applyUrl: savedBuiltin.applyUrl || defaults.applyUrl,
        },
        0,
      ),
    ];
    list
      .filter((item) => item?.id !== BUILTIN_ID)
      .forEach((item, index) => profiles.push(normalizeProfile(item, index + 1)));
    const activeId = profiles.some((profile) => profile.id === stored?.activeId)
      ? stored.activeId
      : BUILTIN_ID;
    return { version: 1, activeId, profiles };
  }

  function saveVideoState() {
    if (!videoState) return;
    try {
      window.localStorage.setItem(VIDEO_PROFILES_KEY, JSON.stringify(videoState));
    } catch {}
    publishActiveVideo();
  }

  function profileFor(id) {
    return videoState?.profiles.find((profile) => profile.id === id) || null;
  }

  function activeVideoProfile() {
    return videoState?.activeId ? profileFor(videoState.activeId) : null;
  }

  function publishActiveVideo() {
    const active = activeVideoProfile();
    window.__MS_VIDEO_API__ = {
      activeId: active?.id || "",
      name: active?.name || "",
      baseUrl: active ? normalizeBaseUrl(active.baseUrl) : "",
      apiKey: active?.apiKey || "",
      model: active?.videoModel || "",
      videoModels: active ? selectedVideoModels(active) : [],
      builtin: Boolean(active?.builtin),
      updatedAt: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent("manshiguang:video-api-changed", { detail: window.__MS_VIDEO_API__ }),
    );
  }

  function setStatus(id, text, kind = "") {
    if (!text) runtime.status.delete(id);
    else runtime.status.set(id, { text, kind });
    applyStatusToDom(id);
  }

  function showStatus(text, kind = "") {
    const element = document.querySelector("#" + SECTION_ID + " .ms-video-api__message");
    if (!element) return;
    element.textContent = text;
    element.className = "ms-video-api__message" + (kind ? " is-" + kind : "");
  }

  function applyStatusToDom(id) {
    const card = section?.querySelector('[data-video-id="' + CSS.escape(id) + '"]');
    if (!card) return;
    const element = card.querySelector(".ms-video-api__result");
    if (element) {
      const status = runtime.status.get(id);
      element.textContent = status?.text || "";
      element.className = "ms-video-api__result" + (status?.kind ? " is-" + status.kind : "");
      element.hidden = !status?.text;
    }
    const button = card.querySelector('[data-ms-video-action="models-refresh"]');
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
      #${TAB_ID} .ms-video-api-tab-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; font-size: 13px; }
      .ms-video-api__body { display: flex; flex-direction: column; gap: 14px; }
      .ms-video-api__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-video-api__status { display: flex; align-items: center; gap: 8px; color: #6d5e52; font-size: 12px; line-height: 1.6; }
      .ms-video-api__dot { width: 8px; height: 8px; border-radius: 999px; background: #ff6a1a; box-shadow: 0 0 0 4px #ff6a1a1a; }
      .ms-video-api__add { height: 32px; padding: 0 14px; border: 1px solid #ff6a1a; border-radius: 999px; background: #fff; color: #e85c12; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease, color 160ms ease; }
      .ms-video-api__add:hover { background: #ff6a1a; color: #fff; }
      .ms-video-api__message { display: none; padding: 9px 12px; border-radius: 12px; background: #e9f7ef; color: #217a50; font-size: 12px; line-height: 1.6; }
      .ms-video-api__message:not(:empty) { display: block; }
      .ms-video-api__message.is-error { background: #fff1ee; color: #b42318; }
      .ms-video-api__list { display: flex; flex-direction: column; gap: 14px; }
      .ms-video-api-card { display: flex; flex-direction: column; gap: 16px; padding: 18px; border: 1px solid #8f7c681f; border-radius: 22px; background: #ffffff8f; box-shadow: inset 0 1px #ffffff80; }
      .ms-video-api-card.is-active { border-color: #ff6a1a80; box-shadow: inset 0 1px #ffffff80, 0 0 0 3px #ff6a1a12; }
      .ms-video-api-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ms-video-api-card__identity { display: flex; align-items: center; min-width: 0; gap: 8px; }
      .ms-video-api-card__icon { color: #ff6a1a; font-size: 18px; line-height: 1; }
      .ms-video-api-card__name { overflow: hidden; color: #2f251c; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
      .ms-video-api-card__badge { padding: 3px 8px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 11px; white-space: nowrap; }
      .ms-video-api-card__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .ms-video-api-card__button { height: 30px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 160ms ease, background 160ms ease, color 160ms ease; }
      .ms-video-api-card__button:hover:not(:disabled) { transform: translateY(-1px); }
      .ms-video-api-card__button--apply { border: 1px solid #ff6a1a; background: #ff6a1a; color: #fff; }
      .ms-video-api-card__button--apply:hover:not(:disabled) { border-color: #e85c12; background: #e85c12; }
      .ms-video-api-card__button--enable { border: 1px solid #d8c9bb; background: #fff; color: #6d5e52; }
      .ms-video-api-card__button--enable.is-active { border-color: #2b9a66; background: #e9f7ef; color: #217a50; }
      .ms-video-api-card__button--primary { justify-self: start; border: 1px solid #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-video-api-card__button:disabled { cursor: not-allowed; opacity: .55; }
      .ms-video-api-card__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .ms-video-api-card__field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
      .ms-video-api-card__field--wide { grid-column: 1 / -1; }
      .ms-video-api-card__label { color: #5f5146; font-size: 12px; font-weight: 600; }
      .ms-video-api__input { width: 100%; height: 38px; box-sizing: border-box; padding: 0 12px; border: 1px solid #8f7c6829; border-radius: 11px; outline: none; background: #fff; color: #2f251c; font: inherit; font-size: 13px; }
      .ms-video-api__input:focus { border-color: #ff6a1a; box-shadow: 0 0 0 3px #ff6a1a14; }
      .ms-video-api-card__secret { position: relative; display: block; }
      .ms-video-api-card__secret .ms-video-api__input { padding-right: 44px; }
      .ms-video-api-card__secret-toggle { position: absolute; top: 50%; right: 6px; display: grid; width: 30px; height: 30px; padding: 0; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #8d7868; cursor: pointer; transform: translateY(-50%); transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease; }
      .ms-video-api-card__secret-toggle:hover { background: #8f7c6814; color: #ff6a1a; }
      .ms-video-api-card__secret-toggle:focus-visible { outline: 0; box-shadow: 0 0 0 3px #ff6a1a2e; color: #ff6a1a; }
      .ms-video-api-card__secret-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      .ms-video-api-card__secret-icon--hide { display: none; }
      .ms-video-api-card__secret-toggle[aria-pressed="true"] .ms-video-api-card__secret-icon--show { display: none; }
      .ms-video-api-card__secret-toggle[aria-pressed="true"] .ms-video-api-card__secret-icon--hide { display: block; }
      .ms-video-api-card__models { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid #8f7c681f; }
      .ms-video-api-models__toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ms-video-api-models__heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
      .ms-video-api-models__title { color: #4b3d33; font-size: 13px; font-weight: 700; }
      .ms-video-api-models__count, .ms-video-api-models__time { color: #8d7868; font-size: 11px; }
      .ms-video-api-models__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ms-video-api-models__button { height: 28px; padding: 0 12px; border: 1px solid #d8c9bb; border-radius: 999px; background: #fff; color: #6d5e52; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
      .ms-video-api-models__button--primary { border-color: #ff6a1a; background: #fff4ec; color: #d9530d; }
      .ms-video-api-models__button:disabled { cursor: not-allowed; opacity: .52; }
      .ms-video-api-models__list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; max-height: 236px; overflow: auto; overflow-anchor: none; padding: 2px; }
      .ms-video-api-model { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #8f7c681f; border-radius: 10px; background: #ffffffa6; color: #3a2f27; cursor: pointer; }
      .ms-video-api-model:hover { border-color: #ff6a1a59; background: #fffaf6; }
      .ms-video-api-model input { width: 14px; height: 14px; margin: 0; accent-color: #ff6a1a; flex: 0 0 auto; }
      .ms-video-api-model__name { min-width: 0; overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .ms-video-api-model__tag { margin-left: auto; padding: 2px 6px; border-radius: 999px; background: #8f7c6814; color: #8d7868; font-size: 9px; line-height: 1.4; flex: 0 0 auto; }
      .ms-video-api-model__tag.is-current { background: #e9f7ef; color: #217a50; }
      .ms-video-api-models__empty, .ms-video-api-models__note { color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-video-api-models__note.is-error { color: #b42318; }
      .ms-video-api-card__hint { grid-column: 1 / -1; margin: 0; color: #8d7868; font-size: 11px; line-height: 1.6; }
      .ms-video-api__result { grid-column: 1 / -1; margin: 0; font-size: 11px; line-height: 1.6; color: #8d7868; word-break: break-all; }
      .ms-video-api__result.is-ok { color: #217a50; }
      .ms-video-api__result.is-error { color: #b42318; }
      .ms-video-api__result.is-muted { color: #8d7868; }
      .ms-video-api-card__remove { grid-column: 1 / -1; justify-self: start; padding: 0; border: 0; background: transparent; color: #b42318; font: inherit; font-size: 11px; cursor: pointer; }
      .ms-video-api__footnote { margin: 0; padding: 0 4px; color: #8d7868; font-size: 11px; line-height: 1.7; }
    `;
    document.head.appendChild(style);
  }

  function settingsNav() {
    return document.querySelector(".settings-sidebar__nav");
  }

  function settingsBody() {
    return document.querySelector(".settings-modal__body");
  }

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

  // 每次同步都把按钮贴回图片 API 项的正下方，保证顺序始终是
  // 文本API（文本补丁插在图片上方）→ 图片API → 视频API → ComfyUI。
  function mountTabButton() {
    const nav = settingsNav();
    if (!nav) return false;
    const imageTab = findImageApiTab(nav);
    if (!imageTab) return false;
    let button = tabButton?.isConnected ? tabButton : document.getElementById(TAB_ID);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = TAB_ID;
      button.className = "settings-sidebar__item";
      button.dataset.msVideoTab = "true";
      button.innerHTML =
        '<span class="ms-video-api-tab-icon" aria-hidden="true">🎬</span><span>视频API来源设置</span>';
    }
    if (imageTab.nextElementSibling !== button) imageTab.after(button);
    tabButton = button;
    return true;
  }

  function selectedVideoModels(profile) {
    const allowed = new Set(profile.modelCatalog.filter(isVideoModel));
    return uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model));
  }

  function renderModelSection(profile) {
    const loading = runtime.loading.has(profile.id);
    const models = profile.modelCatalog.filter(isVideoModel);
    const selected = new Set(profile.selectedModels);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const rows = models
      .map(
        (model) => `
          <label class="ms-video-api-model" title="${escapeHtml(model)}">
            <input type="checkbox" data-ms-video-model="${escapeHtml(model)}" ${selected.has(model) ? "checked" : ""} />
            <span class="ms-video-api-model__name">${escapeHtml(model)}</span>
            <span class="ms-video-api-model__tag${model === profile.videoModel ? " is-current" : ""}">${model === profile.videoModel ? "当前" : "视频"}</span>
          </label>`,
      )
      .join("");
    return `
      <div class="ms-video-api-models__toolbar">
        <div class="ms-video-api-models__heading">
          <span class="ms-video-api-models__title">模型列表</span>
          <span class="ms-video-api-models__count">已选择 ${selected.size} 个 / 共 ${models.length} 个</span>
          ${fetchedAt ? `<span class="ms-video-api-models__time">最近拉取 ${escapeHtml(fetchedAt)}</span>` : ""}
        </div>
        <div class="ms-video-api-models__actions">
          <button type="button" class="ms-video-api-models__button ms-video-api-models__button--primary" data-ms-video-action="models-refresh" ${loading ? "disabled" : ""}>${loading ? "拉取中…" : "拉取全部模型"}</button>
          <button type="button" class="ms-video-api-models__button" data-ms-video-action="models-video" ${models.length && !loading ? "" : "disabled"}>全选视频</button>
          <button type="button" class="ms-video-api-models__button" data-ms-video-action="models-clear" ${selected.size ? "" : "disabled"}>清空</button>
        </div>
      </div>
      <div class="ms-video-api-models__note">${
        profile.builtin
          ? "勾选＝该 Key 实际可用的视频模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，留空则保持画布原生行为。"
          : "勾选＝该 Key 实际可用的视频模型。接管时优先沿用节点原本的模型名；不在勾选内时改用「模型名」输入框的值，再兜底第一个勾选项。"
      }</div>
      ${profile.modelsError ? `<div class="ms-video-api-models__note is-error">拉取失败：${escapeHtml(profile.modelsError)}</div>` : ""}
      ${models.length
        ? `<div class="ms-video-api-models__list">${rows}</div>`
        : `<div class="ms-video-api-models__empty">${loading ? "正在从平台拉取模型列表…" : "填好 API 密钥后会自动拉取；也可以点「拉取全部模型」。"}</div>`}
    `;
  }

  function modelHintText(profile) {
    const videoModels = profile.modelCatalog.filter(isVideoModel);
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const tail = videoModels.length
      ? `已拉取 ${videoModels.length} 个可用视频模型${fetchedAt ? `（${fetchedAt}）` : ""}。`
      : profile.builtin ? "填好 API 密钥后会自动拉取模型列表（Base URL 留空即走云雾默认地址）。" : "填好密钥与 Base URL 后会自动拉取模型列表。";
    if (profile.builtin) {
      return `云雾的视频接口与图片接口分开配置。模型名留空时沿用画布原来的视频模型；填写后改用这里的模型名。未填密钥或 Base URL 时保持画布原生行为。${tail}`;
    }
    return `第三方需兼容视频生成接口（/v2/videos/generations 或流式 /v1/chat/completions）。必须选定视频模型名才会接管，画布视频节点会改用这里的 Key、Base URL 与模型名。${tail}`;
  }

  // 异步拉模型时只更新局部控件，避免用户正在输入时整块重渲染导致失焦。
  function refreshModelUi(profile) {
    if (!section || !videoActive) return;
    const card = section.querySelector('[data-video-id="' + CSS.escape(profile.id) + '"]');
    if (!card) return;
    const modelsSection = card.querySelector("[data-ms-model-section]");
    if (modelsSection) {
      const next = renderModelSection(profile);
      if (modelsSection.innerHTML !== next) modelsSection.innerHTML = next;
    }
    const input = card.querySelector('[data-ms-video-field="videoModel"]');
    if (input && input !== document.activeElement) input.value = profile.videoModel;
    const hint = card.querySelector(".ms-video-api-card__hint");
    const hintText = modelHintText(profile);
    if (hint && hint.textContent !== hintText) hint.textContent = hintText;
    applyStatusToDom(profile.id);
  }

  function renderCard(profile) {
    const isActive = profile.id === videoState.activeId;
    const enableButton =
      `<button type="button" class="ms-video-api-card__button ms-video-api-card__button--enable` +
      (isActive ? " is-active" : "") +
      `" data-ms-video-action="enable"` +
      (isActive ? " disabled" : "") +
      `>` +
      (isActive ? "已启用" : "启用") +
      `</button>`;
    return `
      <article class="ms-video-api-card` + (isActive ? " is-active" : "") + `" data-video-id="${escapeHtml(profile.id)}">
        <div class="ms-video-api-card__header">
          <div class="ms-video-api-card__identity">
            <span class="ms-video-api-card__icon" aria-hidden="true">${profile.builtin ? "☁" : "🎬"}</span>
            <span class="ms-video-api-card__name">${escapeHtml(profile.name)}</span>
            <span class="ms-video-api-card__badge">${profile.builtin ? "内置兼容" : "第三方"}</span>
          </div>
          <div class="ms-video-api-card__actions">
            <button type="button" class="ms-video-api-card__button ms-video-api-card__button--apply" data-ms-video-action="apply"
              title="${profile.applyUrl.trim() ? "打开申请地址" : "请先填写申请地址"}"` +
              (profile.applyUrl.trim() ? "" : " disabled") +
              `>申请</button>
            ${enableButton}
          </div>
        </div>
        <div class="ms-video-api-card__form">
          <label class="ms-video-api-card__field">
            <span class="ms-video-api-card__label">配置名称</span>
            <input class="ms-video-api__input" data-ms-video-field="name" value="${escapeHtml(profile.name)}" placeholder="例如：可灵 / 海螺 / Runway" />
          </label>
          <label class="ms-video-api-card__field">
            <span class="ms-video-api-card__label">申请地址（可选）</span>
            <input class="ms-video-api__input" data-ms-video-field="applyUrl" value="${escapeHtml(profile.applyUrl)}" placeholder="https://example.com/register" />
          </label>
          <div class="ms-video-api-card__field">
            <label class="ms-video-api-card__label" for="ms-video-api-key-${escapeHtml(profile.id)}">API 密钥</label>
            <span class="ms-video-api-card__secret">
              <input
                id="ms-video-api-key-${escapeHtml(profile.id)}"
                class="ms-video-api__input"
                data-ms-video-field="apiKey"
                type="password"
                autocomplete="off"
                value="${escapeHtml(profile.apiKey)}"
                placeholder="sk-..."
              />
              <button
                type="button"
                class="ms-video-api-card__secret-toggle"
                data-ms-video-action="toggle-secret"
                aria-label="显示 API 密钥"
                aria-pressed="false"
                title="显示 API 密钥"
              >
                <svg class="ms-video-api-card__secret-icon ms-video-api-card__secret-icon--show" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.43-6 9.5-6 9.5 6 9.5 6-3.43 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.75"></circle>
                </svg>
                <svg class="ms-video-api-card__secret-icon ms-video-api-card__secret-icon--hide" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3l18 18"></path>
                  <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.07 0 9.5 6 9.5 6a17.8 17.8 0 0 1-3.1 3.8"></path>
                  <path d="M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.43 6 9.5 6c1.3 0 2.5-.28 3.55-.72"></path>
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                </svg>
              </button>
            </span>
          </div>
          <label class="ms-video-api-card__field">
            <span class="ms-video-api-card__label">接口地址（Base URL）</span>
            <input class="ms-video-api__input" data-ms-video-field="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="${escapeHtml(profile.builtin ? DEFAULT_BASE_URL : "https://api.example.com/v1")}" />
          </label>
          <label class="ms-video-api-card__field">
            <span class="ms-video-api-card__label">模型名（请求中 model 字段的实际值）</span>
            <input class="ms-video-api__input" data-ms-video-field="videoModel" value="${escapeHtml(profile.videoModel)}" placeholder="${profile.builtin ? "留空则沿用画布原视频模型" : "例如 kling-v2 / veo3 / seedance-1.0"}" />
          </label>
          <p class="ms-video-api-card__hint">${escapeHtml(modelHintText(profile))}</p>
          <p class="ms-video-api__result" hidden></p>
          ${profile.builtin ? "" : '<button type="button" class="ms-video-api-card__remove" data-ms-video-action="remove">删除此配置</button>'}
        </div>
        <section class="ms-video-api-card__models" data-ms-model-section>${renderModelSection(profile)}</section>
      </article>`;
  }

  function renderSection(force = false) {
    installStyles();
    const body = settingsBody();
    if (!body || !videoState) return;
    if (!section || !section.isConnected) {
      section = document.getElementById(SECTION_ID) || document.createElement("section");
      section.id = SECTION_ID;
    }
    section.className = "settings-section";
    const active = activeVideoProfile();
    const nextHtml = `
      <div class="settings-section__header">
        <h3>视频API来源设置</h3>
        <p>为画布「视频节点」单独配置 API，界面与「图片API来源设置」一致：内置云雾 + 任意第三方，同时只启用一个。云雾的视频接口需自行填写 Key 与 Base URL。</p>
      </div>
      <div class="ms-video-api__body">
        <div class="ms-video-api__toolbar">
          <div class="ms-video-api__status">
            <span class="ms-video-api__dot"></span>
            <span>当前启用：${escapeHtml(active?.name || "未配置")}</span>
          </div>
          <button type="button" class="ms-video-api__add" data-ms-video-action="add">＋ 新增第三方 API</button>
        </div>
        <p class="ms-video-api__message" role="status" aria-live="polite"></p>
        <div class="ms-video-api__list">${videoState.profiles.map((profile) => renderCard(profile)).join("")}</div>
        <p class="ms-video-api__footnote">
          同一时间只会启用一个视频配置；启用云雾但未填密钥或 Base URL 时，视频节点保持画布原生行为。
          配置与密钥只保存在当前浏览器 localStorage["${VIDEO_PROFILES_KEY}"]。
          浏览器直连第三方被跨域拦截时会自动改走本机 server.py 的 ${PROXY_PREFIX} 转发，使用第三方地址请保持 start.bat 处于运行状态。
        </p>
      </div>
    `;
    if (force || section.__msVideoHtml !== nextHtml) {
      section.innerHTML = nextHtml;
      section.__msVideoHtml = nextHtml;
    }
    if (section.parentElement !== body || body.lastElementChild !== section) body.appendChild(section);
    videoState.profiles.forEach((profile) => applyStatusToDom(profile.id));
  }

  function activate() {
    const body = settingsBody();
    if (!body || !videoState) return;
    if (!mountTabButton()) {
      showStatus("尚未找到「图片API来源设置」入口，请重新打开设置面板。", "error");
      return;
    }
    videoActive = true;
    document
      .querySelectorAll(".settings-sidebar__nav .settings-sidebar__item")
      .forEach((item) => item.classList.remove("is-active"));
    tabButton.classList.add("is-active");
    renderSection(true);
    body.classList.add(VIEW_CLASS);
    body.scrollTop = 0;
  }

  function deactivate() {
    videoActive = false;
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
        videoActive = false;
        tabButton = null;
        section = null;
      }
      return;
    }
    if (!modalWasOpen) {
      modalWasOpen = true;
      videoActive = false;
    }
    // ComfyUI 或文本 API 分区接管时让位，避免多个自定义 tab 同时占住面板。
    if (
      videoActive &&
      (body.classList.contains(COMFY_VIEW_CLASS) || body.classList.contains(TEXT_VIEW_CLASS))
    ) {
      videoActive = false;
    }
    mountTabButton();
    if (videoActive && tabButton) {
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
    const card = target?.closest?.("[data-video-id]");
    if (!card) return null;
    const profile = profileFor(card.dataset.videoId);
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

  // 浏览器直连第三方视频 API 常被 CORS 拦掉；失败时复用 server.py 的
  // /__textapi/ 通用转发，两条路都失败才报错，不静默假装成功。
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
    if (response.status === 404) {
      const text = await response.clone().text().catch(() => "");
      if (text.includes("接口不存在")) {
        throw new Error("本机 server.py 还是旧版本，未包含 API 转发接口，请重启 start.bat 后再试。");
      }
    }
    return response;
  }

  // 与 comfy/voice 同模板的 store-reader（fallbackReader 绕过冻结 snapshot）。
  // Bundle 内部在 executeNode 构造请求前就把 model 劫持成 ve3fast（查不到就回退）。
  // 我们无法等请求发出再改——必须在 bundle 拿节点数据之前把 videoModelId 塞进去。
  // 方法：包装 canvasStore.updateNodeData（或 setState），每次写入 videoModelId 时
  // 存一份到 __MS_VIDEO_NODE_MODEL__，供后续 fetch 拦截器使用。
  // 面板点模型菜单和点生成时均已写全局（video-inspector-patch.js），此处再加一层保险。
  // 同时保留 findCanvasStore 用于轮询路径等其它场景。
  function findCanvasStore() {
    try {
      const rootEl = document.getElementById("root");
      if (!rootEl) return null;
      let fallbackReader = null;
      const comps = Array.from(rootEl.children).map(el => el["_reactRootContainer"] || el["_react-fiber-container"]);
      for (const c of comps) {
        if (c && c.current && c.current.child) {
          let child = c.current.child;
          while (child) {
            const cand = child.stateNode;
            if (cand && cand !== rootEl && cand !== rootEl.parentElement) {
              try {
                if (typeof cand.getSnapshot === "function") {
                  const reader = () => cand.getSnapshot();
                  if (reader() && Array.isArray(reader().nodes) && typeof reader().updateNodeData === "function") return reader;
                  if (!fallbackReader) fallbackReader = reader;
                }
              } catch (_) {}
            }
            child = child.sibling;
          }
        } else if (c && c.stateNode) {
          const reader = () => c.stateNode._threadID ? (() => { try { return c.stateNode.getState(); } catch (_) { return null; } })() : null;
          if (!fallbackReader && reader()) fallbackReader = reader;
        }
      }
      return fallbackReader;
    } catch { return null; }
  }
  function getStateReader() { return findCanvasStore(); }

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
        const response = await requestUpstream(candidate, {
          method: "GET",
          headers,
          credentials: "omit",
        });
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
    if (profile.videoModel && !models.includes(profile.videoModel)) profile.videoModel = "";
    saveVideoState();
    const videoCount = models.filter(isVideoModel).length;
    setStatus(profile.id, `已拉取 ${models.length} 个模型，其中 ${videoCount} 个可作为视频模型。`, "ok");
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

  /* ---------- 视频节点请求改写 ---------- */

  // 本脚本必须加载在 model-patch.js 与 text-api-patch.js 之后。
  // innerFetch 是文本补丁包装过的 fetch；视频流式 chat 会被文本补丁主动放行，
  // 图片端点仍由 model-patch 处理，避免互相误伤。
  const innerFetch = window.fetch.bind(window);
  const VIDEO_ENDPOINT_RE =
    /(\/v2\/videos\/generations(?:\/[^/?#]+)*(?:\?[^#]*)?|\/v1\/video\/generations(?:\/[^/?#]+)*(?:\?[^#]*)?|\/v1\/videos(?:\/[^/?#]+)*(?:\?[^#]*)?)$/i;

  function endpointSuffix(rawUrl) {
    const text = String(rawUrl || "");
    if (!text) return "";
    let pathAndQuery = text;
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        pathAndQuery = `${url.pathname}${url.search}`;
      } catch {
        return "";
      }
    }
    const match = VIDEO_ENDPOINT_RE.exec(pathAndQuery);
    return match ? match[1] : "";
  }

  function isVideoChatEndpoint(rawUrl) {
    return /\/v1\/chat\/completions\/?$/i.test(String(rawUrl || "").split("?")[0]);
  }

  function headersToObject(headers) {
    const output = {};
    if (!headers) return output;
    if (typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        output[key] = value;
      });
      return output;
    }
    if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        output[key] = value;
      });
      return output;
    }
    Object.entries(headers).forEach(([key, value]) => {
      if (value != null) output[key] = String(value);
    });
    return output;
  }

  async function readRequestBody(input, init) {
    let body = init?.body;
    if (body == null && typeof Request !== "undefined" && input instanceof Request) {
      try {
        const clone = input.clone();
        const contentType = clone.headers.get("Content-Type") || "";
        if (/multipart\/form-data/i.test(contentType)) {
          return { kind: "form", value: await clone.formData() };
        }
        body = await clone.text();
      } catch {
        return { kind: "other", value: null };
      }
    }
    if (typeof body === "string") {
      try {
        return { kind: "json", value: JSON.parse(body) };
      } catch {
        return { kind: "text", value: body };
      }
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return { kind: "form", value: body };
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return { kind: "params", value: body };
    }
    return { kind: "other", value: body ?? null };
  }

  function canUseVideoProfile(profile) {
    if (!profile) return false;
    const base = effectiveBase(profile);
    const apiKey = profile.apiKey.trim();
    if (!base || !apiKey) return false;
    // 第三方必须给出可用模型（勾选或手填模型名）；内置云雾两者都空则沿用画布原模型。
    if (!profile.builtin && !profile.videoModel.trim() && !selectedVideoModels(profile).length) return false;
    return true;
  }

  // 勾选集合决定可直送第三方的模型名：节点原本选的若已勾选就沿用，
  // 否则退到「模型名」输入框，第三方再兜底第一个勾选项。
  function pickVideoModel(profile, requested) {
    const selected = selectedVideoModels(profile);
    const typed = profile.videoModel.trim();
    const want = String(requested || "");
    // 内置云雾：节点选了什么就发什么，「模型名」只在节点没给模型时兜底，
    // 不再静默把豆包改成 muse-video（云雾账单被扣错模型的根源）。
    if (profile.builtin && want) return want;
    let next = "";
    if (selected.length) {
      if (selected.includes(want)) next = want;
      else if (selected.includes(typed)) next = typed;
      else if (!profile.builtin) next = selected[0];
    }
    if (!next && typed) next = typed;
    return next;
  }

  function withAuth(init, profile, accept) {
    const headers = headersToObject(init?.headers);
    headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
    if (accept) headers.Accept = accept;
    return {
      ...init,
      headers,
      credentials: "omit",
    };
  }

  async function buildVideoRewrite(input, init) {
    const profile = activeVideoProfile();
    if (!canUseVideoProfile(profile)) return null;
    const rawUrl =
      typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    if (!rawUrl) return null;
    const proxied = rawUrl.startsWith(PROXY_PREFIX) || rawUrl.includes(`${PROXY_PREFIX}proxy`);
    if (proxied) return null;
    // 云雾视频网关是 openlux（DEFAULT_BASE_URL）；rrrsai 没有视频路由，
    // 故空接口地址必须回退 openlux，不能回退画布原生 rawUrl。
    const base = effectiveBase(profile);
    const parsed = await readRequestBody(input, init);
    let payload = parsed.kind === "json" ? parsed.value || {} : null;
    const endpoint = endpointSuffix(rawUrl);
    // Patch model using localStorage (more reliable than store reader)
    if (payload && typeof payload.model === "string") {
      const savedModel = typeof localStorage !== "undefined"
        ? localStorage.getItem("ms_video_model") || ""
        : "";
      if (savedModel) payload.model = savedModel;
    }
    const openAiVideo = profile.builtin || /openlux/i.test(base);
    let videoSuffix = endpoint;
    // 豆包/seedance：云雾文档标明走火山原生 /api/v3/contents/generations/tasks，
    // body 为 content[] 结构（text + first/last_frame 图），不是 OpenAI /v1/videos。
    const volcModel = Boolean(payload && /seedance|doubao/i.test(String(payload.model || "")));
    const volcMethod = String(init?.method || (input instanceof Request ? input.method : "POST")).toUpperCase();
    let volcSubmit = false;
    if (volcModel && volcMethod === "POST" && /^\/(?:v2\/videos\/generations|v1\/videos)(?:\/|$|\?)/i.test(endpoint)) {
      const content = [];
      const text = String(payload.prompt || "");
      if (text) content.push({ type: "text", text });
      const imgs = Array.isArray(payload.images)
        ? payload.images.filter((x) => typeof x === "string" && x)
        : typeof payload.image === "string" && payload.image ? [payload.image]
        : typeof payload.image?.url === "string" && payload.image.url ? [payload.image.url]
        : [];
      const roles = ["first_frame", "last_frame"];
      imgs.slice(0, 2).forEach((u, i) => content.push({ type: "image_url", image_url: { url: u }, role: roles[i] }));
      const sizeKey = String(payload.size || "").toLowerCase();
      const dur = Math.round(Number(payload.duration));
      const next = {
        model: payload.model,
        content,
        resolution: sizeKey === "1920x1080" || sizeKey === "1080x1920" ? "1080p"
          : sizeKey === "1280x720" || sizeKey === "720x1280" ? "720p" : "480p",
      };
      if (payload.aspect_ratio) next.ratio = payload.aspect_ratio;
      if (Number.isFinite(dur) && dur > 0) next.duration = dur;
      payload = next;
      videoSuffix = "/api/v3/contents/generations/tasks";
      volcSubmit = true;
    }
    if (openAiVideo && !volcSubmit && !/\/api\/v3\//.test(videoSuffix) && /^\/v2\/videos\/generations(?=\/|$|\?)/i.test(endpoint)) {
      videoSuffix = endpoint.replace(/^\/v2\/videos\/generations/i, "/v1/videos");
      if (payload && payload.seconds == null && payload.duration != null) {
        const dur = Number(payload.duration);
        payload.seconds = Number.isFinite(dur) ? Math.round(dur) : payload.duration;
        delete payload.duration;
      }
      // OpenAI 视频格式参考图字段是 input_reference
      if (payload && payload.input_reference == null) {
        const ref = typeof payload.image?.url === "string" ? payload.image.url
          : typeof payload.image === "string" ? payload.image
          : Array.isArray(payload.images) ? payload.images[0] : null;
        if (ref) payload.input_reference = ref;
      }
      // bundle 的 image 是 {url} 对象；OpenAI 视频格式该位置是字符串，
      // 网关 JSON 校验会报 invalid JSON value type。摊平成 data URL 字符串。
      if (payload && payload.image && typeof payload.image === "object") {
        payload.image = typeof payload.image.url === "string" ? payload.image.url : String(payload.image.url ?? "");
      }
    }

    if (endpoint) {
      // 生成、查询和内容下载都可能带同一前缀，整段 suffix 原样接到新 Base URL 后。
      if (parsed.kind === "form" && parsed.value) {
        const next = pickVideoModel(profile, parsed.value.get("model"));
        if (next) parsed.value.set("model", next);
      } else if (payload) {
        const next = pickVideoModel(profile, payload.model);
        if (next) payload.model = next;
      }
      const body =
        parsed.kind === "json"
          ? JSON.stringify(payload)
          : parsed.kind === "form" || parsed.kind === "params" || parsed.kind === "text"
            ? parsed.value
            : init?.body;
      const outUrl = `${base}${videoSuffix}`;
      return {
        url: outUrl,
        init: withAuth(
          {
            ...init,
            method: String(init?.method || (input instanceof Request ? input.method : "POST")).toUpperCase(),
            body,
          },
          profile,
          parsed.kind === "json" ? "application/json" : "",
        ),
      };
    }

    if (!isVideoChatEndpoint(rawUrl) || !payload || !Array.isArray(payload.messages)) return null;
    const looksLikeVideo =
      payload.video_length != null ||
      (payload.resolution != null && payload.aspect_ratio != null) ||
      isVideoModel(payload.model);
    // 视频 SSE 也走 chat/completions；只接流式且明确命中视频字段/模型名的请求，
    // 非流式文本请求留给 text-api-patch。
    if (payload.stream !== true || !looksLikeVideo) return null;
    const sseNext = pickVideoModel(profile, payload.model);
    if (sseNext) payload.model = sseNext;
    return {
      url: `${base}/v1/chat/completions`,
      init: withAuth(
        {
          ...init,
          method: "POST",
          headers: { ...headersToObject(init?.headers), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        profile,
        "text/event-stream",
      ),
    };
  }


  // openlux 火山提交同时返回 id（task_xxx，openlux 单号）与 task_id（cgt-xxx，上游号）。
  // 实测 /v1/videos 与 /api/v3 查 cgt-xxx 都 400；openlux 文档查询口径是自家单号，
  // 故抹掉 task_id，bundle 取 id 轮询 GET /v1/videos/task_xxx。
  async function patchVolcSubmitResponse(response) {
    try {
      const j = await response.clone().json();
      if (j && j.id && j.task_id && j.id !== j.task_id) {
        const copy = { ...j };
        delete copy.task_id;
        return new Response(JSON.stringify(copy), {
          status: response.status,
          statusText: response.statusText,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
    return response;
  }

  // 火山查询把视频放在 content.video_url，bundle 只认 url/video_url/data.* 等位置，补一份。
  async function patchVolcQueryResponse(response) {
    try {
      const j = await response.clone().json();
      const u = j?.content?.video_url || j?.data?.content?.video_url;
      if (u && !j.url && !j.video_url) {
        return new Response(JSON.stringify({ ...j, url: u, video_url: u }), {
          status: response.status,
          statusText: response.statusText,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
    return response;
  }



  // 网关 400 常见句式「<model> does not accept duration, use seconds (integer 4-30)」。
  // 命中就按它说的改字段（必要时转整数）、删旧字段，自动重试一次。
  async function retryOnSchemaError(response, url, init, depth = 0) {
    if (response.status !== 400 || typeof init?.body !== "string" || depth >= 3) return response;
    const text = await response.clone().text().catch(() => "");
    const m = /does not accept ([a-zA-Z_]+), use ([a-zA-Z_]+)/.exec(text);
    if (!m) return response;
    let payload;
    try { payload = JSON.parse(init.body); } catch { return response; }
    const bad = m[1], good = m[2];
    if (payload[bad] == null) return response;
    const wantInt = /integer/i.test(text);
    const num = Number(payload[bad]);
    payload[good] = wantInt && Number.isFinite(num) ? Math.round(num) : payload[bad];
    delete payload[bad];
    const next = { ...init, body: JSON.stringify(payload) };
    const retried = await guardVideoHtmlResponse(await requestUpstream(url, next), url);
    return await retryOnSchemaError(retried, url, next, depth + 1);
  }

  // 网关对错误端点/失效 Key 常回 200 + HTML 首页，而非 JSON 错误。
  // 识别到 HTML 就翻成 502 JSON，杜绝「请求已返回」假成功。
  async function guardVideoHtmlResponse(response, url) {
    if (response.status >= 400) return response;
    const type = (response.headers.get("Content-Type") || "").toLowerCase();
    // 明确是 JSON 的直接放行，不读体（视频轮询频繁，避免每次 clone+text）
    if (type.includes("application/json")) return response;
    // 只有可能是 HTML（text/html 或空 Content-Type）才读体探测
    const text = await response.clone().text().catch(() => "");
    const head = text.slice(0, 240).toLowerCase();
    if (!head.includes("<!doctype html") && !head.includes("<html")) return response;
    return new Response(
      JSON.stringify({ error: { message: "视频接口返回的是网页而不是 JSON（端点路径、模型名或密钥可能不被该视频 API 接受）。请核对「视频API来源设置」里的 Base URL / 模型名 / Key。目标：" + String(url).split("?")[0] } }),
      { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "application/json" } },
    );
  }

  window.fetch = async function patchedVideoApiFetch(input, init) {
    let rewrite = null;
    try {
      rewrite = await buildVideoRewrite(input, init);
    } catch {
      rewrite = null;
    }
    if (!rewrite) return innerFetch(input, init);
    try {
      const rawResponse = await requestUpstream(rewrite.url, rewrite.init);
      let response = rawResponse;
      if (/\/contents\/generations\/tasks\//.test(rewrite.url)) {
        response = await patchVolcQueryResponse(rawResponse);
      } else if (/\/contents\/generations\/tasks/.test(rewrite.url)) {
        response = await patchVolcSubmitResponse(rawResponse);
      }
      const guarded = await guardVideoHtmlResponse(response, rewrite.url);
      return await retryOnSchemaError(guarded, rewrite.url, rewrite.init);
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
      } else if (videoActive) {
        deactivate();
      }
      return;
    }
    if (!section || !section.contains(event.target)) return;
    const button = event.target.closest("[data-ms-video-action]");
    if (!button) return;
    const action = button.dataset.msVideoAction;

    if (action === "add") {
      event.preventDefault();
      event.stopPropagation();
      const profile = blankProfile(videoState.profiles.filter((item) => !item.builtin).length + 1);
      videoState.profiles.push(profile);
      saveVideoState();
      renderSection(true);
      showStatus(`已添加「${profile.name}」，填写密钥、Base URL 和视频模型后点「启用」。`);
      return;
    }

    const found = cardFor(button);
    if (!found) return;
    const { profile } = found;
    event.preventDefault();
    event.stopPropagation();

    if (action === "toggle-secret") {
      const input = button
        .closest(".ms-video-api-card__secret")
        ?.querySelector('[data-ms-video-field="apiKey"]');
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
      if (videoState.activeId === profile.id) return;
      const missing = [];
      if (!profile.apiKey.trim()) missing.push("API 密钥");
      if (!effectiveBase(profile)) missing.push("Base URL");
      if (!profile.builtin && !profile.videoModel.trim() && !selectedVideoModels(profile).length) {
        missing.push("视频模型（勾选模型或填写模型名）");
      }
      if (missing.length) {
        setStatus(profile.id, "启用前请先填写：" + missing.join("、") + "。", "error");
        showStatus("该配置还缺少" + missing.join("、") + "，暂不能启用。", "error");
        return;
      }
      videoState.activeId = profile.id;
      saveVideoState();
      renderSection(true);
      showStatus(`已启用「${profile.name}」，画布视频节点将改用该配置。`);
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

    if (action === "models-video") {
      profile.selectedModels = profile.modelCatalog.filter(isVideoModel);
      if (!profile.videoModel) profile.videoModel = profile.selectedModels[0] || "";
      saveVideoState();
      refreshModelUi(profile);
      showStatus(`已勾选 ${profile.selectedModels.length} 个视频模型。`);
      return;
    }

    if (action === "models-clear") {
      profile.selectedModels = [];
      saveVideoState();
      refreshModelUi(profile);
      showStatus("已清空模型勾选；接管时将只使用「模型名」输入框里的模型。");
      return;
    }
    if (action === "remove") {
      if (profile.builtin) return;
      if (!window.confirm(`确认删除「${profile.name}」？`)) return;
      videoState.profiles = videoState.profiles.filter((item) => item.id !== profile.id);
      if (videoState.activeId === profile.id) videoState.activeId = BUILTIN_ID;
      runtime.status.delete(profile.id);
      const timer = runtime.timers.get(profile.id);
      if (timer) window.clearTimeout(timer);
      runtime.timers.delete(profile.id);
      saveVideoState();
      renderSection(true);
      showStatus(`已删除「${profile.name}」。`);
    }
  }

  function handleInput(event) {
    const field = event.target?.closest?.("[data-ms-video-field]");
    if (!field || !section?.contains(field)) return;
    const found = cardFor(field);
    if (!found) return;
    const key = field.dataset.msVideoField;
    if (!["name", "apiKey", "baseUrl", "applyUrl", "videoModel"].includes(key)) return;
    found.profile[key] = field.value;
    if (key === "name") {
      const label = found.card.querySelector(".ms-video-api-card__name");
      if (label) label.textContent = field.value || "未命名视频 API";
    }
    if (key === "baseUrl" || key === "apiKey") scheduleModelsFetch(found.profile);
    saveVideoState();
  }

  function handleChange(event) {
    const checkbox = event.target?.closest?.("[data-ms-video-model]");
    if (!checkbox || !section?.contains(checkbox)) return;
    const found = cardFor(checkbox);
    if (!found) return;
    const { profile } = found;
    const allowed = new Set(profile.modelCatalog.filter(isVideoModel));
    const selected = new Set(uniqueStringList(profile.selectedModels).filter((model) => allowed.has(model)));
    if (checkbox.checked) selected.add(checkbox.dataset.msVideoModel);
    else selected.delete(checkbox.dataset.msVideoModel);
    profile.selectedModels = profile.modelCatalog.filter(
      (model) => allowed.has(model) && selected.has(model),
    );
    if (profile.videoModel && !selected.has(profile.videoModel) && profile.selectedModels.length) {
      profile.videoModel = profile.selectedModels[0];
    } else if (!profile.videoModel && profile.selectedModels.length) {
      profile.videoModel = profile.selectedModels[0];
    }
    const input = found.card.querySelector('[data-ms-video-field="videoModel"]');
    if (input && input !== document.activeElement) input.value = profile.videoModel;
    saveVideoState();
    refreshModelUi(profile);
    setStatus(
      profile.id,
      profile.selectedModels.length
        ? `已勾选 ${profile.selectedModels.length} 个视频模型，当前使用 ${profile.videoModel}。`
        : "尚未勾选视频模型，接管时只会使用「模型名」输入框的值。",
      profile.selectedModels.length ? "ok" : "muted",
    );
  }

  window.__MS_VIDEO_API_PATCH__ = {
    version: "20261114-8",
    state: () => videoState,
    active: () => videoActive,
    open: () => {
      activate();
      return videoActive;
    },
    close: deactivate,
  };

  function init() {
    videoState = readVideoState();
    saveVideoState();
    installStyles();
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    window.addEventListener("storage", (event) => {
      if (event.key !== VIDEO_PROFILES_KEY) return;
      videoState = readVideoState();
      publishActiveVideo();
      if (videoActive) renderSection(true);
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