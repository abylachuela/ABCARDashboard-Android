/* EDU.cursosSemilla: cursos/talleres de ejemplo + inscripciones (colecciones cursosExtra e inscripciones). Se invoca desde semilla.js de forma defensiva. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var AHORA = '2026-10-01T08:00:00.000Z';

  // [sufijo, nombre, codigo, tipo, grados, cupo, horario[{dia,desde,hasta}], nInscribir, descripcion]
  var PLAN = {
    cen_1: [
      ['01', 'Robótica educativa', 'ROB-101', 'taller', ['Secundario:2', 'Secundario:4'], 5, [{ dia: 1, desde: '15:00', hasta: '16:30' }], 6, 'Introducción a la programación de robots con sensores y actuadores.'],
      ['02', 'Inglés conversacional', 'ING-201', 'electiva', [], 10, [{ dia: 3, desde: '15:00', hasta: '16:00' }], 4, 'Práctica oral de inglés para todos los grados.'],
      ['03', 'Nivelación de Matemática', 'MAT-N01', 'refuerzo', ['Secundario:2'], 8, [{ dia: 2, desde: '15:00', hasta: '16:00' }], 3, 'Refuerzo de fracciones, proporciones y álgebra básica.'],
      ['04', 'Electrónica básica', 'ETP-301', 'modulo_tecnico', ['Secundario:5'], 6, [{ dia: 4, desde: '14:00', hasta: '16:00' }], 3, 'Módulo técnico de circuitos y medición eléctrica.'],
      ['05', 'Escritura creativa (virtual)', 'LEN-V01', 'virtual', [], 20, [{ dia: 3, desde: '15:30', hasta: '16:30' }], 3, 'Curso virtual de narrativa y poesía; se trabaja desde el Aula virtual.']
    ],
    cen_2: [
      ['01', 'Taller de dibujo y pintura', 'ART-101', 'taller', ['Primario:4', 'Primario:6'], 6, [{ dia: 2, desde: '15:00', hasta: '16:30' }], 4, 'Técnicas básicas de dibujo, color y composición.'],
      ['02', 'Refuerzo de lectura', 'LEC-R01', 'refuerzo', ['Primario:4'], 8, [{ dia: 4, desde: '15:00', hasta: '16:00' }], 3, 'Comprensión lectora y fluidez.'],
      ['03', 'Club de ajedrez', 'AJE-101', 'electiva', [], 4, [{ dia: 1, desde: '15:00', hasta: '16:00' }], 5, 'Fundamentos de ajedrez y torneo interno.']
    ]
  };

  function sembrar(D) {
    D.cursosExtra = D.cursosExtra || []; D.inscripciones = D.inscripciones || [];
    Object.keys(PLAN).forEach(function (cid) {
      var docs = (D.docentes || []).filter(function (x) { return x.centroId === cid; });
      var ests = (D.estudiantes || []).filter(function (x) { return x.centroId === cid; });
      if (!docs.length || !ests.length) return;
      PLAN[cid].forEach(function (p, k) {
        var curso = { id: 'cex_' + cid.slice(4) + '_' + p[0], centroId: cid, nombre: p[1], codigo: p[2], tipo: p[3], docenteId: docs[k % docs.length].id, grados: p[4], cupo: p[5],
          inicio: '2026-10-05', fin: '2026-12-11', horario: p[6].map(function (h) { return { dia: h.dia, franjaId: null, desde: h.desde, hasta: h.hasta, texto: '' }; }), estado: 'en_curso', descripcion: p[8],
          creadoEn: AHORA, actualizadoEn: AHORA };
        D.cursosExtra.push(curso);
        var n = 0, turno = 0;
        ests.forEach(function (e) {
          if (n >= p[7]) return;
          var m = (D.matriculas || []).filter(function (x) { return x.estudianteId === e.id && x.estado === 'activa'; })[0], s = m && D.secciones.filter(function (x) { return x.id === m.seccionId; })[0];
          var cu = s && D.cursos.filter(function (x) { return x.id === s.cursoId; })[0];
          if (curso.grados.length && !(cu && curso.grados.indexOf(cu.nivel + ':' + cu.grado) !== -1)) return;
          // evita choques entre cursos sembrados (mismo estudiante en cursos que se solapan)
          var choca = D.inscripciones.some(function (i) { return i.estudianteId === e.id && i.estado === 'inscrito' && i.centroId === cid && i.cursoId !== curso.id &&
            (function (oc) { return oc && oc.horario.some(function (a) { return curso.horario.some(function (b) { return a.dia === b.dia && a.desde < b.hasta && b.desde < a.hasta; }); }); })(D.cursosExtra.filter(function (c) { return c.id === i.cursoId; })[0]); });
          if (choca) return;
          var espera = curso.cupo != null && n >= curso.cupo;
          D.inscripciones.push({ id: 'ins_' + curso.id + '_' + e.id, centroId: cid, cursoId: curso.id, estudianteId: e.id, fecha: '2026-10-0' + (2 + (n % 3)), estado: espera ? 'en_lista_espera' : 'inscrito', turno: espera ? (++turno) : null,
            asistencia: espera ? [] : [{ fecha: '2026-11-02', estado: 'P' }, { fecha: '2026-11-09', estado: n % 4 === 3 ? 'A' : 'P' }, { fecha: '2026-11-16', estado: n % 5 === 4 ? 'T' : 'P' }], nota: null, observacion: '', creadoEn: AHORA, actualizadoEn: AHORA });
          n++;
        });
      });
    });
  }
  EDU.cursosSemilla = { sembrar: sembrar };
})();
