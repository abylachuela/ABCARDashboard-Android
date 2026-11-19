/* EDU.consultas: lecturas compuestas reutilizables (cargar varias colecciones, resumen de notas). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  function agrupar(lista, clave) {
    var m = {};
    lista.forEach(function (x) { (m[x[clave]] = m[x[clave]] || []).push(x); });
    return m;
  }

  EDU.consultas = {
    agrupar: agrupar,
    /** cargar(['cargas','estudiantes'], opts) -> Promise<{cargas:[], estudiantes:[]}> (respeta centro activo). */
    cargar: async function (nombres, o) {
      var res = await Promise.all(nombres.map(function (n) { return EDU.repo.listar(n, o); }));
      var out = {}; nombres.forEach(function (n, i) { out[n] = res[i]; });
      return out;
    },
    /** Escala activa de un centro (de la lista `escalas`); cae a la escala por defecto. */
    escalaDe: function (escalas, centroId) {
      var e = (escalas || []).filter(function (x) { return x.centroId === centroId && x.activa !== false; })[0];
      return e || EDU.escala.porDefecto();
    },
    /** Periodo abierto (no cerrado, menor orden) de un anio/centro; o el ultimo. */
    periodoAbierto: function (periodos, centroId) {
      var l = periodos.filter(function (p) { return p.centroId === centroId; }).sort(function (a, b) { return a.orden - b.orden; });
      return l.filter(function (p) { return !p.cerrado; })[0] || l[l.length - 1] || null;
    },
    /**
     * resumenNotas(datos) con datos {matriculas, cargas, categorias, actividades, calificaciones, periodos, escalas}.
     * Una fila por (matricula activa x carga de su seccion):
     * {centroId, estudianteId, seccionId, cargaId, asignaturaId, docenteId, final, pct, aprobado, periodos, escala}
     * `pct` = final normalizado 0-100 (comparable entre centros).
     */
    resumenNotas: function (d) {
      var cargasSec = agrupar(d.cargas, 'seccionId'), catsCarga = agrupar(d.categorias, 'cargaId'), actsCarga = agrupar(d.actividades, 'cargaId');
      var perCentro = agrupar(d.periodos, 'centroId');
      var califEst = {};
      d.calificaciones.forEach(function (c) { (califEst[c.estudianteId] = califEst[c.estudianteId] || {})[c.actividadId] = c.puntos; });
      var ncMap = {}; (d.notasCompetencia || []).forEach(function (n) { ncMap[n.cargaId + '|' + n.estudianteId] = n; });
      var out = [];
      d.matriculas.forEach(function (m) {
        if (m.estado !== 'activa') return;
        var esc = EDU.consultas.escalaDe(d.escalas, m.centroId);
        (cargasSec[m.seccionId] || []).forEach(function (cg) {
          if (EDU.calculo.modelo(esc) === 'competencias') { // modelo por competencias: CF/estado desde notasCompetencia (ver docs/API.md)
            var pl = (perCentro[m.centroId] || []).filter(function (p) { return p.anioId === cg.anioId; }).sort(function (x, y) { return x.orden - y.orden; });
            var nc = ncMap[cg.id + '|' + m.estudianteId] || {};
            var rc = EDU.calculo.calcularCompetencias({ competencias: nc.c, cec: nc.cec, cex: nc.cex, esp: nc.esp, escala: esc });
            out.push({ centroId: m.centroId, estudianteId: m.estudianteId, seccionId: m.seccionId, cargaId: cg.id, asignaturaId: cg.asignaturaId, docenteId: cg.docenteId,
              final: rc.final, pct: EDU.escala.porcentaje(rc.final, esc), aprobado: rc.aprobado === null && rc.cf !== null ? EDU.calculo.aprobado(rc.cf, esc) : rc.aprobado, /* ano en curso: provisional, como en el modelo ponderado */ estado: rc.estado, cf: rc.cf, via: rc.via, modelo: 'competencias', calc: rc,
              periodos: pl.map(function (p, i) { return { periodoId: p.id, peso: p.peso, nota: rc.periodos[i] == null ? null : rc.periodos[i], categorias: [] }; }), escala: esc });
            return;
          }
          var periodos = (perCentro[m.centroId] || []).filter(function (p) { return p.anioId === cg.anioId; }).map(function (p) { return { id: p.id, peso: p.peso }; });
          var r = EDU.calculo.calcularFinal({ categorias: catsCarga[cg.id] || [], actividades: actsCarga[cg.id] || [], calificaciones: califEst[m.estudianteId] || {},
            periodos: periodos, escala: esc });
          out.push({ centroId: m.centroId, estudianteId: m.estudianteId, seccionId: m.seccionId, cargaId: cg.id, asignaturaId: cg.asignaturaId, docenteId: cg.docenteId,
            final: r.final, pct: EDU.escala.porcentaje(r.final, esc), aprobado: r.aprobado, periodos: r.periodos, escala: esc });
        });
      });
      return out;
    }
  };
})();
