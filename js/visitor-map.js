(function () {
  var API = 'https://visitor-map-worker.visitor-map-worker.workers.dev';
  var promise;

  function apiUrl(path) {
    return API.replace(/\/$/, '') + path;
  }

  function todayKey() {
    return 'visitor-map-recorded-' + new Date().toISOString().slice(0, 10);
  }

  function hasRecordedToday() {
    try {
      return localStorage.getItem(todayKey()) === '1';
    } catch (error) {
      return false;
    }
  }

  function markRecordedToday() {
    try {
      localStorage.setItem(todayKey(), '1');
    } catch (error) {}
  }

  function request(path, options) {
    return fetch(apiUrl(path), options).then(function (response) {
      if (!response.ok) throw new Error('visitor api failed: ' + response.status);
      return response.json();
    });
  }

  function fetchVisitors() {
    return request('/visitors', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
  }

  function record() {
    if (promise) return promise;

    if (hasRecordedToday()) {
      promise = fetchVisitors();
      return promise;
    }

    promise = request('/visit', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: '{}'
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
