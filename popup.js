const toggleBtn = document.getElementById("toggle-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const slider = document.getElementById("contrast-slider");
const contrastValue = document.getElementById("contrast-value");
const resetBtn = document.getElementById("reset-btn");
const deselectBtn = document.getElementById("deselect-btn");

let active = false;
let hasSelection = false;
let contrast = 100;

function renderStatus() {
  statusDot.classList.toggle("on", active && !hasSelection);
  statusDot.classList.toggle("selected", hasSelection);
  if (hasSelection) {
    statusText.textContent = "Image selected — adjust contrast";
  } else if (active) {
    statusText.textContent = "Selecting — click an image on the page";
  } else {
    statusText.textContent = "Inactive";
  }
  toggleBtn.textContent = active ? "Stop Selecting" : "Start Selecting";
  toggleBtn.classList.toggle("on", active);
}

function renderControls() {
  slider.disabled = !hasSelection;
  resetBtn.disabled = !hasSelection;
  deselectBtn.disabled = !hasSelection;
  slider.value = String(contrast);
  contrastValue.textContent = `${contrast}%`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "AIC_GET" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function sendToTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No active tab found");
  if (!/^https?:/i.test(tab.url || "") && !/^file:/i.test(tab.url || "")) {
    throw new Error("This page is not supported (use a regular webpage)");
  }
  const ok = await ensureContentScript(tab.id);
  if (!ok) throw new Error("Could not inject script. Refresh the page and try again");
  return chrome.tabs.sendMessage(tab.id, message);
}

function applyState(res) {
  active = !!res?.active;
  hasSelection = !!res?.hasSelection;
  contrast = typeof res?.contrast === "number" ? res.contrast : 100;
  renderStatus();
  renderControls();
}

async function refresh() {
  try {
    const res = await sendToTab({ type: "AIC_GET" });
    applyState(res);
  } catch (err) {
    active = false;
    hasSelection = false;
    contrast = 100;
    renderStatus();
    renderControls();
    statusText.textContent = err.message || "Could not connect to page";
  }
}

toggleBtn.addEventListener("click", async () => {
  try {
    const res = await sendToTab({ type: "AIC_TOGGLE" });
    applyState(res);
    if (res?.active) window.close();
  } catch (err) {
    statusText.textContent = err.message || "Operation failed";
  }
});

slider.addEventListener("input", async () => {
  const value = Number(slider.value);
  contrast = value;
  contrastValue.textContent = `${value}%`;
  try {
    await sendToTab({ type: "AIC_SET_CONTRAST", contrast: value });
  } catch (err) {
    statusText.textContent = err.message || "Could not update contrast";
  }
});

resetBtn.addEventListener("click", async () => {
  try {
    const res = await sendToTab({ type: "AIC_RESET" });
    applyState(res);
    statusText.textContent = "Reset to 100%";
  } catch (err) {
    statusText.textContent = err.message || "Reset failed";
  }
});

deselectBtn.addEventListener("click", async () => {
  try {
    const res = await sendToTab({ type: "AIC_CLEAR_SELECTION" });
    applyState(res);
  } catch (err) {
    statusText.textContent = err.message || "Deselect failed";
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "AIC_STATE" || msg?.type === "AIC_SELECTION_CHANGED") {
    active = !!msg.active;
    hasSelection = !!msg.hasSelection;
    if (typeof msg.contrast === "number") contrast = msg.contrast;
    renderStatus();
    renderControls();
  }
  if (msg?.type === "AIC_CONTRAST_CHANGED") {
    if (typeof msg.contrast === "number") {
      contrast = msg.contrast;
      renderControls();
    }
  }
});

refresh();
