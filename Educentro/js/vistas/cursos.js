(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  EDU.router.register('cursos', { titulo: 'Cursos y talleres', render: async function (c) { c.innerHTML = EDU.ui.cabecera({ eyebrow: 'Módulo', titulo: 'Cursos y talleres' }) + '<p>En construcción.</p>'; } });
})();
