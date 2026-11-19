/* Vista "boletin": boletin de calificaciones A4 imprimible por estudiante (o toda la seccion).
   Usa EDU.consultas.resumenNotas (EDU.calculo) sin redondear; solo se redondea al mostrar. @media print oculta menus. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, calc = EDU.calculo;
  var COLS = ['centros', 'anios', 'periodos', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores', 'matriculas', 'escalas', 'categorias', 'actividades', 'calificaciones', 'notasCompetencia', 'asistencia'];

  var CSS = '.bo-bar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.bo-bar label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:500;flex:1 1 200px;min-width:0;max-width:100%}.bo-bar select{width:100%;min-width:0;max-width:100%}' +
    '.bo-hoja{background:#fff;color:#000;max-width:210mm;margin:16px auto;padding:14mm 12mm;border:1px solid var(--line);border-radius:6px;box-shadow:var(--shadow);font-size:13px}' +
    '.bo-enc{display:flex;gap:14px;align-items:center;border-bottom:3px double var(--navy);padding-bottom:10px;margin-bottom:12px}' +
    '.bo-logo{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;color:#fff;font:700 24px var(--serif);flex:none;border:3px solid var(--amber)}' +
    '.bo-enc h2{font-size:20px;margin:0}.bo-enc p{margin:2px 0 0;font-size:12px;color:#333}.bo-tit{text-align:center;font:600 18px var(--serif);color:var(--navy);margin:8px 0 12px;letter-spacing:.04em;text-transform:uppercase}' +
    '.bo-dat{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 18px;margin-bottom:12px}.bo-dat div{border-bottom:1px solid #ccc;padding:2px 0}.bo-dat b{font-weight:600;color:#333}' +
    '.bo-hoja table.t{min-width:0;font-size:12.5px}.bo-hoja table.t th,.bo-hoja table.t td{padding:5px 7px;border:1px solid #bbb}.bo-hoja .tw{overflow-x:auto}' +
    '.bo-res{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:12px 0;padding:8px 10px;border:1px solid #bbb;border-radius:6px}.bo-res b{font-size:15px}' +
    '.bo-firmas{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:46px;text-align:center;font-size:12px}.bo-firmas div{border-top:1px solid #000;padding-top:4px}' +
    '.bo-nota{font-size:11px;color:#444;margin-top:10px}' +
    '@media(max-width:640px){.bo-hoja{padding:12px;margin:10px 0}.bo-dat{grid-template-columns:1fr}.bo-firmas{grid-template-columns:1fr;gap:34px}}' +
    '@media print{.bo-hoja{border:0;box-shadow:none;border-radius:0;margin:0;padding:0;max-width:none;width:100%;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bo-hoja+.bo-hoja{break-before:page}' +
    '.badge{border:1px solid #666;background:#fff!important;color:#000!important}.bo-logo{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  function estilo() { if (document.getElementById('bo-css')) return; var s = document.createElement('style'); s.id = 'bo-css'; s.textContent = CSS; document.head.appendChild(s); }
  function cmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function por(l, k) { return EDU.consultas.agrupar(l, k); }

  EDU.router.register('boletin', {
    titulo: 'Boletín',
    render: async function (cont) {
      estilo();
      var ses = EDU.estado.sesion(), rol = ses.rol, d = await EDU.consultas.cargar(COLS);
      var puedeImprimir = EDU.permisos.puede(rol, 'boletin', 'imprimir');
      var S = { centroId: EDU.estado.centroActivo() || (rol === 'admin_red' ? (d.centros[0] || {}).id : null), seccionId: null, estId: null, periodoId: 'anual', todos: false };
      var esAdminTodos = rol === 'admin_red' && !EDU.estado.centroActivo();
      var alc = EDU.permisos.alcance(ses, d);

      cont.innerHTML = '<div class="no-print">' + ui.cabecera({ eyebrow: 'Informe académico', titulo: 'Boletín de calificaciones', descripcion: 'Selecciona sección, estudiante y periodo. El boletín se imprime en tamaño A4 sin menús.' }) +
        '<div class="card"><div class="bo-bar" id="bo-sel"></div></div></div><div id="bo-doc" aria-live="polite"></div>';
      var elSel = cont.querySelector('#bo-sel'), elDoc = cont.querySelector('#bo-doc');

      function delCentro(l) { return S.centroId ? l.filter(function (x) { return x.centroId === S.centroId; }) : l; }
      function secEt(s) { var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0]; return (c ? c.nombre : '') + ' · Sección ' + s.nombre; }
      function seccionesVis() { return EDU.permisos.filtrar(alc, 'secciones', delCentro(d.secciones)).sort(function (a, b) { return cmp(secEt(a), secEt(b)); }); }
      function estsDe(secId) {
        var ids = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa' && m.seccionId === secId) ids[m.estudianteId] = 1; });
        return EDU.permisos.filtrar(alc, 'estudiantes', d.estudiantes.filter(function (e) { return ids[e.id]; })).sort(function (a, b) { return cmp(a.apellidos + ' ' + a.nombres, b.apellidos + ' ' + b.nombres); });
      }
      function periodosDe(centroId, anioId) { return d.periodos.filter(function (p) { return p.centroId === centroId && p.anioId === anioId; }).sort(function (a, b) { return a.orden - b.orden; }); }

      function pintarSel() {
        var ss = seccionesVis();
        if (!ss.length) { elSel.innerHTML = ''; elDoc.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin boletines disponibles', texto: 'No hay secciones con estudiantes accesibles para tu usuario.' }) + '</div>'; return false; }
        if (!S.seccionId || !ss.some(function (s) { return s.id === S.seccionId; })) S.seccionId = ss[0].id;
        var es = estsDe(S.seccionId);
        if (!S.estId || !es.some(function (e) { return e.id === S.estId; })) S.estId = es.length ? es[0].id : null;
        var s0 = d.secciones.filter(function (s) { return s.id === S.seccionId; })[0], pers = periodosDe(s0.centroId, s0.anioId);
        elSel.innerHTML = (esAdminTodos ? '<label>Centro<select id="bo-c">' + ui.opciones(d.centros.map(function (c) { return { valor: c.id, texto: c.nombre }; }), S.centroId) + '</select></label>' : '') +
          '<label>Sección<select id="bo-s">' + ui.opciones(ss.map(function (s) { return { valor: s.id, texto: secEt(s) }; }), S.seccionId) + '</select></label>' +
          '<label>Estudiante<select id="bo-e"' + (S.todos ? ' disabled' : '') + '>' + ui.opciones(es.map(function (e) { return { valor: e.id, texto: fmt.nombreCompleto(e) }; }), S.estId) + '</select></label>' +
          '<label>Periodo<select id="bo-p">' + ui.opciones([{ valor: 'anual', texto: 'Anual (todos los periodos)' }].concat(pers.map(function (p) { return { valor: p.id, texto: p.nombre }; })), S.periodoId) + '</select></label>' +
          (es.length > 1 && rol !== 'estudiante' && rol !== 'tutor' ? '<label class="opt" style="flex-direction:row;align-items:center"><input type="checkbox" id="bo-t"' + (S.todos ? ' checked' : '') + '> Toda la sección</label>' : '') +
          (puedeImprimir ? '<button type="button" class="btn amb" id="bo-imp">Imprimir boletín</button>' : '');
        return true;
      }
      elSel.addEventListener('change', function (e) {
        var id = e.target.id;
        if (id === 'bo-c') { S.centroId = e.target.value; S.seccionId = null; S.estId = null; }
        else if (id === 'bo-s') { S.seccionId = e.target.value; S.estId = null; }
        else if (id === 'bo-e') S.estId = e.target.value;
        else if (id === 'bo-p') S.periodoId = e.target.value;
        else if (id === 'bo-t') S.todos = e.target.checked;
        if (pintarSel()) pintar();
        var f = elSel.querySelector('#' + id); if (f) f.focus();
      });
      elSel.addEventListener('click', function (e) { if (e.target.id === 'bo-imp') window.print(); });

      /* ---------- calculo ---------- */
      var resumen = EDU.consultas.resumenNotas(d), porEst = por(resumen, 'estudianteId');
      function asigNombre(id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? a.nombre : id; }
      function docNombre(id) { var x = d.docentes.filter(function (y) { return y.id === id; })[0]; return x ? fmt.nombreCompleto(x) : '—'; }

      function hoja(est) {
        var sec_ = d.secciones.filter(function (s) { return s.id === S.seccionId; })[0], centro = d.centros.filter(function (c) { return c.id === sec_.centroId; })[0] || {};
        var curso = d.cursos.filter(function (c) { return c.id === sec_.cursoId; })[0] || {}, anio = d.anios.filter(function (a) { return a.id === sec_.anioId; })[0] || {};
        var esc_ = EDU.consultas.escalaDe(d.escalas, sec_.centroId), pers = periodosDe(sec_.centroId, sec_.anioId);
        var anual = S.periodoId === 'anual', pSel = pers.filter(function (p) { return p.id === S.periodoId; })[0], colsP = anual ? pers : (pSel ? [pSel] : pers);
        var filas = (porEst[est.id] || []).filter(function (f) { return f.seccionId === S.seccionId; }).sort(function (a, b) { return cmp(asigNombre(a.asignaturaId), asigNombre(b.asignaturaId)); });
        var abiertos = pers.some(function (p) { return !p.cerrado; });
        var finales = [], hayRep = false, hayPend = !filas.length, hayComp = false;
        var body = filas.map(function (f) {
          var porP = {}; f.periodos.forEach(function (p) { porP[p.periodoId] = p.nota; });
          var nota = anual ? f.final : (pSel ? porP[pSel.id] : f.final);
          var ap = nota == null ? null : calc.aprobado(nota, esc_), est_ = f.modelo === 'competencias' ? f.estado : null;
          if (est_) { ap = (anual || !pSel) ? f.aprobado : ap; if (est_ === 'Completiva' || est_ === 'Extraordinaria') hayComp = true; }
          if (nota == null) hayPend = true; else { finales.push(nota); if (ap === false && !(est_ === 'Completiva' || est_ === 'Extraordinaria')) hayRep = true; if (est_ === 'Pendiente') hayPend = true; }
          return '<tr><th scope="row" style="text-align:left;font-weight:500">' + esc(asigNombre(f.asignaturaId)) + '</th>' +
            '<td>' + esc(docNombre(f.docenteId)) + '</td>' +
            colsP.map(function (p) { return '<td class="c">' + esc(fmt.nota(porP[p.id], esc_)) + (p.cerrado ? '' : '<sup>*</sup>') + '</td>'; }).join('') +
            (anual ? '<td class="c"><strong>' + esc(fmt.nota(f.final, esc_)) + '</strong></td>' : '') +
            '<td class="c">' + (est_ && (est_ === 'Completiva' || est_ === 'Extraordinaria') && anual ? '<span class="badge warn">' + esc(est_) + ' pendiente</span>' : ap == null ? '<span class="badge neu">Pendiente</span>' : ap ? '<span class="badge ok">Aprobado' + (est_ && f.via && f.via !== 'cf' ? ' (' + esc(f.via) + ')' : '') + '</span>' : '<span class="badge bad">Reprobado</span>') + '</td></tr>';
        }).join('');
        var prom = calc.promedioGeneral(finales), estado = hayRep ? 'Reprobado' : (hayComp ? 'En completiva/extraordinaria' : (hayPend ? 'Pendiente' : 'Aprobado'));
        var provisional = anual && abiertos;
        var asis = d.asistencia.filter(function (a) { return a.estudianteId === est.id; }), aus = asis.filter(function (a) { return a.estado === 'A'; }).length;
        var tr = (esc_.tramos || []).slice().sort(function (a, b) { return a.desde - b.desde; });
        var tramo = prom == null ? null : EDU.escala.tramo(prom, esc_);
        return '<article class="bo-hoja" aria-label="Boletín de ' + esc(fmt.nombreCompleto(est)) + '">' +
          '<header class="bo-enc"><div class="bo-logo" style="background:' + esc(/^#[0-9a-fA-F]{3,8}$/.test(centro.color || '') ? centro.color : '#14315c') + '" aria-hidden="true">' + esc(fmt.iniciales(centro.nombre)) + '</div>' +
          '<div><h2>' + esc(centro.nombre || 'Centro educativo') + '</h2><p>Código ' + esc(centro.codigo || '—') + ' · ' + esc(centro.ciudad || '') + '</p><p>Regional ' + esc(centro.regional || '—') + ' · Distrito ' + esc(centro.distrito || '—') + '</p></div></header>' +
          '<div class="bo-tit">Boletín de calificaciones · ' + esc(anio.nombre || '') + '</div>' +
          '<div class="bo-dat"><div><b>Estudiante:</b> ' + esc(fmt.nombreCompleto(est)) + '</div><div><b>Matrícula:</b> ' + esc(est.matricula || '—') + '</div>' +
          '<div><b>Curso:</b> ' + esc(curso.nombre || '—') + '</div><div><b>Sección / tanda:</b> ' + esc(sec_.nombre) + ' · ' + esc(sec_.tanda || '—') + '</div>' +
          '<div><b>Periodo:</b> ' + esc(anual ? 'Anual' : (pSel ? pSel.nombre : '—')) + '</div><div><b>Fecha de emisión:</b> ' + esc(fmt.fecha(fmt.hoy(), true)) + '</div></div>' +
          (filas.length ? '<div class="tw"><table class="t"><caption class="sr-only">Calificaciones de ' + esc(fmt.nombreCompleto(est)) + '</caption><thead><tr><th scope="col">Asignatura</th><th scope="col">Docente</th>' +
            colsP.map(function (p) { return '<th scope="col" class="c">' + esc(p.nombre) + '<br><small>' + esc(p.peso) + ' %</small></th>'; }).join('') + (anual ? '<th scope="col" class="c">Nota final</th>' : '') + '<th scope="col" class="c">Estado</th></tr></thead><tbody>' + body + '</tbody></table></div>' :
            '<p>No hay asignaturas registradas para este estudiante.</p>') +
          '<div class="bo-res"><span>Promedio general: <b>' + esc(fmt.nota(prom, esc_)) + '</b>' + (tramo ? ' (' + esc(tramo.etiqueta) + ')' : '') + '</span><span>Situación: <b>' + esc(estado) + (provisional && estado !== 'Pendiente' && !hayComp ? ' (provisional)' : '') + '</b></span>' +
          '<span>Asistencia: <b>' + (asis.length ? esc(fmt.pct((asis.length - aus) / asis.length * 100, 0)) : '—') + '</b>' + (asis.length ? ' (' + aus + ' ausencia(s) de ' + asis.length + ' días)' : '') + '</span></div>' +
          '<p class="bo-nota">Escala ' + esc(esc_.min) + '–' + esc(esc_.max) + ' · Nota mínima para aprobar: <strong>' + esc(esc_.notaMinAprobar) + '</strong>. ' + tr.map(function (t) { return esc(t.letra) + ' = ' + esc(t.etiqueta) + ' (≥ ' + esc(t.desde) + ')'; }).join(' · ') + '.' +
          (anual && abiertos ? ' <sup>*</sup> Periodo en curso: nota provisional; la nota final puede variar.' : (!anual && pSel && !pSel.cerrado ? ' <sup>*</sup> Periodo en curso: nota provisional.' : '')) + ' Las notas se calculan con todos los decimales y se muestran redondeadas.</p>' +
          '<div class="bo-firmas"><div>' + esc(centro.director || 'Director/a') + '<br>Director/a del centro</div><div>Docente titular / Secretaría</div><div>Padre, madre o tutor/a</div></div></article>';
      }

      function pintar() {
        var es = estsDe(S.seccionId).filter(function (e) { return S.todos || e.id === S.estId; });
        elDoc.innerHTML = es.length ? es.map(hoja).join('') : '<div class="card">' + ui.vacio({ titulo: 'Sin estudiantes', texto: 'Esta sección no tiene estudiantes matriculados.' }) + '</div>';
      }
      if (pintarSel()) pintar();
    }
  });
})();
