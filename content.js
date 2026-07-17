(() => {
  if (window.__aicInstalled) return;
  window.__aicInstalled = true;

  const STATE_KEY = "aicActive";
  const CONTRAST_KEY = "aicContrast";

  let active = false;
  let selectedEl = null;
  let hoverEl = null;
  let contrast = 100;
  let hud = null;
  let liveEl = null;
  let sliderEl = null;
  let valueEl = null;

  /** @type {WeakMap<Element, { originalFilter: string, contrast: number }>} */
  const imageState = new WeakMap();

  function toast(msg) {
    let t = document.getElementById("aic-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "aic-toast";
      t.className = "aic-toast";
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("aic-toast-show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("aic-toast-show"), 1400);
  }

  function isOurUi(el) {
    return !!(el && el.closest && (el.closest("#aic-hud") || el.closest("#aic-toast")));
  }

  function findImage(el) {
    if (!el || el.nodeType !== 1) return null;
    if (isOurUi(el)) return null;

    if (el.tagName === "IMG" || el.tagName === "IMAGE") return el;

    // Walk up: handle cases like <picture><img> or wrappers around <img>.
    return el.closest?.("img, image") || null;
  }

  function ensureImageState(el) {
    let state = imageState.get(el);
    if (!state) {
      state = {
        originalFilter: el.style.filter || "",
        contrast: 100,
      };
      imageState.set(el, state);
    }
    return state;
  }

  function applyContrastTo(el, value) {
    const state = ensureImageState(el);
    state.contrast = value;
    const pct = Math.max(0, Math.min(200, value));
    const contrastFilter = `contrast(${pct}%)`;
    const base = state.originalFilter.trim();
    // Drop any previous contrast() we may have applied; keep other filters.
    const cleaned = base.replace(/\bcontrast\([^)]*\)\s*/gi, "").trim();
    el.style.filter = cleaned ? `${cleaned} ${contrastFilter}` : contrastFilter;
  }

  function setHover(el) {
    if (hoverEl && hoverEl !== selectedEl) {
      hoverEl.classList.remove("aic-hover");
    }
    hoverEl = el;
    if (hoverEl && hoverEl !== selectedEl) {
      hoverEl.classList.add("aic-hover");
    }
  }

  function clearHover() {
    if (hoverEl && hoverEl !== selectedEl) {
      hoverEl.classList.remove("aic-hover");
    }
    hoverEl = null;
  }

  function setSelected(el) {
    if (selectedEl) {
      selectedEl.classList.remove("aic-selected");
    }
    selectedEl = el;
    if (selectedEl) {
      selectedEl.classList.remove("aic-hover");
      selectedEl.classList.add("aic-selected");
      const state = ensureImageState(selectedEl);
      contrast = state.contrast;
      syncHudControls();
      toast("Image selected");
    } else {
      contrast = 100;
      syncHudControls();
    }
    broadcastSelection();
  }

  function syncHudControls() {
    if (sliderEl) sliderEl.value = String(contrast);
    if (valueEl) valueEl.textContent = `${contrast}%`;
    if (sliderEl) sliderEl.disabled = !selectedEl;
    if (hud) {
      hud.querySelectorAll("[data-need-selection]").forEach((btn) => {
        btn.disabled = !selectedEl;
      });
    }
    if (liveEl) {
      if (selectedEl) {
        const w = Math.round(selectedEl.naturalWidth || selectedEl.clientWidth || 0);
        const h = Math.round(selectedEl.naturalHeight || selectedEl.clientHeight || 0);
        liveEl.textContent = w && h ? `Selected · ${w}×${h}` : "Selected image";
      } else if (active) {
        liveEl.textContent = "Hover an image, then click to select";
      } else {
        liveEl.textContent = "Inactive";
      }
    }
  }

  function getSnapshot() {
    return {
      active,
      hasSelection: !!selectedEl,
      contrast,
    };
  }

  function broadcastSelection() {
    const payload = { type: "AIC_SELECTION_CHANGED", ...getSnapshot() };
    try {
      chrome.storage.session.set({
        [STATE_KEY]: active,
        [CONTRAST_KEY]: contrast,
      });
    } catch {
      /* ignore */
    }
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function broadcastState() {
    const payload = { type: "AIC_STATE", ...getSnapshot() };
    try {
      chrome.storage.session.set({ [STATE_KEY]: active });
    } catch {
      /* ignore */
    }
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function broadcastContrast() {
    const payload = {
      type: "AIC_CONTRAST_CHANGED",
      contrast,
      hasSelection: !!selectedEl,
      active,
    };
    try {
      chrome.storage.session.set({ [CONTRAST_KEY]: contrast });
    } catch {
      /* ignore */
    }
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function setContrast(value) {
    contrast = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
    if (selectedEl) {
      applyContrastTo(selectedEl, contrast);
    }
    syncHudControls();
    broadcastContrast();
    return getSnapshot();
  }

  function resetContrast() {
    return setContrast(100);
  }

  function clearSelection() {
    setSelected(null);
    return getSnapshot();
  }

  function ensureUI() {
    if (hud) return;

    hud = document.createElement("div");
    hud.id = "aic-hud";
    hud.className = "aic-hud aic-hidden";
    hud.innerHTML = `
      <div class="aic-hud-header">
        <strong>Adjust Contrast</strong>
        <div class="aic-hud-actions">
          <button type="button" data-action="reset" data-need-selection title="Reset to 100%">Reset</button>
          <button type="button" data-action="deselect" data-need-selection title="Deselect image">Deselect</button>
          <button type="button" data-action="stop" title="Exit">✕</button>
        </div>
      </div>
      <div class="aic-hud-live" id="aic-live">Hover an image, then click to select</div>
      <div class="aic-hud-slider">
        <div class="aic-hud-slider-head">
          <span>Contrast</span>
          <span id="aic-value">100%</span>
        </div>
        <input id="aic-slider" type="range" min="0" max="200" value="100" step="1" disabled />
        <div class="aic-hud-slider-labels"><span>0%</span><span>100%</span><span>200%</span></div>
      </div>
      <div class="aic-hud-hint">Esc to exit · Click another image to switch</div>
    `;

    document.documentElement.appendChild(hud);
    liveEl = hud.querySelector("#aic-live");
    sliderEl = hud.querySelector("#aic-slider");
    valueEl = hud.querySelector("#aic-value");

    hud.addEventListener("mousedown", (e) => e.stopPropagation());
    hud.addEventListener("mouseup", (e) => e.stopPropagation());
    hud.addEventListener("click", onHudClick);
    sliderEl.addEventListener("input", () => {
      setContrast(Number(sliderEl.value));
    });
  }

  function onHudClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const action = btn.dataset.action;
    if (action === "stop") {
      setActive(false);
      return;
    }
    if (action === "reset") {
      resetContrast();
      toast("Reset to 100%");
      return;
    }
    if (action === "deselect") {
      clearSelection();
      toast("Deselected");
    }
  }

  function setActive(next) {
    active = !!next;
    ensureUI();

    document.documentElement.classList.toggle("aic-active", active);
    hud.classList.toggle("aic-hidden", !active);

    if (!active) {
      clearHover();
      if (selectedEl) {
        selectedEl.classList.remove("aic-selected");
        // Keep contrast filter on the image; only remove selection chrome.
        selectedEl = null;
      }
      syncHudControls();
    } else {
      syncHudControls();
      toast("Click an image to adjust contrast");
    }

    broadcastState();
  }

  function onMouseMove(e) {
    if (!active) return;
    if (isOurUi(e.target)) {
      clearHover();
      return;
    }
    const img = findImage(e.target);
    if (img) setHover(img);
    else clearHover();
  }

  function onClick(e) {
    if (!active) return;
    if (isOurUi(e.target)) return;

    const img = findImage(e.target);
    if (!img) {
      toast("Click an image");
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    clearHover();
    setSelected(img);
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setActive(false);
    }
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "AIC_TOGGLE") {
      setActive(!active);
      sendResponse(getSnapshot());
      return true;
    }
    if (msg?.type === "AIC_SET") {
      setActive(!!msg.active);
      sendResponse(getSnapshot());
      return true;
    }
    if (msg?.type === "AIC_GET") {
      sendResponse(getSnapshot());
      return true;
    }
    if (msg?.type === "AIC_SET_CONTRAST") {
      sendResponse(setContrast(msg.contrast));
      return true;
    }
    if (msg?.type === "AIC_RESET") {
      sendResponse(resetContrast());
      return true;
    }
    if (msg?.type === "AIC_CLEAR_SELECTION") {
      sendResponse(clearSelection());
      return true;
    }
    return false;
  });

  chrome.storage.session.get([STATE_KEY], (data) => {
    if (data[STATE_KEY]) setActive(true);
  });
})();
