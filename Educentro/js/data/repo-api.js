/* EDU.repoApi: adaptador de repositorio sobre la API REST (/api/v1) con la MISMA interfaz que EDU.repoLocal.
   Solo se activa con EDU_CONFIG.modo === 'api' (EDU.repo.usar(EDU.repoApi)). No aplica permisos del cliente (eso lo hace EDU.repo; el servidor es la autoridad).
   - Sesion: cookie HttpOnly que el JS no ve (credentials 'same-origin'); en metodos no seguros se envia X-EDU-CSRF (token recibido en login / GET /auth/me, solo en MEMORIA).
   - Datos: cache en memoria por sesion (se descarta al escribir, al iniciar o cerrar sesion). NUNCA escribe en localStorage/sessionStorage/IndexedDB.
   - Errores: siempre Error con mensaje en espanol (propiedades `estado` HTTP, `codigo`, `campos`); nunca se muestran cuerpos crudos ni detalles internos del servidor. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var CFG = window.EDU_CONFIG || {};
  var BASE = String(CFG.apiBase || '/api/v1').replace(/\/+$/, '');
  var LIMITE = 500, MAX_PAGINAS = 400, MAX_LOTE = 500, REINTENTOS_429 = 2, ESPERA_MAX_MS = 4000;
  var CACHE_MS = typeof CFG.cacheMs === 'number' ? CFG.cacheMs : 30000;
  var SEGUROS = { GET: 1, HEAD: 1, OPTIONS: 1 };
  var COLECCIONES = (EDU.repoLocal && EDU.repoLocal.COLECCIONES) || [];
  var MSG = {
    red: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
    sesion: 'Tu sesión caducó. Ingresa de nuevo.',
    permiso: 'Sin permiso para esta operación.',
    noHallado: 'No se encontró el registro.',
    conflicto: 'El registro cambió, recarga e inténtalo de nuevo.',
    datos: 'Los datos enviados no son válidos.',
    limite: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    servidor: 'El servidor no pudo completar la operación. Inténtalo más tarde.',
    duplicado: 'Ya existe un registro con esos datos.',
    grande: 'El registro o el archivo es demasiado grande.',
    inesperada: 'Respuesta inesperada del servidor.',
    fase5: 'Disponible en la Fase 5 (migración de datos); aún no está activo en modo servidor.'
  };

  var csrf = null, motivoActual = null;
  var cacheL = {}, cacheO = {};
  var api = {};

  function clon(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
  function limpio(s, n) { return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n) : ''; }
  function error(mensaje, estado, codigo, campos) {
    var e = new Error(mensaje); e.name = 'ErrorApi'; e.estado = estado || 0; e.codigo = codigo || null; e.campos = campos || null; return e;
  }
  function chk(col) { if (COLECCIONES.indexOf(col) === -1) throw new Error('Coleccion desconocida: ' + col); }
  function esAdmin() { var s = EDU.estado && EDU.estado.sesion && EDU.estado.sesion(); return !!s && s.rol === 'admin_red'; }
  function credenciales() { return /^https?:\/\//i.test(BASE) && !(typeof location !== 'undefined' && BASE.indexOf(location.origin) === 0) ? 'include' : 'same-origin'; }
  function F() { return api.fetchImpl || window.fetch.bind(window); }

  /** Mensaje en espanol a partir de la respuesta. 422 muestra el mensaje de validacion del servidor (saneado) y los campos; el resto, textos fijos. */
  function mensajeDe(estado, cuerpo, mensajes) {
    if (mensajes && mensajes[estado]) return mensajes[estado];
    var er = cuerpo && typeof cuerpo === 'object' && cuerpo.error && typeof cuerpo.error === 'object' ? cuerpo.error : {};
    if (estado === 401) return MSG.sesion;
    if (estado === 403) return er.codigo === 'cambio_clave_obligatorio' ? 'Debes cambiar tu contraseña antes de continuar.' : MSG.permiso;
    if (estado === 404) return MSG.noHallado;
    if (estado === 409) return !er.codigo || er.codigo === 'conflicto_version' ? MSG.conflicto : (limpio(er.mensaje, 200) || MSG.duplicado);
    if (estado === 413) return MSG.grande;
    if (estado === 429) return MSG.limite;
    if (estado === 422) {
      var m = limpio(er.mensaje, 200) || MSG.datos, c = Array.isArray(er.campos) ? er.campos.map(function (x) { return limpio(String(x), 40); }).filter(Boolean).slice(0, 8) : [];
      return c.length ? m + ' (' + c.join(', ') + ')' : m;
    }
    return estado >= 500 ? MSG.servidor : MSG.datos;
  }

  function esperar(ms) { return api.esperar(ms); }
  function espera429(resp, intento) {
    var ra = 0;
    try { ra = parseFloat(resp.headers && resp.headers.get && resp.headers.get('Retry-After')); } catch (e) { ra = 0; }
    var ms = isFinite(ra) && ra > 0 ? ra * 1000 : 500 * Math.pow(2, intento);
    return Math.min(ms, ESPERA_MAX_MS);
  }

  function caducada() {
    csrf = null; limpiarCache();
    var E = EDU.estado;
    if (E && E.autenticado && E.autenticado()) {
      if (EDU.ui && EDU.ui.toast) EDU.ui.toast(MSG.sesion, 'warn', 6000);
      E.cerrarSesion({ sinServidor: true });
    }
  }

  /** peticion(metodo, ruta, {cuerpo?, ifMatch?, sinCierre?, mensajes?}) -> JSON | null (204). */
  async function peticion(metodo, ruta, o) {
    o = o || {};
    var init = { method: metodo, credentials: credenciales(), cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } };
    if (o.cuerpo !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.cuerpo); }
    if (!SEGUROS[metodo] && csrf) init.headers['X-EDU-CSRF'] = csrf;
    if (o.ifMatch) init.headers['If-Match'] = o.ifMatch;
    if (!SEGUROS[metodo] && motivoActual) init.headers['X-EDU-Motivo'] = encodeURIComponent(motivoActual); // edicion del director sobre un periodo cerrado (queda auditada con el motivo)
    var resp;
    for (var intento = 0; ; intento++) {
      try { resp = await F()(BASE + ruta, init); } catch (e) { throw error(MSG.red, 0, 'red'); }
      if (resp.status === 429 && intento < REINTENTOS_429) { await esperar(espera429(resp, intento)); continue; }
      break;
    }
    var texto = '', datos = null;
    try { texto = await resp.text(); datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = null; }
    if (resp.status >= 200 && resp.status < 300) {
      if (texto && datos === null) throw error(MSG.inesperada, resp.status, 'respuesta');
      return datos;
    }
    var er = datos && datos.error && typeof datos.error === 'object' ? datos.error : {};
    var err = error(mensajeDe(resp.status, datos, o.mensajes), resp.status, limpio(er.codigo, 60) || null, Array.isArray(er.campos) ? er.campos.map(function (x) { return limpio(String(x), 40); }).slice(0, 20) : null);
    if (resp.status === 401 && !o.sinCierre) caducada();
    if (resp.status === 403 && err.codigo === 'csrf_invalido' && !o.reintentoCsrf && !o.sinCierre) { // token CSRF desfasado (p. ej. sesion rotada en otra pestana): se renueva y se reintenta una vez
      var viva = null; try { viva = await api.auth.me(); } catch (e) { viva = null; }
      if (viva) return peticion(metodo, ruta, Object.assign({}, o, { reintentoCsrf: true }));
    }
    if (resp.status === 403 && err.codigo === 'cambio_clave_obligatorio' && EDU.estado && EDU.estado.refrescar) {
      EDU.estado.refrescar().then(function () { if (EDU.router) EDU.router.ir('cambiar-clave'); }, function () { /* sin accion */ });
    }
    if (resp.status === 409 && o.col) invalidar(o.col);
    throw err;
  }

  // ---------------------------------------------------------------- cache en memoria
  function fresco(e) { return !!e && (Date.now() - e.t) < CACHE_MS; }
  function invalidar(col) {
    [cacheL, cacheO].forEach(function (c) { Object.keys(c).forEach(function (k) { if (k.split('|')[0] === col) delete c[k]; }); });
  }
  function limpiarCache() { cacheL = {}; cacheO = {}; }

  function registro(j) { return j && typeof j === 'object' && !Array.isArray(j) ? (j.id !== undefined ? j : (j.dato || j.registro || j)) : null; }
  function ruta(col, id) { return '/c/' + encodeURIComponent(col) + (id === undefined ? '' : '/' + encodeURIComponent(id)); }

  async function traerTodo(col, centroId) {
    var out = [], off = 0;
    for (var i = 0; ; i++) {
      var q = new URLSearchParams();
      q.set('limite', String(LIMITE)); q.set('offset', String(off));
      if (centroId) q.set('f.centroId', centroId);
      var j = await peticion('GET', ruta(col) + '?' + q.toString(), { col: col });
      var d = j && j.datos;
      if (!Array.isArray(d)) throw error(MSG.inesperada, 200, 'respuesta');
      out = out.concat(d);
      var sig = j.siguiente;
      if (typeof sig !== 'number' || sig <= off || !d.length) break;
      if (i + 1 >= MAX_PAGINAS) throw error(MSG.inesperada, 200, 'respuesta');
      off = sig;
    }
    return out;
  }

  // ---------------------------------------------------------------- interfaz de repositorio (igual que EDU.repoLocal)
  api.COLECCIONES = COLECCIONES;
  api.esServidor = true;   // EDU.repo: el servidor autoriza, audita calificaciones y aplica propiedad; no hace falta releer `antes`
  api.fetchImpl = null;    // inyectable (pruebas)
  api.esperar = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  api.advertencia = null;
  api.idNuevo = function (col) { return col.slice(0, 3) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  api.limpiarCache = limpiarCache;

  /** listar(col, {centroId}): trae TODAS las paginas. Solo admin_red envia f.centroId (el servidor fija el centro del resto). */
  api.listar = function (col, o) {
    chk(col); o = o || {};
    var cid = o.centroId && esAdmin() ? o.centroId : null, k = col + '|' + (cid || ''), e = cacheL[k];
    if (!fresco(e)) {
      e = cacheL[k] = { t: Date.now(), p: null, datos: null };
      var mia = e;
      mia.p = traerTodo(col, cid).then(function (d) { mia.datos = d; return d; }, function (err) { if (cacheL[k] === mia) delete cacheL[k]; throw err; });
    }
    return e.p.then(clon);
  };
  api.obtener = async function (col, id) {
    chk(col);
    if (id === undefined || id === null || id === '') return null;
    var ks = Object.keys(cacheL);
    for (var i = 0; i < ks.length; i++) {
      var e = cacheL[ks[i]];
      if (ks[i].split('|')[0] === col && fresco(e) && e.datos) { var h = e.datos.filter(function (r) { return r.id === id; })[0]; if (h) return clon(h); }
    }
    var k = col + '|' + id, c = cacheO[k];
    if (fresco(c)) { var rc = await c.p; return clon(rc); }
    var p = peticion('GET', ruta(col, id), { col: col }).then(registro, function (err) { if (err.estado === 404) return null; throw err; });
    var ent = cacheO[k] = { t: Date.now(), p: p };
    p.catch(function () { if (cacheO[k] === ent) delete cacheO[k]; });
    return clon(await p);
  };
  api.guardar = async function (col, rec) {
    chk(col); rec = clon(rec) || {};
    var j;
    if (rec.id) {
      try { j = await peticion('PUT', ruta(col, rec.id), { cuerpo: rec, ifMatch: rec.actualizadoEn || undefined, col: col }); }
      catch (e) { if (e.estado === 404) j = await peticion('POST', ruta(col), { cuerpo: rec, col: col }); else throw e; }
    } else j = await peticion('POST', ruta(col), { cuerpo: rec, col: col });
    invalidar(col);
    return clon(registro(j));
  };
  /** Lote = upsert por id (maximo 500 por peticion): los registros nuevos reciben un id de cliente. */
  api.guardarMuchos = async function (col, recs) {
    chk(col); var out = [];
    for (var i = 0; i < recs.length; i += MAX_LOTE) {
      var trozo = recs.slice(i, i + MAX_LOTE).map(function (r) { r = clon(r); if (!r.id) r.id = api.idNuevo(col); return r; });
      var j = await peticion('POST', ruta(col) + '/lote', { cuerpo: { registros: trozo }, col: col });
      if (!j || !Array.isArray(j.datos)) throw error(MSG.inesperada, 200, 'respuesta');
      out = out.concat(j.datos);
    }
    invalidar(col);
    return clon(out);
  };
  api.borrar = async function (col, id) {
    chk(col);
    try { await peticion('DELETE', ruta(col, id), { col: col }); } catch (e) { if (e.estado === 404) { invalidar(col); return false; } throw e; }
    invalidar(col);
    return true;
  };
  /** conMotivo(motivo, fn): ejecuta fn con la cabecera X-EDU-Motivo en TODAS las escrituras que haga (el servidor la exige al director sobre periodos cerrados). */
  api.conMotivo = async function (motivo, fn) {
    var previo = motivoActual; motivoActual = String(motivo || '').trim() || null;
    try { return await fn(); } finally { motivoActual = previo; }
  };
  /** Periodos: informe de pendientes, cierre y reapertura en el servidor (director/admin_red). */
  api.periodos = {
    informe: function (id) { return peticion('GET', '/periodos/' + encodeURIComponent(id) + '/informe-cierre'); },
    /** -> {periodo, informe}. Sin confirmar y con pendientes el servidor responde 409 confirmacion_requerida (err.codigo). */
    cerrar: async function (id, confirmar) { var j = await peticion('POST', '/periodos/' + encodeURIComponent(id) + '/cerrar', { cuerpo: confirmar ? { confirmar: true } : {}, col: 'periodos' }); invalidar('periodos'); return j; },
    reabrir: async function (id, motivo) { var j = await peticion('POST', '/periodos/' + encodeURIComponent(id) + '/reabrir', { cuerpo: { motivo: motivo }, col: 'periodos' }); invalidar('periodos'); return j; }
  };
  /** Respaldo de UN centro (GET /respaldo/exportar; queda auditado en el servidor). {centroId?} solo lo usa admin_red (por defecto, su centro activo). */
  api.exportarTodo = async function (o) {
    var cid = esAdmin() ? ((o && o.centroId) || (EDU.estado.centroActivo && EDU.estado.centroActivo())) : null; // admin_red: el servidor exige centroId
    if (esAdmin() && !cid) throw error('Elige un centro activo para exportar el respaldo.', 422, 'centro_requerido');
    var j = await peticion('GET', '/respaldo/exportar' + (cid ? '?centroId=' + encodeURIComponent(cid) : ''));
    var sub = j && typeof j === 'object' ? (j.colecciones || j.datos) : null;
    var d = sub && typeof sub === 'object' && !Array.isArray(sub) ? sub : j;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw error(MSG.inesperada, 200, 'respuesta');
    var out = {}; COLECCIONES.forEach(function (c) { out[c] = Array.isArray(d[c]) ? d[c] : []; });
    return out;
  };
  // En modo servidor no hay semilla local ni reemplazo masivo (la importacion es la Fase 5).
  api.importarTodo = function () { return Promise.reject(error(MSG.fase5, 501, 'no_implementado')); };
  api.reemplazar = api.importarTodo;
  api.limpiarTodo = api.importarTodo;

  /** Auditoria (POST /auditoria): el servidor fija usuario, rol y fecha. */
  api.auditar = async function (reg) {
    var d = { accion: reg.accion };
    ['coleccion', 'registroId', 'motivo', 'archivo', 'hojas', 'registros', 'valores', 'estudiantesCreados', 'matriculasCreadas', 'discrepancias', 'antes', 'despues'].forEach(function (k) { if (reg[k] !== undefined) d[k] = reg[k]; });
    if (reg.centroId && esAdmin()) d.centroId = reg.centroId;
    var j = await peticion('POST', '/auditoria', { cuerpo: d });
    invalidar('auditoria');
    return clon(j);
  };
  /** Confirmacion de lectura de un comunicado (POST /comunicados/:id/lectura). Devuelve el comunicado. */
  api.registrarLectura = async function (id) {
    var j = await peticion('POST', '/comunicados/' + encodeURIComponent(id) + '/lectura', { col: 'comunicados' });
    invalidar('comunicados');
    var r = registro(j);
    return r && r.id ? clon(r) : api.obtener('comunicados', id);
  };

  // ---------------------------------------------------------------- autenticacion (/auth/*)
  /** Acepta {usuario:{…centroId|centroUsuario}, csrfToken|csrf, debeCambiarClave} y devuelve {usuario:{id,nombre,email,rol,refId,centroUsuario,debeCambiarClave}, csrf}. */
  function datosSesion(j) {
    if (!j || typeof j !== 'object' || !j.usuario || typeof j.usuario !== 'object' || !j.usuario.id || !j.usuario.rol) throw error(MSG.inesperada, 200, 'respuesta');
    var u = j.usuario;
    return { usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, refId: u.refId || null,
      centroUsuario: (u.centroUsuario !== undefined ? u.centroUsuario : u.centroId) || null,
      debeCambiarClave: !!(u.debeCambiarClave !== undefined ? u.debeCambiarClave : j.debeCambiarClave) }, csrf: typeof j.csrf === 'string' ? j.csrf : (typeof j.csrfToken === 'string' ? j.csrfToken : null) };
  }
  api.auth = {
    /** -> {usuario, csrf}. Mensaje generico (no enumera usuarios) para 401/403/422. */
    login: async function (email, clave) {
      var gen = 'Correo o contraseña incorrectos.';
      var j = datosSesion(await peticion('POST', '/auth/login', { cuerpo: { email: String(email || '').trim(), clave: String(clave || '') }, sinCierre: true,
        mensajes: { 401: gen, 403: gen, 404: gen, 422: gen, 429: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' } }));
      csrf = j.csrf; limpiarCache();
      return j;
    },
    /** -> {usuario, csrf} o null si no hay sesion (401). Los demas fallos (red, 5xx) se lanzan. */
    me: async function () {
      try { var j = datosSesion(await peticion('GET', '/auth/me', { sinCierre: true })); csrf = j.csrf || csrf; return j; }
      catch (e) { if (e.estado === 401) { csrf = null; return null; } throw e; }
    },
    logout: async function () {
      try { await peticion('POST', '/auth/logout', { sinCierre: true }); } catch (e) { /* la sesion local se cierra igualmente */ }
      csrf = null; limpiarCache();
    },
    /** La sesion se rota en el servidor: se renueva el token CSRF con /auth/me. */
    cambiarClave: async function (claveActual, claveNueva) {
      var r = await peticion('POST', '/auth/cambiar-clave', { cuerpo: { claveActual: String(claveActual || ''), claveNueva: String(claveNueva || '') }, sinCierre: true,
        mensajes: { 401: 'No se pudo cambiar la contraseña. Revisa la contraseña actual.' } });
      limpiarCache();
      try { var n = datosSesion(r); if (n.csrf) { csrf = n.csrf; return n; } } catch (e) { /* respuesta sin sesion (204): se relee */ }
      return api.auth.me();
    },
    /** 202 siempre: no revela si el correo existe. */
    recuperar: async function (email) { await peticion('POST', '/auth/recuperar', { cuerpo: { email: String(email || '').trim() }, sinCierre: true }); return true; },
    restablecer: async function (token, claveNueva) {
      await peticion('POST', '/auth/restablecer', { cuerpo: { token: String(token || ''), clave: String(claveNueva || '') }, sinCierre: true,
        mensajes: { 400: 'El enlace no es válido o ya caducó. Solicita uno nuevo.', 401: 'El enlace no es válido o ya caducó. Solicita uno nuevo.', 403: 'El enlace no es válido o ya caducó. Solicita uno nuevo.', 404: 'El enlace no es válido o ya caducó. Solicita uno nuevo.', 410: 'El enlace no es válido o ya caducó. Solicita uno nuevo.' } });
      return true;
    }
  };

  EDU.repoApi = api;
  if (CFG.modo === 'api' && EDU.repo && typeof EDU.repo.usar === 'function') EDU.repo.usar(api);
})();
