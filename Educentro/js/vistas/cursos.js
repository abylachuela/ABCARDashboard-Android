/* Vista "cursos": cursos, talleres, electivas, refuerzos, modulos tecnicos y virtuales con asignacion de estudiantes.
   Catalogo, ficha (inscritos, lista de espera, asistencia, notas), asignacion individual y masiva, constancia imprimible, CSV, "Mis cursos".
   Reglas de negocio en js/vistas/cursos-logica.js (EDU.cursosLogica). Modelo: docs/API.md seccion "Cursos". */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, L = EDU.cursosLogica;

  (function () {
    if (document.getElementById('edu-css-cursos')) return;
    var s = document.createElement('style'); s.id = 'edu-css-cursos';
    s.textContent = '.cu-filtros{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}.cu-filtros label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.cu-filtros input,.cu-filtros select{min-width:0;max-width:100%}.cu-dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}.cu-dl dt{color:var(--muted)}.cu-dl dd{margin:0;overflow-wrap:anywhere}' +
      '.cu-lista{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;margin:10px 0;border:1px solid var(--line);border-radius:10px;padding:6px;background:var(--soft)}' +
      '.cu-op{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;background:#fff;border:1px solid var(--line);cursor:pointer}.cu-op input{width:18px;height:18px;flex:none}' +
      '.cu-op small{color:var(--muted);display:block}.cu-op.off{opacity:.6;cursor:not-allowed}.cu-op.off small{color:var(--bad)}' +
      '.cu-q{width:100%;padding:8px 10px;border:1px solid var(--field-line);border-radius:8px;background:#fff}.cu-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 12px}' +
      '.cu-hrow{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;padding:8px;border:1px solid var(--line);border-radius:8px}.cu-hrow label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:2px}' +
      '.cu-hrow select,.cu-hrow input{min-width:0;width:auto;max-width:100%}.cu-grados{display:flex;flex-wrap:wrap;gap:6px 14px}.cu-grados label{display:flex;gap:6px;align-items:center;font-size:14px}' +
      '.cu-asis{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)}' +
      '.cu-nota{width:90px}.cu-sec{margin-top:18px}.cu-const{max-width:720px;margin:0 auto;padding:24px;border:2px solid var(--navy);font-family:Georgia,serif;line-height:1.6;color:#000;background:#fff}' +
      '.cu-const h2{text-align:center;font-size:22px;color:#000}.cu-const .cu-firmas{display:flex;justify-content:space-around;gap:20px;margin-top:48px;text-align:center;font-size:13px}.cu-const .cu-firmas span{border-top:1px solid #000;padding-top:4px;min-width:140px}' +
      '@media(max-width:560px){.cu-dl{grid-template-columns:1fr}.cu-const{padding:14px}.cu-nota{width:80px}}' +
      '@media print{body.cu-print .main,body.cu-print dialog{display:none!important}body.cu-print .cu-const{border:2px solid #000;margin:0 auto}}';
    document.head.appendChild(s);
  })();

  function aHtml(x) { return x instanceof EDU.Safe ? x.s : (x == null ? '' : String(x)); }
  function rol() { return EDU.estado.rol(); }
  function ses() { return EDU.estado.sesion(); }
  function pick(l, id) { return L.pick(l, id); }
  function err(e) { ui.toast(e && e.message ? e.message : 'No se pudo completar la acción.', 'error', 7000); }
  function puedeAdmin() { var r = rol(); return EDU.permisos.puede(r, 'cursos', 'crear') && EDU.permisos.puedeEscribirColeccion(r, 'cursosExtra'); }
  function esDueno(c) { return rol() === 'docente' && !!c && c.docenteId === ses().refId; }
  function puedeRegistrar(c) { return esDueno(c) || (EDU.permisos.puede(rol(), 'cursos', 'editar') && rol() !== 'docente' && EDU.permisos.puedeEscribirColeccion(rol(), 'inscripciones')); }
  function esFamilia() { return rol() === 'tutor' || rol() === 'estudiante'; }
  function nomEst(d, id) { var e = pick(d.estudiantes, id); return e ? fmt.nombreCompleto(e) : '(estudiante eliminado)'; }
  function nomDoc(d, id) { var x = pick(d.docentes, id); return x ? fmt.nombreCompleto(x) : '—'; }
  function badgeCurso(c) { return ui.badge(L.etiqueta(L.ESTADOS, c.estado), c.estado === 'abierto' ? 'ok' : c.estado === 'en_curso' ? 'info' : 'neu'); }
  function badgeIns(i) { return ui.badge(L.EST_INS[i.estado] || i.estado, i.estado === 'inscrito' ? 'ok' : i.estado === 'completado' ? 'info' : i.estado === 'en_lista_espera' ? 'warn' : 'neu'); }
  function cupoTxt(c) { return c.inscritos + (c.cupo != null ? ' / ' + c.cupo : '') + (c.espera ? ' (+' + c.espera + ' en espera)' : ''); }
  function load(extra) { return L.cargar(['centros', 'cargas', 'tutores'].concat(extra || [])); }
  function alcance(d) { return EDU.permisos.alcance(ses(), d); }
  function aviso(cont, t, s) { cont.innerHTML = '<a href="#/cursos">← Volver a Cursos</a><div class="card" style="margin-top:12px">' + aHtml(ui.vacio({ titulo: t, texto: s })) + '</div>'; }
  function sorted(l, f) { return l.slice().sort(function (a, b) { return String(f(a)).localeCompare(String(f(b)), 'es'); }); }

  /* ================= CATALOGO ================= */
  function filaCurso(d, c) {
    var n = L.conteo(d, c);
    return { id: c.id, c: c, nombre: c.nombre, codigo: c.codigo || '', tipo: L.etiqueta(L.TIPOS, c.tipo), docente: nomDoc(d, c.docenteId), grados: L.gradosTxt(c), inscritos: n.inscritos, espera: n.espera, cupo: n.cupo, cupoTxt: cupoTxt(n),
      inicio: c.inicio || '', fin: c.fin || '', horario: L.horarioTxt(c), estado: c.estado };
  }

  function tabCatalogo(panel, d, refrescar) {
    var admin = puedeAdmin(), exportar = rol() !== 'tutor' && rol() !== 'estudiante';
    var docs = sorted(d.docentes, fmt.nombreCompleto), grados = {};
    d.cursosExtra.forEach(function (c) { (c.grados || []).forEach(function (g) { grados[g] = 1; }); });
    var barra = '<div class="cu-bar">' + (admin ? '<button type="button" class="btn amb" id="cu-nuevo">Nuevo curso</button>' : '') + (exportar ? '<button type="button" class="btn sec" id="cu-csv">Exportar CSV</button>' : '') + '</div>';
    var f = '<div class="cu-filtros" role="search" aria-label="Filtros del catálogo"><label>Buscar<input type="search" id="cu-q" placeholder="Nombre, código o docente" autocomplete="off"></label>' +
      '<label>Tipo<select id="cu-ft"><option value="">Todos</option>' + aHtml(ui.opciones(L.TIPOS)) + '</select></label>' +
      '<label>Estado<select id="cu-fe"><option value="">Todos</option>' + aHtml(ui.opciones(L.ESTADOS)) + '</select></label>' +
      '<label>Docente<select id="cu-fd"><option value="">Todos</option>' + aHtml(ui.opciones(docs.map(function (x) { return { valor: x.id, texto: fmt.nombreCompleto(x) }; }))) + '</select></label>' +
      '<label>Grado<select id="cu-fg"><option value="">Todos</option>' + aHtml(ui.opciones(Object.keys(grados).sort().map(function (g) { return { valor: g, texto: L.gradoKeyTxt(g) }; }))) + '</select></label></div>';
    var card = ui.el('<div class="card"><h2>Catálogo de cursos</h2>' + barra + f + '<p class="note" id="cu-res" role="status" aria-live="polite"></p><div id="cu-tabla"></div></div>');
    panel.appendChild(card);
    function filtrado() {
      var q = fmt.norm(card.querySelector('#cu-q').value).trim(), t = card.querySelector('#cu-ft').value, e = card.querySelector('#cu-fe').value, dc = card.querySelector('#cu-fd').value, g = card.querySelector('#cu-fg').value;
      return d.cursosExtra.filter(function (c) {
        if (t && c.tipo !== t) return false; if (e && c.estado !== e) return false; if (dc && c.docenteId !== dc) return false;
        if (g && (c.grados || []).length && c.grados.indexOf(g) === -1) return false;
        if (q && fmt.norm(c.nombre + ' ' + (c.codigo || '') + ' ' + nomDoc(d, c.docenteId)).indexOf(q) === -1) return false;
        return true;
      }).map(function (c) { return filaCurso(d, c); });
    }
    var tb = ui.tabla({ etiqueta: 'Catálogo de cursos', buscar: false, porPagina: 10, filas: filtrado(), ordenInicial: 'nombre', vacio: { titulo: 'Sin cursos', texto: 'No hay cursos que coincidan con los filtros.' },
      columnas: [{ clave: 'nombre', titulo: 'Curso', render: function (r) { return '<a href="#/cursos/' + encodeURIComponent(r.id) + '">' + esc(r.nombre) + '</a>' + (r.codigo ? '<br><small>' + esc(r.codigo) + '</small>' : ''); } },
        { clave: 'tipo', titulo: 'Tipo' }, { clave: 'docente', titulo: 'Docente' }, { clave: 'grados', titulo: 'Grados' }, { clave: 'cupoTxt', titulo: 'Inscritos / cupo', valor: function (r) { return r.inscritos; } },
        { clave: 'inicio', titulo: 'Fechas', formato: function (v, r) { return (r.inicio ? fmt.fecha(r.inicio) : '—') + ' → ' + (r.fin ? fmt.fecha(r.fin) : '—'); } },
        { clave: 'estado', titulo: 'Estado', render: function (r) { return aHtml(badgeCurso(r.c)); } }],
      acciones: admin ? [{ texto: 'Editar', alClic: function (r) { editar(d, r.c, refrescar); } },
        { texto: 'Cerrar', tipo: 'dng', visible: function (r) { return r.c.estado !== 'cerrado'; }, alClic: function (r) { cerrarCurso(r.c, refrescar); } }] : [] });
    card.querySelector('#cu-tabla').appendChild(tb.el);
    function aplicar() { var l = filtrado(); tb.actualizar(l); card.querySelector('#cu-res').textContent = fmt.plural(l.length, 'curso') + ' encontrados.'; }
    card.querySelectorAll('.cu-filtros input,.cu-filtros select').forEach(function (x) { x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', aplicar); });
    var bn = card.querySelector('#cu-nuevo'); if (bn) bn.addEventListener('click', function () { editar(d, null, refrescar); });
    var bc = card.querySelector('#cu-csv');
    if (bc) bc.addEventListener('click', function () {
      L.descargar('cursos-' + fmt.hoy() + '.csv', L.aCsv(['Curso', 'Código', 'Tipo', 'Docente', 'Grados', 'Cupo', 'Inscritos', 'En espera', 'Inicio', 'Fin', 'Horario', 'Estado'],
        filtrado().map(function (r) { return [r.nombre, r.codigo, r.tipo, r.docente, r.grados, r.cupo == null ? 'Sin límite' : r.cupo, r.inscritos, r.espera, r.inicio, r.fin, r.horario, L.etiqueta(L.ESTADOS, r.estado)]; })));
      ui.toast('Catálogo exportado.', 'ok');
    });
  }

  /* ================= MIS CURSOS ================= */
  function tabMisCursos(panel, d) {
    var r = rol(), card = ui.el('<div class="card"><h2>Mis cursos</h2><div id="cu-mis"></div></div>');
    panel.appendChild(card);
    var cont = card.querySelector('#cu-mis');
    if (r === 'docente') {
      var mios = d.cursosExtra.filter(esDueno).map(function (c) { return filaCurso(d, c); });
      cont.appendChild(ui.tabla({ etiqueta: 'Cursos que imparto', buscar: false, porPagina: 10, filas: mios, ordenInicial: 'nombre', vacio: { titulo: 'Sin cursos asignados', texto: 'No eres docente responsable de ningún curso o taller.' },
        columnas: [{ clave: 'nombre', titulo: 'Curso', render: function (x) { return '<a href="#/cursos/' + encodeURIComponent(x.id) + '">' + esc(x.nombre) + '</a>'; } }, { clave: 'tipo', titulo: 'Tipo' },
          { clave: 'horario', titulo: 'Horario' }, { clave: 'cupoTxt', titulo: 'Inscritos / cupo' }, { clave: 'estado', titulo: 'Estado', render: function (x) { return aHtml(badgeCurso(x.c)); } }] }).el);
      return;
    }
    var al = alcance(d), filas = d.inscripciones.filter(function (i) { return al.estudianteIds && al.estudianteIds.has(i.estudianteId) && i.estado !== 'retirado'; }).map(function (i) {
      var c = pick(d.cursosExtra, i.cursoId); return c ? { id: i.id, i: i, c: c, est: nomEst(d, i.estudianteId), curso: c.nombre, tipo: L.etiqueta(L.TIPOS, c.tipo), docente: nomDoc(d, c.docenteId), horario: L.horarioTxt(c), asist: L.pctAsistencia(i), nota: i.nota } : null;
    }).filter(Boolean);
    var cols = [{ clave: 'curso', titulo: 'Curso', render: function (x) { return '<a href="#/cursos/' + encodeURIComponent(x.c.id) + '">' + esc(x.curso) + '</a>'; } }, { clave: 'tipo', titulo: 'Tipo' }, { clave: 'docente', titulo: 'Docente' }, { clave: 'horario', titulo: 'Horario' },
      { clave: 'estado', titulo: 'Estado', render: function (x) { return aHtml(badgeIns(x.i)); }, valor: function (x) { return x.i.estado; } },
      { clave: 'asist', titulo: 'Asistencia', align: 'c', formato: function (v) { return v == null ? '—' : fmt.num(v, 1) + '%'; } }, { clave: 'nota', titulo: 'Nota', align: 'c', formato: function (v) { return v == null ? '—' : fmt.num(v, 1); } }];
    if (r === 'tutor') cols.unshift({ clave: 'est', titulo: 'Estudiante' });
    cont.appendChild(ui.tabla({ etiqueta: 'Mis cursos y talleres', buscar: false, porPagina: 10, filas: filas, ordenInicial: 'curso', vacio: { titulo: 'Sin cursos', texto: 'Aún no estás inscrito/a en cursos o talleres.' }, columnas: cols,
      acciones: [{ texto: 'Constancia', visible: function (x) { return x.i.estado === 'inscrito' || x.i.estado === 'completado'; }, alClic: function (x) { constancia(d, x.i); } }] }).el);
  }

  /* ================= EDITAR / CERRAR ================= */
  async function cerrarCurso(c, refrescar) {
    if (!(await ui.confirmar({ titulo: 'Cerrar curso', mensaje: '¿Cerrar «' + c.nombre + '»? Se cancelará la lista de espera y no se aceptarán más inscripciones.', textoOk: 'Cerrar curso', peligro: true }))) return;
    try {
      var d = await L.cargar(), esp = L.insDeCurso(d, c.id).filter(function (i) { return i.estado === 'en_lista_espera'; });
      esp.forEach(function (i) { i.estado = 'retirado'; i.motivoRetiro = 'Curso cerrado'; i.fechaRetiro = fmt.hoy(); i.turno = null; });
      if (esp.length) await EDU.repo.guardarMuchos('inscripciones', esp);
      await EDU.repo.guardar('cursosExtra', Object.assign({}, pick(d.cursosExtra, c.id), { estado: 'cerrado' }));
      ui.toast('Curso cerrado.', 'ok'); refrescar();
    } catch (e) { err(e); }
  }

  function editar(d, curso, refrescar) {
    var nuevo = !curso, c = curso ? JSON.parse(JSON.stringify(curso)) : { tipo: 'taller', estado: 'abierto', grados: [], horario: [] };
    var franjas = L.franjasDe(d), hor = (c.horario || []).map(function (h) { return Object.assign({}, h); });
    var docs = sorted(d.docentes.filter(function (x) { return (x.estado || 'activo') === 'activo'; }), fmt.nombreCompleto);
    var gset = {}; d.cursos.forEach(function (x) { gset[x.nivel + ':' + x.grado] = [x.nivel, x.grado]; });
    var glist = Object.keys(gset).sort(function (a, b) { return a.localeCompare(b, 'es', { numeric: true }); });
    var form = ui.el('<form novalidate><div class="alert red hidden" id="cu-e" role="alert"></div><div class="fgrid">' +
      '<div class="fld"><label for="ce-nombre">Nombre *</label><input id="ce-nombre" maxlength="120" value="' + esc(c.nombre || '') + '" required aria-required="true"></div>' +
      '<div class="fld"><label for="ce-codigo">Código *</label><input id="ce-codigo" maxlength="30" value="' + esc(c.codigo || '') + '" required aria-required="true"></div>' +
      '<div class="fld"><label for="ce-tipo">Tipo *</label><select id="ce-tipo">' + aHtml(ui.opciones(L.TIPOS, c.tipo)) + '</select></div>' +
      '<div class="fld"><label for="ce-doc">Docente responsable *</label><select id="ce-doc"><option value="">Seleccionar…</option>' + aHtml(ui.opciones(docs.map(function (x) { return { valor: x.id, texto: fmt.nombreCompleto(x) }; }), c.docenteId)) + '</select></div>' +
      '<div class="fld"><label for="ce-cupo">Cupo (vacío = sin límite)</label><input id="ce-cupo" inputmode="numeric" value="' + esc(c.cupo == null ? '' : c.cupo) + '"></div>' +
      '<div class="fld"><label for="ce-estado">Estado</label><select id="ce-estado">' + aHtml(ui.opciones(L.ESTADOS, c.estado)) + '</select></div>' +
      '<div class="fld"><label for="ce-ini">Inicio</label><input type="date" id="ce-ini" value="' + esc(c.inicio || '') + '"></div>' +
      '<div class="fld"><label for="ce-fin">Fin</label><input type="date" id="ce-fin" value="' + esc(c.fin || '') + '"></div>' +
      '<div class="fld full"><label for="ce-desc">Descripción</label><textarea id="ce-desc" maxlength="500">' + esc(c.descripcion || '') + '</textarea></div></div>' +
      '<fieldset style="border:0;padding:0;margin:12px 0"><legend><strong>Grados permitidos</strong> <small class="note">(sin marcar = todos)</small></legend><div class="cu-grados">' +
      glist.map(function (k) { return '<label><input type="checkbox" name="ce-g" value="' + esc(k) + '"' + ((c.grados || []).indexOf(k) !== -1 ? ' checked' : '') + '>' + esc(L.gradoKeyTxt(k)) + '</label>'; }).join('') + '</div></fieldset>' +
      '<fieldset style="border:0;padding:0;margin:12px 0"><legend><strong>Horario</strong> <small class="note">' + (franjas.length ? '(días y franjas del centro)' : '(sin franjas configuradas: indica el horario con texto libre)') + '</small></legend><div id="ce-hor"></div>' +
      '<button type="button" class="btn sec sm" id="ce-addh">Agregar día</button></fieldset>' +
      '<div class="form-actions"><button type="button" class="btn sec" id="ce-cancel">Cancelar</button><button type="submit" class="btn amb">' + (nuevo ? 'Crear curso' : 'Guardar cambios') + '</button></div></form>');
    var m = ui.modal({ titulo: nuevo ? 'Nuevo curso' : 'Editar curso', tamano: 'lg', contenido: form });
    var hc = form.querySelector('#ce-hor');
    function pintarH() {
      hc.innerHTML = hor.map(function (h, i) {
        return '<div class="cu-hrow" data-i="' + i + '"><label>Día<select data-k="dia" aria-label="Día de la sesión ' + (i + 1) + '">' + aHtml(ui.opciones(L.DIAS, h.dia)) + '</select></label>' +
          (franjas.length ? '<label>Franja<select data-k="franjaId" aria-label="Franja de la sesión ' + (i + 1) + '"><option value="">Seleccionar…</option>' + aHtml(ui.opciones(franjas.map(function (f) { return { valor: f.id, texto: f.nombre }; }), h.franjaId)) + '</select></label>'
            : '<label>Desde<input type="time" data-k="desde" value="' + esc(h.desde || '') + '" aria-label="Hora de inicio sesión ' + (i + 1) + '"></label><label>Hasta<input type="time" data-k="hasta" value="' + esc(h.hasta || '') + '" aria-label="Hora de fin sesión ' + (i + 1) + '"></label>' +
              '<label>Nota (texto libre)<input data-k="texto" maxlength="60" value="' + esc(h.texto || '') + '" aria-label="Nota de la sesión ' + (i + 1) + '"></label>') +
          '<button type="button" class="btn dng sm" data-del="' + i + '" aria-label="Quitar sesión ' + (i + 1) + '">Quitar</button></div>';
      }).join('') || '<p class="note">Sin horario definido.</p>';
    }
    pintarH();
    hc.addEventListener('change', function (e) {
      var row = e.target.closest('.cu-hrow'); if (!row) return; var h = hor[+row.dataset.i], k = e.target.dataset.k; if (!k) return;
      h[k] = k === 'dia' ? +e.target.value : e.target.value;
      if (k === 'franjaId') { var fr = franjas.filter(function (x) { return x.id === e.target.value; })[0]; h.desde = fr ? fr.desde : ''; h.hasta = fr ? fr.hasta : ''; }
    });
    hc.addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (b) { hor.splice(+b.dataset.del, 1); pintarH(); } });
    form.querySelector('#ce-addh').addEventListener('click', function () { hor.push({ dia: 1, franjaId: '', desde: '', hasta: '', texto: '' }); pintarH(); var s = hc.querySelector('.cu-hrow:last-child select'); if (s) s.focus(); });
    form.querySelector('#ce-cancel').addEventListener('click', function () { m.cerrar(null); });
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var box = form.querySelector('#cu-e'); function fallo(t, id) { box.textContent = t; box.classList.remove('hidden'); var x = form.querySelector('#' + id); if (x) x.focus(); }
      box.classList.add('hidden');
      var v = function (id) { return form.querySelector('#' + id).value.trim(); };
      var nombre = v('ce-nombre'), codigo = v('ce-codigo'), cupoS = v('ce-cupo'), ini = v('ce-ini'), fin = v('ce-fin');
      if (!nombre) return fallo('El nombre es obligatorio.', 'ce-nombre');
      if (!codigo) return fallo('El código es obligatorio.', 'ce-codigo');
      if (!v('ce-doc')) return fallo('Selecciona el docente responsable.', 'ce-doc');
      var cupo = null;
      if (cupoS !== '') { if (!/^\d+$/.test(cupoS) || +cupoS < 1 || +cupoS > 500) return fallo('El cupo debe ser un entero entre 1 y 500.', 'ce-cupo'); cupo = +cupoS; }
      if (ini && !EDU.validacion.esFecha(ini)) return fallo('Fecha de inicio inválida.', 'ce-ini');
      if (fin && !EDU.validacion.esFecha(fin)) return fallo('Fecha de fin inválida.', 'ce-fin');
      if (ini && fin && fin < ini) return fallo('La fecha de fin no puede ser anterior al inicio.', 'ce-fin');
      for (var i = 0; i < hor.length; i++) {
        var h = hor[i];
        if (franjas.length ? !h.franjaId : (!h.desde || !h.hasta || h.desde >= h.hasta)) return fallo('Sesión ' + (i + 1) + ': ' + (franjas.length ? 'selecciona una franja.' : 'indica hora de inicio y fin válidas (inicio antes del fin).'), 'ce-addh');
      }
      var grados = Array.prototype.map.call(form.querySelectorAll('[name=ce-g]:checked'), function (x) { return x.value; });
      try {
        var fresco = await L.cargar(), ex = nuevo ? null : pick(fresco.cursosExtra, c.id);
        if (!nuevo && !ex) throw new Error('El curso ya no existe.');
        if (fresco.cursosExtra.some(function (x) { return x.id !== c.id && String(x.codigo || '').toLowerCase() === codigo.toLowerCase(); })) return fallo('Ya existe otro curso con ese código.', 'ce-codigo');
        if (ex && cupo != null && L.conteo(fresco, ex).inscritos > cupo) return fallo('El cupo no puede ser menor que los ' + L.conteo(fresco, ex).inscritos + ' inscritos actuales.', 'ce-cupo');
        var s = ses(), reg = Object.assign({}, ex || {}, { centroId: ex ? ex.centroId : (s.centroActivo || s.centroUsuario), nombre: nombre, codigo: codigo, tipo: v('ce-tipo'), docenteId: v('ce-doc'), cupo: cupo, estado: v('ce-estado'),
          inicio: ini || '', fin: fin || '', descripcion: v('ce-desc'), grados: grados, horario: hor.map(function (h) { return { dia: +h.dia, franjaId: h.franjaId || null, desde: h.desde || '', hasta: h.hasta || '', texto: h.texto || '' }; }) });
        var gs = await EDU.repo.guardar('cursosExtra', reg);
        var prom = await L.promover(gs.id);
        ui.toast((nuevo ? 'Curso creado.' : 'Curso actualizado.') + (prom.length ? ' ' + fmt.plural(prom.length, 'estudiante promovido', 'estudiantes promovidos') + ' desde la lista de espera.' : ''), 'ok');
        m.cerrar(true); refrescar();
      } catch (e) { fallo(e.message || 'No se pudo guardar.', 'ce-nombre'); }
    });
  }

  /* ================= CONSTANCIA ================= */
  function constanciaHtml(d, i) {
    var c = pick(d.cursosExtra, i.cursoId), e = pick(d.estudiantes, i.estudianteId), cen = pick(d.centros, c.centroId) || {}, a = L.pctAsistencia(i), g = L.gradoDe(d, i.estudianteId);
    var fin = i.estado === 'completado';
    return '<article class="cu-const" aria-label="Constancia de participación"><h2>Constancia de participación</h2><p style="text-align:center;margin:0 0 18px"><strong>' + esc(cen.nombre || 'Centro educativo') + '</strong>' + (cen.codigo ? '<br>Código ' + esc(cen.codigo) : '') + '</p>' +
      '<p>' + esc(cen.nombre || 'El centro educativo') + ' hace constar que <strong>' + esc(e ? fmt.nombreCompleto(e) : '') + '</strong>' + (e && e.matricula ? ' (matrícula ' + esc(e.matricula) + ')' : '') + (g ? ', estudiante de ' + esc(g.label) + ',' : '') +
      (fin ? ' completó' : ' participa en') + ' el ' + esc(L.etiqueta(L.TIPOS, c.tipo).toLowerCase()) + ' <strong>«' + esc(c.nombre) + '»</strong> (' + esc(c.codigo || 's/c') + '), a cargo de ' + esc(nomDoc(d, c.docenteId)) +
      (c.inicio || c.fin ? ', ' + (c.inicio ? 'desde el ' + esc(fmt.fecha(c.inicio, true)) : '') + (c.fin ? ' hasta el ' + esc(fmt.fecha(c.fin, true)) : '') : '') + '. Horario: ' + esc(L.horarioTxt(c)) + '.</p>' +
      '<p>' + (a != null ? 'Asistencia registrada: <strong>' + esc(fmt.num(a, 1)) + '%</strong>. ' : '') + (i.nota != null && i.nota !== '' ? 'Calificación final: <strong>' + esc(fmt.num(i.nota, 1)) + '</strong>. ' : '') + 'Estado: <strong>' + esc(L.EST_INS[i.estado] || i.estado) + '</strong>.</p>' +
      '<p>Se expide la presente en ' + esc(cen.ciudad || '________') + ', el ' + esc(fmt.fecha(fmt.hoy(), true)) + '.</p><div class="cu-firmas"><span>Docente responsable</span><span>Dirección del centro</span></div></article>';
  }
  function constancia(d, i) {
    var m = ui.modal({ titulo: 'Constancia de participación', tamano: 'lg', contenido: ui.el('<div>' + constanciaHtml(d, i) + '</div>'),
      botones: [{ texto: 'Cerrar', tipo: 'sec', valor: null }, { texto: 'Imprimir', tipo: 'amb', alClic: function (cerrar) {
        cerrar(true);
        var blk = document.createElement('section'); blk.className = 'print-only'; blk.innerHTML = constanciaHtml(d, i);
        document.body.appendChild(blk); document.body.classList.add('cu-print');
        try { window.print(); } finally { document.body.classList.remove('cu-print'); blk.remove(); }
      } }] });
    return m;
  }

  /* ================= ASIGNACION ================= */
  function informe(res, d) {
    var ok = res.filter(function (r) { return r.ok; }), ins = ok.filter(function (r) { return r.estado === 'inscrito'; }).length, esp = ok.length - ins, mal = res.filter(function (r) { return !r.ok; });
    if (ok.length) ui.toast(fmt.plural(ins, 'estudiante inscrito', 'estudiantes inscritos') + (esp ? ' y ' + esp + ' en lista de espera (cupo lleno)' : '') + '.', esp ? 'warn' : 'ok', 6000);
    if (mal.length) ui.toast(fmt.plural(mal.length, 'estudiante rechazado', 'estudiantes rechazados') + ': ' + mal.slice(0, 3).map(function (r) { return r.error; }).join(' · ') + (mal.length > 3 ? ' …' : ''), 'error', 9000);
    return ok.length;
  }
  function candidatos(d, curso) {
    return sorted(d.estudiantes.filter(function (e) { return (e.estado || 'activo') === 'activo'; }), fmt.nombreCompleto);
  }

  function asignarModal(d, curso, masiva, refrescar) {
    var n = L.conteo(d, curso), cand = candidatos(d, curso), marc = new Set(), q = '', secF = '', graF = '';
    var secs = d.secciones.filter(function (s) { return d.matriculas.some(function (m) { return m.seccionId === s.id && m.estado === 'activa'; }); });
    var gset = {}; secs.forEach(function (s) { var c = pick(d.cursos, s.cursoId); if (c) gset[c.nivel + ':' + c.grado] = 1; });
    var nota = 'Cupo: ' + n.inscritos + (n.cupo != null ? ' / ' + n.cupo : '') + ' · ' + (n.cupo == null ? 'sin límite' : n.libres + ' libres. Si se llena, los siguientes pasan a la lista de espera.');
    var cont = ui.el('<div><p class="note" role="status">' + esc(nota) + '</p>' +
      (masiva ? '<div class="cu-filtros"><label>Grado<select id="am-g"><option value="">Todos</option>' + aHtml(ui.opciones(Object.keys(gset).sort().map(function (g) { return { valor: g, texto: L.gradoKeyTxt(g) }; }))) + '</select></label>' +
        '<label>Sección<select id="am-s"><option value="">Todas</option></select></label></div>' : '') +
      '<label class="sr-only" for="am-q">Buscar estudiante</label><input class="cu-q" id="am-q" type="search" placeholder="Buscar por nombre o código…" autocomplete="off"><div class="cu-lista" id="am-l" role="group" aria-label="Estudiantes"></div>' +
      '<p class="note" id="am-c" role="status" aria-live="polite"></p>' + (masiva ? '<div class="cu-bar"><button type="button" class="btn sec sm" id="am-todos">Marcar visibles elegibles</button><button type="button" class="btn sec sm" id="am-nada">Quitar marcas</button></div>' : '') + '</div>');
    var m = ui.modal({ titulo: (masiva ? 'Inscripción masiva en ' : 'Inscribir en ') + curso.nombre, tamano: 'lg', contenido: cont, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null },
      { texto: masiva ? 'Inscribir seleccionados' : 'Inscribir', tipo: 'amb', alClic: async function (cerrar) {
        if (!marc.size) { ui.toast('Selecciona al menos un estudiante.', 'warn'); return; }
        try { var res = await L.asignar(curso.id, Array.from(marc)); informe(res, d); if (res.some(function (r) { return r.ok; })) { cerrar(true); refrescar(); } else pintar(); } catch (e) { err(e); }
      } }] });
    var lista = cont.querySelector('#am-l'), cnt = cont.querySelector('#am-c');
    function enSec(e) {
      if (!secF && !graF) return true;
      var g = L.gradoDe(d, e.id); if (!g) return false;
      return (!secF || g.seccionId === secF) && (!graF || g.key === graF);
    }
    function visibles() { var nq = fmt.norm(q).trim(); return cand.filter(function (e) { return enSec(e) && (!nq || fmt.norm(fmt.nombreCompleto(e) + ' ' + (e.matricula || '')).indexOf(nq) !== -1); }).slice(0, 80); }
    function pintar() {
      var v = visibles(), tipo = masiva ? 'checkbox' : 'radio';
      lista.innerHTML = v.length ? v.map(function (e) {
        var er = L.validarEstudiante(d, curso, e), g = L.gradoDe(d, e.id);
        return '<label class="cu-op' + (er ? ' off' : '') + '"><input type="' + tipo + '" name="am-e" value="' + esc(e.id) + '"' + (er ? ' disabled' : '') + (marc.has(e.id) ? ' checked' : '') + '><span>' + esc(fmt.nombreCompleto(e)) +
          '<small>' + esc((e.matricula || '') + (g ? ' · ' + g.label : ' · sin matrícula activa')) + '</small>' + (er ? '<small>' + esc(er) + '</small>' : '') + '</span></label>';
      }).join('') : '<p class="note" style="padding:8px">Sin coincidencias.</p>';
      cnt.textContent = marc.size + ' seleccionados.';
    }
    lista.addEventListener('change', function (e) { if (!masiva) marc.clear(); if (e.target.checked) marc.add(e.target.value); else marc.delete(e.target.value); cnt.textContent = marc.size + ' seleccionados.'; });
    cont.querySelector('#am-q').addEventListener('input', function (e) { q = e.target.value; pintar(); });
    if (masiva) {
      var sg = cont.querySelector('#am-g'), ss = cont.querySelector('#am-s');
      function opsSec() { ss.innerHTML = '<option value="">Todas</option>' + aHtml(ui.opciones(secs.filter(function (s) { var c = pick(d.cursos, s.cursoId); return !graF || (c && c.nivel + ':' + c.grado === graF); }).map(function (s) { var c = pick(d.cursos, s.cursoId); return { valor: s.id, texto: (c ? c.grado + '.º ' + c.nivel + ' ' : '') + s.nombre }; }), secF)); }
      opsSec();
      sg.addEventListener('change', function () { graF = sg.value; secF = ''; opsSec(); pintar(); });
      ss.addEventListener('change', function () { secF = ss.value; pintar(); });
      cont.querySelector('#am-todos').addEventListener('click', function () { visibles().forEach(function (e) { if (!L.validarEstudiante(d, curso, e)) marc.add(e.id); }); pintar(); });
      cont.querySelector('#am-nada').addEventListener('click', function () { marc.clear(); pintar(); });
    }
    pintar();
  }

  /* ================= FICHA ================= */
  var tabPrev = {};
  function dl(pares) { return '<dl class="cu-dl">' + pares.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1] == null || p[1] === '' ? '—' : p[1])) + '</dd>'; }).join('') + '</dl>'; }

  function filaIns(d, i) {
    var g = L.gradoDe(d, i.estudianteId), e = pick(d.estudiantes, i.estudianteId);
    return { id: i.id, i: i, nombre: nomEst(d, i.estudianteId), codigo: e ? e.matricula || '' : '', grado: g ? g.label : '—', fecha: i.fecha || '', estado: i.estado, asist: L.pctAsistencia(i), nota: i.nota };
  }

  EDU.router.register('cursos/:id', {
    titulo: 'Ficha del curso',
    render: async function (cont, params) {
      var d = await load(), c = pick(d.cursosExtra, params.id), r = rol();
      if (!c) return aviso(cont, 'Curso no encontrado', 'No existe un curso con ese identificador en el centro activo.');
      var fam = esFamilia(), al = alcance(d);
      var misIns = fam ? L.insDeCurso(d, c.id).filter(function (i) { return al.estudianteIds && al.estudianteIds.has(i.estudianteId); }) : null;
      if (fam && !misIns.length) return aviso(cont, 'Acceso denegado', 'Solo puedes consultar los cursos en los que tú o tus estudiantes a cargo están inscritos.');
      var admin = puedeAdmin(), reg = puedeRegistrar(c), verLista = !fam && (admin || reg || r === 'admin_red'), n = L.conteo(d, c), abierto = c.estado !== 'cerrado';
      var refrescar = function () { EDU.router.recargar(); };
      var acc = (admin ? '<button type="button" class="btn sec" id="cu-ed">Editar</button>' + (abierto ? '<button type="button" class="btn dng" id="cu-ce">Cerrar curso</button>' : '') : '') + (verLista ? '<button type="button" class="btn sec" id="cu-csv">Exportar CSV</button>' : '');
      cont.innerHTML = '<a href="#/cursos">← Volver a Cursos</a>' + aHtml(ui.cabecera({ eyebrow: L.etiqueta(L.TIPOS, c.tipo) + (c.codigo ? ' · ' + c.codigo : ''), titulo: c.nombre, descripcion: c.descripcion || '', acciones: raw(acc) })) +
        '<div class="grid two"><section class="card" aria-labelledby="cu-h-d"><h2 id="cu-h-d">Datos del curso</h2>' + dl([['Estado', aHtml(badgeCurso(c)), true], ['Docente responsable', nomDoc(d, c.docenteId)], ['Grados permitidos', L.gradosTxt(c)],
          ['Fechas', (c.inicio ? fmt.fecha(c.inicio) : '—') + ' → ' + (c.fin ? fmt.fecha(c.fin) : '—')], ['Horario', L.horarioTxt(c)],
          ['Cupo', n.cupo == null ? 'Sin límite' : n.cupo]].concat(c.tipo === 'virtual' ? [['Aula virtual', '<a href="#/aula">Ir al aula virtual</a>', true]] : [])) + '</section>' +
        (verLista ? '<section class="card" aria-labelledby="cu-h-c"><h2 id="cu-h-c">Ocupación</h2>' + aHtml(ui.progreso({ etiqueta: 'Cupo', valor: n.cupo ? n.inscritos / n.cupo * 100 : 0, texto: n.inscritos + (n.cupo != null ? ' / ' + n.cupo : '') })) +
          '<p class="note">' + (n.cupo == null ? 'Sin límite de cupo' : n.libres + ' lugares libres') + ' · ' + fmt.plural(n.espera, 'estudiante') + ' en lista de espera.</p></section>' : '') + '</div><div class="cu-sec" id="cu-tabs"></div>';
      var b;
      if ((b = cont.querySelector('#cu-ed'))) b.addEventListener('click', function () { editar(d, c, refrescar); });
      if ((b = cont.querySelector('#cu-ce'))) b.addEventListener('click', function () { cerrarCurso(c, refrescar); });
      if ((b = cont.querySelector('#cu-csv'))) b.addEventListener('click', function () {
        L.descargar('curso-' + (c.codigo || c.id) + '-' + fmt.hoy() + '.csv', L.aCsv(['Estudiante', 'Matrícula', 'Grado', 'Estado', 'Fecha', 'Asistencia %', 'Nota'],
          L.insDeCurso(d, c.id).map(function (i) { return filaIns(d, i); }).map(function (x) { return [x.nombre, x.codigo, x.grado, L.EST_INS[x.estado], x.fecha, x.asist == null ? '' : x.asist, x.nota == null ? '' : x.nota]; })));
        ui.toast('Lista exportada.', 'ok');
      });
      var host = cont.querySelector('#cu-tabs');
      function tablaIns(panel, filas, conAcc) {
        var puedeA = admin && abierto;
        panel.appendChild(ui.tabla({ etiqueta: 'Estudiantes del curso', buscar: true, porPagina: 15, filas: filas, ordenInicial: 'nombre', vacio: { titulo: 'Sin inscritos', texto: 'Este curso aún no tiene estudiantes.' },
          columnas: [{ clave: 'nombre', titulo: 'Estudiante', render: function (x) { return fam ? esc(x.nombre) : '<a href="#/personas/' + encodeURIComponent(x.i.estudianteId) + '">' + esc(x.nombre) + '</a>'; } }, { clave: 'grado', titulo: 'Grado' },
            { clave: 'fecha', titulo: 'Inscrito', formato: function (v) { return v ? fmt.fecha(v) : '—'; } }, { clave: 'estado', titulo: 'Estado', render: function (x) { return aHtml(badgeIns(x.i)); } },
            { clave: 'asist', titulo: 'Asistencia', align: 'c', formato: function (v) { return v == null ? '—' : fmt.num(v, 1) + '%'; } }, { clave: 'nota', titulo: 'Nota', align: 'c', formato: function (v) { return v == null || v === '' ? '—' : fmt.num(v, 1); } }],
          acciones: [{ texto: 'Constancia', visible: function (x) { return x.estado === 'inscrito' || x.estado === 'completado'; }, alClic: function (x) { constancia(d, x.i); } }].concat(conAcc ? [
            { texto: 'Retirar', tipo: 'dng', visible: function (x) { return admin && (x.estado === 'inscrito' || x.estado === 'en_lista_espera'); }, alClic: function (x) { retirarIns(x); } },
            { texto: 'Reinscribir', visible: function (x) { return puedeA && x.estado === 'retirado'; }, alClic: async function (x) {
              try { var est = await L.reinscribir(x.id); ui.toast(est === 'inscrito' ? 'Estudiante reinscrito.' : 'Cupo lleno: quedó en la lista de espera.', est === 'inscrito' ? 'ok' : 'warn'); refrescar(); } catch (e) { err(e); } } }] : []) }).el);
      }
      async function retirarIns(x) {
        var v = await ui.formularioModal({ titulo: 'Retirar a ' + x.nombre, textoEnviar: 'Retirar', campos: [{ nombre: 'motivo', label: 'Motivo', tipo: 'select', requerido: true, opciones: ['Solicitud del estudiante', 'Inasistencia', 'Conflicto de horario', 'Razones de salud', 'Otro'] }] });
        if (!v) return;
        try { var prom = await L.retirar(x.id, v.motivo); ui.toast(x.nombre + ' fue retirado/a.' + (prom.length ? ' Promovido/a desde la lista de espera: ' + prom.map(function (p) { return p.estudiante ? fmt.nombreCompleto(p.estudiante) : ''; }).join(', ') + '.' : ''), 'ok', 7000); refrescar(); } catch (e) { err(e); }
      }
      var tabs = [];
      if (fam) tabs.push({ id: 'ins', titulo: 'Mi inscripción', render: function (p) { tablaIns(p, misIns.map(function (i) { return filaIns(d, i); }), false); } });
      else if (verLista) {
        tabs.push({ id: 'ins', titulo: 'Inscritos', render: function (p) {
          if (admin && abierto) { var bar = ui.el('<div class="cu-bar"><button type="button" class="btn amb" id="cu-i1">Inscribir estudiante</button><button type="button" class="btn sec" id="cu-im">Inscripción masiva</button></div>'); p.appendChild(bar);
            bar.querySelector('#cu-i1').addEventListener('click', function () { asignarModal(d, c, false, refrescar); }); bar.querySelector('#cu-im').addEventListener('click', function () { asignarModal(d, c, true, refrescar); }); }
          tablaIns(p, L.insDeCurso(d, c.id).filter(function (i) { return i.estado !== 'en_lista_espera'; }).map(function (i) { return filaIns(d, i); }), true); } });
        tabs.push({ id: 'esp', titulo: 'Lista de espera (' + n.espera + ')', render: function (p) {
          var l = L.insDeCurso(d, c.id).filter(function (i) { return i.estado === 'en_lista_espera'; }).sort(function (a, b2) { return (a.turno || 0) - (b2.turno || 0); }), pos = {}; l.forEach(function (i, k) { pos[i.id] = k + 1; });
          if (!l.length) { p.innerHTML = '<div class="card">' + aHtml(ui.vacio({ titulo: 'Sin lista de espera', texto: 'Cuando se llene el cupo, los siguientes estudiantes quedarán aquí y serán promovidos automáticamente al liberarse un lugar.' })) + '</div>'; return; }
          p.appendChild(ui.tabla({ etiqueta: 'Lista de espera', buscar: false, porPagina: false, filas: l.map(function (i) { var x = filaIns(d, i); x.pos = pos[i.id]; return x; }), ordenInicial: 'pos',
            columnas: [{ clave: 'pos', titulo: 'Posición', align: 'c' }, { clave: 'nombre', titulo: 'Estudiante' }, { clave: 'grado', titulo: 'Grado' }, { clave: 'fecha', titulo: 'Desde', formato: function (v) { return v ? fmt.fecha(v) : '—'; } }],
            acciones: admin ? [{ texto: 'Retirar', tipo: 'dng', alClic: function (x) { retirarIns(x); } }] : [] }).el); } });
        if (reg) {
          tabs.push({ id: 'asis', titulo: 'Asistencia', render: function (p) { panelAsistencia(p, d, c, refrescar); } });
          tabs.push({ id: 'notas', titulo: 'Notas y cierre', render: function (p) { panelNotas(p, d, c, refrescar); } });
        }
      }
      if (!tabs.length) { host.innerHTML = '<div class="card"><p class="note">La lista de inscritos solo la ve el docente responsable y el personal administrativo.</p></div>'; return; }
      var t = ui.tabs({ tabs: tabs, activa: tabPrev[c.id], etiqueta: 'Secciones del curso', siempre: true, alCambiar: function (id) { tabPrev[c.id] = id; } });
      host.appendChild(t.el);
    }
  });

  /* ---------- asistencia ---------- */
  function panelAsistencia(panel, d, c, refrescar) {
    var ins = sorted(L.insDeCurso(d, c.id).filter(function (i) { return i.estado === 'inscrito'; }), function (i) { return nomEst(d, i.estudianteId); });
    var card = ui.el('<div class="card"><h2>Asistencia</h2><p class="note">Registra la asistencia de cada sesión. P presente, A ausente, T tardanza, J justificada.</p></div>'); panel.appendChild(card);
    if (!ins.length) { card.appendChild(ui.el('<p class="note">No hay estudiantes inscritos.</p>')); return; }
    var ops = [{ valor: 'P', texto: 'P · Presente' }, { valor: 'A', texto: 'A · Ausente' }, { valor: 'T', texto: 'T · Tardanza' }, { valor: 'J', texto: 'J · Justificada' }];
    card.appendChild(ui.el('<div class="fld" style="max-width:240px"><label for="as-f">Fecha de la sesión</label><input type="date" id="as-f" value="' + esc(fmt.hoy()) + '"></div>'));
    var lista = ui.el('<div id="as-l"></div>'), msg = ui.el('<p class="alert red hidden" id="as-e" role="alert"></p>'), bt = ui.el('<button type="button" class="btn amb" style="margin-top:12px">Guardar asistencia</button>');
    card.appendChild(lista); card.appendChild(msg); card.appendChild(bt);
    var inp = card.querySelector('#as-f');
    function pintar() {
      lista.innerHTML = ins.map(function (i, k) { var ex = (i.asistencia || []).filter(function (a) { return a.fecha === inp.value; })[0];
        return '<div class="cu-asis"><span id="as-n' + k + '">' + esc(nomEst(d, i.estudianteId)) + '</span><select data-i="' + esc(i.id) + '" aria-labelledby="as-n' + k + '">' + aHtml(ui.opciones(ops, ex ? ex.estado : 'P')) + '</select></div>'; }).join('');
    }
    inp.addEventListener('change', pintar); pintar();
    bt.addEventListener('click', async function () {
      msg.classList.add('hidden');
      if (!EDU.validacion.esFecha(inp.value)) { msg.textContent = 'Indica una fecha válida.'; msg.classList.remove('hidden'); return; }
      try {
        var fresco = await EDU.repo.listar('inscripciones', { filtro: { cursoId: c.id } }), out = [];
        lista.querySelectorAll('select').forEach(function (s) {
          var i = pick(fresco, s.dataset.i); if (!i || i.estado !== 'inscrito') return;
          i.asistencia = (i.asistencia || []).filter(function (a) { return a.fecha !== inp.value; }).concat([{ fecha: inp.value, estado: s.value }]).sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
          out.push(i);
        });
        await EDU.repo.guardarMuchos('inscripciones', out); ui.toast('Asistencia del ' + fmt.fecha(inp.value) + ' guardada.', 'ok'); refrescar();
      } catch (e) { err(e); }
    });
  }

  /* ---------- notas y estado final ---------- */
  function panelNotas(panel, d, c, refrescar) {
    var ins = sorted(L.insDeCurso(d, c.id).filter(function (i) { return i.estado === 'inscrito' || i.estado === 'completado'; }), function (i) { return nomEst(d, i.estudianteId); });
    var card = ui.el('<div class="card"><h2>Notas y estado final</h2><p class="note">Nota de 0 a 100 (opcional). Marca «Completado» cuando el estudiante termine el curso; se podrá emitir su constancia.</p></div>'); panel.appendChild(card);
    if (!ins.length) { card.appendChild(ui.el('<p class="note">No hay estudiantes inscritos.</p>')); return; }
    var lista = ui.el('<div>' + ins.map(function (i, k) {
      return '<div class="cu-asis"><span id="nt-n' + k + '">' + esc(nomEst(d, i.estudianteId)) + ' <small class="note">Asistencia: ' + esc(L.pctAsistencia(i) == null ? '—' : fmt.num(L.pctAsistencia(i), 1) + '%') + '</small></span><span>' +
        '<label class="sr-only" for="nt-v' + k + '">Nota de ' + esc(nomEst(d, i.estudianteId)) + '</label><input class="cu-nota" id="nt-v' + k + '" data-i="' + esc(i.id) + '" inputmode="decimal" placeholder="Nota" value="' + esc(i.nota == null ? '' : i.nota) + '"> ' +
        '<label><input type="checkbox" data-c="' + esc(i.id) + '"' + (i.estado === 'completado' ? ' checked' : '') + '> Completado</label></span></div>'; }).join('') + '</div>');
    var msg = ui.el('<p class="alert red hidden" role="alert"></p>'), bt = ui.el('<button type="button" class="btn amb" style="margin-top:12px">Guardar notas</button>');
    card.appendChild(lista); card.appendChild(msg); card.appendChild(bt);
    bt.addEventListener('click', async function () {
      msg.classList.add('hidden'); var cambios = [];
      for (var k = 0; k < ins.length; k++) {
        var inp = lista.querySelector('#nt-v' + k), raw = inp.value.trim().replace(',', '.'), v = null;
        if (raw !== '') { v = Number(raw); if (!isFinite(v) || v < 0 || v > 100) { msg.textContent = 'La nota de ' + nomEst(d, ins[k].estudianteId) + ' debe estar entre 0 y 100.'; msg.classList.remove('hidden'); inp.focus(); return; } }
        cambios.push({ id: inp.dataset.i, nota: v, completado: lista.querySelector('[data-c="' + inp.dataset.i + '"]').checked });
      }
      try {
        var fresco = await EDU.repo.listar('inscripciones', { filtro: { cursoId: c.id } }), out = [];
        cambios.forEach(function (x) { var i = pick(fresco, x.id); if (!i || (i.estado !== 'inscrito' && i.estado !== 'completado')) return; i.nota = x.nota; i.estado = x.completado ? 'completado' : 'inscrito'; i.fechaCierre = x.completado ? fmt.hoy() : null; out.push(i); });
        await EDU.repo.guardarMuchos('inscripciones', out); ui.toast('Notas y estados guardados.', 'ok'); refrescar();
      } catch (e) { err(e); }
    });
  }

  function raw(h) { return EDU.raw(h); }

  /* ================= VISTA PRINCIPAL ================= */
  EDU.router.register('cursos', {
    titulo: 'Cursos y talleres',
    render: async function (cont) {
      var d = await load(), r = rol(), fam = esFamilia();
      var desc = fam ? 'Cursos, talleres y electivas en los que participas.' : r === 'docente' ? 'Tus cursos y el catálogo del centro.' : 'Cursos, talleres, electivas, refuerzos y módulos con asignación de estudiantes.';
      cont.innerHTML = aHtml(ui.cabecera({ eyebrow: 'Gestión académica', titulo: fam ? 'Mis cursos' : 'Cursos y talleres', descripcion: desc }));
      var refrescar = function () { EDU.router.recargar(); };
      if (fam) { var p = document.createElement('div'); cont.appendChild(p); tabMisCursos(p, d); return; }
      if (!d.cursosExtra.length && !puedeAdmin() && r !== 'docente') { cont.insertAdjacentHTML('beforeend', '<div class="card">' + aHtml(ui.vacio({ titulo: 'Sin cursos', texto: 'No hay cursos registrados en el centro activo.' })) + '</div>'); return; }
      var ab = d.cursosExtra.filter(function (c) { return c.estado !== 'cerrado'; }), tot = d.cursosExtra.map(function (c) { return L.conteo(d, c); });
      cont.insertAdjacentHTML('beforeend', aHtml(ui.kpis([{ etiqueta: 'Cursos', valor: d.cursosExtra.length, detalle: ab.length + ' activos' }, { etiqueta: 'Inscritos', valor: tot.reduce(function (a, x) { return a + x.inscritos; }, 0) },
        { etiqueta: 'En lista de espera', valor: tot.reduce(function (a, x) { return a + x.espera; }, 0) }])));
      var tabs = [{ id: 'cat', titulo: 'Catálogo', render: function (p) { tabCatalogo(p, d, refrescar); } }];
      if (r === 'docente') tabs.unshift({ id: 'mis', titulo: 'Mis cursos', render: function (p) { tabMisCursos(p, d); } });
      var t = ui.tabs({ tabs: tabs, etiqueta: 'Vistas de cursos', siempre: true }); cont.appendChild(t.el);
    }
  });
})();
