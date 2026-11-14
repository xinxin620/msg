(() => {
  const KEY = 'manshiguang:canvas-text-api-profiles';
  const PATCHED = 'ms-txt-patched-v90';

  function getModels() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      const profile = (data.profiles || []).find(p => p.id === data.activeId);
      if (!profile) return [];
      const catalog = Array.isArray(profile.modelCatalog) ? profile.modelCatalog : [];
      const selected = Array.isArray(profile.selectedModels) ? profile.selectedModels : [];
      const re = /tts|text-to-speech|speech|voice|audio[-_.]?(?:gen|synthesis)|t2a|cosyvoice|sambert|volctts|minimax[-_.]?tts|eleven|fish[-_.]?speech|chat[-_.]?tts|doubao[-_.]?speech|paraformer/i;
      return selected.filter(m => catalog.includes(m) && !re.test(m));
    } catch (e) { return []; }
  }

  function applyPanel(panel) {
    if (panel.classList.contains(PATCHED)) return;
    panel.classList.add(PATCHED);

    const models = getModels();
    if (models.length === 0) return;

    const selectors = panel.querySelectorAll('.action-panel__model-select');
    if (selectors.length === 0) return;

    const modelSelector = selectors[0];

    const spans = modelSelector.querySelectorAll('span:not([class])');
    if (spans.length > 0) spans[0].textContent = models[0];

    let dropdown = modelSelector.querySelector('.action-panel__dropdown--model');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'action-panel__dropdown action-panel__dropdown--model';
      modelSelector.appendChild(dropdown);
    }

    dropdown.innerHTML = '';
    models.forEach((m, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-panel__dropdown-item' + (idx === 0 ? ' active' : '');

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.innerHTML = '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'action-panel__model-info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = m;
      infoDiv.appendChild(nameSpan);

      btn.appendChild(svg);
      btn.appendChild(infoDiv);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.action-panel--text').forEach(p => {
          const sel = p.querySelector('.action-panel__model-select');
          if (sel) {
            const sp = sel.querySelector('span:not([class])');
            if (sp) sp.textContent = m;
          }
        });
        modelSelector.classList.remove('is-open');
      });

      dropdown.appendChild(btn);
    });

    console.log('[Patch v90] Applied:', models);
  }

  setTimeout(() => {
    document.querySelectorAll('.action-panel--text:not(.' + PATCHED + ')').forEach(applyPanel);
  }, 500);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.classList && node.classList.contains('action-panel--text')) {
              applyPanel(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll('.action-panel--text').forEach(applyPanel);
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      document.querySelectorAll('.' + PATCHED).forEach(el => el.classList.remove(PATCHED));
      document.querySelectorAll('.action-panel--text').forEach(applyPanel);
    }
  });

  console.log('[Patch v20261114-90] Ready');
})();