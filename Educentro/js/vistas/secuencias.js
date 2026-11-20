/* Vistas "secuencias" y "secuencias/:id": secuencia didactica por unidad/situacion de aprendizaje (lista, ficha imprimible y editor guiado).
   Toma competencias/contenidos/indicadores del curriculo (js/vistas/curriculo.js). Formato pendiente de validar con el modelo oficial MINERD. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, PU = function () { return EDU.planUtil; };
  var FASES = [{ k: 'inicio', t: 'Inicio' }, { k: 'desarrollo', t: 'Desarrollo' }, { k: 'cierre', t: 'Cierre' }];
  var ESTADOS = [{ valor: 'borrador', texto: 'Borrador' }, { valor: 'lista', texto: 'Lista' }, { valor: 'en_ejecucion', texto: 'En ejecución' }, { valor: 'finalizada', texto: 'Finalizada' }];
  var LISTAS = [{ k: 'competenciasFundamentales', tipo: 'competencia_fundamental', t: 'Competencias fundamentales' }, { k: 'competenciasEspecificas', tipo: 'competencia_especifica', t: 'Competencias específicas' },
    { k: 'contenidos', tipo: 'contenido', t: 'Contenidos' }, { k: 'indicadoresLogro', tipo: 'indicador', t: 'Indicadores de logro' }];
  var AVISO = '<div class="alert"><div><strong>Formato pendiente de validar con el modelo oficial MINERD</strong><small>Los campos y nombres de fases siguen la propuesta de docs/PLAN.md; el formato exacto de la secuencia didáctica oficial aún no se ha verificado.</small></div></div>';

  function f(d) { return d ? EDU.fmt.fecha(d) : '—'; }
  function lista(arr) { return arr && arr.length ? '<ul class="sq-lista">' + arr.map(function (x) { return '<li><span>' + esc(x) + '</span></li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">—</p>'; }
  function txt(t) { return t ? esc(t) : '—'; }
  function nuevoUid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function chipEstado(x) { return x.estado === 'pendiente' ? ' <span class="badge warn">pendiente de validar</span>' : x.estado === 'propio' ? ' <span class="badge neu">texto propio</span>' : ''; }

  async function cargarSecuencia(ctx, id) {
    var s = await EDU.repo.obtener('secuencias', id);
    if (!s) return null;
    if (ctx.ses.rol === 'docente' && !ctx.cargaPorId[s.cargaId]) return 'sin_acceso';
    return s;
  }
  function msg(cont, titulo, texto) { cont.innerHTML = EDU.ui.cabecera({ titulo: titulo }).s + '<div class="card"><p>' + esc(texto) + '</p><a class="btn" href="#/secuencias">Volver a secuencias</a></div>'; }

  /* ================= LISTA ================= */
  EDU.router.register('secuencias', {
    titulo: 'Secuencias didácticas',
    render: async function (cont) {
      PU().estilos();
      var ctx = await PU().contexto(), rol = ctx.ses.rol, puedeCrear = EDU.permisos.puede(rol, 'secuencias', 'crear') && ctx.cargas.length > 0;
      var secs = (await EDU.repo.listar('secuencias')).filter(function (s) { return rol !== 'docente' || ctx.cargaPorId[s.cargaId]; });
      var planes = ctx.D.planes;
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Docencia', titulo: 'Secuencias didácticas', descripcion: 'Unidades y situaciones de aprendizaje con competencias, indicadores, fases, sesiones y evaluación.',
        acciones: puedeCrear ? EDU.raw('<a class="btn amb" href="#/secuencias/nueva" id="sq-nueva">Nueva secuencia</a>') : null }).s + AVISO +
        '<div class="card" style="margin-top:14px"><div id="sq-tb"></div></div>';
      var filas = secs.map(function (s) { var cg = ctx.todasCargas[s.cargaId], cob = PU().cobertura(s, planes); return Object.assign({}, s, { _carga: ctx.etiqueta(cg), _cob: cob }); });
      var tb = EDU.ui.tabla({ etiqueta: 'Secuencias didácticas', caption: 'Secuencias didácticas del centro', filas: filas, ordenInicial: 'titulo', porPagina: 10,
        vacio: { titulo: 'Aún no hay secuencias', texto: puedeCrear ? 'Crea la primera con «Nueva secuencia».' : 'Todavía no se han registrado secuencias.' },
        acciones: [{ texto: 'Abrir', alClic: function (r) { EDU.router.ir('secuencias/' + r.id); } }],
        columnas: [{ clave: 'titulo', titulo: 'Título', render: function (r) { return '<a href="#/secuencias/' + esc(r.id) + '">' + esc(r.titulo) + '</a>'; }, valor: function (r) { return r.titulo; } },
          { clave: '_carga', titulo: 'Carga docente' }, { clave: 'estado', titulo: 'Estado', render: function (r) { return PU().badgeEstado(r.estado).s; } },
          { clave: 'ses', titulo: 'Sesiones', align: 'c', valor: function (r) { return r._cob.sesiones; } },
          { clave: 'cob', titulo: 'Indicadores planificados', align: 'c', valor: function (r) { return r._cob.total ? Math.round(r._cob.planificados / r._cob.total * 100) : 0; },
            render: function (r) { return r._cob.total ? esc(r._cob.planificados + '/' + r._cob.total) : '—'; } }] });
      cont.querySelector('#sq-tb').appendChild(tb.el);
    }
  });

  /* ================= FICHA / EDITOR ================= */
  EDU.router.register('secuencias/:id', {
    titulo: 'Secuencia didáctica',
    render: async function (cont, params) {
      PU().estilos();
      var ctx = await PU().contexto(), nueva = params.id === 'nueva', rol = ctx.ses.rol, sec = null;
      if (!nueva) {
        sec = await cargarSecuencia(ctx, params.id);
        if (sec === 'sin_acceso') { msg(cont, 'Sin acceso', 'Esta secuencia pertenece a otro docente.'); return; }
        if (!sec) { msg(cont, 'Secuencia no encontrada', 'La secuencia no existe o pertenece a otro centro.'); return; }
      }
      if (nueva || params.modo === 'editar') {
        if (nueva ? !(EDU.permisos.puede(rol, 'secuencias', 'crear') && ctx.cargas.length) : !PU().puedeEditarDe('secuencias', ctx, sec)) { msg(cont, 'Sin permiso', 'Tu rol no puede ' + (nueva ? 'crear' : 'editar') + ' secuencias.'); return; }
        return editor(cont, ctx, sec, params);
      }
      return ficha(cont, ctx, sec);
    }
  });

  async function ficha(cont, ctx, s) {
    var cg = ctx.todasCargas[s.cargaId], planes = ctx.D.planes.filter(function (p) { return p.secuenciaId === s.id; }).sort(function (a, b) { return (a.fecha || '').localeCompare(b.fecha || ''); });
    var vers = await PU().versiones(), ver = vers.lista.filter(function (v) { return v.id === s.curriculoVersionId; })[0];
    var cob = PU().cobertura(s, ctx.D.planes), per = ctx.D.periodos.filter(function (p) { return p.id === s.periodoId; })[0], centro = (await EDU.repo.listar('centros', {})).filter(function (c) { return c.id === s.centroId; })[0];
    var puedeEd = PU().puedeEditarDe('secuencias', ctx, s), puedeBorrar = puedeEd && EDU.permisos.puede(ctx.ses.rol, 'secuencias', 'borrar');
    var puedePlan = EDU.permisos.puede(ctx.ses.rol, 'planificacion', 'crear') && PU().puedeEditarDe('planificacion', ctx, s);
    function dl(par) { return '<dl>' + par.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; }
    function items(arr) { return arr && arr.length ? '<ul class="sq-lista">' + arr.map(function (x) { return '<li><span>' + esc(x.texto) + chipEstado(x) + '</span></li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">Sin elementos.</p>'; }
    var acciones = '<a class="btn sec" href="#/secuencias">Volver</a> <button type="button" class="btn sec" id="sq-print">Imprimir</button>' +
      (puedePlan ? ' <a class="btn sec" id="sq-sesion" href="#/planificacion?nuevo=1&cargaId=' + encodeURIComponent(s.cargaId) + '&secuenciaId=' + encodeURIComponent(s.id) + '">Crear sesión</a>' : '') +
      (puedeEd ? ' <a class="btn amb" id="sq-editar" href="#/secuencias/' + encodeURIComponent(s.id) + '?modo=editar">Editar</a>' : '') + (puedeBorrar ? ' <button type="button" class="btn dng" id="sq-borrar">Eliminar</button>' : '');
    cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Secuencia didáctica', titulo: s.titulo, descripcion: ctx.etiqueta(cg) + ' · ' + ctx.docente(cg), acciones: EDU.raw(acciones) }).s + AVISO +
      '<div class="sq-doc" style="margin-top:14px"><div class="print-only"><strong>' + esc(centro ? centro.nombre : '') + '</strong></div>' +
      '<div class="card"><h2>Datos generales</h2>' + dl([['Estado', PU().badgeEstado(s.estado).s], ['Carga docente', esc(ctx.etiqueta(cg))], ['Docente', esc(ctx.docente(cg))], ['Nivel · grado', esc([s.nivel, s.grado ? s.grado + '.º' : null].filter(Boolean).join(' · ') || '—')],
        ['Versión de currículo', ver ? esc(ver.nombre) + ' (' + esc(ver.estado) + ')' : '—'], ['Periodo', per ? esc(per.nombre) : '—'], ['Fechas', esc(f(s.fechaInicio) + ' – ' + f(s.fechaFin))], ['Sesiones previstas', esc(s.sesionesPrevistas || '—')]]) + '</div>' +
      '<div class="card"><h2>Currículo</h2>' + LISTAS.map(function (l) { return '<h3 style="font-size:15px;margin:10px 0 6px">' + esc(l.t) + '</h3>' + items(s[l.k]); }).join('') +
        '<h3 style="font-size:15px;margin:10px 0 6px">Ejes transversales</h3>' + lista(s.ejesTransversales) + '</div>' +
      '<div class="card"><h2>Situación de aprendizaje</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">' + txt(s.situacionAprendizaje) + '</p></div>' +
      '<div class="card"><h2>Fases</h2><div class="sq-fases">' + FASES.map(function (fa) {
        var x = (s.fases || []).filter(function (y) { return y.nombre === fa.k; })[0] || {};
        return '<div><h3 style="font-size:16px">' + fa.t + (x.tiempo ? ' · ' + esc(x.tiempo) + ' min' : '') + '</h3><strong style="font-size:13px">Actividades</strong>' + lista(x.actividades) + '<strong style="font-size:13px">Estrategias</strong><p style="margin:2px 0 8px;white-space:pre-wrap;overflow-wrap:anywhere">' + txt(x.estrategias) + '</p><strong style="font-size:13px">Recursos</strong><p style="margin:2px 0;white-space:pre-wrap;overflow-wrap:anywhere">' + txt(x.recursos) + '</p></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><h2>Sesiones vinculadas (planes de clase)</h2>' + (planes.length ? '<ul class="sq-lista">' + planes.map(function (p) { return '<li><span>' + esc(f(p.fecha)) + ' · ' + esc(p.tema) + '</span>' + PU().badgeEstado(p.estado).s + '</li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0">Aún no hay planes vinculados a esta secuencia.</p>') +
        (cob.total ? '<div style="margin-top:12px">' + EDU.ui.progreso({ etiqueta: 'Planificados', valor: cob.planificados / cob.total * 100, minimo: 0, texto: cob.planificados + '/' + cob.total }).s + EDU.ui.progreso({ etiqueta: 'Impartidos', valor: cob.impartidos / cob.total * 100, minimo: 0, texto: cob.impartidos + '/' + cob.total }).s + '</div>' : '') + '</div>' +
      '<div class="card"><h2>Evaluación</h2>' + dl([['Técnicas', txt(s.evaluacion && s.evaluacion.tecnicas)], ['Instrumentos', txt(s.evaluacion && s.evaluacion.instrumentos)], ['Criterios', txt(s.evaluacion && s.evaluacion.criterios)]]) + '</div>' +
      '<div class="card"><h2>Adecuaciones e inclusión</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0">' + txt(s.adecuaciones) + '</p></div></div>';
    cont.querySelector('#sq-print').addEventListener('click', function () { window.print(); });
    var bb = cont.querySelector('#sq-borrar');
    if (bb) bb.addEventListener('click', async function () {
      if (!(await EDU.ui.confirmar({ titulo: 'Eliminar secuencia', mensaje: '¿Eliminar «' + s.titulo + '»? Los planes vinculados quedarán sin secuencia.', textoOk: 'Eliminar', peligro: true }))) return;
      if (!EDU.repo.negocio()) for (var i = 0; i < planes.length; i++) await EDU.repo.guardar('planes', Object.assign({}, planes[i], { secuenciaId: null, indicadorIds: [] })); // modo API: el servidor desvincula los planes en cascada, en la misma transacción
      await EDU.repo.borrar('secuencias', s.id); EDU.ui.toast('Secuencia eliminada.', 'ok'); EDU.router.ir('secuencias');
    });
  }

  async function editor(cont, ctx, sec, params) {
    var vers = await PU().versiones(), periodos = ctx.D.periodos, nueva = !sec, cache = {};
    var cg0 = (params.cargaId && ctx.cargaPorId[params.cargaId]) || ctx.cargas[0];
    var S = nueva ? { cargaId: cg0.id, titulo: '', curriculoVersionId: vers.vigente ? vers.vigente.id : null, periodoId: (EDU.consultas.periodoAbierto(periodos, cg0.centroId) || {}).id || '', fechaInicio: '', fechaFin: '', sesionesPrevistas: '',
      competenciasFundamentales: [], competenciasEspecificas: [], contenidos: [], indicadoresLogro: [], ejesTransversales: '', situacionAprendizaje: '',
      fases: FASES.map(function (x) { return { nombre: x.k, actividades: '', estrategias: '', recursos: '', tiempo: '' }; }), evaluacion: { tecnicas: '', instrumentos: '', criterios: '' }, adecuaciones: '', estado: 'borrador' }
      : JSON.parse(JSON.stringify(sec));
    if (!nueva) {
      S.ejesTransversales = (sec.ejesTransversales || []).join('\n');
      S.fases = FASES.map(function (x) { var y = (sec.fases || []).filter(function (z) { return z.nombre === x.k; })[0] || {}; return { nombre: x.k, actividades: (y.actividades || []).join('\n'), estrategias: y.estrategias || '', recursos: y.recursos || '', tiempo: y.tiempo == null ? '' : String(y.tiempo) }; });
      S.evaluacion = Object.assign({ tecnicas: '', instrumentos: '', criterios: '' }, sec.evaluacion);
      LISTAS.forEach(function (l) { S[l.k] = (sec[l.k] || []).slice(); });
    }
    function get(path) { return path.split('.').reduce(function (o, k) { return o == null ? '' : o[k]; }, S); }
    function set(path, v) { var ks = path.split('.'), o = S; for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
    function campo(label, path, o) {
      o = o || {}; var id = 'sqf-' + path.replace(/\./g, '-'), v = get(path), at = ' id="' + id + '" data-k="' + path + '"' + (o.req ? ' aria-required="true"' : '') + ' aria-describedby="' + id + '-e"';
      var c = o.tipo === 'textarea' ? '<textarea' + at + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + ' rows="' + (o.filas || 3) + '">' + esc(v) + '</textarea>' :
        o.tipo === 'select' ? '<select' + at + '>' + o.opc + '</select>' : '<input type="' + (o.tipo || 'text') + '"' + at + ' value="' + esc(v) + '">';
      return '<div class="' + (o.cls || '') + '"><label class="l" for="' + id + '">' + esc(label) + (o.req ? ' *' : '') + '</label>' + c + '<span class="err" id="' + id + '-e" role="alert"></span></div>';
    }
    function enlazar(p) {
      p.querySelectorAll('[data-k]').forEach(function (e) { var ev = e.tagName === 'SELECT' ? 'change' : 'input'; e.addEventListener(ev, function () { set(e.dataset.k, e.value); if (e.dataset.k === 'cargaId') pintarListas(); }); });
    }
    function cargaSel() { return ctx.todasCargas[S.cargaId]; }
    async function itemsVersion() {
      var vid = S.curriculoVersionId; if (!vid) return [];
      if (!cache[vid]) cache[vid] = await PU().itemsDe(vid);
      return cache[vid];
    }

    cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Secuencia didáctica', titulo: nueva ? 'Nueva secuencia didáctica' : 'Editar secuencia', descripcion: 'Editor guiado en cinco pasos. Las competencias e indicadores se toman del currículo de la versión elegida.' }).s + AVISO +
      '<div class="card pl-ed" style="margin-top:14px"><div class="form-error hidden" id="sq-err" role="alert" tabindex="-1"></div><div id="sq-tabs"></div>' +
      '<div class="form-actions"><a class="btn sec" href="#/secuencias' + (nueva ? '' : '/' + encodeURIComponent(sec.id)) + '" id="sq-cancel">Cancelar</a><button type="button" class="btn amb" id="sq-guardar">Guardar secuencia</button></div></div>';

    /* paso 2: listas del currículo */
    var panel2 = null;
    function pintarListas() {
      if (!panel2) return;
      var zona = panel2.querySelector('#sq-listas'); if (!zona) return;
      zona.innerHTML = LISTAS.map(function (l) {
        return '<fieldset><legend>' + esc(l.t) + '</legend>' + (S[l.k].length ? '<ul class="sq-lista">' + S[l.k].map(function (x, i) {
          return '<li><span>' + esc(x.texto) + chipEstado(x) + '</span><button type="button" class="btn dng sm" data-q="' + l.k + ':' + i + '" aria-label="Quitar ' + esc(x.texto.slice(0, 60)) + '">Quitar</button></li>'; }).join('') + '</ul>' : '<p class="note" style="margin:0 0 8px">Sin elementos.</p>') +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn sec sm" data-p="' + l.k + '">Elegir del currículo</button>' +
          '<input type="text" style="flex:1;min-width:180px" id="sq-own-' + l.k + '" placeholder="Texto propio…" aria-label="Añadir texto propio a ' + esc(l.t) + '"><button type="button" class="btn sm" data-a="' + l.k + '">Añadir</button></div></fieldset>';
      }).join('');
    }
    async function elegir(k) {
      var l = LISTAS.filter(function (x) { return x.k === k; })[0], cg = cargaSel(), curso = ctx.curso(cg), asig = ctx.asig[cg.asignaturaId];
      var todos = PU().aplicables(await itemsVersion(), curso, asig).filter(function (i) { return i.tipo === l.tipo; });
      var sel = {}; S[k].forEach(function (x) { if (x.ref) sel[x.ref] = true; });
      var cuerpo = document.createElement('div');
      cuerpo.innerHTML = '<p class="note" style="margin:0">Elementos aplicables a ' + esc(ctx.etiqueta(cg)) + (curso ? ' (' + esc(curso.nivel) + ', ' + esc(curso.ciclo || '') + ')' : '') + '. Los marcados «pendiente de validar» no están verificados.</p>' +
        '<label class="l" for="sq-bq" style="display:block;margin-top:8px">Buscar</label><input type="text" id="sq-bq" style="width:100%;padding:8px 10px;border:1px solid var(--field-line);border-radius:8px"><div class="sq-pick" id="sq-pick"></div>';
      function pint() {
        var q = EDU.fmt.norm(cuerpo.querySelector('#sq-bq').value).trim(), z = cuerpo.querySelector('#sq-pick');
        var vis = todos.filter(function (i) { return !q || EDU.fmt.norm(i.descripcion).indexOf(q) !== -1; });
        z.innerHTML = vis.length ? vis.map(function (i) { return '<label class="ck"><input type="checkbox" data-id="' + esc(i.id) + '"' + (sel[i.id] ? ' checked' : '') + '><span>' + esc(i.descripcion) + ' ' + (i.estado === 'pendiente' ? '<span class="badge warn">pendiente de validar</span>' : '<span class="badge ok">verificado</span>') + '</span></label>'; }).join('') : '<p class="note">No hay elementos de este tipo para la carga y versión elegidas. Puedes añadir texto propio.</p>';
      }
      cuerpo.addEventListener('change', function (e) { var c = e.target.closest('input[data-id]'); if (c) sel[c.dataset.id] = c.checked; });
      cuerpo.querySelector('#sq-bq').addEventListener('input', pint); pint();
      var ok = await EDU.ui.modal({ titulo: 'Elegir: ' + l.t, tamano: 'lg', contenido: cuerpo, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: false }, { texto: 'Aplicar selección', tipo: 'amb', valor: true }] }).resultado;
      if (!ok) return;
      var propios = S[k].filter(function (x) { return !x.ref; }), previos = {}; S[k].forEach(function (x) { if (x.ref) previos[x.ref] = x; });
      var elegidos = todos.filter(function (i) { return sel[i.id]; }).map(function (i) { return previos[i.id] || { uid: nuevoUid(), ref: i.id, clave: i.clave, texto: i.descripcion, estado: i.estado }; });
      S[k] = elegidos.concat(propios); pintarListas();
    }

    var T = EDU.ui.tabs({ etiqueta: 'Pasos de la secuencia', tabs: [
      { id: 'general', titulo: '1. General', render: function (p) {
        p.innerHTML = '<div class="pl-ed"><div class="g2">' + campo('Carga docente', 'cargaId', { tipo: 'select', req: true, opc: EDU.ui.opciones(ctx.cargas.map(function (c) { return { valor: c.id, texto: ctx.etiqueta(c) }; }), S.cargaId).s }) +
          campo('Estado', 'estado', { tipo: 'select', opc: EDU.ui.opciones(ESTADOS, S.estado).s }) + '</div>' + campo('Título de la unidad / situación de aprendizaje', 'titulo', { req: true }) +
          '<div class="g2">' + campo('Versión de currículo', 'curriculoVersionId', { tipo: 'select', opc: '<option value="">Sin versión</option>' + EDU.ui.opciones(vers.lista.map(function (v) { return { valor: v.id, texto: v.nombre + ' (' + v.estado + ')' }; }), S.curriculoVersionId).s }) +
          campo('Periodo', 'periodoId', { tipo: 'select', opc: '<option value="">—</option>' + EDU.ui.opciones(periodos.map(function (x) { return { valor: x.id, texto: x.nombre }; }), S.periodoId).s }) + '</div>' +
          '<div class="g3">' + campo('Fecha de inicio', 'fechaInicio', { tipo: 'date' }) + campo('Fecha de fin', 'fechaFin', { tipo: 'date' }) + campo('Sesiones previstas', 'sesionesPrevistas', { tipo: 'number' }) + '</div></div>';
        enlazar(p);
      } },
      { id: 'curriculo', titulo: '2. Currículo', render: function (p) {
        panel2 = p; p.innerHTML = '<div class="pl-ed"><p class="note" style="margin-top:0">Elige del currículo vigente lo que se trabajará; cada elemento conserva su estado de verificación. También puedes añadir texto propio.</p><div id="sq-listas"></div>' +
          campo('Ejes transversales (uno por línea)', 'ejesTransversales', { tipo: 'textarea', ph: 'La lista oficial de ejes está pendiente de validar' }) + '</div>';
        enlazar(p); pintarListas();
        p.addEventListener('click', async function (e) {
          var q = e.target.closest('[data-q]'), pk = e.target.closest('[data-p]'), a = e.target.closest('[data-a]');
          if (q) { var pr = q.dataset.q.split(':'); S[pr[0]].splice(+pr[1], 1); pintarListas(); }
          else if (pk) { try { await elegir(pk.dataset.p); } catch (er) { EDU.ui.toast(er.message, 'error'); } }
          else if (a) { var inp = p.querySelector('#sq-own-' + a.dataset.a), t = inp.value.trim(); if (t) { S[a.dataset.a].push({ uid: nuevoUid(), ref: null, clave: null, texto: t, estado: 'propio' }); pintarListas(); var ni = p.querySelector('#sq-own-' + a.dataset.a); if (ni) ni.focus(); } }
        });
      } },
      { id: 'situacion', titulo: '3. Situación', render: function (p) {
        p.innerHTML = '<div class="pl-ed">' + campo('Situación de aprendizaje / problemática', 'situacionAprendizaje', { tipo: 'textarea', filas: 8, ph: 'Describe el contexto o problema que da sentido a la unidad…' }) + '</div>'; enlazar(p);
      } },
      { id: 'fases', titulo: '4. Fases', render: function (p) {
        p.innerHTML = '<div class="pl-ed"><div class="sq-fases">' + FASES.map(function (fa, i) {
          return '<fieldset><legend>' + fa.t + '</legend>' + campo('Actividades (una por línea)', 'fases.' + i + '.actividades', { tipo: 'textarea', filas: 5 }) + campo('Estrategias', 'fases.' + i + '.estrategias', { tipo: 'textarea' }) +
            campo('Recursos', 'fases.' + i + '.recursos', { tipo: 'textarea', filas: 2 }) + campo('Tiempo (minutos)', 'fases.' + i + '.tiempo', { tipo: 'number' }) + '</fieldset>'; }).join('') + '</div>' +
          '<p class="note">Las sesiones (planes de clase) se vinculan desde Planificación o con «Crear sesión» en la ficha de la secuencia.</p></div>'; enlazar(p);
      } },
      { id: 'evaluacion', titulo: '5. Evaluación e inclusión', render: function (p) {
        p.innerHTML = '<div class="pl-ed">' + campo('Técnicas', 'evaluacion.tecnicas', { tipo: 'textarea', ph: 'Observación, interrogatorio, análisis de producciones…' }) + campo('Instrumentos', 'evaluacion.instrumentos', { tipo: 'textarea', ph: 'Lista de cotejo, rúbrica, escala de estimación…' }) +
          campo('Criterios de evaluación', 'evaluacion.criterios', { tipo: 'textarea' }) + campo('Adecuaciones e inclusión', 'adecuaciones', { tipo: 'textarea', filas: 4 }) + '</div>'; enlazar(p);
      } }] });
    cont.querySelector('#sq-tabs').appendChild(T.el);

    function validar() {
      var er = [];
      if (!S.cargaId || !ctx.cargaPorId[S.cargaId]) er.push(['general', 'cargaId', 'Elige una carga docente.']);
      if (!String(S.titulo || '').trim()) er.push(['general', 'titulo', 'El título es obligatorio.']);
      ['fechaInicio', 'fechaFin'].forEach(function (k) { if (S[k] && !PU().fechaValida(S[k])) er.push(['general', k, 'Fecha inválida.']); });
      if (S.fechaInicio && S.fechaFin && S.fechaFin < S.fechaInicio) er.push(['general', 'fechaFin', 'La fecha de fin no puede ser anterior al inicio.']);
      if (S.sesionesPrevistas !== '' && !/^\d{1,3}$/.test(String(S.sesionesPrevistas))) er.push(['general', 'sesionesPrevistas', 'Usa un número entero (0-999).']);
      S.fases.forEach(function (x, i) { if (x.tiempo !== '' && !/^\d{1,3}$/.test(String(x.tiempo))) er.push(['fases', 'fases-' + i + '-tiempo', 'El tiempo de ' + FASES[i].t.toLowerCase() + ' debe ser un entero de minutos.']); });
      return er;
    }
    cont.querySelector('#sq-guardar').addEventListener('click', async function () {
      var box = cont.querySelector('#sq-err'), btn = this;
      cont.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); }); cont.querySelectorAll('.pl-ed .err').forEach(function (e) { e.textContent = ''; });
      var er = validar();
      if (er.length) {
        box.classList.remove('hidden'); box.textContent = 'Revisa: ' + er.map(function (x) { return x[2]; }).join(' ');
        T.seleccionar(er[0][0]);
        er.forEach(function (x) { var e = cont.querySelector('#sqf-' + x[1]); if (e) { e.setAttribute('aria-invalid', 'true'); var s = cont.querySelector('#sqf-' + x[1] + '-e'); if (s) s.textContent = x[2]; } });
        box.focus(); return;
      }
      box.classList.add('hidden'); btn.disabled = true;
      try {
        var cg = cargaSel(), curso = ctx.curso(cg), asig = ctx.asig[cg.asignaturaId];
        var rec = Object.assign({}, S, { titulo: S.titulo.trim(), docenteId: cg.docenteId, area: asig ? asig.nombre : null, areaCodigo: asig ? asig.codigo : null, nivel: curso ? curso.nivel : null, grado: curso ? curso.grado : null,
          sesionesPrevistas: S.sesionesPrevistas === '' ? null : +S.sesionesPrevistas, ejesTransversales: PU().lineas(S.ejesTransversales), curriculoVersionId: S.curriculoVersionId || null, periodoId: S.periodoId || null,
          fases: S.fases.map(function (x) { return { nombre: x.nombre, actividades: PU().lineas(x.actividades), estrategias: x.estrategias.trim(), recursos: x.recursos.trim(), tiempo: x.tiempo === '' ? null : +x.tiempo }; }) });
        if (!nueva) { rec.id = sec.id; rec.centroId = sec.centroId; } else rec.centroId = cg.centroId;
        var g = await EDU.repo.guardar('secuencias', rec);
        EDU.ui.toast('Secuencia guardada.', 'ok'); EDU.router.ir('secuencias/' + g.id);
      } catch (e) { box.classList.remove('hidden'); box.textContent = e.message || 'No se pudo guardar.'; box.focus(); btn.disabled = false; }
    });
  }
})();
