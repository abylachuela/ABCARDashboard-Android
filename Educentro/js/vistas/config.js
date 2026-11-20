/* Vista "config": configuracion del centro activo (anios/periodos, escala, cursos/secciones, asignaturas, cargas). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, raw = EDU.raw;
  var TANDAS = ['Matutina', 'Vespertina', 'Jornada Extendida', 'Nocturna'];
  var MODALIDADES = ['General', 'Técnico-Profesional', 'Artes'];

  function h(x) { return x instanceof EDU.Safe ? x.s : String(x == null ? '' : x); }
  function puede(a) { return EDU.permisos.puede(EDU.estado.rol(), 'config', a); }
  function L(col) { return EDU.repo.listar(col); }
  function opt(lista, v, t) { return lista.map(function (x) { return { valor: x[v], texto: typeof t === 'function' ? t(x) : x[t] }; }); }
  function falla(e) { ui.toast((e && e.message) || 'No se pudo completar la operación.', 'error', 6000); }
  function nombreCurso(c) { return c ? c.nombre : '?'; }
  function nombreDoc(d) { return d ? fmt.nombreCompleto(d) : '?'; }
  function sinPermiso(p) { p.insertAdjacentHTML('afterbegin', '<p class="note" style="margin:0 0 12px">Modo solo lectura: tu rol no puede modificar la configuración.</p>'); }
  function acc(col, editar, borrar, extra) {
    var a = [];
    if (extra) a = a.concat(extra);
    if (puede('editar')) a.push({ texto: 'Editar', tipo: 'sec', alClic: editar });
    if (puede('borrar')) a.push({ texto: 'Eliminar', tipo: 'dng', alClic: borrar });
    return a;
  }
  async function dependientes(col, campo, id) { return (await EDU.repo.listar(col, { filtro: function (r) { return r[campo] === id; } })).length; }
  async function borrarSeguro(col, reg, etiqueta, deps, refrescar) {
    for (var i = 0; i < deps.length; i++) {
      var n = await dependientes(deps[i][0], deps[i][1], reg.id);
      if (n) { ui.toast('No se puede eliminar ' + etiqueta + ': tiene ' + n + ' ' + deps[i][2] + ' asociados.', 'error', 6000); return; }
    }
    if (!(await ui.confirmar({ titulo: 'Eliminar', mensaje: '¿Eliminar ' + etiqueta + '? Esta acción no se puede deshacer.', textoOk: 'Eliminar', peligro: true }))) return;
    try { await EDU.repo.borrar(col, reg.id); ui.toast('Eliminado.', 'ok'); } catch (e) { falla(e); }
    refrescar();
  }
  function botonNuevo(texto, alClic) {
    if (!puede('crear')) return null;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn amb'; b.textContent = texto; b.addEventListener('click', alClic); return b;
  }
  function cabeceraPanel(titulo, desc, btn) {
    var d = document.createElement('div'); d.style.cssText = 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px';
    d.innerHTML = '<div><h2>' + esc(titulo) + '</h2>' + (desc ? '<p class="note" style="margin:4px 0 0">' + esc(desc) + '</p>' : '') + '</div>'; if (btn) d.appendChild(btn); return d;
  }
  async function guardar(col, reg) { try { return await EDU.repo.guardar(col, reg); } catch (e) { falla(e); throw e; } }

  /* ================= Años y periodos ================= */
  async function panelAnios(p, estado) {
    async function pintar() {
      var anios = await L('anios'), periodos = await L('periodos');
      anios.sort(function (a, b) { return String(b.inicio).localeCompare(String(a.inicio)); });
      if (!anios.some(function (a) { return a.id === estado.anioId; })) estado.anioId = (anios.filter(function (a) { return a.activo; })[0] || anios[0] || {}).id;
      p.innerHTML = '';
      /* --- años --- */
      var cardA = document.createElement('section'); cardA.className = 'card'; cardA.setAttribute('aria-label', 'Años lectivos');
      async function formAnio(a) {
        var v = await ui.formularioModal({ titulo: a ? 'Editar año lectivo' : 'Nuevo año lectivo', valores: a || { activo: !anios.length }, campos: [
          { nombre: 'nombre', label: 'Nombre', requerido: true, maxLen: 60, placeholder: 'Año escolar 2026-2027', ancho: 'full',
            custom: function (v) { return anios.some(function (x) { return x.nombre === v && (!a || x.id !== a.id); }) ? 'Ya existe un año con ese nombre.' : null; } },
          { nombre: 'inicio', label: 'Inicio', tipo: 'date', requerido: true },
          { nombre: 'fin', label: 'Fin', tipo: 'date', requerido: true, custom: function (v, t) { return t.inicio && v && v <= t.inicio ? 'La fecha de fin debe ser posterior al inicio.' : null; } },
          { nombre: 'activo', label: 'Año activo (el vigente del centro)', tipo: 'checkbox' }] });
        if (!v) return;
        try {
          var g = await EDU.repo.guardar('anios', Object.assign({}, a || {}, v));
          if (v.activo) for (var i = 0; i < anios.length; i++) if (anios[i].id !== g.id && anios[i].activo) await EDU.repo.guardar('anios', Object.assign({}, anios[i], { activo: false }));
          estado.anioId = g.id; ui.toast('Año lectivo guardado.', 'ok');
        } catch (e) { falla(e); }
        pintar();
      }
      cardA.appendChild(cabeceraPanel('Años lectivos', 'Solo un año puede estar activo.', botonNuevo('Nuevo año lectivo', function () { formAnio(null); })));
      cardA.appendChild(ui.tabla({ caption: 'Años lectivos', buscar: false, porPagina: false, filas: anios, vacio: { titulo: 'Sin años lectivos', texto: 'Crea el primero para definir periodos y secciones.' },
        columnas: [{ clave: 'nombre', titulo: 'Nombre' }, { clave: 'inicio', titulo: 'Inicio', formato: function (v) { return fmt.fecha(v); } }, { clave: 'fin', titulo: 'Fin', formato: function (v) { return fmt.fecha(v); } },
          { clave: 'activo', titulo: 'Estado', render: function (f) { return ui.badge(f.activo ? 'Activo' : 'Inactivo', f.activo ? 'ok' : 'neu'); } }],
        acciones: acc('anios', formAnio, function (a) { borrarSeguro('anios', a, 'el año «' + a.nombre + '»', [['periodos', 'anioId', 'periodos'], ['secciones', 'anioId', 'secciones'], ['cargas', 'anioId', 'cargas'], ['matriculas', 'anioId', 'matrículas']], pintar); }) }).el);
      p.appendChild(cardA);
      /* --- periodos --- */
      var cardP = document.createElement('section'); cardP.className = 'card'; cardP.style.marginTop = '18px'; cardP.setAttribute('aria-label', 'Periodos');
      p.appendChild(cardP);
      if (!anios.length) { cardP.appendChild(cabeceraPanel('Periodos', 'Crea primero un año lectivo.')); return; }
      var propios = periodos.filter(function (x) { return x.anioId === estado.anioId; }).sort(function (a, b) { return a.orden - b.orden; });
      var suma = EDU.calculo.validarPesos(propios), anio = anios.filter(function (a) { return a.id === estado.anioId; })[0];
      async function formPeriodo(per) {
        var otros = propios.filter(function (x) { return !per || x.id !== per.id; });
        var v = await ui.formularioModal({ titulo: per ? 'Editar periodo' : 'Nuevo periodo', valores: per || { orden: propios.length + 1, peso: Math.max(0, suma.diferencia) }, campos: [
          { nombre: 'nombre', label: 'Nombre', requerido: true, maxLen: 60, ancho: 'full' },
          { nombre: 'orden', label: 'Orden', tipo: 'number', entero: true, requerido: true, min: 1, max: 12, custom: function (v) { return otros.some(function (x) { return x.orden === v; }) ? 'Ya existe un periodo con ese orden.' : null; } },
          { nombre: 'peso', label: 'Peso (%)', tipo: 'number', requerido: true, min: 0.01, max: 100, ayuda: 'Los pesos del año deben sumar 100.',
            custom: function (v) { var s = EDU.calculo.validarPesos(otros.concat([{ peso: v }])); return s.suma > 100.001 ? 'Con este peso la suma sería ' + s.suma + '; máximo 100.' : null; } },
          { nombre: 'inicio', label: 'Inicio', tipo: 'date', requerido: true, custom: function (v) { return anio && v && (v < anio.inicio || v > anio.fin) ? 'Debe estar dentro del año lectivo (' + anio.inicio + ' a ' + anio.fin + ').' : null; } },
          { nombre: 'fin', label: 'Fin', tipo: 'date', requerido: true, custom: function (v, t) { return t.inicio && v && v <= t.inicio ? 'El fin debe ser posterior al inicio.' : (anio && v > anio.fin ? 'Debe estar dentro del año lectivo.' : null); } }] });
        if (!v) return;
        try { await EDU.repo.guardar('periodos', Object.assign({ cerrado: false }, per || {}, v, { anioId: estado.anioId })); ui.toast('Periodo guardado.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      async function alternar(per) {
        if (!per.cerrado) {
          var s = EDU.calculo.validarPesos(propios);
          if (!s.ok) { ui.toast('No se puede cerrar: los pesos de los periodos suman ' + s.suma + ', deben sumar 100.', 'error', 6000); return; }
          if (!(await ui.confirmar({ titulo: 'Cerrar periodo', mensaje: '¿Cerrar «' + per.nombre + '»? Las notas del periodo dejarán de editarse.', textoOk: 'Cerrar periodo' }))) return;
        } else if (!(await ui.confirmar({ titulo: 'Reabrir periodo', mensaje: '¿Reabrir «' + per.nombre + '» para permitir cambios de notas?', textoOk: 'Reabrir' }))) return;
        try { await EDU.repo.guardar('periodos', Object.assign({}, per, { cerrado: !per.cerrado })); ui.toast(per.cerrado ? 'Periodo reabierto.' : 'Periodo cerrado.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      var sel = document.createElement('div'); sel.className = 'fld'; sel.style.maxWidth = '340px';
      sel.innerHTML = '<label for="sel-anio">Año lectivo</label><select id="sel-anio">' + h(ui.opciones(opt(anios, 'id', 'nombre'), estado.anioId)) + '</select>';
      sel.querySelector('select').addEventListener('change', function (e) { estado.anioId = e.target.value; pintar(); setTimeout(function () { var s = document.getElementById('sel-anio'); if (s) s.focus(); }, 0); });
      cardP.appendChild(cabeceraPanel('Periodos del año', 'Cada periodo tiene un peso; la suma debe ser 100.', botonNuevo('Nuevo periodo', function () { formPeriodo(null); })));
      cardP.appendChild(sel);
      var st = document.createElement('p'); st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite'); st.style.margin = '10px 0';
      st.innerHTML = h(ui.badge(propios.length ? (suma.ok ? 'Suma de pesos: 100 ✓' : 'Suma de pesos: ' + suma.suma + (suma.diferencia > 0 ? ' · faltan ' + suma.diferencia : ' · sobran ' + (-suma.diferencia))) : 'Sin periodos', suma.ok ? 'ok' : 'warn'));
      cardP.appendChild(st);
      cardP.appendChild(ui.tabla({ caption: 'Periodos del año seleccionado', buscar: false, porPagina: false, filas: propios, vacio: { titulo: 'Sin periodos', texto: 'Agrega los periodos de este año lectivo.' },
        columnas: [{ clave: 'orden', titulo: '#', align: 'c' }, { clave: 'nombre', titulo: 'Periodo' }, { clave: 'peso', titulo: 'Peso', align: 'c', formato: function (v) { return v + ' %'; } },
          { clave: 'inicio', titulo: 'Inicio', formato: function (v) { return fmt.fecha(v); } }, { clave: 'fin', titulo: 'Fin', formato: function (v) { return fmt.fecha(v); } },
          { clave: 'cerrado', titulo: 'Estado', render: function (f) { return ui.badge(f.cerrado ? 'Cerrado' : 'Abierto', f.cerrado ? 'neu' : 'ok'); } }],
        acciones: acc('periodos', formPeriodo, function (x) { borrarSeguro('periodos', x, 'el periodo «' + x.nombre + '»', [['actividades', 'periodoId', 'actividades']], pintar); },
          puede('cerrar') ? [{ texto: 'Cerrar/Reabrir', tipo: 'sec', alClic: alternar }] : null) }).el);
      if (!puede('editar')) sinPermiso(cardP);
    }
    await pintar();
  }

  /* ================= Escala ================= */
  async function panelEscala(p) {
    var escalas = await L('escalas'), actual = escalas.filter(function (e) { return e.activa !== false; })[0] || null;
    var base = actual || Object.assign({ activa: true }, EDU.escala.porDefecto());
    var tramos = base.tramos.map(function (t) { return { desde: t.desde, etiqueta: t.etiqueta, letra: t.letra }; });
    var ro = !puede('editar');
    p.innerHTML = '<section class="card" aria-label="Escala de calificación"><h2>Escala de calificación y nota mínima</h2><p class="note" style="margin:4px 0 12px">Escala MINERD de 0 a 100; la nota mínima de aprobación es configurable (por defecto 70). Las notas se guardan sin redondear.</p>' +
      (ro ? '<p class="note">Modo solo lectura: tu rol no puede modificar la configuración.</p>' : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button type="button" class="btn sec sm" data-pre="0-100"' + (ro ? ' disabled' : '') + '>Cargar 0–100 (MINERD)</button><button type="button" class="btn sec sm" data-pre="0-10"' + (ro ? ' disabled' : '') + '>Cargar 0–10</button></div><div id="fe"></div>' +
      '<h3 style="margin:18px 0 8px">Tramos de desempeño</h3><div id="tr" class="tw"></div>' + (ro ? '' : '<p style="margin-top:10px"><button type="button" class="btn sec sm" id="addt">Agregar tramo</button></p>') + '<div id="msg" class="alert red hidden" role="alert"></div>' +
      (ro ? '' : '<div class="form-actions" style="margin-top:16px"><button type="button" class="btn amb" id="gua">Guardar escala</button></div>') + '</section>';
    var fe = p.querySelector('#fe'), form;
    function campos(v) {
      return [{ nombre: 'min', label: 'Nota mínima de la escala', tipo: 'number', requerido: true, min: 0, max: 1000, deshabilitado: ro }, { nombre: 'max', label: 'Nota máxima de la escala', tipo: 'number', requerido: true, min: 1, max: 1000, deshabilitado: ro,
        custom: function (x, t) { return t.min != null && x != null && x <= t.min ? 'El máximo debe ser mayor que el mínimo.' : null; } },
        { nombre: 'notaMinAprobar', label: 'Nota mínima de aprobación', tipo: 'number', requerido: true, deshabilitado: ro, ayuda: 'Debe estar dentro de la escala.',
          custom: function (x, t) { return t.min != null && t.max != null && x != null && (x < t.min || x > t.max) ? 'Debe estar entre ' + t.min + ' y ' + t.max + '.' : null; } },
        { nombre: 'decimales', label: 'Decimales al mostrar', tipo: 'number', entero: true, requerido: true, min: 0, max: 3, deshabilitado: ro },
        { nombre: 'modelo', label: 'Modelo de calificación', tipo: 'select', deshabilitado: ro, ancho: 'full', ayuda: 'Ponderado: categorías y actividades. Por competencias: planilla MINERD (4 competencias × 4 periodos con RP, completiva y extraordinaria).',
          opciones: [{ valor: 'ponderado', texto: 'Ponderado por categorías y actividades' }, { valor: 'competencias', texto: 'Por competencias (planilla MINERD)' }] },
        { nombre: 'regla', label: 'Regla de recuperación (RP)', tipo: 'select', deshabilitado: ro, opciones: [{ valor: 'reemplaza', texto: 'El RP reemplaza al periodo si P < mínimo' }, { valor: 'maximo', texto: 'Vale el mayor entre P y RP' }] },
        { nombre: 'cCf', label: 'Completiva: % de CF', tipo: 'number', min: 0, max: 100, deshabilitado: ro }, { nombre: 'cCec', label: 'Completiva: % de CEC', tipo: 'number', min: 0, max: 100, deshabilitado: ro },
        { nombre: 'xCf', label: 'Extraordinaria: % de CF', tipo: 'number', min: 0, max: 100, deshabilitado: ro }, { nombre: 'xCex', label: 'Extraordinaria: % de CEX', tipo: 'number', min: 0, max: 100, deshabilitado: ro }];
    }
    function valModelo(e) { var c = EDU.calculo.configCompetencias(e); return { modelo: EDU.calculo.modelo(e), regla: c.regla, cCf: c.completiva.cf, cCec: c.completiva.cec, xCf: c.extraordinaria.cf, xCex: c.extraordinaria.cex }; }
    function pintarForm(v) { var m = form ? (function (c) { return { modelo: c.modelo, regla: c.regla, cCf: c.cCf, cCec: c.cCec, xCf: c.xCf, xCex: c.xCex }; })(form.valores()) : valModelo(actual || {}); v = Object.assign({}, m, v); form = ui.formulario({ campos: campos(v), valores: v, sinBotones: true }); fe.innerHTML = ''; fe.appendChild(form.el); }
    function pintarTramos() {
      var t = p.querySelector('#tr');
      t.innerHTML = '<table class="t"><caption class="sr-only">Tramos de desempeño</caption><thead><tr><th scope="col">Desde (nota)</th><th scope="col">Etiqueta</th><th scope="col">Letra</th>' + (ro ? '' : '<th scope="col"><span class="sr-only">Quitar</span></th>') + '</tr></thead><tbody>' +
        tramos.map(function (x, i) {
          return '<tr><td><label class="sr-only" for="td' + i + '">Desde, tramo ' + (i + 1) + '</label><input id="td' + i + '" data-i="' + i + '" data-k="desde" value="' + esc(x.desde) + '" inputmode="decimal" style="width:90px"' + (ro ? ' disabled' : '') + '></td>' +
            '<td><label class="sr-only" for="te' + i + '">Etiqueta, tramo ' + (i + 1) + '</label><input id="te' + i + '" data-i="' + i + '" data-k="etiqueta" value="' + esc(x.etiqueta) + '" maxlength="40"' + (ro ? ' disabled' : '') + '></td>' +
            '<td><label class="sr-only" for="tl' + i + '">Letra, tramo ' + (i + 1) + '</label><input id="tl' + i + '" data-i="' + i + '" data-k="letra" value="' + esc(x.letra) + '" maxlength="2" style="width:60px"' + (ro ? ' disabled' : '') + '></td>' +
            (ro ? '' : '<td><button type="button" class="btn dng sm" data-q="' + i + '" aria-label="Quitar tramo ' + (i + 1) + '">Quitar</button></td>') + '</tr>';
        }).join('') + '</tbody></table>';
    }
    function leerTramos() { return tramos.map(function (x) { return { desde: EDU.calculo.aNumero(x.desde), etiqueta: String(x.etiqueta || '').trim(), letra: String(x.letra || '').trim() }; }); }
    pintarForm(base); pintarTramos();
    p.addEventListener('input', function (e) { var i = e.target.dataset && e.target.dataset.i; if (i != null && e.target.dataset.k) tramos[+i][e.target.dataset.k] = e.target.value; });
    p.addEventListener('click', function (e) {
      var q = e.target.closest('[data-q]'), pre = e.target.closest('[data-pre]');
      if (q) { tramos.splice(+q.dataset.q, 1); pintarTramos(); var f = p.querySelector('#addt'); if (f) f.focus(); }
      if (pre) { var s = EDU.escala.PRESETS[pre.dataset.pre]; tramos = s.tramos.map(function (t) { return { desde: t.desde, etiqueta: t.etiqueta, letra: t.letra }; }); pintarForm({ min: s.min, max: s.max, notaMinAprobar: s.notaMinAprobar, decimales: s.decimales }); pintarTramos(); ui.toast('Preajuste cargado; pulsa «Guardar escala» para aplicarlo.', 'info'); }
    });
    var add = p.querySelector('#addt'); if (add) add.addEventListener('click', function () { tramos.push({ desde: '', etiqueta: '', letra: '' }); pintarTramos(); p.querySelector('#td' + (tramos.length - 1)).focus(); });
    var gua = p.querySelector('#gua'), msg = p.querySelector('#msg');
    if (gua) gua.addEventListener('click', async function () {
      msg.classList.add('hidden');
      if (!form.validar()) return;
      var v = form.valores(), ts = leerTramos(), errs = [];
      if (!ts.length) errs.push('Agrega al menos un tramo.');
      ts.forEach(function (t, i) {
        if (t.desde == null) errs.push('Tramo ' + (i + 1) + ': «Desde» debe ser un número.');
        else if (t.desde < v.min || t.desde > v.max) errs.push('Tramo ' + (i + 1) + ': «Desde» debe estar entre ' + v.min + ' y ' + v.max + '.');
        if (!t.etiqueta) errs.push('Tramo ' + (i + 1) + ': la etiqueta es obligatoria.');
      });
      var ds = ts.map(function (t) { return t.desde; }); if (ds.some(function (x, i) { return x != null && ds.indexOf(x) !== i; })) errs.push('Hay tramos con el mismo valor «Desde».');
      if (ts.length && !errs.length && Math.min.apply(null, ds) !== v.min) errs.push('El tramo más bajo debe comenzar en ' + v.min + ' para cubrir toda la escala.');
      var ev = EDU.escala.validar(v); if (!ev.ok) errs = errs.concat(ev.errores);
      if (errs.length) { msg.innerHTML = '<div><strong>Revisa la escala</strong><small>' + errs.map(esc).join('<br>') + '</small></div>'; msg.classList.remove('hidden'); return; }
      try {
        var sc = EDU.escala.crear({ min: v.min, max: v.max, notaMinAprobar: v.notaMinAprobar, decimales: v.decimales, tramos: ts });
        var prev = (actual && actual.competencias) || {}, mod = v.modelo === 'competencias' ? 'competencias' : 'ponderado';
        var competencias = Object.assign({}, prev, { regla: v.regla === 'maximo' ? 'maximo' : 'reemplaza', completiva: { cf: Number(v.cCf), cec: Number(v.cCec) }, extraordinaria: { cf: Number(v.xCf), cex: Number(v.xCex) } });
        if (competencias.completiva.cf + competencias.completiva.cec <= 0 || competencias.extraordinaria.cf + competencias.extraordinaria.cex <= 0) { msg.innerHTML = '<div><strong>Revisa la escala</strong><small>Los pesos de completiva y extraordinaria no pueden sumar 0.</small></div>'; msg.classList.remove('hidden'); return; }
        await EDU.repo.guardar('escalas', Object.assign({}, actual || {}, sc, { activa: true, modelo: mod, competencias: competencias }));
        ui.toast('Escala guardada.', 'ok'); EDU.router.recargar();
      } catch (er) { falla(er); }
    });
  }

  /* ================= Cursos y secciones ================= */
  function cicloDe(nivel, grado) { return nivel === 'Inicial' ? null : (grado <= 3 ? 'Primer ciclo' : 'Segundo ciclo'); }
  async function panelCursos(p) {
    async function pintar() {
      var cursos = await L('cursos'), secciones = await L('secciones'), anios = await L('anios'), mats = await L('matriculas');
      cursos.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
      var cn = {}; cursos.forEach(function (c) { cn[c.id] = c; }); var an = {}; anios.forEach(function (a) { an[a.id] = a; });
      p.innerHTML = '';
      async function formCurso(c) {
        var v = await ui.formularioModal({ titulo: c ? 'Editar curso' : 'Nuevo curso', valores: c || {}, campos: [
          { nombre: 'nivel', label: 'Nivel', tipo: 'select', requerido: true, opciones: ['Inicial', 'Primario', 'Secundario'] },
          { nombre: 'grado', label: 'Grado', tipo: 'number', entero: true, requerido: true, min: 1, max: 6, ayuda: 'Inicial: 1–3 · Primario y Secundario: 1.º a 6.º',
            custom: function (g, t) { return t.nivel === 'Inicial' && g > 3 ? 'En Inicial el grado va de 1 a 3.' : null; } },
          { nombre: 'ciclo', label: 'Ciclo', tipo: 'select', requerido: true, opciones: ['Primer ciclo', 'Segundo ciclo'], ayuda: '1.º–3.º Primer ciclo · 4.º–6.º Segundo ciclo',
            custom: function (ci, t) { var esp = cicloDe(t.nivel, t.grado); return esp && ci && ci !== esp ? 'Para ' + t.grado + '.º de ' + t.nivel + ' corresponde «' + esp + '».' : null; } },
          { nombre: 'modalidad', label: 'Modalidad (Secundario, 2.º ciclo)', tipo: 'select', opciones: MODALIDADES,
            custom: function (m, t) {
              var req = t.nivel === 'Secundario' && t.ciclo === 'Segundo ciclo';
              return req && !m ? 'La modalidad es obligatoria en el 2.º ciclo de Secundario.' : (!req && m ? 'La modalidad solo aplica al 2.º ciclo de Secundario.' : null);
            } }] });
        if (!v) return;
        var dup = cursos.some(function (x) { return (!c || x.id !== c.id) && x.nivel === v.nivel && x.grado === v.grado && (x.modalidad || null) === (v.modalidad || null); });
        if (dup) { ui.toast('Ya existe ese curso (nivel, grado y modalidad).', 'error'); return; }
        var nombre = v.grado + '.º ' + v.nivel + (v.modalidad ? ' · ' + v.modalidad : '');
        try { await EDU.repo.guardar('cursos', Object.assign({}, c || { orden: cursos.length + 1 }, v, { nombre: nombre })); ui.toast('Curso guardado.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      var cardC = document.createElement('section'); cardC.className = 'card'; cardC.setAttribute('aria-label', 'Cursos');
      cardC.appendChild(cabeceraPanel('Cursos', 'Nivel, grado, ciclo y modalidad según el MINERD.', botonNuevo('Nuevo curso', function () { formCurso(null); })));
      cardC.appendChild(ui.tabla({ caption: 'Cursos del centro', filas: cursos, porPagina: false, ordenInicial: 'orden', vacio: { titulo: 'Sin cursos', texto: 'Agrega los cursos que ofrece el centro.' },
        columnas: [{ clave: 'orden', titulo: '#', align: 'c' }, { clave: 'nombre', titulo: 'Curso' }, { clave: 'nivel', titulo: 'Nivel' }, { clave: 'grado', titulo: 'Grado', align: 'c' }, { clave: 'ciclo', titulo: 'Ciclo' }, { clave: 'modalidad', titulo: 'Modalidad' }],
        acciones: acc('cursos', formCurso, function (c) { borrarSeguro('cursos', c, 'el curso «' + c.nombre + '»', [['secciones', 'cursoId', 'secciones']], pintar); }) }).el);
      p.appendChild(cardC);

      async function formSeccion(s) {
        if (!cursos.length || !anios.length) { ui.toast('Primero crea al menos un año lectivo y un curso.', 'warn'); return; }
        var v = await ui.formularioModal({ titulo: s ? 'Editar sección' : 'Nueva sección', valores: s || { anioId: (anios.filter(function (a) { return a.activo; })[0] || anios[0]).id, capacidad: 30, tanda: 'Matutina' }, campos: [
          { nombre: 'cursoId', label: 'Curso', tipo: 'select', requerido: true, opciones: opt(cursos, 'id', 'nombre') },
          { nombre: 'anioId', label: 'Año lectivo', tipo: 'select', requerido: true, opciones: opt(anios, 'id', 'nombre') },
          { nombre: 'nombre', label: 'Sección', requerido: true, maxLen: 6, patron: /^[A-Za-z0-9]{1,6}$/, mensajePatron: 'Usa letras o números (ej. A, B, 1).' },
          { nombre: 'tanda', label: 'Tanda', tipo: 'select', requerido: true, opciones: TANDAS },
          { nombre: 'capacidad', label: 'Capacidad', tipo: 'number', entero: true, requerido: true, min: 1, max: 60,
            custom: function (cap) { var n = s ? mats.filter(function (m) { return m.seccionId === s.id && m.estado === 'activa'; }).length : 0; return cap < n ? 'Hay ' + n + ' estudiantes matriculados; la capacidad no puede ser menor.' : null; } }] });
        if (!v) return;
        v.nombre = v.nombre.toUpperCase();
        if (secciones.some(function (x) { return (!s || x.id !== s.id) && x.cursoId === v.cursoId && x.anioId === v.anioId && x.nombre === v.nombre; })) { ui.toast('Esa sección ya existe para el curso y año.', 'error'); return; }
        try { await EDU.repo.guardar('secciones', Object.assign({}, s || {}, v)); ui.toast('Sección guardada.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      var cardS = document.createElement('section'); cardS.className = 'card'; cardS.style.marginTop = '18px'; cardS.setAttribute('aria-label', 'Secciones');
      cardS.appendChild(cabeceraPanel('Secciones', 'Grupos de estudiantes por curso y año lectivo.', botonNuevo('Nueva sección', function () { formSeccion(null); })));
      var filas = secciones.map(function (s) { return Object.assign({}, s, { curso: nombreCurso(cn[s.cursoId]), anio: an[s.anioId] ? an[s.anioId].nombre : '?', est: mats.filter(function (m) { return m.seccionId === s.id && m.estado === 'activa'; }).length }); });
      cardS.appendChild(ui.tabla({ caption: 'Secciones del centro', filas: filas, ordenInicial: 'curso', vacio: { titulo: 'Sin secciones', texto: 'Crea las secciones de cada curso.' },
        columnas: [{ clave: 'curso', titulo: 'Curso' }, { clave: 'nombre', titulo: 'Sección', align: 'c' }, { clave: 'anio', titulo: 'Año lectivo' }, { clave: 'tanda', titulo: 'Tanda' }, { clave: 'capacidad', titulo: 'Capacidad', align: 'c' }, { clave: 'est', titulo: 'Matriculados', align: 'c' }],
        acciones: acc('secciones', function (f) { formSeccion(secciones.filter(function (x) { return x.id === f.id; })[0]); }, function (f) { borrarSeguro('secciones', f, 'la sección ' + f.curso + ' ' + f.nombre, [['matriculas', 'seccionId', 'matrículas'], ['cargas', 'seccionId', 'cargas docentes']], pintar); }) }).el);
      p.appendChild(cardS);
      if (!puede('editar')) sinPermiso(cardC);
    }
    await pintar();
  }

  /* ================= Asignaturas ================= */
  async function panelAsignaturas(p) {
    async function pintar() {
      var asig = await L('asignaturas'); p.innerHTML = '';
      async function form(a) {
        var v = await ui.formularioModal({ titulo: a ? 'Editar asignatura' : 'Nueva asignatura', valores: a || { color: '#14315c' }, campos: [
          { nombre: 'codigo', label: 'Código', requerido: true, patron: /^[A-Za-z0-9]{2,8}$/, mensajePatron: '2 a 8 letras o números.', custom: function (v) { return asig.some(function (x) { return x.codigo.toUpperCase() === String(v).toUpperCase() && (!a || x.id !== a.id); }) ? 'Ya existe una asignatura con ese código.' : null; } },
          { nombre: 'color', label: 'Color', requerido: true, patron: /^#[0-9a-fA-F]{6}$/, mensajePatron: 'Usa un color hexadecimal, ej. #14315c.' },
          { nombre: 'nombre', label: 'Nombre', requerido: true, minLen: 3, maxLen: 80, ancho: 'full' }] });
        if (!v) return; v.codigo = v.codigo.toUpperCase();
        try { await EDU.repo.guardar('asignaturas', Object.assign({}, a || {}, v)); ui.toast('Asignatura guardada.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      var c = document.createElement('section'); c.className = 'card'; c.setAttribute('aria-label', 'Asignaturas');
      c.appendChild(cabeceraPanel('Asignaturas', 'Áreas curriculares que se imparten en el centro.', botonNuevo('Nueva asignatura', function () { form(null); })));
      c.appendChild(ui.tabla({ caption: 'Asignaturas del centro', filas: asig, ordenInicial: 'nombre', porPagina: 12, vacio: { titulo: 'Sin asignaturas', texto: 'Agrega las áreas del plan de estudios.' },
        columnas: [{ clave: 'codigo', titulo: 'Código' }, { clave: 'nombre', titulo: 'Nombre' }, { clave: 'color', titulo: 'Color', render: function (f) { return raw('<span aria-hidden="true" style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;background:' + esc(/^#[0-9a-fA-F]{6}$/.test(f.color || '') ? f.color : '#999') + '"></span> ' + esc(f.color || '—')); } }],
        acciones: acc('asignaturas', form, function (a) { borrarSeguro('asignaturas', a, 'la asignatura «' + a.nombre + '»', [['cargas', 'asignaturaId', 'cargas docentes']], pintar); }) }).el);
      if (!puede('editar')) sinPermiso(c); p.appendChild(c);
    }
    await pintar();
  }

  /* ================= Cargas ================= */
  async function panelCargas(p) {
    async function pintar() {
      var d = await EDU.consultas.cargar(['cargas', 'secciones', 'cursos', 'asignaturas', 'docentes', 'categorias', 'actividades']); p.innerHTML = '';
      var cn = {}, sn = {}, an = {}, dn = {}; d.cursos.forEach(function (x) { cn[x.id] = x; }); d.secciones.forEach(function (x) { sn[x.id] = x; }); d.asignaturas.forEach(function (x) { an[x.id] = x; }); d.docentes.forEach(function (x) { dn[x.id] = x; });
      function sec(s) { return nombreCurso(cn[s.cursoId]) + ' ' + s.nombre; }
      async function form(c) {
        if (!d.secciones.length || !d.asignaturas.length || !d.docentes.length) { ui.toast('Se necesitan secciones, asignaturas y docentes (módulo Personas) para asignar cargas.', 'warn', 6000); return; }
        var v = await ui.formularioModal({ titulo: c ? 'Editar carga docente' : 'Nueva carga docente', valores: c || {}, campos: [
          { nombre: 'seccionId', label: 'Sección', tipo: 'select', requerido: true, opciones: opt(d.secciones, 'id', sec) },
          { nombre: 'asignaturaId', label: 'Asignatura', tipo: 'select', requerido: true, opciones: opt(d.asignaturas, 'id', 'nombre') },
          { nombre: 'docenteId', label: 'Docente', tipo: 'select', requerido: true, opciones: opt(d.docentes, 'id', nombreDoc), ancho: 'full' }] });
        if (!v) return;
        if (d.cargas.some(function (x) { return (!c || x.id !== c.id) && x.seccionId === v.seccionId && x.asignaturaId === v.asignaturaId; })) { ui.toast('Esa asignatura ya tiene docente en esa sección.', 'error'); return; }
        try { await EDU.repo.guardar('cargas', Object.assign({}, c || {}, v, { anioId: sn[v.seccionId].anioId })); ui.toast('Carga guardada.', 'ok'); } catch (e) { falla(e); }
        pintar();
      }
      var card = document.createElement('section'); card.className = 'card'; card.setAttribute('aria-label', 'Cargas docentes');
      card.appendChild(cabeceraPanel('Cargas docentes', 'Docente asignado a cada asignatura de cada sección.', botonNuevo('Nueva carga', function () { form(null); })));
      var filas = d.cargas.map(function (c) { return Object.assign({}, c, { seccion: sn[c.seccionId] ? sec(sn[c.seccionId]) : '?', asignatura: an[c.asignaturaId] ? an[c.asignaturaId].nombre : '?', docente: nombreDoc(dn[c.docenteId]) }); });
      card.appendChild(ui.tabla({ caption: 'Cargas docentes del centro', filas: filas, ordenInicial: 'seccion', porPagina: 12, vacio: { titulo: 'Sin cargas', texto: 'Asigna docentes a las asignaturas de cada sección.' },
        columnas: [{ clave: 'seccion', titulo: 'Sección' }, { clave: 'asignatura', titulo: 'Asignatura' }, { clave: 'docente', titulo: 'Docente' }],
        acciones: acc('cargas', function (f) { form(d.cargas.filter(function (x) { return x.id === f.id; })[0]); }, function (f) { borrarSeguro('cargas', f, 'la carga ' + f.asignatura + ' · ' + f.seccion, [['categorias', 'cargaId', 'categorías de evaluación'], ['actividades', 'cargaId', 'actividades']], pintar); }) }).el);
      if (!puede('editar')) sinPermiso(card); p.appendChild(card);
    }
    await pintar();
  }

  /* ================= Vista ================= */
  EDU.router.register('config', {
    titulo: 'Configuración',
    render: async function (cont) {
      var cid = EDU.estado.centroActivo();
      if (!cid) {
        var centros = await EDU.repo.listar('centros', { orden: 'nombre' });
        cont.innerHTML = h(ui.cabecera({ eyebrow: 'Configuración', titulo: 'Configuración del centro', descripcion: 'Elige un centro para ver su configuración.' })) +
          '<div class="card"><h2>Centros</h2><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">' + centros.map(function (c) { return '<button type="button" class="btn sec" data-c="' + esc(c.id) + '">' + esc(c.nombre) + '</button>'; }).join('') + '</div></div>';
        cont.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (b) EDU.estado.cambiarCentro(b.dataset.c); });
        return;
      }
      var centro = await EDU.repo.obtener('centros', cid), estado = { anioId: null };
      cont.innerHTML = h(ui.cabecera({ eyebrow: 'Configuración', titulo: 'Configuración del centro', descripcion: (centro ? centro.nombre : '') + (puede('editar') ? '' : ' · solo lectura') })) + '<div id="tabs"></div>';
      var tabs = ui.tabs({ etiqueta: 'Secciones de configuración', tabs: [
        { id: 'anios', titulo: 'Años y periodos', render: function (p) { return panelAnios(p, estado); } },
        { id: 'escala', titulo: 'Escala y nota mínima', render: panelEscala },
        { id: 'cursos', titulo: 'Cursos y secciones', render: panelCursos },
        { id: 'asignaturas', titulo: 'Asignaturas', render: panelAsignaturas },
        { id: 'cargas', titulo: 'Cargas docentes', render: panelCargas }] });
      cont.querySelector('#tabs').appendChild(tabs.el);
    }
  });
})();
