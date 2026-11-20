/* Vista "planificacion": calendario semanal L-V, lista de planes, editor de plan de clase, duplicar a otra semana y cobertura de indicadores.
   Planes: colección `planes` (+ secuenciaId, indicadorIds, hora). Plan impartido bloqueado salvo director. Todo dato de usuario pasa por EDU.esc. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, PU = function () { return EDU.planUtil; };
  var FASES = [{ valor: 'inicio', texto: 'Inicio' }, { valor: 'desarrollo', texto: 'Desarrollo' }, { valor: 'cierre', texto: 'Cierre' }];
  var ESTADOS = [{ valor: 'borrador', texto: 'Borrador' }, { valor: 'listo', texto: 'Listo' }, { valor: 'impartido', texto: 'Impartido' }];

  function f(d) { return d ? EDU.fmt.fecha(d) : '—'; }
  function color(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#14315c'; }
  function finHora(h, min) {
    var m = /^(\d{2}):(\d{2})$/.exec(h || ''); if (!m) return '';
    var t = (+m[1]) * 60 + (+m[2]) + (min || 45); return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2);
  }

  EDU.router.register('planificacion', {
    titulo: 'Planificación',
    render: async function (cont, params) {
      PU().estilos();
      var rol = EDU.estado.rol(), ctx = null;
      var S = { semana: PU().lunesDe(params.semana && PU().fechaValida(params.semana) ? params.semana : EDU.fmt.hoy()), carga: '', estado: '', tab: 'calendario' };
      var tabsApi = null;

      async function cargar() {
        ctx = await PU().contexto();
        var al = EDU.permisos.alcance(ctx.ses, { cargas: ctx.D.cargas, matriculas: ctx.D.matriculas, tutores: [] });
        ctx.planes = EDU.permisos.filtrarPorCarga(al, ctx.D.planes);
        ctx.horarios = EDU.permisos.filtrarPorCarga(al, ctx.D.horarios);
        ctx.secuencias = EDU.permisos.filtrarPorCarga(al, ctx.D.secuencias);
        ctx.secPorId = {}; ctx.secuencias.forEach(function (s) { ctx.secPorId[s.id] = s; });
      }
      function puedeCrear() { return EDU.permisos.puede(rol, 'planificacion', 'crear') && ctx.cargas.length > 0; }
      function bloqueado(p) { return p.estado === 'impartido' && rol !== 'director'; }
      function editable(p) { return PU().puedeEditarDe('planificacion', ctx, p) && !bloqueado(p); }
      function puedeBorrar(p) { return editable(p) && EDU.permisos.puede(rol, 'planificacion', 'borrar'); }
      function fCarga(l) { return S.carga ? l.filter(function (x) { return x.cargaId === S.carga; }) : l; }

      async function refrescar() { await cargar(); pintar(); }

      /* ---------------- encabezado y pestañas ---------------- */
      function pintar() {
        var lun = S.semana, vie = PU().sumaDias(lun, 4);
        cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Docencia', titulo: 'Planificación', descripcion: 'Calendario semanal de clases por carga docente, planes de clase y cobertura de indicadores.',
          acciones: puedeCrear() ? EDU.raw('<button type="button" class="btn amb" id="pl-nuevo">Nuevo plan</button>') : null }).s +
          (puedeCrear() ? '' : '<p class="note">Tu rol tiene acceso de lectura a la planificación.</p>') +
          '<div class="pl-nav"><button type="button" class="btn sec sm" id="pl-prev" aria-label="Semana anterior">&larr; Anterior</button><button type="button" class="btn sec sm" id="pl-hoy">Hoy</button>' +
          '<button type="button" class="btn sec sm" id="pl-next" aria-label="Semana siguiente">Siguiente &rarr;</button>' +
          '<strong id="pl-rango" aria-live="polite">Semana del ' + esc(f(lun)) + ' al ' + esc(f(vie)) + '</strong><span class="sp"></span>' +
          '<label class="fld" style="flex-direction:row;align-items:center;gap:8px">Carga <select id="pl-carga" style="min-width:200px"><option value="">Todas</option>' + EDU.ui.opciones(ctx.cargas.map(function (c) { return { valor: c.id, texto: ctx.etiqueta(c) }; }), S.carga).s + '</select></label>' +
          (puedeCrear() ? '<button type="button" class="btn sec sm" id="pl-dup-sem">Duplicar semana…</button>' : '') + '</div><div id="pl-tabs"></div>';
        tabsApi = EDU.ui.tabs({ etiqueta: 'Vistas de planificación', activa: S.tab, alCambiar: function (id) { S.tab = id; }, tabs: [
          { id: 'calendario', titulo: 'Calendario semanal', render: tabCalendario }, { id: 'planes', titulo: 'Lista de planes', render: tabPlanes }, { id: 'cobertura', titulo: 'Cobertura de indicadores', render: tabCobertura }] });
        cont.querySelector('#pl-tabs').appendChild(tabsApi.el);
        var nv = cont.querySelector('#pl-nuevo'); if (nv) nv.addEventListener('click', function () { editor(null, {}); });
        cont.querySelector('#pl-prev').addEventListener('click', function () { S.semana = PU().sumaDias(S.semana, -7); pintar(); });
        cont.querySelector('#pl-next').addEventListener('click', function () { S.semana = PU().sumaDias(S.semana, 7); pintar(); });
        cont.querySelector('#pl-hoy').addEventListener('click', function () { S.semana = PU().lunesDe(EDU.fmt.hoy()); pintar(); });
        cont.querySelector('#pl-carga').addEventListener('change', function (e) { S.carga = e.target.value; pintar(); });
        var ds = cont.querySelector('#pl-dup-sem'); if (ds) ds.addEventListener('click', duplicarSemana);
      }

      /* ---------------- calendario ---------------- */
      function tabCalendario(p) {
        var hoy = EDU.fmt.hoy(), html = '<div class="pl-sem" role="list">';
        for (var i = 0; i < 5; i++) {
          var fecha = PU().sumaDias(S.semana, i), slots = fCarga(ctx.horarios).filter(function (h) { return +h.dia === i + 1; }).sort(function (a, b) { return String(a.hora).localeCompare(String(b.hora)); });
          var delDia = fCarga(ctx.planes).filter(function (x) { return x.fecha === fecha; }), usados = {}, bloques = '';
          slots.forEach(function (h) {
            var cg = ctx.cargaPorId[h.cargaId]; if (!cg) return;
            var pl = delDia.filter(function (x) { return !usados[x.id] && x.cargaId === h.cargaId && (!x.hora || x.hora === h.hora); })[0];
            if (pl) usados[pl.id] = true;
            bloques += bloque(cg, h.hora, h.duracion, pl, fecha);
          });
          delDia.filter(function (x) { return !usados[x.id]; }).forEach(function (x) { bloques += bloque(ctx.cargaPorId[x.cargaId], x.hora || '', 45, x, fecha); });
          html += '<section class="pl-dia' + (fecha === hoy ? ' hoy' : '') + '" role="listitem" aria-label="' + esc(PU().DIAS[i] + ' ' + f(fecha)) + '"><h3>' + PU().DIAS[i] + '<small>' + esc(f(fecha)) + '</small></h3>' +
            (bloques || '<p class="note" style="margin:0">Sin clases.</p>') + '</section>';
        }
        p.innerHTML = html + '</div>';
        p.addEventListener('click', function (e) {
          var b = e.target.closest('button[data-plan], button[data-nuevo]'); if (!b) return;
          if (b.dataset.plan) editor(ctx.planes.filter(function (x) { return x.id === b.dataset.plan; })[0], {});
          else if (puedeCrear()) { var d = b.dataset.nuevo.split('|'); if (ctx.cargaPorId[d[0]]) editor(null, { cargaId: d[0], fecha: d[1], hora: d[2] }); }
        });
      }
      function bloque(cg, hora, dur, pl, fecha) {
        if (!cg) return '';
        var et = ctx.etiqueta(cg), c = color((ctx.asig[cg.asignaturaId] || {}).color), t = hora ? hora + '–' + finHora(hora, dur) : 'Sin hora';
        if (pl) return '<button type="button" class="pl-blk" style="--c:' + c + '" data-plan="' + esc(pl.id) + '" aria-label="' + esc(t + ', ' + et + ', ' + pl.tema + ', ' + pl.estado + (bloqueado(pl) ? ', bloqueado' : '')) + '"><span class="t">' + esc(t) + '</span><strong>' + esc(et) + '</strong><em>' + esc(pl.tema) + '</em>' +
          '<span>' + PU().badgeEstado(pl.estado).s + (bloqueado(pl) ? ' <span class="badge neu">bloqueado</span>' : '') + '</span></button>';
        var can = puedeCrear() && PU().puedeEditarDe('planificacion', ctx, { cargaId: cg.id });
        return '<' + (can ? 'button type="button"' : 'div') + ' class="pl-blk vacio-plan" style="--c:' + c + '"' + (can ? ' data-nuevo="' + esc(cg.id + '|' + fecha + '|' + hora) + '" aria-label="' + esc('Planificar ' + t + ', ' + et) + '"' : '') + '><span class="t">' + esc(t) + '</span><strong>' + esc(et) + '</strong><em>' + (can ? '+ Planificar' : 'Sin plan') + '</em></' + (can ? 'button' : 'div') + '>';
      }

      /* ---------------- lista ---------------- */
      function tabPlanes(p) {
        p.innerHTML = '<div class="card"><div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px"><label class="fld" style="min-width:180px">Estado<select id="pl-fest"><option value="">Todos</option>' + EDU.ui.opciones(ESTADOS, S.estado).s + '</select></label></div><div id="pl-lista"></div></div>';
        function filas() { return fCarga(ctx.planes).filter(function (x) { return !S.estado || x.estado === S.estado; }); }
        var acc = [{ texto: 'Abrir', alClic: function (r) { editor(r, {}); } },
          { texto: 'Duplicar', visible: function (r) { return puedeCrear() && PU().puedeEditarDe('planificacion', ctx, r); }, alClic: duplicarPlan },
          { texto: 'Eliminar', tipo: 'dng', visible: puedeBorrar, alClic: eliminar }];
        var tb = EDU.ui.tabla({ etiqueta: 'Planes de clase', caption: 'Planes de clase', filas: filas(), ordenInicial: 'fecha', desc: true, porPagina: 10, acciones: acc, vacio: { titulo: 'No hay planes', texto: 'Crea uno con «Nuevo plan» o desde el calendario.' },
          columnas: [{ clave: 'fecha', titulo: 'Fecha', valor: function (r) { return r.fecha || ''; }, render: function (r) { return esc(f(r.fecha)); } }, { clave: 'tema', titulo: 'Tema' },
            { clave: 'carga', titulo: 'Carga', valor: function (r) { return ctx.etiqueta(ctx.todasCargas[r.cargaId]); } },
            { clave: 'estado', titulo: 'Estado', render: function (r) { return PU().badgeEstado(r.estado).s + (bloqueado(r) ? ' <span class="badge neu">bloqueado</span>' : ''); } },
            { clave: 'sec', titulo: 'Secuencia', valor: function (r) { return r.secuenciaId && ctx.secPorId[r.secuenciaId] ? ctx.secPorId[r.secuenciaId].titulo : ''; } }] });
        p.querySelector('#pl-lista').appendChild(tb.el);
        p.querySelector('#pl-fest').addEventListener('change', function (e) { S.estado = e.target.value; tb.actualizar(filas()); });
      }

      /* ---------------- cobertura ---------------- */
      function tabCobertura(p) {
        var secs = fCarga(ctx.secuencias), sin = fCarga(ctx.planes).filter(function (x) { return !x.secuenciaId; }).length;
        if (!secs.length) { p.innerHTML = '<div class="card">' + EDU.ui.vacio({ titulo: 'Sin secuencias didácticas', texto: 'La cobertura se calcula a partir de las secuencias y sus indicadores de logro.', accion: { texto: 'Ir a secuencias', href: '#/secuencias' } }).s + '</div>'; return; }
        p.innerHTML = '<div class="card"><h2>Cobertura de indicadores de logro</h2><p class="note" style="margin-top:0">Un indicador cuenta como <b>planificado</b> si algún plan vinculado a la secuencia lo marca, e <b>impartido</b> si ese plan está impartido. Planes sin secuencia: ' + sin + '.</p>' +
          secs.map(function (s) {
            var c = PU().cobertura(s, ctx.planes);
            return '<div style="margin:16px 0"><h3 style="font-size:17px"><a href="#/secuencias/' + esc(s.id) + '">' + esc(s.titulo) + '</a> <small style="font:500 13px var(--sans);color:var(--muted)">' + esc(ctx.etiqueta(ctx.todasCargas[s.cargaId])) + '</small></h3>' +
              (c.total ? EDU.ui.progreso({ etiqueta: 'Planificados', valor: c.planificados / c.total * 100, minimo: 0, texto: c.planificados + '/' + c.total }).s + EDU.ui.progreso({ etiqueta: 'Impartidos', valor: c.impartidos / c.total * 100, minimo: 0, texto: c.impartidos + '/' + c.total }).s +
                (c.faltan.length ? '<details><summary>Indicadores sin planificar (' + c.faltan.length + ')</summary><ul class="sq-lista">' + c.faltan.map(function (i) { return '<li><span>' + esc(i.texto) + '</span></li>'; }).join('') + '</ul></details>' : '<p class="note">Todos los indicadores están planificados.</p>')
                : '<p class="note">Esta secuencia no tiene indicadores de logro.</p>') + '</div>';
          }).join('') + '</div>';
      }

      /* ---------------- editor de plan ---------------- */
      function fld(id, label, control, extra) { return '<div' + (extra ? ' class="' + extra + '"' : '') + '><label class="l" for="pe-' + id + '">' + label + '</label>' + control + '<span class="err" id="pe-' + id + '-e" role="alert"></span></div>'; }
      function filaAct(a) {
        return '<div class="pl-act"><select aria-label="Fase" data-f="fase">' + EDU.ui.opciones(FASES, a.fase).s + '</select><input type="number" min="0" max="240" aria-label="Minutos" data-f="minutos" value="' + esc(a.minutos == null ? '' : a.minutos) + '" placeholder="min">' +
          '<input type="text" aria-label="Descripción de la actividad" data-f="descripcion" value="' + esc(a.descripcion || '') + '" placeholder="Descripción"><button type="button" class="btn dng sm" data-quitar aria-label="Quitar actividad">Quitar</button></div>';
      }
      async function editor(plan, ini) {
        var nuevo = !plan, ro = nuevo ? !puedeCrear() : !editable(plan);
        var base = plan || { cargaId: ini.cargaId || ctx.cargas[0].id, fecha: ini.fecha || null, hora: ini.hora || '', tema: '', objetivos: [], competencias: [], actividades: [{ fase: 'inicio', minutos: 10, descripcion: '' }, { fase: 'desarrollo', minutos: 25, descripcion: '' }, { fase: 'cierre', minutos: 10, descripcion: '' }],
          recursos: '', evaluacion: '', tarea: '', estado: 'borrador', secuenciaId: ini.secuenciaId || null, indicadorIds: [] };
        if (!base.fecha) { var h = EDU.fmt.hoy(); base.fecha = PU().diaSemana(h) <= 5 ? h : PU().sumaDias(h, 8 - PU().diaSemana(h)); }
        var cargasOpc = ctx.cargas.slice(); if (plan && !ctx.cargaPorId[plan.cargaId] && ctx.todasCargas[plan.cargaId]) cargasOpc.push(ctx.todasCargas[plan.cargaId]);
        var root = document.createElement('div'); root.className = 'pl-ed';
        var lock = !nuevo && bloqueado(plan) ? '<div class="pl-lock" role="note">Plan impartido: está bloqueado. Solo la dirección puede modificarlo.</div>' : (ro ? '<div class="pl-lock" role="note">Solo lectura: tu rol o la propiedad del plan no permiten editarlo.</div>' : '');
        root.innerHTML = lock + '<div class="form-error hidden" id="pe-err" role="alert" tabindex="-1"></div>' +
          '<div class="g2">' + fld('cargaId', 'Carga docente *', '<select id="pe-cargaId" aria-required="true" aria-describedby="pe-cargaId-e">' + EDU.ui.opciones(cargasOpc.map(function (c) { return { valor: c.id, texto: ctx.etiqueta(c) }; }), base.cargaId).s + '</select>') +
            fld('secuenciaId', 'Secuencia didáctica (opcional)', '<select id="pe-secuenciaId"></select>') + '</div>' +
          '<div class="g3">' + fld('fecha', 'Fecha (lunes a viernes) *', '<input type="date" id="pe-fecha" value="' + esc(base.fecha) + '" aria-required="true" aria-describedby="pe-fecha-e">') + fld('hora', 'Hora', '<input type="time" id="pe-hora" value="' + esc(base.hora || '') + '">') +
            fld('estado', 'Estado', '<select id="pe-estado">' + EDU.ui.opciones(ESTADOS, base.estado).s + '</select>') + '</div>' +
          fld('tema', 'Tema *', '<input type="text" id="pe-tema" value="' + esc(base.tema) + '" aria-required="true" aria-describedby="pe-tema-e" maxlength="200">') +
          fld('objetivos', 'Objetivos (uno por línea)', '<textarea id="pe-objetivos" rows="3">' + esc((base.objetivos || []).join('\n')) + '</textarea>') +
          fld('competencias', 'Competencias (una por línea) <button type="button" class="btn sec sm" id="pe-traer" style="margin-left:8px">Traer de la secuencia</button>', '<textarea id="pe-competencias" rows="3">' + esc((base.competencias || []).join('\n')) + '</textarea>') +
          '<fieldset id="pe-indfs" hidden><legend>Indicadores de logro de la secuencia que se trabajan</legend><div id="pe-inds"></div></fieldset>' +
          '<fieldset><legend>Actividades (inicio, desarrollo, cierre)</legend><div id="pe-acts">' + (base.actividades || []).map(filaAct).join('') + '</div><span class="err" id="pe-acts-e" role="alert"></span>' +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn sec sm" id="pe-addact">Añadir actividad</button><span id="pe-total" class="note" style="margin:0" aria-live="polite"></span></div></fieldset>' +
          fld('recursos', 'Recursos', '<textarea id="pe-recursos" rows="2">' + esc(base.recursos || '') + '</textarea>') + fld('evaluacion', 'Evaluación (técnicas, instrumentos, criterios)', '<textarea id="pe-evaluacion" rows="2">' + esc(base.evaluacion || '') + '</textarea>') +
          fld('tarea', 'Tarea', '<textarea id="pe-tarea" rows="2">' + esc(base.tarea || '') + '</textarea>');
        var $ = function (id) { return root.querySelector('#pe-' + id); };
        function secDeCarga(cid) { return ctx.secuencias.filter(function (s) { return s.cargaId === cid; }); }
        function pintarSec() {
          var cid = $('cargaId').value, l = secDeCarga(cid), cur = $('secuenciaId').value || base.secuenciaId || '';
          $('secuenciaId').innerHTML = '<option value="">Sin secuencia</option>' + EDU.ui.opciones(l.map(function (s) { return { valor: s.id, texto: s.titulo }; }), cur).s;
          pintarInds();
        }
        function pintarInds() {
          var s = ctx.secPorId[$('secuenciaId').value], fs = root.querySelector('#pe-indfs'), sel = {};
          Array.prototype.forEach.call(root.querySelectorAll('#pe-inds input:checked'), function (c) { sel[c.value] = true; });
          if (!root.querySelector('#pe-inds input')) (base.indicadorIds || []).forEach(function (u) { sel[u] = true; });
          if (!s || !(s.indicadoresLogro || []).length) { fs.hidden = true; root.querySelector('#pe-inds').innerHTML = ''; return; }
          fs.hidden = false;
          root.querySelector('#pe-inds').innerHTML = s.indicadoresLogro.map(function (i, k) { return '<label class="ck"><input type="checkbox" value="' + esc(i.uid) + '"' + (sel[i.uid] ? ' checked' : '') + (ro ? ' disabled' : '') + '><span>' + esc(i.texto) + '</span></label>'; }).join('');
        }
        function total() { var t = 0; Array.prototype.forEach.call(root.querySelectorAll('#pe-acts [data-f=minutos]'), function (i) { t += parseInt(i.value, 10) || 0; }); $('total').textContent = 'Total: ' + t + ' minutos'; }
        $('cargaId').addEventListener('change', function () { $('secuenciaId').value = ''; pintarSec(); });
        $('secuenciaId').addEventListener('change', function () { root.querySelectorAll('#pe-inds input').forEach(function (c) { c.checked = false; }); pintarInds(); });
        $('traer').addEventListener('click', function () {
          var s = ctx.secPorId[$('secuenciaId').value]; if (!s) { EDU.ui.toast('Elige primero una secuencia.', 'warn'); return; }
          var ya = PU().lineas($('competencias').value), nuevas = (s.competenciasEspecificas || []).concat(s.competenciasFundamentales || []).map(function (x) { return x.texto; }).filter(function (t) { return ya.indexOf(t) === -1; });
          $('competencias').value = ya.concat(nuevas).join('\n');
        });
        root.querySelector('#pe-acts').addEventListener('click', function (e) { var q = e.target.closest('[data-quitar]'); if (q) { q.parentNode.remove(); total(); } });
        root.querySelector('#pe-acts').addEventListener('input', total);
        $('addact').addEventListener('click', function () { var d = document.createElement('div'); d.innerHTML = filaAct({ fase: 'desarrollo', minutos: '', descripcion: '' }); var r = d.firstChild; root.querySelector('#pe-acts').appendChild(r); total(); r.querySelector('input[data-f=descripcion]').focus(); });
        pintarSec(); total();
        if (ro) root.querySelectorAll('input,select,textarea,button').forEach(function (e) { e.disabled = true; });
        if (ro) $('traer').remove();

        function validar() {
          var er = {}, v = { cargaId: $('cargaId').value, fecha: $('fecha').value, tema: $('tema').value.trim(), hora: $('hora').value };
          if (!v.cargaId || !ctx.todasCargas[v.cargaId]) er.cargaId = 'Elige una carga docente.';
          if (!PU().fechaValida(v.fecha)) er.fecha = 'Indica una fecha válida.'; else if (PU().diaSemana(v.fecha) > 5) er.fecha = 'La fecha debe ser de lunes a viernes.';
          if (!v.tema) er.tema = 'El tema es obligatorio.';
          var acts = [];
          Array.prototype.forEach.call(root.querySelectorAll('#pe-acts .pl-act'), function (r) {
            var fase = r.querySelector('[data-f=fase]').value, m = r.querySelector('[data-f=minutos]').value.trim(), d = r.querySelector('[data-f=descripcion]').value.trim();
            if (!m && !d) return;
            if (m && !/^\d{1,3}$/.test(m)) { er.acts = 'Los minutos deben ser un entero de 0 a 999.'; return; }
            if (!d) { er.acts = 'Cada actividad con minutos necesita una descripción.'; return; }
            acts.push({ fase: fase, minutos: m === '' ? 0 : +m, descripcion: d });
          });
          return { er: er, v: v, acts: acts };
        }
        var m;
        async function guardar(cerrar) {
          var box = $('err'), r = validar(), er = r.er;
          root.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); }); root.querySelectorAll('.err').forEach(function (e) { e.textContent = ''; });
          var claves = Object.keys(er);
          if (claves.length) {
            claves.forEach(function (k) { var e = $(k === 'acts' ? 'addact' : k); var s = root.querySelector('#pe-' + k + '-e'); if (s) s.textContent = er[k]; if (e && k !== 'acts') e.setAttribute('aria-invalid', 'true'); });
            box.classList.remove('hidden'); box.textContent = 'Revisa: ' + claves.map(function (k) { return er[k]; }).join(' '); box.focus(); return;
          }
          box.classList.add('hidden');
          try {
            var cg = ctx.todasCargas[r.v.cargaId], inds = Array.prototype.map.call(root.querySelectorAll('#pe-inds input:checked'), function (c) { return c.value; }), sid = $('secuenciaId').value || null;
            var rec = Object.assign({}, plan || {}, { cargaId: cg.id, docenteId: cg.docenteId, centroId: (plan && plan.centroId) || cg.centroId, fecha: r.v.fecha, hora: r.v.hora || '', tema: r.v.tema,
              objetivos: PU().lineas($('objetivos').value), competencias: PU().lineas($('competencias').value), actividades: r.acts, recursos: $('recursos').value.trim(), evaluacion: $('evaluacion').value.trim(), tarea: $('tarea').value.trim(),
              estado: $('estado').value, secuenciaId: sid, indicadorIds: sid ? inds : [] });
            await EDU.repo.guardar('planes', rec);
            EDU.ui.toast('Plan guardado.', 'ok'); cerrar(true);
          } catch (e) { box.classList.remove('hidden'); box.textContent = e.message || 'No se pudo guardar.'; box.focus(); }
        }
        var botones = [{ texto: ro ? 'Cerrar' : 'Cancelar', tipo: 'sec', valor: null }];
        if (!ro) botones.push({ texto: 'Guardar plan', tipo: 'amb', alClic: guardar });
        m = EDU.ui.modal({ titulo: nuevo ? 'Nuevo plan de clase' : 'Plan de clase', tamano: 'lg', contenido: root, botones: botones });
        if (await m.resultado) { var fch = PU().lunesDe(root.querySelector('#pe-fecha').value || S.semana); S.semana = PU().fechaValida(fch) ? fch : S.semana; await refrescar(); }
      }

      /* ---------------- duplicar / eliminar ---------------- */
      function copiaDe(p, fecha) {
        var c = Object.assign({}, p, { fecha: fecha, estado: 'borrador', duplicadoDe: p.id }); delete c.id; delete c.creadoEn; delete c.actualizadoEn; return c;
      }
      async function duplicarPlan(p) {
        var m, ini = PU().sumaDias(p.fecha, 7);
        var cuerpo = document.createElement('div'); cuerpo.className = 'pl-ed';
        cuerpo.innerHTML = '<p>Se creará una copia en <b>borrador</b> de «' + esc(p.tema) + '».</p><label class="l" for="pd-fecha">Fecha de la copia (lunes a viernes)</label><input type="date" id="pd-fecha" value="' + esc(ini) + '"><span class="err" id="pd-e" role="alert"></span>';
        m = EDU.ui.modal({ titulo: 'Duplicar plan', tamano: 'sm', contenido: cuerpo, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null }, { texto: 'Duplicar', tipo: 'amb', alClic: async function (cerrar) {
          var d = cuerpo.querySelector('#pd-fecha').value, e = cuerpo.querySelector('#pd-e');
          if (!PU().fechaValida(d) || PU().diaSemana(d) > 5) { e.textContent = 'Indica una fecha de lunes a viernes.'; cuerpo.querySelector('#pd-fecha').setAttribute('aria-invalid', 'true'); return; }
          try { await EDU.repo.guardar('planes', copiaDe(p, d)); cerrar(d); } catch (er) { e.textContent = er.message; }
        } }] });
        var d = await m.resultado;
        if (d) { EDU.ui.toast('Plan duplicado al ' + f(d) + '.', 'ok'); S.semana = PU().lunesDe(d); await refrescar(); }
      }
      async function duplicarSemana() {
        var origen = fCarga(ctx.planes).filter(function (x) { return PU().lunesDe(x.fecha) === S.semana && PU().puedeEditarDe('planificacion', ctx, x); });
        var cuerpo = document.createElement('div'); cuerpo.className = 'pl-ed';
        cuerpo.innerHTML = '<p>Se copiarán <b>' + origen.length + '</b> plan(es) de la semana del ' + esc(f(S.semana)) + ' como borradores, en los mismos días de la semana elegida.</p>' +
          '<label class="l" for="pd-sem">Semana destino (cualquier fecha de esa semana)</label><input type="date" id="pd-sem" value="' + esc(PU().sumaDias(S.semana, 7)) + '"><span class="err" id="pd-e" role="alert"></span>';
        var m = EDU.ui.modal({ titulo: 'Duplicar semana', tamano: 'sm', contenido: cuerpo, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null }, { texto: 'Duplicar', tipo: 'amb', alClic: async function (cerrar) {
          var d = cuerpo.querySelector('#pd-sem').value, e = cuerpo.querySelector('#pd-e');
          if (!PU().fechaValida(d)) { e.textContent = 'Indica una fecha válida.'; return; }
          var dest = PU().lunesDe(d); if (dest === S.semana) { e.textContent = 'Elige una semana distinta.'; return; }
          if (!origen.length) { e.textContent = 'No hay planes que duplicar en esta semana.'; return; }
          try {
            var n = 0, off = Math.round((PU().aFecha(dest) - PU().aFecha(S.semana)) / 86400000);
            for (var i = 0; i < origen.length; i++) {
              var fecha = PU().sumaDias(origen[i].fecha, off);
              var ya = ctx.planes.some(function (x) { return x.cargaId === origen[i].cargaId && x.fecha === fecha && x.tema === origen[i].tema; });
              if (!ya) { await EDU.repo.guardar('planes', copiaDe(origen[i], fecha)); n++; }
            }
            cerrar({ n: n, dest: dest });
          } catch (er) { e.textContent = er.message; }
        } }] });
        var r = await m.resultado;
        if (r) { EDU.ui.toast(r.n + ' plan(es) duplicado(s) a la semana del ' + f(r.dest) + '.', r.n ? 'ok' : 'warn'); S.semana = r.dest; await refrescar(); }
      }
      async function eliminar(p) {
        if (!(await EDU.ui.confirmar({ titulo: 'Eliminar plan', mensaje: '¿Eliminar el plan «' + p.tema + '»?', textoOk: 'Eliminar', peligro: true }))) return;
        await EDU.repo.borrar('planes', p.id); EDU.ui.toast('Plan eliminado.', 'ok'); await refrescar();
      }

      await cargar(); pintar();
      if (params.nuevo === '1' && puedeCrear()) {
        var cid = params.cargaId && ctx.cargaPorId[params.cargaId] ? params.cargaId : ctx.cargas[0].id;
        editor(null, { cargaId: cid, secuenciaId: params.secuenciaId || null });
      }
    }
  });
})();
