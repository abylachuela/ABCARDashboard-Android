/* EDU.estado: sesion (usuario, rol, centro activo).
   Modo local (demo): persistida en localStorage['edu:sesion'].
   Modo api: la sesion vive en el SERVIDOR (cookie HttpOnly); aqui solo hay una copia en MEMORIA tomada de /auth/me. No se guarda nada en el navegador. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var API = (window.EDU_CONFIG || {}).modo === 'api';
  var KEY = 'edu:sesion';
  var ses = null;
  if (!API) {
    ses = EDU.almacen.getJSON(KEY, null);
    if (ses && (!ses.usuarioId || !ses.rol)) ses = null;
  }
  var oyentes = [];

  function guardar() { if (API) return; if (ses) EDU.almacen.setJSON(KEY, ses); else EDU.almacen.remove(KEY); }
  function emitir(tipo) { oyentes.slice().forEach(function (f) { try { f({ tipo: tipo, sesion: EDU.estado.sesion() }); } catch (e) { console.error(e); } }); }
  function desde(u, previa) {
    var cu = u.centroUsuario !== undefined ? u.centroUsuario : (u.centroId || null);
    return { usuarioId: u.id, nombre: u.nombre, email: u.email, rol: u.rol, refId: u.refId || null, centroUsuario: cu || null,
      centroActivo: previa && u.rol === 'admin_red' ? previa.centroActivo : (cu || null), debeCambiarClave: !!u.debeCambiarClave };
  }

  EDU.estado = {
    modo: API ? 'api' : 'local',
    /** Copia de la sesion: {usuarioId, nombre, email, rol, refId, centroUsuario, centroActivo, debeCambiarClave} o null. */
    sesion: function () { return ses ? Object.assign({}, ses) : null; },
    autenticado: function () { return !!ses; },
    rol: function () { return ses ? ses.rol : null; },
    /** Centro activo (id) o null = "Todos" (solo admin_red). */
    centroActivo: function () { return ses ? ses.centroActivo : null; },
    /** true si el servidor exige cambiar la contrasena antes de seguir (solo modo api). */
    debeCambiarClave: function () { return !!(ses && ses.debeCambiarClave); },
    /** Modo local: inicia sesion con un usuario demo. Modo api: toma la respuesta de login/me ({id,nombre,email,rol,refId,centroUsuario,debeCambiarClave}). */
    iniciarSesion: function (u) {
      ses = desde(u, null);
      guardar(); emitir('login'); return EDU.estado.sesion();
    },
    /** Modo api: restaura la sesion desde GET /auth/me (cookie). -> sesion o null. Lanza solo si el servidor no responde. */
    cargarSesion: async function () {
      if (!API) return EDU.estado.sesion();
      var r = await EDU.repoApi.auth.me();
      if (!r) { ses = null; return null; }
      ses = desde(r.usuario, ses); emitir('login'); return EDU.estado.sesion();
    },
    /** Modo api: correo + contrasena. Los errores llegan como Error con mensaje generico en espanol. */
    login: async function (email, clave) {
      var r = await EDU.repoApi.auth.login(email, clave);
      return EDU.estado.iniciarSesion(r.usuario);
    },
    /** Modo api: relee /auth/me (p. ej. tras cambiar la contrasena) conservando el centro activo. */
    refrescar: async function () {
      var r = await EDU.repoApi.auth.me();
      if (!r) { EDU.estado.cerrarSesion({ sinServidor: true }); return null; }
      ses = desde(r.usuario, ses); emitir('sesion'); return EDU.estado.sesion();
    },
    /** Cierra la sesion. Modo api: avisa al servidor (POST /auth/logout) salvo {sinServidor:true} (sesion ya caducada). */
    cerrarSesion: function (o) {
      var avisar = API && !(o && o.sinServidor) && !!ses;
      ses = null; guardar();
      if (API && EDU.repoApi) { EDU.repoApi.limpiarCache(); if (avisar) EDU.repoApi.auth.logout(); }
      emitir('logout');
    },
    /** Cambia el centro activo. No admin_red: solo su propio centro. id null = todos (admin_red). */
    cambiarCentro: function (id) {
      if (!ses) return false;
      id = id || null;
      if (ses.rol !== 'admin_red' && id !== ses.centroUsuario) throw new Error('Centro no permitido');
      if (id === ses.centroActivo) return true;
      ses.centroActivo = id; guardar(); emitir('centro'); return true;
    },
    /** onCambio(fn({tipo:'login'|'logout'|'centro'|'sesion', sesion})) -> funcion para desuscribir. */
    onCambio: function (fn) { oyentes.push(fn); return function () { oyentes = oyentes.filter(function (f) { return f !== fn; }); }; }
  };
})();
