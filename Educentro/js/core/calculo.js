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

  /* ================= MODELO POR COMPETENCIAS (planilla MINERD) =================
     escala.modelo === 'competencias'. Una nota por periodo (P1..P4) y por competencia (C1..C4), con RP (recuperacion pedagogica) por periodo.
     Una sola regla coherente para todas las filas (la planilla original tiene formulas distintas por fila: no se replican). Sin redondear. */
  var COMP_DEF = { competencias: 4, periodos: 4, regla: 'reemplaza', nombres: ['Competencia 1', 'Competencia 2', 'Competencia 3', 'Competencia 4'],
    completiva: { cf: 50, cec: 50 }, extraordinaria: { cf: 30, cex: 70 }, especial: { ce: 100 } };

  function modelo(escala) { return escala && escala.modelo === 'competencias' ? 'competencias' : 'ponderado'; }

  /** Configuracion efectiva (defaults + escala.competencias). Pesos en porcentaje; se normalizan por su suma. */
  function configCompetencias(escala) {
    var c = (escala && escala.competencias) || {}, d = COMP_DEF;
    var nc = Math.max(1, Math.min(12, parseInt(c.competencias, 10) || d.competencias)), np = Math.max(1, Math.min(12, parseInt(c.periodos, 10) || d.periodos));
    var nombres = []; for (var i = 0; i < nc; i++) nombres.push((c.nombres && c.nombres[i]) || ('Competencia ' + (i + 1)));
    function pesos(o, def) { var r = {}; Object.keys(def).forEach(function (k) { var v = aNumero(o && o[k]); r[k] = v !== null && v >= 0 ? v : def[k]; }); return r; }
    return { competencias: nc, periodos: np, regla: c.regla === 'maximo' ? 'maximo' : 'reemplaza', nombres: nombres,
      completiva: pesos(c.completiva, d.completiva), extraordinaria: pesos(c.extraordinaria, d.extraordinaria), especial: pesos(c.especial, d.especial) };
  }

  function minAprobar(escala) { var m = aNumero(escala && escala.notaMinAprobar); return m === null ? ESC_DEF.notaMinAprobar : m; }

  /** Valor efectivo de un periodo: P si P >= minimo; si P < minimo y hay RP -> RP (regla 'reemplaza') o max(P, RP) ('maximo').
   *  Sin P pero con RP -> RP. Sin ninguno -> null. */
  function efectivoPeriodo(p, rp, escala, regla) {
    var P = aNumero(p), R = aNumero(rp), min = minAprobar(escala);
    if (P === null) return R;
    if (P >= min - EPS || R === null) return P;
    return regla === 'maximo' ? Math.max(P, R) : R;
  }

  /** Promedio de una competencia: comp = {p:[P1..P4], rp:[RP1..RP4]}. Media de los efectivos con nota (no cuentan como 0). */
  function promedioCompetencia(comp, escala, cfg) {
    cfg = cfg || configCompetencias(escala);
    var ef = [], s = 0, n = 0;
    for (var i = 0; i < cfg.periodos; i++) {
      var v = efectivoPeriodo(comp && comp.p && comp.p[i], comp && comp.rp && comp.rp[i], escala, cfg.regla);
      ef.push(v); if (v !== null) { s += v; n++; }
    }
    return { efectivos: ef, promedio: n ? s / n : null, n: n, completo: n === cfg.periodos };
  }

  function mix(a, wa, b, wb) { var t = wa + wb; return t > 0 ? (a * wa + b * wb) / t : a; }

  /**
   * Resultado de una asignatura en el modelo por competencias.
   * o: {competencias:[{p:[..],rp:[..]} x N], cec, cex, esp, escala}
   * -> {competencias:[{efectivos, promedio, n, completo}], periodos:[media de las competencias por periodo], cf, completo,
   *     cfc, cexf, ce, final, via:'cf'|'completiva'|'extraordinaria'|'especial'|null, estado:'Aprobado'|'Reprobado'|'Completiva'|'Extraordinaria'|'Pendiente', aprobado:true|false|null}
   * CF = media de los promedios de competencia; CFC = pesoCF*CF + pesoCEC*CEC (50/50); CEXF = pesoCF*CF + pesoCEX*CEX (30/70);
   * especial: nota CE (peso 100 %). Las instancias posteriores solo aplican con el ano completo y CF < minimo.
   */
  function calcularCompetencias(o) {
    var esc = o.escala, cfg = configCompetencias(esc), min = minAprobar(esc), comps = [];
    for (var i = 0; i < cfg.competencias; i++) comps.push(promedioCompetencia(o.competencias && o.competencias[i], esc, cfg));
    var periodos = [];
    for (var j = 0; j < cfg.periodos; j++) {
      periodos.push(promedioGeneral(comps.map(function (c) { return c.efectivos[j]; })));
    }
    var cf = promedioGeneral(comps.map(function (c) { return c.promedio; })), completo = comps.every(function (c) { return c.completo; });
    var cec = aNumero(o.cec), cex = aNumero(o.cex), ce = aNumero(o.esp);
    var r = { competencias: comps, periodos: periodos, cf: cf, completo: completo, cfc: null, cexf: null, ce: ce, final: cf, via: null, estado: 'Pendiente', aprobado: null };
    if (cf === null) return r;
    r.via = 'cf';
    if (!completo) return r;                                   // ano en curso: CF provisional
    if (cf >= min - EPS) { r.estado = 'Aprobado'; r.aprobado = true; return r; }
    r.aprobado = false; r.estado = 'Completiva';
    if (cec === null) return r;
    r.cfc = mix(cf, cfg.completiva.cf, cec, cfg.completiva.cec); r.final = r.cfc; r.via = 'completiva';
    if (r.cfc >= min - EPS) { r.estado = 'Aprobado'; r.aprobado = true; return r; }
    r.estado = 'Extraordinaria';
    if (cex === null) return r;
    r.cexf = mix(cf, cfg.extraordinaria.cf, cex, cfg.extraordinaria.cex); r.final = r.cexf; r.via = 'extraordinaria';
    if (r.cexf >= min - EPS) { r.estado = 'Aprobado'; r.aprobado = true; return r; }
    if (ce !== null) {
      r.final = ce * cfg.especial.ce / 100; r.via = 'especial';
      if (r.final >= min - EPS) { r.estado = 'Aprobado'; r.aprobado = true; return r; }
    }
    r.estado = 'Reprobado';
    return r;
  }

  EDU.calculo = {
    aNumero: aNumero, redondear: redondear, notaActividad: notaActividad, detalleCategoria: detalleCategoria,
    notaCategoria: notaCategoria, ponderar: ponderar, notaAsignaturaPeriodo: notaAsignaturaPeriodo,
    notaFinal: notaFinal, calcularPeriodo: calcularPeriodo, calcularFinal: calcularFinal,
    aprobado: aprobado, promedioGeneral: promedioGeneral, validarPesos: validarPesos,
    modelo: modelo, configCompetencias: configCompetencias, efectivoPeriodo: efectivoPeriodo, promedioCompetencia: promedioCompetencia, calcularCompetencias: calcularCompetencias
  };
})();
