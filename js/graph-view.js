(function () {
  'use strict';

  var STORAGE_KEY = 'graph-visited';
  var I18N = {
    zh: {
      title: '图谱视图',
      global: '全局图谱',
      search: '搜索文章、标签或分类',
      tags: '标签',
      cats: '分类',
      close: '关闭',
      empty: '暂无图谱数据',
      loading: '正在生成图谱…',
      hint: '拖拽节点 · 滚轮缩放 · 点击打开',
      local: '关联图谱',
      localAria: '当前条目的关联图谱',
      openGlobal: '打开全局图谱',
      meta: function (posts, tags, cats) {
        return posts + ' 篇文章 · ' + tags + ' 个标签 · ' + cats + ' 个分类';
      }
    },
    en: {
      title: 'Graph View',
      global: 'Global Graph',
      search: 'Search posts, tags, or categories',
      tags: 'Tags',
      cats: 'Categories',
      close: 'Close',
      empty: 'No graph data yet',
      loading: 'Building graph…',
      hint: 'Drag nodes · scroll to zoom · click to open',
      local: 'Graph',
      localAria: 'Local graph of the current page',
      openGlobal: 'Open global graph',
      meta: function (posts, tags, cats) {
        return posts + ' posts · ' + tags + ' tags · ' + cats + ' categories';
      }
    }
  };

  var dataPromise = null;
  var overlayView = null;
  var localViews = [];
  var lastFocus = null;

  function t() {
    var lang = (document.documentElement.lang || '').toLowerCase();
    return lang.indexOf('en') === 0 ? I18N.en : I18N.zh;
  }

  function normalizePath(value) {
    if (!value) return '';
    var path = String(value).trim();
    try { path = decodeURIComponent(path); } catch (error) { /* keep */ }
    path = path.split('#')[0].split('?')[0].replace(/index\.html$/i, '');
    if (path.charAt(0) !== '/') path = '/' + path;
    path = path.replace(/\/{2,}/g, '/');
    if (path.length > 1 && path.charAt(path.length - 1) !== '/') path += '/';
    return path;
  }

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getVisited() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (error) {
      return new Set();
    }
  }

  function addVisited(id) {
    if (!id) return;
    var visited = getVisited();
    visited.add(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(visited)));
    } catch (error) { /* quota */ }
  }

  function loadData(url) {
    if (!dataPromise) {
      dataPromise = fetch(url, { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('graph data ' + res.status);
        return res.json();
      });
    }
    return dataPromise;
  }

  function cssVar(el, name, fallback) {
    var value = getComputedStyle(el).getPropertyValue(name).trim();
    return value || fallback;
  }

  function currentNodeId(data, hintPath) {
    var path = normalizePath(hintPath || location.pathname);
    path = path.replace(/\/page\/\d+\/?$/, '/');
    if (path.indexOf('/en/') === 0) {
      path = path.slice(3);
      if (path.charAt(0) !== '/') path = '/' + path;
    }
    for (var i = 0; i < data.nodes.length; i++) {
      if (normalizePath(data.nodes[i].path) === path) return data.nodes[i].id;
    }
    return null;
  }

  function neighbourhood(data, originId, depth, showTags, showCats, minTagDegree, maxNodes) {
    var links = data.links;
    var nodesById = new Map();
    var degree = new Map();
    data.nodes.forEach(function (node) {
      nodesById.set(node.id, node);
      degree.set(node.id, 0);
    });
    links.forEach(function (link) {
      degree.set(link.source, (degree.get(link.source) || 0) + 1);
      degree.set(link.target, (degree.get(link.target) || 0) + 1);
    });

    function allowed(node) {
      if (!node) return false;
      if (node.type === 'tag') {
        if (!showTags) return false;
        if (minTagDegree > 1 && (degree.get(node.id) || 0) < minTagDegree) return false;
      }
      if (node.type === 'category' && !showCats) return false;
      return true;
    }

    var keep = new Set();
    if (depth < 0 || !originId || !nodesById.has(originId)) {
      data.nodes.forEach(function (node) {
        if (allowed(node)) keep.add(node.id);
      });
    } else {
      keep.add(originId);
      var frontier = [originId];
      for (var d = 0; d < depth; d++) {
        var next = [];
        frontier.forEach(function (id) {
          links.forEach(function (link) {
            var other = link.source === id ? link.target : (link.target === id ? link.source : null);
            if (!other || keep.has(other)) return;
            if (!allowed(nodesById.get(other))) return;
            keep.add(other);
            next.push(other);
          });
        });
        frontier = next;
      }
    }

    var nodes = [];
    keep.forEach(function (id) {
      var node = nodesById.get(id);
      if (node) nodes.push({
        id: node.id,
        type: node.type,
        title: node.title,
        path: node.path,
        degree: degree.get(node.id) || 0
      });
    });

    var nodeSet = new Set(nodes.map(function (n) { return n.id; }));
    var graphLinks = links.filter(function (link) {
      return nodeSet.has(link.source) && nodeSet.has(link.target);
    }).map(function (link) {
      return { source: link.source, target: link.target, type: link.type };
    });

    if (maxNodes && nodes.length > maxNodes) {
      var origin = nodes.filter(function (n) { return n.id === originId; });
      var hubs = nodes.filter(function (n) { return n.id !== originId && n.type !== 'post'; });
      var posts = nodes.filter(function (n) { return n.id !== originId && n.type === 'post'; })
        .sort(function (a, b) { return b.degree - a.degree; });
      var picked = origin.concat(hubs);
      var room = Math.max(0, maxNodes - picked.length);
      nodes = picked.concat(posts.slice(0, room));
      nodeSet = new Set(nodes.map(function (n) { return n.id; }));
      graphLinks = graphLinks.filter(function (link) {
        return nodeSet.has(link.source) && nodeSet.has(link.target);
      });
    }

    return { nodes: nodes, links: graphLinks };
  }

  function GraphView(container, data, options) {
    this.container = container;
    this.data = data;
    this.options = options || {};
    this.stopped = false;
    this.alpha = 1;
    this.k = this.options.scale || 1;
    this.tx = 0;
    this.ty = 0;
    this.hoverId = null;
    this.dragId = null;
    this.panning = false;
    this.moved = false;
    this.pointers = new Map();
    this.pinch = null;
    this.query = '';
    this.raf = 0;
    this.visited = getVisited();
    this.currentId = this.options.currentId || null;
    this.showTags = this.options.showTags !== false;
    this.showCats = this.options.showCats !== false;
    this.minTagDegree = this.options.minTagDegree || 1;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'polite');
    container.innerHTML = '';
    container.appendChild(this.canvas);
    container.appendChild(this.live);

    this.onResize = this.resize.bind(this);
    this.onPointerDown = this.pointerDown.bind(this);
    this.onPointerMove = this.pointerMove.bind(this);
    this.onPointerUp = this.pointerUp.bind(this);
    this.onWheel = this.wheel.bind(this);
    this.onClick = this.click.bind(this);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('dblclick', function (event) { event.preventDefault(); });

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(this.onResize);
      this.ro.observe(container);
    } else {
      window.addEventListener('resize', this.onResize);
    }

    this.resize();
    this.rebuild();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  GraphView.prototype.rebuild = function () {
    var graph = neighbourhood(
      this.data,
      this.currentId,
      this.options.depth,
      this.showTags,
      this.showCats,
      this.options.depth < 0 ? this.minTagDegree : 1,
      this.options.maxNodes
    );
    var byId = new Map();
    var compact = this.options.compact;
    graph.nodes.forEach(function (node, index) {
      var seed = hashString(node.id);
      var angle = (seed / 4294967295) * Math.PI * 2;
      var radius = (compact ? 10 : 24) + (hashString(node.id + ':r') / 4294967295) * (compact ? 42 : 140);
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
      node.index = index;
      node.r = nodeRadius(node, node.id === this.currentId, compact ? 0.82 : 1);
      byId.set(node.id, node);
    }, this);
    graph.links.forEach(function (link) {
      link.source = byId.get(link.source);
      link.target = byId.get(link.target);
    });
    this.nodes = graph.nodes.filter(Boolean);
    this.links = graph.links.filter(function (link) { return link.source && link.target; });
    this.alpha = 1;
    if (this.options.reducedMotion) {
      for (var i = 0; i < 180; i++) this.tick();
      this.alpha = 0;
    }
  };

  GraphView.prototype.colors = function () {
    var el = this.container;
    return {
      bg: cssVar(el, '--graph-bg', '#fff'),
      text: cssVar(el, '--graph-text', '#333'),
      link: cssVar(el, '--graph-link', 'rgba(128,138,160,.35)'),
      post: cssVar(el, '--graph-post', '#8a96a8'),
      visited: cssVar(el, '--graph-post-visited', '#5b8def'),
      current: cssVar(el, '--graph-current', '#37c6c0'),
      tag: cssVar(el, '--graph-tag', '#8b7cc8'),
      cat: cssVar(el, '--graph-category', '#c9962a'),
      halo: cssVar(el, '--graph-halo', 'rgba(255,255,255,.85)')
    };
  };

  GraphView.prototype.resize = function () {
    var rect = this.container.getBoundingClientRect();
    this.width = Math.max(120, Math.floor(rect.width) || 300);
    this.height = Math.max(120, Math.floor(rect.height) || 250);
    var dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.needsRender = true;
  };

  GraphView.prototype.tick = function () {
    var nodes = this.nodes;
    var links = this.links;
    var n = nodes.length;
    if (!n) return;
    var alpha = this.alpha;
    var area = Math.max(1, this.width * this.height);
    var k = Math.sqrt(area / n);
    var repel = (this.options.repelForce || 0.55) * k * k;
    var linkDist = this.options.linkDistance || Math.max(36, k * 0.85);
    var linkStr = 0.045;
    var center = this.options.centerForce || 0.035;
    var i;
    var j;

    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var a = nodes[i];
        var b = nodes[j];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var dist2 = dx * dx + dy * dy || 0.01;
        var dist = Math.sqrt(dist2);
        var force = (repel * alpha) / dist2;
        var fx = dx / dist * force;
        var fy = dy / dist * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (i = 0; i < links.length; i++) {
      var link = links[i];
      var s = link.source;
      var t = link.target;
      var lx = t.x - s.x;
      var ly = t.y - s.y;
      var ld = Math.sqrt(lx * lx + ly * ly) || 0.01;
      var desired = link.type === 'ref' ? linkDist * 1.25 : linkDist;
      var pull = ((ld - desired) / ld) * linkStr * alpha;
      var px = lx * pull;
      var py = ly * pull;
      s.vx += px;
      s.vy += py;
      t.vx -= px;
      t.vy -= py;
    }

    var radial = this.options.enableRadial ? Math.min(this.width, this.height) * 0.32 / Math.max(this.k, 0.01) : 0;
    for (i = 0; i < n; i++) {
      var node = nodes[i];
      node.vx += (-node.x) * center * alpha;
      node.vy += (-node.y) * center * alpha;
      if (radial) {
        var rr = Math.sqrt(node.x * node.x + node.y * node.y) || 0.01;
        var radialPull = (radial - rr) * 0.012 * alpha;
        node.vx += node.x / rr * radialPull;
        node.vy += node.y / rr * radialPull;
      }
    }

    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var n1 = nodes[i];
        var n2 = nodes[j];
        var cx = n2.x - n1.x;
        var cy = n2.y - n1.y;
        var cd = Math.sqrt(cx * cx + cy * cy) || 0.01;
        var min = n1.r + n2.r + 3;
        if (cd < min) {
          var push = (min - cd) / cd * 0.5;
          var ux = cx * push;
          var uy = cy * push;
          if (n1.fx == null) { n1.x -= ux; n1.y -= uy; }
          if (n2.fx == null) { n2.x += ux; n2.y += uy; }
        }
      }
    }

    var decay = 0.86;
    for (i = 0; i < n; i++) {
      var p = nodes[i];
      if (p.fx != null) {
        p.x = p.fx;
        p.vx = 0;
      } else {
        p.vx *= decay;
        p.x += p.vx;
      }
      if (p.fy != null) {
        p.y = p.fy;
        p.vy = 0;
      } else {
        p.vy *= decay;
        p.y += p.vy;
      }
    }

    this.alpha *= 0.985;
    if (this.alpha < 0.012) this.alpha = 0;
  };

  GraphView.prototype.worldFromEvent = function (event) {
    var rect = this.canvas.getBoundingClientRect();
    var cx = event.clientX - rect.left;
    var cy = event.clientY - rect.top;
    return {
      x: (cx - this.width / 2 - this.tx) / this.k,
      y: (cy - this.height / 2 - this.ty) / this.k,
      cx: cx,
      cy: cy
    };
  };

  GraphView.prototype.hit = function (world) {
    var best = null;
    var bestDist = Infinity;
    for (var i = this.nodes.length - 1; i >= 0; i--) {
      var node = this.nodes[i];
      var dx = world.x - node.x;
      var dy = world.y - node.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= node.r + 4 && dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    return best;
  };

  GraphView.prototype.neighborsOf = function (id) {
    var set = new Set([id]);
    this.links.forEach(function (link) {
      if (link.source.id === id) set.add(link.target.id);
      if (link.target.id === id) set.add(link.source.id);
    });
    return set;
  };

  GraphView.prototype.pointerDown = function (event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    try { this.canvas.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    var world = this.worldFromEvent(event);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, cx: world.cx, cy: world.cy });
    if (this.pointers.size === 2) {
      this.dragId = null;
      this.panning = false;
      var pts = Array.from(this.pointers.values());
      this.pinch = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        k: this.k
      };
      return;
    }
    var node = this.hit(world);
    this.moved = false;
    this.downAt = Date.now();
    this.downPos = { x: event.clientX, y: event.clientY };
    if (node) {
      this.dragId = node.id;
      node.fx = node.x;
      node.fy = node.y;
      this.alpha = Math.max(this.alpha, 0.25);
    } else {
      this.panning = true;
      this.panStart = { x: event.clientX, y: event.clientY, tx: this.tx, ty: this.ty };
    }
  };

  GraphView.prototype.pointerMove = function (event) {
    if (!this.pointers.has(event.pointerId) && event.buttons === 0) {
      var hoverWorld = this.worldFromEvent(event);
      var hover = this.hit(hoverWorld);
      var nextId = hover ? hover.id : null;
      if (nextId !== this.hoverId) {
        this.hoverId = nextId;
        this.live.textContent = hover ? hover.title : '';
        this.canvas.style.cursor = hover ? 'pointer' : 'grab';
        this.needsRender = true;
      }
      return;
    }
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      cx: this.worldFromEvent(event).cx,
      cy: this.worldFromEvent(event).cy
    });

    if (this.pointers.size === 2 && this.pinch) {
      var pts = Array.from(this.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinch.dist > 0) this.zoomAt((pts[0].cx + pts[1].cx) / 2, (pts[0].cy + pts[1].cy) / 2, this.pinch.k * (dist / this.pinch.dist) / this.k);
      this.needsRender = true;
      return;
    }

    if (this.dragId) {
      var world = this.worldFromEvent(event);
      var node = this.nodes.find(function (item) { return item.id === this.dragId; }, this);
      if (node) {
        node.fx = world.x;
        node.fy = world.y;
        this.alpha = Math.max(this.alpha, 0.2);
      }
      if (this.downPos && Math.hypot(event.clientX - this.downPos.x, event.clientY - this.downPos.y) > 4) this.moved = true;
      this.needsRender = true;
    } else if (this.panning && this.panStart) {
      this.tx = this.panStart.tx + (event.clientX - this.panStart.x);
      this.ty = this.panStart.ty + (event.clientY - this.panStart.y);
      if (Math.hypot(event.clientX - this.panStart.x, event.clientY - this.panStart.y) > 4) this.moved = true;
      this.needsRender = true;
    }
  };

  GraphView.prototype.pointerUp = function (event) {
    if (this.pointers.has(event.pointerId)) this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.dragId) {
      var node = this.nodes.find(function (item) { return item.id === this.dragId; }, this);
      var shouldOpen = node && !this.moved && Date.now() - this.downAt < 500;
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      this.dragId = null;
      this.alpha = Math.max(this.alpha, 0.15);
      if (shouldOpen) openNode(node);
    }
    this.panning = false;
  };

  GraphView.prototype.wheel = function (event) {
    event.preventDefault();
    var world = this.worldFromEvent(event);
    var factor = event.deltaY > 0 ? 0.92 : 1.08;
    this.zoomAt(world.cx, world.cy, factor);
  };

  GraphView.prototype.zoomAt = function (cx, cy, factor) {
    var next = Math.min(4, Math.max(0.25, this.k * factor));
    if (next === this.k) return;
    var wx = (cx - this.width / 2 - this.tx) / this.k;
    var wy = (cy - this.height / 2 - this.ty) / this.k;
    this.k = next;
    this.tx = cx - this.width / 2 - wx * this.k;
    this.ty = cy - this.height / 2 - wy * this.k;
    this.needsRender = true;
  };

  GraphView.prototype.zoomBy = function (factor) {
    this.zoomAt(this.width / 2, this.height / 2, factor);
  };

  GraphView.prototype.click = function (event) {
    if (this.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  GraphView.prototype.setQuery = function (value) {
    this.query = (value || '').trim().toLowerCase();
    this.needsRender = true;
  };

  GraphView.prototype.setFilters = function (showTags, showCats) {
    this.showTags = showTags;
    this.showCats = showCats;
    this.rebuild();
    this.needsRender = true;
  };

  GraphView.prototype.loop = function () {
    if (this.stopped) return;
    if (this.alpha > 0) {
      this.tick();
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.draw();
      this.needsRender = false;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  GraphView.prototype.draw = function () {
    var ctx = this.ctx;
    var colors = this.colors();
    var dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2 + this.tx, this.height / 2 + this.ty);
    ctx.scale(this.k, this.k);

    var focus = this.hoverId && this.options.focusOnHover ? this.neighborsOf(this.hoverId) : null;
    var query = this.query;

    ctx.lineWidth = 1 / this.k;
    this.links.forEach(function (link) {
      var active = !focus || focus.has(link.source.id) && focus.has(link.target.id);
      var dimQuery = query && !matchesQuery(link.source, query) && !matchesQuery(link.target, query);
      ctx.globalAlpha = active && !dimQuery ? (link.type === 'ref' ? 0.7 : 0.45) : 0.08;
      ctx.strokeStyle = link.type === 'ref' ? colors.visited : colors.link;
      ctx.beginPath();
      ctx.moveTo(link.source.x, link.source.y);
      ctx.lineTo(link.target.x, link.target.y);
      ctx.stroke();
    });

    ctx.globalAlpha = 1;
    var self = this;
    this.nodes.forEach(function (node) {
      var active = !focus || focus.has(node.id);
      var qMatch = !query || matchesQuery(node, query);
      ctx.globalAlpha = active && qMatch ? 1 : 0.12;
      drawNode(ctx, node, colors, node.id === self.currentId, self.visited.has(node.id) || self.visited.has(node.path), node.id === self.hoverId);
    });

    var labelScale = this.k * (this.options.opacityScale || 1);
    this.nodes.forEach(function (node) {
      var show = node.id === self.currentId || node.id === self.hoverId || (query && matchesQuery(node, query));
      if (!show && labelScale > 1.05) show = node.degree >= 3 || node.type !== 'post';
      if (!show && labelScale > 1.8) show = true;
      if (self.options.compact) {
        show = node.id === self.currentId || node.id === self.hoverId || node.type !== 'post' || self.nodes.length <= 8;
      }
      if (!show) return;
      var active = !focus || focus.has(node.id);
      if (!active && node.id !== self.hoverId) return;
      drawLabel(ctx, node, colors, (self.options.compact ? 9 : 11) / self.k, self.options.labelMax || 18);
    });
    ctx.globalAlpha = 1;
  };

  GraphView.prototype.destroy = function () {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('click', this.onClick);
  };

  function nodeRadius(node, isCurrent, scale) {
    var base = node.type === 'category' ? 5.5 : node.type === 'tag' ? 3.6 : 4.2;
    var r = (base + Math.sqrt(node.degree || 1) * 1.15) * (scale || 1);
    return isCurrent ? r + 1.8 * (scale || 1) : r;
  }

  function matchesQuery(node, query) {
    return (node.title || '').toLowerCase().indexOf(query) !== -1;
  }

  function drawNode(ctx, node, colors, isCurrent, visited, hovered) {
    var r = node.r;
    ctx.beginPath();
    if (node.type === 'category') {
      roundRect(ctx, node.x - r, node.y - r, r * 2, r * 2, 3);
    } else {
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    }
    if (node.type === 'tag') {
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.strokeStyle = isCurrent ? colors.current : colors.tag;
      ctx.lineWidth = (hovered ? 2.4 : 1.6) / Math.max(ctx.getTransform ? 1 : 1, 1);
      ctx.stroke();
    } else if (node.type === 'category') {
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.strokeStyle = isCurrent ? colors.current : colors.cat;
      ctx.lineWidth = hovered ? 2.4 : 1.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = isCurrent ? colors.current : (visited ? colors.visited : colors.post);
      ctx.fill();
      if (hovered || isCurrent) {
        ctx.strokeStyle = colors.current;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawLabel(ctx, node, colors, size, maxLen) {
    ctx.font = size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var text = node.type === 'tag' ? '#' + node.title : node.title;
    var limit = maxLen || 18;
    if (text.length > limit) text = text.slice(0, limit - 1) + '…';
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.halo;
    ctx.strokeText(text, node.x, node.y + node.r + 2);
    ctx.fillStyle = colors.text;
    ctx.fillText(text, node.x, node.y + node.r + 2);
  }

  function openNode(node) {
    if (!node || !node.path) return;
    window.location.href = node.path;
  }

  function dataUrlFrom(el) {
    return (el && el.getAttribute('data-data-url')) || '/graph/data.json';
  }

  function isGraphPage() {
    var path = normalizePath(location.pathname);
    if (path.indexOf('/en/') === 0) path = path.slice(3);
    return path === '/graph/';
  }

  function mountSidebar() {
    var sidebar = document.querySelector('.sidebar > .sidebar-inner');
    var widget = document.querySelector('.knowledge-graph-sidebar');
    if (!sidebar || !widget || isGraphPage()) return;

    var strings = t();
    loadData(dataUrlFrom(widget)).then(function (data) {
      var currentId = currentNodeId(data);
      if (!currentId) return;

      addVisited(currentId);
      sidebar.appendChild(widget);
      widget.hidden = false;
      widget.removeAttribute('hidden');

      var title = widget.querySelector('.sidebar-graph-title');
      if (title) title.textContent = strings.local;
      var container = widget.querySelector('.graph-container');
      if (container) container.setAttribute('aria-label', strings.localAria);
      var btn = widget.querySelector('.graph-global-btn');
      if (btn) btn.setAttribute('aria-label', strings.openGlobal);

      var view = new GraphView(container, data, {
        depth: 1,
        scale: 1.2,
        focusOnHover: false,
        enableRadial: false,
        currentId: currentId,
        showTags: true,
        showCats: true,
        minTagDegree: 1,
        maxNodes: 24,
        labelMax: 10,
        compact: true,
        centerForce: 0.09,
        linkDistance: 22,
        repelForce: 0.42,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      });
      localViews.push(view);
    }).catch(function () {
      /* 侧栏图谱加载失败时保持隐藏 */
    });
  }

  function mountLocal() {
    var widgets = document.querySelectorAll('.knowledge-graph:not(.knowledge-graph-sidebar) .graph-container[data-mode="local"]');
    if (!widgets.length) return;
    var url = dataUrlFrom(document.querySelector('.knowledge-graph')) || dataUrlFrom(widgets[0]);
    loadData(url).then(function (data) {
      widgets.forEach(function (container) {
        var wrap = container.closest('.knowledge-graph');
        var currentId = currentNodeId(data, wrap && wrap.getAttribute('data-current'));
        addVisited(currentId);
        var view = new GraphView(container, data, {
          depth: Number(container.getAttribute('data-depth') || 2),
          scale: 1.05,
          focusOnHover: false,
          enableRadial: false,
          currentId: currentId,
          showTags: true,
          showCats: true,
          minTagDegree: 1,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        });
        localViews.push(view);
      });
    }).catch(function () {
      widgets.forEach(function (container) {
        container.textContent = t().empty;
      });
    });
  }

  function mountPage() {
    var container = document.querySelector('.knowledge-graph-page .graph-container[data-mode="page"]');
    if (!container) return;
    var url = dataUrlFrom(container);
    var strings = t();
    loadData(url).then(function (data) {
      var view = new GraphView(container, data, {
        depth: -1,
        scale: 0.85,
        focusOnHover: true,
        enableRadial: true,
        currentId: currentNodeId(data),
        showTags: true,
        showCats: true,
        minTagDegree: 2,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      });
      localViews.push(view);
      var pageRoot = document.querySelector('.knowledge-graph-page');
      bindToolbar(pageRoot, function () { return view; });
      var meta = document.querySelector('.knowledge-graph-meta');
      if (meta) {
        var posts = data.nodes.filter(function (n) { return n.type === 'post'; }).length;
        var tags = data.nodes.filter(function (n) { return n.type === 'tag'; }).length;
        var cats = data.nodes.filter(function (n) { return n.type === 'category'; }).length;
        meta.textContent = strings.meta(posts, tags, cats);
      }
    }).catch(function () {
      container.textContent = strings.empty;
    });
  }

  function bindToolbar(root, getView) {
    if (!root || root.getAttribute('data-graph-bound') === '1') return;
    root.setAttribute('data-graph-bound', '1');
    var search = root.querySelector('.graph-search-input');
    var tags = root.querySelector('.graph-toggle-tags');
    var cats = root.querySelector('.graph-toggle-cats');
    var zoomIn = root.querySelector('.graph-zoom-in');
    var zoomOut = root.querySelector('.graph-zoom-out');
    if (search) {
      search.placeholder = t().search;
      search.addEventListener('input', function () {
        var view = getView();
        if (view) view.setQuery(search.value);
      });
    }
    function applyFilters() {
      var view = getView();
      if (!view) return;
      view.minTagDegree = (tags && tags.checked) ? 2 : 1;
      view.setFilters(!tags || tags.checked, !cats || cats.checked);
    }
    if (tags) tags.addEventListener('change', applyFilters);
    if (cats) cats.addEventListener('change', applyFilters);
    if (zoomIn) zoomIn.addEventListener('click', function () { var view = getView(); if (view) view.zoomBy(1.15); });
    if (zoomOut) zoomOut.addEventListener('click', function () { var view = getView(); if (view) view.zoomBy(1 / 1.15); });
  }

  function overlayEl() {
    return document.querySelector('.graph-global-overlay');
  }

  function openOverlay() {
    var overlay = overlayEl();
    if (!overlay) return;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.classList.add('is-open');
    document.body.classList.add('graph-overlay-open');
    var strings = t();
    overlay.querySelector('.graph-global-title').textContent = strings.global;
    overlay.querySelector('.graph-search .sr-only').textContent = strings.search;
    overlay.querySelector('.graph-search-input').placeholder = strings.search;
    overlay.querySelector('[data-i18n="tags"]').textContent = strings.tags;
    overlay.querySelector('[data-i18n="cats"]').textContent = strings.cats;
    overlay.querySelector('.graph-global-close').setAttribute('aria-label', strings.close);
    overlay.querySelector('.graph-container').setAttribute('aria-label', strings.global);

    var container = overlay.querySelector('.graph-container-global');
    var url = dataUrlFrom(container) || dataUrlFrom(document.querySelector('.knowledge-graph'));
    loadData(url).then(function (data) {
      if (overlayView) overlayView.destroy();
      var hint = document.querySelector('.knowledge-graph');
      overlayView = new GraphView(container, data, {
        depth: -1,
        scale: 0.8,
        focusOnHover: true,
        enableRadial: true,
        currentId: currentNodeId(data, hint && hint.getAttribute('data-current')),
        showTags: true,
        showCats: true,
        minTagDegree: 2,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      });
      bindToolbar(overlay, function () { return overlayView; });
      var search = overlay.querySelector('.graph-search-input');
      if (search) {
        search.value = '';
        search.focus();
      }
    }).catch(function () {
      container.textContent = strings.empty;
    });
  }

  function closeOverlay() {
    var overlay = overlayEl();
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    overlay.classList.remove('is-open');
    document.body.classList.remove('graph-overlay-open');
    if (overlayView) {
      overlayView.destroy();
      overlayView = null;
    }
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function onKey(event) {
    var overlay = overlayEl();
    var open = overlay && !overlay.hidden;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if ((event.key === 'g' || event.key === 'G') && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      var target = event.target;
      var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      open ? closeOverlay() : openOverlay();
    }
  }

  function init() {
    var strings = t();
    document.addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('.graph-global-btn');
      if (!btn) return;
      event.preventDefault();
      openOverlay();
    });
    var overlay = overlayEl();
    if (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeOverlay();
      });
      var closeBtn = overlay.querySelector('.graph-global-close');
      if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
    }
    document.addEventListener('keydown', onKey);
    mountSidebar();
    mountLocal();
    mountPage();

    document.querySelectorAll('.knowledge-graph-hint').forEach(function (el) {
      el.textContent = strings.hint;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
