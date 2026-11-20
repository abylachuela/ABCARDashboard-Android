/* Arranque y shell (sidebar por rol, topbar con centro activo y usuario). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var $ = function (id) { return document.getElementById(id); };
  var centros = [];
  var API = EDU.estado.modo === 'api';

  function cerrarMenu() { $('side').classList.remove('open'); $('scrim').classList.remove('on'); $('burger').setAttribute('aria-expanded', 'false'); }

  function marcarNav() {
    var a = EDU.router.actual(), mod = a && a.modulo;
    Array.prototype.forEach.call($('nav').querySelectorAll('a'), function (l) { if (l.dataset.r === mod) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); });
  }

  async function shell() {
    var s = EDU.estado.sesion();
    document.body.classList.toggle('sin-sesion', !s);
    $('cuentaClave').hidden = !(API && s);
    if (!s) { $('nav').innerHTML = ''; return; }
    $('uAv').textContent = EDU.fmt.iniciales(s.nombre); $('uNom').textContent = s.nombre; $('uRol').textContent = EDU.permisos.etiquetaRol(s.rol);
    if (s.debeCambiarClave) { $('nav').innerHTML = ''; $('centerSel').innerHTML = ''; $('centerSel').disabled = true; return; } // hasta cambiar la contrasena no se cargan datos
    centros = await EDU.repo.listar('centros');
    $('nav').innerHTML = EDU.permisos.modulosDe(s.rol).map(function (n) {
      return '<a href="#/' + EDU.esc(n.ruta) + '" data-r="' + EDU.esc(n.ruta) + '">' + EDU.ui.icono(n.icono) + EDU.esc(n.titulo) + '</a>';
    }).join('');
    var sel = $('centerSel'), act = s.centroActivo;
    var ops = s.rol === 'admin_red' ? [{ valor: '', texto: 'Todos los centros (red)' }].concat(centros.map(function (c) { return { valor: c.id, texto: c.nombre }; })) : centros.map(function (c) { return { valor: c.id, texto: c.nombre }; });
    sel.innerHTML = EDU.ui.opciones(ops, act || '').toString();
    sel.disabled = s.rol !== 'admin_red';
    $('uAv').textContent = EDU.fmt.iniciales(s.nombre);
    $('uNom').textContent = s.nombre;
    $('uRol').textContent = EDU.permisos.etiquetaRol(s.rol);
    marcarNav();
  }

  async function arrancar() {
    if (API) {
      $('who').hidden = true; // sin datos demo ni "restablecer": los datos viven en el servidor
      try { await EDU.estado.cargarSesion(); } catch (e) { EDU.estado.avisoServidor = e && e.message ? e.message : 'No se pudo conectar con el servidor.'; }
    } else { try { await EDU.semilla.asegurar(); } catch (e) { console.error(e); } }
    var s = API ? null : EDU.estado.sesion();
    if (s) {
      var u = await EDU.repo.obtener('usuarios', s.usuarioId).catch(function () { return null; });
      // La sesion persistida es editable por el usuario: se contrasta con el registro de usuario (rol, centro, refId) y se descarta si no coincide.
      if (!u || u.rol !== s.rol || (u.centroId || null) !== (s.centroUsuario || null) || (u.refId || null) !== (s.refId || null) ||
        (s.rol !== 'admin_red' && s.centroActivo !== s.centroUsuario)) EDU.estado.cerrarSesion();
    }
    $('centerSel').addEventListener('change', function (e) { try { EDU.estado.cambiarCentro(e.target.value || null); } catch (err) { EDU.ui.toast(err.message, 'error'); } });
    $('logout').addEventListener('click', function () { EDU.estado.cerrarSesion(); });
    if (!API) $('resetDemo').addEventListener('click', async function () {
      var ok = await EDU.ui.confirmar({ titulo: 'Restablecer datos demo', mensaje: 'Se borrarán los cambios y se cerrará la sesión.', textoOk: 'Restablecer', peligro: true });
      if (ok) { await EDU.semilla.restablecer(); EDU.estado.cerrarSesion(); EDU.ui.toast('Datos demo restablecidos', 'ok'); }
    });
    $('burger').addEventListener('click', function () { var o = $('side').classList.toggle('open'); $('scrim').classList.toggle('on', o); $('burger').setAttribute('aria-expanded', String(o)); });
    $('scrim').addEventListener('click', cerrarMenu);
    $('nav').addEventListener('click', cerrarMenu);
    EDU.router.onNavegar(function () { marcarNav(); });
    EDU.estado.onCambio(async function (ev) {
      try { await shell(); } catch (err) { if (EDU.estado.autenticado()) EDU.ui.toast(err && err.message ? err.message : 'No se pudo cargar la sesión', 'error'); }
      if (ev.tipo === 'centro') EDU.router.recargar();
      else if (ev.tipo === 'logout') EDU.router.ir('login');
    });
    try { await shell(); } catch (e) { console.error(e); }
    await EDU.router.iniciar($('view'));
    document.body.setAttribute('data-listo', '1');
  }
  arrancar().catch(function (e) { console.error(e); });
})();
