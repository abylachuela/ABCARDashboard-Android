/* Vista "planificacion": STUB. Reemplazar el contenido de este archivo conservando EDU.router.register('planificacion', ...). Ver docs/API.md */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('planificacion', {
    titulo: 'Planificación',
    render: function (cont) {
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Planificación' }) +
        '<div class="card">' + EDU.ui.vacio({ titulo: 'En construcción', texto: 'Este módulo todavía no está disponible.' }) + '</div>';
    }
  });
})();
