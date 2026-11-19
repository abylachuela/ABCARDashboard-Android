/* Vista "comunicados": comunicados segmentados (centro / curso / seccion / tutor) con ayuda opcional del agente (aprobacion humana)
   y confirmacion de lectura por destinatario. Gestionan: admin_red, director, secretaria. Docente/tutor/estudiante ven solo lo suyo.
   Modelo: {titulo, cuerpo, destinatarios:'todos|docentes|tutores|estudiantes', segmento:{tipo:'centro|curso|seccion|tutor', id}, estado:'borrador|publicado',
   fecha, autorId, lecturas:[{usuarioId, fecha}], origen?:'agente', agenteLogId?}. Sin `segmento` (semilla) = todo el centro. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, ui = EDU.ui, fmt = EDU.fmt;
  var COLS = ['comunicados', 'usuarios', 'cursos', 'secciones', 'cargas', 'matriculas', 'tutores', 'estudiantes'];
  var AUD = { todos: 'Todos', docentes: 'Docentes', tutores: 'Tutores', estudiantes: 'Estudiantes' };
  var SEG = { centro: 'Todo el centro', curso: 'Un curso', seccion: 'Una sección', tutor: 'Un tutor/a' };
  var ROL_AUD = { docente: 'docentes', tutor: 'tutores', estudiante: 'estudiantes' };

  function porId(l, id) { return l.filter(function (x) { return x.id === id; })[0]; }
  function seg(c) { return c.segmento && c.segmento.tipo ? c.segmento : { tipo: 'centro', id: null }; }

  /** Contexto de un usuario: secciones/cursos relevantes y su refId (para segmentacion). */
  function ctxDe(d, u) {
    var al = EDU.permisos.alcance({ rol: u.rol, refId: u.refId }, d), secIds = al.seccionIds ? Array.from(al.seccionIds) : [];
    var cursoIds = secIds.map(function (sid) { var s = porId(d.secciones, sid); return s && s.cursoId; }).filter(Boolean);
    return { rol: u.rol, refId: u.refId, usuarioId: u.id, secIds: secIds, cursoIds: cursoIds };
  }
  function esDestinatario(c, x) {
    if (c.estado !== 'publicado') return false;
    var sg = seg(c);
    if (sg.tipo === 'tutor') return x.rol === 'tutor' && x.refId === sg.id;
    var aud = c.destinatarios || 'todos';
    if (aud !== 'todos' && ROL_AUD[x.rol] !== aud) return false;
    if (!ROL_AUD[x.rol]) return false;
    if (sg.tipo === 'curso') return x.cursoIds.indexOf(sg.id) !== -1;
    if (sg.tipo === 'seccion') return x.secIds.indexOf(sg.id) !== -1;
    return true;
  }
  function leido(c, uid) { return (c.lecturas || []).some(function (l) { return l.usuarioId === uid; }); }
  function etiquetaSeg(d, c) {
    var sg = seg(c), n = '';
    if (sg.tipo === 'curso') { var cu = porId(d.cursos, sg.id); n = cu ? cu.nombre : sg.id; }
    else if (sg.tipo === 'seccion') { var se = porId(d.secciones, sg.id), cu2 = se && porId(d.cursos, se.cursoId); n = se ? (cu2 ? cu2.nombre + ' ' : '') + se.nombre : sg.id; }
    else if (sg.tipo === 'tutor') n = fmt.nombreCompleto(porId(d.tutores, sg.id)) || sg.id;
    return (sg.tipo === 'centro' ? AUD[c.destinatarios || 'todos'] + ' · todo el centro' : (AUD[c.destinatarios || 'todos'] + ' · ' + n));
  }

  /* ---------------- Editor (managers) ---------------- */
  async function editor(d, c, alGuardar) {
    var s = EDU.estado.sesion(), nuevo = !c; c = c || { destinatarios: 'todos', segmento: { tipo: 'centro', id: null }, titulo: '', cuerpo: '' };
    var sg = seg(c), disp = await EDU.agente.disponible('redactar_comunicado'), agLog = null;
    var form = document.createElement('form'); form.noValidate = true; form.setAttribute('aria-label', nuevo ? 'Nuevo comunicado' : 'Editar comunicado');
    var cursosOp = d.cursos.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.nombre) + '</option>'; }).join('');
    var secOp = d.secciones.map(function (x) { var cu = porId(d.cursos, x.cursoId); return '<option value="' + esc(x.id) + '">' + esc((cu ? cu.nombre : '') + ' ' + x.nombre) + '</option>'; }).join('');
    var tutOp = d.tutores.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(fmt.nombreCompleto(x)) + '</option>'; }).join('');
    form.innerHTML = '<div class="fgrid"><label class="fld full">Título<input id="cTit" maxlength="120" required aria-required="true" value="' + esc(c.titulo) + '"><span class="err" id="cTitE"></span></label>' +
      '<label class="fld">Destinatarios<select id="cAud">' + Object.keys(AUD).map(function (k) { return '<option value="' + k + '"' + ((c.destinatarios || 'todos') === k ? ' selected' : '') + '>' + esc(AUD[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld">Alcance<select id="cSeg">' + Object.keys(SEG).map(function (k) { return '<option value="' + k + '"' + (sg.tipo === k ? ' selected' : '') + '>' + esc(SEG[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld full" id="cWId" hidden>Segmento<select id="cId"></select><span class="err" id="cIdE"></span></label>' +
      '<label class="fld full">Mensaje<textarea id="cCue" maxlength="2000" rows="7" required aria-required="true">' + esc(c.cuerpo) + '</textarea><span class="err" id="cCueE"></span></label></div>' +
      '<div id="cAg" class="note" aria-live="polite"></div><div class="form-error" id="cErr" role="alert" hidden></div>' +
      '<div class="form-actions"><button type="button" class="btn sec" id="cAy"' + (disp.ok ? '' : ' disabled title="' + esc(disp.motivo || '') + '"') + '>Redactar con el agente</button><span style="flex:1"></span><button type="button" class="btn sec" data-e="borrador">Guardar borrador</button><button type="button" class="btn amb" data-e="publicado">Publicar</button></div>';
    var $ = function (id) { return form.querySelector('#' + id); };
    function ajustar() {
      var t = $('cSeg').value, w = $('cWId'), sel = $('cId');
      w.hidden = t === 'centro';
      sel.innerHTML = t === 'curso' ? cursosOp : t === 'seccion' ? secOp : t === 'tutor' ? tutOp : '';
      if (t === sg.tipo && sg.id) sel.value = sg.id;
      if (t === 'tutor') { $('cAud').value = 'tutores'; $('cAud').disabled = true; } else $('cAud').disabled = false;
    }
    $('cSeg').addEventListener('change', ajustar); ajustar();
    var m = ui.modal({ titulo: nuevo ? 'Nuevo comunicado' : 'Editar comunicado', tamano: 'lg', contenido: form });
    $('cAy').addEventListener('click', async function () {
      var tema = $('cTit').value.trim();
      if (!tema) { $('cTitE').textContent = 'Escriba primero un título o tema para que el agente redacte.'; $('cTit').setAttribute('aria-invalid', 'true'); $('cTit').focus(); return; }
      $('cTitE').textContent = ''; $('cTit').removeAttribute('aria-invalid');
      var box = $('cAg'); box.textContent = 'Consultando al agente…'; $('cAy').disabled = true;
      try {
        agLog = await EDU.agente.solicitar('redactar_comunicado', { texto: tema, audiencia: AUD[$('cAud').value].toLowerCase() }, { sinAuto: true });
        var p = agLog.propuesta;
        box.innerHTML = '<div class="alert"><div><strong>Propuesta del agente (requiere su aprobación)</strong><small style="white-space:pre-wrap;display:block">' + esc(p.cuerpo) + '</small>' +
          '<span class="form-actions" style="justify-content:flex-start"><button type="button" class="btn amb sm" id="agOk">Aprobar y usar texto</button><button type="button" class="btn sec sm" id="agNo">Rechazar</button></span></div></div>';
        $('agOk').addEventListener('click', async function () {
          try { await EDU.agente.aprobar(agLog.id, { aplicar: false }); $('cCue').value = p.cuerpo; box.textContent = 'Texto aprobado y aplicado al mensaje. Revíselo antes de publicar.'; ui.toast('Texto del agente aprobado', 'ok'); $('cCue').focus(); }
          catch (e) { box.textContent = e.message; agLog = null; }
        });
        $('agNo').addEventListener('click', async function () { try { await EDU.agente.rechazar(agLog.id); } catch (e) { /* ya resuelta */ } agLog = null; box.textContent = 'Propuesta rechazada.'; });
      } catch (e) { box.textContent = e.message; }
      $('cAy').disabled = false;
    });
    form.addEventListener('click', async function (ev) {
      var b = ev.target.closest('button[data-e]'); if (!b) return;
      var er = $('cErr'), ok = true; er.hidden = true; ['cTit', 'cCue', 'cId'].forEach(function (i) { $(i).removeAttribute('aria-invalid'); });
      $('cTitE').textContent = ''; $('cCueE').textContent = ''; $('cIdE').textContent = '';
      var tit = $('cTit').value.trim(), cue = $('cCue').value.trim(), tipo = $('cSeg').value, id = tipo === 'centro' ? null : $('cId').value;
      if (tit.length < 3) { $('cTitE').textContent = 'El título debe tener al menos 3 caracteres.'; $('cTit').setAttribute('aria-invalid', 'true'); ok = false; }
      if (cue.length < 5) { $('cCueE').textContent = 'El mensaje debe tener al menos 5 caracteres.'; $('cCue').setAttribute('aria-invalid', 'true'); ok = false; }
      if (tipo !== 'centro' && !id) { $('cIdE').textContent = 'Elija un segmento.'; $('cId').setAttribute('aria-invalid', 'true'); ok = false; }
      if (!ok) { var p0 = form.querySelector('[aria-invalid=true]'); if (p0) p0.focus(); return; }
      if (agLog) { try { var l = await EDU.repo.obtener('agenteLog', agLog.id); if (l && l.estado !== 'aprobada') agLog = null; } catch (e) { agLog = null; } }
      var reg = Object.assign({}, c, { titulo: tit, cuerpo: cue, destinatarios: $('cAud').value, segmento: { tipo: tipo, id: id }, estado: b.dataset.e, autorId: c.autorId || s.usuarioId, lecturas: c.lecturas || [],
        fecha: b.dataset.e === 'publicado' && (nuevo || c.estado !== 'publicado') ? fmt.hoy() : (c.fecha || fmt.hoy()) });
      if (agLog) { reg.origen = 'agente'; reg.agenteLogId = agLog.id; reg.aprobadoPor = s.usuarioId; }
      if (!reg.centroId) reg.centroId = EDU.estado.centroActivo();
      try { await EDU.repo.guardar('comunicados', reg); ui.toast(b.dataset.e === 'publicado' ? 'Comunicado publicado' : 'Borrador guardado', 'ok'); m.cerrar(true); alGuardar(); }
      catch (e) { er.textContent = e.message; er.hidden = false; }
    });
  }

  /* ---------------- Lectura ---------------- */
  /** Confirmacion de lectura: ruta controlada del repo (valida sesion, centro y que el comunicado sea visible; solo anade al propio usuario). */
  async function confirmarLectura(c) { await EDU.repo.registrarLectura(c.id); }
  function verCuerpo(d, c, extra, botones) {
    return ui.modal({ titulo: c.titulo, tamano: 'lg', contenido: '<p class="note">' + esc(fmt.fecha(c.fecha, true)) + ' · ' + esc(etiquetaSeg(d, c)) + (c.origen === 'agente' ? ' · redactado con ayuda del agente, aprobado por una persona' : '') + '</p><p style="white-space:pre-wrap">' + esc(c.cuerpo) + '</p>' + (extra || ''),
      botones: botones || [{ texto: 'Cerrar', tipo: 'amb', valor: true }] });
  }

  /* ---------------- Vista ---------------- */
  EDU.router.register('comunicados', {
    titulo: 'Comunicados',
    render: async function (cont) {
      var s = EDU.estado.sesion(), gestiona = EDU.permisos.puede(s.rol, 'comunicados', 'crear'), puedeBorrar = EDU.permisos.puede(s.rol, 'comunicados', 'borrar');
      var d = await EDU.consultas.cargar(COLS);
      var cid = EDU.estado.centroActivo();
      function cab(desc, acciones) { return ui.cabecera({ eyebrow: 'Comunicación', titulo: 'Comunicados', descripcion: desc, acciones: acciones }).toString(); }

      if (gestiona) {
        var staff = d.usuarios.filter(function (u) { return ROL_AUD[u.rol]; }), ctxs = staff.map(function (u) { return ctxDe(d, u); });
        var filas = d.comunicados.slice().sort(function (a, b) { return (a.fecha < b.fecha ? 1 : -1); }).map(function (c) {
          var dest = ctxs.filter(function (x) { return esDestinatario(c, x) && (!c.centroId || (porId(d.usuarios, x.usuarioId) || {}).centroId === c.centroId); });
          var leidos = dest.filter(function (x) { return leido(c, x.usuarioId); }).length;
          return Object.assign({}, c, { alcanceTxt: etiquetaSeg(d, c), nDest: dest.length, nLeidos: leidos });
        });
        cont.innerHTML = cab(cid ? 'Redacte, segmente y publique. Las confirmaciones de lectura se cuentan por destinatario.' : 'Vista de toda la red. Elija un centro para crear comunicados.',
          cid ? '<button type="button" class="btn amb" id="cNuevo">Nuevo comunicado</button>' : '') + '<div class="card"><div id="cT"></div></div>';
        function recargar() { EDU.router.recargar(); }
        var tabla = ui.tabla({ caption: 'Comunicados del centro', filas: filas, ordenInicial: 'fecha', desc: true, porPagina: 10, vacio: { titulo: 'Aún no hay comunicados' },
          columnas: [{ clave: 'fecha', titulo: 'Fecha', formato: function (v) { return fmt.fecha(v); } }, { clave: 'titulo', titulo: 'Título' }, { clave: 'alcanceTxt', titulo: 'Destinatarios' },
            { clave: 'estado', titulo: 'Estado', render: function (c) { return ui.badge(c.estado === 'publicado' ? 'Publicado' : 'Borrador', c.estado === 'publicado' ? 'ok' : 'neu'); } },
            { clave: 'nLeidos', titulo: 'Lecturas', align: 'c', render: function (c) { return c.estado === 'publicado' ? esc(c.nLeidos + ' de ' + c.nDest) : '—'; } }],
          acciones: [{ texto: 'Ver', alClic: function (c) {
            var quienes = ctxs.filter(function (x) { return esDestinatario(c, x); }).map(function (x) { var u = porId(d.usuarios, x.usuarioId); return '<li>' + esc(u.nombre) + ' (' + esc(EDU.permisos.etiquetaRol(u.rol)) + '): ' + (leido(c, x.usuarioId) ? 'leído' : 'sin confirmar') + '</li>'; }).join('');
            verCuerpo(d, c, c.estado === 'publicado' ? '<h3>Confirmaciones</h3><ul>' + (quienes || '<li>Sin destinatarios</li>') + '</ul>' : '');
          } }, { texto: 'Editar', tipo: 'sec', visible: function () { return EDU.permisos.puede(s.rol, 'comunicados', 'editar') && !!cid; }, alClic: function (c) { editor(d, d.comunicados.filter(function (x) { return x.id === c.id; })[0], recargar); } },
          { texto: 'Eliminar', tipo: 'dng', visible: function () { return puedeBorrar; }, alClic: async function (c) {
            if (await ui.confirmar({ titulo: 'Eliminar comunicado', mensaje: '«' + c.titulo + '» se eliminará definitivamente.', textoOk: 'Eliminar', peligro: true })) { await EDU.repo.borrar('comunicados', c.id); ui.toast('Comunicado eliminado', 'ok'); recargar(); }
          } }] });
        cont.querySelector('#cT').appendChild(tabla.el);
        var nb = cont.querySelector('#cNuevo'); if (nb) nb.addEventListener('click', function () { editor(d, null, recargar); });
        return;
      }

      // Docente / tutor / estudiante: solo lo suyo
      var u = { rol: s.rol, refId: s.refId, usuarioId: s.usuarioId, centroUsuario: s.centroUsuario }, x = ctxDe(d, { id: s.usuarioId, rol: s.rol, refId: s.refId });
      var mios = d.comunicados.filter(function (c) { return esDestinatario(c, x); }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
      var sin = mios.filter(function (c) { return !leido(c, s.usuarioId); }).length;
      cont.innerHTML = cab(sin ? 'Tiene ' + fmt.plural(sin, 'comunicado') + ' sin confirmar.' : 'Está al día con sus comunicados.') + '<div class="card"><div id="cT"></div></div>';
      function pintar() {
        var filas2 = mios.map(function (c) { return Object.assign({}, c, { leidoSt: leido(c, s.usuarioId) ? 'Leído' : 'Sin leer', alcanceTxt: etiquetaSeg(d, c) }); });
        var t = ui.tabla({ caption: 'Mis comunicados', filas: filas2, ordenInicial: 'fecha', desc: true, porPagina: 10, vacio: { titulo: 'No tiene comunicados' },
          columnas: [{ clave: 'fecha', titulo: 'Fecha', formato: function (v) { return fmt.fecha(v); } }, { clave: 'titulo', titulo: 'Título' },
            { clave: 'leidoSt', titulo: 'Lectura', render: function (c) { return ui.badge(c.leidoSt, c.leidoSt === 'Leído' ? 'ok' : 'warn'); } }],
          acciones: [{ texto: 'Leer', alClic: async function (c) {
            var ya = leido(c, s.usuarioId);
            var m = verCuerpo(d, c, '', ya ? [{ texto: 'Cerrar', tipo: 'sec', valor: false }] : [{ texto: 'Cerrar', tipo: 'sec', valor: false }, { texto: 'Confirmar lectura', tipo: 'amb', valor: true }]);
            if ((await m.resultado) === true) {
              try { await confirmarLectura(c, u); (c.lecturas = c.lecturas || []).push({ usuarioId: s.usuarioId, fecha: new Date().toISOString() }); ui.toast('Lectura confirmada', 'ok'); EDU.router.recargar(); }
              catch (e) { ui.toast(e.message, 'error'); }
            }
          } }] });
        var box = cont.querySelector('#cT'); box.innerHTML = ''; box.appendChild(t.el);
      }
      pintar();
    }
  });
})();
