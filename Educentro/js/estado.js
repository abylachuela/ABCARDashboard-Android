/* EDU.estado: sesion (usuario, rol, centro activo) persistida en localStorage. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var KEY = 'edu:sesion';
  var ses = EDU.almacen.getJSON(KEY, null);
  if (ses && (!ses.usuarioId || !ses.rol)) ses = null;
  var oyentes = [];

  function guardar() { if (ses) EDU.almacen.setJSON(KEY, ses); else EDU.almacen.remove(KEY); }
  function emitir(tipo) { oyentes.slice().forEach(function (f) { try { f({ tipo: tipo, sesion: EDU.estado.sesion() }); } catch (e) { console.error(e); } }); }

  EDU.estado = {
    /** Copia de la sesion: {usuarioId, nombre, email, rol, refId, centroUsuario, centroActivo} o null. */
    sesion: function () { return ses ? Object.assign({}, ses) : null; },
    autenticado: function () { return !!ses; },
    rol: function () { return ses ? ses.rol : null; },
    /** Centro activo (id) o null = "Todos" (solo admin_red). */
    centroActivo: function () { return ses ? ses.centroActivo : null; },
    iniciarSesion: function (u) {
      ses = { usuarioId: u.id, nombre: u.nombre, email: u.email, rol: u.rol, refId: u.refId || null, centroUsuario: u.centroId || null, centroActivo: u.centroId || null };
      guardar(); emitir('login'); return EDU.estado.sesion();
    },
    cerrarSesion: function () { ses = null; guardar(); emitir('logout'); },
    /** Cambia el centro activo. No admin_red: solo su propio centro. id null = todos (admin_red). */
    cambiarCentro: function (id) {
      if (!ses) return false;
      id = id || null;
      if (ses.rol !== 'admin_red' && id !== ses.centroUsuario) throw new Error('Centro no permitido');
      if (id === ses.centroActivo) return true;
      ses.centroActivo = id; guardar(); emitir('centro'); return true;
    },
    /** onCambio(fn({tipo:'login'|'logout'|'centro', sesion})) -> funcion para desuscribir. */
    onCambio: function (fn) { oyentes.push(fn); return function () { oyentes = oyentes.filter(function (f) { return f !== fn; }); }; }
  };
})();
