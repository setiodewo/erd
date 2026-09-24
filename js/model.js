/* model.js - state, entities, columns, relationships, persistence */
var App = App || {};

App.model = (function () {
  "use strict";

  var LS_KEY = "erd-studio.diagram.v1";

  var TYPES = [
    "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL",
    "FLOAT", "DOUBLE", "BIT", "CHAR", "VARCHAR", "TINYTEXT", "TEXT",
    "MEDIUMTEXT", "LONGTEXT", "BINARY", "VARBINARY", "BLOB", "DATE",
    "TIME", "DATETIME", "TIMESTAMP", "YEAR", "JSON", "ENUM", "SET", "UUID"
  ];

  var STRING_TYPES = ["CHAR", "VARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT",
    "LONGTEXT", "ENUM", "SET", "BINARY", "VARBINARY", "UUID"];

  var NUMERIC_TYPES = ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT",
    "DECIMAL", "FLOAT", "DOUBLE", "BIT", "YEAR"];

  var DEFAULT_SETTINGS = {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    engine: "InnoDB",
    dropTables: true,
    fkChecks: true
  };

  var entities = [];
  var relationships = [];
  var settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  var camera = { x: 60, y: 50, z: 1 };
  var onChange = null;

  function uid(prefix) {
    var p = prefix || "id";
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newColumn() {
    return {
      id: uid("c"),
      name: "kolom_" + (columnCounter()),
      type: "VARCHAR",
      length: "255",
      unsigned: false,
      nullable: true,
      pk: false,
      autoIncrement: false,
      index: false,
      unique: false,
      default: "",
      comment: "",
      enumValues: ""
    };
  }

  var colSeq = 0;
  function columnCounter() { return ++colSeq; }

  function newEntity(x, y) {
    var palette = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#3b82f6",
      "#ec4899", "#14b8a6", "#8b5cf6", "#f97316", "#0ea5e9"];
    var color = palette[entities.length % palette.length];
    var col = newColumn();
    col.name = "id";
    col.type = "BIGINT";
    col.length = "20";
    col.nullable = false;
    col.pk = true;
    col.autoIncrement = true;
    var e = {
      id: uid("e"),
      name: "tabel_" + (entities.length + 1),
      comment: "",
      color: color,
      w: 220,
      h: 0,
      x: Math.round(x),
      y: Math.round(y),
      columns: [col]
    };
    entities.push(e);
    return e;
  }

  function newRelationship(srcEntityId, srcColumnId, dstEntityId, dstColumnId) {
    return {
      id: uid("r"),
      name: "",
      srcEntity: srcEntityId,
      srcColumn: srcColumnId || null,
      dstEntity: dstEntityId,
      dstColumn: dstColumnId || null,
      cardinality: "1:N",
      onDelete: "RESTRICT",
      onUpdate: "RESTRICT"
    };
  }

  function findEntity(id) {
    for (var i = 0; i < entities.length; i++) if (entities[i].id === id) return entities[i];
    return null;
  }

  function findColumn(entityId, colId) {
    var e = findEntity(entityId);
    if (!e) return null;
    for (var i = 0; i < e.columns.length; i++) if (e.columns[i].id === colId) return e.columns[i];
    return null;
  }

  function findRelationship(id) {
    for (var i = 0; i < relationships.length; i++) if (relationships[i].id === id) return relationships[i];
    return null;
  }

  function relationshipsOf(entityId) {
    var out = [];
    for (var i = 0; i < relationships.length; i++) {
      var r = relationships[i];
      if (r.srcEntity === entityId || r.dstEntity === entityId) out.push(r);
    }
    return out;
  }

  function updateEntity(id, patch) {
    var e = findEntity(id);
    if (!e) return false;
    Object.assign(e, patch);
    return true;
  }

  function updateRelationship(id, patch) {
    var r = findRelationship(id);
    if (!r) return false;
    Object.assign(r, patch);
    return true;
  }

  function removeEntity(id) {
    for (var i = relationships.length - 1; i >= 0; i--) {
      var r = relationships[i];
      if (r.srcEntity === id || r.dstEntity === id) relationships.splice(i, 1);
    }
    for (var j = entities.length - 1; j >= 0; j--) {
      if (entities[j].id === id) entities.splice(j, 1);
    }
    return true;
  }

  function removeRelationship(id) {
    for (var i = relationships.length - 1; i >= 0; i--) {
      if (relationships[i].id === id) { relationships.splice(i, 1); return true; }
    }
    return false;
  }

  function addColumn(entityId) {
    var e = findEntity(entityId);
    if (!e) return null;
    var c = newColumn();
    e.columns.push(c);
    return c;
  }

  function removeColumn(entityId, colId) {
    var e = findEntity(entityId);
    if (!e) return;
    var idx = -1;
    for (var i = 0; i < e.columns.length; i++) if (e.columns[i].id === colId) { idx = i; break; }
    if (idx >= 0) e.columns.splice(idx, 1);
    for (var j = 0; j < relationships.length; j++) {
      var r = relationships[j];
      if (r.srcColumn === colId) r.srcColumn = null;
      if (r.dstColumn === colId) r.dstColumn = null;
    }
  }

  function moveColumn(entityId, colId, delta) {
    var e = findEntity(entityId);
    if (!e) return;
    var idx = -1;
    for (var i = 0; i < e.columns.length; i++) if (e.columns[i].id === colId) { idx = i; break; }
    if (idx < 0) return;
    var target = idx + delta;
    if (target < 0 || target >= e.columns.length) return;
    var c = e.columns.splice(idx, 1)[0];
    e.columns.splice(target, 0, c);
  }

  function duplicateEntity(id) {
    var src = findEntity(id);
    if (!src) return null;
    var copy = {
      id: uid("e"),
      name: src.name,
      comment: src.comment,
      color: src.color,
      w: 220,
      h: 0,
      x: Math.round(src.x + 30),
      y: Math.round(src.y + 30),
      columns: src.columns.map(function (c) {
        return Object.assign({}, c, { id: uid("c") });
      })
    };
    entities.push(copy);
    return copy;
  }

  function keyColumn(entity) {
    for (var i = 0; i < entity.columns.length; i++) if (entity.columns[i].pk) return entity.columns[i];
    return entity.columns[0] || null;
  }

  function exportJSON() {
    return JSON.stringify({ app: "erd-studio", version: 1, settings: settings, entities: entities, relationships: relationships }, null, 2);
  }

  function importJSON(text) {
    var data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Format tidak valid");
    if (data.app !== "erd-studio") throw new Error("Bukan file diagram ERD Studio");
    var idMap = {};

    function remapColumns(cols) {
      return cols.map(function (c) {
        var newId = uid("c");
        idMap[c.id] = newId;
        return Object.assign({}, c, { id: newId });
      });
    }

    entities = (data.entities || []).map(function (e) {
      var newId = uid("e");
      idMap[e.id] = newId;
      return Object.assign({}, e, { id: newId, w: 220, h: 0, columns: remapColumns(e.columns || []) });
    });

    relationships = (data.relationships || []).map(function (r) {
      return Object.assign({}, r, {
        id: uid("r"),
        srcEntity: idMap[r.srcEntity] || null,
        dstEntity: idMap[r.dstEntity] || null,
        srcColumn: r.srcColumn ? (idMap[r.srcColumn] || null) : null,
        dstColumn: r.dstColumn ? (idMap[r.dstColumn] || null) : null
      });
    });

    settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    return true;
  }

  function clearAll() {
    entities = [];
    relationships = [];
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  function saveToLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ settings: settings, entities: entities, relationships: relationships, camera: camera }));
    } catch (e) { /* storage unavailable */ }
  }

  function loadFromLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d.settings) settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
      if (d.camera) camera = Object.assign(camera, d.camera);
      if (d.entities) {
        entities = d.entities.map(function (e) {
          return Object.assign({}, e, { w: 220, h: 0 });
        });
        relationships = (d.relationships || []);
      }
      return entities.length > 0;
    } catch (e) {
      return false;
    }
  }

  function markChanged() {
    if (onChange) onChange();
  }

  function setOnChange(fn) { onChange = fn; }

  function resetColSeq() { colSeq = 0; }

  return {
    TYPES: TYPES,
    STRING_TYPES: STRING_TYPES,
    NUMERIC_TYPES: NUMERIC_TYPES,
    uid: uid,
    getEntities: function () { return entities; },
    getRelationships: function () { return relationships; },
    getSettings: function () { return settings; },
    getCamera: function () { return camera; },
    findEntity: findEntity,
    findColumn: findColumn,
    findRelationship: findRelationship,
    relationshipsOf: relationshipsOf,
    newEntity: newEntity,
    addColumn: addColumn,
    removeColumn: removeColumn,
    moveColumn: moveColumn,
    updateEntity: updateEntity,
    removeEntity: removeEntity,
    duplicateEntity: duplicateEntity,
    newRelationship: newRelationship,
    updateRelationship: updateRelationship,
    removeRelationship: removeRelationship,
    keyColumn: keyColumn,
    exportJSON: exportJSON,
    importJSON: importJSON,
    clearAll: clearAll,
    resetColSeq: resetColSeq,
    saveToLocal: saveToLocal,
    loadFromLocal: loadFromLocal,
    save: function () { saveToLocal(); markChanged(); },
    setOnChange: setOnChange
  };
})();