/* Vista "agente": STUB. Reemplazar el contenido de este archivo conservando EDU.router.register('agente', ...). Ver docs/API.md */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('agente', {
    titulo: 'Agente IA',
    render: function (cont) {
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Agente IA' }) +
        '<div class="card">' + EDU.ui.vacio({ titulo: 'En construcción', texto: 'Este módulo todavía no está disponible.' }) + '</div>';
    }
  });
})();
