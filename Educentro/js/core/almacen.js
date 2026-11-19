/* EDU.almacen: localStorage seguro con fallback en memoria. Nunca lanza. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var mem = {};
  var ls = null;
  try {
    ls = window.localStorage;
    ls.setItem('__edu_t', '1');
    ls.removeItem('__edu_t');
  } catch (e) { ls = null; }

  EDU.almacen = {
    /** 'local' si localStorage funciona, 'memoria' si no. */
    modo: function () { return ls ? 'local' : 'memoria'; },
    get: function (k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k];
      try { return ls ? ls.getItem(k) : null; } catch (e) { return null; }
    },
    set: function (k, v) {
      try {
        if (ls) { ls.setItem(k, v); delete mem[k]; return true; }
      } catch (e) { /* cuota llena: cae a memoria */ }
      mem[k] = v;
      return false;
    },
    remove: function (k) {
      delete mem[k];
      try { if (ls) ls.removeItem(k); } catch (e) { /* nada */ }
    },
    keys: function (prefijo) {
      var out = {};
      try { if (ls) for (var i = 0; i < ls.length; i++) out[ls.key(i)] = 1; } catch (e) { /* nada */ }
      Object.keys(mem).forEach(function (k) { out[k] = 1; });
      return Object.keys(out).filter(function (k) { return !prefijo || k.indexOf(prefijo) === 0; });
    },
    getJSON: function (k, def) {
      var v = this.get(k);
      if (v == null) return def;
      try { return JSON.parse(v); } catch (e) { return def; }
    },
    setJSON: function (k, obj) { return this.set(k, JSON.stringify(obj)); }
  };
})();
