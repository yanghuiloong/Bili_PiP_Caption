/**
 * interceptor.js — Runs in MAIN world (page context)
 * Monkey-patches fetch() and XMLHttpRequest to intercept Bilibili subtitle responses.
 * Sends captured subtitle JSON to the content script via window.postMessage.
 */

(function () {
  'use strict';

  const SUBTITLE_PATTERN = /subtitle|\.bcc|ai_subtitle/i;

  /**
   * Check if a URL looks like a Bilibili subtitle request.
   */
  function isSubtitleUrl(url) {
    return typeof url === 'string' && SUBTITLE_PATTERN.test(url);
  }

  /**
   * Try to extract language code from the subtitle URL.
   * Bilibili URLs often contain patterns like /zh-CN/, /en-US/, /ai-zh/, /ai-en/ etc.
   */
  function extractLangFromUrl(url) {
    // Match patterns like zh-CN, en-US, zh-Hans, ai-zh, ai-en
    const match = url.match(/\/(ai-)?(zh[-_]?[A-Za-z]*|en[-_]?[A-Za-z]*)\//i);
    if (match) {
      const lang = match[2].toLowerCase();
      if (lang.startsWith('zh')) return 'zh';
      if (lang.startsWith('en')) return 'en';
    }
    // Also check query params or filename patterns
    if (/zh/i.test(url)) return 'zh';
    if (/en/i.test(url)) return 'en';
    return 'unknown';
  }

  /**
   * Parse and dispatch subtitle data.
   */
  function dispatchSubtitle(jsonData, url) {
    const lang = extractLangFromUrl(url);
    window.postMessage({
      type: 'BILIBILI_SUBTITLE',
      payload: jsonData,
      lang: lang,
      url: url
    }, '*');
    console.log(`[Interceptor] Captured subtitle (${lang}) from: ${url}`);
  }

  /**
   * Safely parse text as JSON, returns null if not valid JSON.
   */
  function safeParse(text) {
    const trimmed = (text || '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // ─── Override fetch ───────────────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    const response = await originalFetch.apply(this, args);

    if (isSubtitleUrl(url)) {
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        const json = safeParse(text);
        if (json) {
          dispatchSubtitle(json, url);
        }
      } catch (err) {
        // Silently ignore — non-critical
      }
    }

    return response;
  };

  // ─── Override XMLHttpRequest ──────────────────────────────────────
  const XHR = XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    this._interceptUrl = String(url);
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XHR.prototype.send = function (...args) {
    if (isSubtitleUrl(this._interceptUrl)) {
      this.addEventListener('load', function () {
        try {
          const json = safeParse(this.responseText);
          if (json) {
            dispatchSubtitle(json, this._interceptUrl);
          }
        } catch (err) {
          // Silently ignore
        }
      });
    }
    return originalSend.apply(this, args);
  };

  console.log('[Interceptor] Bilibili subtitle interceptor installed.');
})();