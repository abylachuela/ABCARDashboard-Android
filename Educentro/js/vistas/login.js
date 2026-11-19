/* Vista login. Modo local: selector de usuario demo agrupado por rol. Modo api: correo + contrasena contra el servidor (POST /auth/login). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var ORDEN = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];

  /** Login real: sin enumerar usuarios (el mensaje de error es generico), sin guardar contrasena ni token en el navegador. */
  function renderApi(cont) {
    var aviso = EDU.estado.avisoServidor || '';
    cont.innerHTML = '<div class="login"><div class="brand"><i aria-hidden="true">E</i>EduCentro</div><h1>Gestión de notas y centros educativos</h1>' +
      '<p class="lead">Ingresa con tu correo y tu contraseña.</p>' +
      '<form class="card" id="lgForm" novalidate aria-labelledby="lgT" style="max-width:440px"><h2 id="lgT">Iniciar sesión</h2>' +
      '<div id="lgErr" role="alert">' + (aviso ? '<div class="form-error">' + EDU.esc(aviso) + '</div>' : '') + '</div>' +
      '<label class="fld">Correo electrónico<input type="email" id="lgEmail" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required></label>' +
      '<label class="fld" style="margin-top:10px">Contraseña<input type="password" id="lgClave" name="clave" autocomplete="current-password" maxlength="200" required></label>' +
      '<div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn" id="lgOk">Ingresar</button></div>' +
      '<p class="note"><a href="#/recuperar">¿Olvidaste tu contraseña?</a></p></form></div>';
    EDU.estado.avisoServidor = '';
    var f = cont.querySelector('#lgForm'), err = cont.querySelector('#lgErr'), em = cont.querySelector('#lgEmail'), cl = cont.querySelector('#lgClave'), ok = cont.querySelector('#lgOk');
    function mostrar(m) { err.innerHTML = ''; if (!m) return; var d = document.createElement('div'); d.className = 'form-error'; d.textContent = m; err.appendChild(d); }
    async function enviar(e) {
      e.preventDefault(); mostrar('');
      if (!em.value.trim() || !cl.value) { mostrar('Escribe tu correo y tu contraseña.'); (em.value.trim() ? cl : em).focus(); return; }
      ok.disabled = true;
      try {
        var s = await EDU.estado.login(em.value, cl.value);
        cl.value = '';
        EDU.router.ir(s.debeCambiarClave ? 'cambiar-clave' : 'dashboard');
      } catch (er) { cl.value = ''; mostrar(er && er.message ? er.message : 'No se pudo iniciar sesión.'); cl.focus(); }
      ok.disabled = false;
    }
    f.addEventListener('submit', enviar);
    em.focus();
    return function () { f.removeEventListener('submit', enviar); };
  }

  EDU.router.register('login', {
    titulo: 'Ingresar', publica: true,
    render: async function (cont) {
      if (EDU.estado.modo === 'api') return renderApi(cont);
      var us = await EDU.repo.listar('usuarios'), centros = await EDU.repo.listar('centros');
      var cn = {}; centros.forEach(function (c) { cn[c.id] = c.nombre; });
      var h = '<div class="login"><div class="brand"><i aria-hidden="true">E</i>EduCentro</div><h1>Gestión de notas y centros educativos</h1>' +
        '<p class="lead">Versión demo alineada al currículo dominicano (MINERD). Elige un usuario de ejemplo para ingresar; los datos se guardan en este navegador.</p>';
      ORDEN.forEach(function (rol) {
        var l = us.filter(function (u) { return u.rol === rol; });
        if (!l.length) return;
        h += '<section class="demo-group" aria-labelledby="g-' + rol + '"><h2 id="g-' + rol + '">' + EDU.esc(EDU.permisos.etiquetaRol(rol)) + '</h2><div class="demo-users">';
        l.forEach(function (u) {
          h += '<button type="button" class="demo-user" data-u="' + EDU.esc(u.id) + '"><span class="av" aria-hidden="true">' + EDU.esc(EDU.fmt.iniciales(u.nombre)) + '</span><span><strong>' + EDU.esc(u.nombre) +
            '</strong><small>' + EDU.esc(u.centroId ? cn[u.centroId] : 'Todos los centros') + '</small></span></button>';
        });
        h += '</div></section>';
      });
      h += '<p style="margin-top:34px"><button type="button" class="btn sec" id="reset">Restablecer datos demo</button></p></div>';
      cont.innerHTML = h;
      cont.addEventListener('click', onClic);
      function onClic(e) {
        var b = e.target.closest('.demo-user');
        if (b) {
          var u = us.filter(function (x) { return x.id === b.dataset.u; })[0];
          if (u) { EDU.estado.iniciarSesion(u); EDU.router.ir('dashboard'); }
        } else if (e.target.id === 'reset') {
          EDU.ui.confirmar({ titulo: 'Restablecer datos demo', mensaje: 'Se borrarán todos los cambios y se cargarán los datos de ejemplo.', textoOk: 'Restablecer', peligro: true }).then(async function (ok) {
            if (!ok) return;
            await EDU.semilla.restablecer(); EDU.ui.toast('Datos demo restablecidos', 'ok'); EDU.router.recargar();
          });
        }
      }
      return function () { cont.removeEventListener('click', onClic); };
    }
  });
})();
