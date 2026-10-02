import type { NativeNotificationMessage } from './notification-policy'
import { FOCUS_RETRY_INTERVAL_MS, FOCUS_TIMEOUT_MS } from '@/config/constants'
import { isRecord, isTrustedOrigin } from './bridge-protocol'

export type NativeWebViewMessage
  = | NativeNotificationMessage
    | { type: 'dsh://bridge-ready' }
    | { type: 'dsh://focus-result', requestId: string, handled: boolean }

export function parseNativeMessage(raw: string, nativeUrl: string, expectedOrigin: string, nonce: string): NativeWebViewMessage | null {
  if (raw.length > 16384 || !isTrustedOrigin(nativeUrl, expectedOrigin))
    return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.channel !== 'dsh-bridge' || value.nonce !== nonce || value.origin !== expectedOrigin)
      return null
    const payload = value.payload
    if (!isRecord(payload))
      return null
    if (payload.type === 'dsh://bridge-ready')
      return { type: 'dsh://bridge-ready' }
    if (payload.type === 'dsh://focus-result') {
      if (typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128 || typeof payload.handled !== 'boolean')
        return null
      return { type: 'dsh://focus-result', requestId: payload.requestId, handled: payload.handled }
    }
    if (payload.type !== 'dsh://native-notification')
      return null
    if (typeof payload.title !== 'string' || typeof payload.body !== 'string')
      return null
    if (!payload.title.trim() || payload.title.length > 256 || payload.body.length > 4096)
      return null
    if (payload.tag !== undefined && (typeof payload.tag !== 'string' || payload.tag.length > 256))
      return null
    if (payload.sessionId !== undefined && (typeof payload.sessionId !== 'string' || payload.sessionId.length > 256))
      return null
    if (payload.silent !== undefined && typeof payload.silent !== 'boolean')
      return null
    return {
      type: 'dsh://native-notification',
      title: payload.title,
      body: payload.body,
      tag: String(payload.tag ?? ''),
      sessionId: String(payload.sessionId ?? ''),
      silent: payload.silent === true,
    }
  }
  catch {
    return null
  }
}

export function createNotificationShim(origin: string, nonce: string): string {
  return `
(function () {
  var expectedOrigin = ${JSON.stringify(origin)};
  var nonce = ${JSON.stringify(nonce)};
  if (window.top !== window || location.origin !== expectedOrigin) return;
  if (window.__dshBridgeNonce === nonce) {
    if (typeof window.__dshBridgeReady === 'function') window.__dshBridgeReady();
    return;
  }
  window.__dshBridgeNonce = nonce;
  var instances = new Map();
  var hidden = document.hidden;
  var sequence = 0;
  var pendingFocus = null;
  var focusStartedAt = 0;
  var focusTimer = null;
  var results = new Map();
  function send(payload) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      channel: 'dsh-bridge', origin: expectedOrigin, nonce: nonce, payload: payload
    }));
  }
  function sessionIdFromTag(tag) {
    var match = /^dsh-notification-(?:pending-)?(.+)-\\d+$/.exec(tag || '');
    return match ? match[1] : '';
  }
  function DshNotification(title, options) {
    options = options || {};
    this.title = String(title || '');
    this.body = String(options.body || '');
    this.tag = String(options.tag || ('mobile-' + Date.now() + '-' + (++sequence)));
    this.onclick = null;
    this.onclose = null;
    this.onaction = null;
    instances.set(this.tag, this);
    if (instances.size > 128) instances.delete(instances.keys().next().value);
    send({
      type: 'dsh://native-notification', title: this.title, body: this.body,
      tag: this.tag, sessionId: options.sessionId || sessionIdFromTag(this.tag),
      silent: options.silent === true
    });
  }
  DshNotification.permission = 'granted';
  DshNotification.requestPermission = function () { return Promise.resolve('granted'); };
  DshNotification.prototype.close = function () { instances.delete(this.tag); };
  window.Notification = DshNotification;
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return hidden; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return hidden ? 'hidden' : 'visible'; } });
  } catch (_) {}
  window.addEventListener('message', function (event) {
    if (event.origin !== expectedOrigin || event.source !== window) return;
    var data = event.data;
    if (data && data.type === 'dsh://native-notification') send(data);
  });
  function focusResult(data, handled) {
    results.set(data.requestId, handled);
    if (results.size > 32) results.delete(results.keys().next().value);
    send({ type: 'dsh://focus-result', requestId: data.requestId, handled: handled });
  }
  function openSession(sessionId) {
    if (!sessionId) return true;
    var ctx = window.__dshClientCtx;
    try {
      var workspace = ctx && (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : ctx.uiWorkspace);
      if (workspace && typeof workspace.openSession === 'function') {
        workspace.openSession(sessionId);
        return true;
      }
    } catch (_) {}
    // Why: DSH 0.1.6 moved session selection from sessions.open to uiWorkspace.openSession.
    try {
      var sessions = ctx && ctx.sessions;
      if (sessions && typeof sessions.open === 'function') {
        sessions.open(sessionId);
        return true;
      }
    } catch (_) {}
    var nodes = document.querySelectorAll('[data-row-key]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-row-key') === 'session:' + sessionId) {
        nodes[i].click();
        return true;
      }
    }
    return false;
  }
  function tryFocus() {
    focusTimer = null;
    var data = pendingFocus;
    if (!data) return;
    if (!hidden && document.readyState === 'complete' && openSession(data.sessionId)) {
      pendingFocus = null;
      var instance = instances.get(data.tag);
      if (instance) {
        instances.delete(data.tag);
        try { if (typeof instance.onclick === 'function') instance.onclick(new Event('click')); } catch (_) {}
      }
      window.dispatchEvent(new MessageEvent('message', { data: data, origin: expectedOrigin, source: window }));
      focusResult(data, true);
      return;
    }
    if (Date.now() - focusStartedAt >= ${FOCUS_TIMEOUT_MS}) {
      pendingFocus = null;
      focusResult(data, false);
      return;
    }
    focusTimer = setTimeout(tryFocus, ${FOCUS_RETRY_INTERVAL_MS});
  }
  window.__dshBridgeReceive = function (data) {
    if (!data || data.nonce !== nonce) return;
    if (data.type === 'dsh://visibility-state') {
      if (hidden !== !!data.hidden) {
        hidden = !!data.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      }
    }
    if (data.type === 'dsh://notification-clicked') {
      var instance = instances.get(data.tag);
      if (instance) {
        instances.delete(data.tag);
        if (typeof instance.onclick === 'function') instance.onclick(new Event('click'));
      }
      window.dispatchEvent(new MessageEvent('message', { data: data, origin: expectedOrigin }));
    }
    if (data.type === 'dsh://cancel-focus' && pendingFocus && pendingFocus.requestId === data.requestId) {
      pendingFocus = null;
      clearTimeout(focusTimer);
      focusTimer = null;
    }
    if (data.type === 'dsh://focus-session' && typeof data.requestId === 'string' && data.requestId && typeof data.sessionId === 'string' && typeof data.tag === 'string') {
      if (results.has(data.requestId)) {
        send({ type: 'dsh://focus-result', requestId: data.requestId, handled: results.get(data.requestId) });
        return;
      }
      clearTimeout(focusTimer);
      pendingFocus = { type: data.type, requestId: data.requestId, sessionId: data.sessionId, tag: data.tag, title: data.title };
      focusStartedAt = Date.now();
      tryFocus();
    }
  };
  var readySent = false;
  function ready() {
    if (!readySent && window.ReactNativeWebView && document.readyState === 'complete'
      && (window.__DSH_BOOT__ || window.__dshClientCtx || document.getElementById('loginForm'))) {
      readySent = true;
      send({ type: 'dsh://bridge-ready' });
    }
  }
  window.__dshBridgeReady = ready;
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });
  window.addEventListener('pagehide', function () {
    pendingFocus = null;
    clearTimeout(focusTimer);
  }, { once: true });
})(); true;
`
}

export function nativeMessageScript(origin: string, nonce: string, payload: Record<string, unknown>): string {
  return `if (window.top === window && location.origin === ${JSON.stringify(origin)} && window.__dshBridgeNonce === ${JSON.stringify(nonce)}) { window.__dshBridgeReceive && window.__dshBridgeReceive(${JSON.stringify({ ...payload, nonce })}); } true;`
}
