/* Vista "personas": docentes / estudiantes / tutores (lista, filtros, alta/edicion/baja) y ficha del estudiante (ruta personas/:id).
   Permisos: ver docs/API.md §6. Toda escritura pasa por EDU.repo (que valida rol y centro). Todo dato de usuario se escapa con EDU.esc. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui;

  /* ---------- estilos propios (tokens de css/base.css) ---------- */
  (function () {
    if (document.getElementById('edu-css-personas')) return;
    var s = document.createElement('style'); s.id = 'edu-css-personas';
    s.textContent = '.pf-filtros{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px}' +
      '.pf-filtros label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:2px}.pf-filtros select{min-width:150px}' +
      '.pf-filtros .sp{flex:1}.pf-nombre{font-weight:600;color:var(--navy-2)}' +
      '.pf-ficha{display:flex;gap:16px;align-items:center;margin-bottom:18px;flex-wrap:wrap}' +
      '.pf-ficha .av{width:64px;height:64px;font-size:22px;font-family:var(--serif)}' +
      '.pf-ficha h1{font-size:30px}.pf-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}' +
      '.pf-dl dt{color:var(--muted);font-size:13px}.pf-dl dd{margin:0;overflow-wrap:anywhere}' +
      '.pf-sec{margin-top:18px}.pf-sec h2{margin-bottom:10px}.pf-acc{display:flex;gap:8px;flex-wrap:wrap}' +
      '.pf-tutor{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}' +
      '.pf-tutor:last-child{border-bottom:0}.pf-tutor small{display:block;color:var(--muted)}' +
      '.pf-volver{display:inline-block;margin-bottom:10px;font-size:14px}@media(max-width:560px){.pf-dl{grid-template-columns:1fr}.pf-dl dd{margin-bottom:6px}}';
    document.head.appendChild(s);
  })();

  /* ---------- utilidades ---------- */
  var CED = /^\d{3}-?\d{7}-?\d$/;
  var MSG_CED = 'El documento debe tener el formato de cédula 000-0000000-0 (11 dígitos).';
  function normDoc(v) { if (!v) return null; var d = String(v).replace(/\D/g, ''); return d.slice(0, 3) + '-' + d.slice(3, 10) + '-' + d.slice(10); }
  function aHtml(x) { return x instanceof EDU.Safe ? x.s : (x == null ? '' : String(x)); }
  function rol() { return EDU.estado.rol(); }
  function puede(col, accion) { return EDU.permisos.puede(rol(), 'personas', accion) && EDU.permisos.puedeEscribirColeccion(rol(), col); }
  function estadoDe(p) { return p.estado || 'activo'; }
  function badgeEstado(p) { return aHtml(ui.badge(estadoDe(p) === 'activo' ? 'Activo' : 'Inactivo', estadoDe(p) === 'activo' ? 'ok' : 'neu')); }
  function por(l, k) { return EDU.consultas.agrupar(l, k); }
  function pick(l, id) { return l.filter(function (x) { return x.id === id; })[0] || null; }
  function secLabel(d, s) { if (!s) return ''; var c = pick(d.cursos, s.cursoId); return (c ? c.nombre + ' ' : '') + s.nombre; }
  function edad(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null;
    var h = new Date(), e = h.getFullYear() - +m[1];
    if (h.getMonth() + 1 < +m[2] || (h.getMonth() + 1 === +m[2] && h.getDate() < +m[3])) e--;
    return e;
  }
  function err(e) { ui.toast(e && e.message ? e.message : 'No se pudo completar la acción.', 'error'); }
  function opcSelect(id, titulo, ops, sel) { return '<label>' + esc(titulo) + '<select data-f="' + id + '">' + aHtml(ui.opciones(ops, sel)) + '</select></label>'; }

  var COLS = ['estudiantes', 'docentes', 'tutores', 'matriculas', 'secciones', 'cursos', 'cargas', 'anios'];
  async function cargar() {
    var d = await EDU.consultas.cargar(COLS);
    d.al = EDU.permisos.alcance(EDU.estado.sesion(), d);
    d.matAct = {}; // estudianteId -> matricula activa
    d.matriculas.forEach(function (m) { if (m.estado === 'activa') d.matAct[m.estudianteId] = m; });
    return d;
  }
  function centroParaAlta() {
    var c = EDU.estado.centroActivo();
    if (!c) { ui.toast('Selecciona un centro educativo (selector superior) para crear registros.', 'warn'); return null; }
    return c;
  }
  function nuevaMatriculaCodigo(d) {
    var mx = 0; d.estudiantes.forEach(function (e) { var m = /(\d+)$/.exec(e.matricula || ''); if (m) mx = Math.max(mx, +m[1]); });
    var cen = EDU.estado.centroActivo() || '';
    return 'MAT-' + (cen.replace(/\D/g, '') || '0') + '-' + (Math.max(mx, 2000) + 1);
  }

  /* ---------- formularios ---------- */
  function validadorDoc(lista, actualId) {
    return function (v) {
      if (!v) return null;
      var n = normDoc(v);
      return lista.some(function (x) { return x.id !== actualId && x.documento && normDoc(x.documento) === n; }) ? 'Ya existe una persona registrada con ese documento.' : null;
    };
  }
  var GENERO = [{ valor: 'F', texto: 'Femenino' }, { valor: 'M', texto: 'Masculino' }];
  function campoDoc(req, lista, id) {
    return { nombre: 'documento', label: 'Documento (cédula)', requerido: req, placeholder: '000-0000000-0', patron: CED, mensajePatron: MSG_CED, custom: validadorDoc(lista, id),
      ayuda: 'Formato 000-0000000-0.' + (req ? '' : ' Opcional para menores.') };
  }
  function fechaPasada(v) { return v && v > fmt.hoy() ? 'La fecha de nacimiento no puede ser futura.' : (v && v < '1930-01-01' ? 'La fecha de nacimiento no es plausible.' : null); }

  function camposEstudiante(d, id) {
    return [
      { nombre: 'nombres', label: 'Nombres', requerido: true, maxLen: 80 }, { nombre: 'apellidos', label: 'Apellidos', requerido: true, maxLen: 80 },
      campoDoc(false, d.estudiantes, id),
      { nombre: 'fechaNacimiento', label: 'Fecha de nacimiento', tipo: 'date', requerido: true, custom: fechaPasada },
      { nombre: 'genero', label: 'Género', tipo: 'select', requerido: true, opciones: GENERO },
      { nombre: 'telefono', label: 'Teléfono', maxLen: 30 },
      { nombre: 'direccion', label: 'Dirección', ancho: 'full', maxLen: 200 }];
  }
  function camposDocente(d, id) {
    return [
      { nombre: 'nombres', label: 'Nombres', requerido: true, maxLen: 80 }, { nombre: 'apellidos', label: 'Apellidos', requerido: true, maxLen: 80 },
      campoDoc(true, d.docentes, id),
      { nombre: 'email', label: 'Correo electrónico', tipo: 'email', requerido: true },
      { nombre: 'telefono', label: 'Teléfono', maxLen: 30 }, { nombre: 'especialidad', label: 'Especialidad / área', maxLen: 80 },
      { nombre: 'genero', label: 'Género', tipo: 'select', requerido: true, opciones: GENERO }];
  }
  var PARENTESCO = ['Madre', 'Padre', 'Tutor/a legal', 'Abuelo/a', 'Tío/a', 'Hermano/a', 'Otro'];
  function camposTutor(d, id, conEstudiante) {
    var c = [
      { nombre: 'nombres', label: 'Nombres', requerido: true, maxLen: 80 }, { nombre: 'apellidos', label: 'Apellidos', requerido: true, maxLen: 80 },
      campoDoc(true, d.tutores, id),
      { nombre: 'parentesco', label: 'Parentesco', tipo: 'select', requerido: true, opciones: PARENTESCO },
      { nombre: 'telefono', label: 'Teléfono', requerido: true, maxLen: 30 }, { nombre: 'email', label: 'Correo electrónico', tipo: 'email' }];
    if (conEstudiante) c.push({ nombre: 'estudianteId', label: 'Vincular a estudiante (opcional)', tipo: 'select', ancho: 'full',
      opciones: d.estudiantes.filter(function (e) { return estadoDe(e) === 'activo'; }).sort(function (a, b) { return fmt.nombreCompleto(a).localeCompare(fmt.nombreCompleto(b), 'es'); })
        .map(function (e) { return { valor: e.id, texto: fmt.nombreCompleto(e) + ' (' + (e.matricula || 's/n') + ')' }; }) });
    return c;
  }

  /** Alta/edicion generica: abre el modal, guarda y devuelve el registro (o null). */
  async function editar(col, titulo, campos, reg, extra) {
    var nuevo = !reg;
    if (nuevo && !centroParaAlta()) return null;
    var v = await ui.formularioModal({ titulo: (nuevo ? 'Nuevo: ' : 'Editar: ') + titulo, campos: campos, valores: reg || {}, tamano: 'lg', textoEnviar: nuevo ? 'Crear' : 'Guardar cambios' });
    if (!v) return null;
    var o = Object.assign({}, reg || { centroId: EDU.estado.centroActivo(), estado: 'activo' }, v);
    delete o.estudianteId; o.documento = normDoc(v.documento);
    if (extra) extra(o, nuevo);
    try { var g = await EDU.repo.guardar(col, o); ui.toast(titulo + (nuevo ? ' creado/a.' : ' actualizado/a.'), 'ok'); g._estudianteId = v.estudianteId; return g; } catch (e) { err(e); return null; }
  }
  async function guardarEstudiante(d, reg) {
    return editar('estudiantes', 'estudiante', camposEstudiante(d, reg && reg.id), reg, function (o, nuevo) { if (nuevo && !o.matricula) o.matricula = nuevaMatriculaCodigo(d); });
  }
  async function guardarTutor(d, reg) {
    var g = await editar('tutores', 'tutor/a', camposTutor(d, reg && reg.id, !reg), reg, function (o, nuevo) { if (nuevo) o.estudianteIds = []; });
    if (g && g._estudianteId) { await vincular(g.id, g._estudianteId); }
    return g;
  }
  async function vincular(tutorId, estId) {
    var t = await EDU.repo.obtener('tutores', tutorId); if (!t) return;
    t.estudianteIds = t.estudianteIds || [];
    if (t.estudianteIds.indexOf(estId) === -1) { t.estudianteIds.push(estId); await EDU.repo.guardar('tutores', t); }
  }

  /** Baja logica / reactivacion. */
  async function cambiarEstado(col, p, d, nombre) {
    var baja = estadoDe(p) === 'activo';
    if (baja) {
      if (col === 'docentes') {
        var n = d.cargas.filter(function (c) { return c.docenteId === p.id; }).length;
        if (n) { ui.toast('No se puede dar de baja: tiene ' + fmt.plural(n, 'asignación', 'asignaciones') + ' docentes. Reasígnalas primero.', 'error', 6500); return false; }
      }
      var m = col === 'estudiantes' ? d.matAct[p.id] : null;
      var ok = await ui.confirmar({ titulo: 'Dar de baja', mensaje: '¿Dar de baja a ' + nombre + '?' + (m ? ' Su matrícula activa será retirada.' : ''), textoOk: 'Dar de baja', peligro: true });
      if (!ok) return false;
      try {
        if (m) { if (!EDU.permisos.puedeEscribirColeccion(rol(), 'matriculas')) throw new Error('Sin permiso para retirar la matrícula.'); m.estado = 'retirada'; m.fechaRetiro = fmt.hoy(); m.motivoRetiro = 'Baja del estudiante'; await EDU.repo.guardar('matriculas', m); }
        p.estado = 'inactivo'; p.fechaBaja = fmt.hoy(); await EDU.repo.guardar(col, p);
        ui.toast(nombre + ' fue dado/a de baja.', 'ok'); return true;
      } catch (e) { err(e); return false; }
    }
    try { p.estado = 'activo'; delete p.fechaBaja; await EDU.repo.guardar(col, p); ui.toast(nombre + ' fue reactivado/a.', 'ok'); return true; } catch (e) { err(e); return false; }
  }

  /* ---------- listas ---------- */
  function filtros(cont, defs, alCambiar) {
    var h = '<div class="pf-filtros" role="group" aria-label="Filtros">' + defs.map(function (f) { return opcSelect(f.id, f.titulo, f.ops, f.sel); }).join('') + '<span class="sp"></span><span data-slot></span></div>';
    var el = ui.el(h);
    el.addEventListener('change', function () { alCambiar(valores()); });
    function valores() { var v = {}; el.querySelectorAll('select[data-f]').forEach(function (s) { v[s.dataset.f] = s.value; }); return v; }
    cont.appendChild(el);
    return { el: el, slot: el.querySelector('[data-slot]'), valores: valores };
  }
  function btnNuevo(slot, texto, fn) {
    var b = ui.el('<button type="button" class="btn amb">+ ' + esc(texto) + '</button>'); b.addEventListener('click', fn); slot.appendChild(b);
  }
  var OPC_ESTADO = [{ valor: 'activo', texto: 'Activos' }, { valor: 'inactivo', texto: 'Inactivos' }, { valor: '', texto: 'Todos' }];
  function pasaEstado(p, v) { return !v.estado || estadoDe(p) === v.estado; }

  async function tabEstudiantes(panel, refrescar) {
    var d = await cargar();
    var lista = EDU.permisos.filtrar(d.al, 'estudiantes', d.estudiantes);
    var secs = EDU.permisos.filtrar(d.al, 'secciones', d.secciones);
    var puedeE = puede('estudiantes', 'editar'), puedeC = puede('estudiantes', 'crear');
    function filas(v) {
      return lista.filter(function (e) {
        var m = d.matAct[e.id];
        return pasaEstado(e, v) && (!v.seccion || (v.seccion === '_sin' ? !m : m && m.seccionId === v.seccion)) && (!v.genero || e.genero === v.genero);
      }).map(function (e) {
        var m = d.matAct[e.id], s = m && pick(d.secciones, m.seccionId);
        return { id: e.id, reg: e, nombre: fmt.nombreCompleto(e), matricula: e.matricula, documento: e.documento, seccion: s ? secLabel(d, s) : 'Sin matrícula', genero: e.genero === 'F' ? 'Femenino' : e.genero === 'M' ? 'Masculino' : '', estado: estadoDe(e) };
      });
    }
    var f = filtros(panel, [
      { id: 'estado', titulo: 'Estado', ops: OPC_ESTADO, sel: 'activo' },
      { id: 'seccion', titulo: 'Sección', ops: [{ valor: '', texto: 'Todas' }, { valor: '_sin', texto: 'Sin matrícula activa' }].concat(secs.map(function (s) { return { valor: s.id, texto: secLabel(d, s) }; })) },
      { id: 'genero', titulo: 'Género', ops: [{ valor: '', texto: 'Todos' }].concat(GENERO) }], function (v) { tb.actualizar(filas(v)); });
    if (puedeC) btnNuevo(f.slot, 'Nuevo estudiante', async function () { if (await guardarEstudiante(d)) refrescar(); });
    var tb = ui.tabla({ etiqueta: 'Estudiantes', ordenInicial: 'nombre', filas: filas(f.valores()), vacio: { titulo: 'Sin estudiantes', texto: 'No hay estudiantes con estos filtros.' },
      columnas: [
        { clave: 'nombre', titulo: 'Estudiante', render: function (r) { return '<a class="pf-nombre" href="#/personas/' + encodeURIComponent(r.id) + '">' + esc(r.nombre) + '</a>'; } },
        { clave: 'matricula', titulo: 'Código' }, { clave: 'documento', titulo: 'Documento' }, { clave: 'seccion', titulo: 'Sección' }, { clave: 'genero', titulo: 'Género' },
        { clave: 'estado', titulo: 'Estado', render: function (r) { return badgeEstado(r.reg); } }],
      acciones: puedeE ? [
        { texto: 'Editar', alClic: async function (r) { if (await guardarEstudiante(d, r.reg)) refrescar(); } },
        { texto: 'Baja / Reactivar', tipo: 'dng', alClic: async function (r) { if (await cambiarEstado('estudiantes', r.reg, d, r.nombre)) refrescar(); } }] : [] });
    panel.appendChild(tb.el);
  }

  async function tabDocentes(panel, refrescar) {
    var d = await cargar(), puedeE = puede('docentes', 'editar'), puedeC = puede('docentes', 'crear');
    var esp = Array.from(new Set(d.docentes.map(function (x) { return x.especialidad; }).filter(Boolean))).sort();
    var nCargas = {}; d.cargas.forEach(function (c) { nCargas[c.docenteId] = (nCargas[c.docenteId] || 0) + 1; });
    function filas(v) {
      return d.docentes.filter(function (x) { return pasaEstado(x, v) && (!v.esp || x.especialidad === v.esp); }).map(function (x) {
        return { id: x.id, reg: x, nombre: fmt.nombreCompleto(x), documento: x.documento, email: x.email, telefono: x.telefono, especialidad: x.especialidad, cargas: nCargas[x.id] || 0, estado: estadoDe(x) };
      });
    }
    var f = filtros(panel, [{ id: 'estado', titulo: 'Estado', ops: OPC_ESTADO, sel: 'activo' }, { id: 'esp', titulo: 'Especialidad', ops: [{ valor: '', texto: 'Todas' }].concat(esp) }], function (v) { tb.actualizar(filas(v)); });
    if (puedeC) btnNuevo(f.slot, 'Nuevo docente', async function () {
      var g = await editar('docentes', 'docente', camposDocente(d), null); if (g) refrescar();
    });
    var tb = ui.tabla({ etiqueta: 'Docentes', ordenInicial: 'nombre', filas: filas(f.valores()), vacio: { titulo: 'Sin docentes' },
      columnas: [{ clave: 'nombre', titulo: 'Docente' }, { clave: 'documento', titulo: 'Documento' }, { clave: 'especialidad', titulo: 'Especialidad' }, { clave: 'email', titulo: 'Correo' }, { clave: 'telefono', titulo: 'Teléfono' },
        { clave: 'cargas', titulo: 'Asignaciones', align: 'c' }, { clave: 'estado', titulo: 'Estado', render: function (r) { return badgeEstado(r.reg); } }],
      acciones: puedeE ? [
        { texto: 'Editar', alClic: async function (r) { if (await editar('docentes', 'docente', camposDocente(d, r.reg.id), r.reg)) refrescar(); } },
        { texto: 'Baja / Reactivar', tipo: 'dng', alClic: async function (r) { if (await cambiarEstado('docentes', r.reg, d, r.nombre)) refrescar(); } }] : [] });
    panel.appendChild(tb.el);
    if (!puedeE) panel.appendChild(ui.el('<p class="note">Tu rol solo puede consultar el directorio de docentes.</p>'));
  }

  async function tabTutores(panel, refrescar) {
    var d = await cargar(), puedeE = puede('tutores', 'editar'), puedeC = puede('tutores', 'crear');
    function filas(v) {
      return d.tutores.filter(function (t) { return pasaEstado(t, v) && (!v.par || t.parentesco === v.par); }).map(function (t) {
        var hijos = (t.estudianteIds || []).map(function (id) { return pick(d.estudiantes, id); }).filter(Boolean);
        return { id: t.id, reg: t, nombre: fmt.nombreCompleto(t), documento: t.documento, parentesco: t.parentesco, telefono: t.telefono, email: t.email, hijos: hijos, estado: estadoDe(t) };
      });
    }
    var f = filtros(panel, [{ id: 'estado', titulo: 'Estado', ops: OPC_ESTADO, sel: 'activo' }, { id: 'par', titulo: 'Parentesco', ops: [{ valor: '', texto: 'Todos' }].concat(PARENTESCO) }], function (v) { tb.actualizar(filas(v)); });
    if (puedeC) btnNuevo(f.slot, 'Nuevo tutor/a', async function () { if (await guardarTutor(d)) refrescar(); });
    var tb = ui.tabla({ etiqueta: 'Tutores', ordenInicial: 'nombre', filas: filas(f.valores()), vacio: { titulo: 'Sin tutores' },
      columnas: [{ clave: 'nombre', titulo: 'Tutor/a' }, { clave: 'documento', titulo: 'Documento' }, { clave: 'parentesco', titulo: 'Parentesco' }, { clave: 'telefono', titulo: 'Teléfono' }, { clave: 'email', titulo: 'Correo' },
        { clave: 'hijos', titulo: 'Estudiantes', valor: function (r) { return r.hijos.map(fmt.nombreCompleto).join(', '); },
          render: function (r) { return r.hijos.length ? r.hijos.map(function (e) { return '<a href="#/personas/' + encodeURIComponent(e.id) + '">' + esc(fmt.nombreCompleto(e)) + '</a>'; }).join(', ') : '—'; } },
        { clave: 'estado', titulo: 'Estado', render: function (r) { return badgeEstado(r.reg); } }],
      acciones: puedeE ? [
        { texto: 'Editar', alClic: async function (r) { if (await guardarTutor(d, r.reg)) refrescar(); } },
        { texto: 'Baja / Reactivar', tipo: 'dng', alClic: async function (r) { if (await cambiarEstado('tutores', r.reg, d, r.nombre)) refrescar(); } }] : [] });
    panel.appendChild(tb.el);
  }

  EDU.router.register('personas', {
    titulo: 'Personas',
    render: async function (cont) {
      var r = rol(), ses = EDU.estado.sesion();
      if (r === 'estudiante' && ses.refId) { EDU.router.ir('personas/' + ses.refId); return; }
      var tabs = [{ id: 'estudiantes', titulo: 'Estudiantes', render: function (p) { return tabEstudiantes(p, refrescar); } }];
      var staff = ['admin_red', 'director', 'secretaria'].indexOf(r) !== -1;
      if (staff) tabs.push({ id: 'docentes', titulo: 'Docentes', render: function (p) { return tabDocentes(p, refrescar); } }, { id: 'tutores', titulo: 'Tutores', render: function (p) { return tabTutores(p, refrescar); } });
      var desc = r === 'docente' ? 'Estudiantes de tus secciones.' : r === 'tutor' ? 'Tus estudiantes a cargo.' : 'Directorio de estudiantes, docentes y tutores del centro.';
      cont.innerHTML = aHtml(ui.cabecera({ eyebrow: 'Comunidad educativa', titulo: 'Personas', descripcion: desc }));
      var t = ui.tabs({ tabs: tabs, etiqueta: 'Tipo de persona', siempre: true });
      cont.appendChild(t.el);
      function refrescar() { t.seleccionar(t.actual()); }
    }
  });

  /* ---------- ficha del estudiante ---------- */
  EDU.router.register('personas/:id', {
    titulo: 'Ficha del estudiante',
    render: async function (cont, params) {
      var ses = EDU.estado.sesion(), r = rol(), id = params.id;
      var volver = r === 'estudiante' ? '' : '<a class="pf-volver" href="#/personas">← Volver a Personas</a>';
      function aviso(t, s) { cont.innerHTML = volver + '<div class="card">' + aHtml(ui.vacio({ titulo: t, texto: s })) + '</div>'; }
      var d = await EDU.consultas.cargar(['estudiantes', 'tutores', 'matriculas', 'secciones', 'cursos', 'cargas', 'asignaturas', 'docentes', 'categorias', 'actividades', 'calificaciones', 'periodos', 'escalas', 'asistencia', 'anios']);
      var al = EDU.permisos.alcance(ses, d), est = pick(d.estudiantes, id);
      if (!est) return aviso('Estudiante no encontrado', 'No existe un estudiante con ese identificador en el centro activo.');
      if (al.estudianteIds && !al.estudianteIds.has(id)) return aviso('Acceso denegado', 'Solo puedes consultar estudiantes de tu alcance.');
      var nombre = fmt.nombreCompleto(est), mats = d.matriculas.filter(function (m) { return m.estudianteId === id; }).sort(function (a, b) { return String(b.fecha || '').localeCompare(String(a.fecha || '')); });
      var act = mats.filter(function (m) { return m.estado === 'activa'; })[0], secAct = act && pick(d.secciones, act.seccionId);
      var tutores = d.tutores.filter(function (t) { return (t.estudianteIds || []).indexOf(id) !== -1; });
      var puedeE = puede('estudiantes', 'editar'), puedeT = puede('tutores', 'editar');

      function dl(pares) { return '<dl class="pf-dl">' + pares.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1] == null || p[1] === '' ? '—' : p[1])) + '</dd>'; }).join('') + '</dl>'; }
      var ed = edad(est.fechaNacimiento);
      var h = volver + '<header class="pf-ficha"><div class="av" aria-hidden="true">' + esc(fmt.iniciales(nombre)) + '</div><div><p class="eyebrow">Ficha del estudiante</p><h1>' + esc(nombre) + '</h1>' +
        '<div class="chips">' + badgeEstado(est) + (secAct ? '<span class="chip">' + esc(secLabel(d, secAct)) + '</span>' : aHtml(ui.badge('Sin matrícula activa', 'warn'))) + '<span class="chip">' + esc(est.matricula || 'Sin código') + '</span></div></div>' +
        '<div class="pf-acc" style="margin-left:auto">' + (puedeE ? '<button type="button" class="btn amb" id="pf-edit">Editar datos</button>' : '') +
        (EDU.permisos.puede(r, 'matricula', 'crear') ? '<a class="btn sec" href="#/matricula">Matrícula</a>' : '') + '</div></header>';
      h += '<div class="grid two"><section class="card" aria-labelledby="pf-h-datos"><h2 id="pf-h-datos">Datos personales</h2>' + dl([
        ['Documento', est.documento], ['Fecha de nacimiento', est.fechaNacimiento ? fmt.fecha(est.fechaNacimiento) + (ed != null ? ' (' + ed + ' años)' : '') : ''],
        ['Género', est.genero === 'F' ? 'Femenino' : est.genero === 'M' ? 'Masculino' : ''], ['Teléfono', est.telefono], ['Dirección', est.direccion]]) + '</section>' +
        '<section class="card" aria-labelledby="pf-h-tut"><h2 id="pf-h-tut">Tutores</h2><div id="pf-tut">' +
        (tutores.length ? tutores.map(function (t) {
          return '<div class="pf-tutor"><div><strong>' + esc(fmt.nombreCompleto(t)) + '</strong> <span class="chip">' + esc(t.parentesco || 'Tutor') + '</span><small>' + esc(t.telefono || 'Sin teléfono') + (t.email ? ' · ' + esc(t.email) : '') + '</small></div>' +
            (puedeT ? '<button type="button" class="btn dng sm" data-quitar="' + esc(t.id) + '" aria-label="Quitar a ' + esc(fmt.nombreCompleto(t)) + ' como tutor">Quitar</button>' : '') + '</div>';
        }).join('') : '<p class="note">Sin tutores vinculados.</p>') + '</div>' +
        (puedeT ? '<div class="pf-acc" style="margin-top:12px"><button type="button" class="btn sec sm" id="pf-vinc">Vincular tutor existente</button><button type="button" class="btn sec sm" id="pf-nuevot">Nuevo tutor/a</button></div>' : '') + '</section></div>';

      // Notas por asignatura
      var califs = d.calificaciones.filter(function (c) { return c.estudianteId === id; });
      var filas = EDU.consultas.resumenNotas({ matriculas: mats, cargas: d.cargas, categorias: d.categorias, actividades: d.actividades, calificaciones: califs, periodos: d.periodos, escalas: d.escalas });
      var perCentro = d.periodos.filter(function (p) { return p.centroId === est.centroId && (!act || p.anioId === act.anioId); }).sort(function (a, b) { return a.orden - b.orden; });
      h += '<section class="card pf-sec" aria-labelledby="pf-h-notas"><h2 id="pf-h-notas">Calificaciones por asignatura</h2>';
      if (!filas.length) h += '<p class="note">No hay asignaturas registradas: el estudiante no tiene matrícula activa o su sección no tiene cargas docentes.</p></section>';
      else {
        var con = filas.filter(function (x) { return x.final != null; }), esc0 = filas[0].escala;
        var prom = con.length ? EDU.escala.desdePorcentaje(con.reduce(function (s, x) { return s + x.pct; }, 0) / con.length, esc0) : null;
        var rep = con.filter(function (x) { return !x.aprobado; }).length;
        h += '<p class="note" style="margin-top:0">Promedio general: <strong>' + esc(fmt.nota(prom, esc0)) + '</strong> · Mínimo aprobatorio: ' + esc(esc0.notaMinAprobar) + (con.length ? ' · ' + (rep ? esc(fmt.plural(rep, 'asignatura reprobada', 'asignaturas reprobadas')) : 'Sin asignaturas reprobadas') : '') + '</p><div id="pf-notas"></div></section>';
      }
      // Asistencia
      var asis = d.asistencia.filter(function (a) { return a.estudianteId === id; });
      if (asis.length && EDU.permisos.puede(r, 'asistencia', 'ver')) {
        var cnt = { P: 0, A: 0, T: 0, J: 0 }; asis.forEach(function (a) { if (cnt[a.estado] != null) cnt[a.estado]++; });
        h += '<section class="card pf-sec" aria-labelledby="pf-h-as"><h2 id="pf-h-as">Asistencia</h2>' + aHtml(ui.kpis([
          { etiqueta: 'Presente', valor: cnt.P, tono: 'neu' }, { etiqueta: 'Ausente', valor: cnt.A, tono: 'neu' }, { etiqueta: 'Tardanza', valor: cnt.T, tono: 'neu' }, { etiqueta: 'Justificada', valor: cnt.J, tono: 'neu' },
          { etiqueta: 'Asistencia', valor: fmt.pct((asis.length - cnt.A) / asis.length * 100, 1), detalle: asis.length + ' registros' }])) + '</section>';
      }
      // Historial de matricula
      h += '<section class="card pf-sec" aria-labelledby="pf-h-mat"><h2 id="pf-h-mat">Historial de matrícula</h2>' + (mats.length ? '<div class="tw"><table class="t"><caption class="sr-only">Historial de matrícula</caption><thead><tr><th scope="col">Año</th><th scope="col">Sección</th><th scope="col">Fecha</th><th scope="col">Estado</th></tr></thead><tbody>' +
        mats.map(function (m) { var an = pick(d.anios, m.anioId); return '<tr><td>' + esc(an ? an.nombre : m.anioId) + '</td><td>' + esc(secLabel(d, pick(d.secciones, m.seccionId))) + '</td><td>' + esc(fmt.fecha(m.fecha)) + '</td><td>' + aHtml(ui.badge(m.estado === 'activa' ? 'Activa' : 'Retirada', m.estado === 'activa' ? 'ok' : 'neu')) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="note">Sin matrículas registradas.</p>') + '</section>';
      cont.innerHTML = h;

      if (filas.length) {
        var esc1 = filas[0].escala;
        var rows = filas.map(function (x) {
          var a = pick(d.asignaturas, x.asignaturaId), dc = pick(d.docentes, x.docenteId), o = { asignatura: a ? a.nombre : x.asignaturaId, docente: dc ? fmt.nombreCompleto(dc) : '—', final: x.final, aprobado: x.aprobado };
          perCentro.forEach(function (p, i) { var pp = x.periodos.filter(function (z) { return z.periodoId === p.id; })[0]; o['p' + i] = pp ? pp.nota : null; });
          return o;
        });
        var cols = [{ clave: 'asignatura', titulo: 'Asignatura' }, { clave: 'docente', titulo: 'Docente' }].concat(perCentro.map(function (p, i) {
          return { clave: 'p' + i, titulo: p.nombre, align: 'c', formato: function (v) { return v == null ? '—' : fmt.nota(v, esc1); } };
        }), [{ clave: 'final', titulo: 'Final', align: 'c', formato: function (v) { return v == null ? '—' : fmt.nota(v, esc1); } },
          { clave: 'aprobado', titulo: 'Estado', align: 'c', valor: function (f) { return f.aprobado == null ? '' : f.aprobado ? 'Aprobado' : 'Reprobado'; },
            render: function (f) { return f.aprobado == null ? '—' : aHtml(ui.badge(f.aprobado ? 'Aprobado' : 'Reprobado', f.aprobado ? 'ok' : 'bad')); } }]);
        cont.querySelector('#pf-notas').appendChild(ui.tabla({ etiqueta: 'Calificaciones de ' + nombre, columnas: cols, filas: rows, buscar: false, porPagina: false, ordenInicial: 'asignatura' }).el);
      }

      async function recargar() { await EDU.router.recargar(); }
      var be = cont.querySelector('#pf-edit');
      if (be) be.addEventListener('click', async function () { if (await guardarEstudiante({ estudiantes: d.estudiantes }, est)) recargar(); });
      cont.querySelectorAll('[data-quitar]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var t = pick(d.tutores, b.dataset.quitar); if (!t) return;
          if (!(await ui.confirmar({ titulo: 'Quitar tutor', mensaje: '¿Quitar a ' + fmt.nombreCompleto(t) + ' como tutor de ' + nombre + '?', textoOk: 'Quitar', peligro: true }))) return;
          try { t.estudianteIds = (t.estudianteIds || []).filter(function (x) { return x !== id; }); await EDU.repo.guardar('tutores', t); ui.toast('Tutor desvinculado.', 'ok'); recargar(); } catch (e) { err(e); }
        });
      });
      var bv = cont.querySelector('#pf-vinc');
      if (bv) bv.addEventListener('click', async function () {
        var libres = d.tutores.filter(function (t) { return estadoDe(t) === 'activo' && (t.estudianteIds || []).indexOf(id) === -1; });
        if (!libres.length) { ui.toast('No hay otros tutores disponibles para vincular.', 'warn'); return; }
        var v = await ui.formularioModal({ titulo: 'Vincular tutor', textoEnviar: 'Vincular', campos: [{ nombre: 'tutorId', label: 'Tutor/a', tipo: 'select', requerido: true, ancho: 'full',
          opciones: libres.map(function (t) { return { valor: t.id, texto: fmt.nombreCompleto(t) + ' (' + (t.parentesco || 'Tutor') + ')' }; }) }] });
        if (v) { try { await vincular(v.tutorId, id); ui.toast('Tutor vinculado.', 'ok'); recargar(); } catch (e) { err(e); } }
      });
      var bn = cont.querySelector('#pf-nuevot');
      if (bn) bn.addEventListener('click', async function () {
        var g = await editar('tutores', 'tutor/a', camposTutor(d, null, false), null, function (o) { o.estudianteIds = [id]; });
        if (g) recargar();
      });
    }
  });
})();
