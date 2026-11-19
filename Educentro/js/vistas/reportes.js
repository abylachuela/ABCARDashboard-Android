/* Vista "reportes": STUB. Reemplazar el contenido de este archivo conservando EDU.router.register('reportes', ...). Ver docs/API.md */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('reportes', {
    titulo: 'Reportes',
    render: function (cont) {
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Reportes' }) +
        '<div class="card">' + EDU.ui.vacio({ titulo: 'En construcción', texto: 'Este módulo todavía no está disponible.' }) + '</div>';
    }
  });
})();
