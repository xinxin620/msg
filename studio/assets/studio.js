(() => {
  "use strict";

  const VERSION = "20261109-3";
  const BRIDGE_DB = "manshiguang-canvas-bridge";
  const DB_VERSION = 1;
  const STORE = "directoryHandles";
  const DEFAULT_KEY = "bridge:default";
  const STATE_KEY = "manshiguang:studio";

  const WORKSPACES = [
    {
      id: "canvas",
      label: "画布",
      tagline: "节点工作流编排",
      kicker: "CANVAS",
      icon: "icon-canvas",
      type: "frame",
      url: "../canvas/index.html?v=" + VERSION,
      state: "在线",
    },
    {
      id: "assets",
      label: "图片工坊",
      tagline: "人物、服装、姿势素材库",
      kicker: "ASSET ATELIER",
      icon: "icon-assets",
      type: "frame",
      url: "../gallery/index.html?v=" + VERSION + "&embed=1&host=studio&tab=poses",
      state: "在线",
      tabs: [
        { value: "poses", label: "姿势" },
        { value: "costumes", label: "服装" },
        { value: "portraits", label: "人像" },
      ],
    },
    {
      id: "story",
      label: "剧情导演台",
      tagline: "大纲、剧本、分镜脚本",
      kicker: "STORY DESK",
      icon: "icon-story",
      type: "soon",
      state: "规划中",
      purpose:
        "把一部漫剧从选题到可拍摄脚本的全过程收在一处：维护故事大纲与分集结构，编写并修订单集剧本，再把确认后的剧本拆成分镜脚本。它负责“文字到结构”，产出的分镜直接喂给数字人视频工作区。",
      inputs: [
        "选题与人物小传",
        "分集大纲（EP001、EP002…）",
        "已有剧本 Markdown",
      ],
      outputs: [
        "可拍摄单集剧本",
        "场景与对白修订记录",
        "分镜脚本（含镜头顺序与时长）",
      ],
      relation:
        "沿用你现有的剧本与分镜产出格式（剧集/EPxxx/ 目录下的 Markdown），工作台只做集中查看与修订，不改变文件约定。",
    },
    {
      id: "imagelab",
      label: "设定与出图",
      tagline: "人物造型、场景、道具设定图",
      kicker: "LOOK DEVELOPMENT",
      icon: "icon-image",
      type: "soon",
      state: "规划中",
      purpose:
        "管理“可复用的视觉设定”：角色定妆照、三视图/四视图、场景板、道具板、生物设定。每个设定保留状态变体与版本，出图任务从这里取参考，避免每次重画。",
      inputs: [
        "剧情导演台的人物与场景描述",
        "图片工坊里的姿势、服装、人像参考",
        "已有的设定图与版本记录",
      ],
      outputs: [
        "角色设定图（含多视图与状态变体）",
        "场景/道具/生物设定板",
        "可直接复制的生图提示词",
      ],
      relation:
        "与图片工坊分工：工坊是“外部素材参考库”，这里是“你自己的设定资产”。两者互相引用，不重复存储。",
    },
    {
      id: "human",
      label: "数字人视频",
      tagline: "镜头生成、参考生视频",
      kicker: "MOTION STUDIO",
      icon: "icon-human",
      type: "soon",
      state: "规划中",
      purpose:
        "把分镜脚本变成动态镜头：按镜头组织参考图与提示词，提交参考生视频任务，管理每个镜头的版本与取舍，并把通过的镜头交给剪辑。",
      inputs: [
        "剧情导演台的分镜脚本",
        "设定与出图产出的角色/场景图",
        "图片工坊的姿势与构图参考",
      ],
      outputs: [
        "逐镜头视频片段与版本记录",
        "镜头级提示词与参考组合",
        "可交给剪辑的镜头清单",
      ],
      relation:
        "生成任务本身继续在画布里跑（节点工作流），这里负责按镜头组织与验收，不重复实现生成逻辑。",
    },
    {
      id: "tasks",
      label: "任务与成片",
      tagline: "队列、历史、导出",
      kicker: "PIPELINE",
      icon: "icon-task",
      type: "soon",
      state: "规划中",
      purpose:
        "跨工作区的总控：查看正在跑与排队的生成任务，回溯历史产出，按集汇总素材与镜头，导出成片与发布物料。",
      inputs: [
        "各工作区提交的生成任务",
        "画布的历史记录与产物",
        "资产目录里的落盘文件",
      ],
      outputs: [
        "任务队列与状态总览",
        "按集归档的产出清单",
        "成片导出与发布物料",
      ],
      relation:
        "只读汇总为主，不接管生成过程；失败任务给出可定位的原因而不是笼统报错。",
    },
  ];

  const railList = document.getElementById("railList");
  const stageFrame = document.getElementById("stageFrame");
  const stageBoot = document.getElementById("stageBoot");
  const stageNote = document.getElementById("stageNote");
  const stageNoteText = document.getElementById("stageNoteText");
  const barKicker = document.getElementById("barKicker");
  const barTitle = document.getElementById("barTitle");
  const barDesc = document.getElementById("barDesc");
  const refreshBtn = document.getElementById("refreshBtn");
  const openTabBtn = document.getElementById("openTabBtn");
  const soonTemplate = document.getElementById("soonTemplate");

  const frames = new Map();
  let activeId = "";

  function findWorkspace(id) {
    return WORKSPACES.find((item) => item.id === id) || null;
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function writeState(patch) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ ...readState(), ...patch }));
    } catch (_) {
      /* 隐私模式下 localStorage 可能不可用，忽略 */
    }
  }

  function buildUrl(workspace, tab) {
    if (workspace.id !== "assets") return workspace.url;
    return "../gallery/index.html?v=" + VERSION + "&embed=1&host=studio&tab=" + encodeURIComponent(tab || "poses");
  }

  function renderRail() {
    railList.replaceChildren();
    WORKSPACES.forEach((workspace) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rail-item" + (workspace.id === activeId ? " is-active" : "");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(workspace.id === activeId));
      button.dataset.workspace = workspace.id;

      const icon = document.createElement("span");
      icon.className = "item-icon";
      icon.innerHTML = '<svg class="icon"><use href="#' + workspace.icon + '"></use></svg>';

      const body = document.createElement("span");
      body.className = "item-body";
      const strong = document.createElement("strong");
      strong.textContent = workspace.label;
      const small = document.createElement("small");
      small.textContent = workspace.tagline;
      body.append(strong, small);

      const tag = document.createElement("span");
      tag.className = "item-tag";
      tag.textContent = workspace.state;

      button.append(icon, body, tag);
      button.addEventListener("click", () => activate(workspace.id));
      railList.appendChild(button);
    });
  }

  function renderBar(workspace) {
    barKicker.textContent = workspace.kicker;
    barTitle.textContent = workspace.label;
    barDesc.textContent = workspace.tagline;
  }

  function ensureFrame(workspace) {
    let entry = frames.get(workspace.id);
    if (entry) return entry;

    const iframe = document.createElement("iframe");
    iframe.title = workspace.label + " 工作区";
    iframe.src = buildUrl(workspace, readState().assetTab);
    iframe.setAttribute("allow", "clipboard-write");

    const wrapper = document.createElement("div");
    wrapper.className = "stage-frame";
    wrapper.style.display = "none";
    wrapper.appendChild(iframe);
    stageFrame.parentElement.appendChild(wrapper);

    entry = { wrapper, iframe, ready: false };
    iframe.addEventListener("load", () => {
      entry.ready = true;
      if (activeId === workspace.id) setBootReady();
    });
    frames.set(workspace.id, entry);
    return entry;
  }

  function setBootReady() {
    stageBoot.dataset.ready = "true";
  }

  function showSoon(workspace) {
    const node = soonTemplate.content.cloneNode(true);
    const root = node.querySelector(".soon");
    root.querySelector("[data-slot=title]").textContent = workspace.label;
    root.querySelector("[data-slot=tagline]").textContent = workspace.tagline;
    root.querySelector("[data-slot=state]").textContent = workspace.state + " · 结构已就位";
    root.querySelector("[data-slot=icon]").innerHTML =
      '<svg class="icon"><use href="#' + workspace.icon + '"></use></svg>';
    root.querySelector("[data-slot=purpose]").textContent = workspace.purpose;
    ["inputs", "outputs"].forEach((slot) => {
      const list = root.querySelector("[data-slot=" + slot + "]");
      list.replaceChildren();
      workspace[slot].forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        list.appendChild(li);
      });
    });
    root.querySelector("[data-slot=relation]").textContent = workspace.relation;
    const foot = root.querySelector("[data-slot=foot]");
    foot.textContent =
      "这个工作区还没有接入生成能力。当前可以先在";
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = workspace.id === "assets" ? "画布" : "画布与图片工坊";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      activate(workspace.id === "assets" ? "canvas" : "canvas");
    });
    foot.append(link, " 里继续实际创作。");
    return root;
  }

  function activate(id, options) {
    const workspace = findWorkspace(id);
    if (!workspace) return;
    activeId = id;
    writeState({ workspace: id });
    if (!options || !options.keepHash) {
      try {
        history.replaceState(null, "", "#" + id);
      } catch (_) {
        /* file:// 下可能受限 */
      }
    }

    renderRail();
    renderBar(workspace);
    stageNote.hidden = true;
    stageBoot.dataset.ready = "false";
    stageBoot.querySelector("#bootLabel").textContent = "正在准备「" + workspace.label + "」…";

    frames.forEach((entry, key) => {
      entry.wrapper.style.display = key === id ? "" : "none";
    });

    if (workspace.type === "frame") {
      soonHost().replaceChildren();
      const entry = ensureFrame(workspace);
      entry.wrapper.style.display = "";
      if (entry.ready) setBootReady();
      else window.setTimeout(setBootReady, 14000);
    } else {
      const host = soonHost();
      host.replaceChildren(showSoon(workspace));
      host.style.display = "";
      setBootReady();
    }
  }

  function soonHost() {
    let host = stageFrame.querySelector(".soon-host");
    if (!host) {
      host = document.createElement("div");
      host.className = "stage-frame soon-host";
      stageFrame.appendChild(host);
    }
    return host;
  }

  function switchAssetTab(tab) {
    writeState({ assetTab: tab });
    barSeg.querySelectorAll("button").forEach((button, index) => {
      const workspace = findWorkspace("assets");
      button.className = workspace.tabs[index].value === tab ? "is-active" : "";
    });
    const entry = frames.get("assets");
    if (!entry || !entry.ready) return;
    try {
      entry.iframe.contentWindow.postMessage(
        { source: "manshiguang-asset-host", type: "switch-tab", tab },
        window.location.origin,
      );
    } catch (_) {
      entry.iframe.src = buildUrl(findWorkspace("assets"), tab);
    }
  }

  /* ===== 资产目录状态：读取与画布共享的 IndexedDB ===== */
  function openBridgeDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(BRIDGE_DB, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("无法打开授权数据库"));
    });
  }

  async function readDefaultDirectory() {
    const db = await openBridgeDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(DEFAULT_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("读取授权记录失败"));
      });
    } finally {
      db.close();
    }
  }

  const dirChip = document.getElementById("assetDirChip");
  const dirLabel = document.getElementById("assetDirLabel");
  const dirHint = document.getElementById("assetDirHint");

  async function refreshDirChip() {
    dirChip.classList.remove("is-ready", "is-error");
    try {
      const record = await readDefaultDirectory();
      if (record?.handle) {
        dirChip.classList.add("is-ready");
        dirLabel.textContent = "资产目录已授权";
        dirHint.textContent = record.name ? "当前：" + record.name : "画布与资产库共用";
      } else {
        dirLabel.textContent = "授权资产目录";
        dirHint.textContent = "点击选择本地目录，供画布落盘与读取素材";
      }
    } catch (error) {
      dirChip.classList.add("is-error");
      dirLabel.textContent = "资产目录状态未知";
      dirHint.textContent = error.message || "无法读取授权记录";
    }
  }

  function notifyDirectoryChanged() {
    const payload = { source: "manshiguang-studio", type: "directory-changed" };
    frames.forEach((entry) => {
      try {
        entry.iframe.contentWindow.postMessage(payload, window.location.origin);
      } catch (_) { /* iframe 已卸载 */ }
    });
    try {
      if (typeof BroadcastChannel === "function") {
        const channel = new BroadcastChannel("manshiguang-canvas-bridge");
        channel.postMessage(payload);
        channel.close();
      }
    } catch (_) { /* 不支持 BroadcastChannel */ }
  }

  function makeToken(handle) {
    const id = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2, 12);
    return "webdir:" + id + ":" + encodeURIComponent(handle.name || "assets");
  }

  function putRecords(db, pairs) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      pairs.forEach((pair) => tx.objectStore(STORE).put(pair.value, pair.key));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("写入授权记录失败"));
      tx.onabort = () => reject(tx.error || new Error("写入授权记录被中断"));
    });
  }

  // 授权在工作台顶层完成：顶层点击一定是真实用户手势，
  // 再把 handle 写进与画布桥接层同库同键的 IndexedDB，iframe 里的画布直接复用。
  async function authorizeFromShell() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error("当前浏览器不支持选择本地目录，请使用最新版 Chrome 或 Edge");
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const token = makeToken(handle);
    const record = { token, name: handle.name || "浏览器素材目录", handle, createdAt: Date.now() };
    const db = await openBridgeDb();
    try {
      await putRecords(db, [
        { key: token, value: record },
        { key: DEFAULT_KEY, value: record },
      ]);
    } finally {
      db.close();
    }
    return record;
  }

  async function requestDirectory() {
    try {
      dirChip.classList.remove("is-error");
      dirLabel.textContent = "等待选择目录…";
      dirHint.textContent = "在系统窗口中选择资产目录";
      const record = await authorizeFromShell();
      dirChip.classList.add("is-ready");
      dirLabel.textContent = "资产目录已授权";
      dirHint.textContent = "当前：" + (record.name || "已授权目录");
      // 通知已加载的画布：授权变了，素材路径缓存需要重新确认。
      notifyDirectoryChanged();
    } catch (error) {
      if (error && (error.name === "AbortError" || error.name === "NotAllowedError")) {
        await refreshDirChip();
        dirHint.textContent = "已取消选择，未改动当前授权";
        return;
      }
      dirChip.classList.add("is-error");
      dirLabel.textContent = "授权失败";
      dirHint.textContent = error?.message || String(error);
    }
  }

  dirChip.addEventListener("click", requestDirectory);

  refreshBtn.addEventListener("click", () => {
    const workspace = findWorkspace(activeId);
    if (!workspace) return;
    if (workspace.type !== "frame") {
      activate(workspace.id);
      return;
    }
    const entry = frames.get(workspace.id);
    if (!entry) return;
    stageBoot.dataset.ready = "false";
    entry.ready = false;
    entry.iframe.src = buildUrl(workspace, readState().assetTab);
    window.setTimeout(setBootReady, 14000);
  });

  openTabBtn.addEventListener("click", () => {
    const workspace = findWorkspace(activeId);
    if (!workspace) return;
    const url = workspace.type === "frame"
      ? buildUrl(workspace, readState().assetTab)
      : "../canvas/index.html?v=" + VERSION;
    window.open(url, "_blank", "noopener");
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "manshiguang-asset-embed") return;
    if (data.type === "directory-changed") {
      refreshDirChip();
      return;
    }
    // 图片工坊里点「插入画布」：把资产交给画布工作区并切过去，
    // 否则消息只停在外壳层，会出现提示成功但画布没反应的假象。
    if (data.type === "asset-select") {
      deliverToCanvas(data.asset);
    }
  });

  function showNote(message) {
    if (!stageNote || !stageNoteText) return;
    stageNoteText.textContent = message;
    stageNote.hidden = false;
    window.setTimeout(() => { stageNote.hidden = true; }, 8000);
  }

  function deliverToCanvas(asset) {
    if (!asset) return;
    const entry = frames.get("canvas");
    if (!entry || !entry.ready) {
      activate("canvas");
      window.setTimeout(() => deliverToCanvas(asset), 1200);
      return;
    }
    const host = entry.iframe.contentWindow && entry.iframe.contentWindow.__MS_CANVAS_ASSET_HOST__;
    if (host && typeof host.receiveAsset === "function" && host.receiveAsset(asset)) {
      activate("canvas");
      return;
    }
    // 画布补丁尚未就绪：先切过去，稍后重试一次。
    activate("canvas");
    window.setTimeout(() => {
      const retry = frames.get("canvas");
      const again = retry && retry.iframe.contentWindow && retry.iframe.contentWindow.__MS_CANVAS_ASSET_HOST__;
      if (!again || typeof again.receiveAsset !== "function" || !again.receiveAsset(asset)) {
        showNote("画布还没准备好，请在画布工作区打开一个工作流后再点一次「插入画布」。");
      }
    }, 2500);
  }

  window.addEventListener("focus", refreshDirChip);

  function boot() {
    const hash = (location.hash || "").replace("#", "");
    const saved = readState().workspace;
    const start = findWorkspace(hash) || findWorkspace(saved) || WORKSPACES[0];
    renderRail();
    activate(start.id, { keepHash: !findWorkspace(hash) });
    refreshDirChip();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
