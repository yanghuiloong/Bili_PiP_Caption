/**
 * content.js — Runs in ISOLATED world
 * Intercepts subtitles, monitors video, injects toggle button into B站 toolbar.
 */
(() => {
  'use strict';

  let currentSubtitles = [];
  let videoElement = null;
  let lastSubtitleText = null;
  let isOverlayConnected = false;
  let isOverlayVisible = false;
  let lastUrl = location.href;
  let port = null;

  function isVideoPage() {
    return location.href.includes('/video/') || location.href.includes('/bangumi/');
  }

  // ─── Port connection to background ─────────────────────────────
  function ensurePort() {
    if (port) return;
    if (!isVideoPage()) return;
    try {
      port = chrome.runtime.connect({ name: 'subtitle-stream' });
      port.onMessage.addListener((msg) => {
        if (msg.type === 'overlay-status') {
          isOverlayConnected = msg.connected;
          updateButtonState();
        }
        if (msg.type === 'overlay-visibility') {
          const justOpened = !isOverlayVisible && msg.visible;
          isOverlayVisible = msg.visible;
          updateButtonState();
          
          if (justOpened) {
            lastSubtitleText = null; // Force update to push current text immediately
            onTimeUpdate();
          }
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        isOverlayConnected = false;
        isOverlayVisible = false;
        updateButtonState();
        setTimeout(ensurePort, 2000);
      });
    } catch (e) {
      console.warn('[Content] Failed to connect to background:', e);
    }
  }

  function sendToBackground(data) {
    ensurePort();
    if (port) {
      try { port.postMessage(data); } catch (e) { port = null; }
    }
  }

  // ─── Binary search ─────────────────────────────────────────────
  function getCurrentSubtitle(time, subs) {
    if (!subs || subs.length === 0) return null;
    let lo = 0, hi = subs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const s = subs[mid];
      if (time >= s.from && time <= s.to) return s.content;
      if (time < s.from) hi = mid - 1;
      else lo = mid + 1;
    }
    return null;
  }

  // ─── Video monitoring ──────────────────────────────────────────
  function onTimeUpdate() {
    if (!videoElement) return;

    if (!currentSubtitles || currentSubtitles.length === 0) {
      if (lastSubtitleText !== null) {
        lastSubtitleText = null;
        sendToBackground({ type: 'subtitle-text', text: '' });
      }
      return;
    }

    const text = getCurrentSubtitle(videoElement.currentTime, currentSubtitles);
    if (text !== lastSubtitleText) {
      lastSubtitleText = text;
      sendToBackground({ type: 'subtitle-text', text: text || '' });
    }
  }

  function setupVideoListener() {
    const v = document.querySelector('video');
    if (v === videoElement) return;
    
    if (videoElement) {
      videoElement.removeEventListener('timeupdate', onTimeUpdate);
      // Video element disappeared (e.g. mini-player closed), clear subtitle
      sendToBackground({ type: 'subtitle-text', text: '' });
      lastSubtitleText = null;
    }
    
    videoElement = v;
    if (videoElement) {
      videoElement.addEventListener('timeupdate', onTimeUpdate);
    }
  }

  // ─── UI ────────────────────────────────────────────────────────
  function updateButtonState() {
    const btn = document.getElementById('bili-pip-btn');
    if (!btn) return;
    const dot = btn.querySelector('.pip-dot');
    const label = btn.querySelector('.pip-label');

    // Button is ALWAYS clickable — clicking starts/stops the overlay via Native Messaging
    btn.style.cursor = 'pointer';

    if (isOverlayVisible) {
      btn.style.opacity = '1';
      btn.title = '点击关闭悬浮字幕';
      if (dot) dot.style.background = '#00c853';
      if (label) label.textContent = '字幕悬浮';
      btn.style.background = 'rgba(0,161,214,0.2)';
    } else {
      btn.style.opacity = '0.85';
      btn.title = '点击开启悬浮字幕';
      if (dot) dot.style.background = '#999';
      if (label) label.textContent = '字幕悬浮';
      btn.style.background = 'rgba(255,255,255,0.06)';
    }
  }

  function findToolbarContainer() {
    const shareBtn = document.querySelector('[aria-label*="转发"]');
    if (shareBtn) {
      let parent = shareBtn.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const style = window.getComputedStyle(parent);
        if (style.display === 'flex' && parent.children.length >= 3) return parent;
        parent = parent.parentElement;
      }
    }
    for (const sel of ['.video-toolbar-left-main', '.video-toolbar-left', '#toolbar_module .toolbar-left']) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.children.length >= 3 && div.children.length <= 10) {
        const text = div.textContent;
        if (text.includes('投币') && text.includes('收藏') && !div.querySelector('#bili-pip-controls')) return div;
      }
    }
    return null;
  }

  function injectControls() {
    if (!isVideoPage()) return;
    if (document.getElementById('bili-pip-controls')) return;
    const toolbar = findToolbarContainer();

    const wrapper = document.createElement('div');
    wrapper.id = 'bili-pip-controls';

    const btn = document.createElement('div');
    btn.id = 'bili-pip-btn';
    btn.innerHTML = `<span class="pip-dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff9800;margin-right:5px;"></span><span class="pip-label">字幕悬浮</span>`;

    btn.addEventListener('click', () => {
      sendToBackground({ type: 'toggle-overlay' });
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = isOverlayVisible ? 'rgba(0,161,214,0.2)' : 'rgba(255,255,255,0.06)'; });

    if (toolbar) {
      wrapper.style.cssText = 'display:inline-flex;align-items:center;margin-left:12px;padding-left:12px;border-left:1px solid rgba(255,255,255,0.12);height:36px;flex-shrink:0;';
      btn.style.cssText = 'display:inline-flex;align-items:center;padding:4px 12px;cursor:pointer;font-size:13px;color:#e1e1e1;border-radius:6px;white-space:nowrap;transition:all 0.2s;user-select:none;background:rgba(255,255,255,0.06);';
      wrapper.appendChild(btn);
      toolbar.appendChild(wrapper);
    } else {
      wrapper.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:999999;display:flex;align-items:center;background:rgba(24,25,28,0.92);color:#e1e1e1;padding:8px 14px;border-radius:22px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.4);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.08);';
      btn.style.cssText = 'display:flex;align-items:center;cursor:pointer;font-weight:600;white-space:nowrap;padding:4px 8px;border-radius:6px;transition:all 0.2s;';
      wrapper.appendChild(btn);
      document.body?.appendChild(wrapper);
    }
    updateButtonState();
  }

  // ─── SPA navigation ────────────────────────────────────────────
  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    currentSubtitles = [];
    lastSubtitleText = null;
    const old = document.getElementById('bili-pip-controls');
    if (old) old.remove();

    if (!isVideoPage()) {
      if (port) {
        port.disconnect();
        port = null;
        isOverlayConnected = false;
        isOverlayVisible = false;
      }
    } else {
      sendToBackground({ type: 'subtitle-text', text: '' });
    }
  }

  setInterval(() => {
    onNavigate();
    if (isVideoPage()) {
      ensurePort();
      setupVideoListener();
      injectControls();
    }
  }, 1000);

  // ─── Subtitle data from interceptor ────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'BILIBILI_SUBTITLE') return;
    const { payload } = event.data;
    const body = payload?.body || payload?.data?.body;
    if (Array.isArray(body) && body.length > 0) {
      currentSubtitles = body;
      console.log(`[Content] Stored ${body.length} subtitle entries.`);
      lastSubtitleText = null;
      onTimeUpdate();
    }
  });

  if (isVideoPage()) {
    ensurePort();
    setupVideoListener();
  }
})();