(() => {
  "use strict";

  // 把 ComfyUI 保存的「编辑格式」工作流（nodes/links）转换成提交用的「API 格式」。
  // 规则以 ComfyUI 官方前端 graphToPrompt 的真实输出为基准逐字段对账：
  //  - 静音(2)/旁路(4) 节点跳过，旁路节点的连线穿透到真正的上游
  //  - Note / MarkdownNote / Reroute 属于前端节点，不进 API 格式
  //  - 子图（type 为 UUID）与前端虚拟节点无法安全展开，直接判为不可运行
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

  function analyze(workflow) {
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

  function collectOutputs(historyEntry) {
    const images = [];
    const videos = [];
    for (const nodeOutput of Object.values(historyEntry?.outputs || {})) {
      for (const image of nodeOutput?.images || []) {
        if (image?.filename) images.push({ ...image, __kind: "image" });
      }
      for (const video of nodeOutput?.videos || []) {
        if (video?.filename) videos.push({ ...video, __kind: "video" });
      }
    }
    return { images, videos };
  }

  const api = { analyze, convert, editableFields, applyEdits, collectOutputs, isSubgraph };
  if (typeof window !== "undefined") window.__MS_COMFY_WORKFLOW__ = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();