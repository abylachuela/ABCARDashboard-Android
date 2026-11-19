/* EDU.calculo: funciones PURAS de calificacion (reglas de docs/PLAN.md). Sin DOM ni almacenamiento.
   Pesos en porcentaje (suman 100). Todo se calcula sin redondear; redondear solo al presentar. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var EPS = 1e-9;
  var ESC_DEF = { min: 0, max: 100, notaMinAprobar: 70 };

  function aNumero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  /** Redondeo half-up a `dec` decimales (1.005 -> 1.01, 2.5 -> 3). Solo para presentar. */
  function redondear(n, dec) {
    n = aNumero(n);
    if (n === null) return null;
    dec = dec == null ? 1 : dec;
    var sg = n < 0 ? -1 : 1, a = Math.abs(n), s = String(a);
    var r;
    if (s.indexOf('e') === -1) r = Number(Math.round(Number(s + 'e' + dec)) + 'e-' + dec);
    else r = Math.round((a + Number.EPSILON) * Math.pow(10, dec)) / Math.pow(10, dec);
    return sg * r;
  }

  /** Nota de UNA actividad en la escala: puntos/puntosMax. null si no hay nota. */
  function notaActividad(puntos, puntosMax, escala) {
    var p = aNumero(puntos), m = aNumero(puntosMax), e = escala || ESC_DEF;
    if (p === null || m === null || m <= 0) return null;
    return e.min + Math.max(0, p) / m * (e.max - e.min);
  }

  /** Detalle de categoria: items [{puntos,puntosMax}]. Suma puntos/puntosMax; sin nota se excluye. */
  function detalleCategoria(items, escala) {
    var sp = 0, sm = 0, n = 0, e = escala || ESC_DEF;
    (items || []).forEach(function (it) {
      var p = aNumero(it.puntos), m = aNumero(it.puntosMax);
      if (p === null || m === null || m <= 0) return;
      sp += Math.max(0, p); sm += m; n++;
    });
    return { puntos: sp, puntosMax: sm, n: n, nota: sm > 0 ? e.min + sp / sm * (e.max - e.min) : null };
  }
  function notaCategoria(items, escala) { return detalleCategoria(items, escala).nota; }

  /** Media ponderada de [{nota, peso}] ignorando nota null y peso<=0. null si no hay ninguna. */
  function ponderar(items) {
    var s = 0, w = 0;
    (items || []).forEach(function (it) {
      var v = aNumero(it.nota), p = aNumero(it.peso);
      if (v === null || p === null || p <= 0) return;
      s += v * p; w += p;
    });
    return w > 0 ? s / w : null;
  }

  /** Asignatura/periodo = Σ(cat×peso)/Σ(pesos de categorias con notas). categorias: [{nota, peso}]. */
  function notaAsignaturaPeriodo(categorias) { return ponderar(categorias); }
  /** Final = ponderado por peso de los periodos con nota. periodos: [{nota, peso}]. */
  function notaFinal(periodos) { return ponderar(periodos); }

  function mapaPuntos(calificaciones, estudianteId) {
    var m = {};
    if (Array.isArray(calificaciones)) {
      calificaciones.forEach(function (c) {
        if (estudianteId != null && c.estudianteId !== estudianteId) return;
        m[c.actividadId] = c.puntos;
      });
    } else if (calificaciones) {
      Object.keys(calificaciones).forEach(function (k) {
        var v = calificaciones[k];
        m[k] = v && typeof v === 'object' ? v.puntos : v;
      });
    }
    return m;
  }

  /**
   * Nota de una asignatura (carga) de un estudiante en UN periodo.
   * o: {categorias:[{id,peso}], actividades:[{id,categoriaId,periodoId,puntosMax}],
   *     calificaciones: [{actividadId,estudianteId,puntos}] | {actividadId: puntos}, estudianteId?, periodoId?, escala}
   * -> {nota|null, categorias:[{categoriaId, peso, nota, puntos, puntosMax, n}]}
   */
  function calcularPeriodo(o) {
    var pts = mapaPuntos(o.calificaciones, o.estudianteId);
    var cats = (o.categorias || []).map(function (c) {
      var items = (o.actividades || []).filter(function (a) {
        return a.categoriaId === c.id && (o.periodoId == null || a.periodoId === o.periodoId);
      }).map(function (a) { return { puntos: pts[a.id], puntosMax: a.puntosMax }; });
      var d = detalleCategoria(items, o.escala);
      return { categoriaId: c.id, peso: c.peso, nota: d.nota, puntos: d.puntos, puntosMax: d.puntosMax, n: d.n };
    });
    return { nota: ponderar(cats), categorias: cats };
  }

  /** aprobado: final >= notaMinAprobar (se compara SIN redondear; tolerancia 1e-9 por coma flotante). */
  function aprobado(nota, escala) {
    var n = aNumero(nota), e = escala || ESC_DEF;
    return n !== null && n >= e.notaMinAprobar - EPS;
  }

  /**
   * Nota final de una asignatura: ponderada por peso de periodos con nota.
   * o = como calcularPeriodo (sin periodoId) + periodos:[{id,peso}]
   * -> {final|null, aprobado:boolean|null, periodos:[{periodoId, peso, nota, categorias}]}
   */
  function calcularFinal(o) {
    var per = (o.periodos || []).map(function (p) {
      var r = calcularPeriodo({ categorias: o.categorias, actividades: o.actividades, calificaciones: o.calificaciones,
        estudianteId: o.estudianteId, periodoId: p.id, escala: o.escala });
      return { periodoId: p.id, peso: p.peso, nota: r.nota, categorias: r.categorias };
    });
    var f = notaFinal(per);
    return { final: f, aprobado: f === null ? null : aprobado(f, o.escala), periodos: per };
  }

  /** Promedio simple de notas (numeros u objetos {nota}); ignora null. */
  function promedioGeneral(notas) {
    var s = 0, n = 0;
    (notas || []).forEach(function (x) {
      var v = aNumero(x && typeof x === 'object' ? x.nota : x);
      if (v !== null) { s += v; n++; }
    });
    return n ? s / n : null;
  }

  /** Valida que los pesos (numeros u objetos {peso}) sumen `objetivo` (100). */
  function validarPesos(pesos, objetivo) {
    objetivo = objetivo == null ? 100 : objetivo;
    var suma = 0;
    (pesos || []).forEach(function (p) { var v = aNumero(p && typeof p === 'object' ? p.peso : p); if (v !== null) suma += v; });
    suma = Math.round(suma * 1e6) / 1e6;
    return { ok: Math.abs(suma - objetivo) < 0.01, suma: suma, diferencia: Math.round((objetivo - suma) * 1e6) / 1e6 };
  }

  EDU.calculo = {
    aNumero: aNumero, redondear: redondear, notaActividad: notaActividad, detalleCategoria: detalleCategoria,
    notaCategoria: notaCategoria, ponderar: ponderar, notaAsignaturaPeriodo: notaAsignaturaPeriodo,
    notaFinal: notaFinal, calcularPeriodo: calcularPeriodo, calcularFinal: calcularFinal,
    aprobado: aprobado, promedioGeneral: promedioGeneral, validarPesos: validarPesos
  };
})();
