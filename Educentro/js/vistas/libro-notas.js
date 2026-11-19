/* Vista "libro-notas": STUB. Reemplazar el contenido de este archivo conservando EDU.router.register('libro-notas', ...). Ver docs/API.md */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('libro-notas', {
    titulo: 'Calificaciones',
    render: function (cont) {
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Calificaciones' }) +
        '<div class="card">' + EDU.ui.vacio({ titulo: 'En construcción', texto: 'Este módulo todavía no está disponible.' }) + '</div>';
    }
  });
})();
