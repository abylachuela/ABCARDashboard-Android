/* Vista "matricula": listado por seccion con capacidad, matricula individual (asistente), matricula masiva, retirar/reactivar.
   Regla: un estudiante no puede tener dos matriculas en el mismo anio lectivo. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui;

  (function () {
    if (document.getElementById('edu-css-matricula')) return;
    var s = document.createElement('style'); s.id = 'edu-css-matricula';
    s.textContent = '.mt-top{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px}.mt-top label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:2px}' +
      '.mt-pasos{display:flex;gap:8px;list-style:none;padding:0;margin:0 0 16px;flex-wrap:wrap}' +
      '.mt-pasos li{padding:6px 14px;border-radius:99px;background:#ece8de;color:var(--muted);font-size:13px;font-weight:600}' +
      '.mt-pasos li[aria-current=step]{background:var(--navy);color:#fff}.mt-pasos li.hecho{background:var(--ok-bg);color:var(--ok)}' +
      '.mt-lista{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;margin:10px 0;border:1px solid var(--line);border-radius:10px;padding:6px;background:var(--soft)}' +
      '.mt-op{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;background:#fff;border:1px solid var(--line);cursor:pointer}' +
      '.mt-op:hover{border-color:var(--navy-2)}.mt-op input{width:18px;height:18px;flex:none}.mt-op small{color:var(--muted);display:block}' +
      '.mt-op.off{opacity:.55;cursor:not-allowed}.mt-nav{display:flex;gap:10px;justify-content:space-between;margin-top:14px;flex-wrap:wrap}' +
      '.mt-q{width:100%;padding:8px 10px;border:1px solid var(--field-line);border-radius:8px;background:#fff}.mt-resumen{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}' +
      '.mt-resumen dt{color:var(--muted)}.mt-resumen dd{margin:0}.mt-cupo{margin:6px 0 14px}@media(max-width:560px){.mt-resumen{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  })();

  function aHtml(x) { return x instanceof EDU.Safe ? x.s : (x == null ? '' : String(x)); }
  function rol() { return EDU.estado.rol(); }
  function puedeEscribir() { return EDU.permisos.puede(rol(), 'matricula', 'editar') && EDU.permisos.puedeEscribirColeccion(rol(), 'matriculas'); }
  function pick(l, id) { return l.filter(function (x) { return x.id === id; })[0] || null; }
  function err(e) { ui.toast(e && e.message ? e.message : 'No se pudo completar la acción.', 'error', 6000); }
  function secLabel(d, s) { var c = pick(d.cursos, s.cursoId); return (c ? c.nombre + ' ' : '') + s.nombre + (s.tanda ? ' · ' + s.tanda : ''); }
  function estadoDe(p) { return p.estado || 'activo'; }
  function cmpSec(d) { return function (a, b) { var ca = pick(d.cursos, a.cursoId), cb = pick(d.cursos, b.cursoId); return ((ca ? ca.orden : 0) - (cb ? cb.orden : 0)) || String(a.nombre).localeCompare(String(b.nombre)); }; };

  async function cargar() {
    var d = await EDU.consultas.cargar(['anios', 'secciones', 'cursos', 'matriculas', 'estudiantes', 'cargas', 'tutores']);
    d.al = EDU.permisos.alcance(EDU.estado.sesion(), d);
    return d;
  }
  function activas(d, secId) { return d.matriculas.filter(function (m) { return m.seccionId === secId && m.estado === 'activa'; }); }
  function cupo(d, s) { var n = activas(d, s.id).length, cap = s.capacidad == null ? null : +s.capacidad; return { n: n, cap: cap, libres: cap == null ? Infinity : Math.max(0, cap - n) }; }
  function cupoTxt(c) { return c.n + (c.cap != null ? ' / ' + c.cap : '') + ' · ' + (c.cap == null ? 'sin límite' : c.libres + ' libres'); }
  /** Matricula del estudiante en el anio (cualquier estado) o null. */
  function matDelAnio(d, estId, anioId) { return d.matriculas.filter(function (m) { return m.estudianteId === estId && m.anioId === anioId; })[0] || null; }
  function pendientes(d, anioId) {
    return d.estudiantes.filter(function (e) { return estadoDe(e) === 'activo' && !matDelAnio(d, e.id, anioId); }).sort(function (a, b) { return fmt.nombreCompleto(a).localeCompare(fmt.nombreCompleto(b), 'es'); });
  }

  /** Crea matriculas validando duplicados y capacidad contra datos recien leidos. */
  async function matricular(anioId, secId, estIds, fecha) {
    var fresco = await EDU.consultas.cargar(['matriculas', 'secciones', 'estudiantes']), s = pick(fresco.secciones, secId);
    if (!s) throw new Error('La sección no existe en este centro.');
    var libres = s.capacidad == null ? Infinity : +s.capacidad - fresco.matriculas.filter(function (m) { return m.seccionId === secId && m.estado === 'activa'; }).length;
    if (estIds.length > libres) throw new Error('La sección solo tiene ' + Math.max(0, libres) + ' cupos disponibles.');
    estIds.forEach(function (id) {
      var e = pick(fresco.estudiantes, id), ya = matDelAnio(fresco, id, anioId);
      if (!e) throw new Error('Estudiante no encontrado.');
      if (estadoDe(e) !== 'activo') throw new Error(fmt.nombreCompleto(e) + ' está dado de baja.');
      if (ya) throw new Error(fmt.nombreCompleto(e) + ' ya tiene una matrícula en este año lectivo' + (ya.estado !== 'activa' ? ' (retirada: reactívala en lugar de matricular de nuevo)' : '') + '.');
    });
    var regs = estIds.map(function (id) { return { centroId: s.centroId, estudianteId: id, seccionId: secId, anioId: anioId, estado: 'activa', fecha: fecha || fmt.hoy() }; });
    await EDU.repo.guardarMuchos('matriculas', regs);
    return regs.length;
  }

  /* ---------- vista ---------- */
  EDU.router.register('matricula', {
    titulo: 'Matrícula',
    render: async function (cont) {
      var d = await cargar(), editar = puedeEscribir();
      if (!d.anios.length) { cont.innerHTML = aHtml(ui.cabecera({ eyebrow: 'Gestión académica', titulo: 'Matrícula' })) + '<div class="card">' + aHtml(ui.vacio({ titulo: 'Sin año lectivo', texto: 'Configura un año lectivo antes de matricular.' })) + '</div>'; return; }
      var anios = d.anios.slice().sort(function (a, b) { return String(b.inicio || b.nombre).localeCompare(String(a.inicio || a.nombre)); });
      var anioId = (anios.filter(function (a) { return a.activo; })[0] || anios[0]).id, secSel = null;
      var desc = rol() === 'docente' ? 'Secciones donde impartes clase.' : 'Inscripción de estudiantes por año lectivo y sección.';
      cont.innerHTML = aHtml(ui.cabecera({ eyebrow: 'Gestión académica', titulo: 'Matrícula', descripcion: desc })) +
        '<div class="mt-top"><label>Año lectivo<select id="mt-anio">' + aHtml(ui.opciones(anios.map(function (a) { return { valor: a.id, texto: a.nombre }; }), anioId)) + '</select></label></div><div id="mt-tabs"></div>';
      var tabsDef = [{ id: 'seccion', titulo: 'Por sección', render: tabSeccion }];
      if (editar) tabsDef.push({ id: 'individual', titulo: 'Matrícula individual', render: tabIndividual }, { id: 'masiva', titulo: 'Matrícula masiva', render: tabMasiva });
      var t = ui.tabs({ tabs: tabsDef, etiqueta: 'Modo de matrícula', siempre: true });
      cont.querySelector('#mt-tabs').appendChild(t.el);
      cont.querySelector('#mt-anio').addEventListener('change', function (e) { anioId = e.target.value; secSel = null; refrescar(); });
      async function refrescar() { d = await cargar(); t.seleccionar(t.actual()); }
      function seccionesDe() { return EDU.permisos.filtrar(d.al, 'secciones', d.secciones.filter(function (s) { return s.anioId === anioId; })).sort(cmpSec(d)); }

      /* ----- Por seccion ----- */
      function tabSeccion(panel) {
        var secs = seccionesDe();
        if (!secs.length) { panel.innerHTML = '<div class="card">' + aHtml(ui.vacio({ titulo: 'Sin secciones', texto: 'No hay secciones para este año lectivo' + (rol() === 'docente' ? ' en tu carga docente.' : '.') })) + '</div>'; return; }
        var filas = secs.map(function (s) { var c = cupo(d, s); return { id: s.id, seccion: secLabel(d, s), n: c.n, cap: c.cap, libres: c.cap == null ? null : c.libres, pct: c.cap ? Math.round(c.n / c.cap * 100) : 0 }; });
        var card = ui.el('<div class="card"><h2>Ocupación de secciones</h2><div id="mt-ov"></div></div>');
        card.querySelector('#mt-ov').appendChild(ui.tabla({ etiqueta: 'Ocupación de secciones', buscar: false, porPagina: false, filas: filas, ordenInicial: null,
          columnas: [{ clave: 'seccion', titulo: 'Sección', orden: false }, { clave: 'n', titulo: 'Matriculados', align: 'c', orden: false }, { clave: 'cap', titulo: 'Capacidad', align: 'c', orden: false },
            { clave: 'libres', titulo: 'Cupos libres', align: 'c', orden: false, render: function (f) { return f.cap == null ? '—' : aHtml(ui.badge(f.libres === 0 ? 'Completa' : f.libres, f.libres === 0 ? 'bad' : f.libres <= 3 ? 'warn' : 'ok')); } }],
          acciones: [{ texto: 'Ver listado', alClic: function (f) { secSel = f.id; detalle(); var h = panel.querySelector('#mt-det h2'); if (h) { h.tabIndex = -1; h.focus(); } } }] }).el);
        panel.appendChild(card);
        var det = ui.el('<div class="card" id="mt-det" style="margin-top:18px" aria-live="polite"></div>'); panel.appendChild(det);
        detalle();
        function detalle() {
          var s = pick(secs, secSel);
          if (!s) { det.innerHTML = '<p class="note">Selecciona una sección en la tabla para ver su listado de estudiantes.</p>'; return; }
          var c = cupo(d, s), ms = d.matriculas.filter(function (m) { return m.seccionId === s.id; });
          ms = EDU.permisos.filtrarPorEstudiante(d.al, ms);
          var rows = ms.map(function (m) { var e = pick(d.estudiantes, m.estudianteId); return { mat: m, id: m.estudianteId, nombre: e ? fmt.nombreCompleto(e) : '?', codigo: e && e.matricula, fecha: m.fecha, estado: m.estado }; });
          det.innerHTML = '<h2>' + esc(secLabel(d, s)) + '</h2><div class="mt-cupo">' + aHtml(ui.progreso({ etiqueta: 'Cupo', valor: c.cap ? c.n / c.cap * 100 : 0, texto: cupoTxt(c) })) + '</div><div id="mt-tl"></div>';
          det.querySelector('#mt-tl').appendChild(ui.tabla({ etiqueta: 'Estudiantes de ' + secLabel(d, s), filas: rows, ordenInicial: 'nombre', vacio: { titulo: 'Sin estudiantes', texto: 'Esta sección no tiene matrículas.' },
            columnas: [{ clave: 'nombre', titulo: 'Estudiante', render: function (r) { return '<a href="#/personas/' + encodeURIComponent(r.id) + '">' + esc(r.nombre) + '</a>'; } }, { clave: 'codigo', titulo: 'Código' },
              { clave: 'fecha', titulo: 'Matriculado', formato: function (v) { return fmt.fecha(v); } },
              { clave: 'estado', titulo: 'Estado', render: function (r) { return aHtml(ui.badge(r.estado === 'activa' ? 'Activa' : 'Retirada', r.estado === 'activa' ? 'ok' : 'neu')); } }],
            acciones: editar ? [{ texto: 'Retirar', tipo: 'dng', visible: function (r) { return r.estado === 'activa'; }, alClic: function (r) { retirar(r); } },
              { texto: 'Reactivar', visible: function (r) { return r.estado !== 'activa'; }, alClic: function (r) { reactivar(r, s); } }] : [] }).el);
        }
        async function retirar(r) {
          var v = await ui.formularioModal({ titulo: 'Retirar a ' + r.nombre, textoEnviar: 'Retirar', campos: [
            { nombre: 'motivo', label: 'Motivo', tipo: 'select', requerido: true, opciones: ['Traslado a otro centro', 'Abandono', 'Razones de salud', 'Cambio de domicilio', 'Otro'] },
            { nombre: 'fecha', label: 'Fecha de retiro', tipo: 'date', requerido: true, valor: fmt.hoy() }] });
          if (!v) return;
          try { var m = Object.assign({}, r.mat, { estado: 'retirada', fechaRetiro: v.fecha, motivoRetiro: v.motivo }); await EDU.repo.guardar('matriculas', m); ui.toast(r.nombre + ' fue retirado/a.', 'ok'); refrescar(); } catch (e) { err(e); }
        }
        async function reactivar(r, s) {
          try {
            var f = await EDU.consultas.cargar(['matriculas', 'secciones', 'estudiantes']), m = pick(f.matriculas, r.mat.id), e = pick(f.estudiantes, r.id);
            if (!m) throw new Error('La matrícula ya no existe.');
            if (e && estadoDe(e) !== 'activo') throw new Error(r.nombre + ' está dado de baja; reactívalo primero en Personas.');
            var otra = f.matriculas.filter(function (x) { return x.estudianteId === m.estudianteId && x.anioId === m.anioId && x.estado === 'activa' && x.id !== m.id; })[0];
            if (otra) throw new Error(r.nombre + ' ya tiene otra matrícula activa en este año.');
            var ss = pick(f.secciones, m.seccionId), n = f.matriculas.filter(function (x) { return x.seccionId === m.seccionId && x.estado === 'activa'; }).length;
            if (ss && ss.capacidad != null && n >= +ss.capacidad) throw new Error('La sección está completa (' + n + '/' + ss.capacidad + ').');
            m.estado = 'activa'; delete m.fechaRetiro; delete m.motivoRetiro; await EDU.repo.guardar('matriculas', m); ui.toast(r.nombre + ' fue reactivado/a.', 'ok'); refrescar();
          } catch (e2) { err(e2); }
        }
      }

      /* ----- Individual (asistente) ----- */
      function tabIndividual(panel) {
        var st = { paso: 1, est: null, sec: null, q: '' }, nombres = ['Estudiante', 'Sección', 'Confirmar'];
        var card = ui.el('<div class="card"><h2 tabindex="-1" id="mt-h">Matrícula individual</h2><ol class="mt-pasos" aria-label="Pasos"></ol><div id="mt-cuerpo"></div><p class="sr-only" role="status" aria-live="polite" id="mt-st"></p></div>');
        panel.appendChild(card);
        var cuerpo = card.querySelector('#mt-cuerpo'), pasos = card.querySelector('.mt-pasos');
        function pintar(foco) {
          pasos.innerHTML = nombres.map(function (n, i) { return '<li' + (st.paso === i + 1 ? ' aria-current="step"' : '') + (st.paso > i + 1 ? ' class="hecho"' : '') + '>' + (i + 1) + '. ' + esc(n) + '</li>'; }).join('');
          card.querySelector('#mt-st').textContent = 'Paso ' + st.paso + ' de 3: ' + nombres[st.paso - 1];
          if (st.paso === 1) paso1(); else if (st.paso === 2) paso2(); else paso3();
          if (foco) { var f = cuerpo.querySelector('input,button,select'); if (f) f.focus(); }
        }
        function paso1() {
          var cand = pendientes(d, anioId);
          cuerpo.innerHTML = '<fieldset style="border:0;padding:0;margin:0"><legend class="note">Estudiantes activos sin matrícula en el año seleccionado (' + cand.length + ')</legend>' +
            '<label class="sr-only" for="mt-q">Buscar estudiante</label><input class="mt-q" id="mt-q" type="search" placeholder="Buscar por nombre o código…" autocomplete="off" value="' + esc(st.q) + '"><div class="mt-lista" id="mt-l" role="radiogroup" aria-label="Estudiante"></div></fieldset>' +
            '<div class="mt-nav"><span></span><button type="button" class="btn amb" id="mt-sig">Siguiente</button></div><p class="alert red hidden" id="mt-e" role="alert"></p>';
          function lista() {
            var q = fmt.norm(st.q).trim(), l = cand.filter(function (e) { return !q || fmt.norm(fmt.nombreCompleto(e) + ' ' + (e.matricula || '')).indexOf(q) !== -1; }).slice(0, 60);
            cuerpo.querySelector('#mt-l').innerHTML = l.length ? l.map(function (e) { return '<label class="mt-op"><input type="radio" name="mt-est" value="' + esc(e.id) + '"' + (st.est === e.id ? ' checked' : '') + '><span>' + esc(fmt.nombreCompleto(e)) + '<small>' + esc(e.matricula || 'Sin código') + (e.documento ? ' · ' + esc(e.documento) : '') + '</small></span></label>'; }).join('')
              : '<p class="note" style="padding:8px">' + (cand.length ? 'Sin coincidencias.' : 'Todos los estudiantes activos ya están matriculados en este año.') + '</p>';
          }
          lista();
          cuerpo.querySelector('#mt-q').addEventListener('input', function (e) { st.q = e.target.value; lista(); });
          cuerpo.querySelector('#mt-l').addEventListener('change', function (e) { st.est = e.target.value; });
          cuerpo.querySelector('#mt-sig').addEventListener('click', function () {
            if (!st.est) { var m = cuerpo.querySelector('#mt-e'); m.textContent = 'Selecciona un estudiante para continuar.'; m.classList.remove('hidden'); return; }
            st.paso = 2; pintar(true);
          });
        }
        function paso2() {
          var secs = d.secciones.filter(function (s) { return s.anioId === anioId; }).sort(cmpSec(d));
          cuerpo.innerHTML = '<fieldset style="border:0;padding:0;margin:0"><legend class="note">Sección de destino para ' + esc(fmt.nombreCompleto(pick(d.estudiantes, st.est))) + '</legend><div class="mt-lista" role="radiogroup" aria-label="Sección">' +
            (secs.length ? secs.map(function (s) { var c = cupo(d, s), lleno = c.libres === 0; return '<label class="mt-op' + (lleno ? ' off' : '') + '"><input type="radio" name="mt-sec" value="' + esc(s.id) + '"' + (lleno ? ' disabled' : '') + (st.sec === s.id ? ' checked' : '') + '><span>' + esc(secLabel(d, s)) + '<small>' + esc(cupoTxt(c)) + (lleno ? ' · Completa' : '') + '</small></span></label>'; }).join('') : '<p class="note">No hay secciones en este año.</p>') + '</div></fieldset>' +
            '<p class="alert red hidden" id="mt-e" role="alert"></p><div class="mt-nav"><button type="button" class="btn sec" id="mt-atras">Atrás</button><button type="button" class="btn amb" id="mt-sig">Siguiente</button></div>';
          cuerpo.querySelector('.mt-lista').addEventListener('change', function (e) { st.sec = e.target.value; });
          cuerpo.querySelector('#mt-atras').addEventListener('click', function () { st.paso = 1; pintar(true); });
          cuerpo.querySelector('#mt-sig').addEventListener('click', function () {
            if (!st.sec) { var m = cuerpo.querySelector('#mt-e'); m.textContent = 'Selecciona una sección para continuar.'; m.classList.remove('hidden'); return; }
            st.paso = 3; pintar(true);
          });
        }
        function paso3() {
          var e = pick(d.estudiantes, st.est), s = pick(d.secciones, st.sec), an = pick(d.anios, anioId);
          cuerpo.innerHTML = '<dl class="mt-resumen"><dt>Estudiante</dt><dd>' + esc(fmt.nombreCompleto(e)) + '</dd><dt>Año lectivo</dt><dd>' + esc(an.nombre) + '</dd><dt>Sección</dt><dd>' + esc(secLabel(d, s)) + '</dd></dl>' +
            '<div class="fld" style="max-width:240px;margin-top:14px"><label for="mt-fecha">Fecha de matrícula</label><input type="date" id="mt-fecha" value="' + esc(fmt.hoy()) + '"></div>' +
            '<p class="alert red hidden" id="mt-e" role="alert"></p><div class="mt-nav"><button type="button" class="btn sec" id="mt-atras">Atrás</button><button type="button" class="btn amb" id="mt-ok">Confirmar matrícula</button></div>';
          cuerpo.querySelector('#mt-atras').addEventListener('click', function () { st.paso = 2; pintar(true); });
          cuerpo.querySelector('#mt-ok').addEventListener('click', async function (ev) {
            var f = cuerpo.querySelector('#mt-fecha').value, m = cuerpo.querySelector('#mt-e'); ev.target.disabled = true;
            if (!EDU.validacion.esFecha(f)) { m.textContent = 'Indica una fecha válida.'; m.classList.remove('hidden'); ev.target.disabled = false; return; }
            try { await matricular(anioId, st.sec, [st.est], f); ui.toast(fmt.nombreCompleto(e) + ' fue matriculado/a en ' + secLabel(d, s) + '.', 'ok'); refrescar(); }
            catch (x) { m.textContent = x.message; m.classList.remove('hidden'); ev.target.disabled = false; }
          });
        }
        pintar(false);
      }

      /* ----- Masiva ----- */
      function tabMasiva(panel) {
        var secs = d.secciones.filter(function (s) { return s.anioId === anioId; }).sort(cmpSec(d)), cand = pendientes(d, anioId), marcados = new Set(), q = '';
        var card = ui.el('<div class="card"><h2>Matrícula masiva</h2><p class="note">Selecciona una sección y marca los estudiantes sin matrícula en el año. Se respeta la capacidad de la sección.</p>' +
          '<div class="fgrid"><div class="fld"><label for="mt-ms">Sección de destino</label><select id="mt-ms"><option value="">Seleccionar…</option>' + secs.map(function (s) { var c = cupo(d, s); return '<option value="' + esc(s.id) + '">' + esc(secLabel(d, s) + ' (' + cupoTxt(c) + ')') + '</option>'; }).join('') + '</select></div>' +
          '<div class="fld"><label for="mt-mf">Fecha de matrícula</label><input type="date" id="mt-mf" value="' + esc(fmt.hoy()) + '"></div></div>' +
          '<div style="margin-top:12px"><label class="sr-only" for="mt-mq">Buscar estudiante</label><input class="mt-q" id="mt-mq" type="search" placeholder="Buscar por nombre o código…" autocomplete="off"></div>' +
          '<div class="mt-lista" id="mt-ml" role="group" aria-label="Estudiantes sin matrícula"></div>' +
          '<div class="mt-nav"><span><button type="button" class="btn sec sm" id="mt-todos">Marcar visibles</button> <button type="button" class="btn sec sm" id="mt-ninguno">Quitar marcas</button> <span id="mt-cnt" role="status" aria-live="polite"></span></span><button type="button" class="btn amb" id="mt-go">Matricular seleccionados</button></div>' +
          '<p class="alert red hidden" id="mt-e" role="alert"></p></div>');
        panel.appendChild(card);
        var sel = card.querySelector('#mt-ms'), lista = card.querySelector('#mt-ml'), cnt = card.querySelector('#mt-cnt'), msg = card.querySelector('#mt-e');
        function libres() { var s = pick(secs, sel.value); return s ? cupo(d, s).libres : 0; }
        function visibles() { var n = fmt.norm(q).trim(); return cand.filter(function (e) { return !n || fmt.norm(fmt.nombreCompleto(e) + ' ' + (e.matricula || '')).indexOf(n) !== -1; }); }
        function pintar() {
          var v = visibles().slice(0, 150), lib = libres();
          lista.innerHTML = v.length ? v.map(function (e) { var on = marcados.has(e.id), off = !on && marcados.size >= lib; return '<label class="mt-op' + (off ? ' off' : '') + '"><input type="checkbox" value="' + esc(e.id) + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '><span>' + esc(fmt.nombreCompleto(e)) + '<small>' + esc(e.matricula || 'Sin código') + '</small></span></label>'; }).join('')
            : '<p class="note" style="padding:8px">' + (cand.length ? 'Sin coincidencias.' : 'No hay estudiantes pendientes de matrícula en este año.') + '</p>';
          cnt.textContent = marcados.size + ' seleccionados' + (sel.value ? ' · cupos libres: ' + (lib === Infinity ? 'sin límite' : lib) : '');
        }
        lista.addEventListener('change', function (e) { if (e.target.checked) marcados.add(e.target.value); else marcados.delete(e.target.value); pintar(); var c = lista.querySelector('input[value="' + e.target.value + '"]'); if (c) c.focus(); });
        card.querySelector('#mt-mq').addEventListener('input', function (e) { q = e.target.value; pintar(); });
        sel.addEventListener('change', function () { while (marcados.size > libres()) marcados.delete(Array.from(marcados).pop()); pintar(); });
        card.querySelector('#mt-todos').addEventListener('click', function () { var lib = libres(); visibles().forEach(function (e) { if (marcados.size < lib) marcados.add(e.id); }); pintar(); });
        card.querySelector('#mt-ninguno').addEventListener('click', function () { marcados.clear(); pintar(); });
        card.querySelector('#mt-go').addEventListener('click', async function (ev) {
          msg.classList.add('hidden');
          function fallo(t) { msg.textContent = t; msg.classList.remove('hidden'); }
          if (!sel.value) return fallo('Selecciona la sección de destino.');
          if (!marcados.size) return fallo('Marca al menos un estudiante.');
          var f = card.querySelector('#mt-mf').value; if (!EDU.validacion.esFecha(f)) return fallo('Indica una fecha válida.');
          var s = pick(secs, sel.value);
          if (!(await ui.confirmar({ titulo: 'Matrícula masiva', mensaje: '¿Matricular ' + fmt.plural(marcados.size, 'estudiante') + ' en ' + secLabel(d, s) + '?', textoOk: 'Matricular' }))) return;
          ev.target.disabled = true;
          try { var n = await matricular(anioId, sel.value, Array.from(marcados), f); ui.toast(fmt.plural(n, 'estudiante matriculado', 'estudiantes matriculados') + '.', 'ok'); refrescar(); }
          catch (x) { fallo(x.message); ev.target.disabled = false; }
        });
        pintar();
      }
    }
  });
})();
