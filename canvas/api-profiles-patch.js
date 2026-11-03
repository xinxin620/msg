(() => {
  "use strict";

  const PROFILES_KEY = "manshiguang:canvas-api-profiles";
  const CANVAS_SETTINGS_KEY = "canvas-api-settings";
  const STYLE_ID = "ms-api-profiles-style";
  const ROOT_ID = "ms-api-profiles";
  const BUILTIN_ID = "yunwu";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const BUILTIN_APPLY_URL = "https://api.openlux.ai/register?aff=MYE2";

  let profileState = null;
  let renderQueued = false;

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

  function loadProfileState(nativeCard) {
    const stored = readStoredProfiles();
    const profiles = Array.isArray(stored?.profiles)
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

  function saveProfileState() {
    if (!profileState) return;
    try {
      window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profileState));
    } catch {
      showStatus("配置已更新，但浏览器未能写入本地存储。", true);
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
          baseUrlOverride: profile.baseUrl,
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
      .ms-api-card__remove {
        align-self: flex-start;
        padding: 0;
        border: 0;
        background: transparent;
        color: #b42318;
        font-size: 11px;
        cursor: pointer;
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
          <label class="ms-api-card__field">
            <span class="ms-api-card__label">API 密钥</span>
            <input class="ms-api-card__input" data-ms-field="apiKey" type="password" autocomplete="off" value="${escapeHtml(profile.apiKey)}" placeholder="sk-..." />
          </label>
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
  }

  function updateSectionCopy(root) {
    const description = root
      ?.closest(".settings-section")
      ?.querySelector(".settings-section__header p");
    if (!description) return;
    const copy = "管理云雾与第三方 API 配置。启用一个配置后，画布请求会自动使用它的 API Key 和 Base URL。";
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
    window.requestAnimationFrame(ensureManagerMounted);
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
      };
      profileState.profiles.push(profile);
      saveProfileState();
      renderManager(true);
      showStatus(`已添加「${profile.name}」，填写后点击启用即可使用。`);
      return;
    }

    if (!found) return;
    const { profile } = found;

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
  }

  function init() {
    installStyles();
    const root = document.getElementById("root") || document.documentElement;
    root.addEventListener("click", handleClick);
    root.addEventListener("input", handleInput);
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
