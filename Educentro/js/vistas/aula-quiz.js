/* Aula virtual · cuestionarios: banco de preguntas, editor, intento del estudiante (tiempo opcional), autocalificacion y revision.
   Preguntas: opcion multiple y verdadero/falso. Sin eval. Todo dato de usuario se escapa con EDU.esc. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var A = EDU.aula, esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui;
  var Q = (A.quiz = {});

  function clon(x) { return JSON.parse(JSON.stringify(x)); }
  function nuevaPregunta(tipo) {
    if (tipo === 'vf') return { id: 'p_' + A.uid(), tipo: 'vf', enunciado: '', opciones: [], correcta: 'v', puntos: 1 };
    var a = { id: 'o_' + A.uid(), texto: '' }, b = { id: 'o_' + A.uid(), texto: '' };
    return { id: 'p_' + A.uid(), tipo: 'opcion', enunciado: '', opciones: [a, b], correcta: a.id, puntos: 1 };
  }
  function validarPreguntas(ps) {
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], n = 'Pregunta ' + (i + 1) + ': ';
      if (!String(p.enunciado || '').trim()) return n + 'escribe el enunciado.';
      if (!(+p.puntos > 0)) return n + 'los puntos deben ser mayores que 0.';
      if (p.tipo === 'vf') { if (p.correcta !== 'v' && p.correcta !== 'f') return n + 'marca la respuesta correcta.'; }
      else {
        if ((p.opciones || []).length < 2) return n + 'necesita al menos 2 opciones.';
        if (p.opciones.some(function (o) { return !String(o.texto || '').trim(); })) return n + 'completa el texto de todas las opciones.';
        if (!p.opciones.some(function (o) { return o.id === p.correcta; })) return n + 'marca la opción correcta.';
      }
    }
    return null;
  }
  function textoRespuesta(p, r) {
    if (r == null || r === '') return 'Sin responder';
    if (p.tipo === 'vf') return r === 'v' ? 'Verdadero' : 'Falso';
    var o = (p.opciones || []).filter(function (x) { return x.id === r; })[0]; return o ? o.texto : 'Sin responder';
  }

  /* ---------- editor de preguntas (compartido por cuestionario y banco) ---------- */
  function editorPreguntas(host, ps, opts) {
    opts = opts || {};
    function pintar(foco) {
      host.innerHTML = ps.length ? ps.map(function (p, i) {
        var h = '<fieldset class="aula-preg" data-i="' + i + '"><legend>Pregunta ' + (i + 1) + '</legend>' +
          '<div class="fgrid">' + A.campo({ n: 'enun' + i, label: 'Enunciado', tipo: 'textarea', rows: 2, v: p.enunciado, req: true, max: 500, attrs: ' data-f="enun" data-i="' + i + '"' }) +
          A.campo({ n: 'tipo' + i, label: 'Tipo', tipo: 'select', vacio: false, opciones: [{ valor: 'opcion', texto: 'Opción múltiple' }, { valor: 'vf', texto: 'Verdadero / Falso' }], v: p.tipo, attrs: ' data-f="tipo" data-i="' + i + '"' }) +
          A.campo({ n: 'pts' + i, label: 'Puntos', tipo: 'number', v: p.puntos, attrs: ' data-f="pts" data-i="' + i + '"' }) + '</div>';
        if (p.tipo === 'vf') {
          h += '<div role="radiogroup" aria-label="Respuesta correcta de la pregunta ' + (i + 1) + '" class="aula-opciones">' + [['v', 'Verdadero'], ['f', 'Falso']].map(function (o) {
            return '<label class="opt aula-opt"><input type="radio" name="cor' + i + '" data-f="cor" data-i="' + i + '" value="' + o[0] + '"' + (p.correcta === o[0] ? ' checked' : '') + '><span>' + o[1] + (p.correcta === o[0] ? ' (correcta)' : '') + '</span></label>'; }).join('') + '</div>';
        } else {
          h += '<div role="radiogroup" aria-label="Opciones de la pregunta ' + (i + 1) + '; marca la correcta" class="aula-opciones">' + p.opciones.map(function (o, k) {
            return '<div class="aula-opc"><label class="aula-radio-l"><input type="radio" class="aula-radio" name="cor' + i + '" data-f="cor" data-i="' + i + '" value="' + esc(o.id) + '"' + (p.correcta === o.id ? ' checked' : '') + ' aria-label="Marcar la opción ' + (k + 1) + ' como correcta"></label>' +
              '<input type="text" data-f="otxt" data-i="' + i + '" data-k="' + k + '" value="' + esc(o.texto) + '" maxlength="200" aria-label="Texto de la opción ' + (k + 1) + '" placeholder="Opción ' + (k + 1) + '">' +
              '<button type="button" class="btn sec sm aula-x" data-act="opc-del" data-i="' + i + '" data-k="' + k + '" aria-label="Quitar la opción ' + (k + 1) + '"' + (p.opciones.length <= 2 ? ' disabled' : '') + '>&times;</button></div>'; }).join('') +
            (p.opciones.length < 6 ? '<button type="button" class="btn sec sm" data-act="opc-add" data-i="' + i + '">Añadir opción</button>' : '') + '</div>';
        }
        h += '<div class="aula-acc"><button type="button" class="btn sec sm" data-act="preg-del" data-i="' + i + '">Quitar pregunta</button>' +
          (opts.alBanco ? '<button type="button" class="btn sec sm" data-act="preg-banco" data-i="' + i + '">Guardar en el banco</button>' : '') + '</div></fieldset>';
        return h;
      }).join('') : '<p class="note">Aún no hay preguntas.</p>';
      if (foco) { var f = host.querySelector(foco); if (f) f.focus(); }
    }
    host.addEventListener('input', function (e) {
      var t = e.target, i = +t.dataset.i, p = ps[i]; if (!p || !t.dataset.f) return;
      if (t.dataset.f === 'enun') p.enunciado = t.value;
      else if (t.dataset.f === 'pts') p.puntos = A.num(t.value) == null ? t.value : A.num(t.value);
      else if (t.dataset.f === 'otxt') p.opciones[+t.dataset.k].texto = t.value;
    });
    host.addEventListener('change', function (e) {
      var t = e.target, i = +t.dataset.i, p = ps[i]; if (!p || !t.dataset.f) return;
      if (t.dataset.f === 'cor') { p.correcta = t.value; pintar('[data-f=cor][data-i="' + i + '"]:checked'); }
      else if (t.dataset.f === 'tipo' && t.value !== p.tipo) { var n = nuevaPregunta(t.value); n.id = p.id; n.enunciado = p.enunciado; n.puntos = p.puntos; ps[i] = n; pintar('[data-f=tipo][data-i="' + i + '"]'); }
    });
    host.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return; var i = +b.dataset.i, p = ps[i];
      try {
        if (b.dataset.act === 'preg-del') { ps.splice(i, 1); pintar(ps.length ? '[data-f=enun]' : null); }
        else if (b.dataset.act === 'opc-add') { p.opciones.push({ id: 'o_' + A.uid(), texto: '' }); pintar('[data-f=otxt][data-i="' + i + '"][data-k="' + (p.opciones.length - 1) + '"]'); }
        else if (b.dataset.act === 'opc-del') { var k = +b.dataset.k, o = p.opciones.splice(k, 1)[0]; if (p.correcta === o.id) p.correcta = p.opciones[0].id; pintar('[data-f=otxt][data-i="' + i + '"]'); }
        else if (b.dataset.act === 'preg-banco') { var er = validarPreguntas([p]); if (er) { ui.toast(er.replace('Pregunta 1', 'Pregunta ' + (i + 1)), 'error'); return; } await opts.alBanco(clon(p)); }
      } catch (err) { ui.toast(err.message || 'No se pudo completar la acción', 'error'); }
    });
    pintar();
    return { agregar: function (p) { ps.push(p); pintar('[data-f=enun][data-i="' + (ps.length - 1) + '"]'); }, repintar: pintar };
  }

  /* ---------- banco de preguntas ---------- */
  async function obtenerBanco(ctx) {
    var id = 'ban_' + ctx.cg.id, b = ctx.d.cuestionarios.filter(function (x) { return x.id === id; })[0];
    return b || { id: id, tipo: 'banco', centroId: ctx.cg.centroId, cargaId: ctx.cg.id, titulo: 'Banco de preguntas', preguntas: [], creadoEn: undefined };
  }
  Q.banco = async function (ctx, panel) {
    var banco = clon(await obtenerBanco(ctx)), ps = banco.preguntas;
    panel.innerHTML = '<div class="card"><h2>Banco de preguntas</h2><p class="note" style="margin-top:6px">Guarda aquí preguntas reutilizables. Al crear un cuestionario puedes agregarlas desde el banco.</p>' +
      '<div id="aq-ed" class="aula-preguntas"></div><div class="aula-acc"><button type="button" class="btn sec" data-act="add-opcion">Agregar pregunta de opción múltiple</button><button type="button" class="btn sec" data-act="add-vf">Agregar verdadero/falso</button></div>' +
      '<div class="form-error hidden" role="alert" id="aq-err"></div><div class="form-actions"><a class="btn sec" href="' + A.href(ctx.cg.id, { tab: 'cuestionarios' }) + '">Volver</a><button type="button" class="btn amb" data-act="guardar">Guardar banco</button></div></div>';
    var ed = editorPreguntas(panel.querySelector('#aq-ed'), ps);
    panel.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'add-opcion') ed.agregar(nuevaPregunta('opcion'));
      else if (b.dataset.act === 'add-vf') ed.agregar(nuevaPregunta('vf'));
      else if (b.dataset.act === 'guardar') {
        var er = validarPreguntas(ps), box = panel.querySelector('#aq-err');
        if (er) { box.textContent = er; box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' }); return; }
        try { banco.preguntas = ps; await EDU.repo.guardar('cuestionarios', banco); A.postGuardar(); ui.toast('Banco guardado (' + ps.length + ' preguntas)', 'ok'); EDU.router.ir('aula/' + ctx.cg.id, { tab: 'cuestionarios' }); }
        catch (err) { box.textContent = err.message; box.classList.remove('hidden'); }
      }
    });
  };

  /* ---------- editor de cuestionario ---------- */
  Q.editar = async function (ctx, panel, id) {
    var d = ctx.d, cg = ctx.cg, existente = id && id !== 'nuevo' ? d.cuestionarios.filter(function (x) { return x.id === id && x.cargaId === cg.id && x.tipo !== 'banco'; })[0] : null;
    if (id && id !== 'nuevo' && !existente) { panel.innerHTML = ui.vacio({ titulo: 'Cuestionario no encontrado' }).s; return; }
    var q = existente ? clon(existente) : { titulo: '', instrucciones: '', intentosMax: 1, minutos: null, mostrarRevision: true, regla: 'mejor', publicado: true, preguntas: [], temaId: null, periodoId: '', categoriaId: '', fechaLimite: '', horaLimite: '23:59' };
    var act = q.actividadId ? d.m.act[q.actividadId] : null, hayIntentos = existente && d.intentos.some(function (i) { return i.cuestionarioId === q.id; });
    var per = (EDU.consultas.periodoAbierto(d.periodos, cg.centroId) || {}).id || '';
    var cats = d.categorias.filter(function (c) { return c.cargaId === cg.id; }), temas = A.ordenar(d.aulaContenidos.filter(function (t) { return t.tipo === 'tema' && t.cargaId === cg.id; }), 'orden');
    var ps = q.preguntas;
    panel.innerHTML = '<form class="card aula-form" id="aq-form" novalidate><h2>' + (existente ? 'Editar cuestionario' : 'Nuevo cuestionario') + '</h2>' +
      (hayIntentos ? '<div class="alert"><div><strong>Ya hay intentos registrados</strong><small>Los cambios en las preguntas no recalifican los intentos anteriores.</small></div></div>' : '') +
      '<div class="form-error hidden" role="alert" id="aq-err"></div><div class="fgrid">' +
      A.campo({ n: 'titulo', label: 'Título', req: true, v: q.titulo, max: 120, full: true }) +
      A.campo({ n: 'instrucciones', label: 'Instrucciones', tipo: 'textarea', rows: 2, v: q.instrucciones, max: 1000 }) +
      A.campo({ n: 'temaId', label: 'Tema', tipo: 'select', opciones: temas.map(function (t) { return { valor: t.id, texto: t.titulo }; }), v: q.temaId || '', vacio: 'General (sin tema)' }) +
      A.campo({ n: 'fechaLimite', label: 'Fecha de cierre (opcional)', tipo: 'date', v: q.fechaLimite }) + A.campo({ n: 'horaLimite', label: 'Hora de cierre', tipo: 'time', v: q.horaLimite || '23:59' }) +
      A.campo({ n: 'intentosMax', label: 'Intentos máximos', tipo: 'number', v: q.intentosMax, req: true }) + A.campo({ n: 'minutos', label: 'Tiempo límite (minutos, opcional)', tipo: 'number', v: q.minutos == null ? '' : q.minutos }) +
      A.campo({ n: 'regla', label: 'Nota con varios intentos', tipo: 'select', vacio: false, opciones: [{ valor: 'mejor', texto: 'Mejor intento' }, { valor: 'ultimo', texto: 'Último intento' }, { valor: 'promedio', texto: 'Promedio' }], v: q.regla || 'mejor' }) +
      A.campo({ n: 'periodoId', label: 'Periodo del libro de notas', tipo: 'select', opciones: d.periodos.filter(function (p) { return p.centroId === cg.centroId; }).map(function (p) { return { valor: p.id, texto: p.nombre + (p.cerrado ? ' (cerrado)' : '') }; }), v: (act ? act.periodoId : q.periodoId) || per, dis: !!act, ayuda: act ? 'Ya está en el libro de notas; no se puede cambiar.' : '' }) +
      A.campo({ n: 'categoriaId', label: 'Categoría del libro de notas', tipo: 'select', opciones: cats.map(function (c) { return { valor: c.id, texto: c.nombre + ' (' + c.peso + ' %)' }; }), v: (act ? act.categoriaId : q.categoriaId) || '', dis: !!act, ayuda: cats.length ? '' : 'Esta asignatura aún no tiene categorías en el libro de notas.' }) +
      A.campo({ n: 'mostrarRevision', label: 'El estudiante puede revisar sus respuestas al terminar', tipo: 'check', v: q.mostrarRevision !== false }) +
      A.campo({ n: 'publicado', label: 'Visible para los estudiantes', tipo: 'check', v: q.publicado !== false }) + A.seqCampos(d, cg.id, q) + '</div>' +
      '<h3 style="margin:18px 0 6px">Preguntas</h3><div id="aq-ed" class="aula-preguntas"></div>' +
      '<div class="aula-acc"><button type="button" class="btn sec" data-act="add-opcion">Pregunta de opción múltiple</button><button type="button" class="btn sec" data-act="add-vf">Verdadero / Falso</button><button type="button" class="btn sec" data-act="del-banco">Agregar del banco</button></div>' +
      '<p class="note" id="aq-total"></p><div class="form-actions"><a class="btn sec" href="' + A.href(cg.id, existente ? { tab: 'cuestionarios', quiz: q.id } : { tab: 'cuestionarios' }) + '">Cancelar</a><button type="submit" class="btn amb">Guardar cuestionario</button></div></form>';
    var form = panel.querySelector('#aq-form'), box = panel.querySelector('#aq-err');
    A.seqMontar(d, form);
    var banco = await obtenerBanco(ctx);
    var ed = editorPreguntas(panel.querySelector('#aq-ed'), ps, { alBanco: async function (p) { var b = clon(banco); p.id = 'p_' + A.uid(); b.preguntas.push(p); banco = await EDU.repo.guardar('cuestionarios', b); A.postGuardar(); ui.toast('Pregunta guardada en el banco', 'ok'); } });
    function total() { var t = ps.reduce(function (s, p) { return s + (+p.puntos || 0); }, 0); panel.querySelector('#aq-total').textContent = ps.length + ' pregunta(s) · ' + fmt.num(t, 2).replace(/\.?0+$/, '') + ' puntos en total'; }
    total(); form.addEventListener('input', total); form.addEventListener('change', total);
    panel.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b || b.closest('#aq-ed')) return;
      if (b.dataset.act === 'add-opcion') { ed.agregar(nuevaPregunta('opcion')); total(); }
      else if (b.dataset.act === 'add-vf') { ed.agregar(nuevaPregunta('vf')); total(); }
      else if (b.dataset.act === 'del-banco') {
        if (!banco.preguntas.length) { ui.toast('El banco aún no tiene preguntas.', 'info'); return; }
        var r = await A.formModal({ titulo: 'Agregar del banco', textoOk: 'Agregar seleccionadas', html: '<div class="fld full"><fieldset class="aula-fs"><legend>Preguntas disponibles</legend>' + banco.preguntas.map(function (p, i) {
          return '<label class="opt aula-opt"><input type="checkbox" name="bp" value="' + i + '"><span>' + esc(p.enunciado) + ' <small>(' + (p.tipo === 'vf' ? 'V/F' : 'Opción múltiple') + ', ' + esc(p.puntos) + ' pt)</small></span></label>'; }).join('') + '</fieldset></div>',
          alEnviar: async function (f) { var sel = Array.prototype.map.call(f.querySelectorAll('input[name=bp]:checked'), function (x) { return +x.value; }); if (!sel.length) throw new Error('Selecciona al menos una pregunta.'); return sel; } });
        if (r && r !== true) r.forEach(function (i) { var p = clon(banco.preguntas[i]); p.id = 'p_' + A.uid(); ed.agregar(p); }); total();
      }
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); box.classList.add('hidden');
      try {
        var titulo = A.val(form, 'titulo'); if (!titulo) throw A.error('titulo', 'El título es obligatorio.');
        var intentos = A.num(A.val(form, 'intentosMax')); if (intentos == null || intentos < 1 || intentos > 10 || Math.floor(intentos) !== intentos) throw A.error('intentosMax', 'Los intentos deben ser un entero entre 1 y 10.');
        var min = A.val(form, 'minutos') === '' ? null : A.num(A.val(form, 'minutos')); if (min !== null && (min < 1 || min > 600)) throw A.error('minutos', 'El tiempo debe estar entre 1 y 600 minutos.');
        if (!ps.length) throw new Error('Agrega al menos una pregunta.');
        var er = validarPreguntas(ps); if (er) throw new Error(er);
        var max = ps.reduce(function (s, p) { return s + (+p.puntos); }, 0);
        if (act && Math.abs(act.puntosMax - max) > 1e-9) throw new Error('Este cuestionario ya está en el libro de notas con ' + act.puntosMax + ' puntos; el total de puntos no puede cambiar (ahora suma ' + max + ').');
        var rec = Object.assign({}, existente || {}, A.seqValores(form), { centroId: cg.centroId, cargaId: cg.id, titulo: titulo, instrucciones: A.val(form, 'instrucciones'), temaId: A.val(form, 'temaId') || null, fechaLimite: A.val(form, 'fechaLimite') || '', horaLimite: A.val(form, 'horaLimite') || '23:59',
          intentosMax: intentos, minutos: min, regla: A.val(form, 'regla') || 'mejor', mostrarRevision: A.val(form, 'mostrarRevision'), publicado: A.val(form, 'publicado'), preguntas: ps, puntosMax: max,
          periodoId: act ? act.periodoId : A.val(form, 'periodoId'), categoriaId: act ? act.categoriaId : A.val(form, 'categoriaId') });
        var g = await EDU.repo.guardar('cuestionarios', rec); A.postGuardar();
        ui.toast('Cuestionario guardado', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'cuestionarios', quiz: g.id });
      } catch (err) {
        var el = err.campo && form.elements[err.campo]; if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
        box.textContent = err.message || 'No se pudo guardar.'; box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  /* ---------- lista de cuestionarios ---------- */
  Q.lista = function (ctx, panel) {
    var d = ctx.d, cg = ctx.cg, qs = A.ordenar(A.quizzesDe(d, cg.id, ctx.esDoc), 'fechaLimite');
    var h = '';
    if (ctx.esDoc) h += '<div class="aula-acc"><a class="btn amb" href="' + A.href(cg.id, { tab: 'cuestionarios', editar: 'nuevo' }) + '" id="aq-nuevo">Nuevo cuestionario</a><a class="btn sec" href="' + A.href(cg.id, { tab: 'cuestionarios', banco: '1' }) + '">Banco de preguntas</a></div>';
    h += qs.length ? '<ul class="aula-lista">' + qs.map(function (q) {
      var meta = (q.preguntas || []).length + ' preguntas · ' + fmt.num(q.puntosMax || 0, 2).replace(/\.?0+$/, '') + ' pt · ' + q.intentosMax + ' intento(s)' + (q.minutos ? ' · ' + q.minutos + ' min' : '') + ' · ' + A.fechaLimiteTxt(q);
      var estado = '';
      if (ctx.estId) { var e = A.estadoQuiz(d, q, ctx.estId); estado = ui.badge(e.txt, e.tono).s; }
      else if (ctx.esDoc) estado = ui.badge(q.publicado === false ? 'Oculto' : 'Visible', q.publicado === false ? 'neu' : 'info').s;
      return '<li class="aula-fila"><a class="aula-fila-a" href="' + A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, est: ctx.d.rol === 'tutor' ? ctx.estId : '' }) + '"><span class="aula-ic">' + ui.icono('asistencia', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(q.titulo) + '</strong><small>' + esc(meta) + '</small>' + A.seqChip(d, q) + '</span>' + estado + '</a></li>';
    }).join('') + '</ul>' : ui.vacio({ titulo: 'Sin cuestionarios', texto: ctx.esDoc ? 'Crea el primero con «Nuevo cuestionario».' : 'Tu docente aún no ha publicado cuestionarios.' }).s;
    panel.innerHTML = h;
  };

  /* ---------- detalle ---------- */
  Q.detalle = async function (ctx, panel, id) {
    var d = ctx.d, cg = ctx.cg, q = d.cuestionarios.filter(function (x) { return x.id === id && x.cargaId === cg.id && x.tipo !== 'banco'; })[0];
    if (!q || (q.publicado === false && !ctx.esDoc)) { panel.innerHTML = ui.vacio({ titulo: 'Cuestionario no disponible' }).s + '<p><a class="btn sec" href="' + A.href(cg.id, { tab: 'cuestionarios' }) + '">Volver</a></p>'; return; }
    var info = '<div class="chips"><span class="chip">' + (q.preguntas || []).length + ' preguntas</span><span class="chip">' + fmt.num(q.puntosMax || 0, 2).replace(/\.?0+$/, '') + ' puntos</span><span class="chip">' + q.intentosMax + ' intento(s)</span>' + (q.minutos ? '<span class="chip amb">' + q.minutos + ' min</span>' : '') + '<span class="chip">' + esc(A.fechaLimiteTxt(q)) + '</span>' + A.seqChip(d, q) + '</div>';
    var h = '<p><a class="aula-volver" href="' + A.href(cg.id, { tab: 'cuestionarios', est: d.rol === 'tutor' ? ctx.estId : '' }) + '">&larr; Cuestionarios</a></p><div class="card"><h2>' + esc(q.titulo) + '</h2>' + info + (q.instrucciones ? A.texto(q.instrucciones) : '');
    if (ctx.esDoc) {
      h += '<div class="aula-acc"><a class="btn sec" href="' + A.href(cg.id, { tab: 'cuestionarios', editar: q.id }) + '">Editar</a><button type="button" class="btn amb" data-act="libro">Enviar notas al libro</button><button type="button" class="btn dng" data-act="borrar">Eliminar</button></div></div>';
      var ests = A.estudiantesDe(d, cg);
      h += '<div class="card" style="margin-top:14px"><h2>Resultados</h2><p class="note" style="margin:4px 0 8px">Regla de nota: ' + ({ mejor: 'mejor intento', ultimo: 'último intento', promedio: 'promedio' }[q.regla || 'mejor']) + '.' + (q.actividadId ? ' Ya enlazado al libro de notas.' : '') + '</p><ul class="aula-lista">' + ests.map(function (e) {
        var its = A.intentosDe(d, q.id, e.id), fin = its.filter(function (i) { return i.estado === 'finalizado'; }), pt = A.puntajeQuiz(q, its), ult = fin[fin.length - 1];
        return '<li class="aula-fila"><div class="aula-fila-a"><span class="aula-fila-t"><strong>' + esc(fmt.nombreCompleto(e)) + '</strong><small>' + fin.length + ' intento(s) finalizado(s)</small></span>' +
          (pt == null ? ui.badge('Sin intentos', 'neu').s : ui.badge(A.notaTxt(d, cg, pt, q.puntosMax), 'ok').s) + (ult ? ' <a class="btn sec sm" href="' + A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, revisar: ult.id }) + '" aria-label="Revisar último intento de ' + esc(fmt.nombreCompleto(e)) + '">Revisar</a>' : '') + '</div></li>'; }).join('') + '</ul></div>';
      panel.innerHTML = h;
      panel.onclick = async function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        try {
          if (b.dataset.act === 'borrar') {
            if (!(await ui.confirmar({ titulo: 'Eliminar cuestionario', mensaje: 'Se eliminarán también los intentos. ' + (q.actividadId ? 'Las notas ya enviadas permanecen en el libro de notas.' : ''), textoOk: 'Eliminar', peligro: true }))) return;
            for (var i = 0; i < d.intentos.length; i++) if (d.intentos[i].cuestionarioId === q.id) await EDU.repo.borrar('intentos', d.intentos[i].id);
            await EDU.repo.borrar('cuestionarios', q.id); ui.toast('Cuestionario eliminado', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'cuestionarios' });
          } else if (b.dataset.act === 'libro') {
            var n = 0; for (var k = 0; k < ests.length; k++) { var pt2 = A.puntajeQuiz(q, A.intentosDe(d, q.id, ests[k].id)); if (pt2 != null) { await A.guardarNota(d, q, 'cuestionarios', ests[k].id, pt2, 'Cuestionario: ' + q.titulo); n++; } }
            ui.toast(n ? n + ' nota(s) enviada(s) al libro de notas' : 'Aún no hay intentos finalizados', n ? 'ok' : 'info'); if (n) ctx.recargar();
          }
        } catch (err) { ui.toast(err.message || 'No se pudo completar', 'error'); }
      };
      return;
    }
    h += '</div>';
    if (!ctx.estId) { panel.innerHTML = h; return; }
    var est = A.estadoQuiz(d, q, ctx.estId), fin = est.its.filter(function (i) { return i.estado === 'finalizado'; }), curso = est.its.filter(function (i) { return i.estado !== 'finalizado'; })[0];
    var puedeNuevo = d.rol === 'estudiante' && !curso && !A.vencido(q) && fin.length < q.intentosMax;
    h += '<div class="card" style="margin-top:14px"><h2>Mis intentos</h2>' + (fin.length ? '<ul class="aula-lista">' + fin.map(function (i) {
      return '<li class="aula-fila"><div class="aula-fila-a"><span class="aula-fila-t"><strong>Intento ' + i.numero + '</strong><small>' + esc(fmt.fechaHora(i.fin)) + (i.autoEnviado ? ' · enviado al terminar el tiempo' : '') + '</small></span>' + ui.badge(A.notaTxt(d, cg, i.puntos, i.puntosMax), 'ok').s +
        ' <a class="btn sec sm" href="' + A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, revisar: i.id, est: d.rol === 'tutor' ? ctx.estId : '' }) + '">' + (q.mostrarRevision !== false ? 'Revisar' : 'Ver resultado') + '</a></div></li>'; }).join('') + '</ul>' : '<p class="note">Aún no hay intentos.</p>');
    if (fin.length) { var pt = A.puntajeQuiz(q, est.its); h += '<p style="margin:10px 0 0"><strong>Nota (' + ({ mejor: 'mejor intento', ultimo: 'último intento', promedio: 'promedio' }[q.regla || 'mejor']) + '): ' + esc(A.notaTxt(d, cg, pt, q.puntosMax)) + '</strong></p>'; }
    if (d.rol === 'estudiante') {
      if (curso) h += '<div class="aula-acc"><a class="btn amb" href="' + A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, intento: curso.id }) + '">Continuar intento ' + curso.numero + '</a></div>';
      else if (puedeNuevo) h += '<div class="aula-acc"><button type="button" class="btn amb" data-act="iniciar" id="aq-iniciar">Comenzar intento ' + (fin.length + 1) + ' de ' + q.intentosMax + '</button></div>' + (q.minutos ? '<p class="note">Tendrás ' + q.minutos + ' minutos desde que comiences; al terminar el tiempo el intento se envía automáticamente.</p>' : '');
      else h += '<p class="note">' + (A.vencido(q) ? 'El cuestionario está cerrado.' : 'Ya usaste todos tus intentos.') + '</p>';
    }
    h += '</div>';
    panel.innerHTML = h;
    panel.onclick = async function (e) {
      var b = e.target.closest('[data-act="iniciar"]'); if (!b) return; b.disabled = true;
      try {
        var n = est.its.length + 1, ahora = new Date(), rec = await EDU.repo.guardar('intentos', { id: 'int_' + q.id + '_' + ctx.estId + '_' + n, centroId: cg.centroId, cuestionarioId: q.id, cargaId: cg.id, estudianteId: ctx.estId, numero: n,
          inicio: ahora.toISOString(), limiteFin: q.minutos ? new Date(ahora.getTime() + q.minutos * 60000).toISOString() : null, respuestas: {}, estado: 'en_curso', puntos: null, puntosMax: q.puntosMax });
        A.postGuardar(); EDU.router.ir('aula/' + cg.id, { tab: 'cuestionarios', quiz: q.id, intento: rec.id });
      } catch (err) { b.disabled = false; ui.toast(err.message || 'No se pudo iniciar', 'error'); }
    };
  };

  /* ---------- intento en curso ---------- */
  async function finalizar(ctx, q, it, auto) {
    var g = A.calificarQuiz(q, it.respuestas);
    var rec = await EDU.repo.guardar('intentos', Object.assign({}, it, { estado: 'finalizado', fin: A.ahora(), puntos: g.puntos, puntosMax: g.max, autoEnviado: !!auto }));
    A.postGuardar(); ui.toast(auto ? 'Se acabó el tiempo: tu intento se envió.' : 'Intento enviado', auto ? 'warn' : 'ok');
    EDU.router.ir('aula/' + ctx.cg.id, { tab: 'cuestionarios', quiz: q.id, revisar: rec.id });
  }
  Q.intento = async function (ctx, panel, id, intId) {
    var d = ctx.d, cg = ctx.cg, q = d.cuestionarios.filter(function (x) { return x.id === id && x.cargaId === cg.id && x.tipo !== 'banco'; })[0];
    var it = d.intentos.filter(function (x) { return x.id === intId && x.cuestionarioId === id && x.estudianteId === ctx.estId; })[0];
    if (d.rol !== 'estudiante' || !q || !it) { panel.innerHTML = ui.vacio({ titulo: 'Intento no disponible' }).s; return; }
    if (it.estado === 'finalizado') { EDU.router.ir('aula/' + cg.id, { tab: 'cuestionarios', quiz: q.id, revisar: it.id }); return; }
    if (it.limiteFin && Date.now() >= new Date(it.limiteFin).getTime()) { await finalizar(ctx, q, it, true); return; }
    var resp = Object.assign({}, it.respuestas);
    panel.innerHTML = '<div class="aula-timer card" id="aq-timer-box"><div><strong>' + esc(q.titulo) + '</strong><small> · Intento ' + it.numero + '</small></div>' + (it.limiteFin ? '<div class="aula-reloj" aria-hidden="true" id="aq-reloj"></div><span class="sr-only" role="status" id="aq-aviso"></span>' : '') + '</div>' +
      '<form class="card aula-form" id="aq-form" novalidate>' + (q.instrucciones ? A.texto(q.instrucciones) : '') + (q.preguntas || []).map(function (p, i) {
        return '<fieldset class="aula-preg aula-resp"><legend><span class="note" style="margin:0">Pregunta ' + (i + 1) + ' · ' + esc(p.puntos) + ' pt</span><br>' + esc(p.enunciado) + '</legend><div class="aula-opciones">' +
          (p.tipo === 'vf' ? [['v', 'Verdadero'], ['f', 'Falso']] : p.opciones.map(function (o) { return [o.id, o.texto]; })).map(function (o) {
            return '<label class="opt aula-opt"><input type="radio" name="r_' + esc(p.id) + '" value="' + esc(o[0]) + '"' + (resp[p.id] === o[0] ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>'; }).join('') + '</div></fieldset>'; }).join('') +
      '<div class="form-actions"><button type="submit" class="btn amb" id="aq-fin">Finalizar y enviar</button></div></form>';
    var form = panel.querySelector('#aq-form'), busy = false;
    form.addEventListener('change', async function (e) {
      var t = e.target; if (t.type !== 'radio') return; var pid = t.name.slice(2); resp[pid] = t.value;
      try { await EDU.repo.guardar('intentos', Object.assign({}, it, { respuestas: resp })); it.respuestas = Object.assign({}, resp); } catch (err) { ui.toast(err.message || 'No se pudo guardar la respuesta', 'error'); }
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); if (busy) return;
      var sin = (q.preguntas || []).filter(function (p) { return !resp[p.id]; }).length;
      if (!(await ui.confirmar({ titulo: 'Finalizar intento', mensaje: sin ? 'Tienes ' + sin + ' pregunta(s) sin responder. ¿Enviar de todos modos?' : '¿Enviar tus respuestas? No podrás cambiarlas después.', textoOk: 'Enviar' }))) return;
      busy = true; try { it.respuestas = Object.assign({}, resp); await finalizar(ctx, q, it, false); } catch (err) { busy = false; ui.toast(err.message || 'No se pudo enviar', 'error'); }
    });
    if (it.limiteFin) {
      var fin = new Date(it.limiteFin).getTime(), reloj = panel.querySelector('#aq-reloj'), av = panel.querySelector('#aq-aviso'), avisado = {};
      var tick = function () {
        var s = Math.max(0, Math.round((fin - Date.now()) / 1000)), m = Math.floor(s / 60);
        reloj.textContent = 'Tiempo restante ' + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); reloj.classList.toggle('aula-reloj-bajo', s <= 60);
        if (s <= 300 && !avisado[5]) { avisado[5] = 1; av.textContent = 'Quedan 5 minutos'; } if (s <= 60 && !avisado[1]) { avisado[1] = 1; av.textContent = 'Queda 1 minuto'; }
        if (s <= 0) { clearInterval(iv); if (!busy) { busy = true; it.respuestas = Object.assign({}, resp); finalizar(ctx, q, it, true).catch(function (err) { ui.toast(err.message, 'error'); }); } }
      };
      var iv = setInterval(tick, 1000); tick(); ctx.limpiar.push(function () { clearInterval(iv); });
    }
  };

  /* ---------- revision ---------- */
  Q.revisar = async function (ctx, panel, id, intId) {
    var d = ctx.d, cg = ctx.cg, q = d.cuestionarios.filter(function (x) { return x.id === id && x.cargaId === cg.id && x.tipo !== 'banco'; })[0];
    var it = d.intentos.filter(function (x) { return x.id === intId && x.cuestionarioId === id; })[0];
    var permitido = it && q && (ctx.esDoc || ['director', 'admin_red', 'secretaria'].indexOf(d.rol) !== -1 || (ctx.estId && it.estudianteId === ctx.estId));
    if (!permitido || it.estado !== 'finalizado') { panel.innerHTML = ui.vacio({ titulo: 'Intento no disponible' }).s; return; }
    var verRev = ctx.esDoc || ['director', 'admin_red', 'secretaria'].indexOf(d.rol) !== -1 || q.mostrarRevision !== false, g = A.calificarQuiz(q, it.respuestas), est = d.m.est[it.estudianteId];
    var h = '<p><a class="aula-volver" href="' + A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, est: d.rol === 'tutor' ? ctx.estId : '' }) + '">&larr; ' + esc(q.titulo) + '</a></p><div class="card"><h2>Resultado' + (est && ctx.estId == null ? ' de ' + esc(fmt.nombreCompleto(est)) : '') + '</h2>' +
      '<p class="aula-nota"><strong>' + esc(A.notaTxt(d, cg, it.puntos, it.puntosMax)) + '</strong> <span class="note" style="margin:0">' + esc(fmt.num(it.puntos, 2).replace(/\.?0+$/, '')) + ' de ' + esc(fmt.num(it.puntosMax, 2).replace(/\.?0+$/, '')) + ' puntos · Intento ' + it.numero + ' · ' + esc(fmt.fechaHora(it.fin)) + '</span></p></div>';
    if (verRev) h += (q.preguntas || []).map(function (p, i) {
      var r = it.respuestas ? it.respuestas[p.id] : null, x = g.detalle[p.id] || { ok: false, puntos: 0 }, corr = p.tipo === 'vf' ? (p.correcta === 'v' ? 'Verdadero' : 'Falso') : textoRespuesta(p, p.correcta);
      return '<div class="card aula-rev" style="margin-top:12px"><p class="note" style="margin:0">Pregunta ' + (i + 1) + ' · ' + ui.badge(x.ok ? 'Correcta' : (r == null || r === '' ? 'Sin responder' : 'Incorrecta'), x.ok ? 'ok' : 'bad').s + ' ' + esc(x.puntos) + '/' + esc(p.puntos) + ' pt</p><p style="margin:6px 0"><strong>' + esc(p.enunciado) + '</strong></p>' +
        '<p style="margin:0">Respuesta: ' + esc(textoRespuesta(p, r)) + '</p>' + (x.ok ? '' : '<p style="margin:4px 0 0;color:var(--ok)">Correcta: ' + esc(corr) + '</p>') + '</div>'; }).join('');
    else h += '<p class="note">Tu docente no habilitó la revisión de respuestas para este cuestionario.</p>';
    panel.innerHTML = h;
  };
})();
