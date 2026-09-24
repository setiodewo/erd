/* app.js - boilerplate UI glue: toolbar, inspector, dialogs, export/import */
var App = App || {};

(function () {
  "use strict";

  var model = App.model;
  var renderer = App.renderer;
  var sql = App.sql;

  var els = {};
  var currentTool = "select";
  var pendingRel = null;

  /* ---------------- init ---------------- */
  function init() {
    var vp = document.getElementById("viewport");
    renderer.init(vp);

    els = {
      viewport: vp,
      inspector: document.getElementById("inspector"),
      emptySec: document.getElementById("inspector-empty"),
      entitySec: document.getElementById("inspector-entity"),
      relationSec: document.getElementById("inspector-relation"),
      columnEditor: document.getElementById("column-editor"),
      stats: document.getElementById("stats"),
      status: document.getElementById("status-msg"),
      fileInput: document.getElementById("file-input"),
      modalSql: document.getElementById("modal-sql"),
      sqlOutput: document.getElementById("sql-output"),
      sqlWarn: document.getElementById("sql-warn"),
      modalRelation: document.getElementById("modal-relation")
    };

    model.setOnChange(function () {
      renderer.renderAll();
      refreshStats();
      refreshSettingsUI();
    });

    renderer.setHooks({
      onSelect: function (sel) {
        renderer.renderAll();
        refreshInspector();
        if (sel.entityId) setStatus("Entitas dipilih");
        else if (sel.relationId) setStatus("Relasi dipilih");
        else setStatus("Siap");
      },
      onPickingStart: function (anchor) {
        var e = model.findEntity(anchor.entityId);
        var c = anchor.columnId ? model.findColumn(anchor.entityId, anchor.columnId) : null;
        var label = (e ? e.name : "?") + (c ? "." + c.name : "");
        setStatus("Sumber: " + label + " - sekarang pilih tujuan");
      },
      onRelationAnchors: function (src, dst) {
        openRelationDialog(src, dst);
      },
      onStatus: setStatus,
      onContextMenu: function (e, entityId) {
        showContextMenu(e, entityId);
      },
      onDragEnd: function () {
        model.save();
      }
    });

    bindToolbar();
    bindInspector();
    bindModals();
    bindKeyboard();

    var hasData = model.loadFromLocal();
    renderer.renderAll();
    refreshStats();
    refreshSettingsUI();
    renderer.focusAll();
    if (!hasData) {
      setStatus("Kanvas kosong - klik 'Contoh' untuk memuat diagram sampel");
    }
    refreshInspector();

    if (window.location.hash === "#sample") {
      doSample();
    } else if (window.location.hash === "#new") {
      model.clearAll();
      model.resetColSeq();
      model.save();
      renderer.renderAll();
      refreshInspector();
    }
  }

  function setStatus(msg) {
    els.status.textContent = msg;
  }

  /* ---------------- toolbar ---------------- */
  function setTool(t) {
    currentTool = t;
    renderer.setTool(t);
    var btns = document.querySelectorAll("[data-tool]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].dataset.tool === t);
    }
    var names = { select: "Pilih", entity: "Entitas", relation: "Relasi" };
    setStatus("Alat: " + (names[t] || t));
  }

  function bindToolbar() {
    document.querySelectorAll("[data-tool]").forEach(function (b) {
      b.addEventListener("click", function () { setTool(b.dataset.tool); });
    });
    document.querySelectorAll("[data-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.dataset.action;
        if (a === "new") doNew();
        else if (a === "open") els.fileInput.click();
        else if (a === "save") doSave();
        else if (a === "sample") doSample();
        else if (a === "sql") showSql(true);
        else if (a === "sql-download") downloadSql();
        else if (a === "zoom-in") renderer.zoomIn();
        else if (a === "undo-zoom") renderer.zoomOut();
        else if (a === "fit") renderer.focusAll();
      });
    });

    document.getElementById("btn-zoom-in").addEventListener("click", function () { renderer.zoomIn(); });
    document.getElementById("btn-zoom-out").addEventListener("click", function () { renderer.zoomOut(); });

    els.fileInput.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          model.importJSON(reader.result);
          model.resetColSeq();
          model.save();
          renderer.renderAll();
          refreshStats();
          refreshInspector();
          renderer.focusAll();
          setStatus("Diagram dimuat dari '" + file.name + "'");
        } catch (err) {
          alert("Gagal memuat file: " + err.message);
          setStatus("Gagal memuat file");
        }
      };
      reader.readAsText(file);
      els.fileInput.value = "";
    });
  }

  function doNew() {
    if (!confirm("Mulai diagram baru? Perubahan yang belum disimpan akan hilang.")) return;
    model.clearAll();
    model.resetColSeq();
    model.save();
    renderer.renderAll();
    refreshInspector();
    refreshStats();
    setStatus("Diagram baru");
  }

  function doSave() {
    download("erd-diagram.json", model.exportJSON(), "application/json");
    setStatus("Diagram disimpan sebagai erd-diagram.json");
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function downloadSql() {
    var res = sql.generate();
    var name = "erd_" + new Date().toISOString().slice(0, 10) + ".sql";
    download(name, res.script, "application/sql");
    setStatus("Script SQL diunduh: " + name);
  }

  /* ---------------- sample ---------------- */
  function doSample() {
    model.clearAll();
    model.resetColSeq();

    var users = model.newEntity(80, 90);
    users.name = "users";
    var uc = users.columns[0];
    uc.name = "id"; uc.type = "BIGINT"; uc.length = "20"; uc.pk = true; uc.autoIncrement = true; uc.nullable = false;

    var uName = model.addColumn(users.id);
    uName.name = "name"; uName.type = "VARCHAR"; uName.length = "100"; uName.nullable = false;

    var uEmail = model.addColumn(users.id);
    uEmail.name = "email"; uEmail.type = "VARCHAR"; uEmail.length = "150"; uEmail.nullable = false; uEmail.unique = true;

    var uMade = model.addColumn(users.id);
    uMade.name = "created_at"; uMade.type = "TIMESTAMP"; uMade.default = "CURRENT_TIMESTAMP"; uMade.nullable = false;

    var roles = model.newEntity(430, 90);
    roles.name = "roles";
    var rc = roles.columns[0];
    rc.name = "id"; rc.type = "BIGINT"; rc.length = "20"; rc.pk = true; rc.autoIncrement = true; rc.nullable = false;

    var rName = model.addColumn(roles.id);
    rName.name = "name"; rName.type = "VARCHAR"; rName.length = "50"; rName.nullable = false; rName.unique = true;

    var posts = model.newEntity(430, 340);
    posts.name = "posts";
    var pc = posts.columns[0];
    pc.name = "id"; pc.type = "BIGINT"; pc.length = "20"; pc.pk = true; pc.autoIncrement = true; pc.nullable = false;

    var pUser = model.addColumn(posts.id);
    pUser.name = "author_id"; pUser.type = "BIGINT"; pUser.length = "20"; pUser.unsigned = true; pUser.nullable = false;

    var pTitle = model.addColumn(posts.id);
    pTitle.name = "title"; pTitle.type = "VARCHAR"; pTitle.length = "200"; pTitle.nullable = false;

    var pBody = model.addColumn(posts.id);
    pBody.name = "body"; pBody.type = "TEXT"; pBody.nullable = true;

    var pStatus = model.addColumn(posts.id);
    pStatus.name = "status"; pStatus.type = "ENUM"; pStatus.length = "";
    pStatus.enumValues = "draft, published, archived"; pStatus.nullable = false; pStatus.default = "draft";

    // relationships
    var r1 = model.newRelationship(posts.id, pUser.id, users.id, users.columns[0].id);
    r1.cardinality = "1:N";
    r1.name = "fk_posts_author";
    r1.onDelete = "CASCADE";
    model.getRelationships().push(r1);

    var r2 = model.newRelationship(users.id, null, roles.id, null);
    r2.cardinality = "N:N";
    r2.name = "rel_user_roles";
    model.getRelationships().push(r2);

    model.save();
    renderer.renderAll();
    refreshStats();
    refreshInspector();
    renderer.focusAll();
    setStatus("Contoh diagram dimuat");
  }

  /* ---------------- inspector ---------------- */
  function refreshInspector() {
    var sel = renderer.getSelection();
    els.emptySec.classList.add("hidden");
    els.entitySec.classList.add("hidden");
    els.relationSec.classList.add("hidden");

    if (sel.entityId) {
      var e = model.findEntity(sel.entityId);
      if (!e) { renderer.clearSelection(); refreshInspector(); return; }
      els.entitySec.classList.remove("hidden");
      populateEntityInspector(e);
    } else if (sel.relationId) {
      var r = model.findRelationship(sel.relationId);
      if (!r) { renderer.clearSelection(); refreshInspector(); return; }
      els.relationSec.classList.remove("hidden");
      populateRelationInspector(r);
    } else {
      els.emptySec.classList.remove("hidden");
    }
  }

  var PALETTE = ["#6366f1", "#3b82f6", "#0ea5e9", "#14b8a6", "#10b981",
    "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#8b5cf6"];

  function populateEntityInspector(e) {
    var nameIn = document.getElementById("ent-name");
    var comIn = document.getElementById("ent-comment");
    if (document.activeElement !== nameIn) nameIn.value = e.name;
    if (document.activeElement !== comIn) comIn.value = e.comment || "";

    var sw = document.getElementById("ent-colors");
    if (!sw.dataset.bound) {
      sw.dataset.bound = "1";
      sw.innerHTML = PALETTE.map(function (c) {
        return '<span class="swatch" data-color="' + c + '" style="background:' + c + '"></span>';
      }).join("");
    }
    Array.prototype.forEach.call(sw.children, function (s) {
      s.classList.toggle("selected", s.dataset.color === e.color);
    });

    buildColumnEditor(e);
  }

  function buildColumnEditor(e) {
    var box = els.columnEditor;
    var html = '<div class="col-table">';
    for (var i = 0; i < e.columns.length; i++) {
      var c = e.columns[i];
      var isEnum = c.type === "ENUM" || c.type === "SET";
      html += '<div class="col-card" data-col="' + c.id + '">';
      html += '<div class="row1">';
      html += '<label class="lbl-name">Nama<input data-field="name" value="' + escapeAttr(c.name) + '" placeholder="nama kolom"></label>';
      html += '<div class="move">';
      html += '<button class="mini" data-move="-1" title="Naik">▲</button>';
      html += '<button class="mini" data-move="1" title="Turun">▼</button>';
      html += "</div>";
      html += '<button class="del" title="Hapus kolom">✕</button>';
      html += "</div>";
      html += '<div class="row2">';
      html += '<label class="lbl-type">Tipe<select data-field="type">' + typeOptions(c.type) + "</select></label>";
      html += '<label>Panjang / Nilai enum<input data-field="length" value="' + escapeAttr(c.length || "") + '" placeholder="cth: 255"' + (isEnum ? ' class="hidden"' : "") + "><input data-field=\"enumValues\" value=\"" + escapeAttr(c.enumValues || "") + '" placeholder="a,b,c"' + (isEnum ? "" : ' class="hidden"') + "></label>";
      html += "</div>";
      html += '<div class="row2">';
      html += '<label>Default<input data-field="default" value="' + escapeAttr(c.default || "") + '" placeholder="cth: NULL"></label>';
      html += '<label>Komentar<input data-field="comment" value="' + escapeAttr(c.comment || "") + '" placeholder="keterangan opsional"></label>';
      html += "</div>";
      html += '<div class="flags">';
      html += '<label class="check' + (c.pk ? " on" : "") + '"><input type="checkbox" data-field="pk"' + (c.pk ? " checked" : "") + "><span>PK</span></label>";
      html += '<label class="check' + (c.autoIncrement ? " on" : "") + '"><input type="checkbox" data-field="autoIncrement"' + (c.autoIncrement ? " checked" : "") + "><span>AI</span></label>";
      html += '<label class="check' + (c.nullable ? " on" : "") + '"><input type="checkbox" data-field="nullable"' + (c.nullable ? " checked" : "") + "><span>Null</span></label>";
      html += '<label class="check' + (c.unsigned ? " on" : "") + '"><input type="checkbox" data-field="unsigned"' + (c.unsigned ? " checked" : "") + "><span>Uns</span></label>";
      html += '<label class="check' + (c.index ? " on" : "") + '"><input type="checkbox" data-field="index"' + (c.index ? " checked" : "") + "><span>Idx</span></label>";
      html += '<label class="check' + (c.unique ? " on" : "") + '"><input type="checkbox" data-field="unique"' + (c.unique ? " checked" : "") + "><span>UQ</span></label>";
      html += "</div>";
      html += "</div>";
    }
    html += "</div>";
    box.innerHTML = html;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function typeOptions(selected) {
    var out = "";
    model.TYPES.forEach(function (t) {
      out += '<option value="' + t + '"' + (t === selected ? " selected" : "") + ">" + t + "</option>";
    });
    return out;
  }

  function selectedEntity() {
    var sel = renderer.getSelection();
    return sel.entityId ? model.findEntity(sel.entityId) : null;
  }

  function bindInspector() {
    // entity name & comment
    document.getElementById("ent-name").addEventListener("change", function () {
      var e = selectedEntity();
      if (!e) return;
      e.name = this.value.trim() || "tabel";
      model.save();
      renderer.renderAll();
    });
    document.getElementById("ent-comment").addEventListener("change", function () {
      var e = selectedEntity();
      if (!e) return;
      e.comment = this.value.trim();
      model.save();
      renderer.renderAll();
    });

    document.getElementById("ent-colors").addEventListener("click", function (ev) {
      var sw = ev.target.closest(".swatch");
      if (!sw) return;
      var e = selectedEntity();
      if (!e) return;
      e.color = sw.dataset.color;
      Array.prototype.forEach.call(this.children, function (s) {
        s.classList.toggle("selected", s === sw);
      });
      model.save();
      renderer.renderAll();
    });

    document.getElementById("btn-add-column").addEventListener("click", function () {
      var e = selectedEntity();
      if (!e) return;
      model.addColumn(e.id);
      model.save();
      renderer.renderAll();
      buildColumnEditor(e);
    });

    els.columnEditor.addEventListener("mousedown", function (ev) {
      if (ev.target.closest(".flags .check")) ev.preventDefault();
    });

    els.columnEditor.addEventListener("click", function (ev) {
      var chip = ev.target.closest(".flags .check");
      if (chip) {
        ev.preventDefault();
        var chipInp = chip.querySelector("input");
        var now = Date.now();
        if (chipInp._lt && now - chipInp._lt < 80) return;
        chipInp._lt = now;
        chipInp.checked = !chipInp.checked;
        chipInp.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
      var card = ev.target.closest(".col-card");
      if (!card) return;
      var e = selectedEntity();
      if (!e) return;
      var colId = card.dataset.col;

      if (ev.target.classList.contains("del")) {
        model.removeColumn(e.id, colId);
        model.save();
        renderer.renderAll();
        buildColumnEditor(e);
        refreshStats();
        return;
      }
      var mv = ev.target.closest("[data-move]");
      if (mv) {
        model.moveColumn(e.id, colId, parseInt(mv.dataset.move, 10));
        model.save();
        renderer.renderAll();
        buildColumnEditor(e);
        return;
      }
    });

    els.columnEditor.addEventListener("change", function (ev) {
      var card = ev.target.closest(".col-card");
      if (!card) return;
      var e = selectedEntity();
      if (!e) return;
      var c = model.findColumn(e.id, card.dataset.col);
      if (!c) return;

      var f = ev.target.dataset.field;
      if (ev.target.type === "checkbox") {
        var flagChip = ev.target.closest(".flags .check");
        if (flagChip) flagChip.classList.toggle("on", ev.target.checked);
        c[f] = ev.target.checked;
        if (f === "pk" && ev.target.checked) c.nullable = false;
        if (f === "autoIncrement" && ev.target.checked) {
          c.pk = true;
          c.nullable = false;
        }
        if (f === "unique" && ev.target.checked) c.index = false;
        if (f === "index" && ev.target.checked) c.unique = false;
      } else if (f === "type") {
        c.type = ev.target.value;
        var isEnum = c.type === "ENUM" || c.type === "SET";
        card.querySelector('[data-field="length"]').classList.toggle("hidden", isEnum);
        card.querySelector('[data-field="enumValues"]').classList.toggle("hidden", !isEnum);
        if (!isEnum) c.enumValues = "";
      } else {
        c[f] = ev.target.value;
      }
      model.save();
      renderer.renderAll();
      refreshStats();
    });

    // delete entity / relation buttons
    document.querySelectorAll("[data-inspect-action]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.dataset.inspectAction;
        var sel = renderer.getSelection();
        if (act === "delete-entity" && sel.entityId) {
          if (!confirm("Hapus entitas ini beserta semua relasinya?")) return;
          model.removeEntity(sel.entityId);
          model.save();
          renderer.renderAll();
          refreshInspector();
          refreshStats();
          setStatus("Entitas dihapus");
        } else if (act === "delete-relation" && sel.relationId) {
          model.removeRelationship(sel.relationId);
          model.save();
          renderer.renderAll();
          refreshInspector();
          refreshStats();
          setStatus("Relasi dihapus");
        }
      });
    });

    // relation inspector
    bind("rel-name", "name");
    bind("rel-card", "cardinality");
    bind("rel-delete", "onDelete");
    bind("rel-update", "onUpdate");
    bind("set-charset", "charset", true);
    bind("set-collate", "collate", true);
    bind("set-engine", "engine", true);

    document.getElementById("set-drop").addEventListener("change", function () {
      model.getSettings().dropTables = this.checked;
      model.save();
    });
    document.getElementById("set-fkcheck").addEventListener("change", function () {
      model.getSettings().fkChecks = this.checked;
      model.save();
    });
  }

  function bind(id, field, isSetting) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", function () {
      if (isSetting) {
        model.getSettings()[field] = el.value;
      } else {
        var sel = renderer.getSelection();
        var r = model.findRelationship(sel.relationId);
        if (r) r[field] = el.value;
      }
      model.save();
      renderer.renderAll();
    });
  }

  function populateRelationInspector(r) {
    var nameIn = document.getElementById("rel-name");
    if (document.activeElement !== nameIn) nameIn.value = r.name || "";
    document.getElementById("rel-card").value = r.cardinality;
    document.getElementById("rel-delete").value = r.onDelete;
    document.getElementById("rel-update").value = r.onUpdate;

    var srcE = model.findEntity(r.srcEntity);
    var dstE = model.findEntity(r.dstEntity);
    var srcC = r.srcColumn ? model.findColumn(r.srcEntity, r.srcColumn) : null;
    var dstC = r.dstColumn ? model.findColumn(r.dstEntity, r.dstColumn) : null;
    var info = document.getElementById("rel-info");

    if (r.cardinality === "N:N") {
      info.innerHTML = "Relasi <b>many-to-many</b>.<br>SQL akan membuat tabel penghubung otomatis yang mereferensi <code>" +
        (srcC ? srcC.name : "PK " + (srcE ? srcE.name : "?")) + "</code> dan <code>" +
        (dstC ? dstC.name : "PK " + (dstE ? dstE.name : "?")) + "</code>.";
    } else {
      var fkName = (srcC ? (srcE ? srcE.name + "." : "") + srcC.name : "kolom baru");
      var refName = dstC ? dstC.name : "PK";
      info.innerHTML = "Kunci asing dari <code>" + fkName + "</code><br>&rarr; mereferensi <code>" +
        refName + "</code> pada <code>" + (dstE ? dstE.name : "?") + "</code>.";
    }
  }

  /* ---------------- stats & settings UI ---------------- */
  function refreshStats() {
    var es = model.getEntities();
    var cols = 0;
    for (var i = 0; i < es.length; i++) cols += es[i].columns.length;
    document.getElementById("stat-entities").textContent = es.length;
    document.getElementById("stat-columns").textContent = cols;
    document.getElementById("stat-relations").textContent = model.getRelationships().length;
  }

  function refreshSettingsUI() {
    var s = model.getSettings();
    document.getElementById("set-charset").value = s.charset;
    document.getElementById("set-collate").value = s.collate;
    document.getElementById("set-engine").value = s.engine;
    document.getElementById("set-drop").checked = !!s.dropTables;
    document.getElementById("set-fkcheck").checked = !!s.fkChecks;
  }

  /* ---------------- relation dialog ---------------- */
  function openRelationDialog(src, dst) {
    var srcE = model.findEntity(src.entityId);
    var dstE = model.findEntity(dst.entityId);
    var srcC = src.columnId ? model.findColumn(src.entityId, src.columnId) : null;
    var dstC = dst.columnId ? model.findColumn(dst.entityId, dst.columnId) : null;

    pendingRel = {
      srcEntity: src.entityId,
      srcColumn: src.columnId,
      dstEntity: dst.entityId,
      dstColumn: dst.columnId
    };
    var needAuto = !src.columnId;

    var info = document.getElementById("rel-created");
    info.innerHTML = "Sumber: <code>" + (srcE ? srcE.name : "?") + (srcC ? "." + srcC.name : " (kolom baru)") + "</code><br>" +
      "Tujuan: <code>" + (dstE ? dstE.name : "?") + (dstC ? "." + dstC.name : " (PK)") + "</code>";

    var fkBlock = document.getElementById("rel-new-fk");
    fkBlock.classList.toggle("hidden", !needAuto);
    if (needAuto) {
      document.getElementById("rel-new-colname").value = (dstE ? dstE.name : "tujuan") + "_id";
      document.getElementById("rel-new-nullable").checked = false;
    }

    els.modalRelation.classList.remove("hidden");
  }

  function relationDialogVisible() {
    return !els.modalRelation.classList.contains("hidden");
  }

  function bindModals() {
    document.getElementById("btn-relation-save").addEventListener("click", function () {
      if (!pendingRel) return;
      var r = model.newRelationship(pendingRel.srcEntity, pendingRel.srcColumn,
        pendingRel.dstEntity, pendingRel.dstColumn);
      r.cardinality = document.getElementById("rel-new-card").value;
      r.onDelete = document.getElementById("rel-new-delete").value;
      r.onUpdate = document.getElementById("rel-new-update").value;

      var needAuto = !pendingRel.srcColumn;
      if (needAuto && r.cardinality !== "N:N") {
        var srcE = model.findEntity(pendingRel.srcEntity);
        var c = model.addColumn(srcE.id);
        c.name = (document.getElementById("rel-new-colname").value.trim() || (srcE.name + "_id"));
        var tv = document.getElementById("rel-new-coltype").value;
        var m = tv.match(/^([A-Z]+)(?:\((\d+)\))?$/);
        c.type = m ? m[1] : tv;
        c.length = m && m[2] ? m[2] : "";
        c.nullable = document.getElementById("rel-new-nullable").checked;
        c.unsigned = false;
        c.default = "";
        r.srcColumn = c.id;
      }

      model.getRelationships().push(r);
      model.save();
      els.modalRelation.classList.add("hidden");
      pendingRel = null;
      renderer.renderAll();
      renderer.selectRelation(r.id);
      refreshStats();
      setStatus("Relasi ditambahkan");
    });

    // SQL modal
    document.getElementById("btn-copy-sql").addEventListener("click", function () {
      var txt = els.sqlOutput.value;
      function done() { setStatus("Script SQL disalin ke clipboard"); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt); done(); });
      } else { fallbackCopy(txt); done(); }
    });
    document.getElementById("btn-download-sql").addEventListener("click", downloadSql);

    document.querySelectorAll("[data-modal-close]").forEach(function (b) {
      b.addEventListener("click", function () {
        var modal = b.closest(".modal");
        if (modal) modal.classList.add("hidden");
        if (modal === els.modalRelation) pendingRel = null;
      });
    });

    document.querySelectorAll(".modal").forEach(function (m) {
      m.addEventListener("mousedown", function (e) {
        if (e.target === m) {
          m.classList.add("hidden");
          if (m === els.modalRelation) pendingRel = null;
          renderer.endRelationPick();
          setTool('select');
        }
      });
      m.addEventListener("keydown", function (e) {
        if (e.key === "Escape") m.classList.add("hidden");
      });
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  function showSql(preview) {
    var res = sql.generate();
    els.sqlOutput.value = res.script;
    els.sqlWarn.textContent = res.warnings.join("\n");
    els.modalSql.classList.remove("hidden");
    if (res.warnings.length && preview) setStatus("Ada relasi yang dilewati saat generate SQL");
  }

  /* ---------------- context menu ---------------- */
  var ctxMenu = null;
  function showContextMenu(e, entityId) {
    if (ctxMenu) ctxMenu.remove();
    ctxMenu = document.createElement("div");
    ctxMenu.style.cssText = "position:fixed;z-index:60;background:#1b202b;border:1px solid #262d3b;" +
      "border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.5);min-width:160px;font-size:12.5px;";
    var items = [
      { label: "Tambah kolom", fn: function () { model.addColumn(entityId); model.save(); renderer.renderAll(); refreshInspector(); } },
      { label: "Duplikat entitas", fn: function () { var copy = model.duplicateEntity(entityId); model.save(); renderer.renderAll(); if (copy) { renderer.selectEntity(copy.id, null); refreshInspector(); } } },
      { label: "Hapus entitas", danger: true, fn: function () { if (confirm("Hapus entitas ini beserta semua relasinya?")) { model.removeEntity(entityId); model.save(); renderer.renderAll(); refreshInspector(); refreshStats(); } } }
    ];
    items.forEach(function (it) {
      var btn = document.createElement("button");
      btn.textContent = it.label;
      btn.style.cssText = "display:block;width:100%;text-align:left;background:none;border:none;color:" +
        (it.danger ? "#ef4444" : "#e6e9ef") + ";padding:6px 10px;border-radius:5px;cursor:pointer;font-size:12.5px;font-family:inherit;";
      btn.onmouseover = function () { btn.style.background = "#262d3b"; };
      btn.onmouseout = function () { btn.style.background = "none"; };
      btn.onclick = function () { removeCtx(); it.fn(); };
      ctxMenu.appendChild(btn);
    });
    document.body.appendChild(ctxMenu);
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 180) + "px";
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 150) + "px";
  }

  function removeCtx() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }

  /* ---------------- keyboard ---------------- */
  function bindKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) {
        if (e.key === "Escape" && e.target.tagName === "INPUT") e.target.blur();
        return;
      }
      if (e.key === "Escape") {
        if (relationDialogVisible()) { els.modalRelation.classList.add("hidden"); pendingRel = null; return; }
        if (!els.modalSql.classList.contains("hidden")) { els.modalSql.classList.add("hidden"); return; }
        renderer.endRelationPick();
        setTool("select");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        var sel = renderer.getSelection();
        if (sel.relationId) { model.removeRelationship(sel.relationId); model.save(); renderer.renderAll(); refreshInspector(); }
        else if (sel.entityId) { if (confirm("Hapus entitas ini beserta semua relasinya?")) { model.removeEntity(sel.entityId); model.save(); renderer.renderAll(); refreshInspector(); refreshStats(); } }
      }
      var map = { v: "select", e: "entity", r: "relation", "1": "select", "2": "entity", "3": "relation" };
      if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    });
    document.addEventListener("mousedown", function (e) {
      if (ctxMenu && !ctxMenu.contains(e.target)) removeCtx();
    });
    window.addEventListener("beforeunload", function () { model.save(); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();