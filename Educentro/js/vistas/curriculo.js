/* Vista "curriculo": catalogo MINERD versionado (competencias, contenidos, indicadores, ejes), versiones (importar/exportar/comparar/vigente) y aviso de revision.
   Lectura para todos; edicion admin_red/director. Datos sembrados por js/data/curriculo-semilla.js (solo lo respaldado por docs/CURRICULO-MINERD.md). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, CS = function () { return EDU.curriculoSemilla; };
  var NIVELES = ['Inicial', 'Primario', 'Secundario'], CICLOS = ['Primer ciclo', 'Segundo ciclo'], MODALIDADES = ['General', 'Técnico-Profesional', 'Artes'];
  var SUBTIPOS = [{ valor: 'concepto', texto: 'Conceptual' }, { valor: 'procedimiento', texto: 'Procedimental' }, { valor: 'actitud', texto: 'Actitudinal / valores' }];
  var DEFECTO_DIAS = 30;

  function tiposOpc() { var T = CS().TIPOS; return Object.keys(T).map(function (k) { return { valor: k, texto: T[k] }; }); }
  function f(d) { return d ? EDU.fmt.fecha(d) : '—'; }
  function ambito(i) {
    var p = [i.nivel, i.ciclo, i.grado != null ? i.grado + '.º' : null, i.modalidad].filter(Boolean);
    return p.length ? p.join(' · ') : 'Todos los niveles';
  }
  function areaNombre(cod) { var a = CS().AREAS.filter(function (x) { return x[0] === cod; })[0]; return a ? a[1] : (cod || ''); }
  function uid() { return 'usr.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function dialogoForm(titulo, campos, valores, guardar) {
    var m, fm = EDU.ui.formulario({ campos: campos, valores: valores, sinBotones: true, alEnviar: async function (v) { await guardar(v); m.cerrar(true); } });
    m = EDU.ui.modal({ titulo: titulo, tamano: 'lg', contenido: fm.el, botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null }, { texto: 'Guardar', tipo: 'amb', alClic: function () { fm.enviar(); } }] });
    return m.resultado;
  }
  function descargar(nombre, texto) {
    var b = new Blob([texto], { type: 'application/json' }), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function leerArchivo(file) {
    if (file.text) return file.text();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsText(file); });
  }
  function slug(s) { return String(s || 'curriculo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40); }

  EDU.router.register('curriculo', {
    titulo: 'Currículo',
    render: async function (cont) {
      var rol = EDU.estado.rol(), ses = EDU.estado.sesion();
      var puedeEd = EDU.permisos.puede(rol, 'curriculo', 'editar');
      var S = { versiones: [], config: null, versionId: null, items: [], centroId: null, filtros: {} };

      async function cargarVersiones() {
        var todas = await EDU.repo.listar('curriculoVersiones');
        S.centroId = ses.centroActivo || (todas[0] && todas[0].centroId) || null;
        var mias = todas.filter(function (v) { return !S.centroId || v.centroId === S.centroId; });
        S.config = mias.filter(function (v) { return v.esConfig; })[0] || null;
        S.versiones = mias.filter(function (v) { return !v.esConfig; }).sort(function (a, b) { return (b.vigenteDesde || '').localeCompare(a.vigenteDesde || '') || (b.creadoEn || '').localeCompare(a.creadoEn || ''); });
        if (!S.versionId || !S.versiones.some(function (v) { return v.id === S.versionId; })) {
          var vg = S.versiones.filter(function (v) { return v.estado === 'vigente'; })[0] || S.versiones[0];
          S.versionId = vg ? vg.id : null;
        }
      }
      async function cargarItems() { S.items = S.versionId ? await EDU.repo.listar('curriculoContenidos', { filtro: { versionId: S.versionId }, orden: 'orden' }) : []; }
      function version(id) { return S.versiones.filter(function (v) { return v.id === (id || S.versionId); })[0] || null; }
      function editable() { var v = version(); return puedeEd && !!S.centroId && !!v && v.estado !== 'anterior'; }

      /** Recalcula hash/total de una version tras cambiar sus items. */
      async function tocar(vid) {
        var v = version(vid); if (!v) return;
        var items = await EDU.repo.listar('curriculoContenidos', { filtro: { versionId: v.id } });
        await EDU.repo.guardar('curriculoVersiones', Object.assign({}, v, { hash: CS().hashItems(items), total: items.length }));
      }
      async function refrescar() { await cargarVersiones(); await cargarItems(); pintar(); }

      /* ------- revision periodica ------- */
      function estadoRevision() {
        var dias = (S.config && +S.config.intervaloDias) || DEFECTO_DIAS, v = version();
        var ult = (S.config && S.config.ultimaRevision) || (v && (v.descargadoEn || (v.creadoEn || '').slice(0, 10))) || null;
        var venc = ult ? EDU.planUtil.sumaDias(ult, dias) : null;
        return { dias: dias, ultima: ult, vence: venc, vencida: !!venc && venc < EDU.fmt.hoy() };
      }

      var tabsApi = null, root = null;
      function pintar() {
        var v = version(), rev = estadoRevision(), pend = S.items.filter(function (i) { return i.estado === 'pendiente'; }).length, ver = S.items.length - pend;
        var acciones = EDU.raw('<button type="button" class="btn sec" id="cu-print">Imprimir</button>');
        root.innerHTML = EDU.ui.cabecera({ eyebrow: 'Referencia curricular', titulo: 'Currículo MINERD', descripcion: 'Catálogo versionado por nivel, ciclo, grado, modalidad y área. Cada dato indica su estado de verificación, fuente y fecha.', acciones: acciones }) +
          '<div class="alert"><div><strong>Catálogo parcial: lo no verificado está marcado como «pendiente de validar»</strong><small>Se sembró únicamente lo respaldado por el informe de investigación (confianza media, solo resúmenes de búsqueda; no se leyó ningún PDF oficial). Las competencias fundamentales y la estructura por ciclos tienen fuente; competencias específicas, contenidos, indicadores y ejes transversales deben transcribirse y validarse contra los diseños curriculares oficiales.</small></div></div>' +
          (rev.vencida ? '<div class="alert red" role="alert"><div><strong>Revisión periódica vencida</strong><small>La última revisión fue el ' + esc(f(rev.ultima)) + ' y debía repetirse cada ' + esc(rev.dias) + ' días (venció el ' + esc(f(rev.vence)) + '). Revisa el sitio oficial, importa una versión nueva si hay cambios y registra la revisión.</small></div></div>' : '') +
          (!S.centroId ? '<div class="alert"><div><strong>Elige un centro activo</strong><small>El catálogo se guarda por centro; para editar, selecciona uno en la barra superior.</small></div></div>' : '') +
          '<div style="margin-top:14px" id="cu-kpis"></div><div id="cu-tabs"></div>';
        root.querySelector('#cu-kpis').innerHTML = EDU.ui.kpis([
          { etiqueta: 'Versión mostrada', valor: v ? v.estado : '—', detalle: v ? v.nombre : 'Sin versiones', tono: 'neu' },
          { etiqueta: 'Elementos', valor: S.items.length, detalle: 'en la versión', tono: 'neu' },
          { etiqueta: 'Verificados', valor: ver, detalle: 'con fuente' }, { etiqueta: 'Pendientes de validar', valor: pend, detalle: 'editables', tono: pend ? 'bad' : 'ok' }]);
        root.querySelector('#cu-print').addEventListener('click', function () { window.print(); });
        var activa = tabsApi && tabsApi.actual ? tabsApi.actual() : 'catalogo';
        tabsApi = EDU.ui.tabs({ etiqueta: 'Secciones del currículo', activa: activa, siempre: false, tabs: [
          { id: 'catalogo', titulo: 'Catálogo', render: tabCatalogo }, { id: 'versiones', titulo: 'Versiones', render: tabVersiones },
          { id: 'comparar', titulo: 'Comparar', render: tabComparar }, { id: 'revision', titulo: 'Revisión periódica', render: tabRevision }] });
        root.querySelector('#cu-tabs').appendChild(tabsApi.el);
      }

      /* ------- catalogo ------- */
      function tabCatalogo(p) {
        var v = version(), F = S.filtros;
        if (!v) { p.innerHTML = EDU.ui.vacio({ titulo: 'Sin versiones', texto: 'Importa una versión desde JSON en la pestaña Versiones.' }).s; return; }
        function sel(id, label, lista, val) { return '<label class="fld" style="min-width:150px">' + esc(label) + '<select id="cf-' + id + '"><option value="">Todos</option>' + EDU.ui.opciones(lista, val).s + '</select></label>'; }
        p.innerHTML = '<div class="card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
          '<label class="fld" style="min-width:220px">Versión<select id="cf-ver">' + EDU.ui.opciones(S.versiones.map(function (x) { return { valor: x.id, texto: x.nombre + ' (' + x.estado + ')' }; }), S.versionId).s + '</select></label>' +
          sel('tipo', 'Tipo', tiposOpc(), F.tipo) + sel('nivel', 'Nivel', NIVELES, F.nivel) + sel('ciclo', 'Ciclo', CICLOS, F.ciclo) + sel('grado', 'Grado', [1, 2, 3, 4, 5, 6].map(String), F.grado) +
          sel('modalidad', 'Modalidad', MODALIDADES, F.modalidad) + sel('area', 'Área', CS().AREAS.map(function (a) { return { valor: a[0], texto: a[1] }; }), F.area) +
          sel('estado', 'Estado', [{ valor: 'verificado', texto: 'Verificado' }, { valor: 'pendiente', texto: 'Pendiente de validar' }], F.estado) +
          (editable() ? '<button type="button" class="btn amb" id="cf-nuevo">Nueva entrada</button>' : '') + '</div>' +
          (version().estado === 'anterior' ? '<p class="note">Versión anterior: solo lectura.</p>' : '') +
          (puedeEd ? '' : '<p class="note">Tu rol tiene acceso de lectura al currículo.</p>') + '</div><div class="card" style="margin-top:14px" id="cf-tabla"></div>';
        function filtrados() {
          return S.items.filter(function (i) {
            return (!F.tipo || i.tipo === F.tipo) && (!F.nivel || i.nivel === F.nivel) && (!F.ciclo || i.ciclo === F.ciclo) && (!F.grado || String(i.grado) === F.grado) &&
              (!F.modalidad || i.modalidad === F.modalidad) && (!F.area || i.areaId === F.area) && (!F.estado || i.estado === F.estado);
          });
        }
        var acc = editable() ? [{ texto: 'Editar', alClic: function (i) { editarItem(i); } }, { texto: 'Eliminar', tipo: 'dng', alClic: borrarItem }] : [];
        var tb = EDU.ui.tabla({ etiqueta: 'Elementos del currículo', caption: 'Elementos del currículo de la versión seleccionada', filas: filtrados(), porPagina: 12, acciones: acc,
          vacio: { titulo: 'Sin elementos', texto: 'Ajusta los filtros.' },
          columnas: [
            { clave: 'tipo', titulo: 'Tipo', valor: function (i) { return CS().TIPOS[i.tipo] || i.tipo; } },
            { clave: 'descripcion', titulo: 'Descripción', render: function (i) { return esc(i.descripcion) + (i.subtipo ? ' <span class="chip">' + esc(i.subtipo) + '</span>' : ''); }, valor: function (i) { return i.descripcion; } },
            { clave: 'ambito', titulo: 'Nivel · ciclo · grado', valor: ambito },
            { clave: 'areaId', titulo: 'Área', valor: function (i) { return areaNombre(i.areaId); } },
            { clave: 'estado', titulo: 'Estado', valor: function (i) { return i.estado; }, render: function (i) { return EDU.ui.badge(i.estado === 'verificado' ? 'Verificado' : 'Pendiente de validar', i.estado === 'verificado' ? 'ok' : 'warn').s; } },
            { clave: 'fuente', titulo: 'Fuente · fecha', orden: false, buscable: false, render: function (i) { return EDU.planUtil.enlaceSeguro(i.fuente) + ' · ' + esc(f(i.fecha)); } }] });
        p.querySelector('#cf-tabla').appendChild(tb.el);
        p.querySelector('#cf-ver').addEventListener('change', async function (e) { S.versionId = e.target.value; await cargarItems(); pintar(); });
        ['tipo', 'nivel', 'ciclo', 'grado', 'modalidad', 'area', 'estado'].forEach(function (k) {
          p.querySelector('#cf-' + k).addEventListener('change', function (e) { F[k] = e.target.value; tb.actualizar(filtrados()); });
        });
        var nb = p.querySelector('#cf-nuevo'); if (nb) nb.addEventListener('click', function () { editarItem(null); });
      }

      function camposItem() {
        return [
          { nombre: 'tipo', label: 'Tipo', tipo: 'select', requerido: true, opciones: tiposOpc() },
          { nombre: 'subtipo', label: 'Naturaleza (solo contenidos)', tipo: 'select', opciones: SUBTIPOS },
          { nombre: 'descripcion', label: 'Texto / descripción', tipo: 'textarea', requerido: true, maxLen: 1200, ancho: 'full' },
          { nombre: 'nivel', label: 'Nivel', tipo: 'select', opciones: NIVELES }, { nombre: 'ciclo', label: 'Ciclo', tipo: 'select', opciones: CICLOS },
          { nombre: 'grado', label: 'Grado', tipo: 'select', opciones: ['1', '2', '3', '4', '5', '6'] }, { nombre: 'modalidad', label: 'Modalidad', tipo: 'select', opciones: MODALIDADES },
          { nombre: 'areaId', label: 'Área', tipo: 'select', opciones: CS().AREAS.map(function (a) { return { valor: a[0], texto: a[1] }; }) },
          { nombre: 'estado', label: 'Estado de verificación', tipo: 'select', requerido: true, opciones: [{ valor: 'pendiente', texto: 'Pendiente de validar' }, { valor: 'verificado', texto: 'Verificado' }],
            ayuda: 'Verificado exige una fuente oficial (url).' },
          { nombre: 'fuente', label: 'Fuente (url)', tipo: 'text', maxLen: 500, placeholder: 'https://…' }, { nombre: 'fecha', label: 'Fecha de verificación', tipo: 'date' }];
      }
      async function editarItem(it) {
        var nuevo = !it, base = it || { tipo: 'competencia_especifica', estado: 'pendiente', fecha: EDU.fmt.hoy() };
        var vals = Object.assign({}, base, { grado: base.grado != null ? String(base.grado) : '' });
        var ok = await dialogoForm(nuevo ? 'Nueva entrada de currículo' : 'Editar entrada', camposItem(), vals, async function (v) {
          if (v.estado === 'verificado' && !/^https?:\/\/\S+$/.test(v.fuente || '')) throw new Error('Un dato verificado necesita una fuente con url http(s).');
          if (v.fecha && !EDU.planUtil.fechaValida(v.fecha)) throw new Error('Fecha inválida.');
          var rec = Object.assign({}, base, { versionId: S.versionId, centroId: S.centroId }, {
            tipo: v.tipo, subtipo: v.tipo === 'contenido' ? (v.subtipo || null) : null, descripcion: v.descripcion.trim(), nivel: v.nivel || null, ciclo: v.ciclo || null, grado: v.grado ? +v.grado : null,
            modalidad: v.modalidad || null, areaId: v.areaId || null, estado: v.estado, fuente: v.fuente ? v.fuente.trim() : null, fecha: v.fecha || EDU.fmt.hoy() });
          if (nuevo) { rec.clave = uid(); rec.orden = (S.items.reduce(function (m, x) { return Math.max(m, x.orden || 0); }, 0)) + 1; }
          await EDU.repo.guardar('curriculoContenidos', rec);
          await tocar(S.versionId);
        });
        if (ok) { EDU.ui.toast('Entrada guardada.', 'ok'); await refrescar(); }
      }
      async function borrarItem(it) {
        if (!(await EDU.ui.confirmar({ titulo: 'Eliminar entrada', mensaje: '¿Eliminar «' + it.descripcion.slice(0, 80) + '»?', textoOk: 'Eliminar', peligro: true }))) return;
        await EDU.repo.borrar('curriculoContenidos', it.id); await tocar(S.versionId); EDU.ui.toast('Entrada eliminada.', 'ok'); await refrescar();
      }

      /* ------- versiones ------- */
      async function itemsDeVersion(vid) { return EDU.repo.listar('curriculoContenidos', { filtro: { versionId: vid }, orden: 'orden' }); }
      async function crearVersionDesde(doc, extra) {
        var N = EDU.repo.negocio(); // modo API: esquema, hash y total se validan/calculan en el servidor y todo se guarda en UNA transaccion (borrador)
        if (N) {
          var ex = { centroId: S.centroId }; ['nombre', 'idExterno'].forEach(function (k) { if (extra && extra[k]) ex[k] = extra[k]; }); if (extra && 'vigenteDesde' in extra) ex.vigenteDesde = extra.vigenteDesde;
          return (await N.importarCurriculo(doc, ex)).version;
        }
        var regs = CS().registros(doc, S.centroId, null), meta = CS().versionDe(doc, regs, Object.assign({ centroId: S.centroId }, extra));
        var v = await EDU.repo.guardar('curriculoVersiones', meta);
        for (var i = 0; i < regs.length; i++) { regs[i].versionId = v.id; regs[i].centroId = S.centroId; }
        await EDU.repo.guardarMuchos('curriculoContenidos', regs);
        return v;
      }
      function docDeVersion(v, items) {
        return { schemaVersion: v.schemaVersion || '1.0.0', curriculum: { id: v.idExterno || v.id, version: v.version || null, nombre: v.nombre,
          source: { title: v.fuenteTitulo || null, url: v.fuente || null, retrievedAt: v.descargadoEn || null, confidence: v.confianza || null },
          validity: { from: v.vigenteDesde || null, to: null, legalInstrument: v.instrumentoLegal || null, status: v.estado },
          items: items.map(function (i) { return { clave: i.clave, tipo: i.tipo, subtipo: i.subtipo || null, nivel: i.nivel, ciclo: i.ciclo, grado: i.grado, modalidad: i.modalidad, areaId: i.areaId, padreClave: i.padreClave || null,
            descripcion: i.descripcion, estado: i.estado, fuente: i.fuente, fecha: i.fecha, orden: i.orden }; }) } };
      }
      async function importar(file) {
        var doc;
        try { doc = JSON.parse(await leerArchivo(file)); } catch (e) { EDU.ui.toast('El archivo no es un JSON válido: ' + e.message, 'error', 7000); return; }
        var er = CS().validarDoc(doc);
        if (er.length) {
          EDU.ui.modal({ titulo: 'No se pudo importar', contenido: '<p>El archivo no cumple el esquema (ver docs/CURRICULO-MINERD.md):</p><ul>' + er.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>', botones: [{ texto: 'Cerrar', tipo: 'sec', valor: null }] });
          return;
        }
        var items = CS().aplanar(doc), h = CS().hashItems(items), dup = S.versiones.filter(function (v) { return v.hash === h; })[0];
        var pend = items.filter(function (i) { return i.estado === 'pendiente'; }).length;
        var ok = await EDU.ui.modal({ titulo: 'Importar versión', tamano: 'sm',
          contenido: '<p><strong>' + esc(doc.curriculum.nombre || doc.curriculum.version) + '</strong></p><p>' + items.length + ' elementos (' + (items.length - pend) + ' verificados, ' + pend + ' pendientes). Hash ' + esc(h) + '.</p>' +
            (dup ? '<p class="note">Aviso: es idéntica en contenido a «' + esc(dup.nombre) + '».</p>' : '') + '<p class="note">Se guardará como <b>borrador</b>; no sustituye a la versión vigente.</p>',
          botones: [{ texto: 'Cancelar', tipo: 'sec', valor: false }, { texto: 'Importar', tipo: 'amb', valor: true }] }).resultado;
        if (!ok) return;
        var v = await crearVersionDesde(doc, { estado: 'borrador' });
        EDU.ui.toast('Versión importada como borrador: ' + v.nombre, 'ok'); await refrescar(); tabsApi.seleccionar('versiones');
      }
      async function marcarVigente(v) {
        if (!(await EDU.ui.confirmar({ titulo: 'Marcar como vigente', mensaje: '«' + v.nombre + '» pasará a ser la versión vigente; la actual quedará como anterior.', textoOk: 'Marcar vigente' }))) return;
        var NV = EDU.repo.negocio();
        if (NV) await NV.vigente(v.id); // el servidor baja la vigente anterior y sube esta en una transaccion
        else {
        for (var i = 0; i < S.versiones.length; i++) { var x = S.versiones[i]; if (x.estado === 'vigente' && x.id !== v.id) await EDU.repo.guardar('curriculoVersiones', Object.assign({}, x, { estado: 'anterior' })); }
        await EDU.repo.guardar('curriculoVersiones', Object.assign({}, v, { estado: 'vigente', vigenteDesde: v.vigenteDesde || EDU.fmt.hoy() }));
        }
        S.versionId = v.id; EDU.ui.toast('Versión vigente actualizada.', 'ok'); await refrescar(); tabsApi.seleccionar('versiones');
      }
      async function eliminarVersion(v) {
        if (!(await EDU.ui.confirmar({ titulo: 'Eliminar versión', mensaje: '¿Eliminar «' + v.nombre + '» y todos sus elementos?', textoOk: 'Eliminar', peligro: true }))) return;
        try {
          if (!EDU.repo.negocio()) { // modo local: N borrados; en modo API el servidor elimina la version y sus elementos en una transaccion (y rechaza la vigente o la usada por secuencias)
            var its = await itemsDeVersion(v.id);
            for (var i = 0; i < its.length; i++) await EDU.repo.borrar('curriculoContenidos', its[i].id);
          }
          await EDU.repo.borrar('curriculoVersiones', v.id); EDU.ui.toast('Versión eliminada.', 'ok');
        } catch (e) { EDU.ui.toast(e.message || 'No se pudo eliminar la versión.', 'error', 7000); }
        await refrescar(); tabsApi.seleccionar('versiones');
      }
      async function duplicar(v) {
        var its = await itemsDeVersion(v.id), doc = docDeVersion(v, its);
        var nv = await crearVersionDesde(doc, { nombre: v.nombre + ' (copia borrador)', estado: 'borrador', idExterno: (v.idExterno || v.id) + '-copia', vigenteDesde: null });
        EDU.ui.toast('Borrador creado: ' + nv.nombre, 'ok'); await refrescar(); tabsApi.seleccionar('versiones');
      }
      async function metaVersion(v) {
        var ok = await dialogoForm('Datos de la versión', [
          { nombre: 'nombre', label: 'Nombre', requerido: true, maxLen: 160, ancho: 'full' }, { nombre: 'fuente', label: 'Fuente (url)', maxLen: 500, ancho: 'full' },
          { nombre: 'fechaPublicacion', label: 'Fecha de publicación', tipo: 'date' }, { nombre: 'vigenteDesde', label: 'Vigente desde', tipo: 'date' },
          { nombre: 'instrumentoLegal', label: 'Instrumento legal', maxLen: 160, ancho: 'full' }], v, async function (x) {
          if (x.fuente && !/^https?:\/\/\S+$/.test(x.fuente)) throw new Error('La fuente debe ser una url http(s).');
          await EDU.repo.guardar('curriculoVersiones', Object.assign({}, v, { nombre: x.nombre.trim(), fuente: x.fuente || null, fechaPublicacion: x.fechaPublicacion || null, vigenteDesde: x.vigenteDesde || null, instrumentoLegal: x.instrumentoLegal || null }));
        });
        if (ok) { EDU.ui.toast('Versión actualizada.', 'ok'); await refrescar(); tabsApi.seleccionar('versiones'); }
      }
      function tabVersiones(p) {
        p.innerHTML = '<div class="card">' + (puedeEd ? '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label class="btn amb" for="cv-file" style="cursor:pointer" tabindex="-1">Importar versión (JSON)</label>' +
          '<input type="file" id="cv-file" accept="application/json,.json" class="sr-only"><span class="note" style="margin:0">Esquema en docs/CURRICULO-MINERD.md (schemaVersion, curriculum.levels|items…). Se importa como borrador.</span></div>' : '<p class="note">Solo administración de red y dirección pueden importar o cambiar versiones.</p>') +
          '<div id="cv-tabla" style="margin-top:12px"></div></div>';
        var acc = [{ texto: 'Ver catálogo', alClic: async function (v) { S.versionId = v.id; await cargarItems(); pintar(); tabsApi.seleccionar('catalogo'); } },
          { texto: 'Exportar', alClic: async function (v) { var its = await itemsDeVersion(v.id); descargar('curriculo-' + slug(v.nombre) + '.json', JSON.stringify(docDeVersion(v, its), null, 2)); EDU.ui.toast('Exportado.', 'ok'); } }];
        if (puedeEd && S.centroId) acc = acc.concat([
          { texto: 'Marcar vigente', visible: function (v) { return v.estado !== 'vigente'; }, alClic: function (v) { marcarVigente(v).catch(function (e) { EDU.ui.toast(e.message || 'No se pudo marcar como vigente.', 'error', 7000); }); } }, { texto: 'Duplicar', alClic: duplicar }, { texto: 'Datos', alClic: metaVersion },
          { texto: 'Eliminar', tipo: 'dng', visible: function (v) { return v.estado !== 'vigente'; }, alClic: eliminarVersion }]);
        var tb = EDU.ui.tabla({ etiqueta: 'Versiones del currículo', caption: 'Versiones del currículo', buscar: false, porPagina: false, filas: S.versiones, acciones: acc, vacio: { titulo: 'Sin versiones' },
          columnas: [{ clave: 'nombre', titulo: 'Versión', render: function (v) { return '<strong>' + esc(v.nombre) + '</strong><br><small>' + EDU.planUtil.enlaceSeguro(v.fuente) + (v.instrumentoLegal ? ' · ' + esc(v.instrumentoLegal) : '') + '</small>'; } },
            { clave: 'estado', titulo: 'Estado', render: function (v) { return EDU.ui.badge(v.estado, v.estado === 'vigente' ? 'ok' : v.estado === 'borrador' ? 'warn' : 'neu').s; } },
            { clave: 'vigenteDesde', titulo: 'Vigente desde', valor: function (v) { return v.vigenteDesde || ''; }, render: function (v) { return v.vigenteDesde ? esc(f(v.vigenteDesde)) : '<small>sin verificar</small>'; } },
            { clave: 'total', titulo: 'Elementos', align: 'r', valor: function (v) { return v.total || 0; } }, { clave: 'hash', titulo: 'Hash', valor: function (v) { return v.hash || ''; }, render: function (v) { return '<code>' + esc(v.hash || '—') + '</code>'; } }] });
        p.querySelector('#cv-tabla').appendChild(tb.el);
        var fi = p.querySelector('#cv-file');
        if (fi) fi.addEventListener('change', async function () { var fl = fi.files && fi.files[0]; if (!fl) return; try { await importar(fl); } catch (e) { EDU.ui.toast(e.message, 'error', 7000); } fi.value = ''; });
      }

      /* ------- comparar ------- */
      function tabComparar(p) {
        if (S.versiones.length < 2) { p.innerHTML = '<div class="card">' + EDU.ui.vacio({ titulo: 'Se necesitan dos versiones', texto: 'Importa o duplica una versión para compararla con la vigente.' }).s + '</div>'; return; }
        var base = S.versiones.filter(function (v) { return v.estado !== 'vigente'; })[0] || S.versiones[1], nueva = S.versiones.filter(function (v) { return v.estado === 'vigente'; })[0] || S.versiones[0];
        if (base.id === nueva.id) base = S.versiones[1];
        var opc = function (sel) { return EDU.ui.opciones(S.versiones.map(function (x) { return { valor: x.id, texto: x.nombre + ' (' + x.estado + ')' }; }), sel).s; };
        p.innerHTML = '<div class="card"><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end"><label class="fld" style="min-width:240px">Versión base (A)<select id="cp-a">' + opc(base.id) + '</select></label>' +
          '<label class="fld" style="min-width:240px">Versión a comparar (B)<select id="cp-b">' + opc(nueva.id) + '</select></label><button type="button" class="btn" id="cp-go">Comparar</button></div>' +
          '<div id="cp-res" aria-live="polite" style="margin-top:14px"></div></div>';
        async function go() {
          var a = p.querySelector('#cp-a').value, b = p.querySelector('#cp-b').value, res = p.querySelector('#cp-res');
          if (a === b) { res.innerHTML = '<p class="note">Elige dos versiones distintas.</p>'; return; }
          var A = await itemsDeVersion(a), B = await itemsDeVersion(b), mA = {}, mB = {}, filas = [];
          A.forEach(function (i) { mA[i.clave] = i; }); B.forEach(function (i) { mB[i.clave] = i; });
          B.forEach(function (i) {
            var o = mA[i.clave];
            if (!o) filas.push({ cambio: 'añadido', clave: i.clave, tipo: i.tipo, antes: '', despues: i.descripcion + ' [' + i.estado + ']' });
            else {
              var d = ['descripcion', 'estado', 'fuente', 'nivel', 'ciclo', 'grado', 'modalidad', 'areaId'].filter(function (k) { return String(o[k] == null ? '' : o[k]) !== String(i[k] == null ? '' : i[k]); });
              if (d.length) filas.push({ cambio: 'modificado', clave: i.clave, tipo: i.tipo, antes: d.map(function (k) { return k + ': ' + (o[k] == null ? '—' : o[k]); }).join(' | '), despues: d.map(function (k) { return k + ': ' + (i[k] == null ? '—' : i[k]); }).join(' | ') });
            }
          });
          A.forEach(function (i) { if (!mB[i.clave]) filas.push({ cambio: 'quitado', clave: i.clave, tipo: i.tipo, antes: i.descripcion + ' [' + i.estado + ']', despues: '' }); });
          var n = function (c) { return filas.filter(function (x) { return x.cambio === c; }).length; };
          res.innerHTML = '<p><strong>' + n('añadido') + '</strong> añadidos · <strong>' + n('quitado') + '</strong> quitados · <strong>' + n('modificado') + '</strong> modificados · ' + (A.length - n('quitado') - n('modificado')) + ' sin cambios.</p><div id="cp-tb"></div>';
          var tb = EDU.ui.tabla({ etiqueta: 'Diferencias entre versiones', caption: 'Diferencias por id (clave) entre las versiones A y B', filas: filas, porPagina: 15, ordenInicial: 'cambio', vacio: { titulo: 'Sin diferencias', texto: 'Las versiones tienen el mismo contenido.' },
            columnas: [{ clave: 'cambio', titulo: 'Cambio', render: function (r) { return EDU.ui.badge(r.cambio, r.cambio === 'añadido' ? 'ok' : r.cambio === 'quitado' ? 'bad' : 'warn').s; } },
              { clave: 'tipo', titulo: 'Tipo', valor: function (r) { return CS().TIPOS[r.tipo] || r.tipo; } }, { clave: 'clave', titulo: 'Id', render: function (r) { return '<code>' + esc(r.clave) + '</code>'; }, valor: function (r) { return r.clave; } },
              { clave: 'antes', titulo: 'En A' }, { clave: 'despues', titulo: 'En B' }] });
          res.querySelector('#cp-tb').appendChild(tb.el);
        }
        p.querySelector('#cp-go').addEventListener('click', go);
      }

      /* ------- revision ------- */
      function tabRevision(p) {
        var rev = estadoRevision(), v = version();
        var porTipo = {}; S.items.filter(function (i) { return i.estado === 'pendiente'; }).forEach(function (i) { porTipo[i.tipo] = (porTipo[i.tipo] || 0) + 1; });
        p.innerHTML = '<div class="grid two"><div class="card"><h2>Aviso de revisión periódica</h2>' +
          '<p>' + (rev.vencida ? EDU.ui.badge('Vencida', 'bad').s : EDU.ui.badge('Al día', 'ok').s) + ' Última revisión: <strong>' + esc(f(rev.ultima)) + '</strong> · Próxima: <strong>' + esc(f(rev.vence)) + '</strong></p>' +
          '<p class="note">El navegador no puede leer el sitio oficial: la revisión es manual (o la propone un agente y la aprueba una persona). Importa un JSON nuevo cuando cambie el currículo.</p><div id="rv-form"></div></div>' +
          '<div class="card"><h2>Lagunas por validar</h2>' + (Object.keys(porTipo).length ? '<ul>' + Object.keys(porTipo).map(function (k) { return '<li>' + esc(CS().TIPOS[k] || k) + ': <strong>' + porTipo[k] + '</strong> pendientes</li>'; }).join('') + '</ul>' : '<p>Sin pendientes.</p>') +
          '<p class="note">Antes de dar por oficial el catálogo: leer los PDF de los diseños curriculares (Primario ciclos 1 y 2, Secundaria «ida», Inicial) y las ordenanzas 03-2023 y 04-2023 (hosts por habilitar: ministeriodeeducacion.gob.do, minerd.gob.do, educando.edu.do). Detalle en docs/CURRICULO-MINERD.md.</p></div></div>';
        if (!puedeEd) { p.querySelector('#rv-form').innerHTML = '<p class="note">Solo administración de red y dirección configuran el aviso.</p>'; return; }
        var fm = EDU.ui.formulario({ campos: [{ nombre: 'intervaloDias', label: 'Avisar cada (días)', tipo: 'number', entero: true, min: 7, max: 365, requerido: true }, { nombre: 'ultimaRevision', label: 'Última revisión', tipo: 'date' }],
          valores: { intervaloDias: rev.dias, ultimaRevision: rev.ultima || '' }, textoEnviar: 'Guardar aviso', alEnviar: async function (x) {
            if (!S.centroId) throw new Error('Elige un centro activo.');
            await EDU.repo.guardar('curriculoVersiones', Object.assign({}, S.config || { id: 'cvcfg_' + S.centroId, centroId: S.centroId, esConfig: true, nombre: 'Configuración de revisión' }, { intervaloDias: +x.intervaloDias, ultimaRevision: x.ultimaRevision || null }));
            EDU.ui.toast('Aviso configurado.', 'ok'); await refrescar(); tabsApi.seleccionar('revision');
          } });
        p.querySelector('#rv-form').appendChild(fm.el);
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sec'; b.id = 'rv-hoy'; b.textContent = 'Registrar revisión hoy'; b.style.marginTop = '10px';
        b.addEventListener('click', async function () {
          if (!S.centroId) return;
          await EDU.repo.guardar('curriculoVersiones', Object.assign({}, S.config || { id: 'cvcfg_' + S.centroId, centroId: S.centroId, esConfig: true, nombre: 'Configuración de revisión' }, { intervaloDias: rev.dias, ultimaRevision: EDU.fmt.hoy() }));
          EDU.ui.toast('Revisión registrada.', 'ok'); await refrescar(); tabsApi.seleccionar('revision');
        });
        p.querySelector('#rv-form').appendChild(b);
      }

      root = cont;
      await cargarVersiones(); await cargarItems(); pintar();
    }
  });
})();
