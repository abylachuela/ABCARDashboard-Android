/* EDU.escala: escalas de calificacion y conversion. Una escala es un objeto plano:
   {min, max, notaMinAprobar, decimales, tramos:[{desde, etiqueta, letra}]} */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  var PRESETS = {
    '0-100': { nombre: '0 a 100 (MINERD)', min: 0, max: 100, notaMinAprobar: 70, decimales: 1,
      tramos: [{ desde: 90, etiqueta: 'Sobresaliente', letra: 'A' }, { desde: 80, etiqueta: 'Muy bueno', letra: 'B' },
        { desde: 70, etiqueta: 'Satisfactorio', letra: 'C' }, { desde: 0, etiqueta: 'Insuficiente', letra: 'D' }] },
    '0-10': { nombre: '0 a 10', min: 0, max: 10, notaMinAprobar: 7, decimales: 1,
      tramos: [{ desde: 9, etiqueta: 'Sobresaliente', letra: 'A' }, { desde: 8, etiqueta: 'Muy bueno', letra: 'B' },
        { desde: 7, etiqueta: 'Satisfactorio', letra: 'C' }, { desde: 0, etiqueta: 'Insuficiente', letra: 'D' }] }
  };

  function clonar(o) { return JSON.parse(JSON.stringify(o)); }

  EDU.escala = {
    PRESETS: PRESETS,
    /** Escala por defecto del sistema (0-100, minimo 70, configurable por centro). */
    porDefecto: function () { return clonar(PRESETS['0-100']); },
    /** crear({min,max,notaMinAprobar,...}) completa defaults y ordena tramos de mayor a menor. */
    crear: function (o) {
      o = o || {};
      var base = clonar(PRESETS[(o.max === 10 ? '0-10' : '0-100')]);
      var e = Object.assign(base, o);
      e.tramos = (o.tramos || base.tramos).slice().sort(function (a, b) { return b.desde - a.desde; });
      return e;
    },
    validar: function (e) {
      var errores = [];
      if (!e || !isFinite(e.min) || !isFinite(e.max)) errores.push('Minimo y maximo son obligatorios.');
      else {
        if (e.max <= e.min) errores.push('El maximo debe ser mayor que el minimo.');
        if (!isFinite(e.notaMinAprobar) || e.notaMinAprobar < e.min || e.notaMinAprobar > e.max) errores.push('La nota minima de aprobacion debe estar dentro de la escala.');
      }
      return { ok: errores.length === 0, errores: errores };
    },
    /** Tramo (etiqueta/letra) que corresponde a una nota; null si no hay nota. */
    tramo: function (nota, e) {
      if (nota == null || !isFinite(nota) || !e || !e.tramos) return null;
      var t = e.tramos.slice().sort(function (a, b) { return b.desde - a.desde; });
      for (var i = 0; i < t.length; i++) if (nota >= t[i].desde) return t[i];
      return t[t.length - 1] || null;
    },
    /** nota -> 0..100 relativo a la escala (permite comparar centros con escalas distintas). */
    porcentaje: function (nota, e) {
      if (nota == null || !isFinite(nota)) return null;
      return (nota - e.min) / (e.max - e.min) * 100;
    },
    desdePorcentaje: function (pct, e) {
      if (pct == null || !isFinite(pct)) return null;
      return e.min + pct / 100 * (e.max - e.min);
    },
    convertir: function (nota, origen, destino) {
      return EDU.escala.desdePorcentaje(EDU.escala.porcentaje(nota, origen), destino);
    },
    /** Porcentaje (0-100) de la nota minima de aprobacion. */
    minAprobarPct: function (e) { return EDU.escala.porcentaje(e.notaMinAprobar, e); }
  };
})();
