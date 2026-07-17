chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (
    msg?.type === "AIC_STATE" ||
    msg?.type === "AIC_SELECTION_CHANGED" ||
    msg?.type === "AIC_CONTRAST_CHANGED"
  ) {
    // Relay page updates so the popup (if open) can refresh.
    chrome.runtime.sendMessage(msg).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
