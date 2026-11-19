(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('horarios', { titulo: 'Horarios', render: async function (c) { c.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Horarios' }) + '<p>En construcción.</p>'; } });
})();
