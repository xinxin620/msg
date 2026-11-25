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
  // 纯前端节点：官方 graphToPrompt 不会写进 API 格式，忽略即可。
  // 只放本机 object_info 里查不到的类（真·前端节点）。ShowText|pysssss、
  // Display Int (rgthree) 曾被误列这里——它们是服务端节点且 output_node=true，
  // 列进来会让「靠它们出文本」的工作流转出 0 个输出节点，提交必报 Prompt has no outputs。
  const IGNORED = new Set([
    "Note", "MarkdownNote", "Reroute",
    "Fast Groups Muter (rgthree)", "Fast Groups Bypasser (rgthree)", "Label (rgthree)",
  ]);
  // object_info 里存在的类绝不按前端节点跳过（第三方包同名/改名时以服务端为准）
  function isFrontendOnly(type, types) {
    if (!IGNORED.has(String(type || ""))) return false;
    return !(types && Object.prototype.hasOwnProperty.call(types, String(type)));
  }
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

  // KJNodes 的 Set/Get（前端成对取值，服务端无此类）：官方 graphToPrompt 把 Get 的全部消费者
  // 改接到「同名 Set 的上游连线」，Set/Get 自身不进 API 格式。这里复刻同一规则：
  //  名字取 widgets_values_named.Constant（旧存档回退 widgets_values[0]）；
  //  只改写消费连线 [origin_id, origin_slot]，link id 不动（多条连线可共享同一上游）；
  //  找不到同名 Set 的 Get 原样留下，交给 analyze() 按 VIRTUAL 拦截。
  const SET_TYPE = "SetNode", GET_TYPE = "GetNode";
  function setGetName(node) {
    const named = node?.widgets_values_named;
    if (named && typeof named === "object" && typeof named.Constant === "string" && named.Constant.trim()) {
      return named.Constant.trim();
    }
    const v = (Array.isArray(node?.widgets_values) ? node.widgets_values : [])[0];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  }
  function resolveSetGet(workflow) {
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return workflow;
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const sets = nodes.filter(n => String(n?.type || "") === SET_TYPE);
    if (!sets.length) return workflow;
    const srcOf = new Map();
    for (const n of sets) {
      if (Number(n?.mode || 0) !== 0) continue; // 静音/旁路的 Set 不作为来源
      const k = setGetName(n);
      const slot = (n.inputs || []).find(s => s && s.link != null);
      if (!k || !slot || srcOf.has(k)) continue;
      srcOf.set(k, slot.link);
    }
    const links = (Array.isArray(workflow.links) ? workflow.links : []).map(l => Array.isArray(l) ? [...l] : l);
    const linkById = new Map();
    for (const l of links) if (Array.isArray(l) && l.length >= 5) linkById.set(l[0], l);
    const linked = new Set(); // 被改接命中的 Set，仅这些连同 Set 一起丢弃
    for (const n of nodes) {
      if (String(n?.type || "") !== GET_TYPE) continue;
      const k = setGetName(n);
      const srcLink = srcOf.has(k) ? linkById.get(srcOf.get(k)) : null;
      if (!srcLink) continue; // 无同名 Set 的 Get：保留，交 analyze 拦
      linked.add(k);
      for (const lid of (n.outputs || []).flatMap(o => Array.isArray(o?.links) ? o.links : [])) {
        const l = linkById.get(lid);
        if (!Array.isArray(l) || l.length < 5) continue;
        l[1] = srcLink[1]; l[2] = srcLink[2];
        if (!l[5]) l[5] = srcLink[5];
      }
    }
    return {
      ...workflow,
      links,
      nodes: nodes.filter(n => {
        const t = String(n?.type || "");
        return !((t === SET_TYPE || t === GET_TYPE) && linked.has(setGetName(n)));
      }),
    };
  }

  function analyze(workflow) {
    // API 格式没有前端节点概念，天然可运行
    if (isApiFormat(workflow)) return { ok: true, blockers: [], nodeCount: Object.keys(workflow).length };
    workflow = resolveSetGet(flatten(workflow));
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

  function convert(workflow, options) {
    // API 格式已是提交格式，深拷贝一份返回（避免后续 combo 自愈改到缓存原文）
    if (isApiFormat(workflow)) return scalarValue(workflow);
    workflow = resolveSetGet(flatten(workflow));
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const links = Array.isArray(workflow?.links) ? workflow.links : [];
    // 分组开关：画布说了算。offGroups 是被关闭的组名。
    // 归属用「节点中心点落在 group.bounding 内」判定（与 rgthree 一致）。
    // 关键：节点在「启用」的组里时，即使它在工作流文件里被旁路(mode=4)也强制纳入本次生成
    //（画布开关盖过工作流自带的 rgthree 旁路）；在「关闭」的组里则整体排除。
    const offGroups = Array.isArray(options?.offGroups) ? options.offGroups : [];
    const groups = Array.isArray(workflow?.groups) ? workflow.groups : [];
    const offSet = new Set(offGroups.map(String));
    const groupTitleOf = node => {
      if (!groups.length) return null;
      const p = node?.pos || [0, 0], s = node?.size || [0, 0];
      const cx = p[0] + s[0] / 2, cy = p[1] + s[1] / 2;
      for (const g of groups) {
        const b = g?.bounding; if (!b) continue;
        if (cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3]) return String(g.title || "");
      }
      return null;
    };
    const inOffGroup = node => { const t = groupTitleOf(node); return !!t && offSet.has(t); };
    // mode=4 是否算「旁路」：在未关闭的分组里 → 画布已启用，不算旁路（救活）；
    // 无分组或在被关闭的分组里 → 按原样（后者反正会被整体排除）。mute(2) 始终尊重。
    const isBypassed = node => {
      if (Number(node?.mode || 0) !== 4) return false;
      const t = groupTitleOf(node);
      return !(t && !offSet.has(t));
    };
    const byId = new Map();
    for (const node of nodes) if (Number.isFinite(node?.id)) byId.set(node.id, node);
    const linkById = new Map();
    for (const link of links) if (Array.isArray(link) && link.length >= 5) linkById.set(link[0], link);

    // 纯前端注释/展示节点（如「孤海注释」这类第三方注释卡）：object_info 查不到该类，
    // 且没有任何连线 → 服务端执行时它本来就不参与，官方 graphToPrompt 也不会写进 API 格式。
    // 逐个点名 IGNORED 永远列不全，这里按结构判定统一剔除；否则会被缺节点预检误拦。
    // 有连线的未知类不剔除（真没装的自定义节点要交给 missingClasses 报出来）。
    function isUnwiredUnknown(node, types) {
      if (!types) return false;
      const type = String(node?.type || "");
      if (!type || (types && Object.prototype.hasOwnProperty.call(types, type))) return false;
      const hasIn = (node.inputs || []).some(s => s && s.link != null);
      const hasOut = (node.outputs || []).some(o => o && Array.isArray(o.links) && o.links.length);
      return !hasIn && !hasOut;
    }

    // 某节点最终是否进 API 格式（关组/静音/旁路/前端节点都不进）。
    // 画布开关优先：节点在「启用」的组里时，工作流里的旁路(mode=4)被无视（救活）。
    // resolve 用它判断上游是否还在：上游被关，下游对该上游的连线必须丢弃，
    // 否则引用一个不在 prompt 里的节点 id，ComfyUI 校验直接报错。
    function nodeKept(node) {
      if (!node) return false;
      const type = String(node?.type || "");
      if (!type || isSubgraph(type) || VIRTUAL.has(type)) return false;
      if (isFrontendOnly(type, options?.types)) return false;
      if (isUnwiredUnknown(node, options?.types)) return false;
      if (Number(node?.mode || 0) === 2) return false; // 静音始终尊重
      if (inOffGroup(node)) return false;              // 画布关闭的组：整体排除
      if (isBypassed(node)) return false;              // 真旁路（不在启用组里）
      return true;
    }

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
      // 真·旁路节点按「与被请求槽位相同的类型」透传，与官方一致：
      // 只有当它有一个与被请求类型同类型的输入连线时才往上追；否则判定它提供不了该数据，
      // 连线作废返回 null（调用方保留自身 widget 默认值）。绝不退化去钻第一个有连线的输入——
      // 那样会把旁路节点 LATENT 上游的 INT（如 ResolutionSelector.width）当成 IMAGE 吐给
      // SaveImage，运行时报 'int' object is not subscriptable（liang-moss 文生图实测踩中）。
      // 注意：在「启用」组里的 mode=4 节点已被画布救活，不走这里（isBypassed=false → 落到 nodeKept）。
      if (isBypassed(source)) {
        const wanted = String(link[5] || "").toUpperCase();
        const matched = (source.inputs || []).find(item => item?.link != null && String(item.type || "").toUpperCase() === wanted);
        return matched ? resolve(matched.link, depth + 1) : null;
      }
      // 上游被关组/静音 → 该连线作废（返回 null，调用方保留自身 widget 默认值）
      if (!nodeKept(source)) return null;
      return { id: String(originId), slot: Number(originSlot) || 0 };
    }

    const prompt = {};
    for (const node of nodes) {
      const type = String(node?.type || "");
      if (!type) continue;
      if (!nodeKept(node)) continue; // 前端/子图/虚拟/静音/关闭组/真旁路 统一由 nodeKept 判定（画布开关优先）

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
      // 被画布救活的旁路节点：ComfyUI 端它仍是 bypass 模式会自己透传，但我们已把它当普通节点
      // 连好输入输出，这里按原 class_type 提交即可（mode 不进 API 格式，ComfyUI 只看 prompt 结构）。
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

  // API 格式 prompt 里是否存在「输出节点」：ComfyUI 要求至少一个 output_node=true 的节点，
  // 否则 /prompt 直接 400「Prompt has no outputs」。types = object_info 全量。
  // 判不准就不拦（返回 true 交给 ComfyUI 报准确错）：拿不到 types，或任一节点 class 在 object_info
  // 里查不到（自定义节点没加载，本就该由 ComfyUI 报「节点不存在」；且未知类本身可能就是输出节点）。
  // 只有「全部节点 class 都已知、且都不是输出节点」才判定无输出。
  // 名称兜底：VHS_VideoCombine 等自定义产出节点在部分版本 object_info 里不标 output_node，
  // 只看标志位会把补帧/合成类工作流误拦成「无输出节点」。
  const OUTPUT_NAME_RE = /(save|combine|preview|show|display|export)/i;
  function hasOutputNode(prompt, types) {
    if (!prompt || !types) return true;
    const nodes = Object.values(prompt);
    if (!nodes.length) return true;
    for (const node of nodes) {
      const def = types[node && node.class_type];
      if (!def) return true; // 有查不到的类 → 判不准，不拦
      if (def.output_node === true) return true;
    }
    return nodes.some(node => OUTPUT_NAME_RE.test(String((node && node.class_type) || "")));
  }

  // 提交图里没有输出节点时，给出末端节点（不被任何输入引用）的 class 列表，报错能指名道姓
  function sinkClasses(prompt) {
    const refs = new Set();
    for (const node of Object.values(prompt || {})) {
      for (const value of Object.values((node && node.inputs) || {})) {
        if (Array.isArray(value)) refs.add(String(value[0]));
      }
    }
    return [...new Set(Object.entries(prompt || {})
      .filter(([id]) => !refs.has(id))
      .map(([, node]) => node && node.class_type).filter(Boolean))];
  }

  // 本机 object_info 里查不到的 class_type（＝自定义节点没装）。ComfyUI /prompt 按同一份注册表
  // 校验并抛 missing_node_type（英文 400），这里提前列出缺哪几个，报错能指名道姓并给出路。
  // types 取不到时返回空（判不准不拦，交给 ComfyUI 报准确错）。
  function missingClasses(prompt, types) {
    if (!prompt || !types) return [];
    const out = [];
    for (const node of Object.values(prompt)) {
      const cls = node && node.class_type;
      if (cls && !types[cls] && !out.includes(cls)) out.push(cls);
    }
    return out;
  }

  // 按工作流真实旁路态算「首次加载时该显示为关闭」的组名：
  // 组内中心点命中的节点里只要存在 mode=4（被 rgthree 旁路），就判定这组当前是关的。
  // 用于选工作流时给画布分组开关播种初值，做到「首次启用/关闭与工作流里面保持一致」。
  function seedOffGroups(workflow) {
    const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
    const groups = Array.isArray(workflow?.groups) ? workflow.groups : [];
    const off = [];
    for (const g of groups) {
      const b = g?.bounding; if (!b) continue;
      const title = String(g.title || "").trim(); if (!title || off.includes(title)) continue;
      const bypassed = nodes.some(n => {
        const p = n?.pos || [0, 0], s = n?.size || [0, 0];
        const cx = p[0] + s[0] / 2, cy = p[1] + s[1] / 2;
        return cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3] && Number(n?.mode || 0) === 4;
      });
      if (bypassed) off.push(title);
    }
    return off;
  }

  const api = { analyze, convert, editableFields, applyEdits, collectOutputs, isSubgraph, isApiFormat, hasOutputNode, sinkClasses, missingClasses, seedOffGroups };
  if (typeof window !== "undefined") window.__MS_COMFY_WORKFLOW__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();