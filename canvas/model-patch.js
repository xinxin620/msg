(() => {
  "use strict";

  const PROFILES_KEY = "manshiguang:canvas-api-profiles";
  const SETTINGS_KEY = "canvas-api-settings";
  const CHOICE_KEY = "manshiguang:canvas-model-choice";
  const STYLE_ID = "ms-model-patch-style";
  const VENDOR_ID = "yunwu";
  const POLL_INTERVAL_MS = 2500;
  const POLL_TIMEOUT_MS = 6 * 60 * 1000;
  const GENERATE_ENDPOINT = "/v1/api/generate";
  const RESULT_ENDPOINT = "/v1/api/result";


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
    if (changed) persistChoice();
  }

  function persistChoice() {
    writeJson(CHOICE_KEY, {
      ...state.choice,
      lastPicked: state.lastPicked,
    });
  }

  function chosenModelFor(models) {
    if (state.lastPicked && models.includes(state.lastPicked)) {
      return state.lastPicked;
    }
    return (
      [state.choice.gpt, state.choice.banana].find(
        (model) => model && models.includes(model),
      ) || ""
    );
  }

  function apiKeyFor(base) {
    const profile = activeProfile();
    if (profile && !profile.builtin) {
      return profile.apiKey || "";
    }
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

  const GPT_RATIO_SIZES = {
    "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
    "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
    "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
    "4:3": { "1K": "1152x864", "2K": "2304x1728", "4K": "3264x2448" },
    "3:4": { "1K": "864x1152", "2K": "1728x2304", "4K": "2448x3264" },
    "3:2": { "1K": "1536x1024", "2K": "2048x1360", "4K": "3504x2336" },
    "2:3": { "1K": "1024x1536", "2K": "1360x2048", "4K": "2336x3504" },
    "5:4": { "1K": "1120x896", "2K": "2240x1792", "4K": "3200x2560" },
    "4:5": { "1K": "896x1120", "2K": "1792x2240", "4K": "2560x3200" },
    "21:9": { "1K": "1456x624", "2K": "2912x1248", "4K": "3840x1648" },
    "9:21": { "1K": "624x1456", "2K": "1248x2912", "4K": "1648x3840" },
    "1:3": { "2K": "688x2048", "4K": "1280x3840" },
    "3:1": { "2K": "2048x688", "4K": "3840x1280" },
    "2:1": { "1K": "1536x768", "2K": "3072x1536", "4K": "3840x1920" },
    "1:2": { "1K": "768x1536", "2K": "1536x3072", "4K": "1920x3840" },
  };

  const GPT_2_RATIO_SIZES = {
    "1:1": "1024x1024",
    "16:9": "1672x941",
    "9:16": "941x1672",
    "4:3": "1443x1090",
    "3:4": "1090x1443",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "5:4": "1408x1120",
    "4:5": "1120x1408",
    "21:9": "1920x832",
    "9:21": "832x1920",
    "1:2": "896x1792",
    "2:1": "1792x896",
  };

  function normalizeRatio(value) {
    const text = String(value || "").trim();
    return /^(?:auto|\d+:\d+)$/i.test(text) ? text.toLowerCase() : "";
  }

  function ratioFromSize(size) {
    const text = String(size || "").trim();
    const ratio = normalizeRatio(text);
    if (ratio) return ratio;
    const match = /^(\d+)x(\d+)$/i.exec(text);
    if (!match) return "";
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return "";
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  function imageSizeFromSize(size) {
    const text = String(size || "").trim();
    if (/^4k$/i.test(text)) return "4K";
    if (/^2k$/i.test(text)) return "2K";
    if (/^1k$/i.test(text)) return "1K";
    const match = /^(\d+)x(\d+)$/i.exec(text);
    if (!match) return "1K";
    const max = Math.max(Number(match[1]), Number(match[2]));
    if (max >= 3000) return "4K";
    if (max >= 1800) return "2K";
    return "1K";
  }

  function isPremiumGpt(model) {
    return /gpt-image-2-vip|2\.5-flare|2\.5-sunburst/i.test(model);
  }

  function pixelSizeFromSize({ size, model, aspectRatio, imageSize }) {
    const text = String(size || "").trim();
    if (/^\d+x\d+$/i.test(text)) return text;
    const ratio = normalizeRatio(aspectRatio) || ratioFromSize(text);
    if (ratio === "auto") return "auto";
    const resolution = imageSize || imageSizeFromSize(text);
    if (isPremiumGpt(model)) {
      const sizes = GPT_RATIO_SIZES[ratio];
      return (
        sizes?.[resolution] ||
        sizes?.["1K"] ||
        sizes?.["2K"] ||
        sizes?.["4K"] ||
        "1024x1024"
      );
    }
    return GPT_2_RATIO_SIZES[ratio] || (ratio ? ratio : "1024x1024");
  }

  function qualityForModel(model, size, fallbackImageSize) {
    const resolution = fallbackImageSize || imageSizeFromSize(size);
    if (/gpt-image-2\.5-sunburst/i.test(model)) {
      if (resolution === "4K") return "high";
      return resolution === "2K" ? "medium" : "low";
    }
    if (/gpt-image-2\.5-flare/i.test(model)) {
      return resolution === "1K" ? "low" : "medium";
    }
    if (/gpt-image-2-vip/i.test(model)) return "medium";
    return "auto";
  }

  function buildGenerateBody({ model, prompt, size, aspectRatio, imageSize, urls }) {
    const family = familyOf(model);
    const images = Array.isArray(urls) ? urls : [];
    const ratio = normalizeRatio(aspectRatio) || ratioFromSize(size) || "auto";
    const resolution = imageSize || imageSizeFromSize(size);
    if (family === "banana") {
      return {
        model,
        prompt: prompt || " ",
        images,
        aspectRatio: ratio,
        imageSize: resolution,
        replyType: "async",
      };
    }
    return {
      model,
      prompt: prompt || " ",
      images,
      aspectRatio: pixelSizeFromSize({ size, model, aspectRatio: ratio, imageSize: resolution }),
      quality: qualityForModel(model, size, resolution),
      replyType: "async",
    };
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

  function addImageValue(value, output, fallbackMime = "image/png") {
    if (value == null) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return;
      if (/^data:image\//i.test(text) || /^https?:\/\//i.test(text)) {
        output.push(text);
      } else if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s+/g, "").length > 64) {
        output.push(`data:${fallbackMime};base64,${text.replace(/\s+/g, "")}`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => addImageValue(item, output, fallbackMime));
      return;
    }
    if (typeof value !== "object") return;

    const mime =
      String(
        value.mime_type || value.mimeType || value.metadata?.mimeType || fallbackMime,
      ) || fallbackMime;
    const base64 = value.data || value.base64 || value.image_base64 || value.imageBase64;
    if (typeof base64 === "string" && base64.trim() && !/^https?:\/\//i.test(base64)) {
      const text = base64.trim();
      if (/^data:image\//i.test(text)) output.push(text);
      else output.push(`data:${mime};base64,${text}`);
    }
    [
      value.url,
      value.image_url,
      value.imageUrl,
      value.file_url,
      value.fileUrl,
      value.file_uri,
      value.fileUri,
    ].forEach((item) => addImageValue(item, output, mime));
    [
      value.inline_data,
      value.inlineData,
      value.file_data,
      value.fileData,
      value.source,
    ].forEach((item) => addImageValue(item, output, mime));
  }

  function geminiParts(payload) {
    const parts = [];
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];
    contents.forEach((content) => {
      if (Array.isArray(content?.parts)) parts.push(...content.parts);
    });
    return parts;
  }

  function parseGeminiRequest(payload) {
    const parts = geminiParts(payload);
    const prompts = [];
    const images = [];
    parts.forEach((part) => {
      if (typeof part?.text === "string" && part.text.trim()) prompts.push(part.text.trim());
      addImageValue(part?.inline_data || part?.inlineData, images);
      addImageValue(part?.file_data || part?.fileData, images);
    });
    const generationConfig = payload?.generationConfig || payload?.generation_config || {};
    const imageConfig = generationConfig.imageConfig || generationConfig.image_config || {};
    return {
      prompt: prompts.join("\n").trim(),
      size: "",
      aspectRatio: normalizeRatio(imageConfig.aspectRatio || imageConfig.aspect_ratio),
      imageSize: String(imageConfig.imageSize || imageConfig.image_size || "").toUpperCase(),
      images,
    };
  }

  function parseOpenAiRequest(parsed) {
    const fields = parsed.kind === "json" ? parsed.value || {} : parsed.kind === "form" ? parsed.fields || {} : {};
    const images = [];
    [
      fields.image,
      fields.images,
      fields.reference_image,
      fields.reference_images,
      fields.referenceImage,
      fields.referenceImages,
    ].forEach((value) => addImageValue(value, images));
    return {
      fields,
      prompt: typeof fields.prompt === "string" ? fields.prompt.trim() : String(fields.prompt || "").trim(),
      size: String(fields.size || "").trim(),
      aspectRatio: "",
      imageSize: "",
      images,
    };
  }

  async function parseRequest(kind, parsed) {
    const request =
      kind === "gemini"
        ? parseGeminiRequest(parsed.kind === "json" ? parsed.value : {})
        : parseOpenAiRequest(parsed);
    const images = [...(request.images || [])];
    if (parsed.kind === "form" && parsed.files?.length) {
      for (const file of parsed.files) images.push(await blobToDataUrl(file));
    }
    request.urls = [...new Set(images.filter(Boolean))];
    return request;
  }

  function withTimeout(promise, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return promise(controller.signal).finally(() => clearTimeout(timer));
  }

  async function readResponsePayload(response) {
    const text = await response.text();
    if (!text.trim()) return { payload: null, text: "" };
    try {
      return { payload: JSON.parse(text), text };
    } catch {
      return { payload: null, text };
    }
  }

  function upstreamMessage(payload, text) {
    const error = payload?.error;
    const value =
      (error && typeof error === "object" ? error.message || error.type || JSON.stringify(error) : error) ||
      payload?.errorMessage ||
      payload?.fail_reason ||
      payload?.msg ||
      payload?.message ||
      text ||
      "上游未返回错误正文";
    const message = String(value).replace(/\s+/g, " ").trim();
    return message.length > 600 ? `${message.slice(0, 600)}…` : message;
  }

  function upstreamError(label, response, payload, text) {
    return new Error(`${label} HTTP ${response.status}: ${upstreamMessage(payload, text)}`);
  }

  async function pollGrsaiResult({ base, apiKey, taskId }) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const response = await fetch(
        `${base}${RESULT_ENDPOINT}?id=${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        },
      );
      const { payload, text } = await readResponsePayload(response);
      if (!response.ok) throw upstreamError("Grsai 查询结果", response, payload, text);
      if (payload?.error) {
        throw new Error(`Grsai 查询结果: ${upstreamMessage(payload, text)}`);
      }
      if (typeof payload?.code === "number" && payload.code !== 0) {
        throw new Error(`Grsai 查询结果 code ${payload.code}: ${upstreamMessage(payload, text)}`);
      }
      const result = payload?.data ?? payload;
      const found = extractUrls(result);
      if (found.length) return found;
      const status = String(result?.status || "").toLowerCase();
      if (["failed", "failure", "error", "violation", "cancelled", "canceled"].includes(status)) {
        throw new Error(`Grsai 生成失败: ${upstreamMessage(payload, text)}`);
      }
    }
    throw new Error(`Grsai 生成超时，任务 ID：${taskId}`);
  }

  async function submitGrsai({ base, apiKey, model, prompt, size, aspectRatio, imageSize, urls }) {
    const body = buildGenerateBody({ model, prompt, size, aspectRatio, imageSize, urls });
    const response = await withTimeout(
      (signal) =>
        fetch(`${base}${GENERATE_ENDPOINT}`, {
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
    const { payload, text } = await readResponsePayload(response);
    if (!response.ok) throw upstreamError("Grsai 生成", response, payload, text);
    if (payload?.error) throw new Error(`Grsai 生成: ${upstreamMessage(payload, text)}`);
    if (typeof payload?.code === "number" && payload.code !== 0) {
      throw new Error(`Grsai 生成 code ${payload.code}: ${upstreamMessage(payload, text)}`);
    }

    const result = payload?.data ?? payload;
    const found = extractUrls(result);
    if (found.length) return found;
    const taskId = taskIdOf(payload);
    if (!taskId) {
      throw new Error(`Grsai 未返回图片地址或任务 ID：${upstreamMessage(payload, text)}`);
    }
    return pollGrsaiResult({ base, apiKey, taskId });
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  function drawTargetKind(url) {
    const path = String(url || "").split("?")[0];
    if (/\/v1\/images\/(generations|edits)\/?$/i.test(path)) return "openai";
    if (/\/v1beta\/models\/[^/]+:generateContent\/?$/i.test(path)) return "gemini";
    return "";
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const base = activeBase();
    const targetKind = drawTargetKind(url);
    if (!targetKind || !isRemotePlatform(base) || !/grsai/i.test(base)) {
      return originalFetch(input, init);
    }
    try {
      const parsed = await readRequestBody(init?.body);
      const request = await parseRequest(targetKind, parsed);
      const requestedModel =
        targetKind === "gemini"
          ? decodeURIComponent(
              String(url).match(/\/v1beta\/models\/([^/]+):generateContent/i)?.[1] || "",
            )
          : String(request.fields?.model || "");
      const family = familyOf(requestedModel);
      const selectedModels = selectedModelsForActiveProfile();
      if (!selectedModels.length) {
        throw new Error("当前第三方 API 配置未勾选模型，请先到「图片API来源设置」拉取并勾选。");
      }
      const familyChoice = state.choice[family];
      const chosen = selectedModels.includes(familyChoice)
        ? familyChoice
        : selectedModels.find((model) => familyOf(model) === family) || selectedModels[0];
      if (!chosen) {
        throw new Error("当前第三方 API 配置没有可用模型。");
      }
      const apiKey = apiKeyFor(base);
      if (!apiKey) throw new Error("当前第三方 API 配置缺少 API Key。");
      const found = await submitGrsai({
        base,
        apiKey,
        model: chosen,
        prompt: request.prompt,
        size: request.size,
        aspectRatio: request.aspectRatio,
        imageSize: request.imageSize,
        urls: request.urls,
      });
      return jsonResponse({ created: Math.floor(Date.now() / 1000), data: found.map((item) => ({ url: item })) });
    } catch (error) {
      return jsonResponse({ error: { message: error?.message || String(error) } }, 400);
    }
  };

  /* ---------- dropdown injection ---------- */

  function loadChoice() {
    const stored = readJson(CHOICE_KEY, null);
    const choice = stored && typeof stored === "object" ? { ...stored } : {};
    state.lastPicked =
      typeof choice.lastPicked === "string" ? choice.lastPicked : "";
    delete choice.lastPicked;
    state.choice = choice;
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
    const chosenModel = chosenModelFor(models);
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
      const isActive = chosenModel === model;
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
        persistChoice();
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
      note.textContent = "当前第三方配置还没有勾选模型。请到「模型与接口设置 → 图片API来源设置」拉取并勾选。";
      wrap.appendChild(note);
    }
    return wrap;
  }

  function enhanceDropdown(dropdown, base) {
    if (!modelSelectOf(dropdown)) return;
    const models = selectedModelsForActiveProfile();
    const signature = [base, models.join(","), chosenModelFor(models)].join("|");
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
    const chosen = chosenModelFor(models);
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
