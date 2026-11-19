/* Vista "reportes": aprobados/reprobados por seccion, promedio por asignatura, ranking, riesgo de reprobacion y consolidado de red.
   Calcula con EDU.consultas.resumenNotas (EDU.calculo, sin redondear); exporta CSV. admin_red ve todos los centros ("Todos"). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, calc = EDU.calculo;
  var COLS = ['centros', 'cursos', 'secciones', 'asignaturas', 'estudiantes', 'matriculas', 'escalas', 'cargas', 'categorias', 'actividades', 'calificaciones', 'periodos'];
  var MARGEN = 5; // puntos porcentuales por encima del minimo para marcar "al limite"

  function cmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function por(l, k) { return EDU.consultas.agrupar(l, k); }
  function media(a) { return calc.promedioGeneral(a); }

  function celdaCsv(v) {
    if (v == null) return '';
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s; // evita inyeccion de formulas en hojas de calculo
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function aCsv(rep) {
    var l = [rep.cols.map(function (c) { return celdaCsv(c.titulo); }).join(',')];
    rep.filas.forEach(function (f) {
      l.push(rep.cols.map(function (c) { var v = c.valor ? c.valor(f) : f[c.clave]; return celdaCsv(c.formato ? c.formato(v, f) : v); }).join(','));
    });
    return '﻿' + l.join('\r\n');
  }
  function descargar(nombre, texto) {
    var blob = new Blob([texto], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  EDU.router.register('reportes', {
    titulo: 'Reportes',
    render: async function (cont) {
      if (!document.getElementById('rp-css')) { var st = document.createElement('style'); st.id = 'rp-css'; st.textContent = '#rp-cuerpo .tw{position:relative;contain:inline-size}#rp-bar{min-width:0;max-width:100%;width:100%}#rp-s{width:100%;min-width:0;max-width:100%}'; document.head.appendChild(st); }
      var ses = EDU.estado.sesion(), rol = ses.rol, d = await EDU.consultas.cargar(COLS);
      var puedeExportar = EDU.permisos.puede(rol, 'reportes', 'exportar');
      var resumen = EDU.consultas.resumenNotas(d);
      var red = rol === 'admin_red' && !EDU.estado.centroActivo();
      var S = { seccionId: '', tab: 'secciones' };

      cont.innerHTML = ui.cabecera({ eyebrow: red ? 'Red educativa' : 'Análisis académico', titulo: 'Reportes',
        descripcion: red ? 'Consolidado de todos los centros de la red (promedios normalizados 0–100).' : 'Rendimiento del centro calculado con las calificaciones registradas.' }).toString() +
        '<div class="card"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end"><label id="rp-bar" style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:500;max-width:420px">Sección<select id="rp-s"></select></label></div></div><div id="rp-cuerpo" style="margin-top:16px"></div>';
      var elS = cont.querySelector('#rp-s'), elC = cont.querySelector('#rp-cuerpo');

      function secEt(s) {
        var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0], ce = red ? d.centros.filter(function (x) { return x.id === s.centroId; })[0] : null;
        return (ce ? ce.codigo + ' · ' : '') + (c ? c.nombre : '') + ' · Sección ' + s.nombre;
      }
      var secs = d.secciones.slice().sort(function (a, b) { return cmp(secEt(a), secEt(b)); });
      elS.innerHTML = ui.opciones([{ valor: '', texto: 'Todas las secciones' }].concat(secs.map(function (s) { return { valor: s.id, texto: secEt(s) }; })), '').toString();
      var secMap = {}; d.secciones.forEach(function (s) { secMap[s.id] = s; });
      var estMap = {}; d.estudiantes.forEach(function (e) { estMap[e.id] = e; });
      var cenMap = {}; d.centros.forEach(function (c) { cenMap[c.id] = c; });
      function asigNombre(id) { var a = d.asignaturas.filter(function (x) { return x.id === id; })[0]; return a ? a.nombre : id; }

      /* ---------- agregados por estudiante ---------- */
      function estudiantes(filas) {
        var g = por(filas, 'estudianteId');
        return Object.keys(g).map(function (id) {
          var fl = g[id], ev = fl.filter(function (f) { return f.final != null; }), e = estMap[id], esc_ = fl[0].escala, minPct = EDU.escala.minAprobarPct(esc_);
          var rep = ev.filter(function (f) { return !f.aprobado; }), lim = ev.filter(function (f) { return f.aprobado && f.pct < minPct + MARGEN; });
          var prom = media(ev.map(function (f) { return f.pct; }));
          return { id: id, est: e, nombre: e ? fmt.nombreCompleto(e) : id, seccionId: fl[0].seccionId, centroId: fl[0].centroId, esc: esc_, minPct: minPct, filas: fl, ev: ev, rep: rep, lim: lim, prom: prom,
            estado: !ev.length ? 'Sin notas' : rep.length ? 'Reprobado' : 'Aprobado' };
        });
      }
      function mostrar(pct, escCentro) { // un solo centro: en su escala; red: 0-100 normalizado
        if (pct == null) return '—';
        return escCentro ? fmt.nota(EDU.escala.desdePorcentaje(pct, escCentro), escCentro) : fmt.nota(pct, { decimales: 1 });
      }

      /* ---------- reportes ---------- */
      function construir(filas) {
        var ests = estudiantes(filas), centros = {}; filas.forEach(function (f) { centros[f.centroId] = f.escala; });
        var unico = Object.keys(centros).length === 1 ? centros[Object.keys(centros)[0]] : null;
        function m(p) { return mostrar(p, unico); }
        var colCentro = red ? [{ clave: 'centro', titulo: 'Centro' }] : [];
        var R = {};

        // 1) Aprobados / reprobados por seccion
        var gs = por(ests, 'seccionId');
        R.secciones = { cols: colCentro.concat([{ clave: 'seccion', titulo: 'Sección' }, { clave: 'n', titulo: 'Estudiantes', align: 'r' }, { clave: 'apr', titulo: 'Aprobados', align: 'r' },
          { clave: 'rep', titulo: 'Con reprobadas', align: 'r' }, { clave: 'pctApr', titulo: '% aprobados', align: 'r', formato: function (v) { return fmt.pct(v, 1); } },
          { clave: 'prom', titulo: 'Promedio', align: 'r', formato: function (v) { return m(v); } }]),
          filas: Object.keys(gs).map(function (id) {
            var l = gs[id], s = secMap[id], ev = l.filter(function (x) { return x.estado !== 'Sin notas'; }), a = ev.filter(function (x) { return x.estado === 'Aprobado'; }).length;
            return { centro: s && cenMap[s.centroId] ? cenMap[s.centroId].nombre : '', seccion: s ? secEt(s).replace(/^[^·]+· /, red ? '' : '$&') : id, n: l.length, apr: a, rep: ev.length - a, pctApr: ev.length ? a / ev.length * 100 : null, prom: media(l.map(function (x) { return x.prom; })) };
          }).sort(function (a, b) { return cmp(a.centro + a.seccion, b.centro + b.seccion); }) };

        // 2) Promedio por asignatura
        var ga = {}; filas.forEach(function (f) { if (f.final == null) return; var k = asigNombre(f.asignaturaId); (ga[k] = ga[k] || []).push(f); });
        R.asignaturas = { cols: [{ clave: 'asig', titulo: 'Asignatura' }, { clave: 'n', titulo: 'Evaluaciones', align: 'r' }, { clave: 'prom', titulo: 'Promedio', align: 'r', formato: function (v) { return m(v); } },
          { clave: 'pctApr', titulo: '% aprobación', align: 'r', formato: function (v) { return fmt.pct(v, 1); } }, { clave: 'rep', titulo: 'Reprobados', align: 'r' }],
          filas: Object.keys(ga).map(function (k) { var l = ga[k], a = l.filter(function (f) { return f.aprobado; }).length; return { asig: k, n: l.length, prom: media(l.map(function (f) { return f.pct; })), pctApr: a / l.length * 100, rep: l.length - a }; })
            .sort(function (a, b) { return b.prom - a.prom; }) };

        // 3) Ranking
        var rk = ests.filter(function (x) { return x.prom != null; }).sort(function (a, b) { return b.prom - a.prom || cmp(a.nombre, b.nombre); });
        R.ranking = { cols: [{ clave: 'puesto', titulo: 'Puesto', align: 'r' }, { clave: 'nombre', titulo: 'Estudiante' }].concat(colCentro).concat([{ clave: 'seccion', titulo: 'Sección' },
          { clave: 'prom', titulo: 'Promedio general', align: 'r', formato: function (v) { return m(v); } }, { clave: 'nRep', titulo: 'Asig. reprobadas', align: 'r' }, { clave: 'estado', titulo: 'Estado' }]),
          filas: rk.map(function (x, i) { var s = secMap[x.seccionId]; return { puesto: i + 1, nombre: x.nombre, centro: cenMap[x.centroId] ? cenMap[x.centroId].nombre : '', seccion: s ? secEt(s) : '', prom: x.prom, nRep: x.rep.length, estado: x.estado }; }) };

        // 4) Riesgo de reprobacion
        function nivel(x) { return x.rep.length >= 2 || (x.prom != null && x.prom < x.minPct) ? 'Alto' : x.rep.length === 1 ? 'Medio' : x.lim.length ? 'Bajo' : null; }
        var ORD = { Alto: 0, Medio: 1, Bajo: 2 };
        R.riesgo = { cols: [{ clave: 'nombre', titulo: 'Estudiante' }].concat(colCentro).concat([{ clave: 'seccion', titulo: 'Sección' }, { clave: 'nivel', titulo: 'Riesgo', valor: function (f) { return ORD[f.nivel]; }, formato: function (v, f) { return f.nivel; },
          render: function (f) { return ui.badge(f.nivel, f.nivel === 'Alto' ? 'bad' : f.nivel === 'Medio' ? 'warn' : 'info'); } },
          { clave: 'detalle', titulo: 'Asignaturas en riesgo' }, { clave: 'prom', titulo: 'Promedio general', align: 'r', formato: function (v) { return m(v); } }]),
          filas: ests.map(function (x) { return { x: x, nivel: nivel(x) }; }).filter(function (r) { return r.nivel; }).map(function (r) {
            var x = r.x, s = secMap[x.seccionId];
            var det = x.rep.map(function (f) { return asigNombre(f.asignaturaId) + ' ' + mostrar(f.pct, x.esc) + ' (reprobada)'; }).concat(x.lim.map(function (f) { return asigNombre(f.asignaturaId) + ' ' + mostrar(f.pct, x.esc) + ' (al límite)'; }));
            return { nombre: x.nombre, centro: cenMap[x.centroId] ? cenMap[x.centroId].nombre : '', seccion: s ? secEt(s) : '', nivel: r.nivel, detalle: det.join('; '), prom: x.prom };
          }).sort(function (a, b) { return ORD[a.nivel] - ORD[b.nivel] || cmp(a.nombre, b.nombre); }) };

        // 5) Consolidado entre centros
        var gc = por(ests, 'centroId'), gfc = por(filas.filter(function (f) { return f.final != null; }), 'centroId');
        R.centros = { cols: [{ clave: 'centro', titulo: 'Centro' }, { clave: 'n', titulo: 'Estudiantes', align: 'r' }, { clave: 'prom', titulo: 'Promedio (0–100)', align: 'r', formato: function (v) { return fmt.nota(v, { decimales: 1 }); } },
          { clave: 'pctApr', titulo: '% aprobación (asignaturas)', align: 'r', formato: function (v) { return fmt.pct(v, 1); } }, { clave: 'pctEst', titulo: '% estudiantes sin reprobadas', align: 'r', formato: function (v) { return fmt.pct(v, 1); } },
          { clave: 'riesgo', titulo: 'Estudiantes en riesgo', align: 'r' }],
          filas: Object.keys(gc).map(function (id) {
            var l = gc[id], fl = gfc[id] || [], ev = l.filter(function (x) { return x.estado !== 'Sin notas'; });
            return { centro: cenMap[id] ? cenMap[id].nombre : id, n: l.length, prom: media(l.map(function (x) { return x.prom; })), pctApr: fl.length ? fl.filter(function (f) { return f.aprobado; }).length / fl.length * 100 : null,
              pctEst: ev.length ? ev.filter(function (x) { return x.estado === 'Aprobado'; }).length / ev.length * 100 : null, riesgo: l.filter(function (x) { return nivel(x); }).length };
          }).sort(function (a, b) { return cmp(a.centro, b.centro); }) };
        R._unico = unico;
        return R;
      }

      /* ---------- pintar ---------- */
      var TABS = [
        { id: 'secciones', titulo: 'Aprobados y reprobados', desc: 'Estudiantes que aprueban todas sus asignaturas frente a los que tienen al menos una reprobada (nota final ≥ mínimo de la escala, sin redondear).' },
        { id: 'asignaturas', titulo: 'Promedio por asignatura', desc: 'Promedio de las notas finales y porcentaje de aprobación por área curricular.' },
        { id: 'ranking', titulo: 'Ranking', desc: 'Estudiantes ordenados por promedio general de sus notas finales.' },
        { id: 'riesgo', titulo: 'Riesgo de reprobación', desc: 'Alto: 2 o más asignaturas reprobadas o promedio bajo el mínimo. Medio: 1 reprobada. Bajo: aprobada por menos de ' + MARGEN + ' puntos sobre el mínimo. Notas provisionales mientras haya periodos abiertos.' }
      ];
      if (rol === 'admin_red') TABS.push({ id: 'centros', titulo: 'Consolidado de la red', desc: 'Comparación entre centros con notas normalizadas a 0–100.' });
      var tabsUI = null;

      function pintar() {
        var filas = resumen.filter(function (f) { return !S.seccionId || f.seccionId === S.seccionId; });
        var R = construir(filas);
        var cuerpo = ui.tabs({ etiqueta: 'Reportes', activa: S.tab, alCambiar: function (id) { S.tab = id; },
          tabs: TABS.map(function (t) {
            return { id: t.id, titulo: t.titulo, render: function (panel) {
              var rep = R[t.id], card = document.createElement('div'); card.className = 'card';
              card.innerHTML = '<div style="display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><h2>' + esc(t.titulo) + '</h2><p class="note" style="margin-top:4px">' + esc(t.desc) + '</p></div>' +
                (puedeExportar ? '<button type="button" class="btn sec no-print" data-csv>Exportar CSV</button>' : '') + '</div><div data-tabla></div>';
              panel.appendChild(card);
              var tb = ui.tabla({ columnas: rep.cols, filas: rep.filas, porPagina: 10, etiqueta: t.titulo, caption: t.titulo + (rep._unico || t.id === 'centros' ? '' : '') });
              card.querySelector('[data-tabla]').appendChild(tb.el);
              var b = card.querySelector('[data-csv]');
              if (b) b.addEventListener('click', function () { descargar('educentro-' + t.id + '-' + fmt.hoy() + '.csv', aCsv({ cols: rep.cols, filas: tb.filas() })); ui.toast('CSV exportado', 'ok'); });
            } };
          }) });
        tabsUI = cuerpo; elC.innerHTML = ''; elC.appendChild(cuerpo.el);
      }
      elS.addEventListener('change', function () { S.seccionId = elS.value; pintar(); });
      if (!resumen.length) elC.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin datos para reportar', texto: 'Aún no hay matrículas ni calificaciones registradas.' }) + '</div>';
      else pintar();
    }
  });
})();
