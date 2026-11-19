/* Vista "libro-notas" (Calificaciones): grilla editable estudiantes x actividades con promedio ponderado en vivo (EDU.calculo),
   categorias con peso 100 %, actividades, indicadores aprobado/reprobado, cierre/reapertura de periodo con auditoria.
   Las notas se guardan SIN redondear; solo se redondea al mostrar. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, raw = EDU.raw, calc = EDU.calculo;
  var COLS = ['cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'periodos', 'categorias', 'actividades', 'calificaciones', 'matriculas', 'estudiantes', 'escalas', 'tutores'];

  var CSS = '.ln-bar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.ln-bar label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:500}' +
    '.ln-acc{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0}.ln-wrap{overflow:auto;max-height:70vh}.ln-grid{min-width:0;width:max-content;max-width:none}' +
    '.ln-grid th,.ln-grid td{padding:6px 8px;white-space:nowrap}.ln-grid thead th{position:sticky;top:0;z-index:2}.ln-grid th.ln-est{position:sticky;left:0;z-index:1;background:var(--soft);text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);font-weight:500;text-align:left}' +
    '.ln-grid thead th.ln-est{z-index:3}.ln-in{width:72px;padding:6px;border:1px solid var(--field-line);border-radius:6px;text-align:center;background:#fff}.ln-in[aria-invalid=true]{border-color:var(--bad);background:var(--bad-bg)}' +
    '.ln-in.sucio{border-color:var(--amber);box-shadow:0 0 0 2px var(--amber-soft)}.ln-ah{all:unset;cursor:pointer;display:block;font-weight:600;color:var(--navy);text-transform:none;letter-spacing:0;font-size:13px;text-align:center}' +
    '.ln-grid th .ln-ah:hover{text-decoration:underline}.ln-ah:focus-visible{outline:3px solid var(--amber)}.ln-sub{display:block;font-weight:400;color:var(--muted);font-size:11.5px;text-transform:none;letter-spacing:0}' +
    '.ln-pes{display:flex;gap:8px;align-items:center;margin-bottom:8px}.ln-pes input{width:90px}.ln-tot{font-weight:700}.ln-tot.bad{color:var(--bad)}.ln-tot.ok{color:var(--ok)}';

  function estilo() {
    if (document.getElementById('ln-css')) return;
    var s = document.createElement('style'); s.id = 'ln-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function r2(n) { return n == null ? '—' : String(calc.redondear(n, 2)); }
  function cmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function ahora() { return new Date().toISOString(); }

  EDU.router.register('libro-notas', {
    titulo: 'Calificaciones',
    render: async function (cont, params) {
      estilo();
      var ses = EDU.estado.sesion(), rol = ses.rol;
      var esDir = rol === 'director', esDoc = rol === 'docente';
      var puedeCerrar = EDU.permisos.puede(rol, 'libro-notas', 'cerrar');
      var d = await EDU.consultas.cargar(COLS);
      var S = { carga: null, periodoId: null, dirty: {}, invalidos: {}, modoEd: false, motivoEd: null };
      var vivo = true;

      cont.innerHTML = ui.cabecera({ eyebrow: 'Registro académico', titulo: 'Calificaciones',
        descripcion: 'Elige sección, asignatura y periodo. El promedio ponderado se recalcula al instante; las notas se guardan sin redondear.' }).toString() +
        '<div class="card"><div class="ln-bar" id="ln-sel"></div></div><div id="ln-panel" style="margin-top:16px"></div>';
      var elSel = cont.querySelector('#ln-sel'), elPanel = cont.querySelector('#ln-panel');

      /* ---------- datos derivados ---------- */
      function alcance() { return EDU.permisos.alcance(EDU.estado.sesion(), d); }
      function cargasVisibles() { return EDU.permisos.filtrar(alcance(), 'cargas', d.cargas); }
      function sec(id) { return d.secciones.filter(function (x) { return x.id === id; })[0]; }
      function etiquetaSec(s) { var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0]; return (c ? c.nombre : '') + ' · Sección ' + s.nombre; }
      function asig(id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? a.nombre : id; }
      function per(id) { return d.periodos.filter(function (x) { return x.id === id; })[0]; }
      function periodosDe(carga) { return d.periodos.filter(function (p) { return p.anioId === carga.anioId; }).sort(function (a, b) { return a.orden - b.orden; }); }
      function escala() { return EDU.consultas.escalaDe(d.escalas, S.carga.centroId); }
      function cats() { return d.categorias.filter(function (c) { return c.cargaId === S.carga.id; }); }
      function actsCarga() { return d.actividades.filter(function (a) { return a.cargaId === S.carga.id; }); }
      function actsPeriodo() {
        var cs = cats();
        return actsCarga().filter(function (a) { return a.periodoId === S.periodoId; }).sort(function (a, b) {
          var ia = cs.findIndex(function (c) { return c.id === a.categoriaId; }), ib = cs.findIndex(function (c) { return c.id === b.categoriaId; });
          return ia - ib || cmp(a.fecha || '', b.fecha || '') || cmp(a.nombre, b.nombre);
        });
      }
      function estudiantes() {
        var ids = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa' && m.seccionId === S.carga.seccionId) ids[m.estudianteId] = 1; });
        return d.estudiantes.filter(function (e) { return ids[e.id]; }).sort(function (a, b) { return cmp(a.apellidos + ' ' + a.nombres, b.apellidos + ' ' + b.nombres); });
      }
      function mapaCal() { var m = {}; d.calificaciones.forEach(function (c) { m[c.actividadId + '|' + c.estudianteId] = c; }); return m; }
      function periodo() { return per(S.periodoId); }
      function pesosOk() { var c = cats(); return c.length > 0 && calc.validarPesos(c, 100).ok; }
      function editable() {
        var p = periodo(); if (!p) return false;
        if (esDoc) return EDU.permisos.puede(rol, 'libro-notas', 'editar') && !p.cerrado;
        if (esDir) return S.modoEd;
        return false;
      }
      function hayCambios() { return Object.keys(S.dirty).length > 0; }

      /* ---------- calculo de un estudiante (con cambios sin guardar) ---------- */
      function ptsEst(estId, mapa) {
        var o = {};
        actsCarga().forEach(function (a) {
          var k = a.id + '|' + estId, c = mapa[k];
          var v = c ? c.puntos : null;
          if (S.dirty[k] !== undefined && !S.invalidos[k]) v = calc.aNumero(S.dirty[k]);
          o[a.id] = v;
        });
        return o;
      }
      function calcEst(estId, mapa) {
        var esc_ = escala(), pts = ptsEst(estId, mapa), cs = cats(), ac = actsCarga();
        var rp = calc.calcularPeriodo({ categorias: cs, actividades: ac, calificaciones: pts, periodoId: S.periodoId, escala: esc_ });
        var rf = calc.calcularFinal({ categorias: cs, actividades: ac, calificaciones: pts, periodos: periodosDe(S.carga).map(function (p) { return { id: p.id, peso: p.peso }; }), escala: esc_ });
        return { per: rp.nota, fin: rf.final, aprobPer: rp.nota == null ? null : calc.aprobado(rp.nota, esc_), aprobFin: rf.aprobado };
      }

      /* ---------- selectores ---------- */
      function pintarSel() {
        var cv = cargasVisibles();
        if (!cv.length) { elSel.innerHTML = ''; elPanel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin asignaturas asignadas', texto: 'No hay cargas docentes disponibles para tu usuario en este centro.' }) + '</div>'; return false; }
        if (!S.carga || !cv.some(function (c) { return c.id === S.carga.id; })) S.carga = cv.filter(function (c) { return c.id === params.cargaId; })[0] || cv[0];
        var secIds = {}; cv.forEach(function (c) { secIds[c.seccionId] = 1; });
        var secs = d.secciones.filter(function (s) { return secIds[s.id]; }).sort(function (a, b) { return cmp(etiquetaSec(a), etiquetaSec(b)); });
        var cargasSec = cv.filter(function (c) { return c.seccionId === S.carga.seccionId; }).sort(function (a, b) { return cmp(asig(a.asignaturaId), asig(b.asignaturaId)); });
        var pers = periodosDe(S.carga);
        if (!S.periodoId || !pers.some(function (p) { return p.id === S.periodoId; })) {
          var pq = pers.filter(function (p) { return p.id === params.periodoId; })[0];
          S.periodoId = (pq || EDU.consultas.periodoAbierto(pers, S.carga.centroId) || pers[0] || {}).id;
        }
        elSel.innerHTML =
          '<label>Sección<select id="ln-s">' + ui.opciones(secs.map(function (s) { return { valor: s.id, texto: etiquetaSec(s) }; }), S.carga.seccionId) + '</select></label>' +
          '<label>Asignatura<select id="ln-a">' + ui.opciones(cargasSec.map(function (c) { var dc = d.docentes.filter(function (x) { return x.id === c.docenteId; })[0]; return { valor: c.id, texto: asig(c.asignaturaId) + (esDoc || !dc ? '' : ' · ' + fmt.nombreCompleto(dc)) }; }), S.carga.id) + '</select></label>' +
          '<label>Periodo<select id="ln-p">' + ui.opciones(pers.map(function (p) { return { valor: p.id, texto: p.nombre + ' (' + p.peso + ' %)' + (p.cerrado ? ' · cerrado' : ' · abierto') }; }), S.periodoId) + '</select></label>';
        return true;
      }
      elSel.addEventListener('change', async function (e) {
        if (hayCambios() && !(await ui.confirmar({ titulo: 'Cambios sin guardar', mensaje: 'Si cambias de vista se perderán las notas sin guardar. ¿Continuar?', textoOk: 'Descartar cambios', peligro: true }))) { if (pintarSel()) pintar(); return; }
        S.dirty = {}; S.invalidos = {}; S.modoEd = false;
        if (e.target.id === 's' || e.target.id === 'ln-s') {
          var cv = cargasVisibles().filter(function (c) { return c.seccionId === e.target.value; });
          S.carga = cv.filter(function (c) { return c.asignaturaId === S.carga.asignaturaId; })[0] || cv[0];
        } else if (e.target.id === 'ln-a') S.carga = d.cargas.filter(function (c) { return c.id === e.target.value; })[0];
        else if (e.target.id === 'ln-p') S.periodoId = e.target.value;
        var id = e.target.id; if (pintarSel()) pintar();
        var f = elSel.querySelector('#' + id); if (f) f.focus();
      });

      /* ---------- auditoria de acciones de periodo ---------- */
      function auditar(accion, extra) {
        return EDU.repo.adaptador().guardar('auditoria', Object.assign({ centroId: S.carga.centroId, usuarioId: ses.usuarioId, accion: accion, coleccion: 'periodos', fecha: ahora() }, extra));
      }
      async function pedirMotivo(titulo, texto) {
        var v = await ui.formularioModal({ titulo: titulo, tamano: 'sm', textoEnviar: 'Continuar',
          campos: [{ nombre: 'motivo', label: 'Motivo (queda registrado en la auditoría)', tipo: 'textarea', requerido: true, minLen: 5, maxLen: 300, ayuda: texto }] });
        return v ? v.motivo : null;
      }
      async function recargar() { d = await EDU.consultas.cargar(COLS); if (vivo) { S.dirty = {}; S.invalidos = {}; pintar(); } }

      /* ---------- pintar panel ---------- */
      function pintar() {
        var p = periodo(), esc_ = escala(), cs = cats(), ok = pesosOk(), ed = editable(), acts = actsPeriodo(), ests = estudiantes(), mapa = mapaCal();
        var h = '';
        if (!p) { elPanel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin periodos', texto: 'El director debe configurar los periodos del año escolar.' }) + '</div>'; return; }
        if (p.cerrado) h += '<div class="alert" role="status"><div><strong>' + esc(p.nombre) + ' está cerrado</strong><small>' + (esDoc ? 'No puedes modificar calificaciones de un periodo cerrado. Solicita al director que lo reabra.' : esDir ? (S.modoEd ? 'Edición habilitada con auditoría: cada cambio queda registrado.' : 'Puedes reabrir el periodo o editar con auditoría.') : 'Solo lectura.') + '</small></div></div>';
        if (!ok) h += '<div class="alert red" role="alert"><div><strong>' + (cs.length ? 'Los pesos de las categorías no suman 100 %' : 'Esta asignatura no tiene categorías') + '</strong><small>' + (cs.length ? 'Suman ' + calc.validarPesos(cs, 100).suma + ' %. ' : '') + 'Mientras tanto no se puede guardar ni crear actividades.' + (ed || esDoc ? ' Corrige los pesos en «Categorías».' : '') + '</small></div></div>';
        h += '<div class="card" style="margin-top:12px"><div class="ln-acc" style="margin-top:0">';
        var puedeAct = (esDoc && !p.cerrado) || (esDir && S.modoEd);
        if (puedeAct) h += '<button type="button" class="btn amb" id="ln-nueva"' + (ok ? '' : ' disabled') + '>Nueva actividad</button><button type="button" class="btn sec" id="ln-cats">Categorías y pesos</button>';
        if (ed) h += '<button type="button" class="btn" id="ln-guardar" disabled>Guardar cambios</button><span class="note" id="ln-estado" role="status" style="margin:0;align-self:center"></span>';
        if (esDir && puedeCerrar) {
          if (!S.modoEd) h += '<button type="button" class="btn sec" id="ln-editar">' + (p.cerrado ? 'Editar con auditoría' : 'Editar notas') + '</button>';
          else h += '<button type="button" class="btn sec" id="ln-fin-ed">Terminar edición</button>';
          h += p.cerrado ? '<button type="button" class="btn sec" id="ln-reabrir">Reabrir periodo</button>' : '<button type="button" class="btn dng" id="ln-cerrar">Cerrar periodo…</button>';
        }
        h += '</div></div><div id="ln-kpis" style="margin-top:12px"></div>';
        // grilla
        h += '<div class="card" style="margin-top:12px;padding:12px"><div class="tw ln-wrap" tabindex="0" role="region" aria-label="Grilla de calificaciones, desplazable">';
        if (!ests.length) h += ui.vacio({ titulo: 'Sin estudiantes matriculados', texto: 'Esta sección no tiene matrículas activas.' });
        else if (!acts.length) h += ui.vacio({ titulo: 'Aún no hay actividades en este periodo', texto: puedeAct ? 'Crea la primera con «Nueva actividad».' : 'El docente todavía no ha creado actividades.' });
        else {
          var grupos = [];
          acts.forEach(function (a) { var g = grupos[grupos.length - 1]; if (g && g.id === a.categoriaId) g.n++; else grupos.push({ id: a.categoriaId, n: 1 }); });
          h += '<table class="t ln-grid"><caption class="sr-only">Calificaciones de ' + esc(asig(S.carga.asignaturaId)) + ', ' + esc(p.nombre) + '. Nota mínima para aprobar ' + esc(esc_.notaMinAprobar) + '.</caption><thead><tr><th scope="col" rowspan="2" class="ln-est">Estudiante</th>';
          grupos.forEach(function (g) { var c = cs.filter(function (x) { return x.id === g.id; })[0]; h += '<th scope="colgroup" colspan="' + g.n + '" class="c">' + esc(c ? c.nombre : 'Sin categoría') + (c ? ' <span class="ln-sub">' + esc(c.peso) + ' %</span>' : '') + '</th>'; });
          h += '<th scope="col" rowspan="2" class="c">Promedio del periodo</th><th scope="col" rowspan="2" class="c">Final acumulado</th><th scope="col" rowspan="2" class="c">Estado</th></tr><tr>';
          acts.forEach(function (a) {
            var t = esc(a.nombre) + '<span class="ln-sub">/ ' + esc(r2(a.puntosMax)) + (a.fecha ? ' · ' + esc(fmt.fecha(a.fecha)) : '') + '</span>';
            h += '<th scope="col" class="c">' + (puedeAct ? '<button type="button" class="ln-ah" data-act="' + esc(a.id) + '" aria-label="Editar actividad ' + esc(a.nombre) + '">' + t + '</button>' : t) + '</th>';
          });
          h += '</tr></thead><tbody>';
          ests.forEach(function (e) {
            h += '<tr data-e="' + esc(e.id) + '"><th scope="row" class="ln-est">' + esc(fmt.nombreCompleto(e)) + '</th>';
            acts.forEach(function (a) {
              var k = a.id + '|' + e.id, c = mapa[k], v = S.dirty[k] !== undefined ? S.dirty[k] : (c && c.puntos != null ? String(c.puntos) : '');
              if (ed) h += '<td class="c"><input class="ln-in" type="text" inputmode="decimal" autocomplete="off" data-k="' + esc(k) + '" data-max="' + esc(a.puntosMax) + '" value="' + esc(v) + '" aria-label="Puntos de ' + esc(fmt.nombreCompleto(e)) + ' en ' + esc(a.nombre) + ', máximo ' + esc(r2(a.puntosMax)) + '"' + (ok ? '' : ' disabled') + '></td>';
              else h += '<td class="c">' + (v === '' ? '<span aria-label="sin nota">—</span>' : esc(r2(calc.aNumero(v)))) + '</td>';
            });
            h += '<td class="c" data-c="per"></td><td class="c" data-c="fin"></td><td class="c" data-c="est"></td></tr>';
          });
          h += '</tbody><tfoot><tr><th scope="row" class="ln-est">Promedio del grupo</th><td colspan="' + acts.length + '"></td><td class="c" data-g="per"></td><td class="c" data-g="fin"></td><td></td></tr></tfoot></table>';
        }
        h += '</div><p class="note">Mínimo para aprobar: <strong>' + esc(esc_.notaMinAprobar) + '</strong> (escala ' + esc(esc_.min) + '–' + esc(esc_.max) + '). Pondera: ' +
          (cs.length ? cs.map(function (c) { return esc(c.nombre) + ' ' + esc(c.peso) + ' %'; }).join(' · ') : 'sin categorías') + '. Las categorías sin notas no cuentan como cero. La nota se muestra redondeada pero se guarda completa.</p></div>';
        elPanel.innerHTML = h;
        actualizarCalculos();
      }

      /* ---------- recalculo en vivo ---------- */
      function badgeEstado(ap) { return ap == null ? '<span class="badge neu">Sin notas</span>' : ap ? '<span class="badge ok">Aprobado</span>' : '<span class="badge bad">Reprobado</span>'; }
      function avg(n, ap) { return n == null ? '—' : '<span class="avg ' + (ap ? 'ok' : 'bad') + '">' + esc(fmt.nota(n, escala())) + '<span class="sr-only">' + (ap ? ', aprobado' : ', reprobado') + '</span></span>'; }
      function actualizarCalculos() {
        var mapa = mapaCal(), esc_ = escala(), sp = [], sf = [], apr = 0, rep = 0, sin = 0;
        Array.prototype.forEach.call(elPanel.querySelectorAll('tbody tr[data-e]'), function (tr) {
          var r = calcEst(tr.dataset.e, mapa);
          tr.querySelector('[data-c=per]').innerHTML = avg(r.per, r.aprobPer);
          tr.querySelector('[data-c=fin]').innerHTML = avg(r.fin, r.aprobFin);
          tr.querySelector('[data-c=est]').innerHTML = badgeEstado(r.aprobPer);
          if (r.per != null) sp.push(r.per); if (r.fin != null) sf.push(r.fin);
          if (r.aprobPer == null) sin++; else if (r.aprobPer) apr++; else rep++;
        });
        var gp = calc.promedioGeneral(sp), gf = calc.promedioGeneral(sf);
        var a = elPanel.querySelector('[data-g=per]'); if (a) a.innerHTML = gp == null ? '—' : '<strong>' + esc(fmt.nota(gp, esc_)) + '</strong>';
        var b = elPanel.querySelector('[data-g=fin]'); if (b) b.innerHTML = gf == null ? '—' : '<strong>' + esc(fmt.nota(gf, esc_)) + '</strong>';
        var k = elPanel.querySelector('#ln-kpis');
        if (k) k.innerHTML = ui.kpis([{ etiqueta: 'Aprobados (periodo)', valor: apr }, { etiqueta: 'Reprobados (periodo)', valor: rep, tono: rep ? 'bad' : 'neu', detalle: rep ? 'Por debajo de ' + esc_.notaMinAprobar : '' },
          { etiqueta: 'Sin notas', valor: sin, tono: 'neu' }, { etiqueta: 'Promedio del grupo', valor: fmt.nota(gp, esc_), tono: 'neu' }]).toString();
        var g = elPanel.querySelector('#ln-guardar');
        if (g) {
          var n = Object.keys(S.dirty).length, inv = Object.keys(S.invalidos).length;
          g.disabled = !(n && !inv && pesosOk());
          var st = elPanel.querySelector('#ln-estado');
          if (st) st.textContent = inv ? inv + ' valor(es) no válido(s): corrige antes de guardar.' : n ? n + ' cambio(s) sin guardar.' : '';
        }
      }
      elPanel.addEventListener('input', function (e) {
        var i = e.target.closest && e.target.closest('input.ln-in'); if (!i) return;
        var k = i.dataset.k, v = i.value.trim(), val = EDU.validacion.puntos(v, +i.dataset.max);
        var c = mapaCal()[k], orig = c && c.puntos != null ? String(c.puntos) : '';
        if (v === orig) delete S.dirty[k]; else S.dirty[k] = v;
        if (!val.ok) { S.invalidos[k] = val.mensaje; i.setAttribute('aria-invalid', 'true'); i.title = val.mensaje; } else { delete S.invalidos[k]; i.removeAttribute('aria-invalid'); i.removeAttribute('title'); }
        i.classList.toggle('sucio', S.dirty[k] !== undefined);
        actualizarCalculos();
      });
      elPanel.addEventListener('keydown', function (e) { // Enter baja a la siguiente fila
        if (e.key !== 'Enter' || !e.target.classList.contains('ln-in')) return;
        e.preventDefault();
        var td = e.target.closest('td'), tr = td.parentNode.nextElementSibling, idx = Array.prototype.indexOf.call(td.parentNode.children, td);
        var nx = tr && tr.children[idx] && tr.children[idx].querySelector('input'); if (nx) { nx.focus(); nx.select(); }
      });

      /* ---------- guardar ---------- */
      async function guardar() {
        if (!pesosOk() || !editable()) return;
        var mapa = mapaCal(), regs = [];
        Object.keys(S.dirty).forEach(function (k) {
          if (S.invalidos[k]) return;
          var pa = k.split('|'), ex = mapa[k], pts = calc.aNumero(S.dirty[k]);
          regs.push(Object.assign({ id: 'cal_' + pa[0] + '_' + pa[1], centroId: S.carga.centroId, actividadId: pa[0], estudianteId: pa[1] }, ex || {}, { puntos: pts }));
        });
        if (!regs.length) return;
        var btn = elPanel.querySelector('#ln-guardar'); if (btn) btn.disabled = true;
        try { await EDU.repo.guardarMuchos('calificaciones', regs); ui.toast(regs.length + ' calificación(es) guardada(s)', 'ok'); await recargar(); }
        catch (err) { ui.toast(err.message || 'No se pudo guardar', 'error'); if (btn) btn.disabled = false; }
      }

      /* ---------- actividades y categorias ---------- */
      async function editarActividad(act) {
        var cs = cats(), p = periodo(), hoy = fmt.hoy();
        var m, f = ui.formulario({ sinBotones: true,
          campos: [{ nombre: 'nombre', label: 'Nombre', requerido: true, maxLen: 80, ancho: 'full' },
            { nombre: 'categoriaId', label: 'Categoría', tipo: 'select', requerido: true, opciones: cs.map(function (c) { return { valor: c.id, texto: c.nombre + ' (' + c.peso + ' %)' }; }) },
            { nombre: 'puntosMax', label: 'Puntos máximos', tipo: 'number', requerido: true, min: 0.01, max: 1000 },
            { nombre: 'fecha', label: 'Fecha', tipo: 'date', requerido: true, ayuda: 'Periodo: ' + fmt.fecha(p.inicio) + ' al ' + fmt.fecha(p.fin) }],
          valores: act ? { nombre: act.nombre, categoriaId: act.categoriaId, puntosMax: act.puntosMax, fecha: act.fecha } : { fecha: hoy >= p.inicio && hoy <= p.fin ? hoy : p.inicio },
          alEnviar: async function (v) {
            var rec = Object.assign({}, act || { centroId: S.carga.centroId, cargaId: S.carga.id, periodoId: S.periodoId }, { nombre: v.nombre.trim(), categoriaId: v.categoriaId, puntosMax: calc.aNumero(v.puntosMax), fecha: v.fecha });
            await EDU.repo.guardar('actividades', rec); m.cerrar(true);
          } });
        var botones = [{ texto: 'Cancelar', tipo: 'sec', valor: null }];
        if (act) botones.push({ texto: 'Eliminar', tipo: 'dng', alClic: async function () {
          var n = d.calificaciones.filter(function (c) { return c.actividadId === act.id && c.puntos != null; }).length;
          if (!(await ui.confirmar({ titulo: 'Eliminar actividad', mensaje: '¿Eliminar «' + act.nombre + '»' + (n ? ' y sus ' + n + ' calificaciones' : '') + '? No se puede deshacer.', textoOk: 'Eliminar', peligro: true }))) return;
          try {
            for (var i = 0; i < d.calificaciones.length; i++) if (d.calificaciones[i].actividadId === act.id) await EDU.repo.borrar('calificaciones', d.calificaciones[i].id);
            await EDU.repo.borrar('actividades', act.id); m.cerrar(true);
          } catch (e) { ui.toast(e.message, 'error'); }
        } });
        botones.push({ texto: 'Guardar', tipo: 'amb', alClic: function () { f.enviar(); } });
        m = ui.modal({ titulo: act ? 'Editar actividad' : 'Nueva actividad', contenido: f.el, botones: botones });
        if (await m.resultado) { ui.toast('Actividad guardada', 'ok'); await recargar(); }
      }

      async function editarCategorias() {
        var cs = cats().slice(), borrar = [], box = document.createElement('div');
        function filas() {
          box.innerHTML = '<p class="note" style="margin:0 0 8px">Los pesos deben sumar exactamente 100 %. Una categoría con actividades no se puede quitar.</p>' +
            '<div class="err" id="cat-err" role="alert"></div><div id="cat-filas"></div><div class="ln-pes"><button type="button" class="btn sec sm" id="cat-add">Añadir categoría</button><span class="ln-tot" id="cat-tot" role="status"></span></div>';
          var fl = box.querySelector('#cat-filas');
          cs.forEach(function (c, i) {
            var div = document.createElement('div'); div.className = 'ln-pes';
            div.innerHTML = '<label class="sr-only" for="cn' + i + '">Nombre de la categoría ' + (i + 1) + '</label><input id="cn' + i + '" data-i="' + i + '" data-f="nombre" style="flex:1;padding:8px;border:1px solid var(--field-line);border-radius:8px" maxlength="40" value="' + esc(c.nombre) + '">' +
              '<label class="sr-only" for="cp' + i + '">Peso en porcentaje de ' + esc(c.nombre) + '</label><input id="cp' + i + '" data-i="' + i + '" data-f="peso" inputmode="decimal" style="padding:8px;border:1px solid var(--field-line);border-radius:8px" value="' + esc(c.peso) + '"><span>%</span>' +
              '<button type="button" class="btn dng sm" data-del="' + i + '" aria-label="Quitar categoría ' + esc(c.nombre) + '">Quitar</button>';
            fl.appendChild(div);
          });
          tot();
        }
        function tot() {
          var r = calc.validarPesos(cs.map(function (c) { return { peso: c.peso }; }), 100), t = box.querySelector('#cat-tot');
          t.textContent = 'Suma: ' + r.suma + ' %' + (r.ok ? ' ✓' : ' (faltan ' + r.diferencia + ' %)'); t.className = 'ln-tot ' + (r.ok ? 'ok' : 'bad');
        }
        box.addEventListener('input', function (e) { var i = e.target.dataset.i; if (i == null) return; cs[+i][e.target.dataset.f] = e.target.dataset.f === 'peso' ? e.target.value : e.target.value; tot(); });
        box.addEventListener('click', function (e) {
          if (e.target.id === 'cat-add') { cs.push({ id: null, nombre: 'Nueva categoría', peso: 0 }); filas(); var l = box.querySelectorAll('[data-f=nombre]'); l[l.length - 1].focus(); }
          var b = e.target.closest('[data-del]'); if (!b) return;
          var c = cs[+b.dataset.del];
          if (c.id && actsCarga().some(function (a) { return a.categoriaId === c.id; })) { box.querySelector('#cat-err').textContent = 'La categoría «' + c.nombre + '» tiene actividades; muévelas o elimínalas primero.'; return; }
          if (c.id) borrar.push(c.id); cs.splice(+b.dataset.del, 1); filas();
        });
        filas();
        var m = ui.modal({ titulo: 'Categorías y pesos', tamano: 'lg', contenido: box, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null },
          { texto: 'Guardar categorías', tipo: 'amb', alClic: async function (cerrar) {
            var er = box.querySelector('#cat-err');
            if (!cs.length) { er.textContent = 'Debe haber al menos una categoría.'; return; }
            if (cs.some(function (c) { return !String(c.nombre).trim() || calc.aNumero(c.peso) === null || calc.aNumero(c.peso) < 0; })) { er.textContent = 'Cada categoría necesita nombre y un peso numérico válido.'; return; }
            var v = calc.validarPesos(cs.map(function (c) { return { peso: calc.aNumero(c.peso) }; }), 100);
            if (!v.ok) { er.textContent = 'Los pesos suman ' + v.suma + ' %; deben sumar 100 %.'; return; }
            try {
              for (var i = 0; i < borrar.length; i++) await EDU.repo.borrar('categorias', borrar[i]);
              for (var j = 0; j < cs.length; j++) await EDU.repo.guardar('categorias', Object.assign({}, cs[j], { centroId: S.carga.centroId, cargaId: S.carga.id, nombre: String(cs[j].nombre).trim(), peso: calc.aNumero(cs[j].peso) }, cs[j].id ? {} : { id: undefined }));
              cerrar(true);
            } catch (err) { er.textContent = err.message; }
          } }] });
        if (await m.resultado) { ui.toast('Categorías guardadas', 'ok'); await recargar(); }
      }

      /* ---------- cierre / reapertura ---------- */
      function revision(p) {
        var filas = [], total = 0, malos = 0;
        var mats = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa') (mats[m.seccionId] = mats[m.seccionId] || []).push(m.estudianteId); });
        var cal = {}; d.calificaciones.forEach(function (c) { if (c.puntos != null) cal[c.actividadId + '|' + c.estudianteId] = 1; });
        d.cargas.filter(function (c) { return c.anioId === p.anioId; }).forEach(function (cg) {
          var acs = d.actividades.filter(function (a) { return a.cargaId === cg.id && a.periodoId === p.id; }), ests = mats[cg.seccionId] || [], pend = 0;
          acs.forEach(function (a) { ests.forEach(function (e) { if (!cal[a.id + '|' + e]) pend++; }); });
          var cs = d.categorias.filter(function (c) { return c.cargaId === cg.id; }), pesos = cs.length && calc.validarPesos(cs, 100).ok;
          if (!pesos) malos++;
          total += pend;
          if (pend || !pesos || !acs.length) filas.push({ carga: cg, pend: pend, pesos: pesos, sinAct: !acs.length });
        });
        return { filas: filas, total: total, malos: malos };
      }
      async function cerrarPeriodo() {
        var p = periodo(), r = revision(p), box = document.createElement('div');
        var dc = function (id) { var x = d.docentes.filter(function (y) { return y.id === id; })[0]; return x ? fmt.nombreCompleto(x) : '—'; };
        box.innerHTML = '<p style="margin:0 0 8px">Al cerrar <strong>' + esc(p.nombre) + '</strong> los docentes ya no podrán modificar sus calificaciones. Revisión de pendientes:</p>' +
          (r.filas.length ? '<div class="tw"><table class="t"><caption class="sr-only">Pendientes por asignatura</caption><thead><tr><th scope="col">Sección</th><th scope="col">Asignatura</th><th scope="col">Docente</th><th scope="col" class="r">Notas pendientes</th><th scope="col">Observación</th></tr></thead><tbody>' +
            r.filas.map(function (f) { var s = sec(f.carga.seccionId); return '<tr><td>' + esc(s ? etiquetaSec(s) : '') + '</td><td>' + esc(asig(f.carga.asignaturaId)) + '</td><td>' + esc(dc(f.carga.docenteId)) + '</td><td class="r">' + f.pend + '</td><td>' + (f.pesos ? '' : '<span class="badge bad">Pesos ≠ 100 %</span> ') + (f.sinAct ? '<span class="badge warn">Sin actividades</span>' : '') + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<div class="alert ok"><div><strong>Sin pendientes</strong><small>Todas las actividades del periodo tienen nota.</small></div></div>') +
          (r.total ? '<label class="opt" style="margin-top:12px"><input type="checkbox" id="cp-ok"> Entiendo que hay ' + r.total + ' nota(s) pendiente(s) y quiero cerrar el periodo igualmente.</label>' : '') +
          (r.malos ? '<p class="err" role="alert">Hay asignaturas con pesos de categorías inválidos: corrígelas antes de cerrar.</p>' : '') + '<p class="err" id="cp-err" role="alert"></p>';
        var m = ui.modal({ titulo: 'Cerrar ' + p.nombre, tamano: 'lg', contenido: box, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null },
          { texto: 'Cerrar periodo', tipo: 'dng', alClic: async function (cerrar) {
            if (r.malos) return;
            var ck = box.querySelector('#cp-ok'); if (ck && !ck.checked) { box.querySelector('#cp-err').textContent = 'Marca la casilla para confirmar el cierre con pendientes.'; return; }
            try {
              await EDU.repo.guardar('periodos', Object.assign({}, p, { cerrado: true, cerradoEn: ahora(), cerradoPor: ses.usuarioId }));
              await auditar('cerrar_periodo', { registroId: p.id, antes: { cerrado: false }, despues: { cerrado: true }, pendientes: r.total });
              cerrar(true);
            } catch (e) { box.querySelector('#cp-err').textContent = e.message; }
          } }] });
        if (await m.resultado) { ui.toast(p.nombre + ' cerrado', 'ok'); S.modoEd = false; await recargar(); }
      }
      async function reabrirPeriodo() {
        var p = periodo(), mot = await pedirMotivo('Reabrir ' + p.nombre, 'Los docentes podrán volver a editar las calificaciones.');
        if (!mot) return;
        try {
          await EDU.repo.guardar('periodos', Object.assign({}, p, { cerrado: false, reabiertoEn: ahora(), reabiertoPor: ses.usuarioId }));
          await auditar('reabrir_periodo', { registroId: p.id, antes: { cerrado: true }, despues: { cerrado: false }, motivo: mot });
          ui.toast(p.nombre + ' reabierto', 'ok'); await recargar();
        } catch (e) { ui.toast(e.message, 'error'); }
      }
      async function habilitarEdicion() {
        var p = periodo();
        if (p.cerrado) {
          var mot = await pedirMotivo('Editar periodo cerrado', 'Cada cambio de nota quedará en la auditoría junto con este motivo.');
          if (!mot) return;
          try { await auditar('edicion_periodo_cerrado', { registroId: p.id, motivo: mot }); } catch (e) { ui.toast(e.message, 'error'); return; }
        }
        S.modoEd = true; pintar();
        var b = elPanel.querySelector('#ln-fin-ed'); if (b) b.focus();
      }

      elPanel.addEventListener('click', async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        try {
          if (b.id === 'ln-guardar') await guardar();
          else if (b.id === 'ln-nueva') await editarActividad(null);
          else if (b.id === 'ln-cats') await editarCategorias();
          else if (b.dataset.act) await editarActividad(d.actividades.filter(function (a) { return a.id === b.dataset.act; })[0]);
          else if (b.id === 'ln-cerrar') { if (hayCambios()) ui.toast('Guarda o descarta los cambios antes de cerrar el periodo.', 'warn'); else await cerrarPeriodo(); }
          else if (b.id === 'ln-reabrir') await reabrirPeriodo();
          else if (b.id === 'ln-editar') await habilitarEdicion();
          else if (b.id === 'ln-fin-ed') { if (hayCambios() && !(await ui.confirmar({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios sin guardar?', textoOk: 'Descartar', peligro: true }))) return; S.dirty = {}; S.invalidos = {}; S.modoEd = false; pintar(); }
        } catch (err) { console.error(err); ui.toast(err.message || 'Error', 'error'); }
      });

      function avisoSalida(ev) { if (hayCambios()) { ev.preventDefault(); ev.returnValue = ''; } }
      window.addEventListener('beforeunload', avisoSalida);
      if (pintarSel()) pintar();
      return function () { vivo = false; window.removeEventListener('beforeunload', avisoSalida); };
    }
  });
})();
