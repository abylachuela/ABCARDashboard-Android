/* Vista Horarios docentes (administracion): franjas por tanda, grilla L-V por seccion/docente/aula, asignacion por arrastre o seleccion,
   cobertura de horas, disponibilidad, carga docente, validaciones que bloquean guardar, propuesta automatica con aprobacion humana,
   impresion y CSV. Logica pura y API publica (deHoy/deSemana) en horarios-motor.js; CSS en horarios-estilos.js. Ver docs/API.md. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, ui = EDU.ui, fmt = EDU.fmt, raw = EDU.raw;
  var H = EDU.horarios, M = H.motor, DIAS = H.DIAS;
  var NOMBRE_CONF = { docente: 'Docente en dos secciones', seccion: 'Sección con dos asignaturas', aula: 'Aula duplicada', disponibilidad: 'Docente no disponible', franja: 'Franja no válida' };
  var seq = 0;

  function html(s) { return s instanceof EDU.Safe ? s.s : String(s == null ? '' : s); }
  function colorOk(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#14315c'; }
  function hoyDia() { var d = M.diaDe(fmt.hoy()); return d <= 5 ? d : 0; }
  function copia(e) { return { id: e.id, cargaId: e.cargaId, dia: +e.dia, franjaId: e.franjaId, aula: e.aula || '' }; }
  function slug(s) { return fmt.norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'horario'; }

  EDU.router.register('horarios', { titulo: 'Horarios', render: async function (cont) {
    EDU.horariosEstilos();
    var ses = EDU.estado.sesion(), rol = ses.rol, centro = EDU.estado.centroActivo();
    var cab = function (acc) { return ui.cabecera({ eyebrow: 'Administración', titulo: 'Horarios', descripcion: 'Grilla semanal de lunes a viernes por franja, tanda, docente y aula.', acciones: acc }); };
    if (!centro) { cont.innerHTML = html(cab()) + html(ui.vacio({ titulo: 'Selecciona un centro', texto: 'Los horarios se gestionan por centro. Elige un centro en el selector superior.' })); return; }
    var editor = EDU.permisos.puede(rol, 'horarios', 'editar') && EDU.permisos.puedeEscribirColeccion(rol, 'horarios');
    var puedeCargas = EDU.permisos.puedeEscribirColeccion(rol, 'cargas');

    var D = await EDU.consultas.cargar(M.COLS);
    var al = EDU.permisos.alcance(ses, D);
    var S = { D: D, ctx: null, draft: [], legacy: [], vista: 'seccion', sel: {}, selCarga: null, dia: hoyDia() || 1, val: null, panel: null, tabs: null, fr: {}, cfgMsg: '' };
    var live = null;

    function reconstruir() { S.ctx = M.armar(S.D); }
    function leerHorarios() {
      var todos = S.D.horarios.filter(function (h) { return !al.cargaIds || al.cargaIds.has(h.cargaId); });
      S.draft = todos.filter(function (h) { return h.franjaId; }).map(copia);
      S.legacy = todos.filter(function (h) { return !h.franjaId; });
    }
    function revalidar() { S.val = M.validar(S.ctx, S.draft); }
    function anunciar(t) { if (live) live.textContent = t; }

    reconstruir(); leerHorarios(); revalidar();

    /* ---------- sujetos y filas ---------- */
    var cargaDe = function (id) { return S.ctx.cargaPor[id]; };
    function nombreSec(id) { return M.etiquetaSeccion(S.ctx, id); }
    function aulas() { var m = {}; S.draft.forEach(function (e) { var a = String(e.aula || '').trim(); if (a) m[a] = 1; }); return Object.keys(m).sort(); }
    function sujetos(vista) {
      if (vista === 'seccion') return S.ctx.secciones.filter(function (s) { return !al.seccionIds || al.seccionIds.has(s.id); })
        .map(function (s) { return { id: s.id, texto: nombreSec(s.id) }; }).sort(function (a, b) { return a.texto.localeCompare(b.texto, 'es'); });
      if (vista === 'docente') return rol === 'docente' ? [{ id: ses.refId, texto: M.nombreDoc(S.ctx, ses.refId) }] :
        Object.keys(S.ctx.docPor).map(function (id) { return { id: id, texto: M.nombreDoc(S.ctx, id) }; }).sort(function (a, b) { return a.texto.localeCompare(b.texto, 'es'); });
      return aulas().map(function (a) { return { id: a, texto: a }; });
    }
    function vistasPosibles() {
      if (rol === 'docente') return [['docente', 'Mi horario']];
      if (!editor) return [['seccion', 'Por sección']];
      return [['seccion', 'Por sección'], ['docente', 'Por docente'], ['aula', 'Por aula']];
    }
    function sujetoActual() {
      var l = sujetos(S.vista), id = S.sel[S.vista];
      if (!l.some(function (x) { return x.id === id; })) id = l[0] ? l[0].id : null;
      S.sel[S.vista] = id; return id;
    }
    function entradasDe(vista, id, lista) {
      return (lista || S.draft).filter(function (e) {
        var c = cargaDe(e.cargaId); if (!c) return false;
        return vista === 'seccion' ? c.seccionId === id : vista === 'docente' ? c.docenteId === id : fmt.norm(e.aula).trim() === fmt.norm(id).trim() && !!String(e.aula || '').trim();
      });
    }
    function filasDe(vista, id, ents) {
      var t = {};
      if (vista === 'seccion') { var s = S.ctx.seccionPor[id]; if (s) t[M.tandaDe(s)] = 1; }
      else {
        ents.forEach(function (e) { var f = S.ctx.franjaPor[e.franjaId]; if (f) t[f.tanda] = 1; });
        if (vista === 'docente') S.ctx.cargas.forEach(function (c) { if (c.docenteId === id && S.ctx.seccionPor[c.seccionId]) t[M.tandaDe(S.ctx.seccionPor[c.seccionId])] = 1; });
        if (!Object.keys(t).length) S.ctx.franjas.forEach(function (f) { t[f.tanda] = 1; });
      }
      return S.ctx.franjas.filter(function (f) { return t[f.tanda]; });
    }

    /* ---------- grilla ---------- */
    function textoEntrada(vista, e) {
      var c = cargaDe(e.cargaId); if (!c) return '?';
      return M.nombreAsig(S.ctx, c.asignaturaId) + (vista !== 'seccion' ? ', ' + nombreSec(c.seccionId) : '') + (vista !== 'docente' && c.docenteId ? ', ' + M.nombreDoc(S.ctx, c.docenteId) : '') + (e.aula ? ', aula ' + e.aula : '');
    }
    function htmlEntrada(vista, e, val, nuevos) {
      var c = cargaDe(e.cargaId); if (!c) return '';
      var k = M.key(e), tipos = (val.porEntrada[k] || []), asig = S.ctx.asigPor[c.asignaturaId];
      var l2 = vista === 'seccion' ? (c.docenteId ? M.nombreDoc(S.ctx, c.docenteId) : 'Sin docente') : vista === 'docente' ? nombreSec(c.seccionId) : nombreSec(c.seccionId) + ' · ' + M.nombreDoc(S.ctx, c.docenteId);
      return '<div class="hz-e' + (tipos.length ? ' mal' : '') + (nuevos && nuevos.has(k) ? ' nuevo' : '') + '" data-k="' + esc(k) + '" draggable="' + (S.edicion ? 'true' : 'false') + '" style="border-left-color:' + colorOk(asig && asig.color) + '">' +
        '<b>' + esc(M.nombreAsig(S.ctx, c.asignaturaId)) + '</b><span>' + esc(l2) + (e.aula ? ' · Aula ' + esc(e.aula) : '') + '</span>' +
        (tipos.length ? '<em>' + esc('Conflicto: ' + tipos.map(function (t) { return NOMBRE_CONF[t] || t; }).join(', ')) + '</em>' : '') + (nuevos && nuevos.has(k) ? '<span class="sr-only">Propuesto</span>' : '') + '</div>';
    }
    /** grilla({vista, id, ents, val, nuevos, edicion, etiqueta}) -> HTML */
    function grilla(o) {
      var rows = filasDe(o.vista, o.id, o.ents), hoy = hoyDia(), tandas = {};
      rows.forEach(function (f) { tandas[f.tanda] = 1; });
      var multi = Object.keys(tandas).length > 1;
      var h = '<div class="hz-scroll"><table class="hz' + (o.edicion ? '' : ' ro') + '" role="grid" aria-readonly="' + (o.edicion ? 'false' : 'true') + '" aria-label="' + esc(o.etiqueta || 'Horario semanal') + '" data-d="' + S.dia + '"><thead><tr><th scope="col" class="hz-h"><span class="sr-only">Franja</span></th>';
      DIAS.forEach(function (n, i) { h += '<th scope="col" data-dia="' + (i + 1) + '"' + (hoy === i + 1 ? ' class="hoy" aria-current="date"' : '') + '>' + esc(n) + (hoy === i + 1 ? ' <small>(hoy)</small>' : '') + '</th>'; });
      h += '</tr></thead><tbody>';
      var primera = true;
      rows.forEach(function (f) {
        var lbl = '<th scope="row" class="hz-h">' + esc(f.inicio) + '–' + esc(f.fin) + (multi ? '<small>' + esc(H.TANDAS[f.tanda] || f.tanda) + '</small>' : '') + '</th>';
        if (f.tipo !== 'clase') { h += '<tr class="hz-pausa">' + lbl + '<td colspan="5">' + esc(H.TIPOS[f.tipo] || f.tipo) + '</td></tr>'; return; }
        h += '<tr>' + lbl;
        for (var d = 1; d <= 5; d++) {
          var en = o.ents.filter(function (e) { return +e.dia === d && e.franjaId === f.id; });
          var nd = o.vista === 'docente' && M.noDisponible(S.ctx, o.id, d, f);
          var lab = DIAS[d - 1] + ' ' + f.inicio + ' a ' + f.fin + ': ' + (en.length ? en.map(function (e) { var t = o.val.porEntrada[M.key(e)]; return textoEntrada(o.vista, e) + (t && t.length ? '. Conflicto: ' + t.map(function (x) { return NOMBRE_CONF[x] || x; }).join(', ') : ''); }).join('; ') : (nd ? 'docente no disponible' : 'libre'));
          h += '<td class="hz-c' + (hoy === d ? ' hoy' : '') + (nd ? ' nodisp' : '') + '" role="gridcell" data-dia="' + d + '" data-f="' + esc(f.id) + '" tabindex="' + (primera ? 0 : -1) + '" aria-label="' + esc(lab) + '">';
          primera = false;
          h += en.map(function (e) { return htmlEntrada(o.vista, e, o.val, o.nuevos); }).join('') + (nd && !en.length ? '<span class="nd">No disponible</span>' : '') + '</td>';
        }
        h += '</tr>';
      });
      return h + '</tbody></table></div>';
    }
    function sinFranjas(vista, id) {
      return html(ui.vacio({ titulo: 'No hay franjas configuradas para esta tanda', texto: 'Configura las franjas de la tanda (clases, recreo, almuerzo) para armar la grilla.' })) +
        (editor ? '<p><button type="button" class="btn amb" data-a="ir-franjas">Ir a franjas y tandas</button></p>' : '');
    }

    /* ---------- cambios del borrador ---------- */
    function diff() {
      var orig = {}; S.D.horarios.filter(function (h) { return h.franjaId && (!al.cargaIds || al.cargaIds.has(h.cargaId)); }).forEach(function (h) { orig[h.id] = h; });
      var crear = [], act = [], vistos = {};
      S.draft.forEach(function (e) {
        if (!e.id) { crear.push(e); return; }
        vistos[e.id] = 1; var o = orig[e.id];
        if (o && (o.cargaId !== e.cargaId || +o.dia !== +e.dia || o.franjaId !== e.franjaId || (o.aula || '') !== (e.aula || ''))) act.push(e);
      });
      var borrar = Object.keys(orig).filter(function (id) { return !vistos[id]; });
      return { crear: crear, act: act, borrar: borrar, n: crear.length + act.length + borrar.length, orig: orig };
    }
    function cambio(msg) { revalidar(); repintarHorario(); if (msg) anunciar(msg); }
    function aulaBase(seccionId) {
      var a = {}; S.draft.forEach(function (e) { var c = cargaDe(e.cargaId); if (c && c.seccionId === seccionId && e.aula) a[String(e.aula).trim()] = 1; });
      var k = Object.keys(a); return k.length === 1 ? k[0] : '';
    }
    function colocar(cargaId, dia, fid, aula) {
      var c = cargaDe(cargaId); if (!c) return;
      S.draft.push({ _k: 'n' + (++seq), cargaId: cargaId, dia: dia, franjaId: fid, aula: aula != null ? aula : aulaBase(c.seccionId) });
      var f = S.ctx.franjaPor[fid];
      cambio('Asignado ' + M.nombreAsig(S.ctx, c.asignaturaId) + ' el ' + DIAS[dia - 1] + ' ' + (f ? f.inicio : '') + '.');
    }
    function buscar(k) { return S.draft.filter(function (e) { return M.key(e) === k; })[0]; }
    function quitar(k) {
      S.draft = S.draft.filter(function (e) { return M.key(e) !== k; });
      cambio('Bloque quitado.');
    }
    function mover(k, dia, fid) {
      var e = buscar(k); if (!e || (e.dia === dia && e.franjaId === fid)) return;
      e.dia = dia; e.franjaId = fid; cambio('Bloque movido al ' + DIAS[dia - 1] + '.');
    }

    /* ---------- dialogo de bloque ---------- */
    function candidatas(dia, fid) {
      var f = S.ctx.franjaPor[fid], id = sujetoActual();
      var l = S.ctx.cargas.filter(function (c) { return S.vista === 'docente' ? c.docenteId === id : c.seccionId === id; });
      var igual = l.filter(function (c) { var s = S.ctx.seccionPor[c.seccionId]; return !f || !s || M.tandaDe(s) === f.tanda; });
      return igual.length ? igual : l;
    }
    function dialogo(dia, fid, k) {
      if (!S.edicion) return;
      var ent = k ? buscar(k) : null, f = S.ctx.franjaPor[fid], cands = candidatas(dia, fid);
      if (!cands.length) { ui.toast('No hay cargas (docente + asignatura) para asignar aquí.', 'warn'); return; }
      var caja = document.createElement('div');
      var opts = cands.map(function (c) {
        var n = S.val.horasCarga[c.id] || 0, req = M.horasDe(c);
        return '<option value="' + esc(c.id) + '"' + ((ent ? ent.cargaId : S.selCarga) === c.id ? ' selected' : '') + '>' + esc(M.nombreAsig(S.ctx, c.asignaturaId) + ' · ' + (S.vista === 'docente' ? nombreSec(c.seccionId) : M.nombreDoc(S.ctx, c.docenteId)) + ' (' + n + '/' + req + ' h)') + '</option>';
      }).join('');
      caja.innerHTML = '<p style="margin:0 0 10px"><strong>' + esc(DIAS[dia - 1]) + ' ' + esc(f ? f.inicio + '–' + f.fin : '') + '</strong></p>' +
        '<div class="fgrid"><label class="fld full">Carga (docente + asignatura)<select data-c="carga">' + opts + '</select></label>' +
        '<label class="fld full">Aula (opcional)<input data-c="aula" list="hz-aulas" maxlength="40" value="' + esc(ent ? ent.aula : '') + '"></label></div>' +
        '<datalist id="hz-aulas">' + aulas().map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
        '<div class="hz-val" role="status" aria-live="polite" data-c="prev" style="margin-top:12px"></div>';
      var sel = caja.querySelector('[data-c=carga]'), inp = caja.querySelector('[data-c=aula]'), prev = caja.querySelector('[data-c=prev]'), btn;
      function prever() {
        var tmp = { _k: '_tmp', cargaId: sel.value, dia: dia, franjaId: fid, aula: inp.value };
        var base = S.draft.filter(function (e) { return !ent || M.key(e) !== M.key(ent); }), v = M.validar(S.ctx, base.concat([tmp]));
        var mal = v.conflictos.filter(function (c) { return c.claves.indexOf('_tmp') >= 0; });
        prev.innerHTML = mal.length ? '<div class="alert red"><div><strong>Conflictos (impedirán guardar)</strong><ul>' + mal.map(function (c) { return '<li>' + esc(c.msg) + '</li>'; }).join('') + '</ul></div></div>' : '<div class="alert ok"><div><strong>Sin conflictos</strong></div></div>';
        if (btn) btn.textContent = mal.length ? 'Colocar con conflictos' : (ent ? 'Guardar bloque' : 'Colocar');
      }
      sel.addEventListener('change', prever); inp.addEventListener('input', prever);
      var botones = [{ texto: 'Cancelar', tipo: 'sec', valor: null }];
      if (ent) botones.push({ texto: 'Quitar bloque', tipo: 'dng', alClic: function (cerrar) { quitar(M.key(ent)); cerrar('q'); } });
      botones.push({ texto: 'Colocar', tipo: 'amb', alClic: function (cerrar) {
        if (ent) { ent.cargaId = sel.value; ent.aula = inp.value.trim(); cambio('Bloque actualizado.'); } else colocar(sel.value, dia, fid, inp.value.trim());
        cerrar('ok');
      } });
      var m = ui.modal({ titulo: ent ? 'Editar bloque' : 'Asignar clase', contenido: caja, botones: botones });
      btn = m.el.querySelector('.modal-foot button.amb'); prever();
      m.resultado.then(function () { enfocarCelda(dia, fid); });
    }
    function enfocarCelda(dia, fid) {
      var p = S.panel; if (!p) return;
      var td = Array.prototype.filter.call(p.querySelectorAll('td.hz-c'), function (x) { return +x.dataset.dia === dia && x.dataset.f === fid; })[0];
      if (td) { var cur = p.querySelector('td.hz-c[tabindex="0"]'); if (cur) cur.tabIndex = -1; td.tabIndex = 0; td.focus(); }
    }

    /* ---------- guardar ---------- */
    function aRegistro(e, base) {
      var f = S.ctx.franjaPor[e.franjaId];
      return Object.assign({}, base || {}, { centroId: centro, cargaId: e.cargaId, dia: +e.dia, franjaId: e.franjaId, aula: e.aula || '', hora: f ? f.inicio : '', duracion: f ? M.mins(f.fin) - M.mins(f.inicio) : 45 });
    }
    /** Persiste el borrador (y opcionalmente descarta bloques heredados de las cargas indicadas). */
    async function persistir(descartarLegacyCargas) {
      var d = diff(), n = 0;
      for (var i = 0; i < d.borrar.length; i++) { await EDU.repo.borrar('horarios', d.borrar[i]); n++; }
      for (var j = 0; j < d.act.length; j++) { await EDU.repo.guardar('horarios', aRegistro(d.act[j], d.orig[d.act[j].id])); n++; }
      if (d.crear.length) { await EDU.repo.guardarMuchos('horarios', d.crear.map(function (e) { return aRegistro(e); })); n += d.crear.length; }
      if (descartarLegacyCargas) {
        var ids = S.legacy.filter(function (h) { return descartarLegacyCargas.indexOf(h.cargaId) >= 0; });
        for (var k = 0; k < ids.length; k++) await EDU.repo.borrar('horarios', ids[k].id);
      }
      S.D.horarios = await EDU.repo.listar('horarios'); leerHorarios(); revalidar();
      return n;
    }
    async function guardar() {
      if (S.val.conflictos.length) { ui.toast('Hay ' + S.val.conflictos.length + ' conflicto(s): corrígelos para poder guardar.', 'error'); return; }
      try { var n = await persistir(null); ui.toast('Horario guardado (' + n + ' cambio' + (n === 1 ? '' : 's') + ').', 'ok'); }
      catch (e) { ui.toast(e.message || 'No se pudo guardar.', 'error'); }
      repintarTodo();
    }
    async function descartar() {
      if (diff().n && !(await ui.confirmar({ titulo: 'Descartar cambios', mensaje: 'Se perderán los cambios sin guardar del horario.', textoOk: 'Descartar', peligro: true }))) return;
      leerHorarios(); revalidar(); repintarHorario(); anunciar('Cambios descartados.');
    }

    /* ---------- impresion y CSV ---------- */
    function cabeceraImpresion(vista, id) {
      var tipo = vista === 'seccion' ? 'Sección' : vista === 'docente' ? 'Docente' : 'Aula';
      var txt = vista === 'seccion' ? nombreSec(id) : vista === 'docente' ? M.nombreDoc(S.ctx, id) : id;
      return '<div class="hz-print"><h2>Horario semanal · ' + esc(tipo) + ': ' + esc(txt) + '</h2><p>' + esc(ses.nombre || '') + ' · impreso el ' + esc(fmt.fecha(fmt.hoy(), true)) + '</p></div>';
    }
    function imprimir() { window.print(); }
    function imprimirLote(vista) {
      var l = sujetos(vista), box = document.createElement('div'); box.className = 'hz-print hz-lote';
      var vacio = { conflictos: [], avisos: [], porEntrada: {} };
      box.innerHTML = l.map(function (s) {
        var ents = entradasDe(vista, s.id);
        return '<section class="hz-lote-pagina">' + cabeceraImpresion(vista, s.id) + grilla({ vista: vista, id: s.id, ents: ents, val: S.val || vacio, edicion: false, etiqueta: 'Horario de ' + s.texto }) + '</section>';
      }).join('');
      document.body.appendChild(box); document.body.classList.add('hz-lote-on');
      var fin = function () { document.body.classList.remove('hz-lote-on'); if (box.parentNode) box.parentNode.removeChild(box); window.removeEventListener('afterprint', fin); };
      window.addEventListener('afterprint', fin); setTimeout(fin, 60000);
      window.print();
    }
    function descargar(nombre, texto) {
      var blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 500);
    }
    function csv(ambito) {
      var vista = S.vista, id = sujetoActual(), ents = ambito === 'todo' ? S.draft : entradasDe(vista, id);
      var filas = [['Día', 'Inicio', 'Fin', 'Tanda', 'Sección', 'Asignatura', 'Docente', 'Aula']];
      ents.slice().sort(function (a, b) { return a.dia - b.dia || M.mins((S.ctx.franjaPor[a.franjaId] || {}).inicio) - M.mins((S.ctx.franjaPor[b.franjaId] || {}).inicio); }).forEach(function (e) {
        var c = cargaDe(e.cargaId), f = S.ctx.franjaPor[e.franjaId]; if (!c || !f) return;
        filas.push([DIAS[e.dia - 1], f.inicio, f.fin, H.TANDAS[f.tanda] || f.tanda, nombreSec(c.seccionId), M.nombreAsig(S.ctx, c.asignaturaId), c.docenteId ? M.nombreDoc(S.ctx, c.docenteId) : '', e.aula || '']);
      });
      var nombre = ambito === 'todo' ? 'horarios-centro' : 'horario-' + vista + '-' + slug(vista === 'seccion' ? nombreSec(id) : vista === 'docente' ? M.nombreDoc(S.ctx, id) : id);
      descargar(nombre + '.csv', filas.map(M.csvFila).join('\r\n'));
      ui.toast('CSV exportado (' + (filas.length - 1) + ' bloques).', 'ok');
    }

    /* ---------- pestaña Horario ---------- */
    function repintarHorario() { if (S.panel) pintarHorario(S.panel); }
    function pintarHorario(panel) {
      S.panel = panel; S.edicion = editor && S.vista !== 'aula';
      var prevFoco = document.activeElement && panel.contains(document.activeElement) && document.activeElement.matches && document.activeElement.matches('td.hz-c') ? { d: +document.activeElement.dataset.dia, f: document.activeElement.dataset.f } : null;
      var vp = vistasPosibles(); if (!vp.some(function (v) { return v[0] === S.vista; })) S.vista = vp[0][0];
      S.edicion = editor && S.vista !== 'aula';
      var id = sujetoActual(), ents = id == null ? [] : entradasDe(S.vista, id), d = diff(), val = S.val, h = '';
      /* avisos de configuracion */
      if (editor && !S.ctx.franjas.length) h += '<div class="alert no-print"><div><strong>Aún no hay franjas configuradas</strong><small>Crea las franjas de cada tanda (hay plantillas de ejemplo editables) para poder armar horarios.</small></div><button type="button" class="btn amb sm" data-a="ir-franjas">Configurar franjas</button></div>';
      if (editor && S.legacy.length) h += '<div class="alert no-print"><div><strong>Hay ' + S.legacy.length + ' bloques de un horario anterior (sin franja)</strong><small>No aparecen en la grilla. Descártalos cuando el horario nuevo esté listo; planificación sigue mostrándolos mientras no haya horario con franjas.</small></div><button type="button" class="btn sec sm" data-a="legacy">Descartar horario anterior</button></div>';
      /* kpis */
      if (editor) {
        var req = 0, asig = 0; S.ctx.cargas.forEach(function (c) { var r = M.horasDe(c); req += r; asig += Math.min(r, val.horasCarga[c.id] || 0); });
        h += '<div class="no-print">' + html(ui.kpis([
          { etiqueta: 'Cobertura de horas', valor: req ? Math.round(asig / req * 100) + ' %' : '—', detalle: asig + ' de ' + req + ' horas semanales', tono: req && asig === req ? 'ok' : 'neu' },
          { etiqueta: 'Conflictos', valor: val.conflictos.length, detalle: val.conflictos.length ? 'Bloquean el guardado' : 'Todo en orden', tono: val.conflictos.length ? 'bad' : 'ok' },
          { etiqueta: 'Avisos', valor: val.avisos.length, detalle: 'Horas incompletas y sobrecargas', tono: val.avisos.length ? 'warn' : 'ok' }])) + '</div>';
      }
      /* barra */
      h += '<div class="hz-barra no-print"><div role="status" aria-live="polite" id="hz-estado">' +
        (editor ? (d.n ? html(ui.badge(d.n + ' cambios sin guardar', 'warn')) : html(ui.badge('Todo guardado', 'ok'))) + (val.conflictos.length ? ' ' + html(ui.badge(val.conflictos.length + ' conflictos', 'bad')) : '') : html(ui.badge('Solo lectura', 'neu'))) + '</div><div class="acc">' +
        (editor ? '<button type="button" class="btn amb" data-a="guardar"' + (!d.n || val.conflictos.length ? ' aria-disabled="true" disabled' : '') + '>Guardar horario</button><button type="button" class="btn sec" data-a="descartar"' + (d.n ? '' : ' disabled') + '>Descartar cambios</button><button type="button" class="btn" data-a="proponer">Proponer horario automático</button>' : '') +
        '<button type="button" class="btn sec" data-a="imprimir">Imprimir</button>' + (editor ? '<button type="button" class="btn sec" data-a="imprimir-lote">Imprimir todos</button>' : '') +
        '<button type="button" class="btn sec" data-a="csv">Exportar CSV</button>' + (editor ? '<button type="button" class="btn sec" data-a="csv-todo">CSV de todo el centro</button>' : '') + '</div></div>';
      /* controles */
      h += '<div class="hz-ctrl no-print">';
      if (vp.length > 1) h += '<label class="fld">Ver horario<select data-sel="vista">' + vp.map(function (v) { return '<option value="' + v[0] + '"' + (S.vista === v[0] ? ' selected' : '') + '>' + esc(v[1]) + '</option>'; }).join('') + '</select></label>';
      var lista = sujetos(S.vista);
      if (rol !== 'docente' && (lista.length > 1 || S.vista === 'aula' || !lista.length)) {
        h += '<label class="fld">' + (S.vista === 'seccion' ? 'Sección' : S.vista === 'docente' ? 'Docente' : 'Aula') + '<select data-sel="sujeto">' + (lista.length ? lista.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === id ? ' selected' : '') + '>' + esc(s.texto) + '</option>'; }).join('') : '<option value="">(sin opciones)</option>') + '</select></label>';
      }
      h += '</div>';
      /* paleta */
      if (S.edicion && id != null) {
        var cs = S.ctx.cargas.filter(function (c) { return S.vista === 'docente' ? c.docenteId === id : c.seccionId === id; });
        h += '<div class="no-print"><p class="note" style="margin:0 0 6px">Arrastra una carga a la grilla, o selecciónala y pulsa Intro sobre una celda. También puedes arrastrar los bloques para moverlos.</p><div class="hz-pal" role="group" aria-label="Cargas para asignar">' + cs.map(function (c) {
          var n = val.horasCarga[c.id] || 0, r = M.horasDe(c), a = S.ctx.asigPor[c.asignaturaId];
          return '<button type="button" class="hz-chip' + (r && n >= r ? ' ok' : '') + '" draggable="true" data-chip="' + esc(c.id) + '" aria-pressed="' + (S.selCarga === c.id ? 'true' : 'false') + '" style="border-left-color:' + colorOk(a && a.color) + '">' +
            esc(M.nombreAsig(S.ctx, c.asignaturaId)) + '<small>' + esc(S.vista === 'docente' ? nombreSec(c.seccionId) : (c.docenteId ? M.nombreDoc(S.ctx, c.docenteId) : 'Sin docente')) + ' · ' + n + '/' + r + ' h</small></button>';
        }).join('') + '</div></div>';
      }
      /* selector de dia (movil) */
      h += '<div class="hz-dias no-print" role="group" aria-label="Día de la semana">' + DIAS.map(function (n, i) { return '<button type="button" class="btn sec sm" data-dia-sel="' + (i + 1) + '" aria-pressed="' + (S.dia === i + 1) + '">' + esc(H.DIAS_CORTO[i]) + (hoyDia() === i + 1 ? ' · hoy' : '') + '</button>'; }).join('') + '</div>';
      /* grilla */
      if (id == null) h += html(ui.vacio({ titulo: 'Sin datos para mostrar', texto: S.vista === 'aula' ? 'Aún no hay aulas asignadas. Escribe el aula al asignar un bloque.' : 'No hay secciones o docentes en este centro.' }));
      else if (!filasDe(S.vista, id, ents).length) h += sinFranjas();
      else h += cabeceraImpresion(S.vista, id) + '<div class="card" style="padding:12px">' + grilla({ vista: S.vista, id: id, ents: ents, val: val, edicion: S.edicion, etiqueta: 'Horario semanal de ' + (lista.filter(function (s) { return s.id === id; })[0] || { texto: '' }).texto }) + '</div>' +
        (S.vista === 'aula' ? '<p class="note no-print">La vista por aula es informativa: el aula se escribe al asignar cada bloque desde la vista por sección o por docente.</p>' : '');
      /* validaciones */
      h += '<div class="hz-val no-print" id="hz-val" aria-live="polite">';
      if (val.conflictos.length) h += '<div class="alert red"><div><strong>' + esc(val.conflictos.length + ' conflicto(s) · no se puede guardar') + '</strong><ul>' + val.conflictos.slice(0, 12).map(function (c) { return '<li>' + esc(c.msg) + '</li>'; }).join('') + (val.conflictos.length > 12 ? '<li>…y ' + (val.conflictos.length - 12) + ' más.</li>' : '') + '</ul></div></div>';
      if (editor && val.avisos.length) h += '<div class="alert"><div><strong>' + esc(val.avisos.length + ' aviso(s)') + '</strong><ul>' + val.avisos.slice(0, 10).map(function (a) { return '<li>' + esc(a.msg) + '</li>'; }).join('') + (val.avisos.length > 10 ? '<li>…y ' + (val.avisos.length - 10) + ' más (ver pestañas Cobertura y Carga docente).</li>' : '') + '</ul></div></div>';
      h += '</div><div class="sr-only" id="hz-live" aria-live="polite"></div>';
      panel.innerHTML = h; live = panel.querySelector('#hz-live');
      if (prevFoco) enfocarCelda(prevFoco.d, prevFoco.f);
      if (!panel._hz) { panel._hz = true; cablear(panel); }
    }

    function celdas(tabla) { return Array.prototype.map.call(tabla.querySelectorAll('tbody tr:not(.hz-pausa)'), function (tr) { return Array.prototype.slice.call(tr.querySelectorAll('td.hz-c')); }); }
    function cablear(panel) {
      panel.addEventListener('click', function (ev) {
        var t = ev.target, b = t.closest('[data-a]');
        if (b && !b.disabled) {
          var a = b.dataset.a;
          if (a === 'guardar') guardar(); else if (a === 'descartar') descartar(); else if (a === 'proponer') proponerUI(); else if (a === 'imprimir') imprimir();
          else if (a === 'imprimir-lote') imprimirLote(S.vista); else if (a === 'csv') csv('vista'); else if (a === 'csv-todo') csv('todo');
          else if (a === 'ir-franjas') S.tabs && S.tabs.seleccionar('franjas', true);
          else if (a === 'legacy') descartarLegacy();
          return;
        }
        var ds = t.closest('[data-dia-sel]'); if (ds) { S.dia = +ds.dataset.diaSel; repintarHorario(); var nb = panel.querySelector('[data-dia-sel="' + S.dia + '"]'); if (nb) nb.focus(); return; }
        var chip = t.closest('[data-chip]'); if (chip) { S.selCarga = S.selCarga === chip.dataset.chip ? null : chip.dataset.chip; repintarHorario(); var nc = panel.querySelector('[data-chip="' + chip.dataset.chip + '"]'); if (nc) nc.focus(); return; }
        if (!S.edicion) return;
        var td = t.closest('td.hz-c'); if (!td) return;
        activar(td, t.closest('.hz-e'));
      });
      panel.addEventListener('change', function (ev) {
        var s = ev.target.closest('select[data-sel]'); if (!s) return;
        if (s.dataset.sel === 'vista') { S.vista = s.value; S.selCarga = null; } else S.sel[S.vista] = s.value;
        repintarHorario(); var ns = panel.querySelector('select[data-sel="' + s.dataset.sel + '"]'); if (ns) ns.focus();
      });
      panel.addEventListener('keydown', function (ev) {
        var td = ev.target.closest && ev.target.closest('td.hz-c'); if (!td || ev.target !== td) return;
        var tabla = td.closest('table'), m = celdas(tabla), r = -1, c = -1;
        m.forEach(function (fila, i) { var j = fila.indexOf(td); if (j >= 0) { r = i; c = j; } });
        var dr = 0, dc = 0, k = ev.key;
        if (k === 'ArrowDown') dr = 1; else if (k === 'ArrowUp') dr = -1; else if (k === 'ArrowRight') dc = 1; else if (k === 'ArrowLeft') dc = -1;
        else if (k === 'Home') { c = 0; dc = 0; } else if (k === 'End') { c = m[r].length - 1; dc = 0; }
        else if (k === 'Enter' || k === ' ') { ev.preventDefault(); if (S.edicion) activar(td, td.querySelector('.hz-e')); return; }
        else if ((k === 'Delete' || k === 'Backspace') && S.edicion) { var e1 = td.querySelector('.hz-e'); if (e1) { ev.preventDefault(); var dd = +td.dataset.dia, ff = td.dataset.f; quitar(e1.dataset.k); enfocarCelda(dd, ff); } return; }
        else return;
        ev.preventDefault();
        var nr = r + dr, nc = c + dc, dest = null;
        while (nr >= 0 && nr < m.length && nc >= 0 && nc < m[nr].length) {
          if (m[nr][nc].offsetParent !== null || (dr === 0 && dc === 0)) { dest = m[nr][nc]; break; }
          nr += dr; nc += dc; if (dr === 0 && dc === 0) break;
        }
        if (!dest && dr === 0 && dc === 0) dest = m[r][c];
        if (dest) { td.tabIndex = -1; dest.tabIndex = 0; dest.focus(); }
      });
      /* arrastrar y soltar */
      var arrastre = null;
      panel.addEventListener('dragstart', function (ev) {
        if (!S.edicion) { ev.preventDefault(); return; }
        var chip = ev.target.closest && ev.target.closest('[data-chip]'), e = ev.target.closest && ev.target.closest('.hz-e');
        arrastre = chip ? { tipo: 'car', id: chip.dataset.chip } : e ? { tipo: 'ent', id: e.dataset.k } : null;
        if (arrastre && ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', arrastre.tipo + ':' + arrastre.id); } catch (x) { /* ok */ } }
      });
      panel.addEventListener('dragover', function (ev) { var td = ev.target.closest && ev.target.closest('td.hz-c'); if (!td || !S.edicion || !arrastre) return; ev.preventDefault(); td.classList.add('drop'); });
      panel.addEventListener('dragleave', function (ev) { var td = ev.target.closest && ev.target.closest('td.hz-c'); if (td) td.classList.remove('drop'); });
      panel.addEventListener('dragend', function () { arrastre = null; Array.prototype.forEach.call(panel.querySelectorAll('td.drop'), function (x) { x.classList.remove('drop'); }); });
      panel.addEventListener('drop', function (ev) {
        var td = ev.target.closest && ev.target.closest('td.hz-c'); if (!td || !S.edicion) return;
        ev.preventDefault(); td.classList.remove('drop');
        var a = arrastre; arrastre = null;
        if (!a && ev.dataTransfer) { var p = (ev.dataTransfer.getData('text/plain') || '').split(':'); if (p.length > 1) a = { tipo: p[0], id: p.slice(1).join(':') }; }
        if (!a) return;
        var dia = +td.dataset.dia, fid = td.dataset.f;
        if (a.tipo === 'car') colocar(a.id, dia, fid); else if (a.tipo === 'ent') mover(a.id, dia, fid);
        enfocarCelda(dia, fid);
      });
    }
    function activar(td, entEl) {
      var dia = +td.dataset.dia, fid = td.dataset.f;
      if (S.selCarga && !entEl) { colocar(S.selCarga, dia, fid); enfocarCelda(dia, fid); return; }
      dialogo(dia, fid, entEl ? entEl.dataset.k : null);
    }
    async function descartarLegacy() {
      if (!(await ui.confirmar({ titulo: 'Descartar horario anterior', mensaje: 'Se eliminarán ' + S.legacy.length + ' bloques del horario anterior (sin franja). Esta acción no se puede deshacer.', textoOk: 'Descartar', peligro: true }))) return;
      try { for (var i = 0; i < S.legacy.length; i++) await EDU.repo.borrar('horarios', S.legacy[i].id); S.D.horarios = await EDU.repo.listar('horarios'); leerHorarios(); ui.toast('Horario anterior descartado.', 'ok'); }
      catch (e) { ui.toast(e.message, 'error'); }
      repintarTodo();
    }

    /* ---------- propuesta automatica ---------- */
    function proponerUI() {
      var ctxD = Object.assign({}, S.ctx, { horarios: S.draft.filter(function (e) { return S.ctx.franjaPor[e.franjaId] && S.ctx.cargaPor[e.cargaId]; }) });
      var secs = sujetos('seccion'), pr = H.proponedores(), res = null, alcSel = null;
      var caja = document.createElement('div');
      caja.innerHTML = '<p style="margin-top:0">Genera una <strong>propuesta</strong> que respeta docentes, secciones, disponibilidad y franjas de clase. No se guarda nada hasta que la apruebes.</p>' +
        '<div class="fgrid"><label class="fld">Alcance<select data-p="alcance"><option value="">Todas las secciones</option>' + secs.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.texto) + '</option>'; }).join('') + '</select></label>' +
        (pr.length > 1 ? '<label class="fld">Proponedor<select data-p="prov">' + pr.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.etiqueta) + '</option>'; }).join('') + '</select></label>' : '') +
        '<label class="fld full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-p="conservar" checked style="width:auto"> Conservar lo ya asignado (solo completar horas faltantes)</label></div>' +
        '<p><button type="button" class="btn amb" data-p="gen">Generar propuesta</button></p><div data-p="out" role="region" aria-live="polite" aria-label="Vista previa de la propuesta"></div>';
      var out = caja.querySelector('[data-p=out]'), m;
      function pintarResultado(secId) {
        var v = res.validacion, nuevos = new Set(res.asignaciones.map(function (a, i) { return 'p' + i; }));
        var sin = res.sinColocar.reduce(function (s, x) { return s + x.faltan; }, 0);
        var h = '<h3 style="margin:14px 0 8px">Vista previa</h3><div class="chips">' + html(ui.badge(res.asignaciones.length + ' bloques propuestos', 'info')) + ' ' + html(ui.badge(v.conflictos.length + ' conflictos', v.conflictos.length ? 'bad' : 'ok')) + ' ' + html(ui.badge(sin + ' horas sin colocar', sin ? 'warn' : 'ok')) + '</div>';
        if (v.conflictos.length) h += '<div class="alert red"><div><strong>Conflictos en la propuesta (no se puede aprobar)</strong><ul>' + v.conflictos.slice(0, 8).map(function (c) { return '<li>' + esc(c.msg) + '</li>'; }).join('') + '</ul></div></div>';
        if (res.sinColocar.length) h += '<div class="alert"><div><strong>No se pudieron colocar todas las horas</strong><ul>' + res.sinColocar.slice(0, 8).map(function (x) { var c = S.ctx.cargaPor[x.cargaId]; return '<li>' + esc(M.etiquetaCarga(S.ctx, c) + ': faltan ' + x.faltan + ' h') + '</li>'; }).join('') + '</ul></div></div>';
        var sobre = v.avisos.filter(function (a) { return a.tipo === 'sobrecarga'; });
        if (sobre.length) h += '<div class="alert"><div><strong>Avisos de sobrecarga</strong><ul>' + sobre.map(function (a) { return '<li>' + esc(a.msg) + '</li>'; }).join('') + '</ul></div></div>';
        var ver = secId || (secs[0] && secs[0].id);
        h += '<label class="fld" style="max-width:320px;margin:12px 0">Ver sección<select data-p="ver">' + secs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === ver ? ' selected' : '') + '>' + esc(s.texto) + '</option>'; }).join('') + '</select></label>';
        var ents = res.todo.filter(function (e) { var c = S.ctx.cargaPor[e.cargaId]; return c && c.seccionId === ver; });
        h += '<div class="card" style="padding:10px">' + grilla({ vista: 'seccion', id: ver, ents: ents, val: v, nuevos: nuevos, edicion: false, etiqueta: 'Propuesta para ' + nombreSec(ver) }) + '</div><p class="note">Los bloques con borde ámbar son nuevos.</p>';
        h += '<div class="toolbar" style="margin-top:14px"><button type="button" class="btn amb" data-p="aprobar"' + (v.conflictos.length ? ' disabled' : '') + '>Aprobar y guardar</button><button type="button" class="btn sec" data-p="editor"' + (v.conflictos.length ? ' disabled' : '') + '>Cargar en el editor sin guardar</button><button type="button" class="btn sec" data-p="descartar">Descartar propuesta</button></div>';
        out.innerHTML = h;
      }
      caja.addEventListener('change', function (ev) { var s = ev.target.closest('[data-p=ver]'); if (s && res) pintarResultado(s.value); });
      caja.addEventListener('click', async function (ev) {
        var b = ev.target.closest('button[data-p]'); if (!b) return; var a = b.dataset.p;
        if (a === 'gen') {
          b.disabled = true; out.innerHTML = '<p class="note">Calculando…</p>';
          try {
            var provSel = caja.querySelector('[data-p=prov]');
            alcSel = caja.querySelector('[data-p=alcance]').value || null;
            res = await H.proponer(ctxD, { seccionId: alcSel, conservar: caja.querySelector('[data-p=conservar]').checked }, provSel ? provSel.value : 'local');
            pintarResultado(caja.querySelector('[data-p=alcance]').value || null);
          } catch (e) { out.innerHTML = '<div class="alert red"><div><strong>No se pudo generar la propuesta</strong><small>' + esc(e.message) + '</small></div></div>'; }
          b.disabled = false;
        } else if (a === 'descartar') { res = null; out.innerHTML = ''; }
        else if ((a === 'aprobar' || a === 'editor') && res && !res.validacion.conflictos.length) {
          var nuevoDraft = res.todo.map(function (e) { return e.id ? copia(e) : { _k: 'n' + (++seq), cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId, aula: e.aula || '' }; });
          if (a === 'editor') { S.draft = nuevoDraft; cambio('Propuesta cargada en el editor.'); m.cerrar('ok'); ui.toast('Propuesta cargada en el editor. Revisa y guarda.', 'info'); return; }
          var cargasAlc = S.ctx.cargas.filter(function (c) { return !alcSel || c.seccionId === alcSel; }).map(function (c) { return c.id; });
          var ok = await ui.confirmar({ titulo: 'Aprobar propuesta de horario', mensaje: 'Se guardarán ' + res.asignaciones.length + ' bloques nuevos en el horario del centro' + (res.fijos.length < S.draft.length ? ' y se reemplazarán los bloques actuales del alcance elegido' : '') + (S.legacy.length ? '; los bloques del horario anterior de esas cargas se descartarán' : '') + '. ¿Aprobar?', textoOk: 'Aprobar y guardar' });
          if (!ok) return;
          var anterior = S.draft; S.draft = nuevoDraft; revalidar();
          try { var n = await persistir(cargasAlc); ui.toast('Propuesta aprobada y guardada (' + n + ' cambios).', 'ok'); m.cerrar('ok'); }
          catch (e) { S.draft = anterior; revalidar(); ui.toast(e.message || 'No se pudo guardar.', 'error'); }
          repintarTodo();
        }
      });
      m = ui.modal({ titulo: 'Proponer horario automático', tamano: 'lg', contenido: caja, botones: [{ texto: 'Cerrar', tipo: 'sec', valor: null }] });
    }

    /* ---------- pestaña Cobertura ---------- */
    function tabCobertura(panel) {
      var f = S.cobSec || '', val = S.val, secs = sujetos('seccion');
      var cs = S.ctx.cargas.filter(function (c) { return !f || c.seccionId === f; }).sort(function (a, b) { return nombreSec(a.seccionId).localeCompare(nombreSec(b.seccionId), 'es') || M.nombreAsig(S.ctx, a.asignaturaId).localeCompare(M.nombreAsig(S.ctx, b.asignaturaId), 'es'); });
      var h = '<p class="note" style="margin-top:0">Horas semanales por asignatura (una hora = un periodo de clase). Incluye los cambios sin guardar del borrador.</p><div class="hz-ctrl"><label class="fld">Sección<select data-f="sec"><option value="">Todas</option>' + secs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === f ? ' selected' : '') + '>' + esc(s.texto) + '</option>'; }).join('') + '</select></label></div>';
      h += '<div class="card"><div class="tw"><table class="t"><caption class="sr-only">Cobertura de horas por carga</caption><thead><tr><th scope="col">Sección</th><th scope="col">Asignatura</th><th scope="col">Docente</th><th scope="col">Horas semanales</th><th scope="col">Asignadas</th><th scope="col">Avance</th><th scope="col">Estado</th></tr></thead><tbody>';
      cs.forEach(function (c) {
        var n = val.horasCarga[c.id] || 0, r = M.horasDe(c), est = !r ? html(ui.badge('Sin horas definidas', 'neu')) : n === r ? html(ui.badge('Completa', 'ok')) : n < r ? html(ui.badge('Faltan ' + (r - n), 'warn')) : html(ui.badge('Excede en ' + (n - r), 'bad'));
        h += '<tr><td>' + esc(nombreSec(c.seccionId)) + '</td><td>' + esc(M.nombreAsig(S.ctx, c.asignaturaId)) + '</td><td>' + esc(c.docenteId ? M.nombreDoc(S.ctx, c.docenteId) : 'Sin docente') + '</td><td>' +
          (puedeCargas && editor ? '<input type="number" min="0" max="40" step="1" style="width:72px" data-horas="' + esc(c.id) + '" value="' + esc(r) + '" aria-label="Horas semanales de ' + esc(M.nombreAsig(S.ctx, c.asignaturaId) + ' ' + nombreSec(c.seccionId)) + '">' : esc(r)) + '</td><td>' + esc(n) + '</td>' +
          '<td><progress max="' + (r || 1) + '" value="' + Math.min(n, r || 1) + '" aria-label="Avance ' + esc(n + ' de ' + r) + '" style="width:110px"></progress></td><td>' + est + '</td></tr>';
      });
      h += '</tbody></table></div></div>';
      if (!puedeCargas) h += '<p class="note">Tu rol puede asignar horarios pero no modificar las horas semanales de cada carga.</p>';
      panel.innerHTML = h;
      panel.querySelector('[data-f=sec]').addEventListener('change', function (e) { S.cobSec = e.target.value; tabCobertura(panel); var s = panel.querySelector('[data-f=sec]'); if (s) s.focus(); });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-horas]'), function (i) {
        i.addEventListener('change', async function () {
          var c = S.ctx.cargaPor[i.dataset.horas], v = Math.max(0, Math.min(40, Math.round(+i.value || 0)));
          try { await EDU.repo.guardar('cargas', Object.assign({}, c, { horasSemana: v })); S.D.cargas = await EDU.repo.listar('cargas'); reconstruir(); revalidar(); ui.toast('Horas semanales actualizadas.', 'ok'); }
          catch (e) { ui.toast(e.message || 'No se pudo guardar.', 'error'); }
          tabCobertura(panel);
        });
      });
    }

    /* ---------- pestaña Carga docente + ajustes ---------- */
    async function guardarCfg(mut) {
      var cfg = Object.assign({ id: 'cfg_' + centro, centroId: centro, tipo: 'config', topeHoras: S.ctx.topeDefecto, topes: Object.assign({}, S.ctx.topes) }, S.ctx.cfg || {});
      mut(cfg);
      await EDU.repo.guardar('franjas', cfg); S.D.franjas = await EDU.repo.listar('franjas'); reconstruir(); revalidar();
    }
    function tabCarga(panel) {
      var val = S.val, ds = {};
      S.ctx.cargas.forEach(function (c) { if (c.docenteId) { ds[c.docenteId] = ds[c.docenteId] || { id: c.docenteId, req: 0 }; ds[c.docenteId].req += M.horasDe(c); } });
      var lista = Object.keys(ds).map(function (k) { return ds[k]; }).sort(function (a, b) { return M.nombreDoc(S.ctx, a.id).localeCompare(M.nombreDoc(S.ctx, b.id), 'es'); });
      var h = '<div class="card" style="margin-bottom:16px"><label class="fld" style="max-width:300px">Tope de horas por docente (por defecto del centro)<input type="number" min="1" max="60" data-t="def" value="' + esc(S.ctx.topeDefecto) + '"' + (editor ? '' : ' disabled') + '><span class="help">Configurable por centro; no es una regla oficial. Se puede ajustar por docente en la tabla.</span></label></div>';
      h += '<div class="card"><div class="tw"><table class="t"><caption class="sr-only">Carga horaria por docente</caption><thead><tr><th scope="col">Docente</th><th scope="col">Horas por dictar</th><th scope="col">Asignadas</th><th scope="col">Tope</th><th scope="col">Uso del tope</th><th scope="col">Estado</th></tr></thead><tbody>';
      lista.forEach(function (d) {
        var n = val.horasDocente[d.id] || 0, t = M.topeDe(S.ctx, d.id);
        var est = n > t ? html(ui.badge('Sobrecarga (+' + (n - t) + ')', 'bad')) : d.req > t ? html(ui.badge('Carga contratada excede el tope', 'warn')) : n === 0 ? html(ui.badge('Sin horas asignadas', 'neu')) : html(ui.badge('Dentro del tope', 'ok'));
        h += '<tr><td>' + esc(M.nombreDoc(S.ctx, d.id)) + '</td><td>' + esc(d.req) + '</td><td>' + esc(n) + '</td><td><input type="number" min="1" max="60" style="width:72px" data-tope="' + esc(d.id) + '" value="' + esc(t) + '" aria-label="Tope de ' + esc(M.nombreDoc(S.ctx, d.id)) + '"' + (editor ? '' : ' disabled') + '></td>' +
          '<td><progress max="' + t + '" value="' + Math.min(n, t) + '" aria-label="' + esc(n + ' de ' + t + ' horas') + '" style="width:110px"></progress> ' + esc(n + '/' + t) + '</td><td>' + est + '</td></tr>';
      });
      panel.innerHTML = h + '</tbody></table></div></div>';
      var def = panel.querySelector('[data-t=def]');
      def.addEventListener('change', async function () {
        var v = Math.max(1, Math.min(60, Math.round(+def.value || H.TOPE_DEFECTO)));
        try { await guardarCfg(function (c) { c.topeHoras = v; }); ui.toast('Tope por defecto actualizado.', 'ok'); } catch (e) { ui.toast(e.message || 'No se pudo guardar.', 'error'); }
        tabCarga(panel);
      });
      Array.prototype.forEach.call(panel.querySelectorAll('[data-tope]'), function (i) {
        i.addEventListener('change', async function () {
          var v = Math.max(1, Math.min(60, Math.round(+i.value || S.ctx.topeDefecto)));
          try { await guardarCfg(function (c) { c.topes = c.topes || {}; c.topes[i.dataset.tope] = v; }); ui.toast('Tope actualizado.', 'ok'); } catch (e) { ui.toast(e.message || 'No se pudo guardar.', 'error'); }
          tabCarga(panel);
        });
      });
    }

    /* ---------- pestaña Disponibilidad ---------- */
    function tabDisp(panel) {
      var ds = sujetos('docente'), id = S.dispDoc;
      if (!ds.some(function (x) { return x.id === id; })) id = S.dispDoc = ds[0] && ds[0].id;
      var h = '<p class="note" style="margin-top:0">Marca los momentos en que el docente <strong>no</strong> puede dar clase. Por defecto está disponible en todas las franjas. Los cambios se guardan al instante y se validan contra el horario.</p>';
      h += '<div class="hz-ctrl"><label class="fld">Docente<select data-d="doc">' + ds.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === id ? ' selected' : '') + '>' + esc(x.texto) + '</option>'; }).join('') + '</select></label><button type="button" class="btn sec" data-d="reset">Marcar todo disponible</button></div>';
      h += '<div class="hz-dias" role="group" aria-label="Día de la semana">' + DIAS.map(function (n, i) { return '<button type="button" class="btn sec sm" data-dia-sel="' + (i + 1) + '" aria-pressed="' + (S.dia === i + 1) + '">' + esc(H.DIAS_CORTO[i]) + '</button>'; }).join('') + '</div>';
      var fr = id ? filasDe('docente', id, entradasDe('docente', id)) : [];
      if (!fr.length) h += html(ui.vacio({ titulo: 'No hay franjas configuradas', texto: 'Configura primero las franjas de la tanda.' }));
      else {
        var multi = fr.some(function (f) { return f.tanda !== fr[0].tanda; }), hoy = hoyDia();
        h += '<div class="card" style="padding:12px"><div class="hz-scroll"><table class="hz" data-d="' + S.dia + '" aria-label="Disponibilidad semanal del docente"><thead><tr><th scope="col" class="hz-h"><span class="sr-only">Franja</span></th>' + DIAS.map(function (n, i) { return '<th scope="col" data-dia="' + (i + 1) + '"' + (hoy === i + 1 ? ' class="hoy"' : '') + '>' + esc(n) + '</th>'; }).join('') + '</tr></thead><tbody>';
        fr.forEach(function (f) {
          var lbl = '<th scope="row" class="hz-h">' + esc(f.inicio + '–' + f.fin) + (multi ? '<small>' + esc(H.TANDAS[f.tanda]) + '</small>' : '') + '</th>';
          if (f.tipo !== 'clase') { h += '<tr class="hz-pausa">' + lbl + '<td colspan="5">' + esc(H.TIPOS[f.tipo]) + '</td></tr>'; return; }
          h += '<tr>' + lbl;
          for (var d = 1; d <= 5; d++) {
            var no = S.ctx.disp.some(function (x) { return x.docenteId === id && +x.dia === d && x.franjaId === f.id; });
            h += '<td data-dia="' + d + '"' + (hoy === d ? ' class="hoy"' : '') + '><button type="button" class="hz-disp" data-dd="' + d + '" data-df="' + esc(f.id) + '" aria-pressed="' + (!no) + '" aria-label="' + esc(DIAS[d - 1] + ' ' + f.inicio + ': ' + (no ? 'no disponible' : 'disponible')) + '">' + (no ? 'No disponible' : 'Disponible') + '</button></td>';
          }
          h += '</tr>';
        });
        h += '</tbody></table></div></div>';
      }
      var conf = S.val.conflictos.filter(function (c) { return c.tipo === 'disponibilidad'; });
      if (conf.length) h += '<div class="alert red"><div><strong>Clases asignadas en momentos no disponibles</strong><ul>' + conf.slice(0, 8).map(function (c) { return '<li>' + esc(c.msg) + '</li>'; }).join('') + '</ul></div></div>';
      panel.innerHTML = h;
      if (!panel._hz) {
        panel._hz = true;
        panel.addEventListener('change', function (ev) { var s = ev.target.closest('[data-d=doc]'); if (s) { S.dispDoc = s.value; tabDisp(panel); var n = panel.querySelector('[data-d=doc]'); if (n) n.focus(); } });
        panel.addEventListener('click', async function (ev) {
          var ds_ = ev.target.closest('[data-dia-sel]'); if (ds_) { S.dia = +ds_.dataset.diaSel; tabDisp(panel); return; }
          var r = ev.target.closest('[data-d=reset]');
          try {
            if (r) {
              var mias = S.D.disponibilidad.filter(function (x) { return x.docenteId === S.dispDoc && x.disponible === false; });
              for (var i = 0; i < mias.length; i++) await EDU.repo.borrar('disponibilidad', mias[i].id);
            } else {
              var b = ev.target.closest('[data-dd]'); if (!b) return;
              var did = 'dsp_' + S.dispDoc + '_' + b.dataset.dd + '_' + b.dataset.df, ya = S.D.disponibilidad.filter(function (x) { return x.id === did; })[0];
              if (ya) await EDU.repo.borrar('disponibilidad', did);
              else await EDU.repo.guardar('disponibilidad', { id: did, centroId: centro, docenteId: S.dispDoc, dia: +b.dataset.dd, franjaId: b.dataset.df, disponible: false });
            }
            S.D.disponibilidad = await EDU.repo.listar('disponibilidad'); reconstruir(); revalidar();
          } catch (e) { ui.toast(e.message || 'No se pudo guardar.', 'error'); }
          var foco = ev.target.closest('[data-dd]'), fd = foco && foco.dataset.dd, ff = foco && foco.dataset.df;
          tabDisp(panel);
          if (fd) { var nb = Array.prototype.filter.call(panel.querySelectorAll('[data-dd]'), function (x) { return x.dataset.dd === fd && x.dataset.df === ff; })[0]; if (nb) nb.focus(); }
        });
      }
    }

    /* ---------- pestaña Franjas ---------- */
    function franjasDeTanda(t) { return S.ctx.franjas.filter(function (f) { return f.tanda === t; }).map(function (f) { return { id: f.id, inicio: f.inicio, fin: f.fin, tipo: f.tipo }; }); }
    function tabFranjas(panel) {
      var h = '<p class="note" style="margin-top:0">Define las franjas de cada tanda. Las plantillas son <strong>ejemplos editables</strong>: cada centro ajusta sus horas y recreos. Solo las franjas de tipo «Clase» cuentan como horas.</p>';
      Object.keys(H.TANDAS).forEach(function (t) {
        var l = S.fr[t] || (S.fr[t] = franjasDeTanda(t));
        h += '<section class="card hz-fr" style="margin-bottom:16px" data-t="' + t + '"><h2>Tanda ' + esc(H.TANDAS[t].toLowerCase()) + '</h2><div role="alert" data-err></div>' +
          (l.length ? '<div class="tw"><table class="t"><caption class="sr-only">Franjas de la tanda ' + esc(H.TANDAS[t]) + '</caption><thead><tr><th scope="col">#</th><th scope="col">Inicio</th><th scope="col">Fin</th><th scope="col">Tipo</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody>' +
            l.map(function (f, i) {
              return '<tr><td>' + (i + 1) + '</td><td><input type="time" data-i="' + i + '" data-k="inicio" value="' + esc(f.inicio) + '" aria-label="Inicio de la franja ' + (i + 1) + '"></td><td><input type="time" data-i="' + i + '" data-k="fin" value="' + esc(f.fin) + '" aria-label="Fin de la franja ' + (i + 1) + '"></td>' +
                '<td><select data-i="' + i + '" data-k="tipo" aria-label="Tipo de la franja ' + (i + 1) + '">' + Object.keys(H.TIPOS).map(function (k) { return '<option value="' + k + '"' + (f.tipo === k ? ' selected' : '') + '>' + esc(H.TIPOS[k]) + '</option>'; }).join('') + '</select></td>' +
                '<td><button type="button" class="btn dng sm" data-x="' + i + '" aria-label="Quitar la franja ' + (i + 1) + '">Quitar</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="note">Esta tanda aún no tiene franjas.</p>') +
          '<div class="toolbar" style="margin-top:12px"><button type="button" class="btn sec sm" data-add>Añadir franja</button><button type="button" class="btn sec sm" data-plantilla>' + (l.length ? 'Reemplazar por plantilla de ejemplo' : 'Crear franjas de ejemplo') + '</button><span class="sp"></span><button type="button" class="btn sm" data-rev>Descartar cambios</button><button type="button" class="btn amb sm" data-save>Guardar tanda</button></div></section>';
      });
      panel.innerHTML = h;
      if (panel._hz) return; panel._hz = true;
      panel.addEventListener('change', function (ev) {
        var i = ev.target.closest('[data-i]'), sec = ev.target.closest('[data-t]'); if (!i || !sec) return;
        S.fr[sec.dataset.t][+i.dataset.i][i.dataset.k] = i.value;
      });
      panel.addEventListener('click', async function (ev) {
        var sec = ev.target.closest('[data-t]'); if (!sec) return; var t = sec.dataset.t, l = S.fr[t], b = ev.target.closest('button'); if (!b) return;
        var err = sec.querySelector('[data-err]');
        if (b.hasAttribute('data-x')) { l.splice(+b.dataset.x, 1); tabFranjas(panel); }
        else if (b.hasAttribute('data-add')) { var u = l[l.length - 1]; l.push({ inicio: u ? u.fin : '08:00', fin: u ? M.hhmm(M.mins(u.fin) + 45) : '08:45', tipo: 'clase' }); tabFranjas(panel); }
        else if (b.hasAttribute('data-plantilla')) { S.fr[t] = M.plantillaFranjas(t, centro).map(function (f) { return { inicio: f.inicio, fin: f.fin, tipo: f.tipo }; }); tabFranjas(panel); }
        else if (b.hasAttribute('data-rev')) { S.fr[t] = franjasDeTanda(t); tabFranjas(panel); }
        else if (b.hasAttribute('data-save')) {
          var errores = M.validarFranjas(l);
          var vivos = {}; l.forEach(function (f) { if (f.id) vivos[f.id] = 1; });
          var quitadas = S.ctx.franjas.filter(function (f) { return f.tanda === t && !vivos[f.id]; });
          quitadas.forEach(function (f) { var n = S.draft.filter(function (e) { return e.franjaId === f.id; }).length + S.D.horarios.filter(function (e) { return e.franjaId === f.id; }).length; if (n) errores.push('No se puede quitar la franja ' + f.inicio + '–' + f.fin + ': tiene clases asignadas.'); });
          l.forEach(function (f) { if (f.id && f.tipo !== 'clase' && S.D.horarios.some(function (e) { return e.franjaId === f.id; })) errores.push('La franja ' + f.inicio + '–' + f.fin + ' tiene clases asignadas y debe seguir siendo de tipo Clase.'); });
          if (errores.length) { err.innerHTML = '<div class="alert red"><div><strong>Revisa las franjas</strong><ul>' + errores.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>'; return; }
          try {
            var ord = l.slice().sort(function (a, b2) { return M.mins(a.inicio) - M.mins(b2.inicio); });
            for (var q = 0; q < quitadas.length; q++) await EDU.repo.borrar('franjas', quitadas[q].id);
            for (var k = 0; k < ord.length; k++) await EDU.repo.guardar('franjas', Object.assign({}, ord[k].id ? S.ctx.franjaPor[ord[k].id] : {}, { centroId: centro, tanda: t, orden: k + 1, inicio: ord[k].inicio, fin: ord[k].fin, tipo: ord[k].tipo }));
            S.D.franjas = await EDU.repo.listar('franjas'); reconstruir(); revalidar(); S.fr[t] = franjasDeTanda(t);
            ui.toast('Franjas de la tanda ' + H.TANDAS[t].toLowerCase() + ' guardadas.', 'ok');
          } catch (e) { err.innerHTML = '<div class="alert red"><div><strong>' + esc(e.message || 'No se pudo guardar') + '</strong></div></div>'; return; }
          tabFranjas(panel);
        }
      });
    }

    /* ---------- montaje ---------- */
    var raiz = document.createElement('div'); raiz.className = 'hz-root';
    raiz.innerHTML = html(cab()); var cuerpo = document.createElement('div'); cuerpo.className = 'hz-pantalla'; raiz.appendChild(cuerpo);
    cont.innerHTML = ''; cont.appendChild(raiz);
    function repintarTodo() { if (S.tabs) S.tabs.seleccionar(S.tabs.actual()); else pintarHorario(cuerpo); }
    if (editor) {
      S.tabs = ui.tabs({ etiqueta: 'Módulos de horarios', siempre: true, tabs: [
        { id: 'horario', titulo: 'Horario', render: function (p) { p._hz = p._hz || false; pintarHorario(p); } },
        { id: 'cobertura', titulo: 'Cobertura de horas', render: tabCobertura },
        { id: 'carga', titulo: 'Carga docente', render: tabCarga },
        { id: 'disp', titulo: 'Disponibilidad', render: tabDisp },
        { id: 'franjas', titulo: 'Franjas y tandas', render: tabFranjas }] });
      cuerpo.appendChild(S.tabs.el);
    } else pintarHorario(cuerpo);
    return function () { S.panel = null; };
  } });
})();
