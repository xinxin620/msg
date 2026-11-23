(() => {
  "use strict";

  // 把 ComfyUI 保存的「编辑格式」工作流（nodes/links）转换成提交用的「API 格式」。
  // 规则以 ComfyUI 官方前端 graphToPrompt 的真实输出为基准逐字段对账：
  //  - 静音(2)/旁路(4) 节点跳过，旁路节点的连线穿透到真正的上游
  //  - Note / MarkdownNote / Reroute 属于前端节点，不进 API 格式
  //  - 子图（type 为 UUID）先按 definitions.subgraphs 自动展平成普通节点/连线再转换；找不到定义的才判不可运行
  //  - 前端虚拟节点无法安全展开，直接判为不可运行
  //  - widget 取 widgets_values_named，剔除只在前端生效的控件
  const SUBGRAPH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // 纯前端节点：官方 graphToPrompt 不会写进 API 格式，忽略即可
  const IGNORED = new Set([
    "Note", "MarkdownNote", "Reroute",
    "Fast Groups Muter (rgthree)", "Fast Groups Bypasser (rgthree)", "Label (rgthree)",
    "Display Int (rgthree)", "ShowText|pysssss",
  ]);
  // 跨节点取值的虚拟节点：官方会改写成连线/常量，画布不做还原，判为不可转换
  const VIRTUAL = new Set([
    "PrimitiveNode", "GetNode", "SetNode", "Int", "Float", "String", "Boolean",
  ]);
    // 只在前端有意义、官方 graphToPrompt 不会写进 API 格式的控件
  const SKIP_WIDGETS = new Set([
    "control_after_generate", "videopreview", "upload", "choose video to upload",
    "dt_media_loader_ui", "StatusInfo", "fixed",
  ]);

  const isSubgraph = (type) => SUBGRAPH_RE.test(String(type || ""));

  // 「导出 (API)」格式：顶层直接是 {节点id: {class_type, inputs}}，没有 nodes 数组。
  // LibLib 等第三方站点给的就是这种；判定规则：所有顶层值都是带 class_type 字符串的对象。
  function isApiFormat(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    if (!keys.length) return false;
    return keys.every(k => {
      const v = obj[k];
      return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.class_type === "string";
    });
  }

  function scalarValue(value) {
    if (Array.isArray(value)) return value.map(scalarValue);
    if (value && typeof value === "object") {
      const next = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "img") continue;
        next[k] = scalarValue(v);
      }
      return next;
    }
    return value;
  }

  // 子图展平：把 type 为 UUID 的实例节点替换为 definitions.subgraphs 里的内部节点并重写连线。
  //  - 实例输入槽按 name 对上定义输入 j：外层连线直接接到 j 的全部内部消费者（扇出/嵌套都走同一路径）；
  //    无连线但实例 widgets_values_named 有值的槽，值下发覆盖内部默认 widget
  //  - 实例输出 k：外层连线 origin 改写为定义输出 k 的内部产出节点
  //  - 静音(2) 实例整体丢弃；旁路(4) 实例按类型把输入穿透到输出（与 convert 对普通旁路节点一致）
  //  - 新节点/连线 id 从全局最大值按实例 id、内部节点 id 升序递增，同一文件多次转换结果一致
  //  - 找不到定义的实例保持原样，交给 analyze() 拦截
  function flatten(workflow) {
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return workflow;
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const allDefs = Array.isArray(workflow.definitions?.subgraphs) ? workflow.definitions.subgraphs : [];
    const defById = new Map();
    for (const def of allDefs) if (def && def.id) defById.set(String(def.id), def);
    const instances = nodes.filter(n => n && isSubgraph(String(n.type || "")) && defById.has(String(n.type)));
    if (!instances.length) return workflow;

    let maxId = 0, maxLink = 0;
    const bumpId = v => { const x = Number(v); if (Number.isFinite(x) && x > maxId) maxId = x; };
    const bumpLink = v => { const x = Number(v); if (Number.isFinite(x) && x > maxLink) maxLink = x; };
    for (const n of nodes) bumpId(n && n.id);
    for (const l of workflow.links || []) bumpLink(Array.isArray(l) ? l[0] : l && l.id);
    for (const def of defById.values()) {
      bumpId(def?.state?.lastNodeId); bumpLink(def?.state?.lastLinkId);
      for (const n of def.nodes || []) bumpId(n && n.id);
      for (const l of def.links || []) bumpLink(Array.isArray(l) ? l[0] : l && l.id);
    }
    const ctx = { nextId: () => ++maxId, nextLink: () => ++maxLink };
    const UP = t => String(t || "").toUpperCase();
    const newLinks = [];
    const topComps = new Map();
    const instById = new Map();

    // 子图定义内部 links 是对象，外层是元组；统一成对象处理
    const normLink = l => Array.isArray(l)
      ? { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] }
      : l;

    // 产出/消费者描述：{clone, slot} 普通内部节点；{comp, slot, name} 嵌套子图实例；
    // {extId, slot, name} 外层真实来源；{passthrough, owner} 定义输入直接转输出
    function resolveProducer(desc, type, depth = 0) {
      if (!desc || depth > 64) return null;
      if (desc.clone) return { id: desc.clone.id, slot: desc.slot };
      if (desc.passthrough != null) return resolveProducer((desc.owner.inFeeds || {})[desc.passthrough], type, depth + 1);
      if (desc.comp) {
        const c = desc.comp;
        if (c.mode === 2) return null;
        if (c.mode === 4) {
          const f = c.feeds.get(UP(type)) || [...c.feeds.values()][0] || null;
          return resolveProducer(f, type, depth + 1);
        }
        const k = typeof desc.name === "string" && c.outIndex.has(desc.name) ? c.outIndex.get(desc.name) : Number(desc.slot) || 0;
        return resolveProducer(c.producers[k], type, depth + 1);
      }
      if (desc.extId != null) {
        const c = topComps.get(desc.extId);
        if (!c) return { id: desc.extId, slot: desc.slot };
        return resolveProducer({ comp: c, slot: desc.slot, name: desc.name }, type, depth + 1);
      }
      return null;
    }

    const deferred = []; // 全部接线先记录、最后统一生成连线：解析只读已记录数据，与接线顺序无关
    function wireSink(sink, prod, type) {
      if (sink.child) { feedChild(sink.child, sink.name, sink.slot, prod, type); return; }
      deferred.push({ sink, prod, type });
    }

    // 把产出接到子图组件的输入 j（name 优先定位，槽位号兜底），扇出到该输入的全部消费者
    function feedChild(comp, name, slotIdx, prod, type) {
      if (comp.mode === 2) return;
      if (comp.mode === 4) { comp.feeds.set(UP(type), prod); return; }
      const j = name != null && comp.inIndex.has(String(name)) ? comp.inIndex.get(String(name)) : Number(slotIdx) || 0;
      (comp.inFeeds = comp.inFeeds || {})[j] = prod;
      for (const s of comp.sinks[j] || []) wireSink(s, prod, type);
    }

    function setWidget(comp, name, slotIdx, value) {
      if (comp.mode !== 0) return;
      const j = name != null && comp.inIndex.has(String(name)) ? comp.inIndex.get(String(name)) : Number(slotIdx) || 0;
      for (const s of comp.sinks[j] || []) {
        if (s.child) { setWidget(s.child, s.name, s.slot, value); continue; }
        if (s.name != null && s.clone.widgets_values_named) s.clone.widgets_values_named[s.name] = value;
      }
    }

    function buildComponent(instNode, def) {
      const IN = Number(def?.inputNode?.id ?? -10);
      const OUT = Number(def?.outputNode?.id ?? -20);
      const comp = {
        mode: Number(instNode.mode || 0), defId: String(def.id),
        nodes: [], plain: new Map(), child: new Map(), childNode: new Map(),
        sinks: [], producers: [], feeds: new Map(), inFeeds: {},
        inIndex: new Map((def.inputs || []).map((x, j) => [String(x?.name ?? ""), j])),
        outIndex: new Map((def.outputs || []).map((x, k) => [String(x?.name ?? ""), k])),
        pending: [],
      };
      const innerNodes = (Array.isArray(def.nodes) ? def.nodes : [])
        .filter(n => n && Number.isFinite(n.id) && n.id !== IN && n.id !== OUT)
        .sort((a, b) => a.id - b.id);
      const innerLinks = (Array.isArray(def.links) ? def.links : []).map(normLink)
        .filter(l => l && Number.isFinite(l.id))
        .sort((a, b) => a.id - b.id);
      const innerLinkIds = new Set(innerLinks.map(l => l.id));

      for (const n of innerNodes) {
        const type = String(n.type || "");
        if (isSubgraph(type) && defById.has(type)) {
          const child = buildComponent(n, defById.get(type));
          comp.child.set(n.id, child);
          comp.childNode.set(n.id, n);
          if (child.mode === 0) for (const x of child.nodes) comp.nodes.push(x);
          continue; // 嵌套子图：实例本身不落地，内部节点已并入（静音/旁路的子组件不并入）
        }
        const clone = {
          ...n, id: ctx.nextId(),
          inputs: (n.inputs || []).map(s => s && typeof s === "object" ? { ...s, link: innerLinkIds.has(s.link) ? null : s.link } : s),
          outputs: (n.outputs || []).map(o => o && typeof o === "object" ? { ...o } : o),
          widgets_values_named: n.widgets_values_named && typeof n.widgets_values_named === "object" ? { ...n.widgets_values_named } : n.widgets_values_named,
        };
        comp.plain.set(n.id, clone);
        comp.nodes.push(clone);
      }

      const descOf = (templateId, slot) => {
        if (comp.child.has(templateId)) return { comp: comp.child.get(templateId), slot, name: comp.childNode.get(templateId)?.outputs?.[slot]?.name };
        const clone = comp.plain.get(templateId);
        return clone ? { clone, slot } : null;
      };
      const sinkOf = (templateId, slot) => {
        if (comp.child.has(templateId)) return { child: comp.child.get(templateId), slot, name: comp.childNode.get(templateId)?.inputs?.[slot]?.name };
        const clone = comp.plain.get(templateId);
        return clone ? { clone, slot, name: clone.inputs?.[slot]?.name } : null;
      };

      for (const l of innerLinks) {
        const os = Number(l.origin_slot) || 0, ts = Number(l.target_slot) || 0;
        if (l.origin_id === IN && l.target_id === OUT) {
          if (!comp.producers[ts]) comp.producers[ts] = { passthrough: os, owner: comp };
        } else if (l.origin_id === IN) {
          const sink = sinkOf(l.target_id, ts);
          if (sink) (comp.sinks[os] = comp.sinks[os] || []).push(sink);
        } else if (l.target_id === OUT) {
          if (!comp.producers[ts]) comp.producers[ts] = descOf(l.origin_id, os);
        } else {
          const prod = descOf(l.origin_id, os);
          const sink = sinkOf(l.target_id, ts);
          if (prod && sink) comp.pending.push({ prod, sink, type: l.type });
        }
      }
      return comp;
    }

    function materialize(comp) {
      if (comp.mode !== 0) return;
      for (const child of comp.child.values()) materialize(child);
      for (const w of comp.pending) wireSink(w.sink, w.prod, w.type);
    }

    // 1) 构建并接通各实例的内部结构（顶层外层连线在下一步才喂进来，旁路 feeds 先于解析收集）
    for (const inst of instances.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))) {
      const comp = buildComponent(inst, defById.get(String(inst.type)));
      topComps.set(inst.id, comp);
      instById.set(inst.id, inst);
      materialize(comp);
    }

    // 2) 外层连线：只记录（喂给实例输入 / 旁路 feeds / 待改写的来源），不立即解析
    const outLinks = [];
    const originRews = [];
    const extDesc = (id, slot) => ({
      extId: id, slot,
      name: instById.has(id) ? instById.get(id).outputs?.[slot]?.name : undefined,
    });
    for (const l of workflow.links || []) {
      if (!Array.isArray(l) || l.length < 5) { outLinks.push(l); continue; }
      const [lid, o, os, t, ts, type] = l;
      const targetComp = topComps.get(t);
      if (targetComp) {
        if (targetComp.mode === 2) continue; // 静音：目标消失
        const prod = extDesc(o, Number(os) || 0);
        if (targetComp.mode === 4) { targetComp.feeds.set(UP(type), prod); continue; } // 旁路：留作穿透来源
        feedChild(targetComp, instById.get(t).inputs?.[Number(ts) || 0]?.name, Number(ts) || 0, prod, type);
        continue; // 原元组由内部接线替代
      }
      const srcComp = topComps.get(o);
      if (srcComp) { originRews.push({ lid, comp: srcComp, os: Number(os) || 0, name: instById.get(o).outputs?.[Number(os) || 0]?.name, t, ts, type }); continue; }
      outLinks.push(l);
    }

    // 3) 实例 widget 值下发（无连线的输入槽）
    for (const [id, inst] of instById) {
      const comp = topComps.get(id);
      const named = inst.widgets_values_named;
      if (!comp || comp.mode !== 0 || !named || typeof named !== "object") continue;
      (inst.inputs || []).forEach((slot, idx) => {
        if (!slot || slot.link != null) return;
        const name = String(slot.name ?? "");
        if (!Object.prototype.hasOwnProperty.call(named, name)) return;
        setWidget(comp, name, idx, named[name]);
      });
    }

    // 4) 统一生成连线：此时全部 feed/widget 信息已记录，解析结果与记录顺序无关
    for (const d of deferred) {
      const p = resolveProducer(d.prod, d.type);
      if (!p) continue;
      const lid = ctx.nextLink();
      newLinks.push([lid, p.id, p.slot, d.sink.clone.id, d.sink.slot, d.type]);
      if (d.sink.clone.inputs?.[d.sink.slot]) d.sink.clone.inputs[d.sink.slot].link = lid;
    }
    for (const r of originRews) {
      if (r.comp.mode === 2) continue;
      const prod = resolveProducer({ comp: r.comp, slot: r.os, name: r.name }, r.type);
      if (!prod) continue;
      outLinks.push([r.lid, prod.id, prod.slot, r.t, r.ts, r.type]);
    }

    // 5) 组装：实例替换为内部节点；已消费的子图定义移除（嵌套引用的定义一并保留判断）
    const outNodes = [];
    for (const n of nodes) {
      const comp = topComps.get(n?.id);
      if (comp) { if (comp.mode === 0) outNodes.push(...comp.nodes); continue; }
      outNodes.push(n);
    }
    const consumed = new Set();
    const markConsumed = c => { if (!c || consumed.has(c.defId)) return; consumed.add(c.defId); for (const child of c.child.values()) markConsumed(child); };
    for (const c of topComps.values()) markConsumed(c);
    const restDefs = allDefs.filter(d => d && !consumed.has(String(d.id)));
    const next = { ...workflow, nodes: outNodes, links: [...outLinks, ...newLinks] };
    if (restDefs.length) next.definitions = { ...workflow.definitions, subgraphs: restDefs };
    else delete next.definitions;
    return next;
  }

  function analyze(workflow) {
    // API 格式没有前端节点概念，天然可运行
    if (isApiFormat(workflow)) return { ok: true, blockers: [], nodeCount: Object.keys(workflow).length };
    workflow = flatten(workflow);
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const blockers = [];
    for (const node of nodes) {
      const type = String(node?.type || "");
      if (!type) continue;
      if (isSubgraph(type)) { blockers.push({ kind: "subgraph", type }); continue; }
      if (IGNORED.has(type)) continue;
      if (VIRTUAL.has(type)) { blockers.push({ kind: "virtual", type }); continue; }
      const values = Array.isArray(node?.widgets_values) ? node.widgets_values : [];
      const named = node?.widgets_values_named;
      if (values.length && (!named || typeof named !== "object" || !Object.keys(named).length)) {
        blockers.push({ kind: "legacy-widgets", type });
      }
    }
    const seen = new Map();
    for (const item of blockers) seen.set(item.kind + ":" + item.type, item);
    return { ok: !blockers.length, blockers: [...seen.values()], nodeCount: nodes.length };
  }

  function convert(workflow) {
    // API 格式已是提交格式，深拷贝一份返回（避免后续 combo 自愈改到缓存原文）
    if (isApiFormat(workflow)) return scalarValue(workflow);
    workflow = flatten(workflow);
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const links = Array.isArray(workflow?.links) ? workflow.links : [];
    const byId = new Map();
    for (const node of nodes) if (Number.isFinite(node?.id)) byId.set(node.id, node);
    const linkById = new Map();
    for (const link of links) if (Array.isArray(link) && link.length >= 5) linkById.set(link[0], link);

    // 穿透 Reroute 与旁路节点，找到真正提供数据的上游节点与输出槽
    function resolve(linkId, depth = 0) {
      if (linkId == null || depth > 200) return null;
      const link = linkById.get(linkId);
      if (!link) return null;
      const originId = link[1];
      const originSlot = link[2];
      const source = byId.get(originId);
      if (!source) return null;
      // Reroute 只是转接：真正的数据来自它自己的输入连线，必须往上游追
      if (String(source.type || "") === "Reroute") {
        const upstream = (source.inputs || []).find(item => item?.link != null);
        return resolve(upstream?.link ?? null, depth + 1);
      }
      // 旁路(BYPASS) 节点按「与被请求槽位相同的类型」透传，与官方一致；
      // 找不到同类型时才退化为首个有连线的输入。
      if (Number(source.mode || 0) === 4) {
        const wanted = String(link[5] || "").toUpperCase();
        const connected = (source.inputs || []).filter(item => item?.link != null);
        const matched = connected.find(item => String(item.type || "").toUpperCase() === wanted);
        return resolve((matched || connected[0])?.link ?? null, depth + 1);
      }
      return { id: String(originId), slot: Number(originSlot) || 0 };
    }

    const prompt = {};
    for (const node of nodes) {
      const type = String(node?.type || "");
      if (!type) continue;
      if (IGNORED.has(type) || isSubgraph(type) || VIRTUAL.has(type)) continue;
      const mode = Number(node?.mode || 0);
      if (mode === 2 || mode === 4) continue;

      const inputs = {};
      const named = node.widgets_values_named;
      if (named && typeof named === "object") {
        for (const [name, value] of Object.entries(named)) {
          if (SKIP_WIDGETS.has(name)) continue;
          inputs[name] = scalarValue(value);
        }
      }
      for (const slot of node.inputs || []) {
        if (slot?.link == null) continue;
        const resolved = resolve(slot.link);
        if (!resolved) continue;
        inputs[slot.name] = [resolved.id, resolved.slot];
      }
      prompt[String(node.id)] = { class_type: type, inputs };
    }
    return prompt;
  }

  // 挑出用户可以直接改的标量参数（数字 / 文本 / 布尔）
  function editableFields(prompt) {
    const fields = [];
    for (const [nodeId, node] of Object.entries(prompt || {})) {
      for (const [key, value] of Object.entries(node.inputs || {})) {
        if (Array.isArray(value)) continue;
        if (value && typeof value === "object") continue;
        if (value == null) continue;
        fields.push({ nodeId, key, classType: node.class_type, type: typeof value, value });
      }
    }
    return fields;
  }

  function applyEdits(prompt, edits) {
    const next = {};
    for (const [nodeId, node] of Object.entries(prompt || {})) {
      next[nodeId] = { class_type: node.class_type, inputs: { ...node.inputs } };
    }
    for (const [nodeId, values] of Object.entries(edits || {})) {
      if (!next[nodeId]) continue;
      for (const [key, value] of Object.entries(values || {})) {
        if (!(key in next[nodeId].inputs)) continue;
        if (Array.isArray(next[nodeId].inputs[key])) continue;
        next[nodeId].inputs[key] = value;
      }
    }
    return next;
  }

  // ComfyUI 新版（0.45+）把 mp4 等视频放进 outputs.images 键、VHS 的 webm/gif
  // 放 outputs.gifs，键名不再等于媒体类型；必须按文件名扩展名判定，
  // 否则视频被当图片渲染成 <img src=….mp4>，节点里显示空白。
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|avi|flv|3gp)\b/i;
  const AUDIO_EXT_RE = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus)\b/i;
  const mediaKind = (item) => {
    const name = String(item?.filename || "");
    if (item?.video === true || VIDEO_EXT_RE.test(name)) return "video";
    if (item?.audio === true || AUDIO_EXT_RE.test(name)) return "audio";
    return "image";
  };

  function collectOutputs(historyEntry) {
    const images = [];
    const videos = [];
    const audios = [];
    const texts = [];
    const seen = new Set();
    const pushMedia = (item) => {
      if (!item?.filename) return;
      const key = `${item.subfolder || ""}/${item.filename}|${item.type || ""}`;
      if (seen.has(key)) return; // 同一文件可能同时出现在 images 与 gifs 键
      seen.add(key);
      const kind = mediaKind(item);
      (kind === "video" ? videos : kind === "audio" ? audios : images).push({
        ...item,
        __kind: kind,
      });
    };
    const pushText = value => {
      const text = typeof value === "string" ? value.trim() : "";
      if (text && !texts.includes(text)) texts.push(text);
    };
    for (const nodeOutput of Object.values(historyEntry?.outputs || {})) {
      // 媒体键统一收集后按扩展名分类：images/videos/gifs/audios/audio 都可能出现任意类型
      for (const key of ["images", "videos", "gifs", "audio", "audios"]) {
        const list = nodeOutput?.[key];
        if (Array.isArray(list)) list.forEach(pushMedia);
      }
      // 提示词反推类节点（ShowText/PreviewString 等）把结果放在 outputs.text / outputs.strings
      const rawText = nodeOutput?.text;
      if (Array.isArray(rawText)) rawText.forEach(pushText); else pushText(rawText);
      const rawStrings = nodeOutput?.strings;
      if (Array.isArray(rawStrings)) rawStrings.forEach(pushText); else pushText(rawStrings);
    }
    return { images, videos, audios, texts };
  }

  const api = { analyze, convert, editableFields, applyEdits, collectOutputs, isSubgraph, isApiFormat };
  if (typeof window !== "undefined") window.__MS_COMFY_WORKFLOW__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();