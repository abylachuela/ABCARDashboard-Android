/* Vista "centros": STUB. Reemplazar el contenido de este archivo conservando EDU.router.register('centros', ...). Ver docs/API.md */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('centros', {
    titulo: 'Centros educativos',
    render: function (cont) {
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Centros educativos' }) +
        '<div class="card">' + EDU.ui.vacio({ titulo: 'En construcción', texto: 'Este módulo todavía no está disponible.' }) + '</div>';
    }
  });
})();
