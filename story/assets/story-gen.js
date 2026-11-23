(() => {
  "use strict";

  // 生成层：只读复用画布的文本 API 配置（localStorage["manshiguang:canvas-text-api-profiles"]），
  // 不碰画布配置 UI、不另存一份 Key——遵守「不代理 API 配置」边界。
  // 直连被 CORS 拦时回退 server.py 的 /__textapi/proxy，与 text-api-patch 同一通道。
  // 提示词来自 __MS_SKILL_TEMPLATES__（随仓库分发的骨架），不在这里重写方法论。
  // 任何缺配置/失败都 throw new Error(中文)，绝不静默返回空稿。

  const TEXT_PROFILES_KEY = "manshiguang:canvas-text-api-profiles";
  const SKILL_KEY = "manshiguang:canvas-skill-templates";
  const PROXY_PREFIX = "/__textapi/";
  const DEFAULT_BASE_URL = "https://api.openlux.ai/v1";
  const IMAGE_MODEL_RE = /image|banana|imagen|flux|dall|stable-diffusion|sdxl|seedream|seededit|kolors|midjourney|^mj[-_.]|draw|paint|video|i2v|t2v|kling|sora|veo|wan\d|wan-|hailuo|minimax|seedance|jimeng|animated|frame|motion|embed/i;
  const NON_TEXT_MODEL_RE = /embedding|rerank|moderation|whisper|tts|audio|speech|realtime|transcri|ocr|safety/i;

  function isTextModel(model) {
    const name = String(model || "");
    return !!name && !IMAGE_MODEL_RE.test(name) && !NON_TEXT_MODEL_RE.test(name);
  }

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

  function readConfig() {
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(TEXT_PROFILES_KEY) || "null");
    } catch (_) {
      throw new Error("文本 API 配置无法解析，请先到「设置 · API设置」检查文本 API 配置。");
    }
    const profiles = Array.isArray(stored?.profiles) ? stored.profiles : [];
    if (!profiles.length) {
      throw new Error("还没有文本 API 配置，请先到「设置 · API设置」添加并启用一个文本模型。");
    }
    const active =
      profiles.find((p) => p.id === stored.activeId) ||
      profiles.find((p) => p.builtin) ||
      profiles[0];
    return { profiles, active };
  }

  function effectiveBase(profile) {
    return normalizeBaseUrl(profile.baseUrl) || (profile.builtin ? normalizeBaseUrl(DEFAULT_BASE_URL) : "");
  }

  // 模型选择沿用 text-api-patch 口径：textModel 优先，其次勾选里的文本模型，内置不兜底随机项。
  function pickModel(profile) {
    if (profile.textModel && isTextModel(profile.textModel)) return profile.textModel;
    const selected = (Array.isArray(profile.selectedModels) ? profile.selectedModels : []).filter(isTextModel);
    if (selected.length) return selected[0];
    if (!profile.builtin) {
      const catalog = (Array.isArray(profile.modelCatalog) ? profile.modelCatalog : []).filter(isTextModel);
      if (catalog.length) return catalog[0];
    }
    return "";
  }

  function describeMissing(profile) {
    const base = effectiveBase(profile);
    const key = String(profile.apiKey || "").trim();
    const model = pickModel(profile);
    const missing = [];
    if (!base) missing.push("接口地址（Base URL）");
    if (!key) missing.push("API 密钥");
    if (!model) missing.push("文本模型名");
    return missing;
  }

  async function requestUpstream(url, init) {
    let directError = null;
    try {
      return await fetch(url, init);
    } catch (error) {
      directError = error;
    }
    const proxied = `${PROXY_PREFIX}proxy?url=${encodeURIComponent(url)}`;
    let response;
    try {
      response = await fetch(proxied, { ...init, mode: "same-origin" });
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
        throw new Error("本机 server.py 还是旧版本，未包含文本 API 转发接口，请重启 start.bat 后再试。");
      }
    }
    return response;
  }

  // 单次生成：system = skill 骨架，user = 输入正文 + 用户补充。返回纯文本。
  async function generate({ system, user, temperature = 0.7, signal } = {}) {
    const { active } = readConfig();
    const missing = describeMissing(active);
    if (missing.length) {
      throw new Error(
        `文本 API 未就绪（当前配置「${active.name || active.id}」缺少：${missing.join("、")}）。请到「设置 · API设置」补全后重试。`,
      );
    }
    const base = effectiveBase(active);
    const model = pickModel(active);
    const body = JSON.stringify({
      model,
      stream: false,
      temperature,
      messages: [
        { role: "system", content: String(system || "") },
        { role: "user", content: String(user || "") },
      ],
    });
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${String(active.apiKey || "").trim()}`,
      },
      body,
      credentials: "omit",
      signal,
    };
    const response = await requestUpstream(`${base}/v1/chat/completions`, init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`模型返回 HTTP ${response.status}：${text.slice(0, 240)}`);
    }
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("模型返回不是 JSON，请确认 Base URL 指向接口根地址。");
    }
    const content =
      payload?.choices?.[0]?.message?.content ??
      payload?.choices?.[0]?.text ??
      "";
    if (!String(content).trim()) {
      throw new Error("模型返回空内容，请检查输入或换一个文本模型重试。");
    }
    return { content: String(content), model, profileName: active.name || active.id };
  }

  // 骨架列表：内置来自 skill-templates-data.js（story 页直接加载该文件），
  // 自定义来自 localStorage["manshiguang:canvas-skill-templates"]，与设置页同源共享。
  function templates() {
    const builtin = (Array.isArray(window.__MS_SKILL_TEMPLATES_BUILTIN__?.templates)
      ? window.__MS_SKILL_TEMPLATES_BUILTIN__.templates
      : []
    ).map((item) => ({ ...item, builtin: true }));
    let custom = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(SKILL_KEY) || "null");
      custom = (Array.isArray(stored?.templates) ? stored.templates : []).map((item) => ({
        ...item,
        builtin: false,
      }));
    } catch (_) {
      custom = [];
    }
    return builtin.concat(custom).filter((item) => item && typeof item.content === "string");
  }

  function templateById(id) {
    return templates().find((item) => item.id === id) || null;
  }

  // 供 UI 显示当前会用哪个配置/模型，不抛错（缺项时返回 null + 原因）。
  function previewConfig() {
    try {
      const { active } = readConfig();
      const missing = describeMissing(active);
      return {
        name: active.name || active.id,
        model: pickModel(active),
        ready: missing.length === 0,
        missing,
      };
    } catch (error) {
      return { name: "", model: "", ready: false, missing: [error.message] };
    }
  }

  window.__MS_STORY_GEN__ = { generate, previewConfig, templates, templateById, isTextModel };
})();
