(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('aula', { titulo: 'Aula virtual', render: async function (c) { c.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Aula virtual' }) + '<p>En construcción.</p>'; } });
})();
