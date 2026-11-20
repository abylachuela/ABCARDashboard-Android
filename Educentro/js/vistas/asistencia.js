/* Vista "asistencia": asistencia diaria por seccion (P/A/T/J), justificaciones, % por periodo y alertas.
   Docente: solo sus secciones. Tutor/estudiante: solo lo propio (lectura). J (justificada) no penaliza el porcentaje. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, ui = EDU.ui, fmt = EDU.fmt;
  var COLS = ['secciones', 'cursos', 'estudiantes', 'matriculas', 'cargas', 'tutores', 'periodos', 'asistencia'];
  var ESTADOS = { P: 'Presente', A: 'Ausente', T: 'Tardanza', J: 'Justificada' };
  var UMBRAL_PCT = 85, UMBRAL_FALTAS = 3;

  function pctAsis(regs) { return regs.length ? regs.filter(function (r) { return r.estado !== 'A'; }).length / regs.length * 100 : null; }
  function tonoPct(p) { return p == null ? 'neu' : p < UMBRAL_PCT ? 'bad' : p < 92 ? 'warn' : 'ok'; }
  function badgePct(p) { return ui.badge(p == null ? '—' : fmt.pct(p, 1), tonoPct(p)); }
  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function etiquetaSec(d, s) { var c = porId(d.cursos, s.cursoId); return (c ? c.nombre : '') + ' ' + s.nombre; }
  function nombre(d, id) { return fmt.nombreCompleto(porId(d.estudiantes, id)) || id; }
  function estudiantesDe(d, secId) {
    return d.matriculas.filter(function (m) { return m.seccionId === secId && m.estado === 'activa'; }).map(function (m) { return porId(d.estudiantes, m.estudianteId); }).filter(Boolean)
      .sort(function (a, b) { return fmt.nombreCompleto(a).localeCompare(fmt.nombreCompleto(b), 'es'); });
  }
  function enPeriodo(regs, p) { return regs.filter(function (r) { return r.fecha >= p.inicio && r.fecha <= p.fin; }); }
  function diaSemana(f) { return new Date(f + 'T12:00:00Z').getUTCDay(); }

  /** Racha maxima de ausencias (A) en dias registrados consecutivos. */
  function rachaA(regs) {
    var o = regs.slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }), max = 0, cur = 0;
    o.forEach(function (r) { if (r.estado === 'A') { cur++; max = Math.max(max, cur); } else cur = 0; });
    return max;
  }

  function resumenFilas(d, estudiantes, regsDe, periodos) {
    return estudiantes.map(function (e) {
      var r = regsDe(e.id), f = { id: e.id, nombre: fmt.nombreCompleto(e), total: r.length, P: 0, A: 0, T: 0, J: 0, pct: pctAsis(r), racha: rachaA(r), regs: r };
      r.forEach(function (x) { f[x.estado] = (f[x.estado] || 0) + 1; });
      periodos.forEach(function (p) { f['p_' + p.id] = pctAsis(enPeriodo(r, p)); });
      return f;
    });
  }
  function colsResumen(periodos) {
    var c = [{ clave: 'nombre', titulo: 'Estudiante' }, { clave: 'P', titulo: 'P', align: 'c' }, { clave: 'A', titulo: 'A', align: 'c' }, { clave: 'T', titulo: 'T', align: 'c' }, { clave: 'J', titulo: 'J', align: 'c' },
      { clave: 'pct', titulo: '% total', align: 'c', render: function (f) { return badgePct(f.pct); } }];
    periodos.forEach(function (p) { c.push({ clave: 'p_' + p.id, titulo: '% ' + p.nombre, align: 'c', render: function (f) { return badgePct(f['p_' + p.id]); } }); });
    return c;
  }

  /* ---------------- Pasar lista ---------------- */
  function tabLista(panel, d, secId, puedeEditar) {
    var ests = estudiantesDe(d, secId), hoy = fmt.hoy();
    if (!ests.length) { panel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'La sección no tiene estudiantes activos' }) + '</div>'; return; }
    panel.innerHTML = '<div class="card"><h2>Asistencia del día</h2><div class="fgrid" style="margin-top:10px"><label class="fld">Fecha<input type="date" id="asF" value="' + esc(hoy) + '" max="' + esc(hoy) + '"></label>' +
      '<div class="fld"><span>&nbsp;</span>' + (puedeEditar ? '<button type="button" class="btn sec" id="asTodos">Marcar todos presentes</button>' : '') + '</div></div>' +
      '<div class="alert" id="asFin" hidden><div><strong>Fin de semana</strong><small>La fecha elegida es sábado o domingo.</small></div></div>' +
      '<div class="form-error" id="asErr" role="alert" hidden></div><div class="tw"><table class="t"><caption class="sr-only">Registro de asistencia de la fecha elegida</caption><thead><tr><th scope="col">Estudiante</th><th scope="col">Estado</th><th scope="col">Motivo / nota</th></tr></thead><tbody id="asBody"></tbody></table></div>' +
      (puedeEditar ? '<div class="form-actions"><span id="asEstado" class="note" role="status" style="margin-right:auto"></span><button type="button" class="btn amb" id="asGuardar">Guardar asistencia</button></div>' : '<p class="note">Solo lectura.</p>') + '</div>';
    var $ = function (id) { return panel.querySelector('#' + id); };
    function pintar() {
      var f = $('asF').value; $('asFin').hidden = !f || [0, 6].indexOf(diaSemana(f)) === -1;
      $('asBody').innerHTML = ests.map(function (e) {
        var r = d.asistencia.filter(function (x) { return x.estudianteId === e.id && x.fecha === f; })[0], st = r ? r.estado : 'P', nm = fmt.nombreCompleto(e);
        return '<tr data-e="' + esc(e.id) + '"><th scope="row" style="font-weight:600;text-align:left">' + esc(nm) + (r ? '' : ' <small class="note">(sin registrar)</small>') + '</th><td><div role="radiogroup" aria-label="Estado de ' + esc(nm) + '" style="display:flex;gap:10px;flex-wrap:wrap">' +
          Object.keys(ESTADOS).map(function (k) {
            return '<label class="opt"><input type="radio" name="st_' + esc(e.id) + '" value="' + k + '"' + (st === k ? ' checked' : '') + (puedeEditar ? '' : ' disabled') + ' aria-label="' + esc(ESTADOS[k] + ' — ' + nm) + '">' + k + '</label>'; }).join('') +
          '</div></td><td><input type="text" class="mo" maxlength="120" value="' + esc(r && (r.justificacion || r.nota) || '') + '" aria-label="Motivo o nota de ' + esc(nm) + '"' + (puedeEditar ? '' : ' disabled') + ' style="width:100%;padding:6px 8px;border:1px solid var(--field-line);border-radius:8px"></td></tr>';
      }).join('');
    }
    pintar(); $('asF').addEventListener('change', pintar);
    if (!puedeEditar) return;
    $('asTodos').addEventListener('click', function () { Array.prototype.forEach.call(panel.querySelectorAll('input[value=P]'), function (i) { i.checked = true; }); });
    $('asGuardar').addEventListener('click', async function () {
      var f = $('asF').value, er = $('asErr'); er.hidden = true;
      if (!f) { er.textContent = 'Elija una fecha.'; er.hidden = false; return; }
      if (f > hoy) { er.textContent = 'No se puede registrar asistencia de fechas futuras.'; er.hidden = false; return; }
      var regs = [], falta = null, s = EDU.estado.sesion();
      Array.prototype.forEach.call(panel.querySelectorAll('#asBody tr'), function (tr) {
        var id = tr.dataset.e, st = tr.querySelector('input[type=radio]:checked').value, mo = tr.querySelector('.mo').value.trim();
        if (st === 'J' && !mo && !falta) falta = tr;
        var reg = { id: 'ast_' + id + '_' + f, centroId: EDU.estado.centroActivo(), seccionId: secId, estudianteId: id, fecha: f, estado: st, registradoPor: s.usuarioId };
        if (mo) { if (st === 'J') { reg.justificacion = mo; reg.justificadoPor = s.usuarioId; } else reg.nota = mo; }
        regs.push(reg);
      });
      if (falta) { var inp = falta.querySelector('.mo'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); er.textContent = 'Indique el motivo de cada justificación.'; er.hidden = false; return; }
      $('asGuardar').disabled = true;
      try {
        await EDU.repo.guardarMuchos('asistencia', regs);
        d.asistencia = (await EDU.repo.listar('asistencia'));
        $('asEstado').textContent = 'Guardado: ' + regs.length + ' registros del ' + fmt.fecha(f) + '.'; ui.toast('Asistencia guardada', 'ok'); pintar();
      } catch (e) { er.textContent = e.message; er.hidden = false; }
      $('asGuardar').disabled = false;
    });
  }

  /* ---------------- Resumen ---------------- */
  function tabResumen(panel, d, secId, periodos) {
    var ests = estudiantesDe(d, secId), regs = d.asistencia.filter(function (a) { return a.seccionId === secId; });
    var filas = resumenFilas(d, ests, function (id) { return regs.filter(function (r) { return r.estudianteId === id; }); }, periodos), g = pctAsis(regs);
    panel.innerHTML = ui.kpis([{ etiqueta: 'Asistencia de la sección', valor: g == null ? '—' : fmt.pct(g, 1), detalle: regs.length + ' registros', tono: g != null && g < UMBRAL_PCT ? 'bad' : 'ok' },
      { etiqueta: 'Ausencias', valor: String(regs.filter(function (r) { return r.estado === 'A'; }).length), detalle: 'injustificadas', tono: 'neu' },
      { etiqueta: 'Tardanzas', valor: String(regs.filter(function (r) { return r.estado === 'T'; }).length), tono: 'neu' }, { etiqueta: 'Justificadas', valor: String(regs.filter(function (r) { return r.estado === 'J'; }).length), tono: 'neu' }]).toString() +
      '<div class="card" style="margin-top:14px"><h2>Porcentaje por periodo</h2><p class="note" style="margin-top:4px">% = días sin ausencia injustificada (P, T y J cuentan como asistencia). Alerta bajo ' + UMBRAL_PCT + '%.</p><div id="rsT"></div></div>';
    panel.querySelector('#rsT').appendChild(ui.tabla({ caption: 'Resumen de asistencia por estudiante', columnas: colsResumen(periodos), filas: filas, ordenInicial: 'nombre', porPagina: 15, vacio: { titulo: 'Sin estudiantes' } }).el);
  }

  /* ---------------- Alertas ---------------- */
  function tabAlertas(panel, d, secIds, periodos, alcanceAl) {
    var tutDe = {}; d.tutores.forEach(function (t) { (t.estudianteIds || []).forEach(function (id) { (tutDe[id] = tutDe[id] || []).push(fmt.nombreCompleto(t)); }); });
    var filas = [];
    secIds.forEach(function (sid) {
      var sec = porId(d.secciones, sid), ests = estudiantesDe(d, sid);
      resumenFilas(d, ests, function (id) { return d.asistencia.filter(function (r) { return r.estudianteId === id && r.seccionId === sid; }); }, []).forEach(function (f) {
        var motivos = [];
        if (f.pct != null && f.pct < UMBRAL_PCT) motivos.push('Asistencia ' + fmt.pct(f.pct, 1) + ' (bajo ' + UMBRAL_PCT + '%)');
        if (f.A >= UMBRAL_FALTAS) motivos.push(f.A + ' ausencias injustificadas');
        if (f.racha >= UMBRAL_FALTAS) motivos.push(f.racha + ' ausencias seguidas');
        if (motivos.length) filas.push({ id: f.id, nombre: f.nombre, seccion: sec ? etiquetaSec(d, sec) : '', pct: f.pct, motivos: motivos.join(' · '), tutor: (tutDe[f.id] || []).join(', ') });
      });
    });
    panel.innerHTML = '<div class="card"><h2>Alertas de inasistencia</h2><p class="note" style="margin-top:4px">Criterios: asistencia bajo ' + UMBRAL_PCT + '%, ' + UMBRAL_FALTAS + ' o más ausencias injustificadas, o ' + UMBRAL_FALTAS + ' seguidas.</p>' +
      (filas.length ? '<div id="alT"></div>' : '<div class="alert ok"><div><strong>Sin alertas</strong><small>Ningún estudiante supera los umbrales.</small></div></div>') + '</div>';
    if (filas.length) panel.querySelector('#alT').appendChild(ui.tabla({ caption: 'Estudiantes con alerta de inasistencia', filas: filas, ordenInicial: 'pct', porPagina: 10,
      columnas: [{ clave: 'nombre', titulo: 'Estudiante' }, { clave: 'seccion', titulo: 'Sección' }, { clave: 'pct', titulo: '% asistencia', align: 'c', render: function (f) { return badgePct(f.pct); } }, { clave: 'motivos', titulo: 'Motivo' }, { clave: 'tutor', titulo: 'Tutor/a' }] }).el);
  }

  /* ---------------- Justificaciones ---------------- */
  function tabJustif(panel, d, secId, puedeEditar, recargar) {
    var regs = d.asistencia.filter(function (a) { return a.seccionId === secId && (a.estado === 'A' || a.estado === 'J'); });
    panel.innerHTML = '<div class="card"><h2>Ausencias y justificaciones</h2><p class="note" style="margin-top:4px">Una ausencia justificada (J) no penaliza el porcentaje.</p><div id="juT"></div></div>';
    var s = EDU.estado.sesion();
    var t = ui.tabla({ caption: 'Ausencias y justificaciones de la sección', filas: regs.map(function (r) { return Object.assign({}, r, { est: nombre(d, r.estudianteId) }); }), ordenInicial: 'fecha', desc: true, porPagina: 10,
      columnas: [{ clave: 'fecha', titulo: 'Fecha', formato: function (v) { return fmt.fecha(v); } }, { clave: 'est', titulo: 'Estudiante' },
        { clave: 'estado', titulo: 'Estado', render: function (r) { return ui.badge(ESTADOS[r.estado], r.estado === 'J' ? 'info' : 'bad'); } }, { clave: 'justificacion', titulo: 'Justificación' }],
      acciones: puedeEditar ? [{ texto: 'Justificar', visible: function (r) { return r.estado === 'A'; }, alClic: async function (r) {
        var v = await ui.formularioModal({ titulo: 'Justificar ausencia de ' + r.est, textoEnviar: 'Justificar', campos: [{ nombre: 'motivo', label: 'Motivo', tipo: 'textarea', requerido: true, minLen: 5, maxLen: 200, ancho: 'full', ayuda: 'Ej.: certificado médico, duelo familiar.' }] });
        if (!v) return;
        await EDU.repo.guardar('asistencia', Object.assign({}, r, { est: undefined, estado: 'J', justificacion: v.motivo, justificadoPor: s.usuarioId, justificadoEn: new Date().toISOString() }));
        ui.toast('Ausencia justificada', 'ok'); recargar();
      } }, { texto: 'Quitar justificación', visible: function (r) { return r.estado === 'J'; }, alClic: async function (r) {
        if (!(await ui.confirmar({ titulo: 'Quitar justificación', mensaje: 'La falta volverá a contarse como ausencia injustificada.', textoOk: 'Quitar' }))) return;
        await EDU.repo.guardar('asistencia', Object.assign({}, r, { est: undefined, estado: 'A', justificacion: null, justificadoPor: null, justificadoEn: null }));
        ui.toast('Justificación retirada', 'ok'); recargar();
      } }] : [], vacio: { titulo: 'Sin ausencias registradas' } });
    panel.querySelector('#juT').appendChild(t.el);
  }

  /* ---------------- Vista ---------------- */
  EDU.router.register('asistencia', {
    titulo: 'Asistencia',
    render: async function (cont) {
      var s = EDU.estado.sesion();
      var cab = function (desc) { return ui.cabecera({ eyebrow: 'Registro diario', titulo: 'Asistencia', descripcion: desc }).toString(); };
      if (!EDU.estado.centroActivo()) { cont.innerHTML = cab('') + '<div class="card">' + ui.vacio({ titulo: 'Elija un centro', texto: 'Seleccione un centro en la barra superior para ver su asistencia.' }) + '</div>'; return; }
      var d = await EDU.consultas.cargar(COLS), al = EDU.permisos.alcance(s, d), puedeEditar = EDU.permisos.puede(s.rol, 'asistencia', 'editar');
      var periodos = d.periodos.slice().sort(function (a, b) { return a.orden - b.orden; });
      d.asistencia = EDU.permisos.filtrarPorEstudiante(al, d.asistencia);
      var propio = s.rol === 'tutor' || s.rol === 'estudiante';

      if (propio) {
        var ids = Array.from(al.estudianteIds || []);
        cont.innerHTML = cab('Asistencia de ' + (s.rol === 'tutor' ? 'sus hijos/as' : 'usted')) + (ids.length ? '' : '<div class="card">' + ui.vacio({ titulo: 'Sin estudiantes vinculados' }) + '</div>');
        ids.forEach(function (id) {
          var e = porId(d.estudiantes, id); if (!e) return;
          var regs = d.asistencia.filter(function (r) { return r.estudianteId === id; }), f = resumenFilas(d, [e], function () { return regs; }, periodos)[0];
          var card = document.createElement('section'); card.className = 'card'; card.style.marginBottom = '14px';
          card.innerHTML = '<h2>' + esc(fmt.nombreCompleto(e)) + '</h2>' + ui.kpis([{ etiqueta: 'Asistencia total', valor: f.pct == null ? '—' : fmt.pct(f.pct, 1), tono: tonoPct(f.pct) === 'bad' ? 'bad' : 'ok' },
            { etiqueta: 'Ausencias', valor: String(f.A), tono: 'neu' }, { etiqueta: 'Tardanzas', valor: String(f.T), tono: 'neu' }, { etiqueta: 'Justificadas', valor: String(f.J), tono: 'neu' }]).toString() +
            (f.pct != null && f.pct < UMBRAL_PCT ? '<div class="alert red"><div><strong>Asistencia baja</strong><small>Por debajo del ' + UMBRAL_PCT + '%. Comuníquese con el centro.</small></div></div>' : '') +
            '<h3 style="margin-top:14px">Por periodo</h3><p>' + periodos.map(function (p) { return esc(p.nombre) + ': ' + badgePct(f['p_' + p.id]); }).join(' · ') + '</p><div class="det"></div>';
          card.querySelector('.det').appendChild(ui.tabla({ caption: 'Detalle de ausencias y tardanzas de ' + fmt.nombreCompleto(e), buscar: false, porPagina: 8, ordenInicial: 'fecha', desc: true,
            filas: regs.filter(function (r) { return r.estado !== 'P'; }), vacio: { titulo: 'Sin ausencias ni tardanzas' }, columnas: [{ clave: 'fecha', titulo: 'Fecha', formato: function (v) { return fmt.fecha(v); } },
              { clave: 'estado', titulo: 'Estado', render: function (r) { return ui.badge(ESTADOS[r.estado], r.estado === 'A' ? 'bad' : r.estado === 'J' ? 'info' : 'warn'); } }, { clave: 'justificacion', titulo: 'Justificación' }] }).el);
          cont.appendChild(card);
        });
        return;
      }

      var secs = EDU.permisos.filtrar(al, 'secciones', d.secciones).sort(function (a, b) { return etiquetaSec(d, a).localeCompare(etiquetaSec(d, b), 'es', { numeric: true }); });
      cont.innerHTML = cab(s.rol === 'docente' ? 'Sus secciones' : 'Secciones del centro') + (secs.length ? '<div class="card" style="margin-bottom:14px"><label class="fld" style="max-width:340px">Sección<select id="asSec">' +
        secs.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(etiquetaSec(d, x)) + '</option>'; }).join('') + '</select></label></div><div id="asTabs"></div>' : '<div class="card">' + ui.vacio({ titulo: 'No tiene secciones asignadas' }) + '</div>');
      if (!secs.length) return;
      var sel = cont.querySelector('#asSec'), tabs, activa = 'lista';
      function montar() {
        var sid = sel.value;
        tabs = ui.tabs({ etiqueta: 'Asistencia', activa: activa, alCambiar: function (id) { activa = id; }, siempre: true, tabs: [
          { id: 'lista', titulo: 'Pasar lista', render: function (p) { tabLista(p, d, sid, puedeEditar); } },
          { id: 'resumen', titulo: 'Resumen por periodo', render: function (p) { tabResumen(p, d, sid, periodos); } },
          { id: 'justif', titulo: 'Justificaciones', render: function (p) { tabJustif(p, d, sid, puedeEditar, async function () { d.asistencia = EDU.permisos.filtrarPorEstudiante(al, await EDU.repo.listar('asistencia')); montar(); }); } },
          { id: 'alertas', titulo: 'Alertas', render: function (p) { tabAlertas(p, d, secs.map(function (x) { return x.id; }), periodos, al); } }] });
        cont.querySelector('#asTabs').innerHTML = ''; cont.querySelector('#asTabs').appendChild(tabs.el);
      }
      sel.addEventListener('change', montar); montar();
    }
  });
})();
