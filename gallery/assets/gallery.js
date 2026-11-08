/*
 * 漫时光 · 资产参考库
 * 零依赖静态索引：只读加载本地资产数据，所有动态文本通过 DOM API 写入。
 */
(function () {
  "use strict";

  // 资产图与索引已复制到 gallery/local-assets/（本地直读，不再走外部只读代理）。
  var ASSET_PREFIX = "local-assets/";
  var PAGE_SIZE = 60;
  var NSFW_POSE_SYSTEMS = new Set(["全身单人・性感系", "双人缠绵"]);
  var NSFW_COSTUME_CATEGORIES = new Set(["内衣・睡衣", "性感穿搭"]);
  var POSE_ANGLES = ["正面", "俯视", "仰视", "侧面", "斜侧"];
  var COSTUME_SOURCES = {
    gia: "写实服装",
    "gia-anime": "动漫服装",
    charadb: "角色库服装",
    shisei: "中国历代服装",
  };
  var DATA_FILES = [
    ["poses", "data/pose-zh.json"],
    ["costumes", "data/costume-zh.json"],
    ["costumes", "data/costume-shisei-zh.json"],
    ["costumes", "data/costume-gia-anime-zh.json"],
    ["costumes", "data/costume-anime-zh.json"],
    ["portraits", "data/portrait-zh.json"],
  ];
  var library = { poses: [], costumes: [], portraits: [] };
  var loadErrors = [];
  // 嵌入模式：画布右侧抽屉用 iframe 打开，只加载当前库、隐藏站点装饰。
  var EMBED = false;
  var EMBED_TAB = "";
  var loadedLibraries = { poses: false, costumes: false, portraits: false };
  try {
    var bootParams = new URLSearchParams(window.location.search);
    EMBED = bootParams.get("embed") === "1";
    var bootTab = bootParams.get("tab");
    if (bootTab === "poses" || bootTab === "costumes" || bootTab === "portraits") {
      EMBED_TAB = bootTab;
    }

  } catch (_) { EMBED = false; }
  var LOAD_PAGE = EMBED ? 24 : PAGE_SIZE;

  // 嵌入模式：直接把选中项交给父页面（画布），不依赖跨标签广播。
  function notifyParent(asset) {
    if (!window.parent || window.parent === window) return false;
    try {
      window.parent.postMessage(
        { source: "manshiguang-asset-embed", type: "asset-select", asset: asset },
        window.location.origin
      );
      return true;
    } catch (_) {
      return false;
    }
  }
  var state = {
    size: "standard",
    tab: "poses",
    query: "",
    main: "all",
    sub: "all",
    option: "all",
    kind: "all",
    tag: "all",
    safe: true,
    limit: LOAD_PAGE,
    poseMode: "model",
    dialogIndex: -1,
    dialogView: "",
    dialogDepth: false,
  };
  
  // 尺寸持久化
  var SIZE_STORAGE_KEY = "manshiguang:gallery:size";
  try {
    var savedSize = localStorage.getItem(SIZE_STORAGE_KEY);
    if (savedSize === "compact" || savedSize === "standard" || savedSize === "large") {
      state.size = savedSize;
    }
  } catch (_) {}


  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
      return String(a).localeCompare(String(b), "zh-CN");
    });
  }

  function countLabel(value) {
    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function assetPath(raw) {
    if (!raw) return "";
    var value = String(raw);
    if (/^(data:|https?:\/\/|\/)/i.test(value)) return value;
    return ASSET_PREFIX + value.replace(/^\.?\//, "");
  }

  function poseDepthPath(raw) {
    if (!raw || /^(data:|https?:\/\/)/i.test(raw)) return raw || "";
    var clean = String(raw).replace(/^\/+/, "");
    if (clean.indexOf("thumbs/depth/") === 0 || clean.indexOf("img/depth/") === 0) return clean;
    if (clean.indexOf("thumbs/") === 0) {
      return "thumbs/depth/" + clean.slice(7).replace(/\.(jpe?g|png)$/i, ".webp");
    }
    if (clean.indexOf("img/") === 0) {
      return "img/depth/" + clean.slice(4).replace(/\.(jpe?g|png)$/i, ".webp");
    }
    return clean;
  }

  function costumeView(item, viewId) {
    var views = Array.isArray(item.views) ? item.views : [];
    if (!views.length) return item;
    var selected = views.find(function (view) { return view.id === viewId; });
    if (!selected) selected = views.find(function (view) { return view.id === item.selectedView; });
    if (!selected) selected = views.find(function (view) { return view.id === "front"; }) || views[0];
    return selected || item;
  }

  function itemSource(item) {
    return item.source || "gia";
  }

  function isUnsafePose(item) {
    return NSFW_POSE_SYSTEMS.has(item.体系);
  }

  function isUnsafeCostume(item) {
    return Boolean(item.敏感) || NSFW_COSTUME_CATEGORIES.has(item.分类);
  }

  function safeItems(type) {
    var items = library[type] || [];
    if (!state.safe) return items;
    if (type === "poses") return items.filter(function (item) { return !isUnsafePose(item); });
    if (type === "costumes") return items.filter(function (item) { return !isUnsafeCostume(item); });
    return items;
  }

  function costumeKind(item) {
    return item.一级分类 || "现实";
  }

  function searchText(item) {
    return [item.检索, item.id, item.姿势名称, item.服装名称, item.标题, item.发型名称, item.分类, item.分区, item.发长]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function filteredItems() {
    var base = safeItems(state.tab);
    var query = state.query.trim().toLowerCase();
    return base.filter(function (item) {
      if (query && searchText(item).indexOf(query) === -1) return false;
      if (state.tab === "poses") {
        if (state.main !== "all" && item.体系 !== state.main) return false;
        if (state.sub !== "all" && item.分类 !== state.sub) return false;
        if (state.option !== "all" && item.角度 !== state.option) return false;
        return true;
      }
      if (state.tab === "costumes") {
        if (state.main !== "all" && itemSource(item) !== state.main) return false;
        if (state.kind !== "all" && costumeKind(item) !== state.kind) return false;
        if (state.sub !== "all" && item.分类 !== state.sub) return false;
        if (state.tag !== "all" && !(item.标签 || []).includes(state.tag)) return false;
        return true;
      }
      if (state.main !== "all" && item.分区 !== state.main) return false;
      if (state.sub !== "all" && item.发长 !== state.sub) return false;
      if (state.option === "hot" && !item.热门) return false;
      if (state.option === "featured" && !item.精选) return false;
      return true;
    });
  }

  function displayImage(item, type, size, viewId) {
    if (type === "costumes") {
      var view = costumeView(item, viewId);
      if (size === "thumb") return assetPath(view.缩略图 || view.预览图 || view.原图);
      if (size === "preview") return assetPath(view.预览图 || view.原图 || view.缩略图);
      return assetPath(view.原图 || view.预览图 || view.缩略图);
    }
    if (type === "poses") {
      var useDepth = state.dialogDepth;
      var raw = size === "thumb" || size === "preview" ? item.缩略图 : (item.原图 || item.缩略图);
      return assetPath(useDepth ? poseDepthPath(raw) : raw);
    }
    var portraitRaw = size === "thumb" ? item.缩略图 : (item.原图 || item.缩略图);
    return assetPath(portraitRaw);
  }

  function cardImage(item, type) {
    if (type === "poses" && state.poseMode === "depth") {
      return assetPath(poseDepthPath(item.缩略图));
    }
    if (type === "costumes") return displayImage(item, type, "thumb", "");
    return displayImage(item, type, "thumb", "");
  }

  function showToast(message, kind) {
    var alert = $("#archiveAlert");
    if (!alert) return;
    alert.hidden = false;
    alert.replaceChildren();
    var strong = el("strong", "", kind === "error" ? "资产库读取失败" : "提示");
    alert.appendChild(strong);
    alert.appendChild(document.createTextNode(message));
  }

  function clearAlert() {
    var alert = $("#archiveAlert");
    if (alert) {
      alert.hidden = true;
      alert.replaceChildren();
    }
  }
  // ======= 合成台：发送到画布 =======
  var _assetChannel = null;
  function getAssetChannel() {
    if (!_assetChannel) {
      try { _assetChannel = new BroadcastChannel("manshiguang:asset-transfer"); }
      catch (_) { _assetChannel = null; }
    }
    return _assetChannel;
  }

  function sendToCanvas(item) {
    if (EMBED) {
      var payload = buildAssetPayload(item);
      if (!payload) { showToast("该资产没有可用图片地址。", "error"); return; }
      if (notifyParent(payload)) {
        showToast("已送入画布合成台", "");
        return;
      }
      showToast("嵌入通信失败，请刷新画布后重试。", "error");
      return;
    }
    var ch = getAssetChannel();
    if (!ch) { showToast("当前浏览器不支持跨标签通信，请使用新版本 Chrome 或 Edge。", "error"); return; }
    var type = state.tab;
    var name = cardTitle(item, type);
    // Use preview size for the URL to keep it reasonable
    function toAbsoluteUrl(url) {
      if (!url || /^(data:|https?:\/\/)/i.test(url)) return url || "";
      try { return new URL(url, window.location.href).href; }
      catch (_) { return url; }
    }
    var imageUrl = toAbsoluteUrl(displayImage(item, type, "preview", state.dialogView || ""));
    var originalUrl = toAbsoluteUrl(displayImage(item, type, "original", state.dialogView || ""));
    var thumbUrl = toAbsoluteUrl(cardImage(item, type));
    var eyebrow = cardEyebrow(item, type);
    var tags = item.标签 || [];
    var msg = {
      type: "asset-select",
      embed: EMBED,
      asset: {
        id: item.id || "",
        name: name,
        imageUrl: imageUrl,
        originalUrl: originalUrl,
        thumbUrl: thumbUrl,
        category: type === "poses" ? "pose" : type === "portraits" ? "portrait" : "costume",
        source: type === "costumes" ? (COSTUME_SOURCES[itemSource(item)] || itemSource(item) || "") : "",
        eyebrow: eyebrow,
        tags: tags.slice(0, 10),
        kind: item.分类 || item.分区 || item.角度 || ""
      }
    };
    ch.postMessage(msg);
    showToast(EMBED ? "已插入「" + name + "」到画布" : "已发送「" + name + "」到画布", "");
  }

  // 嵌入模式下的最小可用载荷（无 BroadcastChannel 时走 postMessage）。
  function buildAssetPayload(item) {
    if (!item) return null;
    var type = state.tab;
    function toAbsoluteUrl(url) {
      if (!url || /^(data:|https?:\/\/)/i.test(url)) return url || "";
      try { return new URL(url, window.location.href).href; }
      catch (_) { return url; }
    }
    var imageUrl = toAbsoluteUrl(displayImage(item, type, "preview", state.dialogView || ""));
    if (!imageUrl) return null;
    return {
      id: item.id || "",
      name: cardTitle(item, type),
      imageUrl: imageUrl,
      originalUrl: toAbsoluteUrl(displayImage(item, type, "original", state.dialogView || "")),
      thumbUrl: toAbsoluteUrl(cardImage(item, type)),
      category: type === "poses" ? "pose" : type === "portraits" ? "portrait" : "costume",
      source: type === "costumes" ? (COSTUME_SOURCES[itemSource(item)] || itemSource(item) || "") : "",
      eyebrow: cardEyebrow(item, type),
      tags: (item.标签 || []).slice(0, 10),
      kind: item.分类 || item.分区 || item.角度 || ""
    };
  }

  function createStarfield() {
    var field = $("#starfield");
    if (!field || field.childElementCount) return;
    var fragment = document.createDocumentFragment();
    var seed = 20261105;
    function random() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    for (var i = 0; i < 82; i += 1) {
      var star = el("span", "star");
      star.style.left = (random() * 100).toFixed(2) + "%";
      star.style.top = (random() * 100).toFixed(2) + "%";
      star.style.setProperty("--size", (random() * 2 + 1).toFixed(1) + "px");
      star.style.setProperty("--opacity", (random() * 0.55 + 0.18).toFixed(2));
      star.style.setProperty("--duration", (random() * 5 + 3.5).toFixed(1) + "s");
      star.style.setProperty("--delay", (-random() * 7).toFixed(1) + "s");
      fragment.appendChild(star);
    }
    field.appendChild(fragment);
  }

  function setLoadingNote(message) {
    var note = $("#loadingNote");
    if (note) note.textContent = message;
  }

  function updateHero() {
    var safePoses = safeItems("poses").length;
    var safeCostumes = safeItems("costumes").length;
    var safePortraits = safeItems("portraits").length;
    var total = safePoses + safeCostumes + safePortraits;
    var safeCount = $("#heroSafeCount");
    var poseCount = $("#heroPoseCount");
    var costumeCount = $("#heroCostumeCount");
    var portraitCount = $("#heroPortraitCount");
    if (safeCount) safeCount.textContent = countLabel(total);
    if (poseCount) poseCount.textContent = countLabel(safePoses);
    if (costumeCount) costumeCount.textContent = countLabel(safeCostumes);
    if (portraitCount) portraitCount.textContent = countLabel(safePortraits);
    document.querySelectorAll("[data-count-for]").forEach(function (node) {
      var type = node.getAttribute("data-count-for");
      // 嵌入模式按需加载，未读取的库不能显示成 0。
      var pending = EMBED && !library[type].length && !loadedLibraries[type];
      node.textContent = pending ? "…" : countLabel(safeItems(type).length);
    });
    var label = $("#safeModeLabel");
    var button = $("#safeModeButton");
    var badge = $("#safeBadge");
    if (label) label.textContent = state.safe ? "安全模式 · 已开启" : "安全模式 · 已关闭";
    if (button) {
      button.setAttribute("aria-pressed", String(state.safe));
      button.classList.toggle("is-off", !state.safe);
    }
    if (badge) {
      badge.textContent = state.safe ? "SFW 安全模式" : "18+ 内容已显示";
      badge.classList.toggle("is-off", !state.safe);
    }
    var status = $("#archiveStatus");
    if (status) {
      status.textContent = state.safe
        ? "已读取本地只读索引，敏感分类默认隐藏。"
        : "已解除安全模式，请遵守来源与使用许可。";
    }
  }

  function filterLabel(text) {
    var label = el("span", "filter-label", text);
    return label;
  }

  function addFilterButton(parent, label, active, onClick, extraClass) {
    var button = el("button", (extraClass || "filter-chip") + (active ? " is-active" : ""), label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", onClick);
    parent.appendChild(button);
    return button;
  }

  function renderFilters() {
    var primary = $("#primaryFilters");
    var secondary = $("#secondaryFilters");
    var options = $("#optionFilters");
    if (!primary || !secondary || !options) return;
    primary.replaceChildren();
    secondary.replaceChildren();
    options.replaceChildren();
    var base = safeItems(state.tab);

    if (state.tab === "poses") {
      primary.appendChild(filterLabel("体系"));
      addFilterButton(primary, "全部体系", state.main === "all", function () {
        state.main = "all"; state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      });
      uniqueSorted(base.map(function (item) { return item.体系; })).forEach(function (value) {
        addFilterButton(primary, value, state.main === value, function () {
          state.main = value; state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
        });
      });
      var categories = uniqueSorted(base.filter(function (item) {
        return state.main === "all" || item.体系 === state.main;
      }).map(function (item) { return item.分类; }));
      secondary.appendChild(filterLabel("动作"));
      addFilterButton(secondary, "全部动作", state.sub === "all", function () {
        state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      });
      categories.forEach(function (value) {
        addFilterButton(secondary, value, state.sub === value, function () {
          state.sub = value; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
        });
      });
      options.appendChild(filterLabel("视角"));
      addFilterButton(options, "全部视角", state.option === "all", function () {
        state.option = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      }, "option-button");
      POSE_ANGLES.forEach(function (value) {
        addFilterButton(options, value, state.option === value, function () {
          state.option = value; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
        }, "option-button");
      });
      addFilterButton(options, "素体白模", state.poseMode === "model", function () {
        state.poseMode = "model"; renderFilters(); renderGrid(true);
      }, "option-button");
      addFilterButton(options, "深度图", state.poseMode === "depth", function () {
        state.poseMode = "depth"; renderFilters(); renderGrid(true);
      }, "option-button");
      return;
    }

    if (state.tab === "costumes") {
      primary.appendChild(filterLabel("来源"));
      addFilterButton(primary, "全部来源", state.main === "all", function () {
        state.main = "all"; state.sub = "all"; state.tag = "all"; state.limit = LOAD_PAGE;
        renderFilters(); renderGrid(true);
      });
      uniqueSorted(base.map(itemSource)).forEach(function (value) {
        addFilterButton(primary, COSTUME_SOURCES[value] || value, state.main === value, function () {
          state.main = value; state.sub = "all"; state.tag = "all"; state.limit = LOAD_PAGE;
          renderFilters(); renderGrid(true);
        });
      });
      var costumeCategories = uniqueSorted(base.filter(function (item) {
        return state.main === "all" || itemSource(item) === state.main;
      }).map(function (item) { return item.分类; }));
      secondary.appendChild(filterLabel("分类"));
      addFilterButton(secondary, "全部分类", state.sub === "all", function () {
        state.sub = "all"; state.tag = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      });
      costumeCategories.forEach(function (value) {
        addFilterButton(secondary, value, state.sub === value, function () {
          state.sub = value; state.tag = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
        });
      });
      options.appendChild(filterLabel("类型"));
      ["全部", "现实", "二次元"].forEach(function (value) {
        var key = value === "全部" ? "all" : value;
        addFilterButton(options, value, state.kind === key, function () {
          state.kind = key; state.sub = "all"; state.tag = "all"; state.limit = LOAD_PAGE;
          renderFilters(); renderGrid(true);
        }, "option-button");
      });
      var tagBase = base.filter(function (item) {
        return (state.main === "all" || itemSource(item) === state.main) &&
          (state.kind === "all" || costumeKind(item) === state.kind) &&
          (state.sub === "all" || item.分类 === state.sub);
      });
      var tags = uniqueSorted(tagBase.reduce(function (all, item) { return all.concat(item.标签 || []); }, []));
      if (tags.length) {
        options.appendChild(filterLabel("单品"));
        addFilterButton(options, "全部标签", state.tag === "all", function () {
          state.tag = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
        }, "option-button");
        tags.forEach(function (value) {
          addFilterButton(options, value, state.tag === value, function () {
            state.tag = value; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
          }, "option-button");
        });
      }
      return;
    }

    primary.appendChild(filterLabel("分区"));
    addFilterButton(primary, "全部分区", state.main === "all", function () {
      state.main = "all"; state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
    });
    uniqueSorted(base.map(function (item) { return item.分区; })).forEach(function (value) {
      addFilterButton(primary, value, state.main === value, function () {
        state.main = value; state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      });
    });
    secondary.appendChild(filterLabel("发长"));
    addFilterButton(secondary, "全部发长", state.sub === "all", function () {
      state.sub = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
    });
    uniqueSorted(base.filter(function (item) {
      return state.main === "all" || item.分区 === state.main;
    }).map(function (item) { return item.发长; })).forEach(function (value) {
      addFilterButton(secondary, value, state.sub === value, function () {
        state.sub = value; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
      });
    });
    options.appendChild(filterLabel("精选"));
    addFilterButton(options, "全部人像", state.option === "all", function () {
      state.option = "all"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
    }, "option-button");
    addFilterButton(options, "热门 Top10", state.option === "hot", function () {
      state.option = "hot"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
    }, "option-button");
    addFilterButton(options, "精选推荐", state.option === "featured", function () {
      state.option = "featured"; state.limit = LOAD_PAGE; renderFilters(); renderGrid(true);
    }, "option-button");
  }

  function cardTitle(item, type) {
    if (type === "poses") return item.姿势名称 || item.id;
    if (type === "costumes") return item.服装名称 || item.id;
    return item.标题 || item.发型名称 || item.id;
  }

  function cardEyebrow(item, type) {
    if (type === "poses") return [item.体系, item.角度].filter(Boolean).join(" · ");
    if (type === "costumes") return [COSTUME_SOURCES[itemSource(item)] || itemSource(item), item.分类].filter(Boolean).join(" · ");
    return [item.分区, item.发长, item.发型名称].filter(Boolean).join(" · ");
  }

  function cardMeta(item, type) {
    if (type === "poses") return [item.姿势编号, state.poseMode === "depth" ? "Depth" : "白模"];
    if (type === "costumes") return [item.id, costumeKind(item)];
    return [item.发长, item.热门 ? "热门" : item.精选 ? "精选" : "人像"];
  }

  function makeCard(item, type, index) {
    var card = el("article", "asset-card");
    var media = el("button", "asset-card__media");
    media.type = "button";
    media.setAttribute("aria-label", "预览：" + cardTitle(item, type));
    media.setAttribute("data-error", "图片暂时无法载入");
    var img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = cardTitle(item, type);
    img.src = cardImage(item, type);
    img.addEventListener("error", function () { media.classList.add("is-broken"); });
    media.appendChild(img);
    var badge = el("span", "asset-card__badge", type === "poses" ? (item.角度 || "姿势") : type === "costumes" ? item.分类 : item.分区);
    media.appendChild(badge);
    if ((type === "portraits" && item.热门) || (type === "poses" && state.poseMode === "depth")) {
      var hot = el("span", "asset-card__badge asset-card__badge--hot", type === "poses" ? "深度图" : "热门");
      media.appendChild(hot);
    }
    media.addEventListener("click", function () { openDialog(index); });
    card.appendChild(media);
    var body = el("div", "asset-card__body");
    // 发送到画布按钮
    var sendBtn = el("button", "asset-card__send", "");
    sendBtn.type = "button";
    sendBtn.title = "发送到画布合成台";
    sendBtn.setAttribute("aria-label", "发送「" + cardTitle(item, type) + "」到画布");
    sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
    sendBtn.addEventListener("click", function (e) { e.stopPropagation(); sendToCanvas(item); });
    body.appendChild(sendBtn);

    body.appendChild(el("p", "asset-card__eyebrow", cardEyebrow(item, type)));
    body.appendChild(el("h3", "asset-card__title", cardTitle(item, type)));
    var meta = el("div", "asset-card__meta");
    var parts = cardMeta(item, type);
    meta.appendChild(el("span", "", parts[0] || ""));
    meta.appendChild(el("span", "", parts[1] || ""));
    body.appendChild(meta);
    card.appendChild(body);
    return card;
  }

  function renderGrid(resetScroll) {
    var grid = $("#assetGrid");
    var empty = $("#emptyState");
    var loadMore = $("#loadMore");
    var remaining = $("#remainingCount");
    var resultCount = $("#resultCount");
    if (!grid || !empty || !loadMore) return;
    var items = filteredItems();
    var visible = items.slice(0, state.limit);
    if (resultCount) resultCount.textContent = countLabel(items.length);
    grid.replaceChildren();
    visible.forEach(function (item, index) {
      grid.appendChild(makeCard(item, state.tab, index));
    });
    empty.hidden = items.length !== 0;
    loadMore.hidden = items.length <= visible.length;
    if (remaining) remaining.textContent = " · 还有 " + countLabel(Math.max(0, items.length - visible.length)) + " 个";
    var note = $("#loadingNote");
    if (note) {
      note.textContent = items.length
        ? "已显示 " + countLabel(visible.length) + " / " + countLabel(items.length) + " 个本地参考"
        : "没有匹配的本地参考";
    }
    updateHero();
    if (resetScroll) {
      var browser = $("#assetBrowser");
      if (browser && window.scrollY > browser.offsetTop) {
        browser.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  // 尺寸切换
  function setupSizeToggle() {
    var btns = document.querySelectorAll(".size-btn");
    btns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        var size = this.dataset.size;
        if (size === state.size) return;
        state.size = size;
        try { localStorage.setItem(SIZE_STORAGE_KEY, size); } catch (_) {}
        document.body.className = document.body.className.replace(/is-embed-size-\w+/g, "");
        document.body.classList.add("is-embed-size-" + size);
        btns.forEach(function(b) { b.classList.remove("is-active"); });
        btn.classList.add("is-active");
        renderGrid(true);
      });
    });
    // Set initial active state
    var initialBtn = document.querySelector(".size-btn[data-size="" + state.size + ""]");
    if (initialBtn) initialBtn.classList.add("is-active");
  }

  function setTab(tab) {
    state.tab = tab;
    state.main = "all";
    state.sub = "all";
    state.option = "all";
    state.kind = "all";
    state.tag = "all";
    state.limit = LOAD_PAGE;
    state.dialogIndex = -1;
    document.querySelectorAll(".library-tab").forEach(function (button) {
      var selected = button.getAttribute("data-tab") === tab;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    // 嵌入模式按需加载：切到没读过的库先补索引，再渲染。
    if (EMBED && !library[tab].length && !loadingLibraries[tab] && !loadedLibraries[tab]) {
      setLoadingNote("正在读取" + tabLabel(tab) + "索引…");
      loadLibraryFiles([tab]).then(function () {
        renderFilters();
        renderGrid(true);
      });
      return;
    }
    renderFilters();
    renderGrid(true);
  }

  // 嵌入模式：宿主（画布抽屉）可以让我们原地切库，不必重载 iframe。
  function listenHostCommands() {
    window.addEventListener("message", function (event) {
      if (!event || event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || data.source !== "manshiguang-asset-host") return;
      if (data.type === "switch-tab") {
        var tab = data.tab;
        if (tab === "poses" || tab === "costumes" || tab === "portraits") setTab(tab);
      }
    });
  }

  function tabLabel(tab) {
    if (tab === "poses") return "姿势库";
    if (tab === "portraits") return "人像库";
    return "服装库";
  }

  function dialogItems() {
    return filteredItems();
  }

  function openDialog(index) {
    state.dialogIndex = index;
    state.dialogView = "";
    state.dialogDepth = state.poseMode === "depth";
    updateDialog();
    var dialog = $("#assetDialog");
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      document.body.classList.add("is-dialog-open");
      var close = $("#dialogClose");
      if (close) close.focus();
    }
  }

  function closeDialog() {
    var dialog = $("#assetDialog");
    if (dialog && dialog.open && typeof dialog.close === "function") dialog.close();
    else if (dialog) dialog.removeAttribute("open");
    document.body.classList.remove("is-dialog-open");
  }

  function currentDialogItem() {
    var items = dialogItems();
    if (state.dialogIndex < 0 || state.dialogIndex >= items.length) return null;
    return { item: items[state.dialogIndex], items: items };
  }

  function badge(text, accent) {
    return el("span", "dialog-badge" + (accent ? " dialog-badge--accent" : ""), text);
  }

  function metaRow(parent, label, value) {
    if (!value) return;
    parent.appendChild(el("dt", "", label));
    parent.appendChild(el("dd", "", value));
  }

  function updateDialog() {
    var current = currentDialogItem();
    if (!current) return;
    var item = current.item;
    var type = state.tab;
    var image = $("#dialogImage");
    var imageWrap = $("#dialogImageWrap");
    var title = $("#dialogTitle");
    var kicker = $("#dialogKicker");
    var description = $("#dialogDescription");
    var meta = $("#dialogMeta");
    var tags = $("#dialogTags");
    var badges = $("#dialogBadges");
    var variants = $("#dialogVariants");
    var original = $("#dialogOriginal");
    var counter = $("#dialogCounter");
    var depthButton = $("#dialogDepth");
    var originalLabel = original ? original.querySelector("span") : null;
    var mainImage = displayImage(item, type, "preview", state.dialogView);
    if (type === "poses" && state.dialogDepth) mainImage = assetPath(poseDepthPath(item.原图 || item.缩略图));
    if (image) {
      image.classList.remove("is-broken");
      image.alt = cardTitle(item, type);
      image.src = mainImage;
    }
    if (imageWrap) imageWrap.classList.remove("is-broken");
    if (title) title.textContent = cardTitle(item, type);
    if (kicker) kicker.textContent = type === "poses" ? "POSE REFERENCE" : type === "costumes" ? "COSTUME REFERENCE" : "PORTRAIT REFERENCE";
    if (badges) {
      badges.replaceChildren();
      if (type === "poses") {
        badges.appendChild(badge(item.姿势编号 || item.id));
        badges.appendChild(badge(item.角度 || "姿势"));
        badges.appendChild(badge(state.dialogDepth ? "深度图" : "素体白模", state.dialogDepth));
      } else if (type === "costumes") {
        badges.appendChild(badge(item.分类 || "服装"));
        badges.appendChild(badge(COSTUME_SOURCES[itemSource(item)] || itemSource(item)));
        if (item.source === "shisei") badges.appendChild(badge("CC0", true));
      } else {
        badges.appendChild(badge(item.分区 || "人像"));
        badges.appendChild(badge(item.发长 || "发型"));
        if (item.热门) badges.appendChild(badge("热门", true));
        if (item.精选) badges.appendChild(badge("精选"));
      }
    }
    if (description) {
      var desc = "";
      if (type === "poses") desc = "用于人体动态、构图与视角研究的本地参考。";
      else if (type === "costumes") desc = item.关键词 || "服装与穿搭参考，图片版权归原作者所有。";
      else desc = "发型与氛围人像参考，适合角色设定与表情方向研究。";
      description.textContent = desc;
    }
    if (meta) {
      meta.replaceChildren();
      if (type === "poses") {
        metaRow(meta, "所属体系", item.体系);
        metaRow(meta, "动作分类", item.分类);
        metaRow(meta, "显示模式", state.dialogDepth ? "深度图 (Depth Map)" : "3D 素体白模");
        metaRow(meta, "资产编号", item.id);
      } else if (type === "costumes") {
        metaRow(meta, "来源", COSTUME_SOURCES[itemSource(item)] || item.来源 || itemSource(item));
        metaRow(meta, "一级分类", costumeKind(item));
        metaRow(meta, "资产编号", item.id);
        if (item.日文名称) metaRow(meta, "日文名称", item.日文名称);
        if (item.来源地址) metaRow(meta, "来源地址", item.来源地址);
      } else {
        metaRow(meta, "分区", item.分区);
        metaRow(meta, "发长", item.发长);
        metaRow(meta, "发型名称", item.发型名称);
        metaRow(meta, "原图尺寸", item.宽 && item.高 ? item.宽 + " × " + item.高 : "");
        metaRow(meta, "资产编号", item.id);
      }
    }
    if (tags) {
      tags.replaceChildren();
      if (type === "costumes") {
        (item.标签 || []).slice(0, 16).forEach(function (tag) { tags.appendChild(el("span", "dialog-tag", tag)); });
      } else if (type === "portraits") {
        [item.发型名称, item.热门 ? "热门" : "", item.精选 ? "精选" : ""].filter(Boolean).forEach(function (tag) {
          tags.appendChild(el("span", "dialog-tag", tag));
        });
      }
    }
    if (variants) {
      variants.replaceChildren();
      if (type === "costumes" && Array.isArray(item.views) && item.views.length) {
        item.views.forEach(function (view) {
          var active = view.id === (state.dialogView || item.selectedView || "front");
          var button = el("button", "variant-button" + (active ? " is-active" : ""), view.label || view.id);
          button.type = "button";
          button.setAttribute("aria-pressed", String(active));
          button.addEventListener("click", function () {
            state.dialogView = view.id;
            updateDialog();
          });
          variants.appendChild(button);
        });
      }
    }
    if (depthButton) {
      depthButton.hidden = type !== "poses";
      depthButton.textContent = state.dialogDepth ? "切换到素体白模" : "切换到深度图";
      depthButton.setAttribute("aria-pressed", String(state.dialogDepth));
    }
    if (original) {
      var originalUrl = type === "poses" && state.dialogDepth ? assetPath(poseDepthPath(item.原图 || item.缩略图)) : displayImage(item, type, "original", state.dialogView);
      original.href = originalUrl;
      if (type === "costumes" && ["charadb", "gia-anime"].includes(itemSource(item))) {
        original.target = "_blank";
        original.rel = "noopener noreferrer";
        if (originalLabel) originalLabel.textContent = "查看来源原图";
      } else {
        original.removeAttribute("target");
        original.removeAttribute("rel");
        original.setAttribute("download", item.id + (type === "poses" && state.dialogDepth ? "_depth.webp" : type === "costumes" ? ".webp" : ".webp"));
        if (originalLabel) originalLabel.textContent = "下载高清原图";
      }
    }
    if (counter) counter.textContent = (state.dialogIndex + 1) + " / " + current.items.length;
  }

  function moveDialog(delta) {
    var items = dialogItems();
    if (!items.length) return;
    state.dialogIndex = (state.dialogIndex + delta + items.length) % items.length;
    state.dialogView = "";
    updateDialog();
  }

  function setupEvents() {
    var search = $("#assetSearch");
    if (search) {
      search.addEventListener("input", function () {
        state.query = search.value;
        state.limit = LOAD_PAGE;
        renderGrid(true);
      });
    }
    document.querySelectorAll(".library-tab").forEach(function (button) {
      button.addEventListener("click", function () { setTab(button.getAttribute("data-tab")); });
    });
    var reset = $("#resetFilters");
    var emptyReset = $("#emptyReset");
    function resetAll() {
      state.query = "";
      state.main = "all";
      state.sub = "all";
      state.option = "all";
      state.kind = "all";
      state.tag = "all";
      state.limit = LOAD_PAGE;
      if (search) search.value = "";
      renderFilters();
      renderGrid(true);
    }
    if (reset) reset.addEventListener("click", resetAll);
    if (emptyReset) emptyReset.addEventListener("click", resetAll);
    var loadMore = $("#loadMore");
    if (loadMore) {
      loadMore.addEventListener("click", function () {
        state.limit += LOAD_PAGE;
        renderGrid(false);
      });
    }
    var safeButton = $("#safeModeButton");
    if (safeButton) {
      safeButton.addEventListener("click", function () {
        if (state.safe) {
          var confirmed = window.confirm("将显示「全身单人・性感系」「双人缠绵」姿势，以及「内衣・睡衣」「性感穿搭」服装。\n\n请确认你已成年，并同意只将这些参考用于合法、非商业或获授权的创作。是否继续？");
          if (!confirmed) return;
          state.safe = false;
        } else {
          state.safe = true;
        }
        state.main = "all";
        state.sub = "all";
        state.option = "all";
        state.kind = "all";
        state.tag = "all";
        state.limit = LOAD_PAGE;
        renderFilters();
        renderGrid(true);
      });
    }
    var dialogClose = $("#dialogClose");
    if (dialogClose) dialogClose.addEventListener("click", closeDialog);
    // 合成台：详情弹层中的发送按钮
    var dialogSend = $("#dialogSend");
    if (dialogSend) {
      dialogSend.addEventListener("click", function () {
        var cur = currentDialogItem();
        if (!cur) return;
        sendToCanvas(cur.item);
        if (EMBED) closeDialog();
      });
    }
    var dialog = $("#assetDialog");
    if (dialog) {
      dialog.addEventListener("cancel", function (event) {
        event.preventDefault();
        closeDialog();
      });
      dialog.addEventListener("close", function () { document.body.classList.remove("is-dialog-open"); });
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog();
      });
    }
    var prev = $("#dialogPrev");
    var next = $("#dialogNext");
    if (prev) prev.addEventListener("click", function () { moveDialog(-1); });
    if (next) next.addEventListener("click", function () { moveDialog(1); });
    var depth = $("#dialogDepth");
    if (depth) {
      depth.addEventListener("click", function () {
        state.dialogDepth = !state.dialogDepth;
        updateDialog();
      });
    }
    var dialogImage = $("#dialogImage");
    var dialogWrap = $("#dialogImageWrap");
    if (dialogImage) {
      dialogImage.addEventListener("error", function () {
        if (dialogWrap) dialogWrap.classList.add("is-broken");
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key === "/" && document.activeElement !== search && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (search) { event.preventDefault(); search.focus(); }
      }
      if (dialog && dialog.open) {
        if (event.key === "ArrowLeft") { event.preventDefault(); moveDialog(-1); }
        else if (event.key === "ArrowRight") { event.preventDefault(); moveDialog(1); }
        else if (event.key === "Escape") { event.preventDefault(); closeDialog(); }
      } else if (EMBED && event.key === "Escape") {
        // 焦点在 iframe 里时父页面收不到 Esc，转发给宿主关闭抽屉。
        try {
          window.parent.postMessage({ source: "manshiguang-asset-embed", type: "close-drawer" }, window.location.origin);
        } catch (_) {}
      }
    });
    var glow = $("#cursorGlow");
    if (glow && window.matchMedia("(pointer: fine)").matches) {
      document.addEventListener("pointermove", function (event) {
        glow.style.transform = "translate3d(" + event.clientX + "px, " + event.clientY + "px, 0) translate(-50%, -50%)";
      }, { passive: true });
    }
  }

  function finishLoading() {
    document.body.classList.remove("is-loading");
    var loading = $("#loadingNote");
    if (loading) loading.textContent = "本地索引已就绪";
  }

  function showFatal(message) {
    document.body.classList.remove("is-loading");
    setLoadingNote("资产索引不可用");
    var grid = $("#assetGrid");
    if (grid) grid.replaceChildren();
    showToast(message, "error");
    var status = $("#archiveStatus");
    if (status) status.textContent = "无法读取本地资产索引。";
  }

  // 只拉某个库需要的索引文件，避免嵌入时一次读 4 个大 JSON。
  // 一个库可能对应多个文件，因此用 in-flight 计数，全部完成才标记已加载。
  var loadingLibraries = { poses: 0, costumes: 0, portraits: 0 };

  function loadLibraryFiles(types) {
    var list = Array.isArray(types) ? types : [types];
    var wanted = {};
    list.forEach(function (type) {
      if (type !== "poses" && type !== "costumes" && type !== "portraits") return;
      if (loadedLibraries[type] || loadingLibraries[type]) return;
      wanted[type] = true;
    });
    var requests = DATA_FILES.filter(function (entry) {
      return wanted[entry[0]];
    }).map(function (entry) {
      var key = entry[0];
      var path = entry[1];
      loadingLibraries[key] += 1;
      return fetch(ASSET_PREFIX + path, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error(path + " HTTP " + response.status);
          return response.json().then(function (data) {
            if (!Array.isArray(data)) throw new Error(path + " 格式错误");
            library[key] = library[key].concat(data);
          });
        })
        .catch(function (error) {
          loadErrors.push(error.message || String(error));
        })
        .then(function () {
          loadingLibraries[key] -= 1;
          if (!loadingLibraries[key]) {
            loadedLibraries[key] = library[key].length > 0;
          }
        });
    });
    return Promise.all(requests);
  }

  function loadLibrary() {
    var requests = EMBED
      ? [loadLibraryFiles([EMBED_TAB || state.tab])]
      : DATA_FILES.map(function (entry) {
          return loadLibraryFiles([entry[0]]);
        });
    return Promise.all(requests).then(function () {
      var total = library.poses.length + library.costumes.length + library.portraits.length;
      if (!total) {
        showFatal("没有读取到任何资产条目。请使用 start.bat 启动，或运行 python server.py 4173 后访问 http://127.0.0.1:4173/gallery/index.html。普通静态服务器无法访问项目外的图片目录。");
        return;
      }
      if (!EMBED) createStarfield();
      setupEvents();
      setupSizeToggle();
      renderFilters();
      renderGrid(false);
      finishLoading();
      // 支持 URL ?tab= 直达对应库
      var urlParams = new URLSearchParams(window.location.search);
      var startTab = urlParams.get("tab");
      if (startTab && (startTab === "poses" || startTab === "costumes" || startTab === "portraits")) {
        setTab(startTab);
      }
      if (loadErrors.length) {
        showToast("部分索引读取失败：" + loadErrors.join("；") + "。其余资产仍可浏览。", "error");
      }
    });
  }

  function boot() {
    if (EMBED) {
      document.body.classList.add("is-embed");
      if (state.size) document.body.classList.add("is-embed-size-" + state.size);
      if (EMBED_TAB) state.tab = EMBED_TAB;
      listenHostCommands();
    } else {
      createStarfield();
    }
    var grid = $("#assetGrid");
    if (grid) {
      for (var i = 0; i < 10; i += 1) {
        var skeleton = el("div", "skeleton-card");
        skeleton.appendChild(el("div", "skeleton-card__media"));
        skeleton.appendChild(el("div", "skeleton-card__line"));
        skeleton.appendChild(el("div", "skeleton-card__line"));
        grid.appendChild(skeleton);
      }
    }
    updateHero();
    loadLibrary().catch(function (error) {
      showFatal("资产库初始化失败：" + (error.message || String(error)));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

