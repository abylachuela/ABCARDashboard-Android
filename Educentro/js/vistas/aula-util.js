/* Aula virtual: utilidades compartidas (EDU.aula). Carga de datos, alcance por rol, archivos pequeños (data URL),
   enlaces seguros, formularios modales, calificacion hacia el libro de notas y progreso. Ver docs/API.md "Aula virtual". */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui;
  var A = (EDU.aula = EDU.aula || {});

  A.COLS = ['cargas', 'secciones', 'cursos', 'asignaturas', 'docentes', 'estudiantes', 'tutores', 'matriculas', 'periodos', 'categorias', 'actividades',
    'calificaciones', 'escalas', 'secuencias', 'aulaContenidos', 'tareas', 'entregas', 'cuestionarios', 'intentos', 'foros', 'foroMensajes', 'anuncios'];
  A.MAX_ARCHIVO = 500 * 1024;
  A.CUOTA_CHARS = 5000000; // ~5 MB de localStorage (estimacion)

  A.esc = esc;
  A.uid = function () { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); };
  A.ahora = function () { return new Date().toISOString(); };
  A.byId = function (lista) { var m = {}; (lista || []).forEach(function (x) { m[x.id] = x; }); return m; };
  A.href = function (cargaId, q) {
    var qs = q && Object.keys(q).length ? '?' + Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&') : '';
    return '#/aula' + (cargaId ? '/' + encodeURIComponent(cargaId) : '') + qs;
  };
  A.ordenar = function (lista, campo) {
    return lista.slice().sort(function (a, b) { var x = a[campo] == null ? 1e9 : a[campo], y = b[campo] == null ? 1e9 : b[campo]; return x === y ? String(a.creadoEn || '').localeCompare(String(b.creadoEn || '')) : (x < y ? -1 : 1); });
  };

  /* ---------- datos y alcance ---------- */
  A.cargar = async function () {
    var d = await EDU.consultas.cargar(A.COLS), ses = EDU.estado.sesion();
    d.ses = ses; d.rol = ses.rol;
    d.al = EDU.permisos.alcance(ses, d);
    d.m = { carga: A.byId(d.cargas), seccion: A.byId(d.secciones), curso: A.byId(d.cursos), asig: A.byId(d.asignaturas), doc: A.byId(d.docentes), est: A.byId(d.estudiantes), periodo: A.byId(d.periodos), act: A.byId(d.actividades), sec: A.byId(d.secuencias) };
    d.estIds = ses.rol === 'estudiante' ? [ses.refId] : ses.rol === 'tutor' ? ((d.tutores.filter(function (t) { return t.id === ses.refId; })[0] || {}).estudianteIds || []) : [];
    return d;
  };
  A.cursoVirtual = function (d, cargaId) { return d.aulaContenidos.filter(function (x) { return x.tipo === 'curso' && x.cargaId === cargaId && x.activo !== false; })[0] || null; };
  A.nombres = function (d, cg) {
    var s = d.m.seccion[cg.seccionId] || {}, c = d.m.curso[s.cursoId] || {}, a = d.m.asig[cg.asignaturaId] || {}, dc = d.m.doc[cg.docenteId];
    return { asig: a.nombre || 'Asignatura', color: a.color || '#14315c', seccion: ((c.nombre || '') + ' ' + (s.nombre || '')).trim(), docente: dc ? fmt.nombreCompleto(dc) : '—' };
  };
  A.esDocenteDe = function (d, cg) { return d.rol === 'docente' && cg && cg.docenteId === d.ses.refId && EDU.permisos.puede(d.rol, 'aula', 'editar'); };
  /** Cargas que el usuario puede abrir. Docente: las suyas (con o sin curso virtual). Resto: solo con curso virtual activo. */
  A.cargasVisibles = function (d) {
    var lista = d.cargas.filter(function (cg) {
      if (d.rol === 'docente') return cg.docenteId === d.ses.refId;
      if (d.rol === 'estudiante' || d.rol === 'tutor') return d.al.cargaIds && d.al.cargaIds.has(cg.id) && !!A.cursoVirtual(d, cg.id);
      return !!A.cursoVirtual(d, cg.id);
    });
    return lista.sort(function (a, b) { return A.nombres(d, a).asig.localeCompare(A.nombres(d, b).asig, 'es'); });
  };
  A.estudiantesDe = function (d, cg) {
    var ids = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa' && m.seccionId === cg.seccionId) ids[m.estudianteId] = 1; });
    return d.estudiantes.filter(function (e) { return ids[e.id]; }).sort(function (a, b) { return fmt.nombreCompleto(a).localeCompare(fmt.nombreCompleto(b), 'es'); });
  };
  /** Estudiante activo: el propio, o el hijo elegido (tutor); null para el resto. */
  A.estActual = function (d, params, cg) {
    if (d.rol === 'estudiante') return d.ses.refId;
    if (d.rol !== 'tutor') return null;
    var ids = d.estIds;
    if (cg) { var propios = ids.filter(function (id) { return A.estudiantesDe(d, cg).some(function (e) { return e.id === id; }); }); if (propios.length) ids = propios; }
    return params && params.est && ids.indexOf(params.est) !== -1 ? params.est : ids[0] || null;
  };
  A.escalaDe = function (d, centroId) { return EDU.consultas.escalaDe(d.escalas, centroId);  };
  A.puedeParticipar = function (d, cg) { return d.rol === 'estudiante' || A.esDocenteDe(d, cg); };

  /* ---------- enlaces y archivos (seguridad) ---------- */
  /** Solo http/https. Devuelve la URL normalizada o null. */
  A.urlSegura = function (u) {
    try { var x = new URL(String(u || '').trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  };
  A.dataUrlSegura = function (s) { return typeof s === 'string' && /^data:[a-zA-Z0-9.+\-]+\/[a-zA-Z0-9.+\-]+(;[a-zA-Z0-9=.\-]+)*;base64,[A-Za-z0-9+\/=]+$/.test(s); };
  A.tamano = function (b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
  A.usoAlmacen = function () {
    var n = 0; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; } } catch (e) { return null; }
    return n;
  };
  A.leerArchivo = function (file) {
    return new Promise(function (res, rej) {
      if (!file) return res(null);
      if (file.size > A.MAX_ARCHIVO) return rej(new Error('El archivo «' + file.name + '» pesa ' + A.tamano(file.size) + ' y el máximo es 500 KB.'));
      var uso = A.usoAlmacen();
      if (uso != null && uso + file.size * 1.4 > A.CUOTA_CHARS * 0.97) return rej(new Error('No hay espacio suficiente en el almacenamiento local (' + fmt.num(uso / A.CUOTA_CHARS * 100) + ' % usado). Usa un enlace en lugar de un archivo o libera espacio.'));
      var r = new FileReader();
      r.onload = function () { var du = String(r.result || ''); if (!A.dataUrlSegura(du)) return rej(new Error('No se pudo leer el archivo.')); res({ nombre: file.name.slice(0, 120), tipo: file.type || 'application/octet-stream', tamano: file.size, dataUrl: du }); };
      r.onerror = function () { rej(new Error('No se pudo leer el archivo.')); };
      r.readAsDataURL(file);
    });
  };
  A.avisoCuota = function () {
    var uso = A.usoAlmacen();
    return 'Máximo 500 KB por archivo. Se guarda en este dispositivo (localStorage' + (uso != null ? ', uso aprox. ' + fmt.num(uso / A.CUOTA_CHARS * 100) + ' % de ~5 MB' : '') + '). Para archivos grandes usa un enlace.';
  };
  A.postGuardar = function () { if (EDU.repoLocal && EDU.repoLocal.advertencia) ui.toast(EDU.repoLocal.advertencia, 'warn', 6000); };
  A.htmlArchivo = function (a) {
    if (!a || !A.dataUrlSegura(a.dataUrl)) return '';
    return '<a class="aula-archivo" href="' + esc(a.dataUrl) + '" download="' + esc(a.nombre || 'archivo') + '" rel="noopener">' + ui.icono('boletin', 18).s + '<span>' + esc(a.nombre || 'archivo') + ' <small>(' + esc(A.tamano(a.tamano || 0)) + ')</small></span></a>';
  };
  A.htmlEnlace = function (u, texto) {
    var s = A.urlSegura(u); if (!s) return '<span class="note">Enlace no válido</span>';
    return '<a class="aula-enlace" href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + esc(texto || s) + ' <span class="sr-only">(se abre en otra pestaña)</span></a>';
  };
  /** Texto de usuario con saltos de linea, siempre escapado. */
  A.texto = function (t) { return '<div class="aula-texto">' + esc(t || '') + '</div>'; };

  /* ---------- fechas ---------- */
  A.limite = function (it) { return it && it.fechaLimite ? new Date(it.fechaLimite + 'T' + (it.horaLimite || '23:59') + ':00') : null; };
  A.vencido = function (it) { var l = A.limite(it); return !!l && Date.now() > l.getTime(); };
  A.fechaLimiteTxt = function (it) { return it && it.fechaLimite ? fmt.fecha(it.fechaLimite) + ' · ' + (it.horaLimite || '23:59') : 'Sin fecha límite'; };
  A.diasHasta = function (it) {
    var l = A.limite(it); if (!l) return null;
    var h = new Date(fmt.hoy() + 'T00:00:00'), f = new Date(it.fechaLimite + 'T00:00:00');
    return Math.round((f - h) / 86400000);
  };

  /* ---------- campos y formularios modales ---------- */
  A.campo = function (o) {
    var id = 'af-' + o.n, v = o.v == null ? '' : o.v, desc = id + '-e' + (o.ayuda ? ' ' + id + '-h' : ''), ctl;
    var at = ' id="' + id + '" name="' + esc(o.n) + '" aria-describedby="' + desc + '"' + (o.req ? ' required aria-required="true"' : '') + (o.dis ? ' disabled' : '') + (o.attrs || '');
    if (o.tipo === 'select') ctl = '<select' + at + '>' + (o.vacio === false ? '' : '<option value="">' + esc(o.vacio || 'Seleccionar…') + '</option>') + ui.opciones(o.opciones || [], v).s + '</select>';
    else if (o.tipo === 'textarea') ctl = '<textarea' + at + ' rows="' + (o.rows || 4) + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + '>' + esc(v) + '</textarea>';
    else if (o.tipo === 'check') return '<div class="fld full"><label class="opt aula-opt"><input type="checkbox"' + at + (v ? ' checked' : '') + '>' + esc(o.label) + '</label>' + (o.ayuda ? '<span class="help" id="' + id + '-h">' + esc(o.ayuda) + '</span>' : '') + '<span class="err" id="' + id + '-e"></span></div>';
    else if (o.tipo === 'file') ctl = '<input type="file"' + at + '>';
    else ctl = '<input type="' + (o.tipo === 'number' ? 'text" inputmode="decimal' : esc(o.tipo || 'text')) + '"' + at + ' value="' + esc(v) + '"' + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + '>';
    return '<div class="fld' + (o.full || o.tipo === 'textarea' ? ' full' : '') + '"><label for="' + id + '">' + esc(o.label) + (o.req ? ' *' : '') + '</label>' + ctl +
      (o.ayuda ? '<span class="help" id="' + id + '-h">' + esc(o.ayuda) + '</span>' : '') + '<span class="err" id="' + id + '-e"></span></div>';
  };
  A.error = function (campo, msg) { var e = new Error(msg); e.campo = campo; return e; };
  A.val = function (form, n) { var e = form.elements[n]; return e ? (e.type === 'checkbox' ? e.checked : String(e.value).trim()) : ''; };
  A.num = function (v) { return EDU.calculo.aNumero(v); };
  /** formModal({titulo, html, textoOk, tamano, alEnviar(form)->Promise, alMontar(form, modal)}) -> Promise<resultado|null> */
  A.formModal = function (o) {
    var form = document.createElement('form'); form.noValidate = true; form.className = 'aula-form';
    form.innerHTML = '<div class="form-error hidden" role="alert"></div><div class="fgrid">' + o.html + '</div>';
    var ocupado = false;
    async function enviar(cerrar) {
      if (ocupado) return; ocupado = true;
      var box = form.querySelector('.form-error'); box.classList.add('hidden');
      Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (x) { x.removeAttribute('aria-invalid'); });
      Array.prototype.forEach.call(form.querySelectorAll('.err'), function (x) { x.textContent = ''; });
      try { var r = await o.alEnviar(form); ocupado = false; cerrar(r === undefined ? true : r); }
      catch (err) {
        ocupado = false;
        var el = err && err.campo && form.elements[err.campo];
        if (el) { el.setAttribute('aria-invalid', 'true'); var s = form.querySelector('#' + el.id + '-e'); if (s) s.textContent = err.message; el.focus(); }
        box.textContent = (err && err.message) || 'No se pudo guardar.'; box.classList.remove('hidden');
      }
    }
    var m = ui.modal({ titulo: o.titulo, contenido: form, tamano: (o.tamano || '') + ' aula-m', botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null }, { texto: o.textoOk || 'Guardar', tipo: 'amb', alClic: enviar }] });
    form.addEventListener('submit', function (ev) { ev.preventDefault(); enviar(m.cerrar); });
    form.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'file' && ev.target.type !== 'checkbox' && ev.target.type !== 'radio') { ev.preventDefault(); enviar(m.cerrar); } });
    if (o.alMontar) o.alMontar(form, m);
    return m.resultado;
  };

  /* ---------- vinculo con secuencias didacticas (opcional) ---------- */
  A.seqDe = function (d, cargaId) { return d.secuencias.filter(function (s) { return s.cargaId === cargaId; }); };
  A.seqCampos = function (d, cargaId, it) {
    var seqs = A.seqDe(d, cargaId); if (!seqs.length) return '';
    return A.campo({ n: 'secuenciaId', label: 'Secuencia didáctica (opcional)', tipo: 'select', opciones: seqs.map(function (s) { return { valor: s.id, texto: s.titulo }; }), v: (it && it.secuenciaId) || '', vacio: 'Sin vincular', full: true,
      ayuda: 'Vincula este contenido a una secuencia y sus indicadores de logro.' }) + '<div class="fld full" id="aula-inds" data-sel="' + esc(((it && it.indicadorIds) || []).join(',')) + '"></div>';
  };
  A.seqMontar = function (d, form) {
    var sel = form.elements.secuenciaId, host = form.querySelector('#aula-inds'); if (!sel || !host) return;
    var marcados = (host.dataset.sel || '').split(',').filter(Boolean);
    function pintar() {
      var s = d.m.sec[sel.value];
      if (!s || !(s.indicadoresLogro || []).length) { host.innerHTML = ''; return; }
      host.innerHTML = '<fieldset class="aula-fs"><legend>Indicadores de logro que trabaja</legend>' + s.indicadoresLogro.map(function (i) {
        return '<label class="opt aula-opt"><input type="checkbox" name="ind" value="' + esc(i.uid) + '"' + (marcados.indexOf(i.uid) !== -1 ? ' checked' : '') + '><span>' + esc(i.texto) + '</span></label>'; }).join('') + '</fieldset>';
    }
    sel.addEventListener('change', function () { marcados = []; pintar(); });
    pintar();
  };
  A.seqValores = function (form) {
    var sel = form.elements.secuenciaId; if (!sel || !sel.value) return { secuenciaId: null, indicadorIds: [] };
    return { secuenciaId: sel.value, indicadorIds: Array.prototype.map.call(form.querySelectorAll('input[name=ind]:checked'), function (x) { return x.value; }) };
  };
  A.seqChip = function (d, it) {
    if (!it || !it.secuenciaId) return '';
    var s = d.m.sec[it.secuenciaId]; if (!s) return '';
    var n = (it.indicadorIds || []).length, t = 'Secuencia: ' + s.titulo + (n ? ' · ' + n + ' indicador' + (n === 1 ? '' : 'es') : '');
    return EDU.permisos.puedeModulo(d.rol, 'secuencias') ? '<a class="chip amb aula-chip" href="#/secuencias/' + esc(s.id) + '">' + esc(t) + '</a>' : '<span class="chip amb aula-chip">' + esc(t) + '</span>';
  };

  /* ---------- tareas / cuestionarios: estados y progreso ---------- */
  A.tareasDe = function (d, cargaId, verOcultas) { return d.tareas.filter(function (t) { return t.cargaId === cargaId && (verOcultas || t.publicada !== false); }); };
  A.quizzesDe = function (d, cargaId, verOcultos) { return d.cuestionarios.filter(function (q) { return q.cargaId === cargaId && q.tipo !== 'banco' && (verOcultos || q.publicado !== false); }); };
  A.entregaDe = function (d, tareaId, estId) { return d.entregas.filter(function (e) { return e.tareaId === tareaId && e.estudianteId === estId; })[0] || null; };
  A.intentosDe = function (d, quizId, estId) { return d.intentos.filter(function (i) { return i.cuestionarioId === quizId && i.estudianteId === estId; }).sort(function (a, b) { return a.numero - b.numero; }); };
  A.estadoTarea = function (d, t, estId) {
    var e = A.entregaDe(d, t.id, estId);
    if (e && e.estado === 'calificada') return { k: 'calificada', txt: 'Calificada', tono: 'ok', e: e };
    if (e) return { k: 'entregada', txt: e.tarde ? 'Entregada (tarde)' : 'Entregada', tono: 'info', e: e };
    if (A.vencido(t)) return { k: 'vencida', txt: 'Sin entregar · vencida', tono: 'bad', e: null };
    return { k: 'pendiente', txt: 'Pendiente', tono: 'warn', e: null };
  };
  A.estadoQuiz = function (d, q, estId) {
    var its = A.intentosDe(d, q.id, estId), fin = its.filter(function (i) { return i.estado === 'finalizado'; }), curso = its.filter(function (i) { return i.estado !== 'finalizado'; })[0];
    if (fin.length) return { k: 'completado', txt: 'Completado', tono: 'ok', n: fin.length, its: its };
    if (curso) return { k: 'en_curso', txt: 'En curso', tono: 'info', n: 0, its: its };
    if (A.vencido(q)) return { k: 'vencido', txt: 'No realizado · cerrado', tono: 'bad', n: 0, its: its };
    return { k: 'pendiente', txt: 'Pendiente', tono: 'warn', n: 0, its: its };
  };
  A.progreso = function (d, cg, estId) {
    var ts = A.tareasDe(d, cg.id), qs = A.quizzesDe(d, cg.id), te = 0, qc = 0;
    ts.forEach(function (t) { if (A.entregaDe(d, t.id, estId)) te++; });
    qs.forEach(function (q) { if (A.estadoQuiz(d, q, estId).k === 'completado') qc++; });
    var tot = ts.length + qs.length;
    return { tareas: ts.length, entregadas: te, quizzes: qs.length, completados: qc, pct: tot ? (te + qc) / tot * 100 : null };
  };

  /* ---------- calificacion hacia el libro de notas ---------- */
  /** Garantiza la actividad del libro (categoria + periodo) para una tarea/cuestionario. Respeta periodo cerrado. */
  A.asegurarActividad = async function (d, item, coleccion) {
    var cg = d.m.carga[item.cargaId];
    var act = item.actividadId ? d.m.act[item.actividadId] : null;
    var per = d.m.periodo[act ? act.periodoId : item.periodoId];
    if (!act && !item.categoriaId) throw new Error('Elige la categoría del libro de notas para esta actividad (edítala primero).');
    if (!per) throw new Error('Elige el periodo del libro de notas para esta actividad (edítala primero).');
    if (per.cerrado) throw new Error('El periodo «' + per.nombre + '» está cerrado: no se pueden registrar notas. Pide al director que lo reabra.');
    if (!act) {
      if (!(item.puntosMax > 0)) throw new Error('La actividad no tiene puntos máximos válidos.');
      act = await EDU.repo.guardar('actividades', { id: 'act_aula_' + item.id, centroId: cg.centroId, cargaId: cg.id, categoriaId: item.categoriaId, periodoId: item.periodoId,
        nombre: item.titulo, puntosMax: item.puntosMax, fecha: item.fechaLimite || fmt.hoy(), origen: 'aula', origenTipo: coleccion, origenId: item.id });
      d.actividades.push(act); d.m.act[act.id] = act;
      item.actividadId = act.id;
      await EDU.repo.guardar(coleccion, item);
    }
    return act;
  };
  /** Escribe la nota (puntos SIN redondear, en la base de puntosMax de la actividad; el libro la normaliza a la escala) con auditoria del repo. */
  A.guardarNota = async function (d, item, coleccion, estId, puntos, comentario) {
    var act = await A.asegurarActividad(d, item, coleccion), cg = d.m.carga[item.cargaId];
    if (puntos != null && !(puntos >= 0 && puntos <= act.puntosMax + 1e-9)) throw A.error('puntos', 'Los puntos deben estar entre 0 y ' + act.puntosMax + '.');
    var id = 'cal_' + act.id + '_' + estId;
    var prev = d.calificaciones.filter(function (c) { return c.id === id; })[0] || {};
    var rec = await EDU.repo.guardar('calificaciones', Object.assign({}, prev, { id: id, centroId: cg.centroId, actividadId: act.id, estudianteId: estId, puntos: puntos, comentario: comentario || '' }));
    d.calificaciones = d.calificaciones.filter(function (c) { return c.id !== id; }).concat([rec]);
    return rec;
  };
  A.notaTxt = function (d, cg, puntos, max) {
    if (puntos == null) return '—';
    var e = A.escalaDe(d, cg.centroId), n = EDU.escala.desdePorcentaje(puntos / max * 100, e);
    return fmt.nota(n, e) + (Math.abs(max - e.max) > 1e-9 ? ' (' + fmt.num(puntos, 2).replace(/\.?0+$/, '') + '/' + max + ')' : '');
  };

  /* ---------- cuestionarios: autocalificacion (sin eval) ---------- */
  A.calificarQuiz = function (q, respuestas) {
    var tot = 0, max = 0, det = {};
    (q.preguntas || []).forEach(function (p) {
      var pt = +p.puntos || 0, r = respuestas ? respuestas[p.id] : undefined, ok = r != null && r !== '' && String(r) === String(p.correcta);
      max += pt; if (ok) tot += pt; det[p.id] = { ok: ok, puntos: ok ? pt : 0, max: pt };
    });
    return { puntos: tot, max: max, detalle: det };
  };
  A.puntajeQuiz = function (q, its) {
    var f = its.filter(function (i) { return i.estado === 'finalizado'; }); if (!f.length) return null;
    var regla = q.regla || 'mejor';
    if (regla === 'ultimo') return f[f.length - 1].puntos;
    if (regla === 'promedio') return f.reduce(function (s, i) { return s + i.puntos; }, 0) / f.length;
    return Math.max.apply(null, f.map(function (i) { return i.puntos; }));
  };
})();
