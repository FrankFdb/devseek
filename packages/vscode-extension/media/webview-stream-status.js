// Stream rendering throttle and status polling helpers for the DevSeek webview.

function settleReadyProgress() {
  if (readySettled) return;
  readySettled = true;
  if (readyProgressEl) readyProgressEl.classList.add('done');
}

function clearStreamRenderTimer() {
  if (streamRenderTimer) { clearTimeout(streamRenderTimer); streamRenderTimer = null; }
  if (streamRenderRafId) { cancelAnimationFrame(streamRenderRafId); streamRenderRafId = null; }
  streamRenderPending = false;
}

function clearAnalysisRenderTimer() {
  if (analysisRenderTimer) { clearTimeout(analysisRenderTimer); analysisRenderTimer = null; }
  if (analysisRenderRafId) { cancelAnimationFrame(analysisRenderRafId); analysisRenderRafId = null; }
  analysisRenderPending = false;
  analysisRenderBody = null;
}

function renderStreamingBubbleNow() {
  if (!currentBubble) return;
  currentBubble.innerHTML = renderAssistantMarkdown(currentRaw) + '<span class="cursor"></span>';
  pruneEmptyRenderedBlocks(currentBubble);
  streamRenderPending = false;
}

// Hybrid setTimeout+rAF: setTimeout enforces the throttle window so we don't
// spin rAF frames while waiting; rAF defers DOM work to a paint boundary and
// pauses automatically when the webview tab is hidden.
function scheduleStreamingBubbleRender() {
  if (!currentBubble || suppressGeneratedStreaming) return;
  if (streamRenderPending) return;
  streamRenderPending = true;
  var elapsed = Date.now() - streamLastRenderTs;
  var delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
  streamRenderTimer = setTimeout(function() {
    streamRenderTimer = null;
    streamRenderRafId = requestAnimationFrame(function() {
      streamRenderRafId = null;
      if (!streamRenderPending) return;
      streamLastRenderTs = Date.now();
      renderStreamingBubbleNow();
      maybeScrollToBottom();
    });
  }, delay);
}

function scheduleAnalysisBodyRender(body) {
  if (!body) return;
  // If pending for a different body (new container), cancel and reschedule.
  if (analysisRenderPending && analysisRenderBody && analysisRenderBody !== body) {
    clearAnalysisRenderTimer();
  }
  if (analysisRenderPending) return;
  analysisRenderPending = true;
  analysisRenderBody = body;
  var elapsed = Date.now() - analysisLastRenderTs;
  var delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
  analysisRenderTimer = setTimeout(function() {
    analysisRenderTimer = null;
    analysisRenderRafId = requestAnimationFrame(function() {
      analysisRenderRafId = null;
      var b = analysisRenderBody;
      analysisRenderPending = false;
      analysisRenderBody = null;
      if (!b || !b.isConnected) return;
      analysisLastRenderTs = Date.now();
      b.innerHTML = renderAgentMarkdown(b._raw) + '<span class="cursor"></span>';
      pruneEmptyRenderedBlocks(b);
      scrollAgentProgressToBottom();
    });
  }, delay);
}

// ---- 状态栏：登录状态轮询 ----
function pollStatus() {
  vscode.postMessage({ type: 'getStatus' });
}

function scheduleStatusPoll(immediate) {
  if (statusPollTimer) clearTimeout(statusPollTimer);
  statusPollTimer = setTimeout(function() {
    pollStatus();
    scheduleStatusPoll(false);
  }, immediate ? 0 : (document.hidden ? STATUS_POLL_MS_HIDDEN : STATUS_POLL_MS_ACTIVE));
}
