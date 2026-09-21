(function () {
  var API = 'https://visitor-map-worker.visitor-map-worker.workers.dev';
  var CLIENT_ID_KEY = 'visitor-map-client-id-v1';
  var RECORDED_KEY_PREFIX = 'visitor-map-recorded-v2-';
  var promise;
  var memoryClientId;

  function apiUrl(path) {
    return API.replace(/\/$/, '') + path;
  }

  function shanghaiDateKey() {
    var parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }

  function recordedKey() {
    return RECORDED_KEY_PREFIX + shanghaiDateKey();
  }

  function hasRecordedToday() {
    try {
      return localStorage.getItem(recordedKey()) === '1';
    } catch (error) {
      return false;
    }
  }

  function markRecordedToday() {
    try {
      localStorage.setItem(recordedKey(), '1');
    } catch (error) {}
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    return 'fallback-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function clientId() {
    try {
      var stored = localStorage.getItem(CLIENT_ID_KEY);
      if (stored) return stored;
      stored = randomId();
      localStorage.setItem(CLIENT_ID_KEY, stored);
      return stored;
    } catch (error) {
      memoryClientId = memoryClientId || randomId();
      return memoryClientId;
    }
  }

  function request(path, options) {
    var headers = { Accept: 'application/json' };
    if (options && options.headers) {
      Object.keys(options.headers).forEach(function (key) {
        headers[key] = options.headers[key];
      });
    }

    return fetch(apiUrl(path), Object.assign({
      mode: 'cors',
      credentials: 'omit',
      headers: headers
    }, options, { headers: headers })).then(function (response) {
      if (!response.ok) throw new Error('visitor api failed: ' + response.status);
      return response.json();
    });
  }

  function fetchVisitors() {
    return request('/visitors');
  }

  function record() {
    if (promise) return promise;
    if (hasRecordedToday()) return Promise.resolve(null);

    promise = request('/visit', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: clientId(),
        path: window.location.pathname
      })
    }).then(function (payload) {
      markRecordedToday();
      return payload;
    }).catch(function (error) {
      promise = null;
      throw error;
    });

    return promise;
  }

  window.VisitorMap = {
    fetchVisitors: fetchVisitors,
    record: record
  };

  record().catch(function (error) {
    console.warn('访问统计暂时不可用', error);
  });
})();
