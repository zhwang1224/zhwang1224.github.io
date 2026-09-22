(function() {
  var root = document.getElementById('visitor-stats');
  if (!root) return;

  var lang = (document.documentElement.lang || 'zh-CN').toLowerCase();
  var zh = lang.indexOf('zh') === 0;
  var liveUrl = 'https://visitor-map-worker.visitor-map-worker.workers.dev/visitors';
  var snapshotUrl = '/stat/visitors.json';
  var text = zh ? {
    loading: '正在读取访问记录…',
    total: '累计访问',
    places: '国家/地区',
    updated: '最近更新',
    today: '今日',
    week: '近 7 日',
    place: '国家/地区',
    visits: '访问次数',
    share: '占比',
    last: '最近访问',
    empty: '还没有访问记录。',
    failed: '暂时读不到访问记录。',
    live: '数字来自实时记录。',
    copy: '当前是随站点发布的副本。实时接口没有连上。',
    unknown: '未知'
  } : {
    loading: 'Loading visitor records…',
    total: 'Total visits',
    places: 'Places',
    updated: 'Last update',
    today: 'Today',
    week: 'Last 7 days',
    place: 'Place',
    visits: 'Visits',
    share: 'Share',
    last: 'Last visit',
    empty: 'No visits recorded yet.',
    failed: 'Visitor records are unavailable.',
    live: 'Figures come from the live record.',
    copy: 'This is the copy published with the site. The live endpoint did not respond.',
    unknown: 'Unknown'
  };

  var aliases = {
    XX: text.unknown,
    HK: zh ? '中国香港' : 'Hong Kong',
    MO: zh ? '中国澳门' : 'Macao',
    TW: zh ? '中国台湾' : 'Taiwan',
    GB: zh ? '英国' : '',
    US: zh ? '美国' : '',
    KR: zh ? '韩国' : '',
    RU: zh ? '俄罗斯' : ''
  };

  root.innerHTML = '<p class="visitor-stats-status">' + text.loading + '</p>'
    + '<div class="visitor-stats-summary"></div>'
    + '<div class="visitor-stats-daily"></div>'
    + '<div class="visitor-stats-table"></div>';

  var statusEl = root.querySelector('.visitor-stats-status');
  var summaryEl = root.querySelector('.visitor-stats-summary');
  var dailyEl = root.querySelector('.visitor-stats-daily');
  var tableEl = root.querySelector('.visitor-stats-table');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function(ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function placeName(code, fallback) {
    if (aliases[code]) return aliases[code];
    try {
      var display = new Intl.DisplayNames([zh ? 'zh-CN' : 'en'], { type: 'region' });
      return display.of(code) || fallback || code;
    } catch (error) {
      return fallback || code;
    }
  }

  function formatTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  }

  function normalize(data) {
    var raw = data && data.visitors;
    var rows = [];
    if (Array.isArray(raw)) {
      rows = raw.map(function(row) {
        return {
          code: String(row.code || 'XX'),
          name: row.name || '',
          count: Number(row.count) || 0,
          updatedAt: row.updatedAt || null
        };
      });
    } else if (raw && typeof raw === 'object') {
      rows = Object.keys(raw).map(function(code) {
        var row = raw[code] || {};
        return {
          code: code,
          name: row.name || '',
          count: Number(row.count) || 0,
          updatedAt: row.updatedAt || null
        };
      });
    }
    rows.sort(function(a, b) {
      return b.count - a.count || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    var summary = data && data.summary || {};
    var total = summary.total == null
      ? rows.reduce(function(sum, row) { return sum + row.count; }, 0)
      : Number(summary.total);
    var updatedAt = summary.updatedAt || rows.reduce(function(latest, row) {
      return row.updatedAt > latest ? row.updatedAt : latest;
    }, '') || null;
    return {
      summary: {
        total: total,
        today: summary.today == null ? null : Number(summary.today),
        last7Days: summary.last7Days == null ? null : Number(summary.last7Days),
        countries: summary.countries == null
          ? rows.filter(function(row) { return row.code !== 'XX'; }).length
          : Number(summary.countries),
        updatedAt: updatedAt
      },
      rows: rows,
      daily: Array.isArray(data && data.daily) ? data.daily : []
    };
  }

  function render(data, live) {
    var view = normalize(data);
    var cards = [
      [view.summary.total, text.total],
      [view.summary.countries, text.places],
      [formatTime(view.summary.updatedAt), text.updated]
    ];
    if (view.summary.today != null) cards.splice(1, 0, [view.summary.today, text.today]);
    if (view.summary.last7Days != null) cards.splice(view.summary.today == null ? 1 : 2, 0, [view.summary.last7Days, text.week]);
    summaryEl.innerHTML = cards.map(function(item) {
      return '<div class="visitor-stats-card"><b>' + escapeHtml(item[0]) + '</b><span>'
        + escapeHtml(item[1]) + '</span></div>';
    }).join('');
    statusEl.textContent = live ? text.live : text.copy;

    var maxDaily = view.daily.reduce(function(max, row) {
      return Math.max(max, Number(row.count) || 0);
    }, 0);
    dailyEl.innerHTML = maxDaily ? '<ol>' + view.daily.map(function(row) {
      var count = Number(row.count) || 0;
      var width = Math.max(4, Math.round(count / maxDaily * 100));
      return '<li><span>' + escapeHtml(String(row.day || '').slice(5)) + '</span>'
        + '<span class="visitor-stats-bar"><i style="width:' + width + '%"></i></span>'
        + '<span>' + escapeHtml(count) + '</span></li>';
    }).join('') + '</ol>' : '';

    if (!view.rows.length) {
      tableEl.innerHTML = '<p>' + text.empty + '</p>';
      return;
    }
    var body = view.rows.map(function(row) {
      var share = view.summary.total
        ? (row.count / view.summary.total * 100).toFixed(1) + '%'
        : '—';
      return '<tr><td>' + escapeHtml(placeName(row.code, row.name)) + '</td><td>' + escapeHtml(row.count)
        + '</td><td>' + escapeHtml(share) + '</td><td>' + escapeHtml(formatTime(row.updatedAt)) + '</td></tr>';
    }).join('');
    tableEl.innerHTML = '<table><thead><tr><th>' + text.place + '</th><th>' + text.visits
      + '</th><th>' + text.share + '</th><th>' + text.last + '</th></tr></thead><tbody>'
      + body + '</tbody></table>';
  }

  function load(url, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeout);
    return fetch(url, { signal: controller.signal }).then(function(response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    }).finally(function() {
      clearTimeout(timer);
    });
  }

  load(snapshotUrl, 8000).then(function(data) {
    render(data, false);
    return load(liveUrl, 4000).then(function(live) {
      if (live && live.visitors) render(live, true);
    }).catch(function() {});
  }).catch(function() {
    return load(liveUrl, 8000).then(function(live) {
      render(live, true);
    }).catch(function() {
      statusEl.textContent = text.failed;
    });
  });
}());
