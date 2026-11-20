/* Vista "centros": red de centros (solo admin_red). Lista/tarjetas, alta/edicion/baja, detalle con KPIs y reportes consolidados. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, raw = EDU.raw;
  var NIVELES = ['Inicial', 'Primario', 'Secundario', 'Primario y Secundario'];
  var DATOS = ['anios', 'periodos', 'escalas', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores', 'matriculas', 'categorias', 'actividades', 'calificaciones', 'notasCompetencia', 'asistencia'];

  function h(x) { return x instanceof EDU.Safe ? x.s : String(x == null ? '' : x); }
  function puede(a) { return EDU.permisos.puede(EDU.estado.rol(), 'centros', a); }
  function media(a) { var v = a.filter(function (x) { return x != null; }); return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null; }

  /** Metricas de un centro (lee solo ese centro; admin_red puede). */
  async function metricas(centro) {
    var o = { centroId: centro.id }, d = await EDU.consultas.cargar(DATOS, o);
    var resumen = EDU.consultas.resumenNotas(d);
    var con = resumen.filter(function (f) { return f.final != null; });
    var rg = {}; con.forEach(function (f) { if (!f.aprobado) rg[f.estudianteId] = 1; });
    var asis = d.asistencia.length ? d.asistencia.filter(function (a) { return a.estado !== 'A'; }).length / d.asistencia.length * 100 : null;
    var esc_ = EDU.consultas.escalaDe(d.escalas, centro.id);
    return { centro: centro, d: d, resumen: resumen, escala: esc_,
      estudiantes: d.matriculas.filter(function (m) { return m.estado === 'activa'; }).length, docentes: d.docentes.length, secciones: d.secciones.length, cursos: d.cursos.length,
      promedio: media(con.map(function (f) { return f.pct; })), aprobacion: con.length ? con.filter(function (f) { return f.aprobado; }).length / con.length * 100 : null,
      riesgo: Object.keys(rg).length, asistencia: asis, vacio: !DATOS.some(function (c) { return c !== 'anios' && c !== 'periodos' && c !== 'escalas' && c !== 'asignaturas' && d[c].length; }) };
  }

  var CAMPOS = function (centros, actual) {
    return [
      { nombre: 'nombre', label: 'Nombre del centro', requerido: true, minLen: 3, maxLen: 120, ancho: 'full' },
      { nombre: 'codigo', label: 'Código del centro', requerido: true, patron: /^\d{2}-\d{4}$/, mensajePatron: 'Usa el formato 00-0000 (regional-centro).', ayuda: 'Formato MINERD, ej. 08-0142',
        custom: function (v) { return centros.some(function (c) { return c.codigo === v && (!actual || c.id !== actual.id); }) ? 'Ya existe un centro con ese código.' : null; } },
      { nombre: 'nivel', label: 'Nivel', tipo: 'select', requerido: true, opciones: NIVELES },
      { nombre: 'ciudad', label: 'Ciudad / municipio', requerido: true, maxLen: 80 },
      { nombre: 'regional', label: 'Regional', maxLen: 60, placeholder: '08 Santiago' },
      { nombre: 'distrito', label: 'Distrito educativo', patron: /^(\d{2}-\d{2})?$/, mensajePatron: 'Usa el formato 00-00.', placeholder: '08-01' },
      { nombre: 'director', label: 'Director/a', maxLen: 80 },
      { nombre: 'telefono', label: 'Teléfono', patron: /^[0-9+\-\s()]{7,20}$/, mensajePatron: 'Teléfono no válido.' },
      { nombre: 'color', label: 'Color institucional', requerido: true, patron: /^#[0-9a-fA-F]{6}$/, mensajePatron: 'Usa un color hexadecimal, ej. #14315c.', ayuda: 'Hexadecimal #RRGGBB' },
      { nombre: 'activo', label: 'Centro activo', tipo: 'checkbox' }
    ];
  };

  async function editar(centro) {
    var centros = await EDU.repo.listar('centros');
    var v = await ui.formularioModal({ titulo: centro ? 'Editar centro' : 'Nuevo centro', textoEnviar: centro ? 'Guardar cambios' : 'Crear centro', tamano: 'lg',
      campos: CAMPOS(centros, centro), valores: centro || { color: '#14315c', nivel: 'Primario', activo: true } });
    if (!v) return null;
    var reg = Object.assign({}, centro || {}, v, { pais: (centro && centro.pais) || 'República Dominicana' });
    var g = await EDU.repo.guardar('centros', reg);
    if (!centro && !EDU.repo.negocio()) { // escala por defecto para que el centro sea operativo (modo API: la crea el servidor en la misma transacción)
      var e = EDU.escala.porDefecto();
      await EDU.repo.guardar('escalas', Object.assign({ centroId: g.id, activa: true }, e));
    }
    ui.toast(centro ? 'Centro actualizado.' : 'Centro creado. Configura su año lectivo en Configuración.', 'ok');
    return g;
  }

  async function eliminar(centro) {
    var m = await metricas(centro);
    if (!m.vacio) { ui.toast('No se puede eliminar «' + centro.nombre + '»: tiene estudiantes, docentes, cursos u otros datos. Desactívalo en su lugar.', 'error', 7000); return false; }
    var ok = await ui.confirmar({ titulo: 'Eliminar centro', mensaje: '¿Eliminar «' + centro.nombre + '» y su configuración básica (años, periodos, escala, asignaturas)? Esta acción no se puede deshacer.', textoOk: 'Eliminar', peligro: true });
    if (!ok) return false;
    if (EDU.repo.negocio()) { try { await EDU.repo.borrar('centros', centro.id); } catch (e) { ui.toast(e.message || 'No se pudo eliminar el centro.', 'error', 7000); return false; } } // el servidor verifica que no tenga datos y limpia su configuración básica
    else for (var i = 0; i < ['anios', 'periodos', 'escalas', 'asignaturas'].length; i++) {
      var col = ['anios', 'periodos', 'escalas', 'asignaturas'][i];
      for (var k = 0; k < m.d[col].length; k++) await EDU.repo.borrar(col, m.d[col][k].id);
    }
    if (!EDU.repo.negocio()) await EDU.repo.borrar('centros', centro.id);
    if (EDU.estado.centroActivo() === centro.id) EDU.estado.cambiarCentro(null);
    ui.toast('Centro eliminado.', 'ok');
    return true;
  }

  function csv(filas, cols) {
    function c(v) { v = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
    return '﻿' + [cols.map(function (x) { return c(x.titulo); }).join(',')].concat(filas.map(function (f) { return cols.map(function (x) { return c(x.csv ? x.csv(f) : f[x.clave]); }).join(','); })).join('\r\n');
  }
  function descargar(nombre, texto) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' })); a.download = nombre;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- lista ---------- */
  EDU.router.register('centros', {
    titulo: 'Centros educativos',
    render: async function (cont) {
      var ms = [], tabs, vista = 'tarjetas';
      async function cargar() {
        var centros = await EDU.repo.listar('centros', { orden: 'nombre' });
        ms = await Promise.all(centros.map(metricas));
      }
      function cabecera() {
        return ui.cabecera({ eyebrow: 'Red educativa', titulo: 'Centros educativos', descripcion: ms.length + ' centros en la red.',
          acciones: puede('crear') ? raw('<button type="button" class="btn amb" id="nuevo">Nuevo centro</button>') : '' });
      }
      async function pintar() {
        await cargar();
        cont.innerHTML = h(cabecera()) + '<div id="live" class="sr-only" aria-live="polite"></div><div id="tabs"></div>';
        var nb = cont.querySelector('#nuevo'); if (nb) nb.addEventListener('click', async function () { try { if (await editar(null)) pintar(); } catch (e) { ui.toast(e.message, 'error'); } });
        tabs = ui.tabs({ etiqueta: 'Vistas de la red', activa: vista, alCambiar: function (id) { vista = id; }, siempre: true, tabs: [
          { id: 'tarjetas', titulo: 'Centros', render: tarjetas }, { id: 'consolidado', titulo: 'Reporte consolidado', render: consolidado }] });
        cont.querySelector('#tabs').appendChild(tabs.el);
      }
      function acciones(c) {
        return (puede('editar') ? '<button type="button" class="btn sec sm" data-e="' + esc(c.id) + '">Editar</button> ' : '') +
          (puede('borrar') ? '<button type="button" class="btn dng sm" data-b="' + esc(c.id) + '">Eliminar</button>' : '');
      }
      function tarjetas(p) {
        if (!ms.length) { p.innerHTML = h(ui.vacio({ titulo: 'Aún no hay centros', texto: 'Crea el primero con «Nuevo centro».' })); return; }
        p.innerHTML = '<div class="grid cols-auto">' + ms.map(function (m) {
          var c = m.centro;
          return '<article class="card center" style="cursor:default"><div class="ban" style="background:' + esc(c.color || '#14315c') + '">' + esc(c.codigo) + '</div><h3><a href="#/centros/' + esc(c.id) + '">' + esc(c.nombre) + '</a></h3>' +
            '<p>' + esc(c.ciudad) + ' · ' + esc(c.nivel) + (c.activo === false ? ' · <strong>Inactivo</strong>' : '') + '</p>' +
            '<div class="chips"><span class="chip">' + esc(m.estudiantes) + ' estudiantes</span><span class="chip">' + esc(m.docentes) + ' docentes</span><span class="chip amb">Prom. ' + esc(fmt.num(m.promedio, 1)) + '</span></div>' +
            '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn sm" href="#/centros/' + esc(c.id) + '">Ver detalle</a>' + acciones(c) + '</div></article>';
        }).join('') + '</div>';
        p.firstChild.addEventListener('click', async function (e) {
          var b = e.target.closest('button[data-e],button[data-b]'); if (!b) return;
          var c = ms.filter(function (m) { return m.centro.id === (b.dataset.e || b.dataset.b); })[0].centro;
          try { if (b.dataset.e ? await editar(c) : await eliminar(c)) pintar(); } catch (er) { ui.toast(er.message, 'error'); }
        });
      }
      function consolidado(p) {
        var filas = ms.map(function (m) { return { centro: m.centro.nombre, codigo: m.centro.codigo, estudiantes: m.estudiantes, docentes: m.docentes, secciones: m.secciones, promedio: m.promedio, aprobacion: m.aprobacion, riesgo: m.riesgo, asistencia: m.asistencia }; });
        var tot = { est: filas.reduce(function (s, f) { return s + f.estudiantes; }, 0), doc: filas.reduce(function (s, f) { return s + f.docentes; }, 0) };
        var cols = [{ clave: 'centro', titulo: 'Centro' }, { clave: 'codigo', titulo: 'Código' }, { clave: 'estudiantes', titulo: 'Estudiantes', align: 'c' }, { clave: 'docentes', titulo: 'Docentes', align: 'c' }, { clave: 'secciones', titulo: 'Secciones', align: 'c' },
          { clave: 'promedio', titulo: 'Promedio (0–100)', align: 'c', formato: function (v) { return fmt.num(v, 1); }, csv: function (f) { return f.promedio == null ? '' : fmt.num(f.promedio, 1); } },
          { clave: 'aprobacion', titulo: 'Aprobación', align: 'c', formato: function (v) { return fmt.pct(v); }, csv: function (f) { return f.aprobacion == null ? '' : fmt.num(f.aprobacion, 1) + '%'; } },
          { clave: 'riesgo', titulo: 'Estudiantes en riesgo', align: 'c' }, { clave: 'asistencia', titulo: 'Asistencia', align: 'c', formato: function (v) { return fmt.pct(v, 1); }, csv: function (f) { return f.asistencia == null ? '' : fmt.num(f.asistencia, 1) + '%'; } }];
        p.innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h2>Reporte consolidado de la red</h2><button type="button" class="btn sec sm" id="csv">Exportar CSV</button></div>' +
          '<p class="note" style="margin:6px 0 12px">Promedios normalizados a 0–100 para comparar centros con escalas distintas. Total: ' + esc(tot.est) + ' estudiantes y ' + esc(tot.doc) + ' docentes.</p><div id="tc"></div></div>';
        p.querySelector('#tc').appendChild(ui.tabla({ caption: 'Indicadores por centro', columnas: cols, filas: filas, buscar: false, porPagina: false, ordenInicial: 'centro' }).el);
        p.querySelector('#csv').addEventListener('click', function () { descargar('reporte-red-' + fmt.hoy() + '.csv', csv(filas, cols)); ui.toast('Reporte exportado.', 'ok'); });
      }
      await pintar();
    }
  });

  /* ---------- detalle ---------- */
  EDU.router.register('centros/:id', {
    titulo: 'Detalle del centro',
    render: async function (cont, params) {
      var c = await EDU.repo.obtener('centros', params.id);
      if (!c) { cont.innerHTML = h(ui.cabecera({ eyebrow: 'Centros', titulo: 'Centro no encontrado' })) + '<div class="card">' + h(ui.vacio({ titulo: 'No existe este centro', accion: { texto: 'Volver a la red', href: '#/centros' } })) + '</div>'; return; }
      var m = await metricas(c), e = m.escala, d = m.d;
      var cursoDe = {}; d.cursos.forEach(function (x) { cursoDe[x.id] = x; });
      cont.innerHTML = h(ui.cabecera({ eyebrow: 'Centro · ' + c.codigo, titulo: c.nombre,
        descripcion: [c.ciudad, c.regional, c.distrito && 'Distrito ' + c.distrito, c.nivel, c.director && 'Director/a: ' + c.director, c.telefono].filter(Boolean).join(' · '),
        acciones: raw('<a class="btn sec" href="#/centros">Volver a la red</a> <button type="button" class="btn sec" id="abrir">Abrir este centro</button>' + (puede('editar') ? ' <button type="button" class="btn amb" id="ed">Editar</button>' : '') + (puede('borrar') ? ' <button type="button" class="btn dng" id="del">Eliminar</button>' : '')) })) +
        (c.activo === false ? '<div class="alert"><div><strong>Centro inactivo</strong><small>No aparece como operativo para la red.</small></div></div>' : '') +
        h(ui.kpis([{ etiqueta: 'Estudiantes matriculados', valor: m.estudiantes }, { etiqueta: 'Docentes', valor: m.docentes }, { etiqueta: 'Secciones', valor: m.secciones, detalle: m.cursos + ' cursos', tono: 'neu' },
          { etiqueta: 'Promedio general', valor: fmt.nota(m.promedio == null ? null : EDU.escala.desdePorcentaje(m.promedio, e), e), detalle: 'Escala ' + e.min + '–' + e.max + ' · mín. ' + e.notaMinAprobar, tono: 'neu' },
          { etiqueta: 'Aprobación', valor: fmt.pct(m.aprobacion) }, { etiqueta: 'En riesgo', valor: m.riesgo, detalle: 'Con alguna asignatura reprobada', tono: m.riesgo ? 'bad' : 'ok' },
          { etiqueta: 'Asistencia', valor: fmt.pct(m.asistencia, 1), tono: 'neu' }])) +
        '<div class="card"><h2 style="margin-bottom:10px">Secciones</h2><div id="ts"></div></div>';
      var filas = d.secciones.map(function (s) {
        var f = m.resumen.filter(function (x) { return x.seccionId === s.id && x.final != null; }), cu = cursoDe[s.cursoId];
        return { seccion: (cu ? cu.nombre : '') + ' ' + s.nombre, est: d.matriculas.filter(function (x) { return x.seccionId === s.id && x.estado === 'activa'; }).length, prom: media(f.map(function (x) { return x.pct; })), aprob: f.length ? f.filter(function (x) { return x.aprobado; }).length / f.length * 100 : null };
      });
      cont.querySelector('#ts').appendChild(ui.tabla({ caption: 'Resumen por sección', buscar: false, porPagina: false, ordenInicial: 'seccion', filas: filas, columnas: [{ clave: 'seccion', titulo: 'Sección' }, { clave: 'est', titulo: 'Estudiantes', align: 'c' },
        { clave: 'prom', titulo: 'Promedio (0–100)', align: 'c', formato: function (v) { return fmt.num(v, 1); } }, { clave: 'aprob', titulo: 'Aprobación', align: 'c', formato: function (v) { return fmt.pct(v); } }] }).el);
      cont.querySelector('#abrir').addEventListener('click', function () { EDU.estado.cambiarCentro(c.id); EDU.router.ir('dashboard'); });
      var ed = cont.querySelector('#ed'); if (ed) ed.addEventListener('click', async function () { try { if (await editar(c)) EDU.router.recargar(); } catch (er) { ui.toast(er.message, 'error'); } });
      var del = cont.querySelector('#del'); if (del) del.addEventListener('click', async function () { try { if (await eliminar(c)) EDU.router.ir('centros'); } catch (er) { ui.toast(er.message, 'error'); } });
    }
  });
})();
