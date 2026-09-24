/* renderer.js - canvas rendering, pan/zoom, dragging, relation picking */
var App = App || {};

App.renderer = (function () {
  "use strict";

  var model = App.model;
  var svgNS = "http://www.w3.org/2000/svg";

  var viewport, world, svgLayer, entityLayer, hint, cursorInfo;
  var camera = model.getCamera();

  var hooks = {};

  var tool = "select";
  var sel = { entityId: null, columnId: null, relationId: null };

  var dragging = false;
  var dragEntityId = null;
  var dragOffX = 0, dragOffY = 0;
  var moved = 0;

  var panning = false;
  var panStartX = 0, panStartY = 0;
  var camStartX = 0, camStartY = 0;

  var pickingSrc = null;   // {entityId, columnId} or null
  var previewLine = null;

  function init(vp) {
    viewport = vp;
    world = document.getElementById("world");
    svgLayer = document.getElementById("svg-layer");
    entityLayer = document.getElementById("entity-layer");
    hint = document.getElementById("hint");
    cursorInfo = document.getElementById("cursor-info");

    viewport.addEventListener("mousedown", onMouseDown);
    viewport.addEventListener("mousemove", onMouseMove);
    viewport.addEventListener("mouseup", onMouseUp);
    viewport.addEventListener("mouseleave", onMouseUp);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("contextmenu", onContextMenu);

    applyCamera();
  }

  function setHooks(h) { hooks = h || {}; }
  function setTool(t) {
    tool = t;
    pickingSrc = null;
    hidePreview();
    viewport.classList.toggle("relation-mode", tool === "relation");
    renderHint();
    renderAll();
  }
  function getTool() { return tool; }

  /* ---------- coordinate helpers ---------- */
  function rectOfEntity(e) {
    return { x: e.x, y: e.y, w: e.w || 220, h: (e.h || 90) };
  }

  function eventWorld(e) {
    var r = viewport.getBoundingClientRect();
    var sx = e.clientX - r.left;
    var sy = e.clientY - r.top;
    return { x: (sx - camera.x) / camera.z, y: (sy - camera.y) / camera.z, sx: sx, sy: sy };
  }

  function applyCamera() {
    world.style.transform = "translate(" + camera.x + "px," + camera.y + "px) scale(" + camera.z + ")";
    world.style.backgroundSize = (20 * camera.z) + "px " + (20 * camera.z) + "px";
    var lbl = document.getElementById("zoom-label");
    if (lbl) lbl.textContent = Math.round(camera.z * 100) + "%";
  }

  /* ---------- selection ---------- */
  function selectEntity(entityId, columnId) {
    sel.entityId = entityId;
    sel.columnId = columnId || (entityId ? sel.columnId : null);
    sel.relationId = null;
    applySelection();
  }

  function selectRelation(relationId) {
    sel.relationId = relationId;
    sel.entityId = null;
    sel.columnId = null;
    applySelection();
  }

  function clearSelection() {
    sel = { entityId: null, columnId: null, relationId: null };
    applySelection();
  }

  function getSelection() { return { entityId: sel.entityId, columnId: sel.columnId, relationId: sel.relationId }; }

  function applySelection() {
    var es = entityLayer.querySelectorAll(".entity");
    for (var i = 0; i < es.length; i++) {
      var el = es[i];
      var selCls = el.dataset.id === sel.entityId;
      el.classList.toggle("selected", selCls);
      var cols = el.querySelectorAll(".col");
      for (var j = 0; j < cols.length; j++) {
        cols[j].classList.toggle("hot", selCls && cols[j].dataset.colid === sel.columnId);
      }
    }
    var paths = svgLayer.querySelectorAll(".rel-hit");
    for (var k = 0; k < paths.length; k++) {
      paths[k].classList.toggle("hot", paths[k].dataset.id === sel.relationId);
    }
  }

  /* ---------- entity DOM ---------- */
  function badge(col, cls, txt) {
    return '<span class="badge ' + cls + '">' + txt + "</span>";
  }

  function columnBadges(c) {
    var s = "";
    if (c.autoIncrement && c.pk) s += badge(c, "pk ai", "PK");
    else if (c.pk) s += badge(c, "pk", "PK");
    if (c.autoIncrement && !c.pk) s += badge(c, "ai", "AI");
    if (!c.nullable) s += badge(c, "nn", "NN");
    if (c.unique) s += badge(c, "uq", "UQ");
    if (c.index) s += badge(c, "idx", "IDX");
    return s;
  }

  function columnTypeLabel(c) {
    var t = c.type;
    if (c.length && c.type !== "ENUM" && c.type !== "SET") t += "(" + c.length + ")";
    if (t === "ENUM" || t === "SET") t += "(...)";
    if (c.unsigned) t += " UNSIGNED";
    return t;
  }

  function buildEntity(e) {
    var div = document.createElement("div");
    div.className = "entity";
    div.dataset.id = e.id;
    div.style.left = e.x + "px";
    div.style.top = e.y + "px";
    div.style.background = "#1b202b";

    var head = "";
    head += '<div class="head">';
    head += '<span class="dot" style="background:' + e.color + '"></span>';
    head += '<span class="ename"></span>';
    head += '<span class="ecount"></span>';
    head += "</div>";
    div.innerHTML = head;
    var nameEl = div.querySelector(".ename");
    if (nameEl) nameEl.textContent = e.name;
    var cntEl = div.querySelector(".ecount");
    if (cntEl) cntEl.textContent = e.columns.length + " kol";

    if (e.comment) {
      var note = document.createElement("div");
      note.className = "note";
      note.textContent = e.comment;
      div.appendChild(note);
    }

    var cols = document.createElement("div");
    cols.className = "cols";
    for (var i = 0; i < e.columns.length; i++) {
      var c = e.columns[i];
      var row = document.createElement("div");
      row.className = "col";
      row.dataset.colid = c.id;
      row.innerHTML = '<span class="cname"></span><span class="ctype"></span>';
      row.querySelector(".cname").textContent = c.name;
      row.querySelector(".ctype").textContent = columnTypeLabel(c);
      var b = document.createElement("span");
      b.className = "bwrap";
      b.innerHTML = columnBadges(c);
      row.insertBefore(b, row.querySelector(".cname"));
      cols.appendChild(row);
    }
    div.appendChild(cols);
    return div;
  }

  function renderEntities() {
    entityLayer.innerHTML = "";
    var es = model.getEntities();
    for (var i = 0; i < es.length; i++) {
      var el = buildEntity(es[i]);
      entityLayer.appendChild(el);
    }
    for (var j = 0; j < es.length; j++) {
      var el2 = entityLayer.querySelector('.entity[data-id="' + es[j].id + '"]');
      es[j].h = Math.max(es[j].name ? 50 : 44, el2 ? el2.offsetHeight : 90);
    }
  }

  /* ---------- relationship SVG ---------- */
  var colPos = {};   // columnId -> world y (center of the column row)

  function entityRect(id) {
    var e = model.findEntity(id);
    return e ? rectOfEntity(e) : null;
  }

  function getEntityName(id) {
    var e = model.findEntity(id);
    return e ? e.name : "?";
  }

  function resolveColumn(entityId, columnId) {
    if (columnId) {
      var c = model.findColumn(entityId, columnId);
      if (c) return c.name;
    }
    var e = model.findEntity(entityId);
    var k = e ? model.keyColumn(e) : null;
    return k ? k.name : "id";
  }

  function computeColumnOffsets() {
    var map = {};
    var es = model.getEntities();
    var z = camera.z || 1;
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      var el = entityLayer.querySelector('.entity[data-id="' + e.id + '"]');
      if (!el) continue;
      var entRect = el.getBoundingClientRect();
      var rows = el.querySelectorAll(".col");
      for (var j = 0; j < rows.length; j++) {
        var cr = rows[j].getBoundingClientRect();
        var dy = ((cr.top - entRect.top) + cr.height / 2) / z;
        map[rows[j].dataset.colid] = e.y + dy;
      }
    }
    return map;
  }

  function anchorPointFor(entityId, columnId, toX, toY) {
    var e = model.findEntity(entityId);
    if (!e) return null;
    var r = rectOfEntity(e);
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;

    var y = r.y + r.h / 2;
    if (columnId && colPos[columnId] !== undefined) {
      y = colPos[columnId];
    } else {
      var refCol = columnId ? (model.findColumn(entityId, columnId) || model.keyColumn(e)) : model.keyColumn(e);
      if (refCol) {
        var idx = e.columns.indexOf(refCol);
        if (idx >= 0) {
          var pad = e.comment ? 30 : 0;
          var per = (e.h - pad) / e.columns.length;
          y = r.y + pad + per * (idx + 0.5);
        }
      }
    }

    var toLeft = toX < cx;
    var toTop = toY < cy;
    var horizontal = Math.abs(toX - cx) >= Math.abs(toY - cy);
    var x;
    if (horizontal) {
      x = toLeft ? r.x : r.x + r.w;
    } else {
      x = cx;
      y = toTop ? r.y : r.y + r.h;
    }
    return { x: x, y: y };
  }

  function cubicPoint(p0, c1, c2, p3, t) {
    var u = 1 - t;
    var a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p0.x + b * c1.x + c * c2.x + d * p3.x, y: a * p0.y + b * c1.y + c * c2.y + d * p3.y };
  }

  function curveSegments(x1, y1, x2, y2) {
    var horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    var c1, c2, k;
    if (horizontal) {
      k = Math.min(260, Math.max(50, Math.abs(x2 - x1) / 2));
      var dir = x2 >= x1 ? 1 : -1;
      c1 = { x: x1 + dir * k, y: y1 };
      c2 = { x: x2 - dir * k, y: y2 };
    } else {
      k = Math.min(260, Math.max(50, Math.abs(y2 - y1) / 2));
      var dirY = y2 >= y1 ? 1 : -1;
      c1 = { x: x1, y: y1 + dirY * k };
      c2 = { x: x2, y: y2 - dirY * k };
    }
    return { c1: c1, c2: c2 };
  }

  function buildPathFor(r) {
    var ra = entityRect(r.srcEntity);
    var rb = entityRect(r.dstEntity);
    if (!ra || !rb) return null;
    var cA = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
    var cB = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
    var p1 = anchorPointFor(r.srcEntity, r.srcColumn, cB.x, cB.y);
    var p2 = anchorPointFor(r.dstEntity, r.dstColumn, cA.x, cA.y);
    if (!p1 || !p2) return null;
    var seg = curveSegments(p1.x, p1.y, p2.x, p2.y);
    return { p: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }, p0: p1, c1: seg.c1, c2: seg.c2, p3: p2 };
  }

  function renderRelations() {
    while (svgLayer.children.length > 0) svgLayer.removeChild(svgLayer.firstChild);
    colPos = computeColumnOffsets();

    if (!svgLayer.querySelector("defs")) {
      var defs = document.createElementNS(svgNS, "defs");
      var marker = document.createElementNS(svgNS, "marker");
      marker.setAttribute("id", "relArrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "7");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "6");
      marker.setAttribute("markerHeight", "6");
      marker.setAttribute("orient", "auto-start-reverse");
      var p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", "M0,0 L10,5 L0,10 z");
      p.setAttribute("fill", "#818cf8");
      marker.appendChild(p);
      defs.appendChild(marker);
      svgLayer.appendChild(defs);
    }

    var rels = model.getRelationships();
    for (var i = 0; i < rels.length; i++) {
      var r = rels[i];
      var g = buildPathFor(r);
      if (!g) continue;
      var d = "M" + g.p.x1 + "," + g.p.y1 + " C" + g.c1.x + "," + g.c1.y + " " + g.c2.x + "," + g.c2.y + " " + g.p.x2 + "," + g.p.y2;

      var hit = document.createElementNS(svgNS, "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "rel-hit");
      hit.setAttribute("data-id", r.id);
      svgLayer.appendChild(hit);

      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "rel-path");
      path.setAttribute("marker-end", "url(#relArrow)");
      svgLayer.appendChild(path);

      var srcCard = r.cardinality === "N:N" ? "N" : (r.cardinality === "1:1" ? "1" : "N");
      var dstCard = r.cardinality === "N:N" ? "N" : "1";

      var pSrc = cubicPoint(g.p0, g.c1, g.c2, g.p3, 0.18);
      var pDst = cubicPoint(g.p0, g.c1, g.c2, g.p3, 0.82);

      addLabel(pSrc.x, pSrc.y - 9, srcCard + "  " + getEntityName(r.srcEntity));
      addLabel(pDst.x, pDst.y + 9, getEntityName(r.dstEntity) + "  " + dstCard);
      addLabel(pSrc.x + 2, pSrc.y - 9, "");

      var dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", g.p.x1);
      dot.setAttribute("cy", g.p.y1);
      dot.setAttribute("r", 4);
      dot.setAttribute("class", "rel-dot");
      svgLayer.appendChild(dot);

      if (r.name) {
        var pm = cubicPoint(g.p0, g.c1, g.c2, g.p3, 0.5);
        var nm = document.createElementNS(svgNS, "text");
        nm.setAttribute("x", pm.x);
        nm.setAttribute("y", pm.y + 4);
        nm.setAttribute("text-anchor", "middle");
        nm.setAttribute("class", "rel-label");
        nm.textContent = r.name;
        svgLayer.appendChild(nm);
      }
    }
  }

  function addLabel(x, y, txt) {
    if (!txt) return;
    var t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", x);
    t.setAttribute("y", y);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "rel-label");
    t.textContent = txt;
    svgLayer.appendChild(t);
  }

  /* ---------- preview line while picking relation ---------- */
  function showPreview(fromX, fromY, toX, toY) {
    hidePreview();
    previewLine = document.createElementNS(svgNS, "path");
    var seg = curveSegments(fromX, fromY, toX, toY);
    previewLine.setAttribute("d", "M" + fromX + "," + fromY + " C" + seg.c1.x + "," + seg.c1.y + " " + seg.c2.x + "," + seg.c2.y + " " + toX + "," + toY);
    previewLine.setAttribute("class", "rel-path");
    previewLine.setAttribute("stroke-dasharray", "6 5");
    previewLine.setAttribute("opacity", "0.7");
    svgLayer.appendChild(previewLine);
  }

  function hidePreview() {
    if (previewLine) {
      previewLine.parentNode && previewLine.parentNode.removeChild(previewLine);
      previewLine = null;
    }
  }

  function sourceAnchorPoint(src, toX, toY) {
    if (!src) return null;
    if (toX === undefined) {
      var r = entityRect(src.entityId);
      if (!r) return null;
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    }
    return anchorPointFor(src.entityId, src.columnId, toX, toY);
  }

  /* ---------- public render ---------- */
  function renderAll() {
    renderEntities();
    renderRelations();
    renderHint();
    applySelection();
  }

  function renderHint() {
    var es = model.getEntities();
    var msg = "";
    if (es.length === 0) {
      msg = "Kanvas kosong.\n\nPilih alat <b>Entitas</b> lalu klik di kanvas untuk menambah sebuah tabel.\n\nAtau gunakan <b>Contoh</b> pada toolbar untuk memuat diagram sampel.";
    } else if (tool === "relation" && !pickingSrc) {
      msg = "Klik kolom atau judul entitas <b>sumber</b>.";
    } else if (tool === "relation" && pickingSrc) {
      msg = "Klik kolom atau judul entitas <b>tujuan</b>.";
    }
    hint.innerHTML = msg;
    hint.style.display = msg ? "block" : "none";
  }

  /* ---------- mouse handling ---------- */
  function onMouseDown(e) {
    var wpt = eventWorld(e);
    var t = e.target;

    if (e.button === 2) return;

    if (tool === "relation") {
      var ent = t.closest ? t.closest(".entity") : null;
      if (!ent) return;
      var col = t.closest ? t.closest(".col") : null;
      var anchor = { entityId: ent.dataset.id, columnId: col ? col.dataset.colid : null };
      if (!pickingSrc) {
        pickingSrc = anchor;
        if (hooks.onPickingStart) hooks.onPickingStart(anchor);
      } else {
        if (anchor.entityId === pickingSrc.entityId) {
          if (hooks.onStatus) hooks.onStatus("Sumber dan tujuan harus entitas yang berbeda.");
          return;
        }
        var src = pickingSrc;
        hidePreview();
        pickingSrc = null;
        renderHint();
        if (hooks.onRelationAnchors) hooks.onRelationAnchors(src, anchor);
      }
      return;
    }

    if (tool === "entity") {
      var entExisting = t.closest ? t.closest(".entity") : null;
      if (entExisting) {
        var colX = t.closest ? t.closest(".col") : null;
        if (colX) sel.columnId = colX.dataset.colid;
        else sel.columnId = null;
        selectEntity(entExisting.dataset.id, sel.columnId);
        if (hooks.onSelect) hooks.onSelect({ entityId: entExisting.dataset.id, columnId: sel.columnId });
        startDrag(entExisting.dataset.id, wpt);
        return;
      }
      var e = model.newEntity(wpt.x, wpt.y);
      model.save();
      renderAll();
      selectEntity(e.id, null);
      if (hooks.onSelect) hooks.onSelect({ entityId: e.id, columnId: null });
      return;
    }

    // select tool
    var ent2 = t.closest ? t.closest(".entity") : null;
    var hitRel = t.closest ? t.closest(".rel-hit") : null;
    var col2 = t.closest ? t.closest(".col") : null;

    if (hitRel && !ent2) {
      selectRelation(hitRel.dataset.id);
      if (hooks.onSelect) hooks.onSelect({ relationId: hitRel.dataset.id });
      return;
    }

    if (ent2) {
      if (col2) sel.columnId = col2.dataset.colid;
      else sel.columnId = null;
      selectEntity(ent2.dataset.id, sel.columnId);
      if (hooks.onSelect) hooks.onSelect({ entityId: ent2.dataset.id, columnId: sel.columnId });

      startDrag(ent2.dataset.id, wpt);
    } else {
      clearSelection();
      if (hooks.onSelect) hooks.onSelect({ entityId: null, columnId: null });
      startPan(wpt);
    }
  }

  function startDrag(entityId, wpt) {
    var e = model.findEntity(entityId);
    if (!e) return;
    dragging = true;
    dragEntityId = entityId;
    dragOffX = wpt.x - e.x;
    dragOffY = wpt.y - e.y;
    moved = 0;
    var el = entityLayer.querySelector('.entity[data-id="' + entityId + '"]');
    if (el) el.classList.add("dragging");
    viewport.style.cursor = "grabbing";
  }

  function startPan(wpt) {
    panning = true;
    panStartX = wpt.sx;
    panStartY = wpt.sy;
    camStartX = camera.x;
    camStartY = camera.y;
    viewport.classList.add("panning");
  }

  function zoomAt(wx, wy, factor) {
    var sx = wx * camera.z + camera.x;
    var sy = wy * camera.z + camera.y;
    var z2 = Math.min(4, Math.max(0.2, camera.z * factor));
    camera.z = z2;
    camera.x = sx - wx * z2;
    camera.y = sy - wy * z2;
    applyCamera();
  }

  function onMouseMove(e) {
    var wpt = eventWorld(e);
    if (cursorInfo) cursorInfo.textContent = "x: " + Math.round(wpt.x) + "  y: " + Math.round(wpt.y);

    if (panning) {
      camera.x = camStartX + (wpt.sx - panStartX);
      camera.y = camStartY + (wpt.sy - panStartY);
      applyCamera();
      return;
    }

    if (dragging) {
      var el = entityLayer.querySelector('.entity[data-id="' + dragEntityId + '"]');
      var ent = model.findEntity(dragEntityId);
      if (el && ent) {
        ent.x = wpt.x - dragOffX;
        ent.y = wpt.y - dragOffY;
        ent.x = Math.round(ent.x / 4) * 4;
        ent.y = Math.round(ent.y / 4) * 4;
        el.style.left = ent.x + "px";
        el.style.top = ent.y + "px";
        renderRelations();
      }
      return;
    }

    if (tool === "relation" && pickingSrc) {
      var s = sourceAnchorPoint(pickingSrc, wpt.x, wpt.y);
      if (s) {
        showPreview(s.x, s.y, wpt.x, wpt.y);
        var entUnder = document.elementFromPoint(e.clientX, e.clientY);
        var cols = entityLayer.querySelectorAll(".col");
        for (var i = 0; i < cols.length; i++) cols[i].classList.remove("preview");
        var cu = entUnder && entUnder.closest ? entUnder.closest(".col") : null;
        if (cu) cu.classList.add("preview");
      }
    }
  }

  function onMouseUp(e) {
    if (dragging) {
      dragging = false;
      var el = entityLayer.querySelector('.entity[data-id="' + dragEntityId + '"]');
      if (el) el.classList.remove("dragging");
      dragEntityId = null;
      viewport.style.cursor = "";
      if (hooks.onDragEnd) hooks.onDragEnd();
    }
    if (panning) {
      panning = false;
      viewport.classList.remove("panning");
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var wpt = eventWorld(e);
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(wpt.x, wpt.y, factor);
  }

  function zoomBy(factor) {
    var vp = viewport.getBoundingClientRect();
    zoomAt((vp.width / 2), (vp.height / 2), factor);
  }

  function focusAll() {
    var es = model.getEntities();
    if (es.length === 0) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < es.length; i++) {
      var r = rectOfEntity(es[i]);
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    var w = maxX - minX, h = maxY - minY;
    var vp = viewport.getBoundingClientRect();
    var z = Math.min(vp.width / (w + 120), vp.height / (h + 120), 1.5);
    z = Math.max(0.2, Math.min(2, z));
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    camera.z = z;
    camera.x = vp.width / 2 - cx * z;
    camera.y = vp.height / 2 - cy * z;
    applyCamera();
  }

  function onContextMenu(e) {
    var ent = e.target.closest ? e.target.closest(".entity") : null;
    if (!ent) return;
    e.preventDefault();
    if (hooks.onContextMenu) hooks.onContextMenu(e, ent.dataset.id);
  }

  function endRelationPick() {
    pickingSrc = null;
    hidePreview();
    renderHint();
    renderAll();
  }

  return {
    init: init,
    setHooks: setHooks,
    setTool: setTool,
    getTool: getTool,
    renderAll: renderAll,
    applySelection: applySelection,
    selectEntity: selectEntity,
    selectRelation: selectRelation,
    clearSelection: clearSelection,
    getSelection: getSelection,
    zoomIn: function () { zoomBy(1.2); },
    zoomOut: function () { zoomBy(1 / 1.2); },
    zoomAt: zoomAt,
    zoom100: function () { camera.z = 1; applyCamera(); },
    focusAll: focusAll,
    endRelationPick: endRelationPick,
    getCamera: function () { return camera; }
  };
})();