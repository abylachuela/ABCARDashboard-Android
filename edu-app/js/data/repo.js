/* EDU.repo: fachada del repositorio. Aplica sesion, centro activo y permisos de escritura, y delega
   en un adaptador (por defecto EDU.repoLocal; para API real: EDU.repo.usar(adaptadorApi)). Todo devuelve Promesas. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var adaptador = null;
  var GLOBALES = ['centros'];
  var SIN_AUDITAR = ['auditoria', 'agenteLog'];
  function A() { return adaptador || EDU.repoLocal; }
  function esc() { return EDU.estado && EDU.estado.sesion(); }

  /** Resuelve el centroId efectivo para una lectura: string, o null = todos (solo admin_red en "Todos"). */
  function centroLectura(col, o) {
    var s = esc();
    if (!s) {
      if (col === 'usuarios' || col === 'centros') return null; // login
      throw new Error('Sin sesion');
    }
    if (GLOBALES.indexOf(col) !== -1) return null;
    var pedido = o && o.centroId !== undefined ? o.centroId : s.centroActivo;
    if (s.rol !== 'admin_red') {
      if (pedido !== s.centroUsuario) throw new Error('Centro no permitido');
      return s.centroUsuario;
    }
    return pedido;
  }
  function coincide(r, f) {
    if (!f) return true;
    if (typeof f === 'function') return !!f(r);
    return Object.keys(f).every(function (k) {
      var c = f[k], v = r[k];
      if (typeof c === 'function') return !!c(v, r);
      if (Array.isArray(c)) return c.indexOf(v) !== -1;
      return v === c;
    });
  }
  function ordenar(lista, o) {
    if (!o || !o.orden) return lista;
    var k = o.orden, d = o.desc ? -1 : 1;
    var get = typeof k === 'function' ? k : function (r) { return r[k]; };
    return lista.slice().sort(function (a, b) {
      var x = get(a), y = get(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * d;
    });
  }
  function recorte(lista, o) {
    if (!o) return lista;
    var off = o.offset || 0;
    return o.limite ? lista.slice(off, off + o.limite) : (off ? lista.slice(off) : lista);
  }
  function permitir(col, accion) {
    var s = esc();
    if (!s) throw new Error('Sin sesion');
    if (!EDU.permisos.puedeEscribirColeccion(s.rol, col)) throw new Error('Sin permiso para ' + accion + ' en ' + col);
    return s;
  }
  function auditar(s, accion, col, id, antes, despues) {
    if (col !== 'calificaciones') return Promise.resolve();
    return A().guardar('auditoria', { centroId: (despues || antes || {}).centroId || s.centroActivo, usuarioId: s.usuarioId, accion: accion, coleccion: col,
      registroId: id, antes: antes || null, despues: despues || null, fecha: new Date().toISOString() });
  }

  async function listar(col, o) {
    o = o || {};
    var cid = centroLectura(col, o);
    var lista = await A().listar(col, { centroId: cid === null ? undefined : cid });
    var s = esc();
    if (col === 'centros' && s && s.rol !== 'admin_red') lista = lista.filter(function (c) { return c.id === s.centroUsuario; });
    if (o.filtro) lista = lista.filter(function (r) { return coincide(r, o.filtro); });
    return recorte(ordenar(lista, o), o);
  }

  EDU.repo = {
    COLECCIONES: EDU.repoLocal.COLECCIONES,
    GLOBALES: GLOBALES,
    /** Cambia el adaptador (p. ej. API HTTP) manteniendo la misma interfaz. */
    usar: function (ad) { adaptador = ad; },
    adaptador: function () { return A(); },
    /** listar(col, {centroId?, filtro?, orden?, desc?, limite?, offset?}) */
    listar: listar,
    /** consultar(col, filtro, opts): filtro = objeto {campo: valor | [valores] | fn(valor,reg)} o fn(reg). */
    consultar: function (col, filtro, o) { return listar(col, Object.assign({}, o, { filtro: filtro })); },
    contar: async function (col, filtro, o) { return (await listar(col, Object.assign({}, o, { filtro: filtro }))).length; },
    obtener: async function (col, id) {
      var r = await A().obtener(col, id);
      if (!r) return null;
      var s = esc();
      if (s && GLOBALES.indexOf(col) === -1 && r.centroId && !EDU.permisos.centroPermitido(s, r.centroId)) return null;
      if (s && col === 'centros' && !EDU.permisos.centroPermitido(s, r.id)) return null;
      return r;
    },
    /** guardar(col, reg): crea (genera id) o actualiza. Asigna centroId del centro activo si falta. */
    guardar: async function (col, rec) {
      var s = permitir(col, 'guardar');
      rec = Object.assign({}, rec);
      if (GLOBALES.indexOf(col) === -1) {
        if (!rec.centroId) rec.centroId = s.centroActivo;
        if (!rec.centroId && !(col === 'usuarios' && s.rol === 'admin_red')) throw new Error('centroId requerido (elige un centro activo)');
        if (rec.centroId && !EDU.permisos.centroPermitido(s, rec.centroId)) throw new Error('Centro no permitido');
      }
      var antes = rec.id ? await A().obtener(col, rec.id) : null;
      if (antes && antes.centroId && rec.centroId !== antes.centroId) throw new Error('No se puede cambiar el centro de un registro');
      var g = await A().guardar(col, rec);
      if (SIN_AUDITAR.indexOf(col) === -1) await auditar(s, antes ? 'editar' : 'crear', col, g.id, antes, g);
      return g;
    },
    guardarMuchos: async function (col, recs) {
      var out = [];
      for (var i = 0; i < recs.length; i++) out.push(await EDU.repo.guardar(col, recs[i]));
      return out;
    },
    borrar: async function (col, id) {
      var s = permitir(col, 'borrar');
      var antes = await A().obtener(col, id);
      if (!antes) return false;
      if (antes.centroId && !EDU.permisos.centroPermitido(s, antes.centroId)) throw new Error('Centro no permitido');
      var ok = await A().borrar(col, id);
      if (ok) await auditar(s, 'borrar', col, id, antes, null);
      return ok;
    },
    /** Respaldo completo (solo admin_red/director). */
    exportarTodo: function () { var s = esc(); if (!s || !EDU.permisos.puede(s.rol, 'respaldo', 'exportar')) throw new Error('Sin permiso'); return A().exportarTodo(); },
    importarTodo: function (o) { var s = esc(); if (!s || !EDU.permisos.puede(s.rol, 'respaldo', 'importar')) throw new Error('Sin permiso'); return A().importarTodo(o); }
  };
})();
