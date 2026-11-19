/* Vista login: selector de usuario demo agrupado por rol. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var ORDEN = ['admin_red', 'director', 'docente', 'secretaria', 'tutor', 'estudiante'];

  EDU.router.register('login', {
    titulo: 'Ingresar', publica: true,
    render: async function (cont) {
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
