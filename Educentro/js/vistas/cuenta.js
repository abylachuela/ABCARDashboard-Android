/* Vistas de cuenta (modo api): cambio de contrasena (obligatorio si el servidor lo exige), recuperar y restablecer.
   #/restablecer/<token>: el token va en el fragmento (no viaja al servidor ni a Referer); se guarda solo en memoria y se quita de la URL.
   Mensajes genericos (no revelan si un correo existe). Texto siempre escapado. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var MIN = 10;
  var TOKEN = '';

  function campo(id, etiqueta, tipo, auto, extra) {
    return '<label class="fld" style="margin-top:10px">' + EDU.esc(etiqueta) + '<input type="' + tipo + '" id="' + id + '" name="' + id + '" autocomplete="' + auto + '" maxlength="200" required' + (extra || '') + '></label>';
  }
  function marco(titulo, cuerpo, ancho) {
    return '<div class="login"><div class="brand"><i aria-hidden="true">E</i>EduCentro</div><form class="card" id="cuForm" novalidate aria-labelledby="cuT" style="max-width:' + (ancho || 460) + 'px"><h1 id="cuT" style="font-size:28px">' + EDU.esc(titulo) + '</h1>' +
      '<div id="cuMsg" role="alert" aria-live="assertive"></div>' + cuerpo + '</form></div>';
  }
  function mensajero(cont) {
    var el = cont.querySelector('#cuMsg');
    return function (m, tipo) {
      el.innerHTML = ''; if (!m) return;
      var d = document.createElement('div'); d.className = tipo === 'ok' ? 'alert ok' : 'form-error'; d.textContent = m; el.appendChild(d);
    };
  }
  function soloServidor(cont) {
    cont.innerHTML = '<div class="card vacio"><h1 style="font-size:28px">No disponible en el modo demo</h1><p>Esta función requiere el servidor de EduCentro.</p><a class="btn" href="#/login">Ir al inicio</a></div>';
  }
  /** Valida la contrasena nueva en el cliente (la autoridad es el servidor). -> mensaje de error o ''. */
  function validarNueva(n, r) {
    if (n.length < MIN) return 'La contraseña nueva debe tener al menos ' + MIN + ' caracteres.';
    if (n !== r) return 'Las contraseñas nuevas no coinciden.';
    return '';
  }
  function enlazar(cont, alEnviar) {
    var f = cont.querySelector('#cuForm'), btn = cont.querySelector('button[type=submit]');
    async function h(e) { e.preventDefault(); btn.disabled = true; try { await alEnviar(); } finally { btn.disabled = false; } }
    f.addEventListener('submit', h);
    return function () { f.removeEventListener('submit', h); };
  }

  EDU.router.register('cambiar-clave', {
    titulo: 'Cambiar contraseña', roles: Object.keys(EDU.permisos.ROLES),
    render: async function (cont) {
      if (EDU.estado.modo !== 'api') return soloServidor(cont);
      var obligatorio = EDU.estado.debeCambiarClave();
      cont.innerHTML = marco('Cambiar contraseña',
        (obligatorio ? '<p class="note">Por seguridad debes elegir una contraseña nueva antes de continuar.</p>' : '<p class="note">Elige una contraseña nueva (mínimo ' + MIN + ' caracteres). Se cerrarán tus otras sesiones.</p>') +
        campo('cuActual', 'Contraseña actual', 'password', 'current-password') + campo('cuNueva', 'Contraseña nueva', 'password', 'new-password', ' minlength="' + MIN + '"') +
        campo('cuRep', 'Repite la contraseña nueva', 'password', 'new-password') +
        '<div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn">Cambiar contraseña</button>' + (obligatorio ? '' : '<a class="btn sec" href="#/dashboard">Cancelar</a>') + '</div>');
      var $ = function (id) { return cont.querySelector('#' + id); }, msg = mensajero(cont);
      $('cuActual').focus();
      return enlazar(cont, async function () {
        msg('');
        var a = $('cuActual').value, n = $('cuNueva').value, r = $('cuRep').value;
        if (!a) { msg('Escribe tu contraseña actual.'); $('cuActual').focus(); return; }
        var v = validarNueva(n, r); if (v) { msg(v); $('cuNueva').focus(); return; }
        if (n === a) { msg('La contraseña nueva debe ser distinta de la actual.'); return; }
        try {
          var me = await EDU.repoApi.auth.cambiarClave(a, n);
          $('cuActual').value = $('cuNueva').value = $('cuRep').value = '';
          if (!me) { EDU.estado.cerrarSesion({ sinServidor: true }); return; }
          await EDU.estado.refrescar();
          EDU.ui.toast('Contraseña actualizada', 'ok'); EDU.router.ir('dashboard');
        } catch (er) {
          if (er && er.estado === 401) { // ¿contrasena actual incorrecta o sesion caducada?
            var vivo = null; try { vivo = await EDU.repoApi.auth.me(); } catch (e2) { vivo = true; }
            if (!vivo) { EDU.ui.toast('Tu sesión caducó. Ingresa de nuevo.', 'warn'); EDU.estado.cerrarSesion({ sinServidor: true }); return; }
          }
          msg(er && er.message ? er.message : 'No se pudo cambiar la contraseña.'); $('cuActual').value = '';
        }
      });
    }
  });

  EDU.router.register('recuperar', {
    titulo: 'Recuperar contraseña', publica: true,
    render: async function (cont) {
      if (EDU.estado.modo !== 'api') return soloServidor(cont);
      cont.innerHTML = marco('Recuperar contraseña', '<p class="note">Escribe tu correo. Si está registrado, te enviaremos instrucciones para elegir una contraseña nueva.</p>' +
        '<label class="fld" style="margin-top:10px">Correo electrónico<input type="email" id="reEmail" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required></label>' +
        '<div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn">Enviar instrucciones</button><a class="btn sec" href="#/login">Volver</a></div>');
      var em = cont.querySelector('#reEmail'), msg = mensajero(cont);
      em.focus();
      return enlazar(cont, async function () {
        msg('');
        if (!em.value.trim()) { msg('Escribe tu correo electrónico.'); em.focus(); return; }
        try { await EDU.repoApi.auth.recuperar(em.value); } catch (er) {
          if (er && (er.estado === 0 || er.estado === 429 || er.estado >= 500)) { msg(er.message); return; } // red, limite o servidor caido: no se finge exito
          /* cualquier otra respuesta se trata igual que el exito: no se revela si el correo existe */
        }
        msg('Si el correo está registrado, recibirás en breve las instrucciones. Revisa también la carpeta de correo no deseado.', 'ok');
      });
    }
  });

  function restablecer(cont, params) {
    if (EDU.estado.modo !== 'api') return soloServidor(cont);
    if (params && params.token) { TOKEN = params.token; history.replaceState(null, '', '#/restablecer'); } // el token queda solo en memoria
    var token = TOKEN;
    if (!token) {
      cont.innerHTML = '<div class="login"><div class="card" style="max-width:460px"><h1 style="font-size:28px">Enlace no válido</h1><p>El enlace no es válido o ya se usó. Solicita uno nuevo.</p><a class="btn" href="#/recuperar">Solicitar otro enlace</a></div></div>';
      return;
    }
    cont.innerHTML = marco('Elige tu contraseña nueva', '<p class="note">Mínimo ' + MIN + ' caracteres.</p>' + campo('rsNueva', 'Contraseña nueva', 'password', 'new-password', ' minlength="' + MIN + '"') +
      campo('rsRep', 'Repite la contraseña nueva', 'password', 'new-password') + '<div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn">Guardar contraseña</button></div>');
    var $ = function (id) { return cont.querySelector('#' + id); }, msg = mensajero(cont);
    $('rsNueva').focus();
    return enlazar(cont, async function () {
      msg('');
      var v = validarNueva($('rsNueva').value, $('rsRep').value); if (v) { msg(v); $('rsNueva').focus(); return; }
      try {
        await EDU.repoApi.auth.restablecer(token, $('rsNueva').value);
        TOKEN = ''; $('rsNueva').value = $('rsRep').value = '';
        cont.innerHTML = '<div class="login"><div class="card" style="max-width:460px"><h1 style="font-size:28px">Contraseña actualizada</h1><p>Ya puedes ingresar con tu contraseña nueva.</p><a class="btn" href="#/login">Ir a iniciar sesión</a></div></div>';
      } catch (er) { msg(er && er.message ? er.message : 'No se pudo restablecer la contraseña.'); }
    });
  }
  EDU.router.register('restablecer', { titulo: 'Restablecer contraseña', publica: true, render: function (cont, p) { return restablecer(cont, p); } });
  EDU.router.register('restablecer/:token', { titulo: 'Restablecer contraseña', publica: true, render: function (cont, p) { return restablecer(cont, p); } });
})();
