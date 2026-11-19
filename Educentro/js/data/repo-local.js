/* EDU.repoLocal: adaptador de repositorio sobre localStorage (con fallback en memoria).
   Interfaz asincrona de bajo nivel; NO aplica permisos (eso lo hace EDU.repo). Una clave por coleccion. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var P = 'edu:v1:col:';
  var cache = {};

  var COLECCIONES = ['centros', 'usuarios', 'anios', 'periodos', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores',
    'matriculas', 'escalas', 'categorias', 'actividades', 'calificaciones', 'asistencia', 'comunicados', 'planes', 'horarios', 'agenteConfig', 'agenteLog',
    'auditoria', 'curriculoVersiones', 'curriculoContenidos', 'secuencias'];

  function clon(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function leer(col) {
    if (!cache[col]) cache[col] = EDU.almacen.getJSON(P + col, []);
    return cache[col];
  }
  function escribir(col) {
    var ok = EDU.almacen.set(P + col, JSON.stringify(cache[col]));
    if (!ok) EDU.repoLocal.advertencia = 'No se pudo escribir en localStorage; los cambios viven solo en memoria.';
    return ok;
  }
  function idNuevo(col) { return col.slice(0, 3) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ahora() { return new Date().toISOString(); }
  function chk(col) { if (COLECCIONES.indexOf(col) === -1) throw new Error('Coleccion desconocida: ' + col); }

  window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf(P) === 0) delete cache[e.key.slice(P.length)]; });

  function upsert(arr, rec) {
    var i = -1;
    for (var k = 0; k < arr.length; k++) if (arr[k].id === rec.id) { i = k; break; }
    var t = ahora();
    if (i === -1) { rec.creadoEn = rec.creadoEn || t; rec.actualizadoEn = t; arr.push(rec); }
    else { rec.actualizadoEn = t; arr[i] = rec; }
    return rec;
  }

  EDU.repoLocal = {
    COLECCIONES: COLECCIONES,
    advertencia: null,
    idNuevo: idNuevo,
    /** listar(col, {centroId}): si centroId esta definido (no undefined) filtra por registro.centroId === centroId. */
    listar: function (col, o) {
      chk(col); o = o || {};
      var a = leer(col);
      if (o.centroId !== undefined && o.centroId !== null) a = a.filter(function (r) { return r.centroId === o.centroId; });
      return Promise.resolve(clon(a));
    },
    obtener: function (col, id) {
      chk(col);
      var r = leer(col).filter(function (x) { return x.id === id; })[0];
      return Promise.resolve(r ? clon(r) : null);
    },
    guardar: function (col, rec) {
      chk(col);
      rec = clon(rec); if (!rec.id) rec.id = idNuevo(col);
      upsert(leer(col), rec); escribir(col);
      return Promise.resolve(clon(rec));
    },
    guardarMuchos: function (col, recs) {
      chk(col);
      var a = leer(col);
      var out = recs.map(function (r) { r = clon(r); if (!r.id) r.id = idNuevo(col); return upsert(a, r); });
      escribir(col);
      return Promise.resolve(clon(out));
    },
    borrar: function (col, id) {
      chk(col);
      var a = leer(col), n = a.length;
      cache[col] = a.filter(function (x) { return x.id !== id; });
      escribir(col);
      return Promise.resolve(cache[col].length < n);
    },
    /** Reemplaza toda la coleccion (semilla/importar). */
    reemplazar: function (col, recs) { chk(col); cache[col] = clon(recs); escribir(col); return Promise.resolve(true); },
    exportarTodo: function () {
      var o = {};
      COLECCIONES.forEach(function (c) { o[c] = clon(leer(c)); });
      return Promise.resolve(o);
    },
    importarTodo: function (obj) {
      COLECCIONES.forEach(function (c) { cache[c] = clon(obj[c] || []); escribir(c); });
      return Promise.resolve(true);
    },
    limpiarTodo: function () {
      EDU.almacen.keys(P).forEach(function (k) { EDU.almacen.remove(k); });
      cache = {};
      return Promise.resolve(true);
    }
  };
})();
