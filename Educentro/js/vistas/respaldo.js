/* Vista "respaldo": exportar/importar JSON completo (EDU.repo.exportarTodo/importarTodo) con validacion de esquema y confirmacion,
   restablecer semilla (solo admin_red), tamano de almacenamiento y advertencias. Director: solo opera sobre los datos de su centro. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, ui = EDU.ui, fmt = EDU.fmt;
  var FORMATO = 'educentro-respaldo', P = 'edu:v1:col:', KEY_ULT = 'edu:ultimo-respaldo', CUOTA = 5000000, MAX_ARCHIVO = 20 * 1024 * 1024;
  var ESTADOS_ASIS = ['P', 'A', 'T', 'J'];
  // [coleccion, campoReferencia, coleccionReferida]
  var REFS = [['matriculas', 'estudianteId', 'estudiantes'], ['matriculas', 'seccionId', 'secciones'], ['secciones', 'cursoId', 'cursos'], ['cargas', 'seccionId', 'secciones'],
    ['cargas', 'asignaturaId', 'asignaturas'], ['actividades', 'cargaId', 'cargas'], ['calificaciones', 'actividadId', 'actividades'], ['calificaciones', 'estudianteId', 'estudiantes'],
    ['asistencia', 'estudianteId', 'estudiantes'], ['planes', 'cargaId', 'cargas']];

  function ses() { return EDU.estado.sesion(); }
  function kb(n) { return n < 1024 ? n + ' B' : n < 1048576 ? fmt.num(n / 1024, 1) + ' KB' : fmt.num(n / 1048576, 2) + ' MB'; }
  function esObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  /** Exporta lo que el usuario puede ver: admin_red todo; director solo su centro. */
  async function datosExportables() {
    var s = ses(), todo = await EDU.repo.exportarTodo();
    if (s.rol === 'admin_red') return todo;
    var o = {};
    Object.keys(todo).forEach(function (c) { o[c] = (todo[c] || []).filter(function (r) { return c === 'centros' ? r.id === s.centroUsuario : r.centroId === s.centroUsuario; }); });
    return o;
  }
  function descargar(obj, nombre) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  async function exportar() {
    var s = ses(), datos = await datosExportables();
    var env = { _educentro: { formato: FORMATO, version: 1, semilla: EDU.semilla.VERSION, exportadoEn: new Date().toISOString(), exportadoPor: s.usuarioId, alcance: s.rol === 'admin_red' ? 'red' : s.centroUsuario }, datos: datos };
    descargar(env, 'educentro-respaldo-' + (s.rol === 'admin_red' ? 'red' : s.centroUsuario) + '-' + fmt.hoy() + '.json');
    EDU.almacen.set(KEY_ULT, new Date().toISOString());
    return env;
  }

  /** Valida un respaldo ya parseado. -> {ok, errores[], avisos[], datos, meta}. No escribe nada. */
  function validar(obj, sesion) {
    var errores = [], avisos = [], meta = null, datos = null, COL = EDU.repoLocal.COLECCIONES;
    if (!esObj(obj)) return { ok: false, errores: ['El archivo no contiene un objeto JSON válido.'], avisos: [], datos: null, meta: null };
    if (esObj(obj._educentro) && esObj(obj.datos)) {
      meta = obj._educentro; datos = obj.datos;
      if (meta.formato !== FORMATO) errores.push('Formato desconocido («' + meta.formato + '»).');
      if (meta.semilla != null && meta.semilla !== EDU.semilla.VERSION) avisos.push('El respaldo es de la versión de datos ' + meta.semilla + ' y esta app usa ' + EDU.semilla.VERSION + '. Revise tras importar.');
    } else { datos = obj; avisos.push('Archivo sin cabecera _educentro (respaldo plano): no se pudo verificar su origen.'); }
    var presentes = Object.keys(datos).filter(function (k) { return COL.indexOf(k) !== -1; });
    Object.keys(datos).filter(function (k) { return COL.indexOf(k) === -1; }).forEach(function (k) { avisos.push('Colección desconocida «' + k + '»: se ignorará.'); });
    if (!presentes.length) errores.push('No contiene ninguna colección reconocida.');
    var limpio = {};
    presentes.forEach(function (c) {
      var arr = datos[c];
      if (!Array.isArray(arr)) { errores.push('«' + c + '» debe ser una lista.'); return; }
      var vistos = {}, malos = 0;
      arr.forEach(function (r, i) {
        var et = c + '[' + i + ']';
        if (!esObj(r)) { errores.push(et + ': no es un objeto.'); return; }
        if (typeof r.id !== 'string' || !r.id) { errores.push(et + ': falta id (texto).'); return; }
        if (vistos[r.id]) { errores.push(et + ': id duplicado «' + r.id + '».'); return; }
        vistos[r.id] = 1;
        if (c !== 'centros' && c !== 'usuarios' && typeof r.centroId !== 'string') { malos++; if (malos <= 3) errores.push(et + ': falta centroId.'); }
        if (c === 'usuarios' && r.centroId !== null && typeof r.centroId !== 'string') errores.push(et + ': centroId inválido.');
        if (c === 'asistencia' && ESTADOS_ASIS.indexOf(r.estado) === -1) errores.push(et + ': estado de asistencia inválido («' + r.estado + '»).');
        if (c === 'calificaciones' && r.puntos != null && (typeof r.puntos !== 'number' || !isFinite(r.puntos) || r.puntos < 0)) errores.push(et + ': puntos inválidos.');
        if (c === 'periodos' && typeof r.peso !== 'number') errores.push(et + ': peso debe ser numérico.');
        if (sesion && sesion.rol !== 'admin_red') {
          var propio = c === 'centros' ? r.id === sesion.centroUsuario : (c === 'usuarios' ? r.centroId === sesion.centroUsuario : r.centroId === sesion.centroUsuario);
          if (!propio) errores.push(et + ': pertenece a otro centro; su rol solo puede importar datos de su centro.');
        }
      });
      if (malos > 3) errores.push('«' + c + '»: ' + malos + ' registros sin centroId.');
      limpio[c] = arr;
    });
    var ids = {}; presentes.forEach(function (c) { ids[c] = {}; (limpio[c] || []).forEach(function (r) { if (r && r.id) ids[c][r.id] = 1; }); });
    REFS.forEach(function (rf) {
      if (!limpio[rf[0]] || !limpio[rf[2]]) return;
      var n = limpio[rf[0]].filter(function (r) { return r && r[rf[1]] && !ids[rf[2]][r[rf[1]]]; }).length;
      if (n) avisos.push(n + ' registro(s) de «' + rf[0] + '» apuntan a «' + rf[2] + '» inexistentes (' + rf[1] + ').');
    });
    if (errores.length > 12) { var extra = errores.length - 12; errores = errores.slice(0, 12); errores.push('… y ' + extra + ' error(es) más.'); }
    return { ok: !errores.length, errores: errores, avisos: avisos, datos: limpio, meta: meta };
  }

  /** Construye el estado completo a importar: lo que no viene en el archivo se conserva; director solo reemplaza su centro. */
  async function combinar(validado, sesion) {
    var actual = await EDU.repo.exportarTodo(), full = {};
    EDU.repoLocal.COLECCIONES.forEach(function (c) {
      var nuevo = validado.datos[c];
      if (!nuevo) { full[c] = actual[c] || []; return; }
      if (sesion.rol === 'admin_red') { full[c] = nuevo; return; }
      var ajenos = (actual[c] || []).filter(function (r) { return (c === 'centros' ? r.id : r.centroId) !== sesion.centroUsuario; });
      full[c] = ajenos.concat(nuevo);
    });
    return { full: full, actual: actual };
  }

  function almacenamiento() {
    var filas = [], total = 0;
    EDU.repoLocal.COLECCIONES.forEach(function (c) { var v = EDU.almacen.get(P + c); var n = v ? v.length : 0; total += n; filas.push({ coleccion: c, n: n }); });
    var otros = 0; EDU.almacen.keys('edu:').forEach(function (k) { if (k.indexOf(P) !== 0) { var v = EDU.almacen.get(k); otros += (k.length + (v ? v.length : 0)); } });
    return { filas: filas, total: total + otros, colecciones: total };
  }

  EDU.router.register('respaldo', {
    titulo: 'Respaldo',
    render: async function (cont) {
      var s = ses(), esAdmin = s.rol === 'admin_red', puedeImp = EDU.permisos.puede(s.rol, 'respaldo', 'importar'), puedeExp = EDU.permisos.puede(s.rol, 'respaldo', 'exportar');
      var datos = await datosExportables(), st = almacenamiento(), pct = st.total / CUOTA * 100, ult = EDU.almacen.get(KEY_ULT);
      var advertencias = [];
      if (EDU.almacen.modo() === 'memoria') advertencias.push(['red', 'Sin almacenamiento persistente', 'El navegador bloquea localStorage: los datos se pierden al cerrar la pestaña. Exporte un respaldo.']);
      if (EDU.repoLocal.advertencia) advertencias.push(['red', 'Escritura incompleta', EDU.repoLocal.advertencia]);
      if (pct > 85) advertencias.push(['red', 'Almacenamiento casi lleno', 'Se usa ' + fmt.pct(pct, 0) + ' de la cuota estimada (~5 MB). Exporte y depure datos.']);
      else if (pct > 60) advertencias.push(['', 'Almacenamiento alto', 'Se usa ' + fmt.pct(pct, 0) + ' de la cuota estimada (~5 MB).']);
      if (!ult) advertencias.push(['', 'Sin respaldos recientes', 'Aún no ha exportado un respaldo desde este navegador.']);
      advertencias.push(['', 'Datos personales', 'El archivo contiene datos de estudiantes y tutores. Guárdelo en un lugar seguro y no lo comparta por canales abiertos.']);

      cont.innerHTML = ui.cabecera({ eyebrow: 'Datos', titulo: 'Respaldo', descripcion: esAdmin ? 'Respaldo de toda la red.' : 'Respaldo de los datos de su centro.' }).toString() +
        ui.kpis([{ etiqueta: 'Almacenamiento usado', valor: kb(st.total * 2), detalle: fmt.pct(pct, 1) + ' de ~5 MB (estimado)', tono: pct > 85 ? 'bad' : 'ok' },
          { etiqueta: 'Registros', valor: String(Object.keys(datos).reduce(function (a, c) { return a + datos[c].length; }, 0)), detalle: esAdmin ? 'en toda la red' : 'de su centro', tono: 'neu' },
          { etiqueta: 'Último respaldo', valor: ult ? fmt.fecha(ult.slice(0, 10)) : 'Nunca', detalle: 'desde este navegador', tono: ult ? 'ok' : 'bad' },
          { etiqueta: 'Modo de almacenamiento', valor: EDU.almacen.modo() === 'local' ? 'localStorage' : 'Memoria', tono: EDU.almacen.modo() === 'local' ? 'ok' : 'bad' }]).toString() +
        '<div aria-label="Advertencias">' + advertencias.map(function (a) { return '<div class="alert ' + a[0] + '"><div><strong>' + esc(a[1]) + '</strong><small>' + esc(a[2]) + '</small></div></div>'; }).join('') + '</div>' +
        '<div class="grid two" style="margin-top:16px"><section class="card" aria-labelledby="rbE"><h2 id="rbE">Exportar</h2><p class="note">Descarga un archivo JSON con ' + (esAdmin ? 'todas las colecciones.' : 'los datos de su centro.') + '</p>' +
        '<div class="form-actions" style="justify-content:flex-start"><button type="button" class="btn amb" id="rbExp"' + (puedeExp ? '' : ' disabled') + '>Descargar respaldo (.json)</button></div></section>' +
        '<section class="card" aria-labelledby="rbI"><h2 id="rbI">Importar</h2><p class="note">Se valida el esquema y se muestra un resumen antes de reemplazar datos. ' + (esAdmin ? '' : 'Solo se aceptan datos de su centro.') + '</p>' +
        (puedeImp ? '<label class="fld">Archivo de respaldo<input type="file" id="rbFile" accept=".json,application/json"></label><div id="rbRes" aria-live="polite"></div>' : '<p class="note">Su rol no puede importar.</p>') + '</section></div>' +
        '<section class="card" style="margin-top:16px" aria-labelledby="rbT"><h2 id="rbT">Detalle por colección</h2><div id="rbTab"></div></section>' +
        (esAdmin ? '<section class="card" style="margin-top:16px" aria-labelledby="rbR"><h2 id="rbR">Restablecer datos de ejemplo</h2><p class="note">Borra TODOS los datos y vuelve a la semilla de demostración. Cierra la sesión. Exporte antes un respaldo.</p><div class="form-actions" style="justify-content:flex-start"><button type="button" class="btn dng" id="rbReset">Restablecer semilla</button></div></section>' : '');
      var $ = function (id) { return cont.querySelector('#' + id); };
      var tamano = {}; st.filas.forEach(function (f) { tamano[f.coleccion] = f.n * 2; });
      $('rbTab').appendChild(ui.tabla({ caption: 'Colecciones respaldables', buscar: false, porPagina: false, ordenInicial: 'coleccion',
        filas: Object.keys(datos).map(function (c) { return { coleccion: c, registros: datos[c].length, bytes: esAdmin ? tamano[c] || 0 : JSON.stringify(datos[c]).length * 2 }; }),
        columnas: [{ clave: 'coleccion', titulo: 'Colección' }, { clave: 'registros', titulo: 'Registros', align: 'r' }, { clave: 'bytes', titulo: 'Tamaño aprox.', align: 'r', formato: function (v) { return kb(v); } }] }).el);

      $('rbExp').addEventListener('click', async function () { try { await exportar(); ui.toast('Respaldo descargado', 'ok'); EDU.router.recargar(); } catch (e) { ui.toast(e.message, 'error'); } });

      if (puedeImp) $('rbFile').addEventListener('change', async function (ev) {
        var f = ev.target.files[0], res = $('rbRes'); res.innerHTML = '';
        if (!f) return;
        if (f.size > MAX_ARCHIVO) { res.innerHTML = '<div class="form-error" role="alert">El archivo supera 20 MB.</div>'; return; }
        var obj;
        try { obj = JSON.parse(await f.text()); } catch (e) { res.innerHTML = '<div class="form-error" role="alert">El archivo no es JSON válido.</div>'; return; }
        var v = validar(obj, s);
        if (!v.ok) { res.innerHTML = '<div class="form-error" role="alert"><strong>No se puede importar:</strong><ul>' + v.errores.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>'; return; }
        var cmb = await combinar(v, s), filas = Object.keys(v.datos).map(function (c) { return '<tr><th scope="row" style="text-align:left">' + esc(c) + '</th><td class="r">' + esc((datos[c] || []).length) + '</td><td class="r">' + esc(v.datos[c].length) + '</td></tr>'; }).join('');
        res.innerHTML = '<div class="alert ok"><div><strong>Archivo válido</strong><small>' + (v.meta ? 'Exportado el ' + esc(fmt.fechaHora(v.meta.exportadoEn)) + '. ' : '') + 'Revise el resumen y confirme.</small></div></div>' +
          v.avisos.map(function (a) { return '<div class="alert"><div><strong>Aviso</strong><small>' + esc(a) + '</small></div></div>'; }).join('') +
          '<div class="tw"><table class="t"><caption class="sr-only">Resumen de importación</caption><thead><tr><th scope="col">Colección</th><th scope="col" class="r">Actual</th><th scope="col" class="r">Archivo</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
          '<label class="opt" style="margin-top:10px"><input type="checkbox" id="rbPrev" checked> Descargar un respaldo del estado actual antes de importar</label>' +
          '<div class="form-actions"><button type="button" class="btn dng" id="rbConf">Importar y reemplazar</button></div>';
        $('rbConf').addEventListener('click', async function () {
          var ok = await ui.confirmar({ titulo: 'Importar respaldo', mensaje: 'Se reemplazarán las colecciones del archivo (' + Object.keys(v.datos).length + ') ' + (esAdmin ? 'en toda la red' : 'de su centro') + '. Esta acción no se puede deshacer.', textoOk: 'Importar', peligro: true });
          if (!ok) return;
          try {
            if ($('rbPrev').checked) await exportar();
            await EDU.repo.importarTodo(cmb.full);
            var u = await EDU.repo.obtener('usuarios', s.usuarioId).catch(function () { return null; });
            if (!u) { EDU.estado.cerrarSesion(); ui.toast('Importado. Su usuario ya no existe en los datos; ingrese de nuevo.', 'warn'); return; }
            ui.toast('Respaldo importado', 'ok'); EDU.router.recargar();
          } catch (e) { ui.toast(e.message, 'error'); }
        });
      });
      var rs = $('rbReset');
      if (rs) rs.addEventListener('click', async function () {
        if (await ui.confirmar({ titulo: 'Restablecer semilla', mensaje: 'Se borrarán todos los datos y se cerrará la sesión.', textoOk: 'Restablecer', peligro: true })) {
          await EDU.semilla.restablecer(); EDU.estado.cerrarSesion(); ui.toast('Datos de ejemplo restablecidos', 'ok');
        }
      });
    }
  });
  EDU.respaldo = { validar: validar };
})();
