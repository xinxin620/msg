(() => {
  "use strict";

  // 画布压缩包 bundle 把「视频」的入口裁掉了：侧栏「+」只剩 文本 / 图片 / 上传，
  // 画布右键「添加节点」只剩 文本 / 图片生成。但 bundle 内部的视频能力其实是完整的
  // —— category "video" 会渲染成 .canvas-node--video（播放占位 + 比例/清晰度角标），
  // 结果落盘、历史记录、连线规则、工作流导入导出都已支持，原生 addNode 只是对
  // video/audio 直接 return。
  //
  // 因此本补丁只做两件事：把「视频」补回两处菜单，并用画布自己的 store 建节点。
  // 不修改压缩 bundle，也不依赖其它补丁的内部实现。

  const LABEL = "视频";
  const UPLOAD_ITEM_TEXT = "上传";
  const SIDEBAR_ADD_TITLE = "添加节点";
  const DROPDOWN_SEL = ".sidebar__dropdown";
  const SUBMENU_SEL = ".canvas-context-menu__submenu";

  // 与 bundle 里 y_(q.Video) / b_() 的默认节点形状保持一致（veo3fast 的字段默认值
  // 就是 aspectRatio 16:9 + videoDuration 8s），不多塞原生不会写的字段。
  const DEFAULT_VIDEO_DATA = {
    label: "Video",
    category: "video",
    status: "idle",
    activeResultIndex: 0,
    videoModelId: "veo3fast",
    vendorId: "zhenzhen",
    aspectRatioMode: "fixed",
    aspectRatioUserSelected: false,
    aspectRatio: "16:9",
    videoDuration: "8s",
  };

  const VIDEO_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"></path><rect width="14" height="12" x="1" y="6" rx="2" ry="2"></rect></svg>';

  let seq = 0;
  let lastPointer = null;
  let toastTimer = null;
  let connectSourceId = null;

  function trimText(el) {
    return (el && el.innerText ? el.innerText : "").replace(/\s+/g, " ").trim();
  }

  function showToast(message, type) {
    let toast = document.getElementById("ms-video-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ms-video-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle("is-error", type === "error");
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
  }

  // ======= 取画布 store =======
  function isCanvasState(state) {
    return !!state && typeof state === "object"
      && Array.isArray(state.nodes) && Array.isArray(state.edges)
      && typeof state.replaceCanvasState === "function";
  }

  function findCanvasStore() {
    // fiber 里可能同时有「活快照读取器」(getSnapshot，每次返回最新 state) 与
    // 某组件 useState 残留的「冻结 state 对象」。冻结对象不随 updateNodeData 更新，
    // 先返回它就把新生成的 results 永远读成空（刷新才恢复）。故优先活读取器，
    // 冻结对象只作全树都没有活读取器时的兜底。
    let fallbackReader = null;
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
    const startFiber = containerKey ? rootEl[containerKey] : null;
    if (!startFiber) return null;

    const stack = [startFiber];
    const seen = new Set();
    let visited = 0;

    while (stack.length && visited < 200000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      visited += 1;

      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard++ < 400) {
        const candidates = [hook.memoizedState, hook.queue && hook.queue.lastRenderedState];
        for (const cand of candidates) {
          if (!cand || typeof cand !== "object" || Array.isArray(cand)) continue;
          if (typeof cand.getSnapshot === "function") {
            let latest = null;
            try { latest = cand.getSnapshot(); } catch (_) { latest = null; }
            if (isCanvasState(latest)) {
              return () => {
                try { const v = cand.getSnapshot(); return isCanvasState(v) ? v : null; } catch (_) { return null; }
              };
            }
            continue;
          }
          if (isCanvasState(cand) && !fallbackReader) fallbackReader = () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return fallbackReader;
  }

  // ======= 强制 React Flow 测量节点 =======
  // 根因：补丁用 replaceCanvasState（导入工作流的方式）建节点，React Flow 的
  // nodeLookup 里该节点 internals.handleBounds 为空，拖线时 Fl() 找不到它的
  // handle，连线在到达 isValidConnection 之前就被判无效——所以刷新前连不上、
  // 刷新后（走正常初始化被测量）才连得上。修复：建节点后调用 React Flow 的
  // updateNodeInternals 强制测量。React Flow 的 store 同样是模块私有，从 fiber 取。
  function findReactFlowStore() {
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith("__reactContainer$"));
    const startFiber = containerKey ? rootEl[containerKey] : null;
    if (!startFiber) return null;

    const isRFState = s => !!s && typeof s === "object"
      && s.nodeLookup instanceof Map && typeof s.updateNodeInternals === "function";

    // zustand store 实例（有 getState）：活读取器。
    // 注意 store 本体是**函数**（create() 返回可调用对象，挂 getState/setState），
    // typeof 判 "object" 会把它整个拒掉 → 永远找不到 store（centerViewport
    // 一直返回 false、导航框拖不动画布的真正根因，2026-11-20 浏览器实测）。
    const asStore = cand => {
      if (!cand || (typeof cand !== "object" && typeof cand !== "function") || typeof cand.getState !== "function") return null;
      try {
        if (!isRFState(cand.getState())) return null;
        return () => { try { return isRFState(cand.getState()) ? cand.getState() : null; } catch (_) { return null; } };
      } catch (_) { return null; }
    };

    const stack = [startFiber];
    const seen = new Set();
    let visited = 0;
    while (stack.length && visited < 200000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      visited += 1;

      // ReactFlowProvider 把 store 放在 context 的 memoizedProps.value 上
      const propVal = fiber.memoizedProps && fiber.memoizedProps.value;
      const r = asStore(propVal);
      if (r) return r;

      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard++ < 400) {
        const candidates = [hook.memoizedState, hook.queue && hook.queue.lastRenderedState];
        for (const cand of candidates) {
          if (!cand || (typeof cand !== "object" && typeof cand !== "function") || Array.isArray(cand)) continue;
          const s = asStore(cand);
          if (s) return s;
          if (typeof cand.getSnapshot === "function") {
            try { if (isRFState(cand.getSnapshot())) return () => { try { return isRFState(cand.getSnapshot()) ? cand.getSnapshot() : null; } catch (_) { return null; } }; } catch (_) {}
            continue;
          }
          if (isRFState(cand)) return () => cand;
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  }

  function forceMeasureNode(nodeId) {
    const getRF = findReactFlowStore();
    if (!getRF) return false;
    const rf = getRF();
    if (!rf || typeof rf.updateNodeInternals !== "function") return false;
    const nodeEl = document.querySelector('.react-flow__node[data-id="' + nodeId + '"]');
    if (!nodeEl) return false;
    try {
      rf.updateNodeInternals(new Map([[nodeId, { id: nodeId, nodeElement: nodeEl, force: true }]]));
      return true;
    } catch (_) { return false; }
  }

  // 新节点 DOM 渲染需要时间，多次延迟重试直到测量成功
  function measureNodeWithRetry(nodeId) {
    let tries = 0;
    const tick = () => {
      if (forceMeasureNode(nodeId)) return;
      if (++tries < 25) window.setTimeout(tick, 120);
    };
    tick();
  }

  // ======= 建视频节点 =======
  function randomPosition() {
    return { x: 200 + Math.random() * 400, y: 100 + Math.random() * 300 };
  }

  function flowPositionFromPointer() {
    if (!lastPointer) return null;
    const host = document.querySelector(".react-flow");
    if (!host || typeof host.getBoundingClientRect !== "function") return null;
    const rect = host.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;

    const read = findCanvasStore();
    const state = read ? read() : null;
    const vp = state && state.viewport;
    const zoom = vp && Number.isFinite(vp.zoom) && vp.zoom > 0 ? vp.zoom : 1;
    const offsetX = vp && Number.isFinite(vp.x) ? vp.x : 0;
    const offsetY = vp && Number.isFinite(vp.y) ? vp.y : 0;
    return {
      x: (lastPointer.x - rect.left - offsetX) / zoom,
      y: (lastPointer.y - rect.top - offsetY) / zoom,
    };
  }

  // 「+」小球建节点后补连线：优先原生 onConnect（进撤销栈、随工作流存盘）；
  // 被校验静默拒绝时回读 edges，失败再手动塞边兜底，并给可见提示。
  function connectFromNode(sourceId, targetId) {
    if (!sourceId || !targetId) return false;
    const read = findCanvasStore();
    const hasEdge = () => {
      const st = read ? read() : null;
      return !!(st && Array.isArray(st.edges) && st.edges.some(e => e && e.source === sourceId && e.target === targetId));
    };
    const st = read ? read() : null;
    if (st && typeof st.onConnect === "function") {
      try { st.onConnect({ source: sourceId, sourceHandle: null, target: targetId, targetHandle: null }); }
      catch (error) { console.warn("[漫书] 自动连线(onConnect)异常", error); }
      if (hasEdge()) return true;
    }
    const st2 = read ? read() : null;
    if (!st2) { showToast("自动连线失败：画布状态不可用。", "error"); return false; }
    const edge = {
      id: "ms-edge-" + sourceId + "-" + targetId + "-" + Date.now().toString(36),
      source: sourceId, sourceHandle: null, target: targetId, targetHandle: null,
      type: "default", animated: false, selected: false,
    };
    try { st2.replaceCanvasState(st2.nodes, (st2.edges || []).concat(edge), st2.groups || []); }
    catch (error) { console.warn("[漫书] 自动连线(兜底)异常", error); }
    if (hasEdge()) {
      const fresh = read ? read() : null;
      if (fresh && typeof fresh.setSelectedNode === "function") { try { fresh.setSelectedNode(targetId); } catch (_) {} }
      return true;
    }
    showToast("自动连线未生效：这两个节点类型之间不允许连接。", "error");
    return false;
  }

  // 坐标硬保险：{x:NaN} 是真值，|| randomPosition() 兜不住它，必须显式校验有限，
  // 否则建出 NaN 坐标节点 → onlyRenderVisibleElements 下小地图整块变黑、视口看不见。
  function safePosition(pos) {
    if (pos) {
      const x = Number(pos.x), y = Number(pos.y);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7) {
        return { x, y };
      }
    }
    return randomPosition();
  }

  // 把新节点放到源节点右侧：源节点本来就在视野里，紧邻它落点必然可见，
  // 也正好是你拖出「+」菜单松手的结束位置。store 读不到坐标才退回鼠标→随机。
  function positionNearSource(sourceId) {
    if (sourceId) {
      const read = findCanvasStore();
      const st = read ? read() : null;
      const src = st && Array.isArray(st.nodes) ? st.nodes.find(n => n && n.id === sourceId) : null;
      if (src) {
        const p = src.positionAbsolute || src.position || {};
        const px = Number(p.x), py = Number(p.y);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          const m = src.measured || {};
          const w = Number.isFinite(Number(m.width)) ? Number(m.width) : Number(src.width) || 260;
          return { x: px + w + 120, y: py };
        }
      }
    }
    return safePosition(flowPositionFromPointer());
  }

  function addVideoNode(useFlowPosition, connectFromId) {
    const read = findCanvasStore();
    const state = read ? read() : null;
    if (!state) {
      showToast("视频节点创建失败：未能接入画布状态，请刷新页面后重试。", "error");
      return false;
    }

    seq += 1;
    // 新建默认模型：跟随当前启用卡勾选的第一个模型，不再写死 veo3fast。
    const av = window.__MS_VIDEO_API__;
    const defaultModel = (av && ((av.videoModels && av.videoModels[0]) || av.model)) || DEFAULT_VIDEO_DATA.videoModelId;
    const position = connectFromId ? positionNearSource(connectFromId)
      : (useFlowPosition ? flowPositionFromPointer() : null);
    const node = {
      id: "msvideo_" + Date.now().toString(36) + "_" + seq,
      type: "canvasNode",
      position: safePosition(position),
      data: Object.assign({}, DEFAULT_VIDEO_DATA, { videoModelId: defaultModel }),
    };
    // connect 菜单（拖「+」小球松手）要「建节点 + 连一条源→新节点的边」。
    // 必须与节点在同一次 replaceCanvasState 里原子写入：若先写节点、再单独走
    // connectFromNode 补边，那一步会用 fiber 现读到的「上一帧快照」整体回写，
    // 新节点还没进那一帧 → 边留下、节点被抹掉（表现为「点了没反应」）。
    // 边只在源类别确实能连入视频时才连（源节点已在入口快照里，读得到）。
    let edge = null;
    if (connectFromId) {
      const src = (state.nodes || []).find(n => n && n.id === connectFromId);
      const cat = src && src.data && src.data.category;
      const ok = cat === "text" || cat === "image" || cat === "audio"
        || (cat === "upload" && uploadIsImage(src));
      if (ok) {
        edge = {
          id: "ms-edge-" + connectFromId + "-" + node.id + "-" + Date.now().toString(36),
          source: connectFromId, sourceHandle: null, target: node.id, targetHandle: null,
          type: "default", animated: false, selected: false,
        };
      }
    }

    try {
      state.replaceCanvasState(
        state.nodes.concat(node),
        edge ? (state.edges || []).concat(edge) : state.edges,
        state.groups || []
      );
    } catch (error) {
      console.error("[漫时光] 视频节点创建失败", error);
      showToast("视频节点创建失败：" + ((error && error.message) || "未知错误"), "error");
      return false;
    }

    // 关键修复：replaceCanvasState 建的节点不会被 React Flow 测量 handleBounds，
    // 必须强制测量，否则拖线找不到该节点的连接点，连线在到达 isValidConnection
    // 之前就被判无效（表现为新建连不上、刷新后正常）。
    measureNodeWithRetry(node.id);

    // 与原生 addNode 一样，新节点直接进入选中态
    window.requestAnimationFrame(() => {
      const fresh = read();
      if (fresh && typeof fresh.setSelectedNode === "function") {
        try { fresh.setSelectedNode(node.id); } catch (_) { /* 选中失败不影响节点已创建 */ }
      }
    });

    scrollNodeIntoView(node.id);
    showToast("已添加视频节点", "success");
    return true;
  }

  // ======= 注入菜单项 =======
  function nativeItems(container) {
    return [...container.querySelectorAll("button")].filter(btn => !btn.hasAttribute("data-ms-video-item"));
  }

  function pushUploadBack(container) {
    for (const btn of nativeItems(container)) {
      if (trimText(btn) === UPLOAD_ITEM_TEXT) {
        btn.style.order = "10";
        return true;
      }
    }
    return false;
  }

  function appendVideoItem(container, onClick, opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts.className;
    btn.setAttribute("data-ms-video-item", "1");
    btn.innerHTML = VIDEO_ICON + "<span>" + LABEL + "</span>";
    btn.style.order = "5";
    if (opts.gap) {
      btn.style.gap = "8px";
      btn.style.justifyContent = "flex-start";
    }
    btn.addEventListener("click", event => {
      event.stopPropagation();
      event.preventDefault();
      onClick();
    });
    if (opts.pushUpload) pushUploadBack(container);
    container.appendChild(btn);
  }

  function patchSidebarDropdown() {
    for (const dropdown of [...document.querySelectorAll(DROPDOWN_SEL)]) {
      if (dropdown.querySelector("[data-ms-video-item]")) continue;
      const items = nativeItems(dropdown);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVideoItem(dropdown, () => {
        closeSidebarDropdown();
        addVideoNode(true);
      }, { className: "sidebar__dropdown-item", pushUpload: true });
    }
  }

  function patchContextSubmenu() {
    for (const submenu of [...document.querySelectorAll(SUBMENU_SEL)]) {
      if (submenu.querySelector("[data-ms-video-item]")) continue;
      const items = nativeItems(submenu);
      if (!items.length) continue;
      if (items.some(btn => trimText(btn) === LABEL)) continue;
      appendVideoItem(submenu, () => {
        addVideoNode(true);
        closeContextMenu();
      }, { className: "canvas-context-menu__item", gap: true });
    }
  }

  // 节点右侧「+」小球拖出的是 connect 菜单：子项直接挂在 .canvas-context-menu 上，
  // 原生点击走 addConnectedNode，而 bundle 对 Video 直接 return，故自建节点并补连线。
  function patchConnectMenu() {
    for (const menu of [...document.querySelectorAll(".canvas-context-menu")]) {
      if (menu.querySelector("[data-ms-video-item]")) continue;
      if (menu.querySelector(".canvas-context-menu__submenu")) continue;
      const direct = [...menu.querySelectorAll(":scope > .canvas-context-menu__item")];
      if (!direct.some(b => trimText(b) === "图片生成")) continue;
      appendVideoItem(menu, () => {
        addVideoNode(true, connectSourceId);
        closeContextMenu();
      }, { className: "canvas-context-menu__item", gap: true });
    }
  }

  function closeSidebarDropdown() {
    const btn = [...document.querySelectorAll(".sidebar__icon-btn")].find(b => b.title === SIDEBAR_ADD_TITLE);
    if (!btn) return;
    const section = btn.closest(".sidebar__section");
    if (!section) return;
    section.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
    section.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: false }));
  }

  function closeContextMenu() {
    const menu = document.querySelector(".canvas-context-menu");
    if (!menu) return;
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  // ======= 让视频 / 音频节点可以连线 =======
  // bundle 私有类别能力表 yt 把 video 与 audio 都裁成 acceptsInput:[] / canOutputTo:[]，
  // 两者都是孤岛；音频节点渲染的 handle 与视频是同一段代码（左 target、右 source），
  // 所以拖线物理上可行，缺的只是这里放行。放行规则集中在本补丁，其它补丁不再各自包装。
  const PATCH_FLAG = "__msVideoConnectPatch";
  const RF_PATCH_FLAG = "__msVideoRfPatch";
  const INNER_FLAG = "__msVideoInner";
  const VIDEO_CATEGORY = "video";
  const AUDIO_CATEGORY = "audio";
  // comfy 不在 bundle 连线矩阵 yt 内，且共享校验器在允许 target 不是 video/audio 时
  // 直接 return false；ComfyUI 节点要连线必须在这里放行（音频补丁同此约定）。
  const COMFY_CATEGORY = "comfy";
  // 视频工作流常需多参考图 + 参考音色 + 参考视频，四类媒体都能连入 comfy 节点（运行时按类型注入加载节点）
  const ALLOW_INTO_COMFY = ["text", "image", "audio", "video"];
  const ALLOW_OUT_OF_COMFY = ["image", "video"];
  // 音频也放行（用户要求）：注意 bundle 的视频请求体没有任何字段能承载音频/音色
  // （全库 audio_url / driving_audio / lip_sync / mixAudio 命中 0 处），连上的真实作用是
  // ①工作流拓扑可见 ②executeNode 会先跑上游音频 ③音频卡片的配音文稿可由视频卡片并入提示词。
  const ALLOW_INTO_VIDEO = ["text", "image", "upload", "audio"];
  // 音频生成只读上游文本（qv 的 upstreamTexts 进请求体 text），放行图片进音频就是伪功能
  const ALLOW_INTO_AUDIO = ["text"];

  function uploadIsImage(node) {
    return !!node && node.data && node.data.assetType === "image";
  }

  function wouldCycle(edges, fromId, toId) {
    const map = new Map();
    for (const edge of edges || []) {
      if (!edge || !edge.source || !edge.target) continue;
      if (!map.has(edge.source)) map.set(edge.source, []);
      map.get(edge.source).push(edge.target);
    }
    const seen = new Set();
    const stack = [toId];
    while (stack.length) {
      const id = stack.pop();
      if (!id) continue;
      if (id === fromId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const next = map.get(id);
      if (next) stack.push(...next);
    }
    return false;
  }

  function allowsConnection(connection, state) {
    if (!connection || !connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;
    const source = state.nodes.find(n => n.id === connection.source);
    const target = state.nodes.find(n => n.id === connection.target);
    if (!source || !target) return false;
    if (target.data.category === COMFY_CATEGORY) {
      // 连入 comfy：文本/图/音/视 + 任意上传节点（图/音/视素材，运行时按类型注入对应加载节点）
      if (!ALLOW_INTO_COMFY.includes(source.data.category)
        && source.data.category !== "upload") return false;
      return !wouldCycle(state.edges, connection.target, connection.source);
    }
    if (source.data.category === COMFY_CATEGORY) {
      if (!ALLOW_OUT_OF_COMFY.includes(target.data.category)) return false;
      return !wouldCycle(state.edges, connection.target, connection.source);
    }
    if (target.data.category === VIDEO_CATEGORY) {
      if (source.data.category === "upload" && !uploadIsImage(source)) return false;
      if (!ALLOW_INTO_VIDEO.includes(source.data.category)) return false;
    } else if (target.data.category === AUDIO_CATEGORY) {
      if (!ALLOW_INTO_AUDIO.includes(source.data.category)) return false;
    } else {
      return false;
    }
    return !wouldCycle(state.edges, connection.target, connection.source);
  }

  // 放行校验器：每次调用都重新遍历 fiber 取最新 state。
  // 关键：findCanvasStore 的静态快照路径 () => cand 会冻结在 patch 那一刻的
  // state 对象上；新建视频节点后 replaceCanvasState 生成了新 state 对象，
  // 若沿用 patch 时缓存的闭包，latest.nodes 里查不到新节点 → 放行失败 →
  // 表现为「新建连不上、刷新后才连得上」。每次现取即可拿到最新 nodes。
  function makeWrapper(original) {
    return connection => {
      const getFresh = findCanvasStore();
      const latest = getFresh ? getFresh() : null;
      const allowed = latest && allowsConnection(connection, latest);
      const result = allowed ? true : original(connection);
      if (window.__MS_VIDEO_DEBUG__ !== false && connection && connection.source && connection.target) {
        const src = latest && latest.nodes.find(n => n.id === connection.source);
        const tgt = latest && latest.nodes.find(n => n.id === connection.target);
        console.log(`[MS-IVC] ${src && src.data.category}#${connection.source} → ${tgt && tgt.data.category}#${connection.target} | allows=${allowed} | result=${result}`);
      }
      return result;
    };
  }

  // React Flow 内部 store 的 isValidConnection 是组件渲染时从 prop 同步进来的，
  // 拖线实时校验读的是它，而不是画布 store。必须直接写进 RF store 才生效。
  function patchReactFlowStore(wrapper) {
    const getRF = findReactFlowStore();
    if (!getRF) return false;
    const rf = getRF();
    if (!rf || typeof rf.setState !== "function") return false;
    if (rf[RF_PATCH_FLAG]) return true;
    rf[RF_PATCH_FLAG] = true;
    try { rf.setState({ isValidConnection: wrapper }); } catch (_) { return false; }
    return true;
  }

  // ===== 核心修复：patchConnectivity（幂等版）=====
  // setSelectedNode 会强制 zustand set → 新 state → React 重渲染。
  // 本函数被 MutationObserver 经 scheduleSync 每帧反复调用，若每次都
  // setSelectedNode，就会在拖拽节点途中不断打断 d3-drag 的指针捕获，
  // 表现为「光标是小手、按住文本节点却拖不动」。故：校验器已是本补丁
  // 包装且 RF store 仍持有它时直接返回，绝不 setState。
  let connectivityWrapper = null;
  function patchConnectivity(state) {
    if (!state) {
      const read = findCanvasStore();
      state = read ? read() : null;
    }
    if (!state || typeof state.isValidConnection !== "function") return false;

    const getRF = findReactFlowStore();
    const rf = getRF ? getRF() : null;
    const alreadyInPlace = !!connectivityWrapper
      && state.isValidConnection === connectivityWrapper
      && rf && rf.isValidConnection === connectivityWrapper;
    if (alreadyInPlace) {
      ensureDraggable();   // 不打扰重渲染，仅顺带确认没被别处关成不可拖
      return true;
    }

    const read = findCanvasStore();
    let original = state.isValidConnection;
    // 若当前值已是本补丁的包装（上一轮快照），取其内部原函数，避免层层套娃
    if (original[INNER_FLAG]) original = original[INNER_FLAG];

    const wrapper = makeWrapper(original);
    wrapper[INNER_FLAG] = original;
    state[PATCH_FLAG] = true;
    try { state.isValidConnection = wrapper; } catch (_) {}

    // 同步写进 React Flow 内部 store（拖线校验真正读取的位置）
    patchReactFlowStore(wrapper);
    connectivityWrapper = wrapper;

    // 仅首次接管时触发一次重渲染，让 RF 组件把校验器同步进内部 store；
    // 之后靠上面的幂等短路，不再打扰拖拽。
    try {
      if (typeof state.setSelectedNode === "function") {
        state.setSelectedNode(state.selectedNodeId ?? null);
      }
    } catch (_) {}

    return true;
  }

  // ======= 样式 =======
  function injectStyles() {
    if (document.getElementById("ms-video-node-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-video-node-styles";
    style.textContent = [
      "#ms-video-toast{position:fixed;z-index:99995;left:50%;bottom:34px;transform:translate(-50%,12px);max-width:70vw;padding:9px 18px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:rgba(31,31,31,.92);color:#f2f0ec;font-family:\"Noto Sans SC\",\"Microsoft YaHei\",sans-serif;font-size:12.5px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}",
      "#ms-video-toast.is-visible{opacity:1;transform:translate(-50%,0)}",
      "#ms-video-toast.is-error{background:rgba(180,35,24,.94);color:#fff}",
      // bundle 子菜单 left:calc(100%+4px)：父菜单与子菜单间有 4px 悬空缝隙，
      // 鼠标慢速横穿时采样落进缝隙 → 包裹 div 触发 mouseleave → 子菜单消失；
      // 快速划过采样跳过缝隙则没事（表现为「时好时坏」）。给子菜单补一条
      // 不可见 hover 桥盖住缝隙：伪元素属于子菜单，指针压上仍算在其内。
      ".canvas-context-menu__submenu::before{content:\"\";position:absolute;top:0;bottom:0;left:-12px;width:12px}",
    ].join("");
    document.head.appendChild(style);
  }

  // ======= 初始化 =======
  let queued = false;
  // React Flow 内部 store 的 nodesDraggable 可能被置 false（Controls 交互开关
  // 或重渲染副作用），表现为鼠标变手却拖不动节点。发现即强制恢复。
  function ensureDraggable() {
    const getRF = findReactFlowStore();
    if (!getRF) return;
    const rf = getRF();
    if (!rf || typeof rf.setState !== "function") return;
    if (rf.nodesDraggable === false || rf.nodesConnectable === false || rf.elementsSelectable === false) {
      try { rf.setState({ nodesDraggable: true, nodesConnectable: true, elementsSelectable: true }); } catch (_) {}
    }
  }

  function sync() {
    ensureDraggable();
    patchSidebarDropdown();
    patchContextSubmenu();
    patchConnectMenu();
    patchConnectivity();
  }

  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; sync(); });
  }

  function init() {
    injectStyles();
    document.addEventListener("contextmenu", event => {
      lastPointer = { x: event.clientX, y: event.clientY };
    }, true);
    document.addEventListener("pointermove", ev => { lastPointer = { x: ev.clientX, y: ev.clientY }; }, true);
    document.addEventListener("pointerdown", ev => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const n = t.closest(".react-flow__node");
      if (n && n.dataset && n.dataset.id) connectSourceId = n.dataset.id;
    }, true);

    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });

  // hover 展开二级菜单后补一次注入：React 重渲染会抹掉追加的按钮
  document.addEventListener("mouseover", ev => {
    if (!ev.target || !ev.target.closest || !ev.target.closest(".canvas-context-menu__item.has-submenu, .sidebar__icon-btn")) return;
    scheduleSync();
    setTimeout(scheduleSync, 120);
    setTimeout(scheduleSync, 320);
  }, true);

    sync();
    startHealthWatch();
  }

  // 找回坐标坏掉的节点：bundle 开了 onlyRenderVisibleElements，坐标为 NaN/Infinity
  // 或离谱远的节点会让整块小地图变黑、视口 transform 被污染（表现为「画布东西都看不见」）。
  // 节点并没被删，只是坐标坏了。本函数只搬「坏坐标」节点，正常节点一律不碰，
  // 把它们重新排到现有正常节点簇旁边。控制台调用：__MS_VIDEO_NODE_PATCH__.rescueNodes()
  function rescueNodes() {
    const read = findCanvasStore();
    const st = read ? read() : null;
    if (!st || !Array.isArray(st.nodes)) { console.warn("[漫书] 找回失败：读不到画布状态"); return null; }
    const isBad = pos => {
      if (!pos) return true;
      const x = Number(pos.x), y = Number(pos.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
      return Math.abs(x) > 1e7 || Math.abs(y) > 1e7;
    };
    const good = st.nodes.filter(n => n && !isBad(n.positionAbsolute || n.position));
    let baseX = 0, baseY = 0;
    if (good.length) {
      baseX = good.reduce((a, n) => a + Number((n.positionAbsolute || n.position || {}).x || 0), 0) / good.length;
      baseY = good.reduce((a, n) => a + Number((n.positionAbsolute || n.position || {}).y || 0), 0) / good.length;
    }
    let col = 0;
    const fixed = st.nodes.map(n => {
      if (!n || !isBad(n.positionAbsolute || n.position)) return n;
      const node = { ...n, position: { x: baseX + 360 + (col % 4) * 320, y: baseY + Math.floor(col / 4) * 220 } };
      col += 1;
      return node;
    });
    if (!col) { console.log("[漫书] 没有坐标坏掉的节点，无需找回。"); return { rescued: 0 }; }
    try { st.replaceCanvasState(fixed, st.edges || [], st.groups || []); }
    catch (error) { console.warn("[漫书] 找回写回失败", error); return null; }
    console.log("[漫书] 已找回 " + col + " 个坐标坏掉的节点，移到正常节点簇旁边。");
    return { rescued: col };
  }

  // 建完节点把视口平移到该节点中心：bundle onlyRenderVisibleElements 下，
  // 落在源节点右侧的节点若出了屏幕右缘就不渲染（看着像「没添加」）。
  // setCenter 只按 flow 坐标平移视口，不依赖节点是否已渲染，建完即可调。
  function scrollNodeIntoView(nodeId) {
    const read = findCanvasStore();
    const st = read ? read() : null;
    const node = st && Array.isArray(st.nodes) ? st.nodes.find(n => n && n.id === nodeId) : null;
    if (!node) return false;
    const getRF = findReactFlowStore();
    const rf = getRF ? getRF() : null;
    if (!rf || typeof rf.setCenter !== "function") return false;
    const p = node.positionAbsolute || node.position || {};
    const m = node.measured || {};
    const cx = Number(p.x) + (Number(m.width) || 260) / 2;
    const cy = Number(p.y) + (Number(m.height) || 120) / 2;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
    const tf = rf.transform;
    const zoom = tf && Number.isFinite(tf[2]) && tf[2] > 0 ? tf[2] : 1;
    try { rf.setCenter(cx, cy, { zoom }); return true; } catch (_) { return false; }
  }

  // 自动健康修复：加载时（含从 IndexedDB 恢复后）若发现坏坐标节点或被 NaN
  // 污染的视口 transform，就搬回节点并重置视野。bundle 用 fitView:!0 +
  // onlyRenderVisibleElements，一个 NaN 坐标节点即让整屏/小地图变黑。
  function ensureHealthyView() {
    const res = rescueNodes();
    const getRF = findReactFlowStore();
    const rf = getRF ? getRF() : null;
    if (!rf) return res;
    const t = rf.transform;
    const transformBad = !t || !Number.isFinite(t[0]) || !Number.isFinite(t[1]) || !Number.isFinite(t[2]);
    if (res && res.rescued > 0) {
      // 节点刚被搬回，等 React Flow 同步 nodeLookup 后 fitView 把它们框进视野
      window.setTimeout(() => { try { if (typeof rf.fitView === "function") rf.fitView({ padding: 0.3 }); } catch (_) {} }, 250);
    } else if (transformBad) {
      // 没有坏节点但 transform 已是 NaN：直接重置为初始视野
      try { if (typeof rf.setViewport === "function") rf.setViewport({ x: 0, y: 0, zoom: 1 }); } catch (_) {}
    }
    return res;
  }

  let healthTimer = null;
  function startHealthWatch() {
    if (healthTimer) return;
    let ticks = 0;
    healthTimer = window.setInterval(() => {
      ticks += 1;
      const read = findCanvasStore();
      const st = read ? read() : null;
      const nodesReady = !!(st && Array.isArray(st.nodes) && st.nodes.length > 0);
      const badPos = n => {
        const pos = n && (n.positionAbsolute || n.position);
        return !pos || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y));
      };
      const hasBad = nodesReady && st.nodes.some(badPos);
      const getRF = findReactFlowStore();
      const rf = getRF ? getRF() : null;
      const tf = rf && rf.transform;
      const transformBad = !!(tf && !(Number.isFinite(tf[0]) && Number.isFinite(tf[1]) && Number.isFinite(tf[2])));
      if (hasBad || transformBad) ensureHealthyView();
      else if (nodesReady && ticks > 3) { window.clearInterval(healthTimer); healthTimer = null; }
      if (ticks >= 20) { window.clearInterval(healthTimer); healthTimer = null; }
    }, 1000);
  }

  window.__MS_VIDEO_NODE_PATCH__ = {
    addVideoNode: useFlowPosition => addVideoNode(!!useFlowPosition),
    isReady: () => !!findCanvasStore(),
    // 供语音补丁复用同一套「新建节点强制测量 handleBounds」实现，避免两处重复
    measureNode: nodeId => measureNodeWithRetry(nodeId),
    connectFromNode: (sourceId, targetId) => connectFromNode(sourceId, targetId),
    rescueNodes: () => rescueNodes(),
    ensureHealthyView: () => ensureHealthyView(),
    scrollNodeIntoView: nodeId => scrollNodeIntoView(nodeId),
    // 小地图点击定位用：把画布中心移到某个 flow 坐标，保持当前缩放。
    // fiber/store 访问集中在这里，minimap-patch 不自己遍历。
    // zoom 缺失时 bundle 的 setCenter 会回落到 maxZoom（点一下就放大到最大），
    // 所以缩放非有限数直接不跳，不假装成功。duration 可传 0（拖动导航框跟手）。
    centerViewport: (x, y, duration = 220) => {
      const g = findReactFlowStore();
      const rf = g ? g() : null;
      if (!rf || typeof rf.setCenter !== "function") return false;
      const zoom = rf.transform && rf.transform[2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return false;
      try { rf.setCenter(x, y, { zoom, duration }); return true; } catch (_) { return false; }
    },
    // 当前画布视口中心的 flow 坐标：小地图固定导航框初始/跟随位置用。
    // transform=[tx,ty,zoom]，中心 = ((w/2-tx)/zoom, (h/2-ty)/zoom)。
    viewportCenter: () => {
      const g = findReactFlowStore();
      const rf = g ? g() : null;
      if (!rf) return null;
      const t = rf.transform;
      const zoom = t && t[2];
      if (!t || !Number.isFinite(zoom) || zoom <= 0) return null;
      let w = Number(rf.width), h = Number(rf.height);
      if (!(w > 0) || !(h > 0)) {
        const box = rf.domNode && rf.domNode.getBoundingClientRect ? rf.domNode.getBoundingClientRect() : null;
        w = box ? box.width : 0;
        h = box ? box.height : 0;
      }
      if (!(w > 0) || !(h > 0)) return null;
      const x = (w / 2 - t[0]) / zoom;
      const y = (h / 2 - t[1]) / zoom;
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    },
    diagnoseDrag: () => {
      const g = findReactFlowStore();
      const rf = g ? g() : null;
      const info = {
        rfFound: !!rf,
        nodesDraggable: rf && rf.nodesDraggable,
        nodesConnectable: rf && rf.nodesConnectable,
        elementsSelectable: rf && rf.elementsSelectable,
      };
      console.log("[漫书] 拖拽诊断", info);
      return info;
    },
    connectivityPatched: () => {
      const read = findCanvasStore();
      const state = read ? read() : null;
      return !!(state && state[PATCH_FLAG]);
    },
    version: "20261116-15",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
