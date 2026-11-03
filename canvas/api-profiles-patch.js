(() => {
  "use strict";

  const PROFILES_KEY = "manshiguang:canvas-api-profiles";
  const CANVAS_SETTINGS_KEY = "canvas-api-settings";
  const API_STORAGE_KEY = "manshiguang:canvas-api-storage";
  const API_CONFIG_FILE_NAME = "manshiguang-api-config.json";
  const STYLE_ID = "ms-api-profiles-style";
  const ROOT_ID = "ms-api-profiles";
  const STORAGE_CARD_ID = "ms-api-storage-card";
  const BUILTIN_ID = "yunwu";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const BUILTIN_APPLY_URL = "https://api.openlux.ai/register?aff=MYE2";
  const MODEL_FETCH_DEBOUNCE_MS = 700;

  let profileState = null;
  let apiStorageState = null;
  let renderQueued = false;
  const apiStorageRuntime = {
    timer: null,
    writing: false,
    pending: false,
    profileLoaded: false,
    status: "",
    statusError: false,
    statusTimer: null,
  };
  const modelRuntime = {
    loading: new Set(),
    timers: new Map(),
    attempted: new Map(),
  };
  const modelScrollRuntime = {
    pending: null,
    sequence: 0,
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  function normalizeBaseUrl(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      const path = url.pathname
        .replace(/\/v1\/draw\/.*$/i, "")
        .replace(/\/v1\/images(\/.*)?$/i, "")
        .replace(/\/v1\/api(\/.*)?$/i, "")
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

  function uniqueStringList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item && !seen.has(item) && seen.add(item));
  }

  function isImageModel(model) {
    const id = String(model || "");
    if (/embedding|rerank|moderation|whisper|tts|audio|speech|realtime|transcri/i.test(id)) {
      return false;
    }
    return /image|banana|imagen|flux|dall|stable-diffusion|sdxl|seedream|kolors|midjourney|^mj[-_.]|draw|paint|vision/i.test(id);
  }

  const createId = () =>
    `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function findNativeVendorCard() {
    return [...document.querySelectorAll(".settings-modal__vendors-list .vendor-card")].find(
      (card) => card.querySelector(".vendor-badge")?.textContent?.trim() === BUILTIN_ID,
    );
  }

  function nativeInputs(card) {
    if (!card) return { apiKey: null, baseUrl: null };
    const inputs = [...card.querySelectorAll("input")].filter(
      (input) => input.type !== "checkbox",
    );
    return {
      apiKey: inputs.find((input) => !input.classList.contains("url-input")) || null,
      baseUrl: inputs.find((input) => input.classList.contains("url-input")) || null,
    };
  }

  function createDefaultProfile(nativeCard) {
    const inputs = nativeInputs(nativeCard);
    return {
      id: BUILTIN_ID,
      name: "云雾",
      apiKey: inputs.apiKey?.value || "",
      baseUrl: inputs.baseUrl?.value || "",
      applyUrl: BUILTIN_APPLY_URL,
      builtin: true,
      modelCatalog: [],
      selectedModels: [],
      modelsFetchedAt: 0,
      modelsError: "",
      modelsBaseUrl: "",
    };
  }

  function normalizeProfile(value, index) {
    if (!value || typeof value !== "object") return null;
    const builtin = value.id === BUILTIN_ID;
    return {
      id:
        typeof value.id === "string" && value.id.trim()
          ? value.id.trim()
          : builtin
            ? BUILTIN_ID
            : createId(),
      name:
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : builtin
            ? "云雾"
            : `第三方 API ${index + 1}`,
      apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
      baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
      applyUrl:
        typeof value.applyUrl === "string"
          ? value.applyUrl
          : builtin
            ? BUILTIN_APPLY_URL
            : "",
      builtin,
      modelCatalog: builtin ? [] : uniqueStringList(value.modelCatalog),
      selectedModels: builtin ? [] : uniqueStringList(value.selectedModels),
      modelsFetchedAt: Number.isFinite(Number(value.modelsFetchedAt))
        ? Number(value.modelsFetchedAt)
        : 0,
      modelsError: typeof value.modelsError === "string" ? value.modelsError : "",
      modelsBaseUrl: typeof value.modelsBaseUrl === "string" ? value.modelsBaseUrl : "",
    };
  }

  function readStoredProfiles() {
    try {
      const raw = window.localStorage.getItem(PROFILES_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function normalizeProfileState(value, nativeCard) {
    const stored = value && typeof value === "object" ? value : {};
    const profiles = Array.isArray(stored.profiles)
      ? stored.profiles.map(normalizeProfile).filter(Boolean)
      : [];
    if (!profiles.some((profile) => profile.id === BUILTIN_ID)) {
      profiles.unshift(createDefaultProfile(nativeCard));
    }

    const seen = new Set();
    const uniqueProfiles = profiles.filter((profile) => {
      if (seen.has(profile.id)) return false;
      seen.add(profile.id);
      return true;
    });
    const activeId = uniqueProfiles.some((profile) => profile.id === stored?.activeId)
      ? stored.activeId
      : BUILTIN_ID;

    return { version: 1, activeId, profiles: uniqueProfiles };
  }

  function loadProfileState(nativeCard) {
    return normalizeProfileState(readStoredProfiles(), nativeCard);
  }

  function readApiStorageState() {
    let stored = null;
    try {
      const raw = window.localStorage.getItem(API_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    return {
      version: 1,
      mode: stored?.mode === "directory" ? "directory" : "browser",
      directoryToken:
        typeof stored?.directoryToken === "string" ? stored.directoryToken : "",
      directoryName:
        typeof stored?.directoryName === "string" ? stored.directoryName : "",
    };
  }

  function saveApiStorageState() {
    if (!apiStorageState) return;
    try {
      window.localStorage.setItem(
        API_STORAGE_KEY,
        JSON.stringify(apiStorageState),
      );
    } catch {
      setApiStorageStatus("保存位置设置未能写入浏览器本地存储。", true);
    }
  }

  function saveProfileState(options = {}) {
    if (!profileState) return;
    try {
      window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profileState));
    } catch {
      showStatus("配置已更新，但浏览器未能写入本地存储。", true);
    }
    if (apiStorageRuntime.profileLoaded && !options.skipStorage) {
      scheduleApiStorageWrite();
    }
  }

  function activeProfile() {
    return profileState?.profiles.find(
      (profile) => profile.id === profileState.activeId,
    );
  }

  function setNativeInputValue(input, value) {
    if (!input) return false;
    const nextValue = String(value ?? "");
    if (input.value === nextValue) return false;
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, nextValue);
    else input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function persistActiveProfile(profile) {
    try {
      const raw = window.localStorage.getItem(CANVAS_SETTINGS_KEY);
      if (!raw) return;
      const persisted = JSON.parse(raw);
      if (!persisted || typeof persisted !== "object") return;
      const state = persisted.state && typeof persisted.state === "object"
        ? persisted.state
        : {};
      state.vendorConfigs = {
        ...(state.vendorConfigs || {}),
        [BUILTIN_ID]: {
          ...(state.vendorConfigs?.[BUILTIN_ID] || {}),
          enabled: true,
          apiKey: profile.apiKey,
          baseUrlOverride: normalizeBaseUrl(profile.baseUrl),
        },
      };
      persisted.state = state;
      window.localStorage.setItem(CANVAS_SETTINGS_KEY, JSON.stringify(persisted));
    } catch {
      // The native inputs remain the source of truth; persistence will retry on the next edit.
    }
  }

  function syncActiveToCanvas() {
    const profile = activeProfile();
    const nativeCard = findNativeVendorCard();
    if (!profile || !nativeCard) return false;
    const inputs = nativeInputs(nativeCard);
    setNativeInputValue(inputs.apiKey, profile.apiKey);
    setNativeInputValue(inputs.baseUrl, profile.baseUrl);
    window.setTimeout(() => persistActiveProfile(profile), 0);
    return true;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ms-api-native-card { display: none !important; }
      .settings-toggle-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--text-secondary, #6d5e52);
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
      }
      .settings-toggle-row input[type="checkbox"] {
        position: relative;
        width: 36px;
        height: 20px;
        flex: 0 0 auto;
        margin: 0;
        border: 1px solid #c9beb4;
        border-radius: 999px;
        outline: none;
        appearance: none;
        -webkit-appearance: none;
        background: #d8d1ca;
        cursor: pointer;
        transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
      }
      .settings-toggle-row input[type="checkbox"]::after {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px #2f251c33;
        content: "";
        transition: transform 160ms ease;
      }
      .settings-toggle-row input[type="checkbox"]:checked {
        border-color: #ff6a1a;
        background: #ff6a1a;
      }
      .settings-toggle-row input[type="checkbox"]:checked::after {
        transform: translateX(16px);
      }
      .settings-toggle-row input[type="checkbox"]:focus-visible {
        box-shadow: 0 0 0 3px #ff6a1a29;
      }
      .settings-toggle-row:has(input[type="checkbox"]:checked) {
        color: #d9530d;
      }
      .ms-api-manager {
        display: flex;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 16px;
      }
      .ms-api-manager__toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .ms-api-manager__status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #6d5e52;
        font-size: 12px;
        line-height: 1.6;
      }
      .ms-api-manager__dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #ff6a1a;
        box-shadow: 0 0 0 4px #ff6a1a1a;
      }
      .ms-api-manager__add {
        height: 32px;
        padding: 0 14px;
        border: 1px solid #ff6a1a;
        border-radius: 999px;
        background: #fff;
        color: #e85c12;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .ms-api-card {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 18px;
        border: 1px solid #8f7c681f;
        border-radius: 22px;
        background: #ffffff8f;
        box-shadow: inset 0 1px #ffffff80;
      }
      .ms-api-card.is-active {
        border-color: #ff6a1a80;
        box-shadow: inset 0 1px #ffffff80, 0 0 0 3px #ff6a1a12;
      }
      .ms-api-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .ms-api-card__identity {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 8px;
      }
      .ms-api-card__icon {
        color: #ff6a1a;
        font-size: 18px;
        line-height: 1;
      }
      .ms-api-card__name {
        overflow: hidden;
        color: #2f251c;
        font-size: 14px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ms-api-card__badge {
        padding: 3px 8px;
        border-radius: 999px;
        background: #8f7c6814;
        color: #8d7868;
        font-size: 11px;
        white-space: nowrap;
      }
      .ms-api-card__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .ms-api-card__button {
        height: 30px;
        padding: 0 14px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 160ms ease, background 160ms ease, color 160ms ease;
      }
      .ms-api-card__button:hover:not(:disabled) {
        transform: translateY(-1px);
      }
      .ms-api-card__button--apply {
        border: 1px solid #ff6a1a;
        background: #ff6a1a;
        color: #fff;
      }
      .ms-api-card__button--apply:hover:not(:disabled) {
        border-color: #e85c12;
        background: #e85c12;
      }
      .ms-api-card__button--enable {
        border: 1px solid #d8c9bb;
        background: #fff;
        color: #6d5e52;
      }
      .ms-api-card__button--enable.is-active {
        border-color: #2b9a66;
        background: #e9f7ef;
        color: #217a50;
      }
      .ms-api-card__button:disabled {
        cursor: not-allowed;
        opacity: .55;
      }
      .ms-api-card__form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }
      .ms-api-card__field {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 7px;
      }
      .ms-api-card__field--wide { grid-column: 1 / -1; }
      .ms-api-card__label {
        color: #5f5146;
        font-size: 12px;
        font-weight: 600;
      }
      .ms-api-card__input {
        width: 100%;
        height: 38px;
        box-sizing: border-box;
        padding: 0 12px;
        border: 1px solid #8f7c6829;
        border-radius: 11px;
        outline: none;
        background: #fff;
        color: #2f251c;
        font: inherit;
        font-size: 13px;
      }
      .ms-api-card__input:focus {
        border-color: #ff6a1a;
        box-shadow: 0 0 0 3px #ff6a1a14;
      }
      .ms-api-card__secret {
        position: relative;
        display: block;
      }
      .ms-api-card__secret .ms-api-card__input {
        padding-right: 44px;
      }
      .ms-api-card__secret-toggle {
        position: absolute;
        top: 50%;
        right: 6px;
        display: grid;
        width: 30px;
        height: 30px;
        padding: 0;
        place-items: center;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #8d7868;
        cursor: pointer;
        transform: translateY(-50%);
        transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease;
      }
      .ms-api-card__secret-toggle:hover {
        background: #8f7c6814;
        color: #ff6a1a;
      }
      .ms-api-card__secret-toggle:focus-visible {
        outline: 0;
        box-shadow: 0 0 0 3px #ff6a1a2e;
        color: #ff6a1a;
      }
      .ms-api-card__secret-icon {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }
      .ms-api-card__secret-icon--hide { display: none; }
      .ms-api-card__secret-toggle[aria-pressed="true"] .ms-api-card__secret-icon--show {
        display: none;
      }
      .ms-api-card__secret-toggle[aria-pressed="true"] .ms-api-card__secret-icon--hide {
        display: block;
      }
      .ms-api-card__hint {
        color: #8d7868;
        font-size: 11px;
        line-height: 1.6;
      }
      .ms-api-manager__footnote {
        margin: 0;
        padding: 0 4px;
        color: #8d7868;
        font-size: 11px;
        line-height: 1.7;
      }
      .ms-api-manager__message {
        display: none;
        padding: 9px 12px;
        border-radius: 12px;
        background: #e9f7ef;
        color: #217a50;
        font-size: 12px;
      }
      .ms-api-manager__message.is-visible { display: block; }
      .ms-api-manager__message.is-error {
        background: #fff1ee;
        color: #b42318;
      }
      .ms-api-card__models {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 14px;
        border-top: 1px solid #8f7c681f;
      }
      .ms-api-models__toolbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .ms-api-models__heading {
        display: flex;
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ms-api-models__title {
        color: #4b3d33;
        font-size: 13px;
        font-weight: 700;
      }
      .ms-api-models__count,
      .ms-api-models__time {
        color: #8d7868;
        font-size: 11px;
      }
      .ms-api-models__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ms-api-models__button {
        height: 28px;
        padding: 0 12px;
        border: 1px solid #d8c9bb;
        border-radius: 999px;
        background: #fff;
        color: #6d5e52;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .ms-api-models__button--primary {
        border-color: #ff6a1a;
        background: #fff4ec;
        color: #d9530d;
      }
      .ms-api-models__button:disabled {
        cursor: not-allowed;
        opacity: .52;
      }
      .ms-api-models__list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
        max-height: 236px;
        overflow: auto;
        overflow-anchor: none;
        padding: 2px;
      }
      .ms-api-model {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid #8f7c681f;
        border-radius: 10px;
        background: #ffffffa6;
        color: #3a2f27;
        cursor: pointer;
      }
      .ms-api-model:hover {
        border-color: #ff6a1a59;
        background: #fffaf6;
      }
      .ms-api-model input {
        width: 14px;
        height: 14px;
        margin: 0;
        accent-color: #ff6a1a;
        flex: 0 0 auto;
      }
      .ms-api-model__name {
        min-width: 0;
        overflow: hidden;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ms-api-model__tag {
        margin-left: auto;
        padding: 2px 6px;
        border-radius: 999px;
        background: #8f7c6814;
        color: #8d7868;
        font-size: 9px;
        line-height: 1.4;
        flex: 0 0 auto;
      }
      .ms-api-model__tag.is-image {
        background: #e9f7ef;
        color: #217a50;
      }
      .ms-api-models__empty,
      .ms-api-models__note {
        padding: 9px 11px;
        border-radius: 10px;
        background: #8f7c680d;
        color: #8d7868;
        font-size: 11px;
        line-height: 1.65;
      }
      .ms-api-models__note.is-error {
        background: #fff1ee;
        color: #b42318;
      }
      .ms-api-models__note.is-warning {
        background: #fff8e7;
        color: #8a5a00;
      }
      .ms-api-card__remove {
        align-self: flex-start;
        padding: 0;
        border: 0;
        background: transparent;
        color: #b42318;
        font-size: 11px;
        cursor: pointer;
      }
      .ms-api-storage-card {
        gap: 14px;
      }
      .ms-api-storage-card__badge {
        padding: 4px 9px;
        border-radius: 999px;
        background: #ff6a1a14;
        color: #d9530d;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }
      .ms-api-storage-card__body {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ms-api-storage-card__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
      }
      .ms-api-storage-card__label {
        color: var(--text-primary, #2f251c);
        font-size: 12px;
        font-weight: 600;
      }
      .ms-api-storage-card__description,
      .ms-api-storage-card__hint,
      .ms-api-storage-card__warning {
        margin: 0;
        color: var(--text-secondary, #8d7868);
        font-size: 11px;
        line-height: 1.7;
      }
      .ms-api-storage-card__warning {
        padding: 9px 11px;
        border-radius: 10px;
        background: #fff8e7;
        color: #8a5a00;
      }
      .ms-api-storage-card__directory {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 12px;
        border: 1px solid var(--panel-border, #8f7c6829);
        border-radius: 12px;
        background: var(--panel-bg-muted, #ffffff80);
      }
      .ms-api-storage-card__directory-main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 3px;
      }
      .ms-api-storage-card__directory-name {
        overflow: hidden;
        color: var(--text-primary, #3a2f27);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ms-api-storage-card__directory-file {
        color: var(--text-secondary, #8d7868);
        font-size: 10px;
      }
      .ms-api-storage-card__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .ms-api-storage-card__actions .path-picker__btn {
        height: 32px;
        padding: 0 13px;
        border-radius: 999px;
        font-size: 11px;
      }
      .ms-api-storage-card__status {
        display: none;
        padding: 8px 11px;
        border-radius: 10px;
        background: #e9f7ef;
        color: #217a50;
        font-size: 11px;
        line-height: 1.6;
      }
      .ms-api-storage-card__status.is-visible {
        display: block;
      }
      .ms-api-storage-card__status.is-error {
        background: #fff1ee;
        color: #b42318;
      }
      :root[data-theme="dark"] .ms-api-storage-card__badge {
        background: #f2f5fb1a;
        color: var(--text-primary, #edf1f7);
      }
      :root[data-theme="dark"] .ms-api-storage-card__directory {
        background: var(--panel-bg-soft);
      }
      :root[data-theme="dark"] .ms-api-storage-card__warning {
        background: #ffd16618;
        color: #ffd166;
      }
      :root[data-theme="dark"] .ms-api-storage-card__status {
        background: #2b9a6624;
        color: #7fe0ae;
      }
      :root[data-theme="dark"] .ms-api-storage-card__status.is-error {
        background: #ff6f6118;
        color: #ff8a80;
      }
      @media (max-width: 640px) {
        .ms-api-card__header { align-items: flex-start; }
        .ms-api-card__actions { flex-wrap: wrap; justify-content: flex-end; }
        .ms-api-card__form { grid-template-columns: 1fr; }
        .ms-api-card__field--wide { grid-column: auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function showStatus(message, isError = false) {
    const root = document.getElementById(ROOT_ID);
    const element = root?.querySelector(".ms-api-manager__message");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.add("is-visible");
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(
      () => element.classList.remove("is-visible"),
      3200,
    );
  }

  function findGeneralSettingsSection() {
    return [...document.querySelectorAll(".settings-section")].find(
      (section) =>
        section.querySelector(".settings-section__header h3")?.textContent?.trim() ===
        "常规设置",
    );
  }

  function findAssetStorageCard() {
    const section = findGeneralSettingsSection();
    if (!section) return null;
    return [...section.querySelectorAll(".vendor-card")].find(
      (card) =>
        card.querySelector(".vendor-name")?.textContent?.trim() ===
        "资产存储目录",
    );
  }

  function updateApiStorageStatusElement() {
    const element = document.querySelector(
      `#${STORAGE_CARD_ID} .ms-api-storage-card__status`,
    );
    if (!element) return;
    element.textContent = apiStorageRuntime.status;
    element.classList.toggle("is-error", apiStorageRuntime.statusError);
    element.classList.toggle(
      "is-visible",
      Boolean(apiStorageRuntime.status),
    );
  }

  function setApiStorageStatus(message, isError = false, autoHide = true) {
    apiStorageRuntime.status = String(message || "");
    apiStorageRuntime.statusError = Boolean(isError);
    updateApiStorageStatusElement();
    window.clearTimeout(apiStorageRuntime.statusTimer);
    if (!apiStorageRuntime.status || !autoHide) return;
    apiStorageRuntime.statusTimer = window.setTimeout(() => {
      apiStorageRuntime.status = "";
      apiStorageRuntime.statusError = false;
      updateApiStorageStatusElement();
    }, 4200);
  }

  function renderApiStorageCard() {
    const card = document.getElementById(STORAGE_CARD_ID);
    if (!card) return;
    if (!apiStorageState) apiStorageState = readApiStorageState();
    const isDirectory = apiStorageState.mode === "directory";
    const hasDirectory = Boolean(apiStorageState.directoryToken);
    const directoryName = apiStorageState.directoryName || "尚未选择目录";
    const nextHtml = `
      <div class="vendor-card__header">
        <div class="vendor-card__title">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-database icon-server" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="8" ry="3"></ellipse>
            <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path>
            <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>
          </svg>
          <span class="vendor-name">API 配置存储</span>
        </div>
        <span class="ms-api-storage-card__badge">${isDirectory ? "本地目录" : "浏览器存储"}</span>
      </div>
      <div class="ms-api-storage-card__body">
        <div class="ms-api-storage-card__row">
          <span class="ms-api-storage-card__label">保存位置</span>
          <div class="settings-segmented" role="group" aria-label="API 配置保存位置">
            <button type="button" class="settings-segmented__btn${isDirectory ? "" : " is-active"}" data-ms-storage-action="mode-browser" aria-pressed="${isDirectory ? "false" : "true"}">浏览器存储</button>
            <button type="button" class="settings-segmented__btn${isDirectory ? " is-active" : ""}" data-ms-storage-action="mode-directory" aria-pressed="${isDirectory ? "true" : "false"}">本地目录</button>
          </div>
        </div>
        <p class="ms-api-storage-card__description">
          ${
            isDirectory
              ? "API 密钥、接口地址和模型勾选会同步写入所选目录中的 JSON 文件。"
              : "默认保存在当前浏览器的本地存储中，修改后会立即续存；更换浏览器或清理站点数据后不会自动保留。"
          }
        </p>
        ${
          isDirectory
            ? `
              <div class="ms-api-storage-card__directory">
                <div class="ms-api-storage-card__directory-main">
                  <span class="ms-api-storage-card__label">当前目录</span>
                  <strong class="ms-api-storage-card__directory-name">${escapeHtml(directoryName)}</strong>
                  <span class="ms-api-storage-card__directory-file">文件：${API_CONFIG_FILE_NAME}</span>
                </div>
                <span class="ms-api-storage-card__badge">JSON</span>
              </div>
              <div class="ms-api-storage-card__actions">
                <button type="button" class="path-picker__btn" data-ms-storage-action="choose-directory">${hasDirectory ? "更换目录" : "选择目录"}</button>
                <button type="button" class="path-picker__btn" data-ms-storage-action="save" ${hasDirectory ? "" : "disabled"}>立即保存</button>
                <button type="button" class="path-picker__btn" data-ms-storage-action="restore" ${hasDirectory ? "" : "disabled"}>从本地恢复</button>
              </div>
              <p class="ms-api-storage-card__hint">浏览器只显示目录名称，不会向网页暴露完整绝对路径；请确保该目录仅由你本人访问。</p>
              <p class="ms-api-storage-card__warning">本地文件是明文 JSON，会包含 API 密钥，请不要放到公开目录或同步到公共网盘。</p>
            `
            : `
              <p class="ms-api-storage-card__hint">切换为本地目录后，当前配置会在你选择的目录中保存一份可用于恢复的 JSON 副本；浏览器中的副本仍会保留。</p>
            `
        }
        <div class="ms-api-storage-card__status" role="status" aria-live="polite"></div>
      </div>
    `;
    if (card.innerHTML !== nextHtml) card.innerHTML = nextHtml;
    updateApiStorageStatusElement();
  }

  function ensureApiStorageCard() {
    installStyles();
    if (!apiStorageState) apiStorageState = readApiStorageState();
    const assetCard = findAssetStorageCard();
    const existing = document.getElementById(STORAGE_CARD_ID);
    if (!assetCard) {
      existing?.remove();
      return;
    }
    let card = existing;
    if (!card) {
      card = document.createElement("div");
      card.id = STORAGE_CARD_ID;
      card.className = "vendor-card ms-api-storage-card";
    }
    if (card.previousElementSibling !== assetCard) {
      assetCard.insertAdjacentElement("afterend", card);
    }
    renderApiStorageCard();
  }

  function ensureProfileStateForStorage() {
    if (profileState) return profileState;
    const stored = readStoredProfiles();
    if (!stored?.profiles?.length) return null;
    profileState = loadProfileState(findNativeVendorCard());
    saveProfileState();
    apiStorageRuntime.profileLoaded = true;
    return profileState;
  }

  function apiConfigFileContent() {
    const state = ensureProfileStateForStorage();
    if (!state) {
      throw new Error("尚未加载 API 配置，请先打开「API 来源设置」并填写一个配置。");
    }
    return JSON.stringify(
      {
        version: 1,
        kind: "manshiguang-api-config",
        savedAt: new Date().toISOString(),
        state,
      },
      null,
      2,
    );
  }

  async function writeApiConfigToDirectory(manual = false) {
    if (
      !apiStorageState ||
      apiStorageState.mode !== "directory" ||
      !apiStorageState.directoryToken
    ) {
      if (manual) {
        setApiStorageStatus("请先选择 API 配置的本地目录。", true);
      }
      return false;
    }
    if (!window.electronAPI?.saveApiConfigFile) {
      setApiStorageStatus("当前画布桥接不支持写入 API 配置文件，请刷新页面后重试。", true);
      return false;
    }
    if (apiStorageRuntime.writing) {
      apiStorageRuntime.pending = true;
      return false;
    }

    apiStorageRuntime.writing = true;
    if (manual) setApiStorageStatus("正在保存 API 配置到本地目录…", false, false);
    try {
      const content = apiConfigFileContent();
      const result = await window.electronAPI.saveApiConfigFile({
        targetDir: apiStorageState.directoryToken,
        fileName: API_CONFIG_FILE_NAME,
        content,
      });
      if (result?.directoryName && result.directoryName !== apiStorageState.directoryName) {
        apiStorageState.directoryName = result.directoryName;
        saveApiStorageState();
        renderApiStorageCard();
      }
      setApiStorageStatus(
        `已保存到「${result?.directoryName || apiStorageState.directoryName || "本地目录"}」/${result?.fileName || API_CONFIG_FILE_NAME}`,
      );
      return true;
    } catch (error) {
      setApiStorageStatus(
        `保存失败：${error?.message || String(error)}`,
        true,
      );
      return false;
    } finally {
      apiStorageRuntime.writing = false;
      if (apiStorageRuntime.pending) {
        apiStorageRuntime.pending = false;
        scheduleApiStorageWrite(260);
      }
    }
  }

  function scheduleApiStorageWrite(delay = 500) {
    if (
      !apiStorageRuntime.profileLoaded ||
      !apiStorageState ||
      apiStorageState.mode !== "directory" ||
      !apiStorageState.directoryToken
    ) {
      return;
    }
    window.clearTimeout(apiStorageRuntime.timer);
    apiStorageRuntime.timer = window.setTimeout(() => {
      apiStorageRuntime.timer = null;
      void writeApiConfigToDirectory(false);
    }, delay);
  }

  async function chooseApiConfigDirectory() {
    if (!window.electronAPI?.pickApiConfigDirectory) {
      setApiStorageStatus("当前浏览器桥接不支持选择本地目录，请刷新页面后重试。", true);
      return;
    }
    setApiStorageStatus("请在系统窗口中选择用于保存 API 配置的目录…", false, false);
    try {
      const result = await window.electronAPI.pickApiConfigDirectory();
      if (!result?.token) {
        setApiStorageStatus("已取消选择目录。");
        return;
      }
      apiStorageState.mode = "directory";
      apiStorageState.directoryToken = result.token;
      apiStorageState.directoryName = result.name || "本地目录";
      saveApiStorageState();
      renderApiStorageCard();
      await writeApiConfigToDirectory(true);
    } catch (error) {
      setApiStorageStatus(
        `选择目录失败：${error?.message || String(error)}`,
        true,
      );
    }
  }

  async function restoreApiConfigFromDirectory() {
    if (
      !apiStorageState?.directoryToken ||
      !window.electronAPI?.readApiConfigFile
    ) {
      setApiStorageStatus("请先选择 API 配置的本地目录。", true);
      return;
    }
    setApiStorageStatus("正在读取本地 API 配置…", false, false);
    try {
      const result = await window.electronAPI.readApiConfigFile({
        targetDir: apiStorageState.directoryToken,
        fileName: API_CONFIG_FILE_NAME,
      });
      if (!result?.content?.trim()) {
        throw new Error("配置文件为空");
      }
      if (result.content.length > 5 * 1024 * 1024) {
        throw new Error("配置文件超过 5 MB，已拒绝读取");
      }
      const parsed = JSON.parse(result.content);
      const restored = normalizeProfileState(
        parsed?.state || parsed,
        findNativeVendorCard(),
      );
      profileState = restored;
      apiStorageRuntime.profileLoaded = true;
      saveProfileState({ skipStorage: true });
      syncActiveToCanvas();
      renderManager(true);
      setApiStorageStatus(
        `已从「${result.directoryName || apiStorageState.directoryName || "本地目录"}」恢复 ${restored.profiles.length} 个 API 配置。`,
      );
    } catch (error) {
      setApiStorageStatus(
        `恢复失败：${error?.message || String(error)}`,
        true,
      );
    }
  }

  async function handleStorageAction(action) {
    if (!apiStorageState) apiStorageState = readApiStorageState();
    if (action === "mode-browser") {
      apiStorageState.mode = "browser";
      saveApiStorageState();
      window.clearTimeout(apiStorageRuntime.timer);
      apiStorageRuntime.timer = null;
      renderApiStorageCard();
      setApiStorageStatus("已切换为浏览器存储。");
      return;
    }
    if (action === "mode-directory") {
      apiStorageState.mode = "directory";
      saveApiStorageState();
      renderApiStorageCard();
      if (!apiStorageState.directoryToken) {
        setApiStorageStatus("请选择本地目录，确认后会自动保存当前 API 配置。", false, false);
      } else {
        await writeApiConfigToDirectory(true);
      }
      return;
    }
    if (action === "choose-directory") {
      await chooseApiConfigDirectory();
      return;
    }
    if (action === "save") {
      await writeApiConfigToDirectory(true);
      return;
    }
    if (action === "restore") {
      await restoreApiConfigFromDirectory();
    }
  }

  function renderModelSection(profile) {
    if (profile.builtin) return "";
    const loading = modelRuntime.loading.has(profile.id);
    const models = profile.modelCatalog;
    const selected = new Set(profile.selectedModels);
    const sourceChanged = Boolean(
      profile.modelsBaseUrl &&
      normalizeBaseUrl(profile.baseUrl) !== profile.modelsBaseUrl,
    );
    const rows = models.map((model) => {
      const image = isImageModel(model);
      return `
        <label class="ms-api-model" title="${escapeHtml(model)}">
          <input type="checkbox" data-ms-model="${escapeHtml(model)}" ${selected.has(model) ? "checked" : ""} />
          <span class="ms-api-model__name">${escapeHtml(model)}</span>
          <span class="ms-api-model__tag${image ? " is-image" : ""}">${image ? "图片" : "其他"}</span>
        </label>
      `;
    }).join("");
    const fetchedAt = profile.modelsFetchedAt
      ? new Date(profile.modelsFetchedAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return `
      <div class="ms-api-models__toolbar">
        <div class="ms-api-models__heading">
          <span class="ms-api-models__title">模型列表</span>
          <span class="ms-api-models__count">已选择 ${selected.size} 个 / 共 ${models.length} 个</span>
          ${fetchedAt ? `<span class="ms-api-models__time">最近拉取 ${escapeHtml(fetchedAt)}</span>` : ""}
        </div>
        <div class="ms-api-models__actions">
          <button type="button" class="ms-api-models__button ms-api-models__button--primary" data-ms-action="models-refresh" ${loading ? "disabled" : ""}>${loading ? "拉取中…" : "拉取全部模型"}</button>
          <button type="button" class="ms-api-models__button" data-ms-action="models-images" ${models.length && !loading ? "" : "disabled"}>全选图片</button>
          <button type="button" class="ms-api-models__button" data-ms-action="models-clear" ${selected.size ? "" : "disabled"}>清空</button>
        </div>
      </div>
      ${sourceChanged ? '<div class="ms-api-models__note is-warning">接口地址已变更，请重新拉取该地址的模型。</div>' : ""}
      ${profile.modelsError ? `<div class="ms-api-models__note is-error">拉取失败：${escapeHtml(profile.modelsError)}</div>` : ""}
      ${models.length
        ? `<div class="ms-api-models__list">${rows}</div>`
        : `<div class="ms-api-models__empty">${loading ? "正在从平台拉取模型列表…" : "填写 API Key 与 Base URL 后会自动拉取；也可以点击「拉取全部模型」。"}</div>`}
    `;
  }

  function modelSectionFor(profileId) {
    const card = [...document.querySelectorAll("#" + ROOT_ID + " [data-profile-id]")]
      .find((item) => item.dataset.profileId === profileId);
    return card?.querySelector("[data-ms-model-section]") || null;
  }

  function captureModelScroll(target) {
    const section = target?.closest?.("[data-ms-model-section]");
    const card = section?.closest("[data-profile-id]");
    if (!section || !card) return null;
    return {
      profileId: card.dataset.profileId,
      listTop: section.querySelector(".ms-api-models__list")?.scrollTop || 0,
      modalTop:
        section.closest(".settings-modal__body")?.scrollTop ?? null,
    };
  }

  function restoreModelScroll(snapshot) {
    if (!snapshot) return;
    const modal = document.querySelector(".settings-modal__body");
    if (modal && snapshot.modalTop != null) modal.scrollTop = snapshot.modalTop;
    const list = modelSectionFor(snapshot.profileId)?.querySelector(
      ".ms-api-models__list",
    );
    if (list) list.scrollTop = snapshot.listTop;
  }

  function rememberModelScroll(event) {
    const checkbox =
      event.target?.closest?.("[data-ms-model]") ||
      event.target?.closest?.(".ms-api-model")?.querySelector("[data-ms-model]");
    if (!checkbox) return;
    modelScrollRuntime.pending = captureModelScroll(checkbox);
    checkbox.focus({ preventScroll: true });
  }

  function settleModelScroll(target) {
    if (!modelScrollRuntime.pending) {
      modelScrollRuntime.pending = captureModelScroll(target);
    }
    const snapshot = modelScrollRuntime.pending;
    if (!snapshot) return;
    const sequence = ++modelScrollRuntime.sequence;
    const apply = () => {
      if (sequence === modelScrollRuntime.sequence) restoreModelScroll(snapshot);
    };
    queueMicrotask(apply);
    window.requestAnimationFrame(() => {
      apply();
      window.requestAnimationFrame(apply);
    });
    [50, 180, 360].forEach((delay) => window.setTimeout(apply, delay));
    window.setTimeout(() => {
      if (sequence === modelScrollRuntime.sequence) {
        modelScrollRuntime.pending = null;
      }
    }, 430);
  }

  function refreshModelSection(profileId) {
    const profile = profileState?.profiles.find((item) => item.id === profileId);
    if (!profile || profile.builtin) return;
    const section = modelSectionFor(profileId);
    if (!section) return;
    const snapshot = captureModelScroll(section);
    section.innerHTML = renderModelSection(profile);
    restoreModelScroll(snapshot);
  }

  function syncModelSelectionUi(profileId) {
    const profile = profileState?.profiles.find((item) => item.id === profileId);
    if (!profile || profile.builtin) return;
    const section = modelSectionFor(profileId);
    if (!section) return;
    const selected = new Set(profile.selectedModels);
    section.querySelectorAll("[data-ms-model]").forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.dataset.msModel);
    });
    const count = section.querySelector(".ms-api-models__count");
    if (count) {
      count.textContent = `已选择 ${selected.size} 个 / 共 ${profile.modelCatalog.length} 个`;
    }
    const clearButton = section.querySelector('[data-ms-action="models-clear"]');
    if (clearButton) clearButton.disabled = selected.size === 0;
  }

  function extractModelIds(payload) {
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
    return uniqueStringList(
      raw.map((item) =>
        typeof item === "string"
          ? item
          : item?.id || item?.name || item?.model || "",
      ),
    );
  }

  async function fetchModelCatalog(profile, force = false, manual = false) {
    const base = normalizeBaseUrl(profile.baseUrl);
    if (!base) {
      if (manual) showStatus("请先填写 Base URL，再拉取模型。", true);
      return;
    }
    if (modelRuntime.loading.has(profile.id)) return;
    if (!force && profile.modelsFetchedAt && profile.modelsBaseUrl === base) return;
    modelRuntime.loading.add(profile.id);
    profile.modelsError = "";
    saveProfileState();
    refreshModelSection(profile.id);

    try {
      const headers = { Accept: "application/json" };
      if (profile.apiKey.trim()) {
        headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
      }
      const candidates = [`${base}/v1/models`, `${base}/models`];
      let models = [];
      let lastStatus = 0;
      for (let index = 0; index < candidates.length; index += 1) {
        const response = await fetch(candidates[index], { headers });
        lastStatus = response.status;
        if (!response.ok) {
          if (response.status === 404 && index < candidates.length - 1) continue;
          throw new Error(`HTTP ${response.status} ${response.statusText || ""}`.trim());
        }
        models = extractModelIds(await response.json());
        if (!models.length) throw new Error("平台返回的模型列表为空");
        break;
      }
      if (!models.length) throw new Error(`未找到模型接口（HTTP ${lastStatus || "未知"}）`);

      const sourceChanged = profile.modelsBaseUrl !== base;
      const previous = new Set(profile.selectedModels);
      const retained = models.filter((model) => previous.has(model));
      profile.modelCatalog = models;
      profile.selectedModels =
        !profile.modelsFetchedAt || sourceChanged
          ? models.filter(isImageModel)
          : retained;
      profile.modelsFetchedAt = Date.now();
      profile.modelsBaseUrl = base;
      profile.modelsError = "";
      saveProfileState();
      refreshModelSection(profile.id);
      if (manual) {
        showStatus(`已拉取 ${models.length} 个模型，并默认勾选其中 ${profile.selectedModels.length} 个图片模型。`);
      }
    } catch (error) {
      profile.modelsError = error?.message || String(error);
      saveProfileState();
      refreshModelSection(profile.id);
      if (manual) showStatus(`拉取模型失败：${profile.modelsError}`, true);
    } finally {
      modelRuntime.loading.delete(profile.id);
      refreshModelSection(profile.id);
    }
  }

  function scheduleAutoFetch(profile, delay = MODEL_FETCH_DEBOUNCE_MS) {
    if (!profile || profile.builtin) return;
    const base = normalizeBaseUrl(profile.baseUrl);
    if (!base) return;
    if (profile.modelsFetchedAt && profile.modelsBaseUrl === base) return;
    const previousTimer = modelRuntime.timers.get(profile.id);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      modelRuntime.timers.delete(profile.id);
      const current = profileState?.profiles.find((item) => item.id === profile.id);
      if (!current) return;
      const currentBase = normalizeBaseUrl(current.baseUrl);
      if (!currentBase || (current.modelsFetchedAt && current.modelsBaseUrl === currentBase)) return;
      const signature = `${currentBase}\n${current.apiKey}`;
      if (modelRuntime.attempted.get(current.id) === signature) return;
      modelRuntime.attempted.set(current.id, signature);
      fetchModelCatalog(current, false, false);
    }, delay);
    modelRuntime.timers.set(profile.id, timer);
  }

  function renderProfileCard(profile, isActive) {
    const badge = profile.builtin ? "内置兼容" : "第三方";
    const canApply = Boolean(profile.applyUrl.trim());
    const defaultBaseUrl = profile.builtin ? DEFAULT_BASE_URL : "";
    return `
      <article class="ms-api-card${isActive ? " is-active" : ""}" data-profile-id="${escapeHtml(profile.id)}">
        <div class="ms-api-card__header">
          <div class="ms-api-card__identity">
            <span class="ms-api-card__icon" aria-hidden="true">☁</span>
            <span class="ms-api-card__name">${escapeHtml(profile.name)}</span>
            <span class="ms-api-card__badge">${badge}</span>
          </div>
          <div class="ms-api-card__actions">
            <button
              type="button"
              class="ms-api-card__button ms-api-card__button--apply"
              data-ms-action="apply"
              title="${canApply ? "打开申请地址" : "请先填写申请地址"}"
              ${canApply ? "" : "disabled"}
            >申请</button>
            <button
              type="button"
              class="ms-api-card__button ms-api-card__button--enable${isActive ? " is-active" : ""}"
              data-ms-action="enable"
              ${isActive ? "disabled" : ""}
            >${isActive ? "已启用" : "启用"}</button>
          </div>
        </div>
        <div class="ms-api-card__form">
          <label class="ms-api-card__field">
            <span class="ms-api-card__label">配置名称</span>
            <input class="ms-api-card__input" data-ms-field="name" value="${escapeHtml(profile.name)}" placeholder="例如：第三方 API A" />
          </label>
          <label class="ms-api-card__field">
            <span class="ms-api-card__label">申请地址（可选）</span>
            <input class="ms-api-card__input" data-ms-field="applyUrl" value="${escapeHtml(profile.applyUrl)}" placeholder="https://example.com/register" />
          </label>
          <div class="ms-api-card__field">
            <label class="ms-api-card__label" for="ms-api-key-${escapeHtml(profile.id)}">API 密钥</label>
            <span class="ms-api-card__secret">
              <input
                id="ms-api-key-${escapeHtml(profile.id)}"
                class="ms-api-card__input"
                data-ms-field="apiKey"
                type="password"
                autocomplete="off"
                value="${escapeHtml(profile.apiKey)}"
                placeholder="sk-..."
              />
              <button
                type="button"
                class="ms-api-card__secret-toggle"
                data-ms-action="toggle-secret"
                aria-label="显示 API 密钥"
                aria-pressed="false"
                title="显示 API 密钥"
              >
                <svg class="ms-api-card__secret-icon ms-api-card__secret-icon--show" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.43-6 9.5-6 9.5 6 9.5 6-3.43 6-9.5 6-9.5-6-9.5-6Z"></path>
                  <circle cx="12" cy="12" r="2.75"></circle>
                </svg>
                <svg class="ms-api-card__secret-icon ms-api-card__secret-icon--hide" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 3l18 18"></path>
                  <path d="M10.6 6.2A10.9 10.9 0 0 1 12 6c6.07 0 9.5 6 9.5 6a17.8 17.8 0 0 1-3.1 3.8"></path>
                  <path d="M6.2 6.2C3.9 7.8 2.5 12 2.5 12s3.43 6 9.5 6c1.3 0 2.5-.28 3.55-.72"></path>
                  <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
                </svg>
              </button>
            </span>
          </div>
          <label class="ms-api-card__field">
            <span class="ms-api-card__label">接口地址（Base URL）</span>
            <input class="ms-api-card__input" data-ms-field="baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="${escapeHtml(defaultBaseUrl || "https://example.com/v1")}" />
          </label>
          <div class="ms-api-card__hint ms-api-card__field--wide">
            ${
              profile.builtin
                ? `留空时使用云雾默认地址：${escapeHtml(DEFAULT_BASE_URL)}`
                : "第三方服务需兼容云雾 / OpenAI 风格接口；画布的模型请求会发往当前启用的 Base URL。"
            }
          </div>
          ${
            profile.builtin
              ? ""
              : '<button type="button" class="ms-api-card__remove" data-ms-action="remove">删除此配置</button>'
          }
        </div>
        ${
          profile.builtin
            ? ""
            : `<section class="ms-api-card__models" data-ms-model-section>${renderModelSection(profile)}</section>`
        }
      </article>
    `;
  }

  function renderManager(force = false) {
    renderQueued = false;
    installStyles();
    const nativeCard = findNativeVendorCard();
    if (!nativeCard) {
      document.getElementById(ROOT_ID)?.remove();
      return;
    }
    if (!profileState) {
      profileState = loadProfileState(nativeCard);
      saveProfileState();
      syncActiveToCanvas();
      apiStorageRuntime.profileLoaded = true;
    }

    nativeCard.classList.add("ms-api-native-card");
    const list = nativeCard.parentElement;
    let root = document.getElementById(ROOT_ID);
    if (!root || root.parentElement !== list) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.className = "ms-api-manager";
      list.insertBefore(root, nativeCard);
    }

    const active = activeProfile();
    const nextHtml = `
      <div class="ms-api-manager__toolbar">
        <div class="ms-api-manager__status">
          <span class="ms-api-manager__dot"></span>
          <span>当前启用：${escapeHtml(active?.name || "未配置")}</span>
        </div>
        <button type="button" class="ms-api-manager__add" data-ms-action="add">＋ 新增第三方 API</button>
      </div>
      <div class="ms-api-manager__message" role="status" aria-live="polite"></div>
      ${profileState.profiles
        .map((profile) =>
          renderProfileCard(profile, profile.id === profileState.activeId),
        )
        .join("")}
      <p class="ms-api-manager__footnote">
        同一时间只会启用一个配置。API Key 仅保存在当前浏览器的本地存储中；切换配置后，后续请求会立即使用新的 Key 与 Base URL。
      </p>
    `;
    if (force || root.innerHTML !== nextHtml) root.innerHTML = nextHtml;
    updateSectionCopy(root);
    profileState.profiles.forEach((profile) => scheduleAutoFetch(profile, 250));
  }

  function updateSectionCopy(root) {
    const description = root
      ?.closest(".settings-section")
      ?.querySelector(".settings-section__header p");
    if (!description) return;
    const copy = "管理云雾与第三方 API 配置。启用一个配置后，画布请求会自动使用它的 API Key 和 Base URL；第三方模型可拉取、勾选后显示在画布中。";
    if (description.textContent !== copy) description.textContent = copy;
  }

  function ensureManagerMounted() {
    renderQueued = false;
    installStyles();
    const nativeCard = findNativeVendorCard();
    const root = document.getElementById(ROOT_ID);
    if (!nativeCard) {
      root?.remove();
      return;
    }
    nativeCard.classList.add("ms-api-native-card");
    if (root && root.parentElement === nativeCard.parentElement) {
      updateSectionCopy(root);
      return;
    }
    renderManager(true);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      ensureApiStorageCard();
      ensureManagerMounted();
    });
  }

  function profileCardFor(target) {
    const card = target.closest("[data-profile-id]");
    if (!card) return null;
    const id = card.dataset.profileId;
    const profile = profileState.profiles.find((item) => item.id === id);
    return profile ? { card, profile } : null;
  }

  async function openApplyUrl(url) {
    if (!url) {
      showStatus("请先填写申请地址。", true);
      return;
    }
    try {
      if (window.electronAPI?.openExternalUrl) {
        await window.electronAPI.openExternalUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      showStatus("申请页面未能打开，请检查地址或浏览器弹窗权限。", true);
    }
  }

  function handleClick(event) {
    const storageButton = event.target.closest("[data-ms-storage-action]");
    if (storageButton) {
      void handleStorageAction(storageButton.dataset.msStorageAction);
      return;
    }
    const actionButton = event.target.closest("[data-ms-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.msAction;
    const found = profileCardFor(actionButton);

    if (action === "add") {
      const index = profileState.profiles.filter((profile) => !profile.builtin).length + 1;
      const profile = {
        id: createId(),
        name: `第三方 API ${index}`,
        apiKey: "",
        baseUrl: "",
        applyUrl: "",
        builtin: false,
        modelCatalog: [],
        selectedModels: [],
        modelsFetchedAt: 0,
        modelsError: "",
        modelsBaseUrl: "",
      };
      profileState.profiles.push(profile);
      saveProfileState();
      renderManager(true);
      showStatus(`已添加「${profile.name}」，填写后点击启用即可使用。`);
      return;
    }

    if (!found) return;
    const { profile } = found;

    if (action === "toggle-secret") {
      const input = actionButton
        .closest(".ms-api-card__field")
        ?.querySelector('[data-ms-field="apiKey"]');
      if (!input) return;
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      actionButton.setAttribute("aria-pressed", String(visible));
      const label = visible ? "隐藏 API 密钥" : "显示 API 密钥";
      actionButton.setAttribute("aria-label", label);
      actionButton.title = label;
      return;
    }

    if (action === "models-refresh") {
      fetchModelCatalog(profile, true, true);
      return;
    }

    if (action === "models-images") {
      modelScrollRuntime.pending = captureModelScroll(actionButton);
      profile.selectedModels = profile.modelCatalog.filter(isImageModel);
      saveProfileState();
      syncModelSelectionUi(profile.id);
      settleModelScroll(actionButton);
      showStatus(`已选择 ${profile.selectedModels.length} 个图片模型。`);
      return;
    }

    if (action === "models-clear") {
      modelScrollRuntime.pending = captureModelScroll(actionButton);
      profile.selectedModels = [];
      saveProfileState();
      syncModelSelectionUi(profile.id);
      settleModelScroll(actionButton);
      showStatus("已清空模型勾选，画布将不再显示该第三方配置的模型。");
      return;
    }

    if (action === "enable") {
      if (profileState.activeId === profile.id) return;
      profileState.activeId = profile.id;
      saveProfileState();
      syncActiveToCanvas();
      renderManager(true);
      showStatus(`已启用「${profile.name}」。`);
      return;
    }

    if (action === "apply") {
      openApplyUrl(profile.applyUrl.trim());
      return;
    }

    if (action === "remove" && !profile.builtin) {
      if (!window.confirm(`确认删除「${profile.name}」？`)) return;
      profileState.profiles = profileState.profiles.filter(
        (item) => item.id !== profile.id,
      );
      if (profileState.activeId === profile.id) {
        profileState.activeId = BUILTIN_ID;
        syncActiveToCanvas();
      }
      saveProfileState();
      renderManager(true);
      showStatus(`已删除「${profile.name}」。`);
    }
  }

  function handleInput(event) {
    const field = event.target.closest("[data-ms-field]");
    if (!field) return;
    const found = profileCardFor(field);
    if (!found) return;
    const key = field.dataset.msField;
    if (!["name", "apiKey", "baseUrl", "applyUrl"].includes(key)) return;
    found.profile[key] = field.value;
    if (key === "name") {
      const nameElement = found.card.querySelector(".ms-api-card__name");
      if (nameElement) nameElement.textContent = field.value || "未命名 API";
      const statusElement = document.querySelector(
        `#${ROOT_ID} .ms-api-manager__status span:last-child`,
      );
      if (statusElement && profileState.activeId === found.profile.id) {
        statusElement.textContent = `当前启用：${field.value || "未命名 API"}`;
      }
    }
    if (key === "apiKey" || key === "baseUrl") {
      if (profileState.activeId === found.profile.id) syncActiveToCanvas();
    }
    if (key === "applyUrl") {
      const applyButton = found.card.querySelector('[data-ms-action="apply"]');
      if (applyButton) {
        applyButton.disabled = !field.value.trim();
        applyButton.title = field.value.trim()
          ? "打开申请地址"
          : "请先填写申请地址";
      }
    }
    saveProfileState();
    if (key === "apiKey" || key === "baseUrl") {
      scheduleAutoFetch(found.profile);
    }
  }

  function handleChange(event) {
    const checkbox = event.target.closest("[data-ms-model]");
    if (!checkbox) return;
    const found = profileCardFor(checkbox);
    if (!found) return;
    const selected = new Set(found.profile.selectedModels);
    if (checkbox.checked) selected.add(checkbox.dataset.msModel);
    else selected.delete(checkbox.dataset.msModel);
    found.profile.selectedModels = found.profile.modelCatalog.filter((model) =>
      selected.has(model),
    );
    saveProfileState();
    syncModelSelectionUi(found.profile.id);
    settleModelScroll(checkbox);
  }

  function init() {
    installStyles();
    const root = document.getElementById("root") || document.documentElement;
    root.addEventListener("click", handleClick);
    root.addEventListener("input", handleInput);
    root.addEventListener("change", handleChange);
    root.addEventListener("pointerdown", rememberModelScroll, true);
    new MutationObserver(queueRender).observe(root, {
      childList: true,
      subtree: true,
    });
    queueRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
