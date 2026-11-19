/* Libro de calificaciones por COMPETENCIAS (planilla MINERD): se activa desde la vista "libro-notas" cuando la escala del centro tiene modelo 'competencias'.
   Grilla C1-C4 x P1-P4/RP + Prom, CF, completiva (CEC/CFC), extraordinaria (CEX/CEXF), especial, A/R; edicion en vivo con EDU.calculo.calcularCompetencias.
   Pestañas "Meritorios" y "Completivos" (imprimibles). Notas guardadas SIN redondear en la coleccion `notasCompetencia`:
   {id:'nc_<cargaId>_<estudianteId>', centroId, cargaId, estudianteId, c:[{p:[P1..P4], rp:[RP1..RP4]} x4], cec, cex, esp}. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, calc = EDU.calculo;
  var COLS = ['cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'periodos', 'matriculas', 'estudiantes', 'escalas', 'notasCompetencia', 'tutores', 'categorias', 'actividades', 'calificaciones'];

  var CSS = '.lc-bar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.lc-bar label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:500;flex:1 1 220px;min-width:0;max-width:100%}.lc-bar select,.lc-bar input{width:100%;min-width:0;max-width:100%}' +
    '.lc-wrap{overflow:auto;max-height:72vh;position:relative;contain:inline-size}.lc-grid{width:max-content;min-width:0;max-width:none}.lc-grid th,.lc-grid td{padding:5px 6px;white-space:nowrap}' +
    '.lc-grid thead th{position:sticky;top:0;z-index:2}.lc-grid thead tr+tr th{top:34px}.lc-grid th.lc-est{position:sticky;left:0;z-index:1;background:var(--soft);text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);font-weight:500;text-align:left;min-width:170px}' +
    '.lc-grid thead th.lc-est{z-index:3}.lc-in{width:54px;padding:5px 3px;border:1px solid var(--field-line);border-radius:6px;text-align:center;background:#fff}.lc-in.rp{background:var(--soft)}.lc-in[aria-invalid=true]{border-color:var(--bad);background:var(--bad-bg)}' +
    '.lc-in.sucio{border-color:var(--amber);box-shadow:0 0 0 2px var(--amber-soft)}.lc-sep{border-left:2px solid var(--line)}.lc-cer{opacity:.75}.lc-acc{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.lc-hoja{background:#fff;color:#000}.lc-hoja table.t th,.lc-hoja table.t td{padding:6px 8px}.lc-top td{background:var(--amber-soft)}' +
    '@media print{.lc-hoja{border:0!important;box-shadow:none!important}.lc-hoja .tw{overflow:visible}}';
  function estilo() { if (document.getElementById('lc-css')) return; var s = document.createElement('style'); s.id = 'lc-css'; s.textContent = CSS; document.head.appendChild(s); }
  function cmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function ahora() { return new Date().toISOString(); }
  function tx(n) { return n == null ? '' : String(calc.redondear(n, 4)); }

  function badgeEstado(e) {
    var tono = { Aprobado: 'ok', Reprobado: 'bad', Completiva: 'warn', Extraordinaria: 'warn', Pendiente: 'neu' }[e] || 'neu';
    return '<span class="badge ' + tono + '">' + esc(e) + '</span>';
  }

  EDU.libroCompetencias = {
    render: async function (cont, params) {
      estilo(); params = params || {};
      var ses = EDU.estado.sesion(), rol = ses.rol, esDir = rol === 'director', esDoc = rol === 'docente';
      var puedeCerrar = EDU.permisos.puede(rol, 'libro-notas', 'cerrar'), puedeEd = EDU.permisos.puede(rol, 'libro-notas', 'editar');
      var d = await EDU.consultas.cargar(COLS);
      var S = { carga: null, dirty: {}, invalidos: {}, modoEd: false, secMer: null, secCom: null, topN: 10, soloAprob: true, tab: 'notas' };
      var vivo = true;

      cont.innerHTML = ui.cabecera({ eyebrow: 'Registro académico · modelo por competencias', titulo: 'Calificaciones',
        descripcion: 'Planilla MINERD: 4 competencias × 4 periodos (P1–P4) con recuperación pedagógica (RP). CF = media de las competencias; completiva 50/50, extraordinaria 30/70 y especial. Las notas se guardan sin redondear.' }).toString() +
        '<div id="lc-tabs"></div>';

      /* ---------- datos derivados ---------- */
      function alcance() { return EDU.permisos.alcance(EDU.estado.sesion(), d); }
      function cargasVisibles() { return EDU.permisos.filtrar(alcance(), 'cargas', d.cargas); }
      function sec(id) { return d.secciones.filter(function (x) { return x.id === id; })[0]; }
      function etiquetaSec(s) { var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0]; return (c ? c.nombre : '') + ' · Sección ' + s.nombre; }
      function asig(id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? a.nombre : id; }
      function asigCod(id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? (a.codigo || a.nombre) : id; }
      function escala() { return EDU.consultas.escalaDe(d.escalas, S.carga ? S.carga.centroId : (EDU.estado.centroActivo() || ses.centroUsuario)); }
      function cfg() { return calc.configCompetencias(escala()); }
      function periodosDe(carga) { return d.periodos.filter(function (p) { return p.anioId === carga.anioId; }).sort(function (a, b) { return a.orden - b.orden; }); }
      function estudiantes(seccionId) {
        var ids = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa' && m.seccionId === seccionId) ids[m.estudianteId] = 1; });
        return d.estudiantes.filter(function (e) { return ids[e.id]; }).sort(function (a, b) { return cmp(a.apellidos + ' ' + a.nombres, b.apellidos + ' ' + b.nombres); });
      }
      function mapaNc() { var m = {}; d.notasCompetencia.forEach(function (n) { if (S.carga && n.cargaId === S.carga.id) m[n.estudianteId] = n; }); return m; }
      function vacio4() { var a = []; for (var c = 0; c < cfg().competencias; c++) a.push({ p: [], rp: [] }); return a; }
      function valor(est, nc, campo, c, i) { // valor mostrado/calculado (dirty tiene prioridad)
        var k = est + '|' + campo + (c != null ? '|' + c + '|' + i : '');
        if (S.dirty[k] !== undefined) return S.invalidos[k] ? null : calc.aNumero(S.dirty[k]);
        if (!nc) return null;
        if (c == null) return calc.aNumero(nc[campo]);
        var cc = nc.c && nc.c[c]; return cc && cc[campo] ? calc.aNumero(cc[campo][i]) : null;
      }
      function textoCelda(est, nc, campo, c, i) {
        var k = est + '|' + campo + (c != null ? '|' + c + '|' + i : '');
        if (S.dirty[k] !== undefined) return S.dirty[k];
        var v = valor(est, nc, campo, c, i); return v == null ? '' : String(v);
      }
      function calcEst(est, nc) {
        var N = cfg().competencias, P = cfg().periodos, comps = [];
        for (var c = 0; c < N; c++) { var p = [], r = []; for (var i = 0; i < P; i++) { p.push(valor(est, nc, 'p', c, i)); r.push(valor(est, nc, 'rp', c, i)); } comps.push({ p: p, rp: r }); }
        return calc.calcularCompetencias({ competencias: comps, cec: valor(est, nc, 'cec'), cex: valor(est, nc, 'cex'), esp: valor(est, nc, 'esp'), escala: escala() });
      }
      function hayCambios() { return Object.keys(S.dirty).length > 0; }
      function pClosed(i) { var p = periodosDe(S.carga)[i]; return !p || !!p.cerrado; }
      function celdaEditable(campo, i) {
        if (!S.carga) return false;
        if (esDir) return puedeEd && S.modoEd;
        if (!esDoc || !puedeEd) return false;
        if (campo === 'p' || campo === 'rp') return !pClosed(i);
        return true; // instancias posteriores (completiva/extraordinaria/especial): no ligadas al cierre de un periodo; quedan auditadas
      }

      /* ---------- pestaña: grilla ---------- */
      var elTabs = cont.querySelector('#lc-tabs'), panelNotas = document.createElement('div');
      function pintarSelNotas() {
        var cv = cargasVisibles();
        if (!cv.length) { panelNotas.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin asignaturas asignadas', texto: 'No hay cargas docentes disponibles para tu usuario en este centro.' }) + '</div>'; return false; }
        if (!S.carga || !cv.some(function (c) { return c.id === S.carga.id; })) S.carga = cv.filter(function (c) { return c.id === params.cargaId; })[0] || cv[0];
        var secIds = {}; cv.forEach(function (c) { secIds[c.seccionId] = 1; });
        var secs = d.secciones.filter(function (s) { return secIds[s.id]; }).sort(function (a, b) { return cmp(etiquetaSec(a), etiquetaSec(b)); });
        var cs = cv.filter(function (c) { return c.seccionId === S.carga.seccionId; }).sort(function (a, b) { return cmp(asig(a.asignaturaId), asig(b.asignaturaId)); });
        return '<div class="card"><div class="lc-bar"><label>Sección<select id="lc-s">' + ui.opciones(secs.map(function (s) { return { valor: s.id, texto: etiquetaSec(s) }; }), S.carga.seccionId) + '</select></label>' +
          '<label>Asignatura<select id="lc-a">' + ui.opciones(cs.map(function (c) { var dc = d.docentes.filter(function (x) { return x.id === c.docenteId; })[0]; return { valor: c.id, texto: asig(c.asignaturaId) + (esDoc || !dc ? '' : ' · ' + fmt.nombreCompleto(dc)) }; }), S.carga.id) + '</select></label></div></div>';
      }
      function pintarNotas() {
        var sel = pintarSelNotas(); if (sel === false) return;
        var ests = estudiantes(S.carga.seccionId), ed = false, cf = cfg(), N = cf.competencias, P = cf.periodos, esc_ = escala(), pers = periodosDe(S.carga), mapa = mapaNc();
        var puedeAlgo = esDir ? (puedeEd && S.modoEd) : (esDoc && puedeEd);
        var h = sel + '<div id="lc-msg"></div><div class="card" style="margin-top:12px"><div class="lc-acc">';
        if (esDoc && puedeEd) h += '<button type="button" class="btn" id="lc-guardar" disabled>Guardar cambios</button>';
        if (esDir && puedeEd) {
          h += S.modoEd ? '<button type="button" class="btn" id="lc-guardar" disabled>Guardar cambios</button><button type="button" class="btn sec" id="lc-fin">Terminar edición</button>' : '<button type="button" class="btn sec" id="lc-editar">Editar con auditoría</button>';
        }
        h += '<span class="note" id="lc-estado" role="status" style="margin:0"></span></div>';
        h += '<p class="note" style="margin:8px 0 0">Periodos: ' + pers.map(function (p, i) { return 'P' + (i + 1) + ' ' + (p.cerrado ? '(cerrado)' : '(abierto)'); }).join(' · ') + '. ' +
          (esDoc ? 'Solo puedes editar los periodos abiertos; completiva, extraordinaria y especial siempre quedan abiertas (con auditoría).' : esDir ? (S.modoEd ? 'Edición habilitada: cada cambio queda en la auditoría.' : 'Vista de lectura; usa «Editar con auditoría» para corregir notas.') : 'Solo lectura.') + '</p></div><div id="lc-kpis" style="margin-top:12px"></div>';
        h += '<div class="card" style="margin-top:12px;padding:12px"><div class="tw lc-wrap" tabindex="0" role="region" aria-label="Grilla de calificaciones por competencia, desplazable">';
        if (!ests.length) h += ui.vacio({ titulo: 'Sin estudiantes matriculados', texto: 'Esta sección no tiene matrículas activas.' });
        else {
          h += '<table class="t lc-grid"><caption class="sr-only">Calificaciones por competencia de ' + esc(asig(S.carga.asignaturaId)) + '. Nota mínima ' + esc(esc_.notaMinAprobar) + '.</caption><thead><tr><th scope="col" rowspan="2" class="lc-est">Estudiante</th>';
          for (var c = 0; c < N; c++) h += '<th scope="colgroup" colspan="' + (2 * P + 1) + '" class="c lc-sep">' + esc('C' + (c + 1) + ' · ' + cf.nombres[c]) + '</th>';
          h += '<th scope="col" rowspan="2" class="c lc-sep">CF</th><th scope="colgroup" colspan="2" class="c lc-sep">Completiva</th><th scope="colgroup" colspan="2" class="c lc-sep">Extraordinaria</th><th scope="col" rowspan="2" class="c lc-sep">Especial (CE)</th><th scope="col" rowspan="2" class="c lc-sep">Final</th><th scope="col" rowspan="2" class="c">A/R</th></tr><tr>';
          for (c = 0; c < N; c++) { for (var i = 0; i < P; i++) h += '<th scope="col" class="c' + (i === 0 ? ' lc-sep' : '') + (pers[i] && pers[i].cerrado ? ' lc-cer' : '') + '">P' + (i + 1) + '</th><th scope="col" class="c' + (pers[i] && pers[i].cerrado ? ' lc-cer' : '') + '">RP</th>'; h += '<th scope="col" class="c">Prom</th>'; }
          h += '<th scope="col" class="c lc-sep">CEC</th><th scope="col" class="c">CFC</th><th scope="col" class="c lc-sep">CEX</th><th scope="col" class="c">CEXF</th></tr></thead><tbody>';
          ests.forEach(function (e) {
            var nc = mapa[e.id];
            h += '<tr data-e="' + esc(e.id) + '"><th scope="row" class="lc-est">' + esc(fmt.nombreCompleto(e)) + '</th>';
            function celda(campo, c, i, etq, cls) {
              var okEd = celdaEditable(campo, i), t = textoCelda(e.id, nc, campo, c, i), k = e.id + '|' + campo + (c != null ? '|' + c + '|' + i : '');
              if (okEd) return '<td class="c' + (cls || '') + '"><input class="lc-in' + (campo === 'rp' ? ' rp' : '') + '" type="text" inputmode="decimal" autocomplete="off" data-k="' + esc(k) + '" value="' + esc(t) + '" aria-label="' + esc(etq + ' de ' + fmt.nombreCompleto(e)) + '"></td>';
              return '<td class="c' + (cls || '') + '">' + (t === '' ? '<span aria-label="sin nota">—</span>' : esc(tx(calc.aNumero(t)))) + '</td>';
            }
            for (var c2 = 0; c2 < N; c2++) {
              for (var i2 = 0; i2 < P; i2++) { h += celda('p', c2, i2, 'C' + (c2 + 1) + ' P' + (i2 + 1), i2 === 0 ? ' lc-sep' : ''); h += celda('rp', c2, i2, 'C' + (c2 + 1) + ' RP' + (i2 + 1)); }
              h += '<td class="c" data-c="pc' + c2 + '"></td>';
            }
            h += '<td class="c lc-sep" data-c="cf"></td>' + celda('cec', null, null, 'Completiva (CEC)', ' lc-sep').replace('class="lc-in', 'class="lc-in') + '<td class="c" data-c="cfc"></td>' + celda('cex', null, null, 'Extraordinaria (CEX)', ' lc-sep') + '<td class="c" data-c="cexf"></td>' +
              celda('esp', null, null, 'Especial (CE)', ' lc-sep') + '<td class="c lc-sep" data-c="fin"></td><td class="c" data-c="est"></td></tr>';
          });
          h += '</tbody></table>';
        }
        h += '</div><p class="note">Mínimo para aprobar: <strong>' + esc(esc_.notaMinAprobar) + '</strong> (escala ' + esc(esc_.min) + '–' + esc(esc_.max) + '). Regla única: si P &lt; ' + esc(esc_.notaMinAprobar) + ' y hay RP, el periodo vale ' + (cf.regla === 'maximo' ? 'el mayor entre P y RP' : 'el RP') + '; la competencia es la media de sus periodos con nota; CF = media de las competencias. ' +
          'Completiva: CFC = ' + esc(cf.completiva.cf) + ' % CF + ' + esc(cf.completiva.cec) + ' % CEC. Extraordinaria: CEXF = ' + esc(cf.extraordinaria.cf) + ' % CF + ' + esc(cf.extraordinaria.cex) + ' % CEX. Las instancias posteriores solo cuentan con el año completo (todos los periodos con nota). Las notas faltantes no cuentan como cero.</p></div>';
        panelNotas.innerHTML = h;
        actualizar();
        void ed; void puedeAlgo;
      }
      function actualizar() {
        var mapa = mapaNc(), cnt = { Aprobado: 0, Reprobado: 0, Completiva: 0, Extraordinaria: 0, Pendiente: 0 }, esc_ = escala(), cfs = [], N = cfg().competencias;
        Array.prototype.forEach.call(panelNotas.querySelectorAll('tbody tr[data-e]'), function (tr) {
          var r = calcEst(tr.dataset.e, mapa[tr.dataset.e]);
          function put(sel, n, ap) { var c = tr.querySelector('[data-c=' + sel + ']'); if (c) c.innerHTML = n == null ? '—' : '<span class="avg ' + (ap === false ? 'bad' : ap ? 'ok' : '') + '">' + esc(fmt.nota(n, esc_)) + '</span>'; }
          for (var c = 0; c < N; c++) put('pc' + c, r.competencias[c].promedio, r.competencias[c].promedio == null ? null : calc.aprobado(r.competencias[c].promedio, esc_));
          put('cf', r.cf, r.cf == null ? null : calc.aprobado(r.cf, esc_)); put('cfc', r.cfc, r.cfc == null ? null : calc.aprobado(r.cfc, esc_)); put('cexf', r.cexf, r.cexf == null ? null : calc.aprobado(r.cexf, esc_));
          put('fin', r.final, r.aprobado); tr.querySelector('[data-c=est]').innerHTML = badgeEstado(r.estado) + (r.via && r.via !== 'cf' ? ' <span class="note" style="margin:0">(' + esc(r.via) + ')</span>' : '');
          cnt[r.estado]++; if (r.cf != null) cfs.push(r.cf);
        });
        var k = panelNotas.querySelector('#lc-kpis');
        if (k) k.innerHTML = ui.kpis([{ etiqueta: 'Aprobados', valor: cnt.Aprobado }, { etiqueta: 'Completiva', valor: cnt.Completiva, tono: cnt.Completiva ? 'warn' : 'neu' }, { etiqueta: 'Extraordinaria', valor: cnt.Extraordinaria, tono: cnt.Extraordinaria ? 'warn' : 'neu' },
          { etiqueta: 'Reprobados', valor: cnt.Reprobado, tono: cnt.Reprobado ? 'bad' : 'neu' }, { etiqueta: 'Pendientes', valor: cnt.Pendiente, tono: 'neu' }, { etiqueta: 'CF promedio', valor: fmt.nota(calc.promedioGeneral(cfs), esc_), tono: 'neu' }]).toString();
        var g = panelNotas.querySelector('#lc-guardar');
        if (g) { var n = Object.keys(S.dirty).length, inv = Object.keys(S.invalidos).length; g.disabled = !(n && !inv); var st = panelNotas.querySelector('#lc-estado'); if (st) st.textContent = inv ? inv + ' valor(es) no válido(s).' : n ? n + ' cambio(s) sin guardar.' : ''; }
      }
      panelNotas.addEventListener('input', function (e) {
        var i = e.target.closest && e.target.closest('input.lc-in'); if (!i) return;
        var k = i.dataset.k, v = i.value.trim(), esc_ = escala(), n = calc.aNumero(v);
        var ok = v === '' || (n !== null && n >= esc_.min && n <= esc_.max && /^-?\d+([.,]\d+)?$/.test(v));
        var pa = k.split('|'), nc = mapaNc()[pa[0]], orig = '';
        if (nc) { var o = pa.length === 2 ? nc[pa[1]] : (nc.c && nc.c[+pa[2]] && nc.c[+pa[2]][pa[1]] ? nc.c[+pa[2]][pa[1]][+pa[3]] : null); orig = o == null ? '' : String(o); }
        if (v === orig) delete S.dirty[k]; else S.dirty[k] = v;
        if (!ok) { S.invalidos[k] = 1; i.setAttribute('aria-invalid', 'true'); i.title = 'Debe ser un número entre ' + esc_.min + ' y ' + esc_.max; } else { delete S.invalidos[k]; i.removeAttribute('aria-invalid'); i.removeAttribute('title'); }
        i.classList.toggle('sucio', S.dirty[k] !== undefined);
        actualizar();
      });
      panelNotas.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !e.target.classList.contains('lc-in')) return; e.preventDefault();
        var td = e.target.closest('td'), tr = td.parentNode.nextElementSibling, idx = Array.prototype.indexOf.call(td.parentNode.children, td), nx = tr && tr.children[idx] && tr.children[idx].querySelector('input'); if (nx) { nx.focus(); nx.select(); }
      });
      async function guardar() {
        var mapa = mapaNc(), porEst = {}, N = cfg().competencias, P = cfg().periodos;
        Object.keys(S.dirty).forEach(function (k) { if (!S.invalidos[k]) (porEst[k.split('|')[0]] = porEst[k.split('|')[0]] || []).push(k); });
        var regs = Object.keys(porEst).map(function (eid) {
          var ex = mapa[eid], rec = Object.assign({ id: 'nc_' + S.carga.id + '_' + eid, centroId: S.carga.centroId, cargaId: S.carga.id, estudianteId: eid, c: vacio4(), cec: null, cex: null, esp: null }, JSON.parse(JSON.stringify(ex || {})));
          for (var c = 0; c < N; c++) { rec.c[c] = rec.c[c] || { p: [], rp: [] }; for (var i = 0; i < P; i++) { if (rec.c[c].p[i] === undefined) rec.c[c].p[i] = null; if (rec.c[c].rp[i] === undefined) rec.c[c].rp[i] = null; } }
          porEst[eid].forEach(function (k) { var pa = k.split('|'), v = calc.aNumero(S.dirty[k]); if (pa.length === 2) rec[pa[1]] = v; else rec.c[+pa[2]][pa[1]][+pa[3]] = v; });
          return rec;
        });
        if (!regs.length) return;
        var b = panelNotas.querySelector('#lc-guardar'); if (b) b.disabled = true;
        try { await (S.motivoEd ? EDU.repo.conMotivo(S.motivoEd, function () { return EDU.repo.guardarMuchos('notasCompetencia', regs); }) : EDU.repo.guardarMuchos('notasCompetencia', regs)); ui.toast(regs.length + ' estudiante(s) guardado(s)', 'ok'); d = await EDU.consultas.cargar(COLS); S.dirty = {}; S.invalidos = {}; pintarNotas(); }
        catch (err) { ui.toast(err.message || 'No se pudo guardar', 'error'); if (b) b.disabled = false; }
      }
      panelNotas.addEventListener('change', async function (e) {
        if (e.target.id !== 'lc-s' && e.target.id !== 'lc-a') return;
        if (hayCambios() && !(await ui.confirmar({ titulo: 'Cambios sin guardar', mensaje: 'Si cambias de asignatura se perderán las notas sin guardar. ¿Continuar?', textoOk: 'Descartar cambios', peligro: true }))) { pintarNotas(); return; }
        S.dirty = {}; S.invalidos = {}; S.modoEd = false;
        if (e.target.id === 'lc-s') { var cv = cargasVisibles().filter(function (c) { return c.seccionId === e.target.value; }); S.carga = cv.filter(function (c) { return c.asignaturaId === S.carga.asignaturaId; })[0] || cv[0]; }
        else S.carga = d.cargas.filter(function (c) { return c.id === e.target.value; })[0];
        var id = e.target.id; pintarNotas(); var f = panelNotas.querySelector('#' + id); if (f) f.focus();
      });
      panelNotas.addEventListener('click', async function (e) {
        var b = e.target.closest('button'); if (!b) return;
        try {
          if (b.id === 'lc-guardar') await guardar();
          else if (b.id === 'lc-editar') {
            var v = await ui.formularioModal({ titulo: 'Editar con auditoría', tamano: 'sm', textoEnviar: 'Continuar', campos: [{ nombre: 'motivo', label: 'Motivo (queda registrado en la auditoría)', tipo: 'textarea', requerido: true, minLen: 5, maxLen: 300 }] });
            if (!v) return;
            S.motivoEd = v.motivo; // modo API: X-EDU-Motivo en cada escritura
            await EDU.repo.auditar('edicion_notas_competencia', { centroId: S.carga.centroId, coleccion: 'notasCompetencia', registroId: S.carga.id, motivo: v.motivo });
            S.modoEd = true; pintarNotas();
          } else if (b.id === 'lc-fin') { if (hayCambios() && !(await ui.confirmar({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios sin guardar?', textoOk: 'Descartar', peligro: true }))) return; S.dirty = {}; S.invalidos = {}; S.modoEd = false; S.motivoEd = null; pintarNotas(); }
        } catch (err) { console.error(err); ui.toast(err.message || 'Error', 'error'); }
      });

      /* ---------- pestañas Meritorios / Completivos ---------- */
      function seccionesVis() {
        var ids = {}; cargasVisibles().forEach(function (c) { ids[c.seccionId] = 1; });
        return d.secciones.filter(function (s) { return ids[s.id]; }).sort(function (a, b) { return cmp(etiquetaSec(a), etiquetaSec(b)); });
      }
      function filasResumen() { return EDU.consultas.resumenNotas(d).filter(function (f) { return f.modelo === 'competencias'; }); }
      function centroDe(s) { return (EDU.estado.centroActivo() ? d.centros : null); }
      function cabeceraImpresion(titulo, s) {
        return '<div class="print-only" style="margin-bottom:8px"><strong>' + esc(titulo) + '</strong> · ' + esc(etiquetaSec(s)) + ' · ' + esc(fmt.fecha(fmt.hoy(), true)) + '</div>';
      }
      function selSeccion(id, ss, sel) { return '<label>Sección<select id="' + id + '">' + ui.opciones(ss.map(function (s) { return { valor: s.id, texto: etiquetaSec(s) }; }), sel) + '</select></label>'; }

      function panelMeritorios(panel) {
        var ss = seccionesVis(); if (!ss.length) { panel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin secciones' }) + '</div>'; return; }
        if (!S.secMer || !ss.some(function (s) { return s.id === S.secMer; })) S.secMer = ss[0].id;
        var s = sec(S.secMer), esc_ = EDU.consultas.escalaDe(d.escalas, s.centroId), filas = filasResumen().filter(function (f) { return f.seccionId === s.id; });
        var cargasS = d.cargas.filter(function (c) { return c.seccionId === s.id; }).sort(function (a, b) { return cmp(asig(a.asignaturaId), asig(b.asignaturaId)); });
        var porEst = EDU.consultas.agrupar(filas, 'estudianteId'), ests = estudiantes(s.id), lista = [];
        ests.forEach(function (e) {
          var fl = porEst[e.id] || [], notas = fl.filter(function (f) { return f.final != null && f.estado !== 'Pendiente'; }), prom = calc.promedioGeneral(notas.map(function (f) { return f.final; }));
          var todoAprob = fl.length > 0 && fl.every(function (f) { return f.estado === 'Aprobado'; });
          if (prom != null) lista.push({ e: e, fl: fl, prom: prom, todoAprob: todoAprob, n: notas.length });
        });
        if (S.soloAprob) lista = lista.filter(function (x) { return x.todoAprob; });
        lista.sort(function (a, b) { return b.prom - a.prom || cmp(a.e.apellidos + a.e.nombres, b.e.apellidos + b.e.nombres); });
        var top = lista.slice(0, Math.max(1, S.topN | 0));
        var h = '<div class="card no-print"><div class="lc-bar">' + selSeccion('mm-s', ss, S.secMer) + '<label>Mostrar los primeros<input id="mm-n" type="number" min="1" max="200" value="' + esc(S.topN) + '"></label>' +
          '<label class="opt" style="flex-direction:row;align-items:center"><input type="checkbox" id="mm-a"' + (S.soloAprob ? ' checked' : '') + '> Solo con todas las asignaturas aprobadas</label><button type="button" class="btn amb" id="mm-imp">Imprimir</button></div></div>' +
          '<div class="card lc-hoja" style="margin-top:12px">' + cabeceraImpresion('Cuadro de mérito', s) + '<h2>Meritorios · ' + esc(etiquetaSec(s)) + '</h2><p class="note">Promedio simple de las calificaciones finales de las asignaturas con resultado definitivo (CF o instancia posterior).</p>';
        if (!top.length) h += ui.vacio({ titulo: 'Sin estudiantes que cumplan', texto: 'Aún no hay notas finales suficientes o ninguno aprueba todas las asignaturas.' });
        else h += '<div class="tw"><table class="t"><caption class="sr-only">Ranking de meritorios</caption><thead><tr><th scope="col" class="r">Puesto</th><th scope="col">Estudiante</th>' + cargasS.map(function (c) { return '<th scope="col" class="c" title="' + esc(asig(c.asignaturaId)) + '">' + esc(asigCod(c.asignaturaId)) + '</th>'; }).join('') + '<th scope="col" class="c">Promedio</th></tr></thead><tbody>' +
          top.map(function (x, i) {
            var m = {}; x.fl.forEach(function (f) { m[f.cargaId] = f; });
            return '<tr><td class="r">' + (i + 1) + '</td><th scope="row" style="text-align:left;font-weight:500">' + esc(fmt.nombreCompleto(x.e)) + '</th>' + cargasS.map(function (c) { var f = m[c.id]; return '<td class="c">' + esc(f && f.estado !== 'Pendiente' ? fmt.nota(f.final, esc_) : '—') + '</td>'; }).join('') + '<td class="c"><strong>' + esc(fmt.nota(x.prom, esc_)) + '</strong></td></tr>';
          }).join('') + '</tbody></table></div>';
        panel.innerHTML = h + '</div>';
      }
      function panelCompletivos(panel) {
        var ss = seccionesVis(); if (!ss.length) { panel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin secciones' }) + '</div>'; return; }
        if (!S.secCom || (S.secCom !== 'todas' && !ss.some(function (s) { return s.id === S.secCom; }))) S.secCom = ss[0].id;
        var lista = ss.filter(function (s) { return S.secCom === 'todas' || s.id === S.secCom; });
        var h = '<div class="card no-print"><div class="lc-bar"><label>Sección<select id="mc-s">' + ui.opciones([{ valor: 'todas', texto: 'Todas las secciones' }].concat(ss.map(function (s) { return { valor: s.id, texto: etiquetaSec(s) }; })), S.secCom) + '</select></label><button type="button" class="btn amb" id="mc-imp">Imprimir</button></div></div>';
        var rows = filasResumen();
        lista.forEach(function (s) {
          var esc_ = EDU.consultas.escalaDe(d.escalas, s.centroId), fl = rows.filter(function (f) { return f.seccionId === s.id && (f.estado === 'Completiva' || f.estado === 'Extraordinaria'); }), pe = EDU.consultas.agrupar(fl, 'estudianteId');
          var ests = estudiantes(s.id).filter(function (e) { return pe[e.id]; });
          h += '<div class="card lc-hoja" style="margin-top:12px">' + cabeceraImpresion('Estudiantes en evaluación completiva / extraordinaria', s) + '<h2>Completivos · ' + esc(etiquetaSec(s)) + '</h2>';
          if (!ests.length) h += '<p class="note">Ningún estudiante debe ir a completiva o extraordinaria (con el año completo y CF por debajo de ' + esc(esc_.notaMinAprobar) + ').</p>';
          else h += '<div class="tw"><table class="t"><caption class="sr-only">Listado de completivos</caption><thead><tr><th scope="col" class="r">No.</th><th scope="col">Estudiante</th><th scope="col">Asignatura</th><th scope="col" class="c">CF</th><th scope="col">Instancia pendiente</th><th scope="col" class="c">CEC</th><th scope="col" class="c">CFC</th></tr></thead><tbody>' +
            ests.map(function (e, i) {
              return pe[e.id].map(function (f, j) {
                var nc = d.notasCompetencia.filter(function (n) { return n.cargaId === f.cargaId && n.estudianteId === e.id; })[0] || {};
                return '<tr>' + (j === 0 ? '<td class="r" rowspan="' + pe[e.id].length + '">' + (i + 1) + '</td><th scope="row" rowspan="' + pe[e.id].length + '" style="text-align:left;font-weight:500">' + esc(fmt.nombreCompleto(e)) + '</th>' : '') + '<td>' + esc(asig(f.asignaturaId)) + '</td><td class="c">' + esc(fmt.nota(f.cf, esc_)) + '</td><td>' + badgeEstado(f.estado) + '</td><td class="c">' + esc(nc.cec == null ? '—' : fmt.nota(nc.cec, esc_)) + '</td><td class="c">' + esc(f.calc && f.calc.cfc != null ? fmt.nota(f.calc.cfc, esc_) : '—') + '</td></tr>';
              }).join('');
            }).join('') + '</tbody></table></div><p class="note">' + ests.length + ' estudiante(s). Generado automáticamente: año completo y CF menor que ' + esc(esc_.notaMinAprobar) + '; pasa a extraordinaria si CFC no alcanza el mínimo.</p>';
          h += '</div>';
        });
        panel.innerHTML = h;
      }
      var panelMer = document.createElement('div'), panelCom = document.createElement('div');
      panelMer.addEventListener('change', function (e) {
        if (e.target.id === 'mm-s') S.secMer = e.target.value; else if (e.target.id === 'mm-n') S.topN = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 10)); else if (e.target.id === 'mm-a') S.soloAprob = e.target.checked; else return;
        var id = e.target.id; panelMeritorios(panelMer); var f = panelMer.querySelector('#' + id); if (f) f.focus();
      });
      panelCom.addEventListener('change', function (e) { if (e.target.id !== 'mc-s') return; S.secCom = e.target.value; panelCompletivos(panelCom); var f = panelCom.querySelector('#mc-s'); if (f) f.focus(); });
      cont.addEventListener('click', function (e) { if (e.target.id === 'mm-imp' || e.target.id === 'mc-imp') window.print(); });

      var tabs = ui.tabs({ etiqueta: 'Calificaciones por competencia', activa: S.tab, siempre: true, alCambiar: function (id) { S.tab = id; },
        tabs: [{ id: 'notas', titulo: 'Calificaciones', render: function (p) { p.appendChild(panelNotas); pintarNotas(); } },
          { id: 'mer', titulo: 'Meritorios', render: function (p) { p.appendChild(panelMer); panelMeritorios(panelMer); } },
          { id: 'com', titulo: 'Completivos', render: function (p) { p.appendChild(panelCom); panelCompletivos(panelCom); } }] });
      elTabs.appendChild(tabs.el);
      function avisoSalida(ev) { if (hayCambios()) { ev.preventDefault(); ev.returnValue = ''; } }
      window.addEventListener('beforeunload', avisoSalida);
      return function () { vivo = false; window.removeEventListener('beforeunload', avisoSalida); };
    }
  };
})();
