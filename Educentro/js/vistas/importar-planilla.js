/* Vista "importar-planilla": importa/exporta la planilla de calificaciones MINERD (.xlsx) en el navegador (SheetJS local, js/vendor).
   Flujo: elegir archivo -> detectar hojas -> mapear hoja->sección/asignatura -> vista previa (conteos, estudiantes por nombre normalizado) ->
   importar (P/RP/completiva/extraordinaria/especial) -> RECALCULAR con EDU.calculo y mostrar informe de discrepancias (no bloquea).
   El contenido del archivo es dato no confiable: se muestra con EDU.esc y jamás se evalúa. Roles: director, secretaría, admin_red. Ver docs/API.md. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, fmt = EDU.fmt, ui = EDU.ui, calc = EDU.calculo, PL = function () { return EDU.planilla; };
  var COLS = ['centros', 'cursos', 'secciones', 'asignaturas', 'cargas', 'periodos', 'matriculas', 'estudiantes', 'escalas', 'notasCompetencia', 'docentes'];
  var CSS = '.ip-bar{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}.ip-bar label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--muted);font-weight:500;flex:1 1 240px;min-width:0;max-width:100%}.ip-bar select,.ip-bar input{width:100%;min-width:0;max-width:100%}' +
    '.ip-map td select{width:100%;min-width:180px;max-width:100%}.ip-lista{margin:6px 0 0;padding-left:20px;font-size:13px;max-height:150px;overflow:auto}.ip-chk{display:flex;gap:8px;align-items:flex-start;margin:6px 0}.ip-chk input{margin-top:3px}';
  function estilo() { if (document.getElementById('ip-css')) return; var s = document.createElement('style'); s.id = 'ip-css'; s.textContent = CSS; document.head.appendChild(s); }
  function cmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function ahora() { return new Date().toISOString(); }
  function celdaCsv(v) { if (v == null) return ''; var s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function descargar(nombre, partes, tipo) {
    var blob = new Blob(partes, { type: tipo }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  var TIPO_ET = { formula: 'Fórmula distinta', valor: 'Valor distinto', error: 'Error en celda', estado: 'Resultado distinto', aviso: 'Dato omitido', completivo: 'Lista de completivo', meritorios: 'Meritorios' };
  var TIPO_TONO = { formula: 'warn', valor: 'warn', error: 'bad', estado: 'bad', aviso: 'info', completivo: 'warn', meritorios: 'warn' };

  EDU.router.register('importar-planilla', {
    titulo: 'Importar planilla',
    render: async function (cont) {
      estilo();
      var ses = EDU.estado.sesion(), rol = ses.rol, centroId = EDU.estado.centroActivo();
      cont.innerHTML = ui.cabecera({ eyebrow: 'Calificaciones', titulo: 'Importar y exportar planilla',
        descripcion: 'Lee la planilla Excel MINERD (hojas por sección/asignatura, Meritorios y Completivo) y la recalcula con la regla única de Educentro. Todo ocurre en este navegador: el archivo no se envía a ningún servidor.' }).toString() + '<div id="ip-cuerpo"></div>';
      var cuerpo = cont.querySelector('#ip-cuerpo');
      if (!centroId) { cuerpo.innerHTML = '<div class="alert red" role="alert"><div><strong>Elige un centro</strong><small>Selecciona un centro activo en la barra lateral: la importación opera sobre un solo centro.</small></div></div>'; return; }
      if (!window.XLSX || !PL()) { cuerpo.innerHTML = '<div class="alert red" role="alert"><div><strong>Biblioteca de Excel no disponible</strong><small>No se cargó js/vendor/xlsx.full.min.js.</small></div></div>'; return; }
      var d = await EDU.consultas.cargar(COLS, { centroId: centroId });
      var esc_ = EDU.consultas.escalaDe(d.escalas, centroId), puedeImp = EDU.permisos.puede(rol, 'importar-planilla', 'importar'), puedeExp = EDU.permisos.puede(rol, 'importar-planilla', 'exportar');
      var S = { analisis: null, nombreArchivo: '', mapa: {}, crear: false, vaciar: false, plan: null, informe: null, importado: false, secExp: null };
      if (calc.modelo(esc_) !== 'competencias') {
        cuerpo.innerHTML = '<div class="alert" role="status"><div><strong>Este centro usa el modelo ponderado</strong><small>La planilla MINERD requiere el modelo por competencias. Actívalo en Configuración → Escala y nota mínima → «Modelo de calificación».</small></div></div>';
        return;
      }

      function secEt(s) { var c = d.cursos.filter(function (x) { return x.id === s.cursoId; })[0]; return (c ? c.nombre : '') + ' · Sección ' + s.nombre; }
      function asig(id) { return d.asignaturas.filter(function (x) { return x.id === id; })[0] || { nombre: id, codigo: id }; }
      function cargaEt(c) { var s = d.secciones.filter(function (x) { return x.id === c.seccionId; })[0]; return (s ? secEt(s) : '') + ' · ' + asig(c.asignaturaId).nombre; }
      var cargasOrd = d.cargas.slice().sort(function (a, b) { return cmp(cargaEt(a), cargaEt(b)); });
      function seccionDe(cargaId) { var c = d.cargas.filter(function (x) { return x.id === cargaId; })[0]; return c ? d.secciones.filter(function (s) { return s.id === c.seccionId; })[0] : null; }
      function estsSeccion(secId) { var ids = {}; d.matriculas.forEach(function (m) { if (m.estado === 'activa' && m.seccionId === secId) ids[m.estudianteId] = 1; }); return d.estudiantes.filter(function (e) { return ids[e.id]; }); }
      function matriculaActiva(estId) { return d.matriculas.filter(function (m) { return m.estudianteId === estId && m.estado === 'activa'; })[0] || null; }

      var tabs = ui.tabs({ etiqueta: 'Importar o exportar', tabs: [
        { id: 'imp', titulo: 'Importar planilla', render: function (p) { if (!puedeImp) p.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin permiso', texto: 'Tu rol no puede importar.' }) + '</div>'; else pintarImp(p); } },
        { id: 'exp', titulo: 'Exportar planilla', render: function (p) { if (!puedeExp) p.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin permiso', texto: 'Tu rol no puede exportar.' }) + '</div>'; else pintarExp(p); } }] });
      cuerpo.appendChild(tabs.el);

      /* ================= IMPORTAR ================= */
      function adivinarCarga(nombreHoja) { // "A26", "LE A", "Mat-B": letra de sección (última palabra / primera letra) + código de asignatura si aparece
        var n = PL().norm(nombreHoja).trim(), tk = n.split(/[^a-z0-9]+/).filter(Boolean), letra = null, m;
        if ((m = n.match(/^([a-z])\s*\d*$/))) letra = m[1]; else if (tk.length > 1 && /^[a-z]$/.test(tk[tk.length - 1])) letra = tk[tk.length - 1];
        if (!letra) return '';
        var hallado = cargasOrd.filter(function (c) { var s = seccionDe(c.id); return s && PL().norm(s.nombre) === letra; });
        var porAsig = hallado.filter(function (c) { var a = asig(c.asignaturaId); return tk.indexOf(PL().norm(a.codigo)) !== -1 || n.indexOf(PL().norm(a.nombre)) !== -1; });
        return porAsig.length === 1 ? porAsig[0].id : '';
      }
      function pintarImp(p) {
        var h = '<div class="card"><div class="ip-bar"><label>Archivo Excel (.xlsx, máx. 10 MB)<input type="file" id="ip-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label></div>' +
          '<p class="note">Se detectan las hojas de calificaciones (columnas P1–P4/RP por competencia), Meritorios y Completivo. Los nombres se emparejan sin distinguir tildes ni mayúsculas. Nada se guarda hasta que confirmes.</p><div id="ip-err" role="alert"></div></div><div id="ip-res"></div>';
        p.innerHTML = h;
        p.querySelector('#ip-file').addEventListener('change', async function (e) {
          var f = e.target.files && e.target.files[0], er = p.querySelector('#ip-err'); er.innerHTML = ''; S.analisis = null; S.plan = null; S.informe = null; S.importado = false; p.querySelector('#ip-res').innerHTML = '';
          if (!f) return;
          try {
            var buf = await f.arrayBuffer(), v = PL().validarArchivo(f.name, f.size, buf);
            if (!v.ok) throw new Error(v.errores.join(' '));
            S.analisis = PL().analizarLibro(buf, f.name); S.nombreArchivo = f.name; S.mapa = {};
            S.analisis.hojas.forEach(function (hj, i) { if (hj.tipo === 'calificaciones') S.mapa[i] = adivinarCarga(hj.nombre); });
            pintarMapa(p);
          } catch (err) { er.innerHTML = '<div class="alert red"><div><strong>No se pudo leer el archivo</strong><small>' + esc(err.message) + '</small></div></div>'; e.target.value = ''; }
        });
      }
      function pintarMapa(p) {
        var A = S.analisis, res = p.querySelector('#ip-res');
        if (!A.hojas.length) { res.innerHTML = '<div class="card"><div class="alert red" role="alert"><div><strong>No se reconoció ninguna hoja</strong><small>Se buscan columnas P1/RP/Prom por competencia, «Meritorios» o «Completivo».' + (A.ignoradas.length ? ' Hojas ignoradas: ' + A.ignoradas.length + '.' : '') + '</small></div></div></div>'; return; }
        var opciones = [{ valor: '', texto: '— No importar —' }].concat(cargasOrd.map(function (c) { return { valor: c.id, texto: cargaEt(c) }; }));
        res.innerHTML = '<div class="card"><h2>Hojas detectadas</h2><p class="note">Asigna cada hoja de calificaciones a una sección y asignatura. Meritorios y Completivo no se importan: se comparan con lo que Educentro calcula.' + (A.ignoradas.length ? ' Hojas sin datos reconocibles omitidas: ' + A.ignoradas.length + '.' : '') + '</p>' +
          '<div class="tw"><table class="t ip-map"><caption class="sr-only">Mapeo de hojas</caption><thead><tr><th scope="col">Hoja</th><th scope="col">Tipo</th><th scope="col" class="r">Filas</th><th scope="col">Destino en Educentro</th></tr></thead><tbody>' +
          A.hojas.map(function (hj, i) {
            var n = hj.tipo === 'completivo' ? hj.grupos.reduce(function (a, g) { return a + g.nombres.length; }, 0) : hj.filas.length;
            return '<tr><th scope="row" style="text-align:left">' + esc(hj.nombre) + '</th><td>' + ui.badge(hj.tipo === 'calificaciones' ? 'Calificaciones' : hj.tipo === 'meritorios' ? 'Meritorios' : 'Completivo', hj.tipo === 'calificaciones' ? 'ok' : 'info') + '</td><td class="r">' + n + '</td><td>' +
              (hj.tipo === 'calificaciones' ? '<label class="sr-only" for="ip-m' + i + '">Destino de la hoja ' + esc(hj.nombre) + '</label><select id="ip-m' + i + '" data-i="' + i + '">' + ui.opciones(opciones, S.mapa[i] || '') + '</select>' : '<span class="note" style="margin:0">Solo comparación</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="ip-chk"><input type="checkbox" id="ip-crear"' + (S.crear ? ' checked' : '') + '><label for="ip-crear">Crear los estudiantes no encontrados (estudiante + matrícula en la sección), tras confirmar</label></div>' +
          '<div class="ip-chk"><input type="checkbox" id="ip-vaciar"' + (S.vaciar ? ' checked' : '') + '><label for="ip-vaciar">Si una celda está en blanco en el archivo, vaciar también la nota en Educentro (por defecto se conserva)</label></div>' +
          '<div class="ip-bar" style="margin-top:10px"><button type="button" class="btn amb" id="ip-prev">Vista previa y recalcular</button></div></div><div id="ip-prev-res"></div>';
        res.querySelector('table').addEventListener('change', function (e) { var i = e.target.dataset && e.target.dataset.i; if (i != null) { S.mapa[i] = e.target.value; S.plan = null; res.querySelector('#ip-prev-res').innerHTML = ''; } });
        res.querySelector('#ip-crear').addEventListener('change', function (e) { S.crear = e.target.checked; });
        res.querySelector('#ip-vaciar').addEventListener('change', function (e) { S.vaciar = e.target.checked; });
        res.querySelector('#ip-prev').addEventListener('click', function () { try { construirPlan(); pintarPlan(p.querySelector('#ip-prev-res')); } catch (err) { console.error(err); ui.toast(err.message || 'Error', 'error'); } });
      }

      /* ---- plan: emparejar, mezclar, recalcular y revisar (sin escribir) ---- */
      function construirPlan() {
        var plan = { hojas: [], proyectado: {}, aCrear: 0, informe: [], cambios: 0, filas: 0, ok: 0, sinMatricula: 0, otraSeccion: 0, ambiguos: 0, noEnc: 0 };
        var usadas = {};
        S.analisis.hojas.forEach(function (hj, i) {
          if (hj.tipo !== 'calificaciones' || !S.mapa[i]) return;
          var carga = d.cargas.filter(function (c) { return c.id === S.mapa[i]; })[0], sec = seccionDe(carga.id), enSec = {}; estsSeccion(sec.id).forEach(function (e) { enSec[e.id] = 1; });
          var pref = new Set(Object.keys(enSec)), item = { hoja: hj, carga: carga, seccion: sec, filas: [], nuevos: 0 }, vistos = {};
          hj.filas.forEach(function (f) {
            var m = PL().emparejar(f.nombreCompleto, d.estudiantes, pref), fila = { f: f, est: m.est, estado: m.estado, accion: 'importar', cambios: 0, rec: null };
            plan.filas++;
            if (m.estado === 'ok') {
              if (vistos[m.est.id]) { fila.accion = 'duplicado'; plan.ambiguos++; }
              else if (enSec[m.est.id]) plan.ok++;
              else { var mt = matriculaActiva(m.est.id); if (mt) { fila.accion = 'otraSeccion'; plan.otraSeccion++; } else { fila.matricular = true; plan.sinMatricula++; } }
              if (fila.accion === 'importar') vistos[m.est.id] = 1;
            } else if (m.estado === 'ambiguo') { fila.accion = 'ambiguo'; plan.ambiguos++; }
            else { plan.noEnc++; if (S.crear) { fila.accion = 'crear'; item.nuevos++; plan.aCrear++; } else fila.accion = 'omitir'; }
            item.filas.push(fila);
            if (fila.accion === 'importar' || fila.accion === 'crear') {
              var ex = fila.est ? d.notasCompetencia.filter(function (n) { return n.cargaId === carga.id && n.estudianteId === fila.est.id; })[0] : null, r = PL().aplicarFila(f, ex || null, S.vaciar);
              fila.rec = r.rec; fila.cambios = r.cambios; plan.cambios += r.cambios;
              plan.proyectado[carga.id + '|' + (fila.est ? fila.est.id : 'nuevo:' + hj.nombre + ':' + f.fila)] = r.rec;
              PL().revisarFila(f, r.rec, esc_).forEach(function (x) { plan.informe.push({ hoja: hj.nombre, fila: f.fila, no: f.no, nombre: f.nombreCompleto, tipo: x.tipo, detalle: x.detalle }); });
            }
          });
          plan.hojas.push(item); usadas[sec.id] = sec;
        });
        // Meritorios / Completivo: comparacion con lo calculado
        S.analisis.hojas.forEach(function (hj) {
          if (hj.tipo === 'meritorios') {
            var sec = seccionPorEtiqueta(hj.titulo || hj.nombre, usadas), ests = sec ? estsSeccion(sec.id) : [];
            hj.filas.forEach(function (f) {
              var info = function (t, det) { plan.informe.push({ hoja: hj.nombre, fila: f.fila, no: f.no, nombre: f.nombreCompleto, tipo: t, detalle: det }); };
              if (f.error) info('error', 'Promedio: ' + f.error);
              if (f.prom !== null && f.media !== null && Math.abs(f.prom - f.media) > 0.01) info('valor', 'Promedio del archivo ' + calc.redondear(f.prom, 2) + ' vs media de sus asignaturas ' + calc.redondear(f.media, 2));
              if (f.refs !== null && f.refs !== hj.asignaturas.length) info('formula', 'La fórmula del promedio usa ' + f.refs + ' celda(s) y la hoja tiene ' + hj.asignaturas.length + ' asignatura(s)');
              if (sec) {
                var m = PL().emparejar(f.nombreCompleto, ests, null);
                if (m.estado === 'ok') {
                  var fin = proyectarFinales(sec, m.est.id, plan);
                  if (fin.n && f.prom !== null && fin.n === f.nSubj && Math.abs(fin.prom - f.prom) > 0.05) info('meritorios', 'Promedio del archivo ' + calc.redondear(f.prom, 2) + ' vs Educentro ' + calc.redondear(fin.prom, 2));
                }
              }
            });
          } else if (hj.tipo === 'completivo') {
            hj.grupos.forEach(function (g) {
              var sec = seccionPorEtiqueta(g.etiqueta, usadas); if (!sec) { plan.informe.push({ hoja: hj.nombre, fila: '', no: '', nombre: g.etiqueta, tipo: 'aviso', detalle: 'Grupo sin sección equivalente entre las hojas importadas: no se compara' }); return; }
              var ests = estsSeccion(sec.id);
              var enArchivo = {}, deb = {};
              g.nombres.forEach(function (nn) { var m = PL().emparejar(nn.nombreCompleto, ests, null); if (m.estado === 'ok') enArchivo[m.est.id] = nn; else plan.informe.push({ hoja: hj.nombre, fila: nn.fila, no: nn.no, nombre: nn.nombreCompleto, tipo: 'completivo', detalle: 'Estudiante de la lista de completivo sin equivalente en la sección' }); });
              ests.forEach(function (e) { var r = proyectarFinales(sec, e.id, plan); if (r.pend > 0) deb[e.id] = e; });
              Object.keys(deb).forEach(function (id) { if (!enArchivo[id]) plan.informe.push({ hoja: hj.nombre, fila: '', no: '', nombre: fmt.nombreCompleto(deb[id]), tipo: 'completivo', detalle: 'Educentro calcula completiva/extraordinaria y no está en la lista del archivo' }); });
              Object.keys(enArchivo).forEach(function (id) { if (!deb[id]) { var nn = enArchivo[id]; plan.informe.push({ hoja: hj.nombre, fila: nn.fila, no: nn.no, nombre: nn.nombreCompleto, tipo: 'completivo', detalle: 'Está en la lista del archivo y Educentro no lo calcula en completiva' }); } });
            });
          }
        });
        S.plan = plan; S.importado = false; return plan;
      }
      function seccionPorEtiqueta(txt, usadas) { // "Meritorios 6to B" / "6to A" -> sección por la letra final (prefiere las secciones importadas)
        var m = String(txt || '').trim().match(/([A-Za-z])\s*$/); if (!m) return null; var L = m[1].toLowerCase();
        var cand = d.secciones.filter(function (s) { return PL().norm(s.nombre) === L; });
        return cand.filter(function (s) { return usadas[s.id]; })[0] || cand[0] || null;
      }
      function proyectarFinales(sec, estId, plan) { // finales de todas las asignaturas de la sección con lo proyectado + lo existente
        var vals = [], pend = 0;
        d.cargas.filter(function (c) { return c.seccionId === sec.id; }).forEach(function (c) {
          var rec = plan.proyectado[c.id + '|' + estId] || d.notasCompetencia.filter(function (n) { return n.cargaId === c.id && n.estudianteId === estId; })[0];
          if (!rec) return; var r = PL().calcDeRec(rec, esc_);
          if (r.estado === 'Completiva' || r.estado === 'Extraordinaria') pend++;
          if (r.estado !== 'Pendiente' && r.final != null) vals.push(r.final);
        });
        return { n: vals.length, prom: calc.promedioGeneral(vals), pend: pend };
      }

      function pintarPlan(el) {
        var P = S.plan, h = '', tot = {};
        P.informe.forEach(function (x) { tot[x.tipo] = (tot[x.tipo] || 0) + 1; });
        if (!P.hojas.length) { el.innerHTML = '<div class="card"><div class="alert" role="status"><div><strong>Nada que importar</strong><small>Asigna al menos una hoja de calificaciones a una sección y asignatura.</small></div></div></div>'; return; }
        h += '<div class="card" style="margin-top:12px"><h2>Vista previa</h2>' + ui.kpis([{ etiqueta: 'Filas leídas', valor: P.filas }, { etiqueta: 'Emparejadas', valor: P.ok + P.sinMatricula }, { etiqueta: 'No encontradas', valor: P.noEnc, tono: P.noEnc ? 'warn' : 'neu', detalle: S.crear ? 'Se crearán' : 'Se omiten' },
          { etiqueta: 'Ambiguas / en otra sección', valor: P.ambiguos + P.otraSeccion, tono: P.ambiguos + P.otraSeccion ? 'warn' : 'neu' }, { etiqueta: 'Valores a cambiar', valor: P.cambios }]).toString();
        h += '<div class="tw" style="margin-top:12px"><table class="t"><caption class="sr-only">Resumen por hoja</caption><thead><tr><th scope="col">Hoja</th><th scope="col">Destino</th><th scope="col" class="r">Filas</th><th scope="col" class="r">Emparejadas</th><th scope="col" class="r">Por crear / omitir</th><th scope="col" class="r">Valores a cambiar</th></tr></thead><tbody>' +
          P.hojas.map(function (x) {
            var emp = x.filas.filter(function (f) { return f.estado === 'ok' && f.accion === 'importar'; }).length, no = x.filas.filter(function (f) { return f.estado === 'noEncontrado'; }).length, cam = x.filas.reduce(function (a, f) { return a + f.cambios; }, 0);
            return '<tr><th scope="row" style="text-align:left">' + esc(x.hoja.nombre) + '</th><td>' + esc(cargaEt(x.carga)) + '</td><td class="r">' + x.filas.length + '</td><td class="r">' + emp + '</td><td class="r">' + no + '</td><td class="r">' + cam + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        P.hojas.forEach(function (x) {
          var prob = x.filas.filter(function (f) { return f.accion !== 'importar'; });
          if (prob.length) h += '<details style="margin-top:8px"><summary>Filas con atención en «' + esc(x.hoja.nombre) + '» (' + prob.length + ')</summary><ul class="ip-lista">' + prob.map(function (f) {
            return '<li>' + esc(f.f.nombreCompleto) + ' — ' + esc({ crear: 'se creará el estudiante y su matrícula', omitir: 'no encontrado: se omite', ambiguo: 'varias coincidencias: se omite', otraSeccion: 'matriculado en otra sección: se omite', duplicado: 'nombre repetido en la hoja: se omite' }[f.accion] || f.accion) + '</li>';
          }).join('') + '</ul></details>';
        });
        h += '<div class="ip-bar" style="margin-top:14px">' + (S.importado ? '<span class="badge ok">Importación completada</span>' : '<button type="button" class="btn amb" id="ip-go"' + (P.cambios || P.aCrear ? '' : ' disabled') + '>Importar ' + P.hojas.length + ' hoja(s)…</button>') + '</div></div>';
        h += '<div class="card" style="margin-top:12px"><h2>Informe de discrepancias</h2><p class="note">Se recalculó todo con la regla única de Educentro y se comparó con los valores y fórmulas del archivo. Es informativo: no bloquea la importación.</p>' +
          ui.kpis(Object.keys(TIPO_ET).filter(function (k) { return tot[k]; }).map(function (k) { return { etiqueta: TIPO_ET[k], valor: tot[k], tono: k === 'aviso' ? 'neu' : 'warn' }; }).concat(P.informe.length ? [] : [{ etiqueta: 'Discrepancias', valor: 0, tono: 'neu' }])).toString() + '<div id="ip-inf"></div>' +
          (P.informe.length ? '<p><button type="button" class="btn sec sm" id="ip-csv">Descargar informe (CSV)</button></p>' : '') + '</div>';
        el.innerHTML = h;
        if (P.informe.length) {
          var tb = ui.tabla({ caption: 'Discrepancias', etiqueta: 'Informe de discrepancias', porPagina: 10, buscar: true, columnas: [{ clave: 'hoja', titulo: 'Hoja', orden: true, buscable: true }, { clave: 'fila', titulo: 'Fila', align: 'r' },
            { clave: 'nombre', titulo: 'Estudiante', buscable: true, orden: true }, { clave: 'tipo', titulo: 'Tipo', orden: true, formato: function (v) { return TIPO_ET[v] || v; } }, { clave: 'detalle', titulo: 'Detalle', buscable: true }], filas: P.informe });
          el.querySelector('#ip-inf').appendChild(tb.el);
        }
        var go = el.querySelector('#ip-go'); if (go) go.addEventListener('click', function () { importar(el); });
        var csv = el.querySelector('#ip-csv');
        if (csv) csv.addEventListener('click', function () {
          var l = ['Hoja,Fila,Estudiante,Tipo,Detalle'].concat(P.informe.map(function (x) { return [x.hoja, x.fila, x.nombre, TIPO_ET[x.tipo] || x.tipo, x.detalle].map(celdaCsv).join(','); }));
          descargar('educentro-discrepancias-' + fmt.hoy() + '.csv', ['﻿' + l.join('\r\n')], 'text/csv;charset=utf-8');
        });
      }

      async function importar(el) {
        var P = S.plan, okc = await ui.confirmar({ titulo: 'Importar planilla', mensaje: 'Se aplicarán ' + P.cambios + ' valor(es) en ' + P.hojas.length + ' hoja(s)' + (P.aCrear ? ' y se crearán ' + P.aCrear + ' estudiante(s) con su matrícula' : '') + '. Los cambios quedan en la auditoría y pueden afectar periodos cerrados. ¿Continuar?', textoOk: 'Importar' });
        if (!okc) return;
        var btn = el.querySelector('#ip-go'); if (btn) btn.disabled = true;
        try {
          var regs = [], creados = 0, matric = 0;
          for (var hi = 0; hi < P.hojas.length; hi++) {
            var x = P.hojas[hi];
            for (var fi = 0; fi < x.filas.length; fi++) {
              var f = x.filas[fi]; if (f.accion !== 'importar' && f.accion !== 'crear') continue;
              var est = f.est;
              if (f.accion === 'crear') {
                var pn = f.f.apellidos || f.f.nombres ? { nombres: f.f.nombres, apellidos: f.f.apellidos } : PL().partirNombre(f.f.nombreCompleto);
                est = await EDU.repo.guardar('estudiantes', { centroId: centroId, nombres: pn.nombres, apellidos: pn.apellidos, matricula: 'IMP-' + Date.now().toString(36) + '-' + (creados + 1), importadoDe: 'planilla' }); creados++;
                f.est = est; d.estudiantes.push(est);
              }
              if (f.accion === 'crear' || f.matricular) { await EDU.repo.guardar('matriculas', { id: 'mtr_' + est.id, centroId: centroId, estudianteId: est.id, seccionId: x.seccion.id, anioId: x.seccion.anioId, estado: 'activa', fecha: fmt.hoy(), origen: 'importar-planilla' }); matric++; }
              var rec = f.rec, ex = d.notasCompetencia.filter(function (n) { return n.cargaId === x.carga.id && n.estudianteId === est.id; })[0];
              if (!f.cambios && ex) continue;
              regs.push(Object.assign({}, ex || {}, rec, { id: 'nc_' + x.carga.id + '_' + est.id, centroId: centroId, cargaId: x.carga.id, estudianteId: est.id }));
            }
          }
          if (regs.length) await EDU.repo.guardarMuchos('notasCompetencia', regs);
          await EDU.repo.adaptador().guardar('auditoria', { centroId: centroId, usuarioId: ses.usuarioId, accion: 'importar_planilla', coleccion: 'notasCompetencia', archivo: String(S.nombreArchivo).slice(0, 120), hojas: P.hojas.length, registros: regs.length, valores: P.cambios, estudiantesCreados: creados, matriculasCreadas: matric, discrepancias: P.informe.length, fecha: ahora() });
          d = await EDU.consultas.cargar(COLS, { centroId: centroId });
          S.importado = true; ui.toast(regs.length + ' registro(s) importado(s)' + (creados ? ', ' + creados + ' estudiante(s) creado(s)' : ''), 'ok');
          pintarPlan(el);
        } catch (err) { console.error(err); ui.toast(err.message || 'No se pudo importar', 'error'); if (btn) btn.disabled = false; }
      }

      /* ================= EXPORTAR ================= */
      function pintarExp(p) {
        var secs = d.secciones.slice().sort(function (a, b) { return cmp(secEt(a), secEt(b)); });
        if (!secs.length) { p.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Sin secciones', texto: 'Aún no hay secciones en este centro.' }) + '</div>'; return; }
        if (!S.secExp) S.secExp = secs[0].id;
        p.innerHTML = '<div class="card"><div class="ip-bar"><label>Sección<select id="ex-s">' + ui.opciones(secs.map(function (s) { return { valor: s.id, texto: secEt(s) }; }), S.secExp) + '</select></label><button type="button" class="btn amb" id="ex-go">Exportar planilla (.xlsx)</button></div>' +
          '<p class="note">Una hoja por asignatura con el mismo diseño de columnas de la planilla MINERD (P1–P4/RP por competencia, Prom, CF, CEC/CFC, CEEX/CEXF, CE, A/R) y <strong>fórmulas consistentes</strong> en todas las filas, más las hojas Meritorios y Completivo. Se añaden al final las columnas «Nota final», «Resultado» y «Periodos con nota». Es un archivo nuevo: no modifica ni sobrescribe tu planilla original.</p></div>';
        p.querySelector('#ex-s').addEventListener('change', function (e) { S.secExp = e.target.value; });
        p.querySelector('#ex-go').addEventListener('click', function () { try { exportar(); } catch (err) { console.error(err); ui.toast(err.message || 'No se pudo exportar', 'error'); } });
      }
      function exportar() {
        var sec = d.secciones.filter(function (s) { return s.id === S.secExp; })[0], cs = d.cargas.filter(function (c) { return c.seccionId === sec.id; }).sort(function (a, b) { return cmp(asig(a.asignaturaId).nombre, asig(b.asignaturaId).nombre); });
        var ests = estsSeccion(sec.id).sort(function (a, b) { return cmp(a.apellidos + ' ' + a.nombres, b.apellidos + ' ' + b.nombres); }), hojas = [], filasMer = {}, nombres = {};
        cs.forEach(function (c) {
          var a = asig(c.asignaturaId);
          hojas.push({ nombre: (a.codigo || a.nombre) + ' ' + sec.nombre, titulo: secEt(sec) + ' · ' + a.nombre, estudiantes: ests.map(function (e) { return { apellidos: e.apellidos, nombres: e.nombres, rec: d.notasCompetencia.filter(function (n) { return n.cargaId === c.id && n.estudianteId === e.id; })[0] || null }; }) });
        });
        var pend = {};
        var mer = { nombre: 'Meritorios ' + sec.nombre, titulo: 'Meritorios · ' + secEt(sec), asignaturas: cs.map(function (c) { return asig(c.asignaturaId).codigo || asig(c.asignaturaId).nombre; }), filas: [] };
        ests.forEach(function (e) {
          var notas = cs.map(function (c) { var rec = d.notasCompetencia.filter(function (n) { return n.cargaId === c.id && n.estudianteId === e.id; })[0]; if (!rec) return null; var r = PL().calcDeRec(rec, esc_); if (r.estado === 'Completiva' || r.estado === 'Extraordinaria') pend[e.id] = e; return r.estado === 'Pendiente' ? null : r.final; });
          mer.filas.push({ apellidos: e.apellidos, nombres: e.nombres, notas: notas, prom: calc.promedioGeneral(notas) });
        });
        mer.filas.sort(function (a, b) { return (b.prom == null ? -1 : b.prom) - (a.prom == null ? -1 : a.prom); }); void filasMer; void nombres;
        var wb = PL().construirLibro({ escala: esc_, hojas: hojas, meritorios: mer, completivo: { nombre: 'Completivo ' + sec.nombre, titulo: 'Estudiantes en completivo · ' + secEt(sec), grupos: [{ etiqueta: sec.nombre, estudiantes: Object.keys(pend).map(function (k) { return pend[k]; }) }] } });
        var bytes = PL().libroABytes(wb);
        descargar('planilla-calificaciones-' + String(sec.nombre).replace(/[^A-Za-z0-9]/g, '') + '-' + fmt.hoy() + '.xlsx', [bytes], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        ui.toast('Planilla exportada (' + hojas.length + ' hoja(s) de calificaciones)', 'ok');
      }
    }
  });
})();
