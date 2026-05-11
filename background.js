/**
 * background.js — Service Worker
 * Uses Native Messaging to launch/kill Electron overlay.
 * Uses WebSocket for real-time subtitle data.
 */
(() => {
  'use strict';

  const NM_HOST = 'com.bili_pip_caption';
  const WS_URL = 'ws://127.0.0.1:18520';
  const WS_RETRY = 500;
  const WS_MAX_RETRIES = 20;

  let nativePort = null;
  let ws = null;
  let wsConnected = false;
  let wsRetries = 0;
  let wsRetryTimer = null;
  const ports = new Set();

  // ─── WebSocket ─────────────────────────────────────────────────
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        wsConnected = true;
        wsRetries = 0;
        broadcastToPorts({ type: 'overlay-status', connected: true });
        broadcastToPorts({ type: 'overlay-visibility', visible: true });
      };
      ws.onmessage = (e) => {
        try { broadcastToPorts(JSON.parse(e.data)); } catch (_) {}
      };
      ws.onclose = () => {
        wsConnected = false;
        ws = null;
        // Retry if native host is still running
        if (nativePort && wsRetries < WS_MAX_RETRIES) {
          wsRetries++;
          wsRetryTimer = setTimeout(connectWebSocket, WS_RETRY);
        } else {
          broadcastToPorts({ type: 'overlay-status', connected: false });
          broadcastToPorts({ type: 'overlay-visibility', visible: false });
        }
      };
      ws.onerror = () => ws?.close();
    } catch (_) {
      if (nativePort && wsRetries < WS_MAX_RETRIES) {
        wsRetries++;
        wsRetryTimer = setTimeout(connectWebSocket, WS_RETRY);
      }
    }
  }

  function sendToOverlay(data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  // ─── Native Messaging (process lifecycle) ──────────────────────
  function startOverlay() {
    if (nativePort) return; // already running
    try {
      nativePort = chrome.runtime.connectNative(NM_HOST);
      nativePort.onDisconnect.addListener(() => {
        console.log('[BG] Native host disconnected:', chrome.runtime.lastError?.message);
        nativePort = null;
        clearTimeout(wsRetryTimer);
        ws?.close();
        wsConnected = false;
        broadcastToPorts({ type: 'overlay-status', connected: false });
        broadcastToPorts({ type: 'overlay-visibility', visible: false });
      });
      // Give Electron time to start, then connect WebSocket
      wsRetries = 0;
      setTimeout(connectWebSocket, 800);
    } catch (e) {
      console.error('[BG] Failed to start native host:', e);
      nativePort = null;
    }
  }

  function stopOverlay() {
    clearTimeout(wsRetryTimer);
    ws?.close();
    nativePort?.disconnect();
    nativePort = null;
    wsConnected = false;
    broadcastToPorts({ type: 'overlay-status', connected: false });
    broadcastToPorts({ type: 'overlay-visibility', visible: false });
  }

  // ─── Port management ──────────────────────────────────────────
  function broadcastToPorts(msg) {
    for (const p of ports) {
      try { p.postMessage(msg); } catch (_) { ports.delete(p); }
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'subtitle-stream') return;
    ports.add(port);

    // Send current state
    port.postMessage({ type: 'overlay-status', connected: wsConnected });
    port.postMessage({ type: 'overlay-visibility', visible: wsConnected && !!nativePort });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'toggle-overlay') {
        if (nativePort) stopOverlay();
        else startOverlay();
      } else if (msg.type === 'stop-overlay') {
        stopOverlay();
      } else if (msg.type === 'subtitle-text') {
        sendToOverlay(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      ports.delete(port);
      // Auto-stop overlay if all video pages are closed
      if (ports.size === 0 && nativePort) {
        stopOverlay();
      }
    });
  });
})();
