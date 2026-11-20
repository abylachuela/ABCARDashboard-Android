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
    if (col !== 'calificaciones' && col !== 'notasCompetencia') return Promise.resolve();
    return A().guardar('auditoria', { centroId: (despues || antes || {}).centroId || s.centroActivo, usuarioId: s.usuarioId, accion: accion, coleccion: col,
      registroId: id, antes: antes || null, despues: despues || null, fecha: new Date().toISOString() });
  }

  var ROL_AUD = { docente: 'docentes', tutor: 'tutores', estudiante: 'estudiantes' };
  var ROLES_AUDITAN = ['admin_red', 'director', 'docente', 'secretaria'];
  var CAMPOS_AUDIT = ['accion', 'coleccion', 'registroId', 'motivo', 'archivo', 'hojas', 'registros', 'valores', 'estudiantesCreados', 'matriculasCreadas', 'discrepancias', 'antes', 'despues'];
  var STR = function (v, n) { return String(v == null ? '' : v).slice(0, n || 300); };

  /** Reglas de propiedad (defensa en profundidad; el control real debe estar en el backend):
      - usuarios: solo admin_red puede crear/promover admin_red ni cambiar el propio rol/centro/refId.
      - docente: solo escribe notas/actividades/categorias de SUS cargas.
      - estudiante: solo escribe entregas/intentos propios y mensajes de foro firmados por su usuario. */
  async function propiedad(s, col, rec, antes) {
    var a = A();
    if (col === 'usuarios' && s.rol !== 'admin_red') {
      if (rec.rol === 'admin_red' || (antes && antes.rol === 'admin_red')) throw new Error('Sin permiso para administrar usuarios admin_red');
      if (antes && antes.id === s.usuarioId && (rec.rol !== antes.rol || (rec.refId || null) !== (antes.refId || null) || (rec.centroId || null) !== (antes.centroId || null))) throw new Error('No puedes cambiar tu propio rol o centro');
    }
    if (s.rol === 'docente') {
      var cargaId = null;
      if (col === 'calificaciones') { var ac = await a.obtener('actividades', rec.actividadId || (antes && antes.actividadId)); cargaId = ac && ac.cargaId; if (!ac) throw new Error('Actividad no encontrada'); }
      else if (['notasCompetencia', 'actividades', 'categorias'].indexOf(col) !== -1) cargaId = rec.cargaId || (antes && antes.cargaId);
      if (cargaId !== null) {
        var ca = await a.obtener('cargas', cargaId);
        if (!ca || ca.docenteId !== s.refId) throw new Error('Sin permiso: la carga docente no es tuya');
      }
    }
    if (s.rol === 'estudiante') {
      if ((col === 'entregas' || col === 'intentos') && (rec.estudianteId !== s.refId || (antes && antes.estudianteId !== s.refId))) throw new Error('Sin permiso: solo tus propios registros');
      if (col === 'foroMensajes' && (rec.autorId !== s.usuarioId || (antes && antes.autorId !== s.usuarioId))) throw new Error('Sin permiso: solo tus propios mensajes');
    }
  }

  /** Copia el registro y le asigna/valida centroId (comun a guardar y guardarMuchos). */
  function preparar(s, col, rec) {
    rec = Object.assign({}, rec);
    if (GLOBALES.indexOf(col) === -1) {
      if (!rec.centroId) rec.centroId = s.centroActivo;
      if (!rec.centroId && !(col === 'usuarios' && s.rol === 'admin_red')) throw new Error('centroId requerido (elige un centro activo)');
      if (rec.centroId && !EDU.permisos.centroPermitido(s, rec.centroId)) throw new Error('Centro no permitido');
    }
    return rec;
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
    /** conMotivo(motivo, fn): solo modo API (cabecera X-EDU-Motivo); en modo local solo ejecuta fn. */
    conMotivo: function (motivo, fn) { var a = A(); return typeof a.conMotivo === 'function' ? a.conMotivo(motivo, fn) : fn(); },
    /** Cambia el adaptador (p. ej. API HTTP) manteniendo la misma interfaz. */
    usar: function (ad) { adaptador = ad; },
    adaptador: function () { return A(); },
    /** Endpoints transaccionales del servidor (Fase 3A) o null en modo local: las vistas usan `var N = EDU.repo.negocio(); if (N) …`. */
    negocio: function () { var a = A(); return a && a.esServidor && a.negocio ? a.negocio : null; },
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
      rec = preparar(s, col, rec);
      // Con servidor (esServidor) la autoridad es la API: no se relee `antes` (centro inmutable, propiedad y auditoria los aplica el servidor).
      var antes = rec.id && !A().esServidor ? await A().obtener(col, rec.id) : null;
      if (antes && antes.centroId && rec.centroId !== antes.centroId) throw new Error('No se puede cambiar el centro de un registro');
      await propiedad(s, col, rec, antes);
      var g = await A().guardar(col, rec);
      if (!A().esServidor && SIN_AUDITAR.indexOf(col) === -1) await auditar(s, antes ? 'editar' : 'crear', col, g.id, antes, g);
      return g;
    },
    guardarMuchos: async function (col, recs) {
      var out = [], i;
      if (A().esServidor && typeof A().guardarMuchos === 'function') { // un solo viaje por lotes (maximo 500) tras validar cada registro
        var s = permitir(col, 'guardar'), lote = [];
        for (i = 0; i < recs.length; i++) { var r = preparar(s, col, recs[i]); await propiedad(s, col, r, null); lote.push(r); }
        return lote.length ? A().guardarMuchos(col, lote) : [];
      }
      for (i = 0; i < recs.length; i++) out.push(await EDU.repo.guardar(col, recs[i]));
      return out;
    },
    borrar: async function (col, id) {
      var s = permitir(col, 'borrar');
      if (A().esServidor) return A().borrar(col, id);
      var antes = await A().obtener(col, id);
      if (!antes) return false;
      if (antes.centroId && !EDU.permisos.centroPermitido(s, antes.centroId)) throw new Error('Centro no permitido');
      await propiedad(s, col, antes, antes);
      var ok = await A().borrar(col, id);
      if (ok) await auditar(s, 'borrar', col, id, antes, null);
      return ok;
    },
    /** Ruta controlada para escribir en `auditoria` (ninguna vista usa el adaptador directo). usuarioId y fecha los fija el repo;
        el centro debe ser el del usuario (o cualquiera si admin_red); solo roles que operan datos; tutor/estudiante no auditan. */
    auditar: async function (accion, datos) {
      var s = esc();
      if (!s) throw new Error('Sin sesion');
      if (ROLES_AUDITAN.indexOf(s.rol) === -1) throw new Error('Sin permiso para auditar');
      datos = datos || {};
      var cid = datos.centroId || s.centroActivo || s.centroUsuario;
      if (!cid || !EDU.permisos.centroPermitido(s, cid)) throw new Error('Centro no permitido');
      var reg = { centroId: cid, usuarioId: s.usuarioId, rol: s.rol, accion: STR(accion, 60), fecha: new Date().toISOString() };
      CAMPOS_AUDIT.forEach(function (k) { if (datos[k] !== undefined && k !== 'accion') reg[k] = typeof datos[k] === 'string' ? STR(datos[k], 600) : datos[k]; });
      return typeof A().auditar === 'function' ? A().auditar(reg) : A().guardar('auditoria', reg); // servidor: POST /auditoria (fija usuario, rol y fecha)
    },
    /** Confirmacion de lectura de un comunicado por el propio usuario (tutor/estudiante/docente no escriben `comunicados`).
        Solo anade {usuarioId, fecha} propio a `lecturas`; valida centro, estado publicado y audiencia por rol. */
    registrarLectura: async function (comunicadoId) {
      var s = esc();
      if (!s || !EDU.permisos.puede(s.rol, 'comunicados', 'ver')) throw new Error('Sin permiso');
      if (typeof A().registrarLectura === 'function') return A().registrarLectura(comunicadoId); // servidor: valida centro, estado y audiencia
      var c = await A().obtener('comunicados', comunicadoId);
      if (!c || c.centroId !== s.centroUsuario || c.estado !== 'publicado') throw new Error('Comunicado no disponible.');
      var aud = c.destinatarios || 'todos';
      if (aud !== 'todos' && ROL_AUD[s.rol] !== aud) throw new Error('Comunicado no disponible.');
      if (c.segmento && c.segmento.tipo === 'tutor' && (s.rol !== 'tutor' || c.segmento.id !== s.refId)) throw new Error('Comunicado no disponible.');
      c.lecturas = Array.isArray(c.lecturas) ? c.lecturas : [];
      if (!c.lecturas.some(function (l) { return l.usuarioId === s.usuarioId; })) c.lecturas.push({ usuarioId: s.usuarioId, fecha: new Date().toISOString() });
      return A().guardar('comunicados', c);
    },
    /** Respaldo completo (solo admin_red/director). Para roles no admin_red solo exporta el centro del usuario (y la tabla `centros` filtrada). */
    exportarTodo: async function () {
      var s = esc(); if (!s || !EDU.permisos.puede(s.rol, 'respaldo', 'exportar')) throw new Error('Sin permiso');
      var todo = await A().exportarTodo();
      if (s.rol === 'admin_red') return todo;
      var out = {};
      Object.keys(todo).forEach(function (col) {
        out[col] = (todo[col] || []).filter(function (r) { return col === 'centros' ? r.id === s.centroUsuario : r.centroId === s.centroUsuario; });
      });
      return out;
    },
    /** Importa un respaldo. admin_red reemplaza las colecciones presentes; los demas roles solo pueden aportar registros de SU centro
        (cualquier registro ajeno, o un usuario admin_red, aborta) y el repo conserva los registros de otros centros. */
    importarTodo: async function (o) {
      var s = esc(); if (!s || !EDU.permisos.puede(s.rol, 'respaldo', 'importar')) throw new Error('Sin permiso');
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Respaldo invalido');
      if (A().esServidor) throw new Error('La importación de respaldos estará disponible en la Fase 5.');
      var actual = await A().exportarTodo(), full = {}, admin = s.rol === 'admin_red';
      EDU.repoLocal.COLECCIONES.forEach(function (c) {
        var nuevo = o[c];
        if (nuevo === undefined) { full[c] = actual[c] || []; return; }
        if (!Array.isArray(nuevo)) throw new Error('Coleccion invalida: ' + c);
        if (c === 'auditoria' && !admin) { full[c] = actual[c] || []; return; } // la auditoria no se reescribe por importacion
        if (admin) { full[c] = nuevo; return; }
        nuevo.forEach(function (r) {
          var cid = c === 'centros' ? r && r.id : r && r.centroId;
          if (cid !== s.centroUsuario) throw new Error('El respaldo contiene datos de otro centro (' + c + '); importacion abortada');
          if (c === 'usuarios' && r.rol === 'admin_red') throw new Error('No se permite importar usuarios admin_red');
        });
        var ajenos = (actual[c] || []).filter(function (r) { return (c === 'centros' ? r.id : r.centroId) !== s.centroUsuario; });
        full[c] = ajenos.concat(nuevo);
      });
      return A().importarTodo(full);
    }
  };
})();
