/* Vista dashboard: panel por rol con KPIs calculados de los datos reales. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, raw = EDU.raw;
  var COLS = ['centros', 'anios', 'periodos', 'escalas', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores', 'matriculas', 'categorias', 'actividades', 'calificaciones', 'notasCompetencia', 'asistencia'];

  function media(a) { var v = a.filter(function (x) { return x != null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; }
  function por(lista, k) { return EDU.consultas.agrupar(lista, k); }
  function nombreEst(e) { return e ? fmt.nombreCompleto(e) : '?'; }
  function secEtiqueta(d, s) { var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0]; return (c ? c.nombre : '') + ' ' + s.nombre; }
  function asigNombre(d, id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? a.nombre : id; }

  /** Estadisticas de un conjunto de filas de resumenNotas. */
  function stats(filas) {
    var con = filas.filter(function (f) { return f.final != null; });
    return { n: con.length, prom: media(con.map(function (f) { return f.pct; })), aprob: con.length ? con.filter(function (f) { return f.aprobado; }).length / con.length * 100 : null };
  }
  function riesgo(filas) { // estudiantes con al menos una asignatura reprobada
    var m = {}; filas.forEach(function (f) { if (f.final != null && !f.aprobado) (m[f.estudianteId] = m[f.estudianteId] || []).push(f); });
    return m;
  }
  function asistPct(asis) { return asis.length ? asis.filter(function (a) { return a.estado !== 'A'; }).length / asis.length * 100 : null; }
  function enEscala(pct, esc_) { return pct == null ? null : EDU.escala.desdePorcentaje(pct, esc_); }

  async function cargarTodo() {
    var d = await EDU.consultas.cargar(COLS), ses = EDU.estado.sesion();
    d.alcance = EDU.permisos.alcance(ses, d);
    d.escalaCentro = d.escalas.length ? EDU.consultas.escalaDe(d.escalas, EDU.estado.centroActivo() || d.escalas[0].centroId) : EDU.escala.porDefecto();
    d.periodo = EDU.consultas.periodoAbierto(d.periodos, EDU.estado.centroActivo() || (d.centros[0] && d.centros[0].id));
    d.resumen = EDU.consultas.resumenNotas(d);
    return d;
  }

  function cabecera(d, eyebrow, titulo) {
    var c = EDU.estado.centroActivo(), centro = d.centros.filter(function (x) { return x.id === c; })[0];
    var anio = d.anios[0];
    return ui.cabecera({ eyebrow: eyebrow, titulo: titulo,
      descripcion: (centro ? centro.nombre : 'Todos los centros de la red') + (anio ? ' · ' + anio.nombre : '') + (d.periodo && c ? ' · Periodo abierto: ' + d.periodo.nombre + ' (cierra el ' + fmt.fecha(d.periodo.fin) + ')' : '') });
  }
  function alerta(tipo, t, s) { return '<div class="alert ' + tipo + '"><div><strong>' + esc(t) + '</strong><small>' + esc(s) + '</small></div></div>'; }

  /** Barras de promedio por asignatura (nombre, pct). */
  function barrasAsig(d, filas, esc_) {
    var g = por(filas.filter(function (f) { return f.final != null; }), 'asignaturaId'), items = [];
    var nom = {}; d.cargas.forEach(function (c) { nom[c.id] = c.asignaturaId; });
    var acc = {};
    filas.forEach(function (f) { if (f.final == null) return; var nm = asigNombre(d, f.asignaturaId).replace(/ \(.*\)/, ''); (acc[nm] = acc[nm] || []).push(f.pct); });
    Object.keys(acc).forEach(function (k) { items.push({ etiqueta: k, valor: media(acc[k]) }); });
    if (!items.length) return ui.vacio({ titulo: 'Aún no hay calificaciones' });
    var mx = Math.max.apply(null, items.map(function (i) { return i.valor; }));
    items.forEach(function (i) { i.destacado = i.valor === mx; i.texto = esc_ ? fmt.nota(enEscala(i.valor, esc_), esc_) : fmt.num(i.valor, 1); });
    return ui.barras(items);
  }

  /* ---------- Admin de red ---------- */
  function vistaRed(cont, d) {
    var porC = por(d.resumen, 'centroId'), all = stats(d.resumen);
    var asis = asistPct(d.asistencia);
    var h = cabecera(d, 'Red educativa', 'Panel de la red') +
      aHtml(ui.kpis([
        { etiqueta: 'Centros educativos', valor: d.centros.length },
        { etiqueta: 'Estudiantes matriculados', valor: d.matriculas.filter(function (m) { return m.estado === 'activa'; }).length },
        { etiqueta: 'Docentes', valor: d.docentes.length },
        { etiqueta: 'Promedio de la red', valor: fmt.nota(all.prom, { decimales: 1 }), detalle: 'Escala normalizada 0–100', tono: 'neu' },
        { etiqueta: 'Aprobación', valor: fmt.pct(all.aprob), detalle: 'Asignaturas con final ≥ mínimo' },
        { etiqueta: 'Asistencia', valor: fmt.pct(asis, 1), detalle: 'Últimas 2 semanas', tono: 'neu' }]));
    var items = d.centros.map(function (c) { var s = stats(porC[c.id] || []); return { etiqueta: c.codigo, valor: s.prom || 0, texto: fmt.num(s.prom, 1) }; });
    h += '<div class="grid two"><div class="card"><h2>Promedio por centro</h2><p class="note" style="margin:0 0 10px">Escala 0–100</p>' + aHtml(ui.barras(items)) + '</div>' +
      '<div class="card"><h2>Alertas de la red</h2>' + d.centros.map(function (c) {
        var r = Object.keys(riesgo(porC[c.id] || [])).length;
        return alerta(r ? 'red' : 'ok', c.nombre, r ? r + ' estudiantes con al menos una asignatura reprobada.' : 'Sin estudiantes en riesgo.');
      }).join('') + '</div></div>';
    h += '<h2 style="margin:26px 0 12px">Centros</h2><div class="grid cols-auto" id="centros">' + d.centros.map(function (c) {
      var s = stats(porC[c.id] || []), est = d.matriculas.filter(function (m) { return m.centroId === c.id && m.estado === 'activa'; }).length;
      return '<button type="button" class="card center" data-c="' + esc(c.id) + '"><div class="ban" style="background:' + esc(c.color || '#14315c') + '">' + esc(c.codigo) + '</div><h3>' + esc(c.nombre) + '</h3><p>' + esc(c.ciudad) + ' · ' + esc(c.nivel) + '</p>' +
        '<div class="chips"><span class="chip">' + esc(est) + ' estudiantes</span><span class="chip amb">Promedio ' + esc(fmt.num(s.prom, 1)) + '</span><span class="chip">Aprob. ' + esc(fmt.pct(s.aprob)) + '</span></div></button>';
    }).join('') + '</div><p class="note">Selecciona un centro para ver su panel detallado.</p>';
    cont.innerHTML = h;
    cont.querySelector('#centros').addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (b) EDU.estado.cambiarCentro(b.dataset.c); });
  }
  function aHtml(x) { return x instanceof EDU.Safe ? x.s : String(x); }

  /* ---------- Director (o admin con centro elegido) ---------- */
  function vistaDirector(cont, d) {
    var e = d.escalaCentro, st = stats(d.resumen), rs = riesgo(d.resumen), asis = asistPct(d.asistencia);
    var mats = d.matriculas.filter(function (m) { return m.estado === 'activa'; });
    var h = cabecera(d, EDU.permisos.etiquetaRol(EDU.estado.rol()), 'Panel del centro') + aHtml(ui.kpis([
      { etiqueta: 'Estudiantes matriculados', valor: mats.length },
      { etiqueta: 'Docentes', valor: d.docentes.length },
      { etiqueta: 'Secciones', valor: d.secciones.length, detalle: d.cursos.length + ' cursos', tono: 'neu' },
      { etiqueta: 'Promedio general', valor: fmt.nota(enEscala(st.prom, e), e), detalle: 'Escala ' + e.min + '–' + e.max + ' · mín. ' + e.notaMinAprobar, tono: 'neu' },
      { etiqueta: 'Aprobación', valor: fmt.pct(st.aprob), detalle: 'Asignaturas con final ≥ ' + e.notaMinAprobar },
      { etiqueta: 'Asistencia', valor: fmt.pct(asis, 1), detalle: 'Últimas 2 semanas', tono: 'neu' }]));
    // pendientes por docente
    var calCount = {}; d.calificaciones.forEach(function (c) { if (c.puntos != null) calCount[c.actividadId] = (calCount[c.actividadId] || 0) + 1; });
    var secN = {}; mats.forEach(function (m) { secN[m.seccionId] = (secN[m.seccionId] || 0) + 1; });
    var cargaSec = {}; d.cargas.forEach(function (c) { cargaSec[c.id] = c; });
    var abiertas = d.actividades.filter(function (a) { return d.periodo && a.periodoId === d.periodo.id && (calCount[a.id] || 0) < (secN[cargaSec[a.cargaId] && cargaSec[a.cargaId].seccionId] || 0); });
    var docPend = {}; abiertas.forEach(function (a) { var c = cargaSec[a.cargaId]; if (c) docPend[c.docenteId] = (docPend[c.docenteId] || 0) + 1; });
    var nRiesgo = Object.keys(rs).length;
    h += '<div class="grid two"><div class="card"><h2>Promedio por asignatura</h2><p class="note" style="margin:0 0 10px">Escala ' + e.min + '–' + e.max + ' · en ámbar, la de mejor desempeño</p>' + aHtml(barrasAsig(d, d.resumen, e)) + '</div>' +
      '<div class="card"><h2>Alertas</h2>' +
      alerta(nRiesgo ? 'red' : 'ok', nRiesgo + ' estudiantes en riesgo', nRiesgo ? 'Tienen al menos una asignatura por debajo de ' + e.notaMinAprobar + '.' : 'Nadie tiene asignaturas reprobadas.') +
      alerta('', 'Cierre de notas: ' + (d.periodo ? fmt.fecha(d.periodo.fin) : '—'), Object.keys(docPend).length + ' docentes con actividades por completar (' + abiertas.length + ' actividades).') +
      alerta('', 'Asistencia', 'Promedio de asistencia de ' + fmt.pct(asis, 1) + ' en las últimas dos semanas.') + '</div></div>';
    h += '<div class="card" style="margin-top:18px"><h2 style="margin-bottom:10px">Secciones</h2><div id="tsec"></div></div>';
    cont.innerHTML = h;
    var filas = d.secciones.map(function (s) {
      var f = d.resumen.filter(function (x) { return x.seccionId === s.id; }), t = stats(f), a = asistPct(d.asistencia.filter(function (x) { return x.seccionId === s.id; }));
      return { seccion: secEtiqueta(d, s), est: secN[s.id] || 0, prom: enEscala(t.prom, e), aprob: t.aprob, riesgo: Object.keys(riesgo(f)).length, asis: a };
    });
    cont.querySelector('#tsec').appendChild(ui.tabla({ etiqueta: 'Resumen por sección', buscar: false, porPagina: false, ordenInicial: 'seccion', columnas: [
      { clave: 'seccion', titulo: 'Sección' }, { clave: 'est', titulo: 'Estudiantes', align: 'c' }, { clave: 'prom', titulo: 'Promedio', align: 'c', formato: function (v) { return fmt.nota(v, e); } },
      { clave: 'aprob', titulo: 'Aprobación', align: 'c', formato: function (v) { return fmt.pct(v); } }, { clave: 'riesgo', titulo: 'En riesgo', align: 'c',
        render: function (f) { return aHtml(ui.badge(f.riesgo, f.riesgo ? 'bad' : 'ok')); } }, { clave: 'asis', titulo: 'Asistencia', align: 'c', formato: function (v) { return fmt.pct(v, 1); } }], filas: filas }).el);
  }

  /* ---------- Docente ---------- */
  function vistaDocente(cont, d) {
    var e = d.escalaCentro, al = d.alcance, mis = EDU.permisos.filtrar(al, 'cargas', d.cargas), ids = new Set(mis.map(function (c) { return c.id; }));
    var filas = d.resumen.filter(function (f) { return ids.has(f.cargaId); }), st = stats(filas), rs = riesgo(filas);
    var calCount = {}; d.calificaciones.forEach(function (c) { if (c.puntos != null) calCount[c.actividadId] = (calCount[c.actividadId] || 0) + 1; });
    var secN = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa') secN[m.seccionId] = (secN[m.seccionId] || 0) + 1; });
    var cargaPend = {}; mis.forEach(function (c) { cargaPend[c.id] = 0; });
    d.actividades.forEach(function (a) { var c = mis.filter(function (x) { return x.id === a.cargaId; })[0]; if (c && d.periodo && a.periodoId === d.periodo.id && (calCount[a.id] || 0) < (secN[c.seccionId] || 0)) cargaPend[c.id]++; });
    var totPend = Object.keys(cargaPend).reduce(function (s, k) { return s + cargaPend[k]; }, 0);
    var h = cabecera(d, 'Docente', 'Mi panel') + aHtml(ui.kpis([
      { etiqueta: 'Mis asignaturas', valor: mis.length, detalle: new Set(mis.map(function (c) { return c.seccionId; })).size + ' secciones', tono: 'neu' },
      { etiqueta: 'Mis estudiantes', valor: al.estudianteIds ? al.estudianteIds.size : 0 },
      { etiqueta: 'Promedio de mis cursos', valor: fmt.nota(enEscala(st.prom, e), e), detalle: 'Escala ' + e.min + '–' + e.max, tono: 'neu' },
      { etiqueta: 'Aprobación', valor: fmt.pct(st.aprob) },
      { etiqueta: 'Actividades por completar', valor: totPend, detalle: 'Periodo abierto', tono: totPend ? 'bad' : undefined }]));
    var nm = Object.keys(rs).map(function (id) { return nombreEst(d.estudiantes.filter(function (x) { return x.id === id; })[0]); });
    h += '<div class="grid two"><div class="card"><h2 style="margin-bottom:10px">Mis cursos</h2><div id="tc"></div></div><div class="card"><h2>Atención</h2>' +
      (nm.length ? alerta('red', nm.length + ' estudiantes en riesgo', nm.slice(0, 6).join(', ') + (nm.length > 6 ? '…' : '')) : alerta('ok', 'Sin estudiantes en riesgo', 'Todos aprueban tus asignaturas.')) +
      (totPend ? alerta('', 'Notas por completar', 'Tienes ' + totPend + ' actividades del periodo abierto con calificaciones pendientes.') : '') + '</div></div>';
    cont.innerHTML = h;
    var sec = {}; d.secciones.forEach(function (s) { sec[s.id] = s; });
    cont.querySelector('#tc').appendChild(ui.tabla({ etiqueta: 'Mis cursos', buscar: false, porPagina: false, ordenInicial: 'curso', columnas: [
      { clave: 'curso', titulo: 'Sección' }, { clave: 'asig', titulo: 'Asignatura' }, { clave: 'prom', titulo: 'Promedio', align: 'c', formato: function (v) { return fmt.nota(v, e); } },
      { clave: 'pend', titulo: 'Por completar', align: 'c' }], filas: mis.map(function (c) {
        var f = d.resumen.filter(function (x) { return x.cargaId === c.id; });
        return { curso: secEtiqueta(d, sec[c.seccionId]), asig: asigNombre(d, c.asignaturaId), prom: enEscala(stats(f).prom, e), pend: cargaPend[c.id] };
      }) }).el);
  }

  /* ---------- Secretaria ---------- */
  function vistaSecretaria(cont, d) {
    var mats = d.matriculas.filter(function (m) { return m.estado === 'activa'; }), conMat = new Set(mats.map(function (m) { return m.estudianteId; }));
    var sinMat = d.estudiantes.filter(function (x) { return !conMat.has(x.id); }), conTutor = new Set(); d.tutores.forEach(function (t) { (t.estudianteIds || []).forEach(function (i) { conTutor.add(i); }); });
    var sinTutor = d.estudiantes.filter(function (x) { return !conTutor.has(x.id); });
    var h = cabecera(d, 'Secretaría', 'Panel de secretaría') + aHtml(ui.kpis([
      { etiqueta: 'Estudiantes registrados', valor: d.estudiantes.length }, { etiqueta: 'Matrículas activas', valor: mats.length },
      { etiqueta: 'Sin matrícula activa', valor: sinMat.length, tono: sinMat.length ? 'bad' : undefined, detalle: sinMat.length ? 'Requieren atención' : 'Todo al día' },
      { etiqueta: 'Sin tutor asignado', valor: sinTutor.length, tono: sinTutor.length ? 'bad' : undefined }, { etiqueta: 'Secciones', valor: d.secciones.length, tono: 'neu' }])) +
      '<div class="card"><h2 style="margin-bottom:10px">Matrícula por sección</h2><div id="tm"></div></div><p class="note"><a href="#/matricula">Ir a matrícula</a> · <a href="#/boletin">Ir a boletines</a></p>';
    cont.innerHTML = h;
    cont.querySelector('#tm').appendChild(ui.tabla({ etiqueta: 'Matrícula por sección', buscar: false, porPagina: false, ordenInicial: 'seccion', columnas: [
      { clave: 'seccion', titulo: 'Sección' }, { clave: 'n', titulo: 'Matriculados', align: 'c' }, { clave: 'cap', titulo: 'Capacidad', align: 'c' },
      { clave: 'oc', titulo: 'Ocupación', align: 'c', formato: function (v) { return fmt.pct(v); } }], filas: d.secciones.map(function (s) {
        var n = mats.filter(function (m) { return m.seccionId === s.id; }).length; return { seccion: secEtiqueta(d, s), n: n, cap: s.capacidad || 30, oc: n / (s.capacidad || 30) * 100 };
      }) }).el);
  }

  /* ---------- Tutor / Estudiante ---------- */
  function vistaFamilia(cont, d) {
    var e = d.escalaCentro, ids = Array.from(d.alcance.estudianteIds || []), rol = EDU.estado.rol();
    var h = cabecera(d, EDU.permisos.etiquetaRol(rol), rol === 'tutor' ? 'Mis hijos e hijas' : 'Mi progreso');
    if (!ids.length) h += '<div class="card">' + aHtml(ui.vacio({ titulo: 'Sin estudiantes asociados' })) + '</div>';
    ids.forEach(function (id) {
      var est = d.estudiantes.filter(function (x) { return x.id === id; })[0]; if (!est) return;
      var f = d.resumen.filter(function (x) { return x.estudianteId === id && x.final != null; }), prom = media(f.map(function (x) { return x.pct; }));
      var m = d.matriculas.filter(function (x) { return x.estudianteId === id && x.estado === 'activa'; })[0], sec = m && d.secciones.filter(function (s) { return s.id === m.seccionId; })[0];
      var a = asistPct(d.asistencia.filter(function (x) { return x.estudianteId === id; })), rep = f.filter(function (x) { return !x.aprobado; }).length;
      h += '<div class="card" style="margin-bottom:18px"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div class="ficha-pic" aria-hidden="true">' + esc(fmt.iniciales(nombreEst(est))) + '</div>' +
        '<div><h2>' + esc(nombreEst(est)) + '</h2><div class="chips" style="margin-top:6px"><span class="chip">' + esc(sec ? secEtiqueta(d, sec) : 'Sin sección') + '</span><span class="chip amb">Promedio ' + esc(fmt.nota(enEscala(prom, e), e)) + '</span><span class="chip">Asistencia ' + esc(fmt.pct(a, 1)) + '</span> ' +
        aHtml(rep ? ui.badge(rep + ' asignatura(s) en riesgo', 'bad') : ui.badge('Al día', 'ok')) + '</div></div></div><div class="bol">' +
        f.map(function (x) { return aHtml(ui.progreso({ etiqueta: asigNombre(d, x.asignaturaId).replace(/ \(.*\)/, ''), valor: x.pct, minimo: EDU.escala.minAprobarPct(e), texto: fmt.nota(x.final, e) })); }).join('') +
        '</div><p class="note">La línea azul marca la nota mínima de aprobación (' + esc(e.notaMinAprobar) + ').</p></div>';
    });
    cont.innerHTML = h;
  }

  EDU.router.register('dashboard', {
    titulo: 'Panel',
    render: async function (cont) {
      var d = await cargarTodo(), rol = EDU.estado.rol(), c = EDU.estado.centroActivo();
      if (rol === 'admin_red') return c ? vistaDirector(cont, d) : vistaRed(cont, d);
      if (rol === 'director') return vistaDirector(cont, d);
      if (rol === 'docente') return vistaDocente(cont, d);
      if (rol === 'secretaria') return vistaSecretaria(cont, d);
      return vistaFamilia(cont, d);
    }
  });
})();
