/* sql.js - MySQL DDL generator */
var App = App || {};

App.sql = (function () {
  "use strict";

  var model = App.model;

  function esc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/'/g, "''");
  }

  var STRINGISH = ["CHAR", "VARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT",
    "ENUM", "SET", "BINARY", "VARBINARY", "UUID", "DATE", "TIME", "DATETIME", "TIMESTAMP"];

  function mysqlType(c) {
    var t = c.type || "VARCHAR";
    if (c.length && t !== "ENUM" && t !== "SET") t += "(" + c.length + ")";
    if (t === "ENUM" || t === "SET") {
      var vals = splitEnum(c.enumValues);
      t += "(" + vals.map(function (v) { return "'" + esc(v) + "'"; }).join(",") + ")";
    }
    if (c.unsigned && c.type !== "BIT") t += " UNSIGNED";
    return t;
  }

  function splitEnum(raw) {
    if (!raw) return [];
    return String(raw).split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function defaultClause(c) {
    var raw = (c.default || "").trim();
    if (!raw) return "";
    var up = raw.toUpperCase();
    if (up === "NULL" || up === "CURRENT_TIMESTAMP" || up === "CURRENT_DATE" ||
        up === "CURRENT_TIME" || up === "TRUE" || up === "FALSE" || up === "CURRENT_TIMESTAMP()") {
      return " DEFAULT " + (up === "CURRENT_TIMESTAMP()" ? "CURRENT_TIMESTAMP()" : up);
    }
    if (/^\(.*\)$/.test(raw)) return " DEFAULT " + raw;
    var isNum = /^-?\d+(\.\d+)?$/.test(raw) && model.NUMERIC_TYPES.indexOf(c.type) !== -1;
    if (isNum) return " DEFAULT " + raw;
    return " DEFAULT '" + esc(raw) + "'";
  }

  function referenceInfo(r, side) {
    var entityId = side === "src" ? r.srcEntity : r.dstEntity;
    var columnId = side === "src" ? r.srcColumn : r.dstColumn;
    var e = model.findEntity(entityId);
    var c = null;
    if (columnId) c = model.findColumn(entityId, columnId);
    if (!c && e) c = model.keyColumn(e);
    return { entity: e, column: c };
  }

  function colTypeFrom(c) {
    if (!c) return { type: "INT", length: "11", unsigned: true };
    return { type: c.type, length: c.length, unsigned: c.unsigned };
  }

  function tableName(prefix, names, used) {
    var joined = names.join("_").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    var base = prefix + joined;
    var name = base.slice(0, 64);
    var n = 1;
    while (used[name]) { n++; name = (base + "_" + n).slice(0, 64); }
    used[name] = true;
    return name;
  }

  function relationName(child, parent, col, used) {
    var base = "fk_" + child + "_" + parent;
    var name = base.slice(0, 64);
    var n = 1;
    while (used[name]) { n++; name = (base + "_" + n).slice(0, 64); }
    used[name] = true;
    return name;
  }

  function buildCreateTable(e, usedNames) {
    var s = [];
    var table = e.name.trim();
    s.push("-- ------------------------------------------------");
    s.push("-- Table: " + table + (e.comment ? " (" + e.comment + ")" : ""));
    s.push("-- ------------------------------------------------");
    if (settings().dropTables) s.push("DROP TABLE IF EXISTS `" + table + "`;");

    var cols = [];
    var pkCols = [];
    for (var i = 0; i < e.columns.length; i++) {
      var c = e.columns[i];
      var def = "    `" + c.name + "` " + mysqlType(c);
      if (c.autoIncrement && !c.pk && pkCols.indexOf(c.name) === -1) pkCols.push(c.name);
      def += c.nullable ? " NULL" : " NOT NULL";
      if (c.autoIncrement) def += " AUTO_INCREMENT";
      def += defaultClause(c);
      if (c.comment) def += " COMMENT '" + esc(c.comment) + "'";
      cols.push(def);
      if (c.pk && pkCols.indexOf(c.name) === -1) pkCols.push(c.name);
    }

    if (pkCols.length > 0) {
      cols.push("    PRIMARY KEY (`" + pkCols.join("`,`") + "`)");
    }

    var keys = [];
    for (var j = 0; j < e.columns.length; j++) {
      var col = e.columns[j];
      if (col.unique) keys.push("    UNIQUE KEY `uq_" + table + "_" + col.name + "` (`" + col.name + "`)");
      else if (col.index) keys.push("    KEY `idx_" + table + "_" + col.name + "` (`" + col.name + "`)");
    }

    s.push("CREATE TABLE `" + table + "` (");
    s.push(cols.concat(keys).join(",\n"));
    var settingsObj = settings();
    s.push(") ENGINE=" + (settingsObj.engine || "InnoDB") +
      " DEFAULT CHARSET=" + (settingsObj.charset || "utf8mb4") +
      (settingsObj.collate ? " COLLATE=" + settingsObj.collate : "") +
      (e.comment ? " COMMENT='" + esc(e.comment) + "'" : "") +
      ";");
    s.push("");
    return s.join("\n");
  }

  function buildJunction(r, usedNames) {
    var src = referenceInfo(r, "src");
    var dst = referenceInfo(r, "dst");
    if (!src.entity || !dst.entity || src.entity.id === dst.entity.id) return null;

    var sd = colTypeFrom(src.column);
    var dd = colTypeFrom(dst.column);
    var sType = sd.type + (sd.length ? "(" + sd.length + ")" : "") + (sd.unsigned ? " UNSIGNED" : "");
    var dType = dd.type + (dd.length ? "(" + dd.length + ")" : "") + (dd.unsigned ? " UNSIGNED" : "");

    var srcName = src.column ? src.column.name : (model.keyColumn(src.entity) || src.entity.columns[0]).name;
    var dstName = dst.column ? dst.column.name : (model.keyColumn(dst.entity) || dst.entity.columns[0]).name;

    var name1 = tableName("", [src.entity.name, dst.entity.name], usedNames);
    var colA = (src.entity.name + "_" + srcName).replace(/[^a-zA-Z0-9_]/g, "_");
    var colB = (dst.entity.name + "_" + dstName).replace(/[^a-zA-Z0-9_]/g, "_");
    var s = [];
    var jt = name1;
    s.push("-- ------------------------------------------------");
    s.push("-- Junction table: " + jt + "  (" + src.entity.name + " <-> " + dst.entity.name + ")");
    s.push("-- ------------------------------------------------");
    if (settings().dropTables) s.push("DROP TABLE IF EXISTS `" + jt + "`;");

    var cols = [
      "    `" + colA + "` " + sType + " NOT NULL",
      "    `" + colB + "` " + dType + " NOT NULL",
      "    PRIMARY KEY (`" + colA + "`,`" + colB + "`)"
    ];
    var fkNames = usedNames;
    var fkA = relationName(jt, src.entity.name, colA, fkNames);
    var fkB = relationName(jt, dst.entity.name, colB, fkNames);
    cols.push("    KEY `idx_" + jt + "_" + colB + "` (`" + colB + "`)");
    var cons = [
      "    CONSTRAINT `" + fkA + "` FOREIGN KEY (`" + colA + "`) REFERENCES `" + src.entity.name + "` (`" + srcName + "`) ON DELETE " + (r.onDelete || "RESTRICT") + " ON UPDATE " + (r.onUpdate || "RESTRICT"),
      "    CONSTRAINT `" + fkB + "` FOREIGN KEY (`" + colB + "`) REFERENCES `" + dst.entity.name + "` (`" + dstName + "`) ON DELETE " + (r.onDelete || "RESTRICT") + " ON UPDATE " + (r.onUpdate || "RESTRICT")
    ];

    s.push("CREATE TABLE `" + jt + "` (");
    s.push(cols.concat(cons).join(",\n"));
    var settingsObj = settings();
    s.push(") ENGINE=" + (settingsObj.engine || "InnoDB") +
      " DEFAULT CHARSET=" + (settingsObj.charset || "utf8mb4") +
      (settingsObj.collate ? " COLLATE=" + settingsObj.collate : "") +
      ";");
    s.push("");
    return s.join("\n");
  }

  function buildForeignKey(r, usedNames) {
    var src = referenceInfo(r, "src");
    var dst = referenceInfo(r, "dst");
    if (!src.entity || !dst.entity || !src.column || !dst.column) return null;
    if (src.entity.id === dst.entity.id) return null;

    var fkName = relationName(src.entity.name, dst.entity.name, src.column.name, usedNames);
    return "ALTER TABLE `" + src.entity.name + "`" +
      "\n  ADD CONSTRAINT `" + fkName + "`" +
      "\n  FOREIGN KEY (`" + src.column.name + "`) REFERENCES `" + dst.entity.name + "` (`" + dst.column.name + "`)" +
      "\n  ON DELETE " + (r.onDelete || "RESTRICT") +
      "\n  ON UPDATE " + (r.onUpdate || "RESTRICT") + ";";
  }

  function settings() { return model.getSettings(); }

  function generate() {
    var usingNames = {};
    var lines = [];
    var s = settings();

    lines.push("-- ================================================");
    lines.push("-- Generated by ERD Studio");
    lines.push("-- MySQL DDL Script");
    lines.push("-- " + new Date().toLocaleString());
    lines.push("-- ================================================");
    lines.push("SET NAMES " + (s.charset || "utf8mb4") + ";");
    if (s.fkChecks) lines.push("SET FOREIGN_KEY_CHECKS = 0;");
    lines.push("");

    var entities = model.getEntities();
    var relationships = model.getRelationships();
    var warnings = [];

    for (var i = 0; i < entities.length; i++) {
      lines.push(buildCreateTable(entities[i], usingNames));
    }

    for (var j = 0; j < relationships.length; j++) {
      var r = relationships[j];
      if (r.cardinality === "N:N") {
        var jt = buildJunction(r, usingNames);
        if (jt) lines.push(jt);
        else warnings.push("Relasi " + (r.name || "tanpa nama") + " (N:N) dilewati: entitas tidak valid.");
      } else {
        var fc = buildForeignKey(r, usingNames);
        if (fc) lines.push(fc);
        else warnings.push("Relasi " + (r.name || "tanpa nama") + " dilewati: kolom sumber/tujuan tidak ditemukan.");
      }
    }

    lines.push("SET FOREIGN_KEY_CHECKS = 1;");
    lines.push("-- End of script");
    return { script: lines.join("\n"), warnings: warnings };
  }

  return {
    generate: generate,
    mysqlType: mysqlType,
    esc: esc
  };
})();