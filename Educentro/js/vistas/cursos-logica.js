/* EDU.cursosLogica: reglas de negocio de cursos/talleres/electivas (sin DOM). Usado por js/vistas/cursos.js.
   Modelo en docs/API.md seccion "Cursos". Todas las operaciones releen los datos antes de validar/escribir. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var fmt = EDU.fmt;

  var TIPOS = [{ valor: 'taller', texto: 'Taller' }, { valor: 'electiva', texto: 'Electiva' }, { valor: 'refuerzo', texto: 'Refuerzo' },
    { valor: 'modulo_tecnico', texto: 'Módulo técnico' }, { valor: 'virtual', texto: 'Virtual' }];
  var ESTADOS = [{ valor: 'abierto', texto: 'Abierto' }, { valor: 'en_curso', texto: 'En curso' }, { valor: 'cerrado', texto: 'Cerrado' }];
  var EST_INS = { inscrito: 'Inscrito', en_lista_espera: 'En lista de espera', retirado: 'Retirado', completado: 'Completado' };
  var DIAS = [{ valor: 1, texto: 'Lunes' }, { valor: 2, texto: 'Martes' }, { valor: 3, texto: 'Miércoles' }, { valor: 4, texto: 'Jueves' }, { valor: 5, texto: 'Viernes' }];
  var COLS = ['cursosExtra', 'inscripciones', 'estudiantes', 'matriculas', 'secciones', 'cursos', 'docentes', 'franjas'];
  var seq = 0;

  function etiqueta(lista, v) { var o = lista.filter(function (x) { return x.valor === v; })[0]; return o ? o.texto : (v == null ? '' : String(v)); }
  function pick(l, id) { return (l || []).filter(function (x) { return x.id === id; })[0] || null; }
  function insId(cursoId, estId) { return 'ins_' + cursoId + '_' + estId; }
  function turno() { return Date.now() * 1000 + (seq++ % 1000); }

  async function cargar(extra) {
    var d = await EDU.consultas.cargar(COLS.concat(extra || []));
    return d;
  }

  /* ---------- franjas / horario ---------- */
  function hm(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  /** Franja normalizada {id, nombre, desde, hasta}; tolera nombres de campo alternativos (colección escrita por otro módulo). */
  function franjaInfo(f) {
    var desde = f.desde || f.inicio || f.horaInicio || '', hasta = f.hasta || f.fin || f.horaFin || '';
    return { id: f.id, nombre: f.nombre || f.etiqueta || ((desde || hasta) ? desde + '–' + hasta : f.id), desde: desde, hasta: hasta, orden: f.orden || 0 };
  }
  function franjasDe(d) { return (d.franjas || []).map(franjaInfo).sort(function (a, b) { return (a.orden - b.orden) || String(a.desde).localeCompare(String(b.desde)); }); }
  function itemHorarioTxt(h) {
    var dia = etiqueta(DIAS, +h.dia), t = h.desde || h.hasta ? (h.desde || '?') + '–' + (h.hasta || '?') : '';
    return dia + (t ? ' ' + t : '') + (h.texto ? ' (' + h.texto + ')' : '');
  }
  function horarioTxt(c) { return (c.horario || []).map(itemHorarioTxt).join(', ') || 'Sin horario definido'; }
  function itemChoca(a, b) {
    if (+a.dia !== +b.dia) return false;
    if (a.franjaId && b.franjaId && a.franjaId === b.franjaId) return true;
    var a1 = hm(a.desde), a2 = hm(a.hasta), b1 = hm(b.desde), b2 = hm(b.hasta);
    if (a1 == null || a2 == null || b1 == null || b2 == null) return false;
    return a1 < b2 && b1 < a2;
  }
  function fechasSolapan(a, b) {
    var a1 = a.inicio || '', a2 = a.fin || '9999', b1 = b.inicio || '', b2 = b.fin || '9999';
    return a1 <= b2 && b1 <= a2;
  }
  /** Devuelve el primer par de horarios en conflicto entre dos cursos, o null. */
  function chocan(a, b) {
    if (!fechasSolapan(a, b)) return null;
    var ha = a.horario || [], hb = b.horario || [];
    for (var i = 0; i < ha.length; i++) for (var j = 0; j < hb.length; j++) if (itemChoca(ha[i], hb[j])) return itemHorarioTxt(ha[i]);
    return null;
  }

  /* ---------- estado de inscripciones ---------- */
  function insDeCurso(d, cursoId) { return d.inscripciones.filter(function (i) { return i.cursoId === cursoId; }); }
  function ocupan(i) { return i.estado === 'inscrito' || i.estado === 'completado'; }
  function conteo(d, curso) {
    var l = insDeCurso(d, curso.id), n = l.filter(ocupan).length, cupo = curso.cupo == null || curso.cupo === '' ? null : +curso.cupo;
    return { inscritos: n, espera: l.filter(function (i) { return i.estado === 'en_lista_espera'; }).length, cupo: cupo, libres: cupo == null ? Infinity : Math.max(0, cupo - n) };
  }
  function esActivo(i) { return i.estado === 'inscrito' || i.estado === 'en_lista_espera'; }

  /** Grado actual del estudiante via matricula activa: {nivel, grado, seccion, label} o null. */
  function gradoDe(d, estId) {
    var m = d.matriculas.filter(function (x) { return x.estudianteId === estId && x.estado === 'activa'; })[0];
    if (!m) return null;
    var s = pick(d.secciones, m.seccionId), c = s && pick(d.cursos, s.cursoId);
    if (!c) return null;
    return { nivel: c.nivel, grado: c.grado, seccionId: s.id, key: c.nivel + ':' + c.grado, label: c.grado + '.º ' + c.nivel + ' · ' + s.nombre };
  }
  function gradoKeyTxt(k) { var p = String(k).split(':'); return p[1] + '.º ' + p[0]; }
  function gradosTxt(c) { var g = c.grados || []; return g.length ? g.map(gradoKeyTxt).join(', ') : 'Todos los grados'; }

  /** Valida inscribir a `est` en `curso` (sin cupo). Devuelve mensaje de error o null. */
  function validarEstudiante(d, curso, est, ignorarInsId) {
    var nom = est ? fmt.nombreCompleto(est) : 'Estudiante';
    if (!est) return 'Estudiante no encontrado.';
    if ((est.estado || 'activo') !== 'activo') return nom + ' está inactivo/a (dado/a de baja).';
    if (curso.estado === 'cerrado') return 'El curso está cerrado.';
    var prev = pick(d.inscripciones, insId(curso.id, est.id));
    if (prev && esActivo(prev) && prev.id !== ignorarInsId) return nom + ' ya está ' + (prev.estado === 'inscrito' ? 'inscrito/a' : 'en la lista de espera') + ' en este curso (inscripción duplicada).';
    if (prev && prev.estado === 'completado') return nom + ' ya completó este curso.';
    var g = curso.grados || [];
    if (g.length) {
      var ge = gradoDe(d, est.id);
      if (!ge) return nom + ' no tiene matrícula activa; no se puede verificar el grado permitido.';
      if (g.indexOf(ge.key) === -1) return nom + ' (' + ge.label + ') no cumple el grado permitido: ' + gradosTxt(curso) + '.';
    }
    var otras = d.inscripciones.filter(function (i) { return i.estudianteId === est.id && i.cursoId !== curso.id && esActivo(i); });
    for (var k = 0; k < otras.length; k++) {
      var oc = pick(d.cursosExtra, otras[k].cursoId);
      if (!oc || oc.estado === 'cerrado') continue;
      var ch = chocan(curso, oc);
      if (ch) return nom + ' tiene choque de horario (' + ch + ') con «' + oc.nombre + '».';
    }
    return null;
  }

  /** Inscribe estudiantes; cada uno se evalúa de forma independiente. Devuelve [{estudianteId, ok, estado?, error?}]. */
  async function asignar(cursoId, estIds, opts) {
    opts = opts || {};
    var d = await cargar(), curso = pick(d.cursosExtra, cursoId);
    if (!curso) throw new Error('El curso no existe en este centro.');
    var res = [], nuevos = [], ocup = conteo(d, curso).inscritos, cupo = conteo(d, curso).cupo;
    var vistos = {};
    estIds.forEach(function (id) {
      var est = pick(d.estudiantes, id), err = vistos[id] ? 'Estudiante repetido en la selección.' : validarEstudiante(d, curso, est);
      vistos[id] = true;
      if (err) { res.push({ estudianteId: id, ok: false, error: err }); return; }
      var estado = (cupo == null || ocup < cupo) ? 'inscrito' : 'en_lista_espera';
      if (estado === 'inscrito') ocup++;
      var prev = pick(d.inscripciones, insId(cursoId, id)) || {};
      var reg = Object.assign({}, prev, { id: insId(cursoId, id), centroId: curso.centroId, cursoId: cursoId, estudianteId: id, fecha: opts.fecha || fmt.hoy(), estado: estado,
        turno: estado === 'en_lista_espera' ? turno() : null, asistencia: prev.asistencia || [], nota: null, observacion: prev.observacion || '' });
      // se registra en `d` para que los choques entre estudiantes duplicados/otros cursos vean el cambio
      d.inscripciones = d.inscripciones.filter(function (i) { return i.id !== reg.id; }).concat([reg]);
      nuevos.push(reg); res.push({ estudianteId: id, ok: true, estado: estado });
    });
    if (nuevos.length) await EDU.repo.guardarMuchos('inscripciones', nuevos);
    return res;
  }

  /** Promueve de la lista de espera mientras haya lugares. Devuelve las inscripciones promovidas (con nombre para avisar). */
  async function promover(cursoId) {
    var d = await cargar(), curso = pick(d.cursosExtra, cursoId);
    if (!curso || curso.estado === 'cerrado') return [];
    var c = conteo(d, curso), libres = c.libres, hechos = [], fallidos = [];
    var cola = insDeCurso(d, cursoId).filter(function (i) { return i.estado === 'en_lista_espera'; }).sort(function (a, b) { return (a.turno || 0) - (b.turno || 0); });
    for (var k = 0; k < cola.length && libres > 0; k++) {
      var i = cola[k], est = pick(d.estudiantes, i.estudianteId);
      var err = validarEstudiante(d, curso, est, i.id);
      if (err) { fallidos.push(i.id); continue; }
      i.estado = 'inscrito'; i.turno = null; i.promovidoEn = fmt.hoy(); libres--;
      hechos.push(i);
    }
    if (hechos.length) await EDU.repo.guardarMuchos('inscripciones', hechos);
    return hechos.map(function (i) { return { inscripcion: i, estudiante: pick(d.estudiantes, i.estudianteId) }; });
  }

  async function retirar(insIdv, motivo) {
    var i = await EDU.repo.obtener('inscripciones', insIdv);
    if (!i) throw new Error('La inscripción no existe.');
    var eraInscrito = ocupan(i);
    i.estado = 'retirado'; i.fechaRetiro = fmt.hoy(); i.motivoRetiro = motivo || ''; i.turno = null;
    await EDU.repo.guardar('inscripciones', i);
    return eraInscrito ? await promover(i.cursoId) : [];
  }

  /** Reinscribe a un retirado: pasa por todas las validaciones y por el cupo (puede quedar en lista de espera). */
  async function reinscribir(insIdv) {
    var i = await EDU.repo.obtener('inscripciones', insIdv);
    if (!i) throw new Error('La inscripción no existe.');
    var d = await cargar(), curso = pick(d.cursosExtra, i.cursoId), est = pick(d.estudiantes, i.estudianteId);
    var err = validarEstudiante(d, curso || { estado: 'cerrado' }, est);
    if (err) throw new Error(err);
    var c = conteo(d, curso), estado = c.cupo == null || c.inscritos < c.cupo ? 'inscrito' : 'en_lista_espera';
    i.estado = estado; i.turno = estado === 'en_lista_espera' ? turno() : null; i.fecha = fmt.hoy(); delete i.fechaRetiro; delete i.motivoRetiro;
    await EDU.repo.guardar('inscripciones', i);
    return estado;
  }

  function pctAsistencia(i) {
    var a = i.asistencia || []; if (!a.length) return null;
    return Math.round(a.filter(function (x) { return x.estado !== 'A'; }).length / a.length * 1000) / 10;
  }

  /* ---------- CSV ---------- */
  /** Neutraliza inyección de fórmulas: celdas que empiezan por = + - @ (o tab/CR) se prefijan con apóstrofo. */
  function celdaCsv(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function aCsv(cabeceras, filas) {
    return '﻿' + [cabeceras].concat(filas).map(function (f) { return f.map(celdaCsv).join(','); }).join('\r\n');
  }
  function descargar(nombre, texto) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' })); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  EDU.cursosLogica = { TIPOS: TIPOS, ESTADOS: ESTADOS, EST_INS: EST_INS, DIAS: DIAS, etiqueta: etiqueta, pick: pick, insId: insId, cargar: cargar, franjasDe: franjasDe, itemHorarioTxt: itemHorarioTxt,
    horarioTxt: horarioTxt, chocan: chocan, insDeCurso: insDeCurso, ocupan: ocupan, esActivo: esActivo, conteo: conteo, gradoDe: gradoDe, gradoKeyTxt: gradoKeyTxt, gradosTxt: gradosTxt,
    validarEstudiante: validarEstudiante, asignar: asignar, promover: promover, retirar: retirar, reinscribir: reinscribir, pctAsistencia: pctAsistencia, celdaCsv: celdaCsv, aCsv: aCsv, descargar: descargar };
})();
