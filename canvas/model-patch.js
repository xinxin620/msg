(() => {
  "use strict";

  const PROFILES_KEY = "manshiguang:canvas-api-profiles";
  const SETTINGS_KEY = "canvas-api-settings";
  const CHOICE_KEY = "manshiguang:canvas-model-choice";
  const STYLE_ID = "ms-model-patch-style";
  const VENDOR_ID = "yunwu";
  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS = 6 * 60 * 1000;


  const state = {
    choice: {},
    lastPicked: "",
    renderQueued: false,
  };

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be unavailable in private mode */
    }
  }

  function normalizeBase(raw) {
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

  function activeProfile() {
    const stored = readJson(PROFILES_KEY, null);
    const profiles = Array.isArray(stored?.profiles) ? stored.profiles : [];
    return profiles.find((profile) => profile.id === stored?.activeId) || null;
  }

  function activeBase() {
    const profile = activeProfile();
    if (!profile) return "";
    if (profile.builtin) return normalizeBase(profile.baseUrl || "") || "https://api.openlux.ai";
    return normalizeBase(profile.baseUrl || "");
  }

  function isRemotePlatform(base) {
    return Boolean(base) && !/openlux\.ai/i.test(base);
  }

  function selectedModelsForActiveProfile() {
    const profile = activeProfile();
    if (!profile || profile.builtin) return [];
    const selected = Array.isArray(profile.selectedModels)
      ? profile.selectedModels
      : [];
    const catalog = Array.isArray(profile.modelCatalog)
      ? new Set(profile.modelCatalog)
      : null;
    const seen = new Set();
    return selected
      .map((model) => String(model || "").trim())
      .filter((model) => {
        if (!model || seen.has(model)) return false;
        if (catalog && !catalog.has(model)) return false;
        seen.add(model);
        return true;
      });
  }

  function clearStaleChoices(models) {
    const allowed = new Set(models);
    let changed = false;
    for (const family of ["banana", "gpt"]) {
      if (state.choice[family] && !allowed.has(state.choice[family])) {
        delete state.choice[family];
        changed = true;
      }
    }
    if (state.lastPicked && !allowed.has(state.lastPicked)) {
      state.lastPicked = "";
      changed = true;
    }
    if (changed) writeJson(CHOICE_KEY, state.choice);
  }

  function apiKeyFor(base) {
    const profile = activeProfile();
    if (profile && normalizeBase(profile.baseUrl || "") === base && profile.apiKey) {
      return profile.apiKey;
    }
    const settings = readJson(SETTINGS_KEY, null);
    return settings?.state?.vendorConfigs?.[VENDOR_ID]?.apiKey || "";
  }

  /* Keep the bundle's own vendor config pointing at the normalized Base URL,
     so requests never end up as ".../v1/draw/completions/v1/images/...". */
  function persistNormalizedBase() {
    const profile = activeProfile();
    if (!profile) return;
    const base = normalizeBase(profile.baseUrl || "");
    if (!base) return;
    const settings = readJson(SETTINGS_KEY, null);
    if (!settings || typeof settings !== "object") return;
    const current = settings.state?.vendorConfigs?.[VENDOR_ID] || {};
    if (current.baseUrlOverride === base && current.enabled === true) return;
    settings.state = settings.state || {};
    settings.state.vendorConfigs = {
      ...(settings.state.vendorConfigs || {}),
      [VENDOR_ID]: { ...current, enabled: true, baseUrlOverride: base },
    };
    writeJson(SETTINGS_KEY, settings);
  }


  function familyOf(model) {
    return /gpt-image/i.test(model) ? "gpt" : "banana";
  }

  function ratioFromSize(size) {
    const match = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
    if (!match) return "auto";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "auto";
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  function qualityFromSize(size) {
    const match = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
    if (!match) return "medium";
    const max = Math.max(Number(match[1]), Number(match[2]));
    return max >= 1536 ? "high" : "medium";
  }

  function extractUrls(payload) {
    const urls = [];
    const push = (value) => {
      if (typeof value === "string" && value.trim()) urls.push(value.trim());
      else if (value && typeof value === "object") {
        const url = value.url || value.image_url || value.file_url;
        if (typeof url === "string" && url.trim()) urls.push(url.trim());
      }
    };
    const data = payload?.data ?? payload;
    if (Array.isArray(data)) data.forEach(push);
    else if (data && typeof data === "object") {
      push(data);
      ["url", "image_url", "file_url"].forEach((key) => push?.(data?.[key]));
      if (Array.isArray(data.urls)) data.urls.forEach(push);
      if (Array.isArray(data.images)) data.images.forEach(push);
      if (Array.isArray(data.results)) data.results.forEach(push);
    }
    return [...new Set(urls)];
  }

  function taskIdOf(payload) {
    const data = payload?.data ?? payload;
    if (typeof data?.id === "string") return data.id;
    if (typeof payload?.id === "string") return payload.id;
    return "";
  }

  async function readRequestBody(body) {
    if (typeof body === "string") {
      try {
        return { kind: "json", value: JSON.parse(body) };
      } catch {
        return { kind: "text", value: body };
      }
    }
    if (body instanceof FormData) {
      const fields = {};
      const files = [];
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") fields[key] = value;
        else if (value instanceof Blob) files.push(value);
      }
      return { kind: "form", fields, files };
    }
    return { kind: "other", value: body };
  }

  async function blobToDataUrl(blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  }

  function withTimeout(promise, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promise(controller.signal).finally(() => clearTimeout(timer));
  }

  async function submitGrsai({ base, apiKey, model, prompt, aspectRatio, quality, urls }) {
    const family = familyOf(model);
    const endpoint = family === "banana" ? "/v1/draw/nano-banana" : "/v1/draw/completions";
    const body = {
      model,
      prompt: prompt || " ",
      aspectRatio: aspectRatio || "auto",
      quality,
      webHook: "-1",
      shutProgress: true,
    };
    if (urls && urls.length) body.urls = urls;

    const response = await withTimeout(
      (signal) =>
        fetch(`${base}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        }),
      90 * 1000,
    );
    if (!response.ok) throw new Error(`Grsai HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.error) throw new Error(payload.error.message || String(payload.error));
    if (typeof payload?.code === "number" && payload.code !== 0) {
      throw new Error(payload.msg || `Grsai code ${payload.code}`);
    }
    let result = payload?.data ?? payload;
    let found = extractUrls(result);
    if (found.length) return found;
    const taskId = taskIdOf(payload);
    if (!taskId) throw new Error("Grsai 未返回图片地址或任务 ID");

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const poll = await fetch(`${base}/v1/draw/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ id: taskId }),
      });
      if (!poll.ok) throw new Error(`Grsai 轮询 HTTP ${poll.status}`);
      const pollPayload = await poll.json();
      if (typeof pollPayload?.code === "number" && pollPayload.code !== 0) {
        throw new Error(pollPayload.msg || `Grsai 轮询 code ${pollPayload.code}`);
      }
      result = pollPayload?.data ?? pollPayload;
      if (result?.error) throw new Error(result.error.message || String(result.error));
      found = extractUrls(result);
      if (found.length) return found;
      const status = typeof result?.status === "string" ? result.status.toLowerCase() : "";
      if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
        throw new Error(result?.fail_reason || result?.errorMessage || "Grsai 生成失败");
      }
    }
    throw new Error("Grsai 生成超时");
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function isDrawTarget(url) {
    return /\/v1\/images\/(generations|edits)\/?$/i.test(String(url || "").split("?")[0]);
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const base = activeBase();
    if (!isDrawTarget(url) || !isRemotePlatform(base) || !/grsai/i.test(base)) {
      return originalFetch(input, init);
    }
    try {
      const parsed = await readRequestBody(init?.body);
      const fields = parsed.kind === "json" ? parsed.value : parsed.kind === "form" ? parsed.fields : {};
      const requestedModel = String(fields?.model || "");
      const family = familyOf(requestedModel);
      const selectedModels = selectedModelsForActiveProfile();
      if (!selectedModels.length) {
        throw new Error("当前第三方 API 配置未勾选模型，请先到「API 来源设置」拉取并勾选。");
      }
      const familyChoice = state.choice[family];
      const chosen = selectedModels.includes(familyChoice)
        ? familyChoice
        : selectedModels.find((model) => familyOf(model) === family) || selectedModels[0];
      if (!chosen) {
        throw new Error("当前第三方 API 配置没有可用模型。");
      }
      const urls =
        parsed.kind === "form" && parsed.files?.length
          ? await Promise.all(parsed.files.map((file) => blobToDataUrl(file)))
          : [];
      const apiKey = apiKeyFor(base);
      const found = await submitGrsai({
        base,
        apiKey,
        model: chosen,
        prompt: fields?.prompt,
        aspectRatio: ratioFromSize(fields?.size),
        quality: qualityFromSize(fields?.size),
        urls,
      });
      return jsonResponse({ created: Math.floor(Date.now() / 1000), data: found.map((item) => ({ url: item })) });
    } catch (error) {
      return jsonResponse({ error: { message: error?.message || String(error) } }, 400);
    }
  };

  /* ---------- dropdown injection ---------- */

  function loadChoice() {
    const stored = readJson(CHOICE_KEY, null);
    state.choice = stored && typeof stored === "object" ? stored : {};
  }

  function modelSelectOf(dropdown) {
    const panel = dropdown.closest(".action-panel");
    if (!panel || !panel.classList.contains("action-panel--image")) return null;
    const select = dropdown.parentElement;
    if (!select || !select.classList.contains("action-panel__model-select")) return null;
    const left = select.closest(".action-panel__left");
    if (!left) return null;
    return left.querySelector(".action-panel__model-select") === select ? select : null;
  }

  function nativeItems(dropdown) {
    return [...dropdown.children].filter(
      (node) => node.tagName === "BUTTON" && node.classList.contains("action-panel__dropdown-item"),
    );
  }

  function labelOf(button) {
    return button.querySelector(".action-panel__model-info .name")?.textContent?.trim() || button.textContent?.trim() || "";
  }

  function presetOfFamily(items, family) {
    if (family === "gpt") {
      return items.find((item) => /^gpt/i.test(labelOf(item))) || items[items.length - 1];
    }
    return items.find((item) => /香蕉\s*pro|nano-banana-pro/i.test(labelOf(item))) || items[0];
  }

  function buildList(dropdown, base) {
    const models = selectedModelsForActiveProfile();
    const wrap = document.createElement("div");
    wrap.className = "ms-model-list";
    wrap.setAttribute("data-ms-model-list", "1");

    const header = document.createElement("div");
    header.className = "ms-model-list__header";
    let host = base;
    try { host = new URL(base).host; } catch { /* keep base */ }
    header.textContent = `已选模型 · ${host}`;
    wrap.appendChild(header);

    const items = nativeItems(dropdown);
    for (const model of models) {
      const family = familyOf(model);
      const isActive = state.choice[family] === model;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `action-panel__dropdown-item ms-model-item${isActive ? " active" : ""}`;
      button.innerHTML = `<span class="ms-model-item__dot"></span><div class="action-panel__model-info"><span class="name"></span></div>`;
      button.querySelector(".name").textContent = model;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const preset = presetOfFamily(items, family);
        if (!preset) return;
        state.choice[family] = model;
        state.lastPicked = model;
        writeJson(CHOICE_KEY, state.choice);
        preset.click();
        window.setTimeout(() => {
          patchTrigger();
          queueRender();
        }, 0);
      });
      wrap.appendChild(button);
    }
    if (!models.length) {
      const note = document.createElement("div");
      note.className = "ms-model-list__empty";
      note.textContent = "当前第三方配置还没有勾选模型。请到「模型与接口设置 → API 来源设置」拉取并勾选。";
      wrap.appendChild(note);
    }
    return wrap;
  }

  function enhanceDropdown(dropdown, base) {
    if (!modelSelectOf(dropdown)) return;
    const signature = [base, selectedModelsForActiveProfile().join(","), state.choice.banana || "", state.choice.gpt || ""].join("|");
    if (dropdown.getAttribute("data-ms-model-signature") === signature) return;
    dropdown.setAttribute("data-ms-model-signature", signature);
    dropdown.querySelector("[data-ms-model-list]")?.remove();
    nativeItems(dropdown).forEach((item) => item.classList.add("ms-model-native"));
    dropdown.appendChild(buildList(dropdown, base));
  }

  function restoreTriggerLabel(select) {
    const span = [...select.children].find((node) => node.tagName === "SPAN");
    if (!span) return;
    if (!span.dataset.msNativeLabel) span.dataset.msNativeLabel = span.textContent;
    const dropdown = select.querySelector(".action-panel__dropdown--model");
    const activeNative = dropdown
      ? nativeItems(dropdown).find((item) => item.classList.contains("active"))
      : null;
    const nativeLabel = activeNative ? labelOf(activeNative) : span.dataset.msNativeLabel;
    if (nativeLabel && span.textContent !== nativeLabel) span.textContent = nativeLabel;
  }

  function restoreNativeTriggerLabels() {
    document
      .querySelectorAll(".action-panel--image .action-panel__left > .action-panel__model-select")
      .forEach((select) => {
        const left = select.closest(".action-panel__left");
        if (!left || left.querySelector(".action-panel__model-select") !== select) return;
        restoreTriggerLabel(select);
      });
  }

  function patchTrigger() {
    const base = activeBase();
    const models = isRemotePlatform(base) ? selectedModelsForActiveProfile() : [];
    if (isRemotePlatform(base)) clearStaleChoices(models);
    const chosen = models.includes(state.lastPicked)
      ? state.lastPicked
      : [state.choice.gpt, state.choice.banana].find(
          (model) => model && models.includes(model),
        ) || "";
    document.querySelectorAll(".action-panel--image .action-panel__left > .action-panel__model-select").forEach((select) => {
      const left = select.closest(".action-panel__left");
      if (!left || left.querySelector(".action-panel__model-select") !== select) return;
      const span = [...select.children].find((node) => node.tagName === "SPAN");
      if (!span) return;
      if (!span.dataset.msNativeLabel) span.dataset.msNativeLabel = span.textContent;
      if (!chosen) {
        restoreTriggerLabel(select);
        return;
      }
      if (span.textContent !== chosen) span.textContent = chosen;
    });
  }

  function queueRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    window.setTimeout(() => {
      state.renderQueued = false;
      const base = activeBase();
      if (!isRemotePlatform(base)) {
        document.querySelectorAll("[data-ms-model-list]").forEach((node) => node.remove());
        document.querySelectorAll(".ms-model-native").forEach((node) => node.classList.remove("ms-model-native"));
        restoreNativeTriggerLabels();
        return;
      }
      document.querySelectorAll(".action-panel--image .action-panel__dropdown--model").forEach((dropdown) => {
        enhanceDropdown(dropdown, base);
      });
      patchTrigger();
    }, 0);
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ms-model-native { display: none !important; }
      .ms-model-list {
        display: flex;
        flex-direction: column;
        max-height: 280px;
        overflow-y: auto;
        padding: 4px 0;
      }
      .ms-model-list__header {
        padding: 6px 12px 8px;
        font-size: 11px;
        color: var(--text-tertiary, #8a8a8a);
        border-bottom: 1px solid var(--node-border, rgba(0,0,0,0.08));
        margin-bottom: 4px;
        position: sticky;
        top: 0;
        background: inherit;
      }
      .ms-model-item__dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent, #4f8cff);
        opacity: 0;
        flex: 0 0 auto;
      }
      .ms-model-item.active .ms-model-item__dot { opacity: 1; }
      .ms-model-item .name { font-size: 12px; }
      .ms-model-list__error {
        padding: 6px 12px;
        font-size: 11px;
        color: #b42318;
      }
      .ms-model-list__empty {
        padding: 10px 12px;
        color: var(--text-tertiary, #8a8a8a);
        font-size: 11px;
        line-height: 1.6;
      }
    `;
    document.head.appendChild(style);
  }

  function initialLoad() {
    if (!isRemotePlatform(activeBase())) return;
    installStyles();
    persistNormalizedBase();
    queueRender();
  }

  function init() {
    loadChoice();
    installStyles();
    persistNormalizedBase();
    initialLoad();

    const observer = new MutationObserver(() => queueRender());
    observer.observe(document.body, { childList: true, subtree: true });

    // Re-sync when the profile manager changes the active API.
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      const result = originalSetItem.call(this, key, value);
      if (this === window.localStorage && (key === PROFILES_KEY || key === SETTINGS_KEY)) {
        window.setTimeout(() => {
          loadChoice();
          persistNormalizedBase();
          queueRender();
        }, 0);
      }
      return result;
    };

    window.addEventListener("storage", (event) => {
      if (![PROFILES_KEY, SETTINGS_KEY, CHOICE_KEY].includes(event.key)) return;
      loadChoice();
      persistNormalizedBase();
      queueRender();
    });
  }


  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();