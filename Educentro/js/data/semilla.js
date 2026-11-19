/* EDU.semilla: datos demo deterministas (IDs estables), alineados al sistema educativo dominicano (MINERD).
   EDU.semilla.asegurar() siembra si el almacenamiento esta vacio; EDU.semilla.restablecer() borra todo y resiembra. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var VERSION = 4, KEY_META = 'edu:v1:meta';

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var R = rng(20261119);
  function gauss() { return (R() + R() + R() - 1.5) / 0.5; }
  function pick(a) { return a[Math.floor(R() * a.length)]; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function slug(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  var NOM_M = ['Juan Carlos', 'Luis Miguel', 'Rafael', 'José Manuel', 'Pedro', 'Carlos', 'Miguel Ángel', 'Francisco', 'Wander', 'Starlin', 'Emmanuel', 'Daniel', 'Kelvin', 'Yeison', 'Anderson', 'Joel'];
  var NOM_F = ['María', 'Yohanna', 'Ana Lucía', 'Camila', 'Yulissa', 'Rosanna', 'Altagracia', 'Daniela', 'Génesis', 'Marielis', 'Valentina', 'Johanna', 'Esmeralda', 'Nicole', 'Scarlet', 'Mía'];
  var APELL = ['Pérez', 'Rodríguez', 'Martínez', 'De los Santos', 'Peña', 'Reyes', 'Jiménez', 'Almonte', 'Santana', 'Batista', 'Cabrera', 'Mejía', 'Fernández', 'Núñez', 'Familia', 'Tavárez', 'Polanco', 'Ureña', 'Del Rosario', 'Guzmán', 'Castillo', 'Medina', 'Disla', 'Valdez'];

  var AREAS = {
    LE: 'Lengua Española', MAT: 'Matemática', CS: 'Ciencias Sociales', CN: 'Ciencias de la Naturaleza', ING: 'Lenguas Extranjeras (Inglés)',
    EF: 'Educación Física', EA: 'Educación Artística', FIHR: 'Formación Integral Humana y Religiosa'
  };
  var COLORES = { LE: '#14315c', MAT: '#a82424', CS: '#7a4b00', CN: '#17693a', ING: '#1d4580', EF: '#5a6578', EA: '#8a3d8f', FIHR: '#0f7a7a' };

  var CFG = [
    { n: 1, centro: { nombre: 'Liceo Experimental Cibao', codigo: '08-0142', ciudad: 'Santiago de los Caballeros', regional: '08 Santiago', distrito: '08-01', nivel: 'Secundario', color: '#14315c', director: 'Lucía Mendoza' },
      cursos: [{ nivel: 'Secundario', grado: 2, ciclo: 'Primer ciclo', modalidad: null }, { nivel: 'Secundario', grado: 4, ciclo: 'Segundo ciclo', modalidad: 'General' },
        { nivel: 'Secundario', grado: 5, ciclo: 'Segundo ciclo', modalidad: 'Técnico-Profesional' }],
      areas: ['LE', 'MAT', 'CS', 'CN', 'ING', 'EF'], ndoc: 5 },
    { n: 2, centro: { nombre: 'Centro Educativo Los Prados', codigo: '10-0377', ciudad: 'Santo Domingo Este', regional: '10 Santo Domingo', distrito: '10-05', nivel: 'Primario', color: '#7a4b00', director: 'Roberto Almánzar' },
      cursos: [{ nivel: 'Primario', grado: 4, ciclo: 'Segundo ciclo', modalidad: null }, { nivel: 'Primario', grado: 6, ciclo: 'Segundo ciclo', modalidad: null }],
      areas: ['LE', 'MAT', 'CS', 'CN', 'EA', 'FIHR'], ndoc: 3 }
  ];
  var PERIODOS = [
    { orden: 1, nombre: 'Primer periodo', peso: 30, inicio: '2026-01-12', fin: '2026-04-17', cerrado: true },
    { orden: 2, nombre: 'Segundo periodo', peso: 30, inicio: '2026-04-20', fin: '2026-08-14', cerrado: true },
    { orden: 3, nombre: 'Tercer periodo', peso: 40, inicio: '2026-08-24', fin: '2026-11-27', cerrado: false }
  ];
  var CATS = [{ k: 'tar', nombre: 'Tareas', peso: 20 }, { k: 'par', nombre: 'Parcial', peso: 30 }, { k: 'pro', nombre: 'Proyecto', peso: 20 }, { k: 'exa', nombre: 'Examen', peso: 30 }];
  var ACTS = [{ k: 'tar1', cat: 'tar', nombre: 'Tarea 1', max: 20, off: 14 }, { k: 'tar2', cat: 'tar', nombre: 'Tarea 2', max: 20, off: 35 },
    { k: 'par1', cat: 'par', nombre: 'Prueba parcial', max: 100, off: 55 }, { k: 'pro1', cat: 'pro', nombre: 'Proyecto', max: 50, off: 70 }, { k: 'exa1', cat: 'exa', nombre: 'Examen del periodo', max: 100, off: 90 }];

  function sumaDias(iso, d) {
    var t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d);
    return t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate());
  }

  /* Centro 3 (Secundaria, modelo POR COMPETENCIAS de la planilla MINERD): TODOS los datos son ficticios (nombres y notas generados al azar). */
  function sembrarCompetencias(D, add) {
    var n = 3, cid = 'cen_3', anio = 'ani_3_2026', areas = ['LE', 'MAT', 'CS', 'CN', 'ING', 'EF', 'EA', 'FIHR'];
    add('centros', { id: cid, activo: true, pais: 'República Dominicana', telefono: '809-555-0300', nombre: 'Liceo Politécnico Demo (competencias)', codigo: '04-0999', ciudad: 'San Cristóbal', regional: '04 San Cristóbal',
      distrito: '04-02', nivel: 'Secundario', color: '#17693a', director: 'Ignacio Valdivia' });
    add('anios', { id: anio, centroId: cid, nombre: 'Año escolar 2026-2027', inicio: '2026-01-12', fin: '2026-11-27', activo: true });
    var pdef = [['2026-01-12', '2026-03-27'], ['2026-04-06', '2026-06-19'], ['2026-08-24', '2026-10-09'], ['2026-10-12', '2026-11-27']];
    var per = pdef.map(function (x, i) { return add('periodos', { id: 'per_3_' + (i + 1), centroId: cid, anioId: anio, orden: i + 1, nombre: 'P' + (i + 1) + ' · Periodo ' + (i + 1), peso: 25, inicio: x[0], fin: x[1], cerrado: i < 3 }); });
    var esc = EDU.escala.porDefecto();
    add('escalas', Object.assign({ id: 'esc_3', centroId: cid, activa: true, modelo: 'competencias',
      competencias: { competencias: 4, periodos: 4, regla: 'reemplaza', nombres: ['Comunicativa', 'Pensamiento lógico, creativo y crítico', 'Resolución de problemas', 'Ética y ciudadana'],
        completiva: { cf: 50, cec: 50 }, extraordinaria: { cf: 30, cex: 70 }, especial: { ce: 100 } } }, esc));
    areas.forEach(function (k) { add('asignaturas', { id: 'asg_3_' + k.toLowerCase(), centroId: cid, codigo: k, nombre: AREAS[k], color: COLORES[k] }); });
    var docs = [], nd = ['Teodoro', 'Marisol', 'Eliezer', 'Noemí'], na = ['Ventura', 'Lantigua', 'Concepción', 'Brito'];
    for (var d = 0; d < 4; d++) {
      var did = 'doc_3_' + p2(d + 1);
      docs.push(add('docentes', { id: did, centroId: cid, nombres: nd[d], apellidos: na[d] + ' ' + APELL[(d * 5) % APELL.length], email: slug(nd[d]) + '.' + slug(na[d]) + '3@educentro.demo', telefono: '809-555-13' + p2(d), especialidad: AREAS[areas[d]], genero: d % 2 ? 'F' : 'M' }));
    }
    add('cursos', { id: 'cur_3_1', centroId: cid, nombre: '6.º Secundario · General', orden: 1, nivel: 'Secundario', grado: 6, ciclo: 'Segundo ciclo', modalidad: 'General' });
    var sec = add('secciones', { id: 'sec_3_1A', centroId: cid, cursoId: 'cur_3_1', anioId: anio, nombre: 'A', tanda: 'Jornada Extendida', capacidad: 30 });
    var cargas = areas.map(function (k, ai) { return add('cargas', { id: 'car_3_1A_' + k.toLowerCase(), centroId: cid, anioId: anio, seccionId: sec.id, asignaturaId: 'asg_3_' + k.toLowerCase(), docenteId: docs[ai % 4].id, horasSemana: 4 }); });
    var ests = [];
    for (var e = 0; e < 12; e++) {
      var fem = R() < 0.5, nom = pick(fem ? NOM_F : NOM_M), eid = 'est_3_' + p2(e + 1);
      var es = add('estudiantes', { id: eid, centroId: cid, nombres: nom, apellidos: pick(APELL) + ' ' + pick(APELL), matricula: 'MAT-3-' + (3000 + e), fechaNacimiento: '2009-' + p2(1 + e % 12) + '-' + p2(1 + (e * 2) % 28), genero: fem ? 'F' : 'M', direccion: 'Calle ' + (e + 1) + ', San Cristóbal' });
      es._h = e < 2 ? 55 + R() * 8 : e < 4 ? 66 + R() * 6 : 76 + R() * 22; ests.push(es);
      add('matriculas', { id: 'mtr_' + eid, centroId: cid, estudianteId: eid, seccionId: sec.id, anioId: anio, estado: 'activa', fecha: '2026-01-08' });
    }
    function nota(h) { return Math.max(20, Math.min(100, Math.round(h + gauss() * 6))); }
    cargas.forEach(function (cg) {
      ests.forEach(function (es, ei) {
        var comps = [];
        for (var c = 0; c < 4; c++) {
          var pv = [], rp = [];
          for (var i = 0; i < 4; i++) {
            var v = nota(es._h + (R() - 0.5) * 8), r = null;
            if (v < 70 && R() < 0.7) r = Math.min(100, v + 5 + Math.round(R() * 20));
            if (i === 3 && (ei === 10 || ei === 11) && c > 1) { v = null; r = null; } // P4 aun sin registrar (ficticio)
            pv.push(v); rp.push(r);
          }
          comps.push({ p: pv, rp: rp });
        }
        var rc = EDU.calculo.calcularCompetencias({ competencias: comps, escala: Object.assign({ modelo: 'competencias' }, esc), cec: null });
        var rec = { id: 'nc_' + cg.id + '_' + es.id, centroId: cid, cargaId: cg.id, estudianteId: es.id, c: comps, cec: null, cex: null, esp: null };
        if (rc.estado === 'Completiva' || rc.estado === 'Extraordinaria') { rec.cec = Math.round(55 + R() * 40); var r2 = EDU.calculo.calcularCompetencias({ competencias: comps, escala: esc, cec: rec.cec });
          if (r2.estado === 'Extraordinaria' && R() < 0.6) rec.cex = Math.round(50 + R() * 45); }
        add('notasCompetencia', rec);
      });
    });
    ests.forEach(function (es) { delete es._h; });
    add('usuarios', { id: 'usr_dir_3', centroId: cid, nombre: 'Ignacio Valdivia', email: 'direccion3@educentro.demo', rol: 'director', refId: null });
    add('usuarios', { id: 'usr_sec_3', centroId: cid, nombre: 'Yaneris Polanco', email: 'secretaria3@educentro.demo', rol: 'secretaria', refId: null });
    docs.forEach(function (dc) { add('usuarios', { id: 'usr_doc_' + dc.id.slice(4), centroId: cid, nombre: dc.nombres + ' ' + dc.apellidos, email: dc.email, rol: 'docente', refId: dc.id }); });
  }

  function generar() {
    var D = {};
    EDU.repoLocal.COLECCIONES.forEach(function (c) { D[c] = []; });
    var ahora = '2026-01-05T08:00:00.000Z';
    function add(col, r) { r.creadoEn = ahora; r.actualizadoEn = ahora; D[col].push(r); return r; }

    var estIdx = 0;
    CFG.forEach(function (cf) {
      var n = cf.n, cid = 'cen_' + n;
      add('centros', Object.assign({ id: cid, activo: true, pais: 'República Dominicana', telefono: '809-555-0' + n + '00' }, cf.centro));
      add('anios', { id: 'ani_' + n + '_2026', centroId: cid, nombre: 'Año escolar 2026-2027', inicio: '2026-01-12', fin: '2026-11-27', activo: true });
      var per = PERIODOS.map(function (p) { return add('periodos', Object.assign({ id: 'per_' + n + '_' + p.orden, centroId: cid, anioId: 'ani_' + n + '_2026' }, p)); });
      var esc = EDU.escala.porDefecto(); esc.notaMinAprobar = 70;
      add('escalas', Object.assign({ id: 'esc_' + n, centroId: cid, activa: true }, esc));
      // asignaturas
      cf.areas.forEach(function (k) { add('asignaturas', { id: 'asg_' + n + '_' + k.toLowerCase(), centroId: cid, codigo: k, nombre: AREAS[k], color: COLORES[k] }); });
      // docentes
      var docs = [];
      for (var d = 0; d < cf.ndoc; d++) {
        var fem = (d + n) % 2 === 0, nom = pick(fem ? NOM_F : NOM_M), ap = pick(APELL);
        var did = 'doc_' + n + '_' + p2(d + 1);
        docs.push(add('docentes', { id: did, centroId: cid, nombres: nom, apellidos: ap + ' ' + pick(APELL), email: slug(nom.split(' ')[0]) + '.' + slug(ap) + n + d + '@educentro.demo',
          telefono: '809-555-' + (1000 + n * 100 + d), especialidad: AREAS[cf.areas[d % cf.areas.length]], genero: fem ? 'F' : 'M' }));
      }
      // cursos y secciones
      var secs = [];
      cf.cursos.forEach(function (cu, i) {
        var curId = 'cur_' + n + '_' + (i + 1);
        add('cursos', Object.assign({ id: curId, centroId: cid, nombre: cu.grado + '.º ' + cu.nivel + (cu.modalidad ? ' · ' + cu.modalidad : ''), orden: i + 1 }, cu));
        secs.push(add('secciones', { id: 'sec_' + n + '_' + (i + 1) + 'A', centroId: cid, cursoId: curId, anioId: 'ani_' + n + '_2026', nombre: 'A', tanda: 'Jornada Extendida', capacidad: 30 }));
      });
      // cargas
      var cargas = [];
      secs.forEach(function (s) {
        cf.areas.forEach(function (k, ai) {
          var cg = add('cargas', { id: 'car_' + s.id.slice(4) + '_' + k.toLowerCase(), centroId: cid, anioId: s.anioId, seccionId: s.id, asignaturaId: 'asg_' + n + '_' + k.toLowerCase(),
            docenteId: docs[ai % docs.length].id, horasSemana: 4 });
          cargas.push(cg);
        });
      });
      // estudiantes, tutores, matriculas
      var estPorSec = {};
      secs.forEach(function (s, si) {
        estPorSec[s.id] = [];
        for (var e = 0; e < 8; e++) {
          estIdx++;
          var fem = R() < 0.5, nom = pick(fem ? NOM_F : NOM_M), ap1 = pick(APELL), ap2 = pick(APELL);
          var eid = 'est_' + n + '_' + p2(si * 8 + e + 1), curso = cf.cursos[si];
          var nac = (2026 - (curso.nivel === 'Primario' ? 5 + curso.grado : 11 + curso.grado)) + '-' + p2(1 + Math.floor(R() * 12)) + '-' + p2(1 + Math.floor(R() * 28));
          var est = add('estudiantes', { id: eid, centroId: cid, nombres: nom, apellidos: ap1 + ' ' + ap2, matricula: 'MAT-' + n + '-' + (2000 + estIdx), fechaNacimiento: nac,
            genero: fem ? 'F' : 'M', direccion: 'Calle ' + (1 + Math.floor(R() * 30)) + ', ' + cf.centro.ciudad, habilidad: 0 });
          est.habilidad = Math.max(38, Math.min(98, 83 + gauss() * 10));
          var tnom = pick(R() < 0.7 ? NOM_F : NOM_M);
          add('tutores', { id: 'tut_' + n + '_' + p2(si * 8 + e + 1), centroId: cid, nombres: tnom, apellidos: ap1 + ' ' + pick(APELL), parentesco: pick(['Madre', 'Padre', 'Tutor/a legal', 'Abuela']),
            telefono: '829-555-' + (2000 + estIdx), email: slug(tnom.split(' ')[0]) + '.' + slug(ap1) + estIdx + '@correo.demo', estudianteIds: [eid] });
          add('matriculas', { id: 'mtr_' + eid, centroId: cid, estudianteId: eid, seccionId: s.id, anioId: s.anioId, estado: 'activa', fecha: '2026-01-08' });
          estPorSec[s.id].push(est);
        }
      });
      // categorias, actividades, calificaciones
      cargas.forEach(function (cg, ci) {
        var offAsig = {};
        CATS.forEach(function (c) { add('categorias', { id: 'cat_' + cg.id + '_' + c.k, centroId: cid, cargaId: cg.id, nombre: c.nombre, peso: c.peso }); });
        per.forEach(function (p) {
          ACTS.forEach(function (a) {
            var aid = 'act_' + cg.id + '_' + p.orden + '_' + a.k;
            add('actividades', { id: aid, centroId: cid, cargaId: cg.id, categoriaId: 'cat_' + cg.id + '_' + a.cat, periodoId: p.id, nombre: a.nombre + ' (P' + p.orden + ')', puntosMax: a.max, fecha: sumaDias(p.inicio, a.off) });
            if (p.orden === 3 && a.k === 'exa1') return;
            estPorSec[cg.seccionId].forEach(function (est, ei) {
              if (p.orden === 3 && a.k === 'pro1' && ei % 2) return;
              if (offAsig[est.id] === undefined) offAsig[est.id] = (R() - 0.5) * 14;
              var pt = null;
              if (R() > 0.02) {
                var pct = Math.max(8, Math.min(100, est.habilidad + offAsig[est.id] + gauss() * 6));
                pt = Math.round(pct / 100 * a.max * 2) / 2;
              }
              var cal = { id: 'cal_' + aid + '_' + est.id, centroId: cid, actividadId: aid, estudianteId: est.id, puntos: pt };
              if (pt === null) cal.comentario = 'Ausente';
              add('calificaciones', cal);
            });
          });
        });
      });
      // horarios
      cargas.forEach(function (cg, ci) {
        [0, 1].forEach(function (j) {
          add('horarios', { id: 'hor_' + cg.id + '_' + j, centroId: cid, cargaId: cg.id, dia: ((ci + j * 2) % 5) + 1, hora: p2(8 + ((ci + j) % 6)) + ':00', duracion: 45 });
        });
      });
      // asistencia: 10 dias habiles
      var dias = []; for (var dd = 0; dias.length < 10; dd++) { var f = sumaDias('2026-11-02', dd), w = new Date(f + 'T12:00:00Z').getUTCDay(); if (w > 0 && w < 6) dias.push(f); }
      secs.forEach(function (s) {
        estPorSec[s.id].forEach(function (est) {
          dias.forEach(function (f) {
            var r = R(), e = r < 0.92 ? 'P' : r < 0.96 ? 'T' : r < 0.99 ? 'A' : 'J';
            add('asistencia', { id: 'ast_' + est.id + '_' + f, centroId: cid, seccionId: s.id, estudianteId: est.id, fecha: f, estado: e });
          });
        });
      });
      // planes
      [0, 1, 2].forEach(function (j) {
        var cg = cargas[j * 2 % cargas.length], as = EDU.semilla._area(cg.asignaturaId);
        add('planes', { id: 'pln_' + n + '_' + (j + 1), centroId: cid, cargaId: cg.id, docenteId: cg.docenteId, fecha: sumaDias('2026-11-23', j), tema: 'Unidad ' + (j + 1) + ': ' + as,
          objetivos: ['Comprender los conceptos centrales de la unidad', 'Aplicar lo aprendido en situaciones del contexto'], competencias: ['Comunicativa', 'Pensamiento lógico, creativo y crítico', 'Resolución de problemas'],
          actividades: [{ fase: 'inicio', minutos: 10, descripcion: 'Activación de saberes previos' }, { fase: 'desarrollo', minutos: 25, descripcion: 'Trabajo guiado en parejas' }, { fase: 'cierre', minutos: 10, descripcion: 'Puesta en común y síntesis' }],
          recursos: 'Pizarra, libro de texto, hojas de trabajo', evaluacion: 'Lista de cotejo y observación', tarea: 'Ejercicios de la página de práctica', estado: ['borrador', 'listo', 'impartido'][j] });
      });
      // comunicados
      [['Reunión de padres y tutores', 'Se convoca a la reunión de entrega de calificaciones del tercer periodo.', 'tutores'], ['Cierre de calificaciones', 'Los docentes deben registrar todas las notas antes del 28 de noviembre.', 'docentes'],
        ['Jornada de integración', 'Se celebrará la jornada deportiva y cultural del centro.', 'todos']].forEach(function (c, j) {
        add('comunicados', { id: 'com_' + n + '_' + (j + 1), centroId: cid, titulo: c[0], cuerpo: c[1], destinatarios: c[2], fecha: '2026-11-' + p2(9 + j * 3), estado: 'publicado', autorId: 'usr_dir_' + n });
      });
      add('agenteConfig', { id: 'agc_' + n, centroId: cid, docenteId: null, activo: false, nombre: 'Asistente EduCentro', proveedor: 'simulado', modelo: 'simulado-1', autonomia: 'sugiere',
        tareas: ['generar_plan', 'proponer_actividades', 'crear_rubricas'], tono: 'cercano', nivel: cf.centro.nivel, instrucciones: '', limites: { maxSolicitudesDia: 50 }, consentimientoDatos: false });
      // usuarios
      add('usuarios', { id: 'usr_dir_' + n, centroId: cid, nombre: cf.centro.director, email: 'direccion' + n + '@educentro.demo', rol: 'director', refId: null });
      add('usuarios', { id: 'usr_sec_' + n, centroId: cid, nombre: n === 1 ? 'Carmen Rosario' : 'Ramona Báez', email: 'secretaria' + n + '@educentro.demo', rol: 'secretaria', refId: null });
      docs.forEach(function (dc) { add('usuarios', { id: 'usr_doc_' + dc.id.slice(4), centroId: cid, nombre: dc.nombres + ' ' + dc.apellidos, email: dc.email, rol: 'docente', refId: dc.id }); });
      var e1 = D.estudiantes.filter(function (x) { return x.centroId === cid; })[0], t1 = D.tutores.filter(function (x) { return x.centroId === cid; })[0];
      add('usuarios', { id: 'usr_tut_' + n, centroId: cid, nombre: t1.nombres + ' ' + t1.apellidos, email: t1.email, rol: 'tutor', refId: t1.id });
      add('usuarios', { id: 'usr_est_' + n, centroId: cid, nombre: e1.nombres + ' ' + e1.apellidos, email: 'est' + n + '@educentro.demo', rol: 'estudiante', refId: e1.id });
    });
    add('usuarios', { id: 'usr_admin', centroId: null, nombre: 'Marta Beltré', email: 'admin@educentro.demo', rol: 'admin_red', refId: null });
    D.agenteLog.push({ id: 'agl_1', centroId: 'cen_1', usuarioId: 'usr_doc_1_01', fecha: '2026-11-10T14:00:00.000Z', tarea: 'generar_plan', entrada: 'Plan de clase sobre fracciones', salida: 'Borrador de plan (simulado)', aprobadoPor: 'usr_doc_1_01' });
    D.estudiantes.forEach(function (e) { delete e.habilidad; });
    sembrarCompetencias(D, add);
    if (EDU.curriculoSemilla) EDU.curriculoSemilla.sembrar(D); // catalogo curricular MINERD (js/data/curriculo-semilla.js)
    if (EDU.cursosSemilla) EDU.cursosSemilla.sembrar(D); // cursos/talleres de ejemplo (js/data/cursos-semilla.js)
    return D;
  }

  EDU.semilla = {
    VERSION: VERSION,
    _area: function (asgId) { var k = asgId.split('_')[2].toUpperCase(); return AREAS[k] || k; },
    generar: generar,
    /** Siembra solo si no hay datos o la version cambio. Devuelve true si sembro. */
    asegurar: async function () {
      var meta = EDU.almacen.getJSON(KEY_META, null);
      var hay = EDU.almacen.getJSON('edu:v1:col:centros', []).length > 0;
      if (meta && meta.version === VERSION && hay) return false;
      await EDU.semilla.restablecer(true);
      return true;
    },
    /** Borra TODOS los datos y resiembra. Con `conservarSesion` no toca la sesion. */
    restablecer: async function (conservarSesion) {
      await EDU.repoLocal.limpiarTodo();
      await EDU.repoLocal.importarTodo(generar());
      EDU.almacen.setJSON(KEY_META, { version: VERSION, sembradoEn: new Date().toISOString() });
      if (!conservarSesion) EDU.almacen.remove('edu:sesion');
      return true;
    }
  };
})();
