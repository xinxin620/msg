(() => {
  "use strict";

  const GALLERY_URL = "../gallery/index.html?v=20261107-5";
  const SETTINGS_TITLE = "模型与接口设置";
  const ROOT_SEL = ".sidebar";
  const CHANNEL_NAME = "manshiguang:asset-transfer";

  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

  // ======= 资产接收面板 =======
  let receivedAssets = [];
  let panelVisible = false;
  let panelEl = null;
  let badgeEl = null;
  let channel = null;

  function ensureChannel() {
    if (channel) return;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = handleAssetMessage;
    } catch (_) { channel = null; }
  }

  function handleAssetMessage(event) {
    if (!event.data || event.data.type !== "asset-select") return;
    const asset = event.data.asset;
    if (!asset || !asset.imageUrl) return;

    // Deduplicate by id+category
    const dup = receivedAssets.find(a => a.id === asset.id && a.category === asset.category);
    if (dup) return;

    receivedAssets.unshift(asset);
    if (receivedAssets.length > 20) receivedAssets.length = 20;

    updateBadge();
    showPanel();
    renderPanel();
  }

  function updateBadge() {
    if (!badgeEl) return;
    const count = receivedAssets.length;
    badgeEl.textContent = count;
    badgeEl.style.display = count > 0 ? "grid" : "none";
  }

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement("div");
    panelEl.id = "ms-asset-panel";
    panelEl.innerHTML = `
      <div class="ms-asset-panel__header">
        <span class="ms-asset-panel__title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          合成台 · 资产预览
        </span>
        <div class="ms-asset-panel__actions">
          <button class="ms-asset-panel__btn" id="msAssetClear" title="清空列表" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <button class="ms-asset-panel__btn" id="msAssetClose" title="关闭面板" type="button">✕</button>
        </div>
      </div>
      <div class="ms-asset-panel__list" id="msAssetList"></div>
      <div class="ms-asset-panel__empty" id="msAssetEmpty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        <p>在资产库中点击<span class="ms-accent">发送到画布</span>，选中的参考会出现在这里</p>
      </div>
    `;

    document.body.appendChild(panelEl);

    // Event handlers
    panelEl.querySelector("#msAssetClear").addEventListener("click", () => {
      receivedAssets = [];
      updateBadge();
      renderPanel();
    });
    panelEl.querySelector("#msAssetClose").addEventListener("click", hidePanel);
  }

  function renderPanel() {
    if (!panelEl) return;
    const list = panelEl.querySelector("#msAssetList");
    const empty = panelEl.querySelector("#msAssetEmpty");
    if (!list || !empty) return;

    list.innerHTML = "";
    if (receivedAssets.length === 0) {
      empty.style.display = "flex";
      list.style.display = "none";
      return;
    }
    empty.style.display = "none";
    list.style.display = "flex";

    receivedAssets.forEach((asset, idx) => {
      const item = document.createElement("div");
      item.className = "ms-asset-item";
      const catLabel = asset.category === "pose" ? "姿势" : asset.category === "portrait" ? "人像" : "服装";
      const catColor = asset.category === "pose" ? "#22d3ee" : asset.category === "portrait" ? "#ff6fb5" : "#ffd166";
      item.innerHTML = `
        <div class="ms-asset-item__thumb">
          <img src="${asset.thumbUrl || asset.imageUrl}" alt="${asset.name}" loading="lazy" />
        </div>
        <div class="ms-asset-item__info">
          <span class="ms-asset-item__cat" style="color:${catColor}">${catLabel}</span>
          <strong class="ms-asset-item__name">${asset.name}</strong>
          <small class="ms-asset-item__eyebrow">${asset.eyebrow || asset.kind || ""}</small>
          ${asset.source ? '<small class="ms-asset-item__source">' + asset.source + '</small>' : ''}
        </div>
        <div class="ms-asset-item__actions">
          <button class="ms-asset-item__btn" title="查看大图" data-idx="${idx}" data-action="preview" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
          <button class="ms-asset-item__btn" title="复制图片地址" data-idx="${idx}" data-action="copy" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="ms-asset-item__btn" title="在图片节点使用" data-idx="${idx}" data-action="use" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button class="ms-asset-item__btn ms-asset-item__btn--remove" title="移除此条" data-idx="${idx}" data-action="remove" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"></path></svg>
          </button>
        </div>
      `;

      list.appendChild(item);
    });

    // Delegate click events
    list.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const action = btn.dataset.action;
        const asset = receivedAssets[idx];
        if (!asset) return;
        handleAssetAction(action, asset, idx);
      });
    });

    // Click on thumb/preview
    list.querySelectorAll(".ms-asset-item__thumb").forEach((thumb, idx) => {
      thumb.addEventListener("click", () => {
        const asset = receivedAssets[idx];
        if (asset) showPreview(asset);
      });
    });

    // Drag to canvas: set up drag data on each item
    list.querySelectorAll(".ms-asset-item").forEach(function(item, idx) {
      item.draggable = true;
      item.addEventListener("dragstart", function(e) {
        var asset = receivedAssets[idx];
        if (!asset) return;
        var url = asset.originalUrl || asset.imageUrl;
        e.dataTransfer.setData("text/plain", url);
        e.dataTransfer.setData("text/uri-list", url);
        e.dataTransfer.effectAllowed = "copy";
        var thumb = item.querySelector(".ms-asset-item__thumb img");
        if (thumb && thumb.src) {
          try {
            var dimg = new Image();
            dimg.src = thumb.src;
            dimg.onload = function() {
              e.dataTransfer.setDragImage(dimg, dimg.width/2, dimg.height/2);
            };
          } catch(_) {}
        }
      });
    });
  }

  function handleAssetAction(action, asset, idx) {
    const url = asset.originalUrl || asset.imageUrl;
    switch (action) {
      case "copy":
        try {
          navigator.clipboard.writeText(url).then(() => showToast("图片地址已复制"));
        } catch (_) {
          // Fallback: create a temp input
          const input = document.createElement("input");
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          document.body.removeChild(input);
          showToast("图片地址已复制");
        }
        break;
      case "preview":
        showPreview(asset);
        break;
      case "use":
        // Try to use writeTempUploadFile if available
        useInCanvas(asset);
        break;
      case "remove":
        receivedAssets.splice(idx, 1);
        updateBadge();
        renderPanel();
        break;
    }
  }

  function showPreview(asset) {
    // Simple overlay preview
    let overlay = document.getElementById("ms-asset-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ms-asset-overlay";
      overlay.innerHTML = `
        <div class="ms-asset-overlay__bg"></div>
        <div class="ms-asset-overlay__content">
          <button class="ms-asset-overlay__close" type="button">✕</button>
          <img class="ms-asset-overlay__img" src="" alt="" />
          <div class="ms-asset-overlay__info">
            <strong></strong>
            <small></small>
          </div>
          <div class="ms-asset-overlay__actions">
            <button class="ms-asset-overlay__btn-copy" type="button">复制图片地址</button>
            <button class="ms-asset-overlay__btn-use" type="button">下载到画布</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector(".ms-asset-overlay__bg").addEventListener("click", () => {
        overlay.style.display = "none";
      });
      overlay.querySelector(".ms-asset-overlay__close").addEventListener("click", () => {
        overlay.style.display = "none";
      });
    }

    overlay.querySelector(".ms-asset-overlay__img").src = asset.originalUrl || asset.imageUrl;
    overlay.querySelector(".ms-asset-overlay__img").alt = asset.name;
    overlay.querySelector(".ms-asset-overlay__info strong").textContent = asset.name;
    overlay.querySelector(".ms-asset-overlay__info small").textContent = asset.eyebrow || asset.source || "";
    overlay.querySelector(".ms-asset-overlay__btn-copy").onclick = () => handleAssetAction("copy", asset);
    overlay.querySelector(".ms-asset-overlay__btn-use").onclick = () => { useInCanvas(asset); overlay.style.display = "none"; };
    overlay.style.display = "flex";
  }

  // 尝试获取图片并转为 blob URL 写入画布
  async function useInCanvas(asset) {
    const url = asset.originalUrl || asset.imageUrl;
    if (!url) { showToast('该资产无可用的图片地址', 'error'); return; }

    showToast('正在加载「' + asset.name + '」...');
    try {
      // Fetch image as blob
      const resp = await window.fetch(url, { mode: 'cors' }).catch(() => null);
      if (!resp || !resp.ok) {
        // CORS blocked - try no-cors (opaque, can't use), or fall back to open + copy URL
        showToast('CORS 限制无法直接加载，请复制地址后手动上传', 'error');
        setTimeout(() => {
          navigator.clipboard.writeText(url).catch(() => {});
        }, 500);
        return;
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Find the hidden file input in any visible image action panel and inject the file
      tryInjectToCanvas(blobUrl, blob, asset.name);
    } catch (err) {
      showToast('加载失败：' + (err.message || err), 'error');
    }
  }

  // 尝试将 blob 注入到画布图片节点的 file input
  function tryInjectToCanvas(blobUrl, blob, name) {
    // Find image node action panel file input
    const panel = document.querySelector('.action-panel--image');
    if (!panel) {
      showToast('请先点击画布中的图片节点，再使用资产', 'error');
      return;
    }
    const fileInput = panel.querySelector('input[type="file"]');
    if (!fileInput) {
      showToast('未找到图片上传入口，请复制地址手动操作', 'error');
      return;
    }

    // Create a File from blob and inject into the input
    const ext = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg';
    const file = new File([blob], (name || 'asset') + ext, { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;

    // Dispatch change event so React processes the upload
    const event = new Event('change', { bubbles: true });
    // React listens on the input itself
    Object.defineProperty(event, 'target', { value: fileInput, enumerable: true });
    fileInput.dispatchEvent(event);

    // Fallback: also try native dispatch
    const nativeEvent = new Event('change', { bubbles: true });
    Object.defineProperty(nativeEvent, 'target', { value: fileInput, enumerable: true });
    setTimeout(() => fileInput.dispatchEvent(nativeEvent), 100);

    showToast('已将「' + name + '」注入到图片节点');
  }  let toastTimer = null;
  function showToast(msg, type) {
    let toast = document.getElementById("ms-asset-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-asset-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = "ms-asset-toast" + (type === "error" ? " ms-asset-toast--error" : "");
    toast.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, 2500);
  }

  function showPanel() {
    if (!panelEl) createPanel();
    hideDrawer();
    panelEl.classList.add("is-open");
    panelVisible = true;
  }

  function hidePanel() {
    if (panelEl) panelEl.classList.remove("is-open");
    panelVisible = false;
  }

  // ======= 画布内资产抽屉（iframe 嵌入资产库） =======
  const DRAWER_TAB_LABEL = { poses: "姿势库", costumes: "服装库", portraits: "人像库" };
  let drawerEl = null;
  let drawerFrame = null;
  let drawerTitleEl = null;
  let drawerTab = "poses";
  let drawerVisible = false;
  let drawerFrameReady = false;
  let drawerPendingTab = "";

  function drawerUrl(tab) {
    return GALLERY_URL + "&embed=1&tab=" + encodeURIComponent(tab || "poses");
  }

  function createDrawer() {
    if (drawerEl) return;
    drawerEl = document.createElement("div");
    drawerEl.id = "ms-asset-drawer";
    drawerEl.innerHTML = `
      <div class="ms-asset-drawer__header">
        <span class="ms-asset-drawer__title" id="msDrawerTitle">${DRAWER_TAB_LABEL[drawerTab] || "资产库"}</span>
        <span class="ms-asset-drawer__hint">点「插入画布」直接建节点</span>
        <div class="ms-asset-drawer__actions">
          <button class="ms-asset-drawer__btn" id="msDrawerOpenTab" type="button" title="在独立标签页打开完整资产库">新标签页</button>
          <button class="ms-asset-drawer__btn" id="msDrawerClose" type="button" title="关闭资产抽屉">✕</button>
        </div>
      </div>
      <div class="ms-asset-drawer__body"></div>
    `;
    document.body.appendChild(drawerEl);
    drawerTitleEl = drawerEl.querySelector("#msDrawerTitle");
    drawerEl.querySelector("#msDrawerClose").addEventListener("click", hideDrawer);
    drawerEl.querySelector("#msDrawerOpenTab").addEventListener("click", () => {
      window.open(GALLERY_URL + "&tab=" + encodeURIComponent(drawerTab), "_blank", "noopener");
    });
  }

  function ensureDrawerFrame() {
    if (drawerFrame) return;
    const body = drawerEl.querySelector(".ms-asset-drawer__body");
    const loading = document.createElement("div");
    loading.className = "ms-asset-drawer__loading";
    loading.textContent = "正在载入资产库…";
    body.appendChild(loading);

    drawerFrame = document.createElement("iframe");
    drawerFrame.className = "ms-asset-drawer__frame";
    drawerFrame.title = "资产参考库";
    drawerFrame.addEventListener("load", () => {
      drawerFrameReady = true;
      if (loading.parentNode) loading.remove();
      if (drawerPendingTab && drawerPendingTab !== drawerTab) applyDrawerTab(drawerPendingTab);
      drawerPendingTab = "";
    });
    drawerFrame.src = drawerUrl(drawerTab);
    body.appendChild(drawerFrame);
  }

  function applyDrawerTab(tab) {
    drawerTab = tab;
    if (drawerTitleEl) drawerTitleEl.textContent = DRAWER_TAB_LABEL[tab] || "资产库";
    if (!drawerFrame) return;
    try {
      drawerFrame.contentWindow.postMessage(
        { source: "manshiguang-asset-host", type: "switch-tab", tab },
        window.location.origin,
      );
    } catch (_) {
      drawerFrameReady = false;
      drawerFrame.src = drawerUrl(tab);
    }
  }

  function openDrawer(tab) {
    const next = DRAWER_TAB_LABEL[tab] ? tab : "poses";
    createDrawer();
    if (!drawerFrame) {
      drawerTab = next;
      if (drawerTitleEl) drawerTitleEl.textContent = DRAWER_TAB_LABEL[next];
      ensureDrawerFrame();
    } else if (drawerTab !== next) {
      if (drawerFrameReady) applyDrawerTab(next);
      else {
        drawerTab = next;
        drawerPendingTab = next;
        if (drawerTitleEl) drawerTitleEl.textContent = DRAWER_TAB_LABEL[next];
      }
    }
    drawerEl.classList.add("is-open");
    drawerVisible = true;
    // 抽屉与合成台面板同在右侧，互斥显示，避免互相遮挡。
    hidePanel();
    createPanel();
    renderPanel();
  }

  function hideDrawer() {
    if (!drawerEl) return;
    drawerEl.classList.remove("is-open");
    drawerVisible = false;
  }

  function toggleDrawer(tab) {
    if (drawerVisible && drawerTab === tab) {
      hideDrawer();
      return;
    }
    openDrawer(tab);
  }

  function drawerFileName(name, mimeType) {
    const clean = String(name || "asset")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "asset";
    if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
    const ext = mimeType === "image/png" ? ".png"
      : mimeType === "image/webp" ? ".webp"
      : mimeType === "image/avif" ? ".avif"
      : mimeType === "image/gif" ? ".gif"
      : ".jpg";
    return clean + ext;
  }

  // 复用画布自己的上传入口（侧边栏隐藏 file input），
  // 这样插入的素材与手动「+ → 上传」走完全相同的建节点与落盘流程。
  function injectFileToCanvas(file) {
    const input = document.querySelector('.sidebar input[type="file"][accept^="image"]')
      || document.querySelector('.sidebar input[type="file"]');
    if (!input) return false;
    try {
      const store = new DataTransfer();
      store.items.add(file);
      input.files = store.files;
      const event = new Event("change", { bubbles: true });
      Object.defineProperty(event, "target", { value: input, enumerable: true });
      input.dispatchEvent(event);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function insertAssetToCanvas(asset) {
    const url = asset.originalUrl || asset.imageUrl;
    if (!url) {
      showToast("该资产没有可用图片地址", "error");
      return;
    }
    try {
      const response = await window.fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const blob = await response.blob();
      if (!String(blob.type || "").startsWith("image/")) throw new Error("返回内容不是图片");
      const file = new File([blob], drawerFileName(asset.name, blob.type), { type: blob.type });
      if (!injectFileToCanvas(file)) {
        showToast("已加入合成台，但画布上传入口未就绪，请打开工作流后重试", "error");
        return;
      }
      showToast("已插入「" + (asset.name || "资产") + "」到画布");
    } catch (error) {
      // 远程图源可能被 CORS 拦截：保留在合成台列表，不假装成功。
      showToast("插入画布失败：" + (error.message || error) + "；已保留在合成台", "error");
    }
  }

  function handleEmbedAsset(asset) {
    if (!asset || !asset.imageUrl) return;
    // 去重只针对合成台列表；用户再次点同一张资产说明他想要第二个节点，
    // 因此「插入画布」不受去重影响。
    const dup = receivedAssets.some(
      (item) => item.id === asset.id && item.category === asset.category,
    );
    if (!dup) {
      receivedAssets.unshift(asset);
      if (receivedAssets.length > 20) receivedAssets.length = 20;
      updateBadge();
      createPanel();
      renderPanel();
    }
    insertAssetToCanvas(asset);
  }

  // 宿主（AI 创作工作台）可以显式把资产交给我们，避免消息只在工作台层被丢弃。
  window.__MS_CANVAS_ASSET_HOST__ = {
    version: 1,
    receiveAsset: function (asset) {
      if (!asset || !asset.imageUrl) return false;
      handleEmbedAsset(asset);
      return true;
    },
  };

  function handleHostMessage(event) {
    if (!event || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "manshiguang-asset-embed") return;
    if (data.type === "asset-select") handleEmbedAsset(data.asset);
    else if (data.type === "close-drawer") hideDrawer();
  }

  // ======= 侧边栏按钮注入 =======
  function injectSidebarButton() {
    const sidebar = document.querySelector(ROOT_SEL);
    if (!sidebar) return;
    if (sidebar.querySelector("[data-ms-gallery-btn]")) return;

    const btns = sidebar.querySelectorAll(".sidebar__icon-btn");
    let target = null;
    for (const b of btns) {
      if (b.title === SETTINGS_TITLE) { target = b; break; }
    }
    if (!target) return;

    // 三个资产库入口
    const libs = [
      { tab: "poses", label: "姿势库", icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"></circle><path d="M10 22h4"></path><path d="M10 14h4"></path><path d="m12 14v-5"></path><line x1="8" y1="8" x2="10" y2="8"></line><line x1="14" y1="8" x2="16" y2="8"></line><circle cx="12" cy="22" r="6"></circle></svg>' },
      { tab: "costumes", label: "服装库", icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4m0 0a4 4 0 0 0 4 4h0a4 4 0 0 0 4-4h0a4 4 0 0 0-4-4h0a4 4 0 0 0-4 4Z"></path><path d="M8 10h8v3a8 8 0 0 1-8 0v-3Z"></path><line x1="8" y1="22" x2="16" y2="22"></line></svg>' },
      { tab: "portraits", label: "人像库", icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 4-7 8-7s8 3 8 7"></path></svg>' }
    ];

    let firstBtn = null;
    libs.forEach((lib) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar__icon-btn";
      btn.title = lib.label + "（点击在画布内打开 · Ctrl+点击开新标签页）";
      btn.setAttribute("data-ms-gallery-btn", lib.tab);
      btn.innerHTML = lib.icon;
      btn.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
          window.open(GALLERY_URL + "&tab=" + lib.tab, "_blank", "noopener");
          return;
        }
        toggleDrawer(lib.tab);
      });
      target.parentNode.insertBefore(btn, target);
      if (!firstBtn) firstBtn = btn;
    });

    // Inject badge for received assets on the first button
    firstBtn.style.position = "relative";
    badgeEl = document.createElement("span");
    badgeEl.id = "ms-asset-badge";
    badgeEl.style.display = "none";
    badgeEl.textContent = "0";
    firstBtn.appendChild(badgeEl);

    // Click badge to toggle panel
    badgeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (receivedAssets.length === 0) return;
      if (panelVisible) hidePanel();
      else { showPanel(); renderPanel(); }
    });
  }

  // ======= 注入面板样式 =======
  function injectStyles() {
    if (document.getElementById("ms-asset-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-asset-styles";
    style.textContent = `
      /* 合成台资产面板 */
      #ms-asset-panel {
        position: fixed;
        z-index: 99990;
        right: 0;
        top: 52px;
        bottom: 0;
        width: 320px;
        background: rgba(242, 240, 236, 0.97);
        border-left: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: -8px 0 40px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
      }
      #ms-asset-panel.is-open { transform: translateX(0); }

      .ms-asset-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        flex-shrink: 0;
      }
      .ms-asset-panel__title {
        color: #222;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #333;
        font-size: 13px;
        font-weight: 600;
      }
      .ms-asset-panel__title svg { color: #7c5cff; }
      .ms-asset-panel__actions { display: flex; gap: 6px; }
      .ms-asset-panel__btn {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        background: rgba(0,0,0,0.04);
        color: #666;
        cursor: pointer;
        font-size: 14px;
        transition: 0.15s ease;
      }
      .ms-asset-panel__btn:hover { border-color: rgba(124, 92, 255, 0.5); color: #5a3fd4; background: rgba(124,92,255,0.08); }

      .ms-asset-panel__list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px;
      }
      .ms-asset-panel__list::-webkit-scrollbar { width: 5px; }
      .ms-asset-panel__list::-webkit-scrollbar-thumb { background: rgba(124,92,255,0.25); border-radius: 99px; }

      .ms-asset-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,0.7);
        transition: background 0.15s ease;
      }
      .ms-asset-item:hover { background: rgba(124, 92, 255, 0.15); }
      .ms-asset-item__thumb {
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 8px;
        overflow: hidden;
        background: #17203b;
        cursor: pointer;
      }
      .ms-asset-item__thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .ms-asset-item__info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .ms-asset-item__cat { font-size: 8px; font-weight: 600; letter-spacing: 0.08em; color: #888; }
      .ms-asset-item__name {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: #222;
        font-size: 12px;
        font-weight: 600;
      }
      .ms-asset-item__eyebrow {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: #888;
        font-size: 9px;
      }
      .ms-asset-item__source {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: #3a8fd4;
        font-size: 9px;
        opacity: 0.7;
      }
      .ms-asset-item__actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }
      .ms-asset-item__btn {
        display: grid;
        width: 26px;
        height: 26px;
        place-items: center;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 6px;
        background: transparent;
        color: #666;
        cursor: pointer;
        transition: 0.15s ease;
      }
      .ms-asset-item__btn:hover { border-color: rgba(124, 92, 255, 0.5); color: #5a3fd4; background: rgba(124,92,255,0.08); }

      .ms-asset-item__btn--remove {
        opacity: 0.45;
      }
      .ms-asset-item__btn--remove:hover {
        opacity: 1;
        border-color: rgba(251, 113, 133, 0.6);
        color: #e53e3e;
        background: rgba(251, 113, 133, 0.1);
      }

      .ms-asset-panel__empty { color: #999; }
      .ms-accent { color: #a28dff; }

      /* 画布内资产抽屉 */
      #ms-asset-drawer {
        position: fixed;
        z-index: 99991;
        top: 52px;
        right: 0;
        bottom: 0;
        display: flex;
        width: min(560px, calc(100vw - 96px));
        flex-direction: column;
        border-left: 1px solid rgba(0, 0, 0, 0.12);
        background: #f2f1ef;
        box-shadow: -10px 0 44px rgba(0, 0, 0, 0.18);
        transform: translateX(100%);
        transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: \"Noto Sans SC\", \"Microsoft YaHei\", sans-serif;
      }
      #ms-asset-drawer.is-open { transform: translateX(0); }

      .ms-asset-drawer__header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px 14px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.72);
      }
      .ms-asset-drawer__title {
        color: #5a3fd4;
        font-size: 13px;
        font-weight: 700;
      }
      .ms-asset-drawer__hint {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: #999;
        font-size: 10px;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .ms-asset-drawer__actions { display: flex; gap: 6px; }
      .ms-asset-drawer__btn {
        padding: 5px 10px;
        border: 1px solid rgba(107, 76, 217, 0.28);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.7);
        color: #6b6b8a;
        font-size: 11px;
        cursor: pointer;
        transition: 0.16s;
      }
      .ms-asset-drawer__btn:hover {
        border-color: rgba(124, 92, 255, 0.55);
        background: rgba(124, 92, 255, 0.1);
        color: #5a3fd4;
      }

      .ms-asset-drawer__body { position: relative; flex: 1; min-height: 0; }
      .ms-asset-drawer__frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #f2f1ef;
      }
      .ms-asset-drawer__loading {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #999;
        font-size: 12px;
      }

      /* 角标 */
      #ms-asset-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        display: grid;
        width: 16px;
        height: 16px;
        place-items: center;
        border-radius: 50%;
        background: #ff6fb5;
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 0 8px rgba(255,111,181,0.5);
        cursor: pointer;
      }

      /* Toast */
      #ms-asset-toast {
        position: fixed;
        z-index: 99999;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 20px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(124, 92, 255, 0.3);
        color: #333;
        font-size: 12px;
        font-weight: 500;
        backdrop-filter: blur(12px);
        display: none;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }
      #ms-asset-toast.ms-asset-toast--error {
        border-color: rgba(229, 62, 62, 0.4);
        color: #b91c1c;
      }

      /* 大图预览遮罩 */
      #ms-asset-overlay {
        position: fixed;
        z-index: 99995;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
      }
      .ms-asset-overlay__bg {
        position: absolute;
        inset: 0;
        background: rgba(2, 5, 14, 0.88);
        backdrop-filter: blur(8px);
      }
      .ms-asset-overlay__content {
        position: relative;
        z-index: 1;
        max-width: min(90vw, 800px);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 24px;
      }
      .ms-asset-overlay__close {
        position: absolute;
        top: 0;
        right: 0;
        width: 36px;
        height: 36px;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 50%;
        background: rgba(11,17,34,0.9);
        color: #99a4c5;
        cursor: pointer;
        font-size: 16px;
        display: grid;
        place-items: center;
        transition: 0.15s;
      }
      .ms-asset-overlay__close:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
      .ms-asset-overlay__img {
        max-width: 100%;
        max-height: 65vh;
        object-fit: contain;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .ms-asset-overlay__info {
        text-align: center;
        color: #333;
      }
      .ms-asset-overlay__info strong { display: block; font-size: 15px; }
      .ms-asset-overlay__info small { display: block; margin-top: 4px; font-size: 11px; color: #99a4c5; }
      .ms-asset-overlay__actions {
        display: flex;
        gap: 10px;
      }
      .ms-asset-overlay__btn-copy,
      .ms-asset-overlay__btn-use {
        padding: 9px 18px;
        border: 1px solid rgba(124, 92, 255, 0.4);
        border-radius: 10px;
        background: rgba(124, 92, 255, 0.15);
        color: #a28dff;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: 0.15s;
      }
      .ms-asset-overlay__btn-copy:hover,
      .ms-asset-overlay__btn-use:hover {
        border-color: rgba(124, 92, 255, 0.7);
        background: rgba(124, 92, 255, 0.28);
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  // ======= 初始化 =======


  // 全局拖放目标：监听 drop 事件，注入到图片节点
  function setupDropTarget() {
    document.addEventListener("dragover", function(e) {
      // Only allow drop when dragging an asset URL from the gallery panel
      // Don't interfere with canvas native drop handling
      var dt = e.dataTransfer;
      if (!dt) return;
      var types = dt.types || [];
      var isAssetUrl = types.includes("text/uri-list") || types.includes("text/plain");
      if (isAssetUrl) {
        // Check if target is inside gallery panel - if so, allow; otherwise skip
        var target = e.target;
        var inAssetPanel = false;
        while (target) {
          if (target.id === "ms-asset-panel" || target.closest && target.closest("#ms-asset-panel")) {
            inAssetPanel = true;
            break;
          }
          target = target.parentElement;
        }
        // Only prevent default when dragging from asset panel
        if (inAssetPanel) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }
    });

    document.addEventListener("drop", async function(e) {
      var url = "";
      if (e.dataTransfer) {
        url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      }
      if (!url) return;
      if (!url.match(/^https?:\/\//i)) return;

      e.preventDefault();
      e.stopPropagation();

      showToast("正在加载拖入的图片...");
      try {
        var resp = await window.fetch(url, { mode: "cors" }).catch(function(){ return null; });
        if (!resp || !resp.ok) {
          showToast("CORS 限制无法加载，已复制地址到剪贴板", "error");
          navigator.clipboard.writeText(url).catch(function(){});
          return;
        }
        var blob = await resp.blob();
        var blobUrl = URL.createObjectURL(blob);

        // Find image node panel and inject file
        var panel = document.querySelector(".action-panel--image");
        if (!panel) {
          showToast("请先打开图片节点面板，再拖入资产", "error");
          return;
        }
        var fileInput = panel.querySelector('input[type="file"]');
        if (!fileInput) {
          showToast("未找到图片上传入口", "error");
          return;
        }

        var ext = blob.type === "image/png" ? ".png" : blob.type === "image/webp" ? ".webp" : ".jpg";
        var file = new File([blob], "asset" + ext, { type: blob.type });
        var dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        var ev = new Event("change", { bubbles: true });
        Object.defineProperty(ev, "target", { value: fileInput, enumerable: true });
        fileInput.dispatchEvent(ev);
        setTimeout(function() {
          var ev2 = new Event("change", { bubbles: true });
          Object.defineProperty(ev2, "target", { value: fileInput, enumerable: true });
          fileInput.dispatchEvent(ev2);
        }, 100);

        showToast("已注入到图片节点");
      } catch (err) {
        showToast("加载失败：" + (err.message || err), "error");
      }
    });
  }
  function init() {
    injectStyles();
    ensureChannel();
    setupDropTarget();
    window.addEventListener("message", handleHostMessage);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !drawerVisible) return;
      // 只在输入类元素里按 Esc 时不关抽屉；画布节点、React Flow 面板等
      // 获得焦点时 event.target 不是 body，早期写法会误判成「正在输入」。
      const target = event.target;
      if (target && typeof target.closest === "function"
        && target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
        return;
      }
      hideDrawer();
    });

    const root = document.getElementById("root") || document.documentElement;
    new MutationObserver(injectSidebarButton).observe(root, { childList: true, subtree: true });
    injectSidebarButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();