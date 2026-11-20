/* Vista "aula" (Aula virtual tipo Moodle, mobile-first): cursos por carga, temas y recursos, anuncios, tareas con entrega y
   calificacion (nota -> libro de notas con auditoria), cuestionarios (aula-quiz.js), foros, calendario y progreso.
   Rutas: #/aula (cursos | ?vista=calendario) y #/aula/:cargaId?tab=contenido|anuncios|tareas|cuestionarios|foros|progreso. Modelo: docs/API.md "Aula virtual". */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var A = EDU.aula, esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui;
  var TABS = [['contenido', 'Contenido'], ['anuncios', 'Anuncios'], ['tareas', 'Tareas'], ['cuestionarios', 'Cuestionarios'], ['foros', 'Foros'], ['progreso', 'Progreso']];

  function msgPagina(c, titulo, texto, volver) {
    c.innerHTML = ui.cabecera({ eyebrow: 'Aula virtual', titulo: titulo }).s + '<div class="card aula"><p>' + esc(texto) + '</p><a class="btn" href="#/aula">' + esc(volver || 'Volver al aula virtual') + '</a></div>';
  }
  function delegar(panel, H) {
    panel.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b || !H[b.dataset.act]) return;
      if (b.dataset.busy) return; b.dataset.busy = '1';
      try { await H[b.dataset.act](b, e); } catch (err) { ui.toast((err && err.message) || 'No se pudo completar la acción', 'error'); }
      delete b.dataset.busy;
    });
  }
  function volverA(ctx, q, texto) { return '<p><a class="aula-volver" href="' + ctx.link(q) + '">&larr; ' + esc(texto) + '</a></p>'; }
  function limpio(n) { return fmt.num(n, 2).replace(/\.?0+$/, ''); }

  /* =========================== LISTA DE CURSOS Y CALENDARIO =========================== */
  function selectorHijo(d, params, vista) {
    if (d.rol !== 'tutor' || d.estIds.length < 2) return '';
    var estId = A.estActual(d, params);
    return '<div class="aula-toolbar"><label class="fld sel-hijo"><span>Estudiante</span><select id="aula-est">' + ui.opciones(d.estIds.map(function (id) { var e = d.m.est[id]; return { valor: id, texto: e ? fmt.nombreCompleto(e) : id }; }), estId).s + '</select></label></div>';
  }
  function navLista(vista, estId) {
    return '<nav class="aula-tabs" aria-label="Aula virtual">' + [['cursos', 'Mis cursos'], ['calendario', 'Calendario']].map(function (t) {
      return '<a class="aula-tab" href="' + A.href(null, { vista: t[0] === 'cursos' ? '' : t[0], est: estId }) + '"' + (vista === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav>';
  }

  function itemsCalendario(d, estId) {
    var items = [], cargas = A.cargasVisibles(d);
    cargas.forEach(function (cg) {
      var nom = A.nombres(d, cg), doc = A.esDocenteDe(d, cg);
      A.tareasDe(d, cg.id, doc || d.rol !== 'estudiante' && d.rol !== 'tutor').forEach(function (t) {
        if (estId) { var e = A.estadoTarea(d, t, estId); if (e.k === 'entregada' || e.k === 'calificada') return; items.push({ tipo: 'Tarea', it: t, cg: cg, nom: nom, tono: e.tono, txt: e.txt, href: A.href(cg.id, { tab: 'tareas', tarea: t.id, est: d.rol === 'tutor' ? estId : '' }) }); }
        else {
          var ents = d.entregas.filter(function (x) { return x.tareaId === t.id; }), porCal = ents.filter(function (x) { return x.estado !== 'calificada'; }).length;
          items.push({ tipo: 'Tarea', it: t, cg: cg, nom: nom, porCal: doc ? porCal : 0, tono: porCal && doc ? 'warn' : 'neu', txt: doc ? (porCal ? porCal + ' por calificar' : ents.length + ' entrega(s)') : '', href: A.href(cg.id, { tab: 'tareas', tarea: t.id }) });
        }
      });
      A.quizzesDe(d, cg.id, doc || d.rol !== 'estudiante' && d.rol !== 'tutor').forEach(function (q) {
        if (estId) { var e = A.estadoQuiz(d, q, estId); if (e.k === 'completado' || e.k === 'vencido') return; items.push({ tipo: 'Cuestionario', it: q, cg: cg, nom: nom, tono: e.tono, txt: e.txt, href: A.href(cg.id, { tab: 'cuestionarios', quiz: q.id, est: d.rol === 'tutor' ? estId : '' }) }); }
        else items.push({ tipo: 'Cuestionario', it: q, cg: cg, nom: nom, tono: 'neu', txt: '', href: A.href(cg.id, { tab: 'cuestionarios', quiz: q.id }) });
      });
    });
    return items;
  }

  async function vistaLista(c, params) {
    var d = await A.cargar(), vista = params.vista === 'calendario' ? 'calendario' : 'cursos', estId = A.estActual(d, params), cargas = A.cargasVisibles(d);
    var desc = d.rol === 'docente' ? 'Tus cursos virtuales: uno por cada asignatura y sección que impartes.' : d.rol === 'estudiante' ? 'Tus cursos, tareas y cuestionarios.' : d.rol === 'tutor' ? 'Sigue las tareas y el progreso de tu hijo/a.' : 'Cursos virtuales del centro (solo lectura).';
    var h = ui.cabecera({ eyebrow: 'Aprendizaje', titulo: 'Aula virtual', descripcion: desc }).s + '<div class="aula">' + selectorHijo(d, params, vista) + navLista(vista, d.rol === 'tutor' ? estId : '');
    if (vista === 'calendario') h += calendarioHtml(d, estId);
    else if (!cargas.length) h += ui.vacio({ titulo: d.rol === 'docente' ? 'No tienes cargas docentes' : 'Aún no hay cursos virtuales', texto: d.rol === 'docente' ? 'Cuando tengas asignaturas asignadas podrás crear su curso virtual aquí.' : 'Tu docente todavía no ha activado cursos virtuales.' }).s;
    else h += '<ul class="aula-cursos">' + cargas.map(function (cg) {
      var nom = A.nombres(d, cg), cv = A.cursoVirtual(d, cg.id), doc = A.esDocenteDe(d, cg), chips = '';
      if (cv) {
        if (estId) { var ts = A.tareasDe(d, cg.id), qs = A.quizzesDe(d, cg.id), pend = ts.filter(function (t) { var k = A.estadoTarea(d, t, estId).k; return k === 'pendiente' || k === 'vencida'; }).length + qs.filter(function (q) { var k = A.estadoQuiz(d, q, estId).k; return k === 'pendiente' || k === 'en_curso'; }).length;
          chips = '<span class="chip ' + (pend ? 'amb' : '') + '">' + (pend ? pend + ' pendiente' + (pend === 1 ? '' : 's') : 'Al día') + '</span>'; }
        else if (doc) { var por = d.entregas.filter(function (e) { return e.cargaId === cg.id && e.estado !== 'calificada'; }).length; chips = '<span class="chip ' + (por ? 'amb' : '') + '">' + (por ? por + ' por calificar' : 'Sin pendientes') + '</span>'; }
        chips += '<span class="chip">' + A.estudiantesDe(d, cg).length + ' estudiantes</span>';
      }
      var cuerpo = '<span class="aula-curso-franja" style="background:' + esc(nom.color) + '"></span><span class="aula-curso-t"><strong>' + esc(nom.asig) + '</strong><small>' + esc(nom.seccion) + ' · ' + esc(nom.docente) + '</small></span><span class="chips">' + chips + '</span>';
      if (cv) return '<li><a class="card aula-curso" href="' + A.href(cg.id, { est: d.rol === 'tutor' ? estId : '' }) + '">' + cuerpo + '</a></li>';
      return '<li><div class="card aula-curso aula-curso-vacio">' + cuerpo + '<span class="note" style="margin:0">Aún no es un curso virtual.</span><button type="button" class="btn amb" data-act="crear" data-id="' + esc(cg.id) + '">Crear curso virtual</button></div></li>';
    }).join('') + '</ul>';
    c.innerHTML = h + '</div>';
    var sel = c.querySelector('#aula-est'); if (sel) sel.addEventListener('change', function () { EDU.router.ir('aula', { vista: vista === 'calendario' ? 'calendario' : '', est: sel.value }); });
    delegar(c, { crear: async function (b) {
      var cg = d.m.carga[b.dataset.id]; if (!A.esDocenteDe(d, cg)) throw new Error('Solo el docente de la carga puede crear su curso virtual.');
      var nom = A.nombres(d, cg);
      await EDU.repo.guardar('aulaContenidos', { id: 'aul_curso_' + cg.id, tipo: 'curso', centroId: cg.centroId, cargaId: cg.id, titulo: nom.asig, descripcion: '', activo: true, creadoPor: d.ses.usuarioId });
      ui.toast('Curso virtual creado', 'ok'); EDU.router.ir('aula/' + cg.id);
    } });
  }

  function calendarioHtml(d, estId) {
    var items = itemsCalendario(d, estId), grupos = [['Vencidas', function (n) { return n != null && n < 0; }], ['Hoy', function (n) { return n === 0; }], ['Esta semana', function (n) { return n != null && n >= 1 && n <= 7; }], ['Más adelante', function (n) { return n != null && n > 7; }], ['Sin fecha límite', function (n) { return n == null; }]];
    var porCal = (!estId && d.rol === 'docente') ? items.filter(function (x) { return x.porCal; }) : [];
    var titulo = estId ? 'Entregas pendientes' : 'Fechas de entrega';
    var h = '<h2 class="aula-h2">' + titulo + '</h2>';
    if (!items.length) return h + ui.vacio({ titulo: estId ? '¡Todo al día!' : 'Sin actividades', texto: estId ? 'No tienes tareas ni cuestionarios pendientes.' : 'Aún no hay tareas ni cuestionarios con fecha.' }).s;
    if (porCal.length) h += '<section aria-labelledby="cal-pc"><h3 id="cal-pc" class="aula-h3">Por calificar</h3>' + filas(porCal) + '</section>';
    grupos.forEach(function (g, gi) {
      var l = items.filter(function (x) { return g[1](A.diasHasta(x.it)); }).sort(function (a, b) { return (A.limite(a.it) || 0) - (A.limite(b.it) || 0); });
      if (l.length) h += '<section aria-labelledby="cal-' + gi + '"><h3 id="cal-' + gi + '" class="aula-h3">' + g[0] + ' <span class="chip">' + l.length + '</span></h3>' + filas(l) + '</section>';
    });
    function filas(l) {
      return '<ul class="aula-lista">' + l.map(function (x) {
        var n = A.diasHasta(x.it), cuando = n == null ? '' : n < 0 ? 'Venció hace ' + (-n) + ' día' + (n === -1 ? '' : 's') : n === 0 ? 'Vence hoy' : n === 1 ? 'Vence mañana' : 'Vence en ' + n + ' días';
        return '<li class="aula-fila"><a class="aula-fila-a" href="' + x.href + '"><span class="aula-ic">' + ui.icono(x.tipo === 'Tarea' ? 'tarea' : 'asistencia', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(x.it.titulo) + '</strong><small>' + esc(x.tipo + ' · ' + x.nom.asig + ' · ' + x.nom.seccion) + '</small><small>' + esc(A.fechaLimiteTxt(x.it)) + (cuando ? ' · ' + esc(cuando) : '') + '</small></span>' + (x.txt ? ui.badge(x.txt, x.tono).s : '') + '</a></li>'; }).join('') + '</ul>';
    }
    return h;
  }

  /* =========================== PAGINA DE CURSO =========================== */
  async function vistaCurso(c, params) {
    var d = await A.cargar(), cg = d.m.carga[params.cargaId];
    if (!cg || A.cargasVisibles(d).indexOf(cg) === -1) { msgPagina(c, 'Curso no disponible', 'No existe este curso virtual o no tienes acceso a él.'); return; }
    var esDoc = A.esDocenteDe(d, cg), curso = A.cursoVirtual(d, cg.id), nom = A.nombres(d, cg);
    if (!curso) {
      c.innerHTML = ui.cabecera({ eyebrow: nom.seccion, titulo: nom.asig }).s + '<div class="card aula"><p>Este curso aún no es un curso virtual.</p><button class="btn amb" type="button" id="aula-crear">Crear curso virtual</button> <a class="btn sec" href="#/aula">Volver</a></div>';
      c.querySelector('#aula-crear').addEventListener('click', async function () { await EDU.repo.guardar('aulaContenidos', { id: 'aul_curso_' + cg.id, tipo: 'curso', centroId: cg.centroId, cargaId: cg.id, titulo: nom.asig, descripcion: '', activo: true, creadoPor: d.ses.usuarioId }); EDU.router.recargar(); });
      return;
    }
    var estId = A.estActual(d, params, cg), tab = TABS.some(function (t) { return t[0] === params.tab; }) ? params.tab : 'contenido';
    var ctx = { d: d, cg: cg, curso: curso, esDoc: esDoc, estId: estId, params: params, nom: nom, tab: tab, limpiar: [],
      link: function (q) { q = Object.assign({}, q); if (d.rol === 'tutor' && estId) q.est = estId; return A.href(cg.id, q); },
      recargar: async function () { var y = window.scrollY; await EDU.router.recargar(); window.scrollTo(0, y); } };
    var total = 0, vinc = 0;
    if (A.seqDe(d, cg.id).length) {
      var cont = d.aulaContenidos.filter(function (x) { return x.cargaId === cg.id && x.tipo !== 'curso' && (x.visible !== false || esDoc); }).concat(A.tareasDe(d, cg.id, esDoc), A.quizzesDe(d, cg.id, esDoc));
      cont = cont.filter(function (x) { return x.tipo !== 'tema'; }); total = cont.length; vinc = cont.filter(function (x) { return x.secuenciaId && d.m.sec[x.secuenciaId]; }).length;
    }
    var hijoSel = '';
    if (d.rol === 'tutor') { var hs = d.estIds.filter(function (id) { return A.estudiantesDe(d, cg).some(function (e) { return e.id === id; }); }); if (hs.length > 1) hijoSel = '<label class="fld sel-hijo"><span>Estudiante</span><select id="aula-est">' + ui.opciones(hs.map(function (id) { return { valor: id, texto: fmt.nombreCompleto(d.m.est[id]) }; }), estId).s + '</select></label>'; }
    var h = '<p><a class="aula-volver" href="' + A.href(null, { est: d.rol === 'tutor' ? estId : '' }) + '">&larr; Mis cursos</a></p>' +
      ui.cabecera({ eyebrow: nom.seccion, titulo: nom.asig, descripcion: 'Docente: ' + nom.docente }).s + '<div class="aula">' +
      (curso.descripcion ? '<div class="card aula-desc">' + A.texto(curso.descripcion) + '</div>' : '') + hijoSel +
      (total ? '<p class="aula-cobertura"><span class="chip amb">Secuencia didáctica</span> ' + vinc + ' de ' + total + ' contenidos vinculados a una secuencia' + (vinc < total && esDoc ? ' (vincúlalos al crearlos o editarlos)' : '') + '.</p>' : '') +
      (estId && d.rol === 'estudiante' ? resumenProgreso(d, cg, estId) : '') +
      '<nav class="aula-tabs" role="tablist" aria-label="Secciones del curso">' + TABS.map(function (t) {
        return '<a class="aula-tab" role="tab" id="tab-' + t[0] + '" href="' + ctx.link({ tab: t[0] }) + '" aria-selected="' + (t[0] === tab) + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + (t[0] === 'progreso' && d.rol === 'estudiante' ? 'Mi progreso' : t[1]) + '</a>'; }).join('') + '</nav>' +
      '<div id="aula-panel" role="tabpanel" aria-labelledby="tab-' + tab + '" tabindex="-1"></div></div>';
    c.innerHTML = h;
    var sel = c.querySelector('#aula-est'); if (sel) sel.addEventListener('change', function () { EDU.router.ir('aula/' + cg.id, { tab: tab, est: sel.value }); });
    var panel = c.querySelector('#aula-panel'), p = params;
    var fn = { contenido: tabContenido, anuncios: tabAnuncios, tareas: tabTareas, cuestionarios: tabCuestionarios, foros: tabForos, progreso: tabProgreso }[tab];
    await fn(ctx, panel);
    return function () { ctx.limpiar.forEach(function (f) { try { f(); } catch (e) { /* nada */ } }); };
  }

  function resumenProgreso(d, cg, estId) {
    var p = A.progreso(d, cg, estId);
    return '<div class="card aula-resumen"><div class="aula-resumen-t"><strong>Tu progreso</strong><span>' + (p.pct == null ? 'Sin actividades' : fmt.num(p.pct) + ' %') + '</span></div>' +
      '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(p.pct || 0) + '" aria-label="Progreso del curso"><i style="width:' + Math.round(p.pct || 0) + '%"></i></div>' +
      '<p class="note" style="margin:8px 0 0">Tareas entregadas: ' + p.entregadas + ' de ' + p.tareas + ' · Cuestionarios completados: ' + p.completados + ' de ' + p.quizzes + '</p></div>';
  }

  /* =========================== CONTENIDO (temas y recursos) =========================== */
  function iconoRecurso(r) { return ui.icono(r.tipo === 'enlace' ? 'enlace' : r.tipo === 'archivo' ? 'archivo' : 'curriculo', 22).s; }
  async function tabContenido(ctx, panel) {
    var d = ctx.d, cg = ctx.cg, esDoc = ctx.esDoc;
    var temas = A.ordenar(d.aulaContenidos.filter(function (t) { return t.tipo === 'tema' && t.cargaId === cg.id; }), 'orden');
    var recs = A.ordenar(d.aulaContenidos.filter(function (r) { return ['texto', 'enlace', 'archivo'].indexOf(r.tipo) !== -1 && r.cargaId === cg.id && (r.visible !== false || esDoc); }), 'orden');
    var ts = A.tareasDe(d, cg.id, esDoc), qs = A.quizzesDe(d, cg.id, esDoc);
    var general = { id: null, titulo: 'General', descripcion: '' }, secciones = temas.slice();
    if (recs.concat(ts, qs).some(function (x) { return !x.temaId || !d.aulaContenidos.some(function (t) { return t.id === x.temaId; }); })) secciones.unshift(general);
    var h = '';
    if (esDoc) h += '<div class="aula-acc"><button type="button" class="btn amb" data-act="tema-nuevo" id="aula-tema-nuevo">Nuevo tema</button><button type="button" class="btn sec" data-act="curso-edit">Editar descripción del curso</button></div>';
    h += secciones.length ? secciones.map(function (t, i) {
      var propio = function (x) { return t.id ? x.temaId === t.id : (!x.temaId || !d.aulaContenidos.some(function (y) { return y.id === x.temaId; })); };
      var its = recs.filter(propio), tt = ts.filter(propio), qq = qs.filter(propio);
      var acc = '';
      if (esDoc && t.id) {
        var idx = temas.indexOf(t);
        acc = '<div class="aula-acc aula-acc-tema"><button type="button" class="btn sec sm" data-act="rec-nuevo" data-tema="' + esc(t.id) + '">Agregar recurso</button><a class="btn sec sm" href="' + ctx.link({ tab: 'tareas', nueva: t.id }) + '">Agregar tarea</a>' +
          '<button type="button" class="btn sec sm" data-act="tema-edit" data-id="' + esc(t.id) + '">Editar tema</button>' +
          '<button type="button" class="btn sec sm" data-act="tema-mover" data-id="' + esc(t.id) + '" data-dir="-1" aria-label="Subir tema ' + esc(t.titulo) + '"' + (idx <= 0 ? ' disabled' : '') + '>&uarr;</button>' +
          '<button type="button" class="btn sec sm" data-act="tema-mover" data-id="' + esc(t.id) + '" data-dir="1" aria-label="Bajar tema ' + esc(t.titulo) + '"' + (idx >= temas.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
          '<button type="button" class="btn dng sm" data-act="tema-del" data-id="' + esc(t.id) + '">Eliminar tema</button></div>';
      }
      var lis = its.map(function (r) {
        var cuerpo = r.tipo === 'texto' ? A.texto(r.texto) : r.tipo === 'enlace' ? '<p style="margin:4px 0">' + A.htmlEnlace(r.url, r.url) + '</p>' + (r.texto ? A.texto(r.texto) : '') : (r.texto ? A.texto(r.texto) : '') + '<p style="margin:4px 0">' + (A.htmlArchivo(r.archivo) || '<span class="note">Archivo no disponible</span>') + '</p>';
        return '<li class="aula-recurso"><div class="aula-r-h"><span class="aula-ic">' + iconoRecurso(r) + '</span><strong>' + esc(r.titulo) + '</strong>' + (r.visible === false ? ui.badge('Oculto', 'neu').s : '') + '</div>' + cuerpo + A.seqChip(d, r) +
          (esDoc ? '<div class="aula-acc"><button type="button" class="btn sec sm" data-act="rec-edit" data-id="' + esc(r.id) + '">Editar</button><button type="button" class="btn sec sm" data-act="rec-vis" data-id="' + esc(r.id) + '">' + (r.visible === false ? 'Mostrar' : 'Ocultar') + '</button><button type="button" class="btn dng sm" data-act="rec-del" data-id="' + esc(r.id) + '">Eliminar</button></div>' : '') + '</li>'; }).join('');
      var lisAct = tt.map(function (x) { var e = ctx.estId ? A.estadoTarea(d, x, ctx.estId) : null; return '<li class="aula-recurso aula-act"><a class="aula-fila-a" href="' + ctx.link({ tab: 'tareas', tarea: x.id }) + '"><span class="aula-ic">' + ui.icono('tarea', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(x.titulo) + '</strong><small>Tarea · ' + esc(A.fechaLimiteTxt(x)) + '</small>' + A.seqChip(d, x) + '</span>' + (e ? ui.badge(e.txt, e.tono).s : (x.publicada === false ? ui.badge('Oculta', 'neu').s : '')) + '</a></li>'; }).join('') +
        qq.map(function (x) { var e = ctx.estId ? A.estadoQuiz(d, x, ctx.estId) : null; return '<li class="aula-recurso aula-act"><a class="aula-fila-a" href="' + ctx.link({ tab: 'cuestionarios', quiz: x.id }) + '"><span class="aula-ic">' + ui.icono('asistencia', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(x.titulo) + '</strong><small>Cuestionario · ' + esc(A.fechaLimiteTxt(x)) + '</small>' + A.seqChip(d, x) + '</span>' + (e ? ui.badge(e.txt, e.tono).s : (x.publicado === false ? ui.badge('Oculto', 'neu').s : '')) + '</a></li>'; }).join('');
      return '<section class="card aula-tema" aria-labelledby="tema-' + i + '"><h3 id="tema-' + i + '">' + esc(t.titulo) + '</h3>' + (t.descripcion ? A.texto(t.descripcion) : '') + A.seqChip(d, t) +
        ((lis + lisAct) ? '<ul class="aula-items">' + lis + lisAct + '</ul>' : '<p class="note">Aún no hay contenido en este tema.</p>') + acc + '</section>'; }).join('')
      : ui.vacio({ titulo: 'Este curso aún no tiene contenido', texto: esDoc ? 'Empieza creando un tema (por ejemplo «Semana 1»).' : 'Tu docente publicará aquí temas, recursos y actividades.' }).s;
    panel.innerHTML = h;
    var T = d.aulaContenidos;
    function tema(id) { return T.filter(function (x) { return x.id === id; })[0]; }
    delegar(panel, {
      'curso-edit': async function () {
        var r = await A.formModal({ titulo: 'Descripción del curso', html: A.campo({ n: 'descripcion', label: 'Descripción o bienvenida', tipo: 'textarea', rows: 5, v: ctx.curso.descripcion, max: 1500 }),
          alEnviar: async function (f) { await EDU.repo.guardar('aulaContenidos', Object.assign({}, ctx.curso, { descripcion: A.val(f, 'descripcion') })); } });
        if (r) ctx.recargar();
      },
      'tema-nuevo': function () { return formTema(null); }, 'tema-edit': function (b) { return formTema(tema(b.dataset.id)); },
      'tema-del': async function (b) {
        var t = tema(b.dataset.id), n = T.filter(function (x) { return x.temaId === t.id; }).length + ts.concat(qs).filter(function (x) { return x.temaId === t.id; }).length;
        if (!(await ui.confirmar({ titulo: 'Eliminar tema', mensaje: '«' + t.titulo + '»' + (n ? ' tiene ' + n + ' elemento(s): los recursos se eliminan y las tareas/cuestionarios pasan a «General».' : ' se eliminará.'), textoOk: 'Eliminar', peligro: true }))) return;
        for (var i = 0; i < T.length; i++) if (T[i].temaId === t.id) await EDU.repo.borrar('aulaContenidos', T[i].id);
        for (var j = 0; j < ts.length; j++) if (ts[j].temaId === t.id) await EDU.repo.guardar('tareas', Object.assign({}, ts[j], { temaId: null }));
        for (var k = 0; k < qs.length; k++) if (qs[k].temaId === t.id) await EDU.repo.guardar('cuestionarios', Object.assign({}, qs[k], { temaId: null }));
        await EDU.repo.borrar('aulaContenidos', t.id); ui.toast('Tema eliminado', 'ok'); ctx.recargar();
      },
      'tema-mover': async function (b) {
        var i = temas.indexOf(tema(b.dataset.id)), j = i + (+b.dataset.dir); if (j < 0 || j >= temas.length) return;
        var a = temas[i], o = temas[j], oa = a.orden == null ? i : a.orden, oo = o.orden == null ? j : o.orden; if (oa === oo) { oa = i; oo = j; }
        await EDU.repo.guardar('aulaContenidos', Object.assign({}, a, { orden: oo })); await EDU.repo.guardar('aulaContenidos', Object.assign({}, o, { orden: oa })); ctx.recargar();
      },
      'rec-nuevo': function (b) { return formRecurso(null, b.dataset.tema); }, 'rec-edit': function (b) { return formRecurso(tema(b.dataset.id)); },
      'rec-vis': async function (b) { var r = tema(b.dataset.id); await EDU.repo.guardar('aulaContenidos', Object.assign({}, r, { visible: r.visible === false })); ctx.recargar(); },
      'rec-del': async function (b) { var r = tema(b.dataset.id); if (!(await ui.confirmar({ titulo: 'Eliminar recurso', mensaje: '«' + r.titulo + '» se eliminará.', textoOk: 'Eliminar', peligro: true }))) return; await EDU.repo.borrar('aulaContenidos', r.id); ui.toast('Recurso eliminado', 'ok'); ctx.recargar(); }
    });
    async function formTema(t) {
      var r = await A.formModal({ titulo: t ? 'Editar tema' : 'Nuevo tema', html: A.campo({ n: 'titulo', label: 'Título (tema o semana)', req: true, v: t && t.titulo, max: 120, full: true, ph: 'Semana 1: Los números' }) + A.campo({ n: 'descripcion', label: 'Descripción (opcional)', tipo: 'textarea', rows: 3, v: t && t.descripcion, max: 800 }) + A.seqCampos(d, cg.id, t),
        alMontar: function (f) { A.seqMontar(d, f); },
        alEnviar: async function (f) {
          var titulo = A.val(f, 'titulo'); if (!titulo) throw A.error('titulo', 'El título es obligatorio.');
          var orden = t ? t.orden : temas.reduce(function (m, x) { return Math.max(m, x.orden == null ? 0 : x.orden); }, 0) + 1;
          await EDU.repo.guardar('aulaContenidos', Object.assign({}, t || {}, A.seqValores(f), { tipo: 'tema', centroId: cg.centroId, cargaId: cg.id, titulo: titulo, descripcion: A.val(f, 'descripcion'), orden: orden }));
        } });
      if (r) { ui.toast('Tema guardado', 'ok'); ctx.recargar(); }
    }
    async function formRecurso(rec, temaId) {
      var ti = rec ? rec.tipo : 'texto';
      var r = await A.formModal({ titulo: rec ? 'Editar recurso' : 'Nuevo recurso', tamano: 'lg',
        html: A.campo({ n: 'tipo', label: 'Tipo de recurso', tipo: 'select', vacio: false, opciones: [{ valor: 'texto', texto: 'Texto' }, { valor: 'enlace', texto: 'Enlace (http/https)' }, { valor: 'archivo', texto: 'Archivo pequeño (≤ 500 KB)' }], v: ti, dis: !!rec }) +
          A.campo({ n: 'titulo', label: 'Título', req: true, v: rec && rec.titulo, max: 120 }) +
          '<div class="fld full" data-t="enlace">' + A.campo({ n: 'url', label: 'Dirección del enlace', tipo: 'url', v: rec && rec.url, ph: 'https://…', max: 500 }) + '</div>' +
          '<div class="fld full" data-t="archivo">' + A.campo({ n: 'archivo', label: 'Archivo', tipo: 'file', ayuda: (rec && rec.archivo ? 'Actual: ' + rec.archivo.nombre + '. Elige otro solo para reemplazarlo. ' : '') + A.avisoCuota() }) + '</div>' +
          A.campo({ n: 'texto', label: 'Contenido o descripción', tipo: 'textarea', rows: 5, v: rec && rec.texto, max: 5000 }) + A.campo({ n: 'visible', label: 'Visible para los estudiantes', tipo: 'check', v: !rec || rec.visible !== false }) + A.seqCampos(d, cg.id, rec),
        alMontar: function (f) {
          A.seqMontar(d, f);
          function ver() { Array.prototype.forEach.call(f.querySelectorAll('[data-t]'), function (x) { x.classList.toggle('hidden', x.dataset.t !== f.elements.tipo.value); }); }
          f.elements.tipo.addEventListener('change', ver); ver();
        },
        alEnviar: async function (f) {
          var tipo = A.val(f, 'tipo'), titulo = A.val(f, 'titulo'), base = { tipo: tipo, titulo: titulo, texto: A.val(f, 'texto'), visible: A.val(f, 'visible') };
          if (!titulo) throw A.error('titulo', 'El título es obligatorio.');
          if (tipo === 'texto' && !base.texto) throw A.error('texto', 'Escribe el contenido del recurso.');
          if (tipo === 'enlace') { var u = A.urlSegura(A.val(f, 'url')); if (!u) throw A.error('url', 'Escribe un enlace válido que empiece por http:// o https://.'); base.url = u; }
          if (tipo === 'archivo') { var arc = await A.leerArchivo(f.elements.archivo.files[0]); if (!arc && !(rec && rec.archivo)) throw A.error('archivo', 'Elige un archivo (máx. 500 KB).'); base.archivo = arc || rec.archivo; }
          var orden = rec ? rec.orden : recs.reduce(function (m, x) { return Math.max(m, x.orden == null ? 0 : x.orden); }, 0) + 1;
          await EDU.repo.guardar('aulaContenidos', Object.assign({}, rec || {}, A.seqValores(f), base, { centroId: cg.centroId, cargaId: cg.id, temaId: rec ? rec.temaId : temaId, orden: orden })); A.postGuardar();
        } });
      if (r) { ui.toast('Recurso guardado', 'ok'); ctx.recargar(); }
    }
  }

  /* =========================== ANUNCIOS =========================== */
  async function tabAnuncios(ctx, panel) {
    var d = ctx.d, cg = ctx.cg, an = d.anuncios.filter(function (a) { return a.cargaId === cg.id; }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    panel.innerHTML = (ctx.esDoc ? '<div class="aula-acc"><button type="button" class="btn amb" data-act="nuevo" id="aula-anuncio-nuevo">Nuevo anuncio</button></div>' : '') +
      (an.length ? an.map(function (a) {
        return '<article class="card aula-anuncio"><h3>' + esc(a.titulo) + '</h3><p class="note" style="margin:2px 0 8px">' + esc(fmt.fechaHora(a.fecha)) + ' · ' + esc(a.autorNombre || '') + '</p>' + A.texto(a.texto) +
          (ctx.esDoc ? '<div class="aula-acc"><button type="button" class="btn sec sm" data-act="editar" data-id="' + esc(a.id) + '">Editar</button><button type="button" class="btn dng sm" data-act="borrar" data-id="' + esc(a.id) + '">Eliminar</button></div>' : '') + '</article>'; }).join('')
        : ui.vacio({ titulo: 'Sin anuncios', texto: ctx.esDoc ? 'Publica el primer anuncio para tu grupo.' : 'Tu docente no ha publicado anuncios.' }).s);
    async function form(a) {
      var r = await A.formModal({ titulo: a ? 'Editar anuncio' : 'Nuevo anuncio', html: A.campo({ n: 'titulo', label: 'Título', req: true, v: a && a.titulo, max: 120, full: true }) + A.campo({ n: 'texto', label: 'Mensaje', tipo: 'textarea', rows: 5, req: true, v: a && a.texto, max: 3000 }),
        alEnviar: async function (f) {
          var t = A.val(f, 'titulo'), x = A.val(f, 'texto'); if (!t) throw A.error('titulo', 'El título es obligatorio.'); if (!x) throw A.error('texto', 'Escribe el mensaje.');
          await EDU.repo.guardar('anuncios', Object.assign({}, a || { fecha: A.ahora(), autorId: d.ses.usuarioId, autorNombre: d.ses.nombre }, { centroId: cg.centroId, cargaId: cg.id, titulo: t, texto: x }));
        } });
      if (r) { ui.toast('Anuncio publicado', 'ok'); ctx.recargar(); }
    }
    delegar(panel, { nuevo: function () { return form(null); }, editar: function (b) { return form(an.filter(function (x) { return x.id === b.dataset.id; })[0]); },
      borrar: async function (b) { if (!(await ui.confirmar({ titulo: 'Eliminar anuncio', mensaje: 'Se eliminará el anuncio.', textoOk: 'Eliminar', peligro: true }))) return; await EDU.repo.borrar('anuncios', b.dataset.id); ctx.recargar(); } });
  }

  /* =========================== TAREAS =========================== */
  function entregaHtml(e) {
    if (!e) return '';
    return (e.texto ? A.texto(e.texto) : '') + (e.enlace ? '<p style="margin:6px 0">' + A.htmlEnlace(e.enlace, e.enlace) + '</p>' : '') + (e.archivo ? '<p style="margin:6px 0">' + A.htmlArchivo(e.archivo) + '</p>' : '');
  }
  async function tabTareas(ctx, panel) {
    var d = ctx.d, cg = ctx.cg, id = ctx.params.tarea;
    if (ctx.esDoc && ctx.params.nueva != null && !id) { await formTarea(ctx, null, ctx.params.nueva || null, true); }
    if (id) return tareaDetalle(ctx, panel, id);
    var ts = A.ordenar(A.tareasDe(d, cg.id, ctx.esDoc), 'fechaLimite');
    panel.innerHTML = (ctx.esDoc ? '<div class="aula-acc"><button type="button" class="btn amb" data-act="nueva" id="aula-tarea-nueva">Nueva tarea</button></div>' : '') +
      (ts.length ? '<ul class="aula-lista">' + ts.map(function (t) {
        var badge = '';
        if (ctx.estId) { var e = A.estadoTarea(d, t, ctx.estId); badge = ui.badge(e.txt, e.tono).s; }
        else if (ctx.esDoc) { var ents = d.entregas.filter(function (x) { return x.tareaId === t.id; }), pc = ents.filter(function (x) { return x.estado !== 'calificada'; }).length; badge = (t.publicada === false ? ui.badge('Oculta', 'neu').s + ' ' : '') + ui.badge(ents.length + ' entrega(s)' + (pc ? ' · ' + pc + ' por calificar' : ''), pc ? 'warn' : 'neu').s; }
        return '<li class="aula-fila"><a class="aula-fila-a" href="' + ctx.link({ tab: 'tareas', tarea: t.id }) + '"><span class="aula-ic">' + ui.icono('tarea', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(t.titulo) + '</strong><small>' + esc(A.fechaLimiteTxt(t)) + ' · ' + limpio(t.puntosMax) + ' pt</small>' + A.seqChip(d, t) + '</span>' + badge + '</a></li>'; }).join('') + '</ul>'
        : ui.vacio({ titulo: 'Sin tareas', texto: ctx.esDoc ? 'Crea la primera con «Nueva tarea».' : 'No tienes tareas en este curso.' }).s);
    delegar(panel, { nueva: function () { return formTarea(ctx, null, null); } });
  }

  async function formTarea(ctx, t, temaId, desdeUrl) {
  var d = ctx.d, cg = ctx.cg;
    var escala = A.escalaDe(d, cg.centroId), cats = d.categorias.filter(function (x) { return x.cargaId === cg.id; }), temas = A.ordenar(d.aulaContenidos.filter(function (x) { return x.tipo === 'tema' && x.cargaId === cg.id; }), 'orden');
    var act = t && t.actividadId ? d.m.act[t.actividadId] : null, per = (EDU.consultas.periodoAbierto(d.periodos, cg.centroId) || {}).id || '';
    var r = await A.formModal({ titulo: t ? 'Editar tarea' : 'Nueva tarea', tamano: 'lg',
      html: A.campo({ n: 'titulo', label: 'Título', req: true, v: t && t.titulo, max: 120, full: true }) + A.campo({ n: 'instrucciones', label: 'Instrucciones', tipo: 'textarea', rows: 4, v: t && t.instrucciones, max: 3000 }) +
        A.campo({ n: 'temaId', label: 'Tema', tipo: 'select', opciones: temas.map(function (x) { return { valor: x.id, texto: x.titulo }; }), v: (t ? t.temaId : temaId) || '', vacio: 'General (sin tema)' }) +
        A.campo({ n: 'fechaLimite', label: 'Fecha límite', tipo: 'date', req: true, v: t && t.fechaLimite }) + A.campo({ n: 'horaLimite', label: 'Hora límite', tipo: 'time', v: (t && t.horaLimite) || '23:59' }) +
        A.campo({ n: 'puntosMax', label: 'Puntos máximos', tipo: 'number', req: true, v: t ? t.puntosMax : escala.max, dis: !!act, ayuda: act ? 'Ya está en el libro de notas; no se puede cambiar.' : 'La nota se normaliza a la escala del centro (' + escala.min + '–' + escala.max + ').' }) +
        A.campo({ n: 'periodoId', label: 'Periodo del libro de notas', tipo: 'select', opciones: d.periodos.filter(function (p) { return p.centroId === cg.centroId; }).map(function (p) { return { valor: p.id, texto: p.nombre + (p.cerrado ? ' (cerrado)' : '') }; }), v: (act ? act.periodoId : (t && t.periodoId)) || per, dis: !!act }) +
        A.campo({ n: 'categoriaId', label: 'Categoría del libro de notas', tipo: 'select', opciones: cats.map(function (x) { return { valor: x.id, texto: x.nombre + ' (' + x.peso + ' %)' }; }), v: (act ? act.categoriaId : (t && t.categoriaId)) || '', dis: !!act, req: cats.length > 0, ayuda: cats.length ? '' : 'Crea categorías en el libro de notas para poder calificar esta tarea.' }) +
        A.campo({ n: 'permiteTarde', label: 'Aceptar entregas después de la fecha límite (se marcan como tardías)', tipo: 'check', v: !t || t.permiteTarde !== false }) + A.campo({ n: 'publicada', label: 'Visible para los estudiantes', tipo: 'check', v: !t || t.publicada !== false }) + A.seqCampos(d, cg.id, t),
      alMontar: function (f) { A.seqMontar(d, f); },
      alEnviar: async function (f) {
        var titulo = A.val(f, 'titulo'); if (!titulo) throw A.error('titulo', 'El título es obligatorio.');
        if (!A.val(f, 'fechaLimite')) throw A.error('fechaLimite', 'Indica la fecha límite.');
        var pm = act ? act.puntosMax : A.num(A.val(f, 'puntosMax')); if (pm == null || !(pm > 0) || pm > 1000) throw A.error('puntosMax', 'Los puntos máximos deben ser un número mayor que 0.');
        if (!act && cats.length && !A.val(f, 'categoriaId')) throw A.error('categoriaId', 'Elige la categoría del libro de notas.');
        var rec = Object.assign({}, t || {}, A.seqValores(f), { centroId: cg.centroId, cargaId: cg.id, titulo: titulo, instrucciones: A.val(f, 'instrucciones'), temaId: A.val(f, 'temaId') || null, fechaLimite: A.val(f, 'fechaLimite'), horaLimite: A.val(f, 'horaLimite') || '23:59',
          puntosMax: pm, periodoId: act ? act.periodoId : A.val(f, 'periodoId'), categoriaId: act ? act.categoriaId : A.val(f, 'categoriaId'), permiteTarde: A.val(f, 'permiteTarde'), publicada: A.val(f, 'publicada') });
        return await EDU.repo.guardar('tareas', rec);
      } });
    if (r && r !== true) { ui.toast('Tarea guardada', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'tareas', tarea: r.id }); }
    else if (desdeUrl) EDU.router.ir('aula/' + cg.id, { tab: 'tareas' });
  }

  async function tareaDetalle(ctx, panel, id) {
    var d = ctx.d, cg = ctx.cg, t = d.tareas.filter(function (x) { return x.id === id && x.cargaId === cg.id; })[0];
    if (!t || (t.publicada === false && !ctx.esDoc)) { panel.innerHTML = ui.vacio({ titulo: 'Tarea no disponible' }).s + volverA(ctx, { tab: 'tareas' }, 'Tareas'); return; }
    var act = t.actividadId ? d.m.act[t.actividadId] : null, h = volverA(ctx, { tab: 'tareas' }, 'Tareas');
    h += '<div class="card"><h2>' + esc(t.titulo) + '</h2><div class="chips"><span class="chip amb">' + esc(A.fechaLimiteTxt(t)) + '</span><span class="chip">' + limpio(t.puntosMax) + ' puntos</span>' + (A.vencido(t) ? '<span class="chip">Plazo vencido</span>' : '') + (act ? '<span class="chip">En el libro de notas</span>' : '') + A.seqChip(d, t) + '</div>' + (t.instrucciones ? A.texto(t.instrucciones) : '<p class="note">Sin instrucciones.</p>');
    if (ctx.esDoc) h += '<div class="aula-acc"><button type="button" class="btn sec" data-act="editar">Editar tarea</button><button type="button" class="btn dng" data-act="borrar">Eliminar tarea</button></div>';
    h += '</div>';
    var ests = [];
    if (ctx.esDoc || ['director', 'admin_red', 'secretaria'].indexOf(d.rol) !== -1) {
      ests = A.estudiantesDe(d, cg);
      h += '<div class="card" style="margin-top:14px"><h2>Entregas</h2><ul class="aula-lista">' + ests.map(function (e) {
        var s = A.estadoTarea(d, t, e.id), en = s.e;
        return '<li class="aula-fila"><div class="aula-fila-a"><span class="aula-fila-t"><strong>' + esc(fmt.nombreCompleto(e)) + '</strong><small>' + (en ? esc(fmt.fechaHora(en.fecha)) + (en.tarde ? ' · tarde' : '') + (en.estado === 'calificada' ? ' · ' + esc(A.notaTxt(d, cg, en.puntos, t.puntosMax)) : '') : 'Sin entrega') + '</small></span>' + ui.badge(s.txt, s.tono).s +
          (en ? ' <button type="button" class="btn sec sm" data-act="calificar" data-est="' + esc(e.id) + '" aria-label="' + (ctx.esDoc ? 'Calificar' : 'Ver') + ' entrega de ' + esc(fmt.nombreCompleto(e)) + '">' + (ctx.esDoc ? (en.estado === 'calificada' ? 'Revisar nota' : 'Calificar') : 'Ver') + '</button>' : '') + '</div></li>'; }).join('') + '</ul></div>';
    } else if (ctx.estId) {
      var s = A.estadoTarea(d, t, ctx.estId), en = s.e, propia = d.rol === 'estudiante', bloq = en && en.estado === 'calificada';
      h += '<div class="card aula-entrega" style="margin-top:14px"><h2>' + (propia ? 'Mi entrega' : 'Entrega') + ' ' + ui.badge(s.txt, s.tono).s + '</h2>';
      if (en) h += '<p class="note" style="margin:4px 0 8px">Entregada el ' + esc(fmt.fechaHora(en.fecha)) + (en.tarde ? ' (fuera de plazo)' : '') + '</p>' + entregaHtml(en);
      if (bloq) h += '<div class="alert ok" style="margin-top:10px"><div><strong>Nota: ' + esc(A.notaTxt(d, cg, en.puntos, t.puntosMax)) + '</strong>' + (en.retro ? '<small class="aula-texto">' + esc(en.retro) + '</small>' : '<small>Sin retroalimentación escrita.</small>') + '</div></div>';
      if (propia && !bloq) {
        var cerrada = A.vencido(t) && t.permiteTarde === false;
        if (cerrada) h += '<p class="note">El plazo terminó y esta tarea no acepta entregas tardías.</p>';
        else h += '<form class="aula-form" id="ent-form" novalidate style="margin-top:12px"><div class="form-error hidden" role="alert"></div><div class="fgrid">' + A.campo({ n: 'texto', label: 'Respuesta escrita', tipo: 'textarea', rows: 4, v: en && en.texto, max: 5000 }) + A.campo({ n: 'enlace', label: 'Enlace (opcional)', tipo: 'url', v: en && en.enlace, ph: 'https://…', max: 500 }) +
          A.campo({ n: 'archivo', label: 'Archivo (opcional)', tipo: 'file', ayuda: (en && en.archivo ? 'Actual: ' + en.archivo.nombre + '. Elige otro solo para reemplazarlo. ' : '') + A.avisoCuota() }) + '</div>' +
          (A.vencido(t) ? '<p class="note">El plazo ya pasó: tu entrega se marcará como tardía.</p>' : '') + '<div class="form-actions"><button type="submit" class="btn amb" id="ent-enviar">' + (en ? 'Actualizar entrega' : 'Entregar tarea') + '</button></div></form>';
      }
      h += '</div>';
    }
    panel.innerHTML = h;
    var form = panel.querySelector('#ent-form');
    if (form) form.addEventListener('submit', async function (e) {
      e.preventDefault(); var box = form.querySelector('.form-error'), btn = form.querySelector('#ent-enviar'); box.classList.add('hidden'); btn.disabled = true;
      try {
        var texto = A.val(form, 'texto'), enlace = A.val(form, 'enlace'), arc = await A.leerArchivo(form.elements.archivo.files[0]), prev = A.entregaDe(d, t.id, ctx.estId);
        if (enlace && !A.urlSegura(enlace)) throw A.error('enlace', 'El enlace debe empezar por http:// o https://.');
        if (!texto && !enlace && !arc && !(prev && prev.archivo)) throw new Error('Escribe una respuesta, agrega un enlace o adjunta un archivo.');
        if (prev && prev.estado === 'calificada') throw new Error('Esta tarea ya fue calificada.');
        if (A.vencido(t) && t.permiteTarde === false) throw new Error('El plazo terminó.');
        await EDU.repo.guardar('entregas', { id: 'ent_' + t.id + '_' + ctx.estId, centroId: cg.centroId, tareaId: t.id, cargaId: cg.id, estudianteId: ctx.estId, texto: texto, enlace: enlace ? A.urlSegura(enlace) : '', archivo: arc || (prev && prev.archivo) || null,
          fecha: A.ahora(), tarde: A.vencido(t), estado: 'entregada', puntos: null, retro: '' });
        A.postGuardar(); ui.toast('Entrega enviada', 'ok'); ctx.recargar();
      } catch (err) { var el = err.campo && form.elements[err.campo]; if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } box.textContent = err.message; box.classList.remove('hidden'); btn.disabled = false; }
    });
    delegar(panel, {
      editar: function () { return formTarea(ctx, t, null); },
      borrar: async function () {
        var n = d.entregas.filter(function (x) { return x.tareaId === t.id; }).length;
        if (!(await ui.confirmar({ titulo: 'Eliminar tarea', mensaje: 'Se eliminarán la tarea y sus ' + n + ' entrega(s).' + (t.actividadId ? ' La actividad y las notas ya enviadas permanecen en el libro de notas.' : ''), textoOk: 'Eliminar', peligro: true }))) return;
        for (var i = 0; i < d.entregas.length; i++) if (d.entregas[i].tareaId === t.id) await EDU.repo.borrar('entregas', d.entregas[i].id);
        await EDU.repo.borrar('tareas', t.id); ui.toast('Tarea eliminada', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'tareas' });
      },
      calificar: async function (b) {
        var est = d.m.est[b.dataset.est], en = A.entregaDe(d, t.id, est.id), sd = ctx.esDoc;
        var r = await A.formModal({ titulo: (sd ? 'Calificar · ' : 'Entrega · ') + fmt.nombreCompleto(est), tamano: 'lg', textoOk: sd ? 'Guardar calificación' : 'Cerrar',
          html: '<div class="fld full"><span class="note" style="margin:0">Entregada el ' + esc(fmt.fechaHora(en.fecha)) + (en.tarde ? ' (tarde)' : '') + '</span><div class="aula-entrega-v">' + (entregaHtml(en) || '<p class="note">Sin contenido.</p>') + '</div></div>' +
            (sd ? A.campo({ n: 'puntos', label: 'Puntos (0 a ' + limpio(t.puntosMax) + ')', tipo: 'number', req: true, v: en.puntos == null ? '' : en.puntos, ayuda: 'Se guarda sin redondear en el libro de notas, que la normaliza a la escala del centro.' }) + A.campo({ n: 'retro', label: 'Retroalimentación', tipo: 'textarea', rows: 4, v: en.retro, max: 2000 }) : (en.estado === 'calificada' ? '<div class="fld full"><strong>Nota: ' + esc(A.notaTxt(d, cg, en.puntos, t.puntosMax)) + '</strong>' + (en.retro ? A.texto(en.retro) : '') + '</div>' : '')),
          alEnviar: async function (f) {
            if (!sd) return true;
            var pts = A.num(A.val(f, 'puntos')); if (pts == null) throw A.error('puntos', 'Escribe los puntos obtenidos.');
            if (pts < 0 || pts > t.puntosMax) throw A.error('puntos', 'Los puntos deben estar entre 0 y ' + limpio(t.puntosMax) + '.');
            var retro = A.val(f, 'retro');
            await A.guardarNota(d, t, 'tareas', est.id, pts, retro);
            await EDU.repo.guardar('entregas', Object.assign({}, en, { estado: 'calificada', puntos: pts, retro: retro, calificadaEn: A.ahora(), calificadaPor: d.ses.usuarioId }));
          } });
        if (r && sd) { ui.toast('Calificación guardada en el libro de notas', 'ok'); ctx.recargar(); }
      }
    });
  }
  /* =========================== CUESTIONARIOS =========================== */
  async function tabCuestionarios(ctx, panel) {
    var p = ctx.params;
    if (ctx.esDoc && p.banco) return A.quiz.banco(ctx, panel);
    if (ctx.esDoc && p.editar) return A.quiz.editar(ctx, panel, p.editar);
    if (p.quiz && p.intento) return A.quiz.intento(ctx, panel, p.quiz, p.intento);
    if (p.quiz && p.revisar) return A.quiz.revisar(ctx, panel, p.quiz, p.revisar);
    if (p.quiz) return A.quiz.detalle(ctx, panel, p.quiz);
    return A.quiz.lista(ctx, panel);
  }

  /* =========================== FOROS =========================== */
  async function tabForos(ctx, panel) {
    var d = ctx.d, cg = ctx.cg, foros = d.foros.filter(function (f) { return f.cargaId === cg.id; }).sort(function (a, b) { return String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')); });
    var id = ctx.params.foro, f = id && foros.filter(function (x) { return x.id === id; })[0];
    var puede = A.puedeParticipar(d, cg);
    if (!f) {
      panel.innerHTML = (ctx.esDoc ? '<div class="aula-acc"><button type="button" class="btn amb" data-act="nuevo" id="aula-foro-nuevo">Nuevo foro</button></div>' : '') +
        (foros.length ? '<ul class="aula-lista">' + foros.map(function (x) {
          var n = d.foroMensajes.filter(function (m) { return m.foroId === x.id && !m.padreId; }).length;
          return '<li class="aula-fila"><a class="aula-fila-a" href="' + ctx.link({ tab: 'foros', foro: x.id }) + '"><span class="aula-ic">' + ui.icono('foro', 22).s + '</span><span class="aula-fila-t"><strong>' + esc(x.titulo) + '</strong><small>' + n + ' hilo(s)' + (x.cerrado ? ' · cerrado' : '') + '</small></span></a></li>'; }).join('') + '</ul>'
          : ui.vacio({ titulo: 'Sin foros', texto: ctx.esDoc ? 'Crea un foro para que el grupo converse.' : 'Aún no hay foros en este curso.' }).s);
      delegar(panel, { nuevo: async function () {
        var r = await A.formModal({ titulo: 'Nuevo foro', html: A.campo({ n: 'titulo', label: 'Título', req: true, max: 120, full: true }) + A.campo({ n: 'descripcion', label: 'Descripción o consigna', tipo: 'textarea', rows: 4, max: 2000 }),
          alEnviar: async function (fm) { var t = A.val(fm, 'titulo'); if (!t) throw A.error('titulo', 'El título es obligatorio.'); return await EDU.repo.guardar('foros', { centroId: cg.centroId, cargaId: cg.id, titulo: t, descripcion: A.val(fm, 'descripcion'), cerrado: false, autorId: d.ses.usuarioId }); } });
        if (r && r !== true) { ui.toast('Foro creado', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'foros', foro: r.id }); }
      } });
      return;
    }
    var msgs = d.foroMensajes.filter(function (m) { return m.foroId === f.id; }), hilos = msgs.filter(function (m) { return !m.padreId; }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
    function msg(m, tipo) {
      return '<div class="aula-msg"><p class="aula-msg-m"><strong>' + esc(m.autorNombre || 'Usuario') + '</strong> ' + (m.autorRol === 'docente' ? ui.badge('Docente', 'info').s : '') + ' <span class="note" style="margin:0">' + esc(fmt.fechaHora(m.fecha)) + '</span></p>' + A.texto(m.texto) + '</div>';
    }
    panel.innerHTML = volverA(ctx, { tab: 'foros' }, 'Foros') + '<div class="card"><h2>' + esc(f.titulo) + '</h2>' + (f.descripcion ? A.texto(f.descripcion) : '') + (f.cerrado ? '<p>' + ui.badge('Foro cerrado', 'neu').s + '</p>' : '') +
      '<div class="aula-acc">' + (puede && !f.cerrado ? '<button type="button" class="btn amb" data-act="hilo" id="aula-hilo-nuevo">Nuevo hilo</button>' : '') +
      (ctx.esDoc ? '<button type="button" class="btn sec" data-act="cerrar">' + (f.cerrado ? 'Reabrir foro' : 'Cerrar foro') + '</button><button type="button" class="btn dng" data-act="borrar-foro">Eliminar foro</button>' : '') + '</div></div>' +
      (hilos.length ? hilos.map(function (hl) {
        var resp = msgs.filter(function (m) { return m.padreId === hl.id; }).sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });
        return '<article class="card aula-hilo" style="margin-top:12px"><h3>' + esc(hl.titulo) + '</h3>' + msg(hl) + (resp.length ? '<ul class="aula-resps" aria-label="Respuestas">' + resp.map(function (r) { return '<li>' + msg(r) + (ctx.esDoc ? '<button type="button" class="btn dng sm" data-act="borrar-msg" data-id="' + esc(r.id) + '">Eliminar respuesta</button>' : '') + '</li>'; }).join('') + '</ul>' : '') +
          '<div class="aula-acc">' + (puede && !f.cerrado ? '<button type="button" class="btn sec sm" data-act="responder" data-id="' + esc(hl.id) + '" aria-label="Responder al hilo ' + esc(hl.titulo) + '">Responder (' + resp.length + ')</button>' : '<span class="note" style="margin:0">' + resp.length + ' respuesta(s)</span>') +
          (ctx.esDoc ? '<button type="button" class="btn dng sm" data-act="borrar-hilo" data-id="' + esc(hl.id) + '">Eliminar hilo</button>' : '') + '</div></article>'; }).join('')
        : '<p class="note" style="margin-top:12px">Aún no hay hilos. ' + (puede && !f.cerrado ? '¡Inicia la conversación!' : '') + '</p>');
    function nuevo(padre) {
      return A.formModal({ titulo: padre ? 'Responder' : 'Nuevo hilo', textoOk: 'Publicar', html: (padre ? '' : A.campo({ n: 'titulo', label: 'Asunto', req: true, max: 120, full: true })) + A.campo({ n: 'texto', label: 'Mensaje', tipo: 'textarea', rows: 5, req: true, max: 3000 }),
        alEnviar: async function (fm) {
          if (f.cerrado) throw new Error('El foro está cerrado.'); var t = padre ? '' : A.val(fm, 'titulo'), x = A.val(fm, 'texto');
          if (!padre && !t) throw A.error('titulo', 'El asunto es obligatorio.'); if (!x) throw A.error('texto', 'Escribe tu mensaje.');
          await EDU.repo.guardar('foroMensajes', { centroId: cg.centroId, cargaId: cg.id, foroId: f.id, padreId: padre || null, titulo: t, texto: x, autorId: d.ses.usuarioId, autorNombre: d.ses.nombre, autorRol: d.rol, fecha: A.ahora() });
        } });
    }
    delegar(panel, {
      hilo: async function () { if (await nuevo(null)) { ui.toast('Hilo publicado', 'ok'); ctx.recargar(); } },
      responder: async function (b) { if (await nuevo(b.dataset.id)) { ui.toast('Respuesta publicada', 'ok'); ctx.recargar(); } },
      cerrar: async function () { await EDU.repo.guardar('foros', Object.assign({}, f, { cerrado: !f.cerrado })); ctx.recargar(); },
      'borrar-msg': async function (b) { if (!(await ui.confirmar({ titulo: 'Eliminar respuesta', mensaje: 'Se eliminará esta respuesta.', textoOk: 'Eliminar', peligro: true }))) return; await EDU.repo.borrar('foroMensajes', b.dataset.id); ctx.recargar(); },
      'borrar-hilo': async function (b) { if (!(await ui.confirmar({ titulo: 'Eliminar hilo', mensaje: 'Se eliminará el hilo y sus respuestas.', textoOk: 'Eliminar', peligro: true }))) return; for (var i = 0; i < msgs.length; i++) if (msgs[i].id === b.dataset.id || msgs[i].padreId === b.dataset.id) await EDU.repo.borrar('foroMensajes', msgs[i].id); ctx.recargar(); },
      'borrar-foro': async function () { if (!(await ui.confirmar({ titulo: 'Eliminar foro', mensaje: 'Se eliminarán el foro y todos sus mensajes.', textoOk: 'Eliminar', peligro: true }))) return; for (var i = 0; i < msgs.length; i++) await EDU.repo.borrar('foroMensajes', msgs[i].id); await EDU.repo.borrar('foros', f.id); ui.toast('Foro eliminado', 'ok'); EDU.router.ir('aula/' + cg.id, { tab: 'foros' }); }
    });
  }

  /* =========================== PROGRESO =========================== */
  function detalleEstudiante(ctx, estId) {
    var d = ctx.d, cg = ctx.cg;
    var ts = A.ordenar(A.tareasDe(d, cg.id), 'fechaLimite'), qs = A.ordenar(A.quizzesDe(d, cg.id), 'fechaLimite');
    var f = ts.map(function (t) {
      var s = A.estadoTarea(d, t, estId), nota = s.e && s.e.estado === 'calificada' ? ' · ' + A.notaTxt(d, cg, s.e.puntos, t.puntosMax) : '';
      return '<li class="aula-fila"><a class="aula-fila-a" href="' + ctx.link({ tab: 'tareas', tarea: t.id, est: d.rol === 'tutor' ? estId : '' }) + '"><span class="aula-ic">' + ui.icono('tarea', 20).s + '</span><span class="aula-fila-t"><strong>' + esc(t.titulo) + '</strong><small>Tarea · ' + esc(A.fechaLimiteTxt(t)) + esc(nota) + '</small></span>' + ui.badge(s.txt, s.tono).s + '</a></li>'; }).join('') +
      qs.map(function (q) {
        var s = A.estadoQuiz(d, q, estId), pt = A.puntajeQuiz(q, s.its), nota = pt != null ? ' · ' + A.notaTxt(d, cg, pt, q.puntosMax) : '';
        return '<li class="aula-fila"><a class="aula-fila-a" href="' + ctx.link({ tab: 'cuestionarios', quiz: q.id, est: d.rol === 'tutor' ? estId : '' }) + '"><span class="aula-ic">' + ui.icono('asistencia', 20).s + '</span><span class="aula-fila-t"><strong>' + esc(q.titulo) + '</strong><small>Cuestionario' + esc(nota) + '</small></span>' + ui.badge(s.txt, s.tono).s + '</a></li>'; }).join('');
    return f ? '<ul class="aula-lista">' + f + '</ul>' : '<p class="note">Aún no hay tareas ni cuestionarios.</p>';
  }
  async function tabProgreso(ctx, panel) {
    var d = ctx.d, cg = ctx.cg;
    if (ctx.estId) {
      var est = d.m.est[ctx.estId], p = A.progreso(d, cg, ctx.estId);
      panel.innerHTML = (d.rol === 'tutor' ? '<h2 class="aula-h2">Progreso de ' + esc(fmt.nombreCompleto(est)) + '</h2>' + resumenProgreso(d, cg, ctx.estId).replace('Tu progreso', 'Progreso del curso') : '') + '<h3 class="aula-h3">Actividades</h3>' + detalleEstudiante(ctx, ctx.estId);
      return;
    }
    var ests = A.estudiantesDe(d, cg), filas = ests.map(function (e) { return { e: e, p: A.progreso(d, cg, e.id) }; });
    var prom = filas.filter(function (x) { return x.p.pct != null; }), media = prom.length ? prom.reduce(function (s, x) { return s + x.p.pct; }, 0) / prom.length : null;
    panel.innerHTML = '<div class="card"><div class="aula-resumen-t"><strong>Progreso del grupo</strong><span>' + (media == null ? '—' : fmt.num(media) + ' %') + '</span></div><p class="note" style="margin:6px 0 0">' + ests.length + ' estudiantes · ' + A.tareasDe(d, cg.id).length + ' tareas · ' + A.quizzesDe(d, cg.id).length + ' cuestionarios publicados.</p></div>' +
      (ests.length ? '<ul class="aula-lista aula-prog" style="margin-top:12px">' + filas.map(function (x, i) {
        var pc = Math.round(x.p.pct || 0);
        return '<li class="aula-fila aula-fila-col"><details><summary class="aula-sum"><span class="aula-fila-t"><strong>' + esc(fmt.nombreCompleto(x.e)) + '</strong><small>Tareas ' + x.p.entregadas + '/' + x.p.tareas + ' · Cuestionarios ' + x.p.completados + '/' + x.p.quizzes + '</small></span><span class="aula-pct">' + (x.p.pct == null ? '—' : pc + ' %') + '</span></summary>' +
          '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pc + '" aria-label="Progreso de ' + esc(fmt.nombreCompleto(x.e)) + '"><i style="width:' + pc + '%"></i></div>' + detalleEstudiante(ctx, x.e.id) + '</details></li>'; }).join('') + '</ul>' : ui.vacio({ titulo: 'Sin estudiantes matriculados' }).s);
  }

  EDU.router.register('aula', { titulo: 'Aula virtual', render: vistaLista });
  EDU.router.register('aula/:cargaId', { titulo: 'Curso virtual', render: vistaCurso });
})();
