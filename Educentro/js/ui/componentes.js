/* EDU.ui: componentes reutilizables.
   Convencion: helpers ESTATICOS (badge, kpi, vacio, cabecera, barras, icono) devuelven EDU.Safe (HTML ya seguro,
   componible dentro de EDU.html``); los INTERACTIVOS (tabla, modal, formulario, tabs, paginacion) devuelven objetos con `.el`. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, raw = EDU.raw, uid = 0;

  function aHtml(x) { return x instanceof EDU.Safe ? x.s : (x == null ? '' : String(x)); } // string -> se asume HTML confiable
  function el(html) { var t = document.createElement('template'); t.innerHTML = aHtml(html).trim(); return t.content.firstElementChild; }
  function nodo(c) { if (c instanceof Node) return c; var d = document.createElement('div'); d.innerHTML = aHtml(c); return d; }
  function enfocables(r) { return r.querySelectorAll('input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href]'); }

  var ICONOS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    centros: '<path d="M3 10l9-6 9 6M5 10v9h14v-9M9 19v-5h6v5"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    curriculo: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 19a2 2 0 012-2h13M9 7h6"/>',
    personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c2.4.6 4 2.2 4 5.2"/>',
    matricula: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>',
    notas: '<path d="M4 4h16v16H4zM4 10h16M10 4v16"/>',
    planificacion: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>',
    agente: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    asistencia: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    boletin: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7"/>',
    comunicados: '<path d="M3 11v3a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 9a4 4 0 010 6M18 6a8 8 0 010 12"/>',
    reportes: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    respaldo: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    salir: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };

  var ui = {
    el: el,
    /** Pinta contenido (Node | HTML) dentro de un contenedor reemplazando lo anterior. */
    montar: function (cont, c) { cont.innerHTML = ''; cont.appendChild(c instanceof Node ? c : nodo(c)); return cont; },
    icono: function (n, px) { return raw('<svg viewBox="0 0 24 24" width="' + (px || 20) + '" height="' + (px || 20) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONOS[n] || ICONOS.dashboard) + '</svg>'); },
    /** badge(texto, tipo:'ok'|'bad'|'warn'|'info'|'neu') */
    badge: function (t, tipo) { return raw('<span class="badge ' + esc(tipo || 'neu') + '">' + esc(t) + '</span>'); },
    chip: function (t, amb) { return raw('<span class="chip' + (amb ? ' amb' : '') + '">' + esc(t) + '</span>'); },
    /** kpi({etiqueta, valor, detalle, tono:'ok'|'bad'|'neu'}) -> tarjeta */
    kpi: function (o) {
      return raw('<div class="card kpi"><div class="l">' + esc(o.etiqueta) + '</div><div class="v">' + esc(o.valor) + '</div>' +
        (o.detalle ? '<div class="d ' + (o.tono === 'bad' ? 'neg' : o.tono === 'neu' ? 'neu' : '') + '">' + esc(o.detalle) + '</div>' : '') + '</div>');
    },
    kpis: function (lista) { return raw('<div class="grid kpis">' + lista.map(function (k) { return aHtml(ui.kpi(k)); }).join('') + '</div>'); },
    /** vacio({titulo, texto, accion:{texto, href}}) */
    vacio: function (o) {
      return raw('<div class="vacio"><h3>' + esc(o.titulo || 'Sin datos') + '</h3>' + (o.texto ? '<p>' + esc(o.texto) + '</p>' : '') +
        (o.accion ? '<a class="btn amb" href="' + esc(o.accion.href || '#') + '">' + esc(o.accion.texto) + '</a>' : '') + '</div>');
    },
    /** cabecera({eyebrow, titulo, descripcion, acciones:Safe|html}) -> bloque .head (un solo <h1> por vista) */
    cabecera: function (o) {
      return raw('<div class="head"><div class="head-row"><div>' + (o.eyebrow ? '<div class="eyebrow">' + esc(o.eyebrow) + '</div>' : '') + '<h1>' + esc(o.titulo) + '</h1>' +
        (o.descripcion ? '<p>' + esc(o.descripcion) + '</p>' : '') + '</div>' + (o.acciones ? '<div class="toolbar" style="margin:0">' + aHtml(o.acciones) + '</div>' : '') + '</div></div>');
    },
    /** barras([{etiqueta, valor(0-100), texto?, destacado?}], {etiqueta aria}) -> grafico de barras */
    barras: function (items, o) {
      var b = items.map(function (i) {
        return '<div class="bar' + (i.destacado ? ' hi' : '') + '"><span class="n">' + esc(i.texto != null ? i.texto : Math.round(i.valor)) + '</span><b style="height:' + Math.max(2, Math.min(100, i.valor || 0)) + '%"></b></div>';
      }).join('');
      var l = items.map(function (i) { return '<span>' + esc(i.etiqueta) + '</span>'; }).join('');
      return raw('<div class="bars" role="img" aria-label="' + esc((o && o.aria) || 'Grafico de barras: ' + items.map(function (i) { return i.etiqueta + ' ' + (i.texto != null ? i.texto : Math.round(i.valor)); }).join(', ')) + '">' + b + '</div><div class="xl" aria-hidden="true">' + l + '</div>');
    },
    /** progreso({etiqueta, valor(0-100), texto, minimo(0-100)}) -> fila con barra horizontal y marca de minimo */
    progreso: function (o) {
      var ok = o.valor == null || o.valor >= (o.minimo == null ? 0 : o.minimo);
      return raw('<div class="row"><span>' + esc(o.etiqueta) + '</span><div class="track" style="--min:' + (o.minimo == null ? 60 : o.minimo) + '%"><i class="' + (ok ? '' : 'bad') + '" style="width:' + Math.max(0, Math.min(100, o.valor || 0)) + '%"></i></div><b>' + esc(o.texto != null ? o.texto : Math.round(o.valor || 0)) + '</b></div>');
    },
    /** opciones(lista, seleccionado) -> <option>s. lista: [{valor,texto}] | [string] */
    opciones: function (lista, sel) {
      return raw(lista.map(function (o) {
        var v = o && typeof o === 'object' ? o.valor : o, t = o && typeof o === 'object' ? o.texto : o;
        return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(t) + '</option>';
      }).join(''));
    },

    /* ---------------- toast ---------------- */
    /** toast(mensaje, tipo:'info'|'ok'|'error'|'warn', ms=4500). Region aria-live; texto siempre escapado. */
    toast: function (msg, tipo, ms) {
      var c = document.getElementById('toasts');
      if (!c) { c = document.createElement('div'); c.id = 'toasts'; c.className = 'toasts'; c.setAttribute('aria-live', 'polite'); c.setAttribute('aria-atomic', 'false'); document.body.appendChild(c); }
      var t = document.createElement('div');
      t.className = 'toast ' + (tipo || 'info'); t.setAttribute('role', tipo === 'error' ? 'alert' : 'status'); t.textContent = msg;
      c.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 4500);
      return t;
    },

    /* ---------------- modal ---------------- */
    /**
     * modal({titulo, contenido:Node|html, botones:[{texto, valor, tipo:'amb'|'sec'|'dng'|'', alClic?(cerrar)}], tamano:'sm'|'lg', cerrarFuera:true})
     * -> {el, cuerpo, cerrar(valor), resultado:Promise<valor|null>}. Esc/X/fondo cierran con null. Devuelve el foco al abrir.
     */
    modal: function (o) {
      var previo = document.activeElement, dlg = document.createElement('dialog'), id = 'mt' + (++uid), res, fin = false;
      dlg.className = 'modal ' + (o.tamano || '');
      dlg.setAttribute('aria-labelledby', id);
      dlg.innerHTML = '<div class="modal-box"><div class="modal-head"><h2 id="' + id + '">' + esc(o.titulo || '') + '</h2><button type="button" class="modal-x" aria-label="Cerrar">&times;</button></div><div class="modal-body"></div><div class="modal-foot"></div></div>';
      var cuerpo = dlg.querySelector('.modal-body'), pie = dlg.querySelector('.modal-foot'), valor = null;
      cuerpo.appendChild(o.contenido instanceof Node ? o.contenido : nodo(o.contenido || ''));
      var promesa = new Promise(function (r) { res = r; });
      function cerrar(v) { valor = v === undefined ? null : v; if (dlg.open) dlg.close(); else fin_(); }
      function fin_() { if (fin) return; fin = true; if (dlg.parentNode) dlg.parentNode.removeChild(dlg); try { if (previo && previo.focus) previo.focus(); } catch (e) { /* nada */ } res(valor); }
      (o.botones || []).forEach(function (b) {
        var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'btn ' + (b.tipo || ''); bt.textContent = b.texto;
        bt.addEventListener('click', function () { if (b.alClic) b.alClic(cerrar); else cerrar(b.valor === undefined ? true : b.valor); });
        pie.appendChild(bt);
      });
      if (!pie.children.length) pie.parentNode.removeChild(pie);
      dlg.querySelector('.modal-x').addEventListener('click', function () { cerrar(null); });
      dlg.addEventListener('close', fin_);
      dlg.addEventListener('click', function (e) { if (e.target === dlg && o.cerrarFuera !== false) cerrar(null); });
      document.body.appendChild(dlg);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      var f = dlg.querySelector('[autofocus]') || enfocables(cuerpo)[0] || pie.querySelector('button.amb') || pie.querySelector('button') || dlg.querySelector('.modal-x');
      if (f) f.focus();
      return { el: dlg, cuerpo: cuerpo, cerrar: cerrar, resultado: promesa };
    },
    /** confirmar({titulo, mensaje, textoOk, textoCancelar, peligro}) -> Promise<boolean> */
    confirmar: function (o) {
      var m = ui.modal({ titulo: o.titulo || 'Confirmar', tamano: 'sm', contenido: raw('<p style="margin:4px 0">' + esc(o.mensaje || '') + '</p>'),
        botones: [{ texto: o.textoCancelar || 'Cancelar', tipo: 'sec', valor: false }, { texto: o.textoOk || 'Aceptar', tipo: o.peligro ? 'dng' : 'amb', valor: true }] });
      return m.resultado.then(function (v) { return v === true; });
    },

    /* ---------------- formulario ---------------- */
    /**
     * formulario({campos:[{nombre,label,tipo:'text'|'number'|'email'|'date'|'select'|'textarea'|'checkbox'|'password',
     *   requerido,opciones,ayuda,placeholder,min,max,minLen,maxLen,patron,custom,ancho:'full',valor,deshabilitado}],
     *   valores, alEnviar(valores)->Promise|void, alCancelar, textoEnviar, sinBotones})
     * -> {el, valores(), validar()->bool, enviar(), setErrores({campo:msg}), enfocar()}
     */
    formulario: function (o) {
      var fid = 'f' + (++uid), valores = o.valores || {}, form = document.createElement('form'), campos = o.campos;
      form.noValidate = true; form.className = 'form';
      var html = '<div class="form-error hidden" role="alert" id="' + fid + '-gen"></div><div class="fgrid">';
      campos.forEach(function (c) {
        var id = fid + '-' + c.nombre, v = valores[c.nombre] !== undefined ? valores[c.nombre] : (c.valor !== undefined ? c.valor : ''), tipo = c.tipo || 'text';
        var desc = id + '-err' + (c.ayuda ? ' ' + id + '-h' : ''), at = ' id="' + id + '" name="' + esc(c.nombre) + '" aria-describedby="' + desc + '"' + (c.requerido ? ' required aria-required="true"' : '') + (c.deshabilitado ? ' disabled' : '');
        var ctl;
        if (tipo === 'select') {
          ctl = '<select' + at + '><option value="">Seleccionar…</option>' + aHtml(ui.opciones(c.opciones || [], v)) + '</select>';
        } else if (tipo === 'textarea') {
          ctl = '<textarea' + at + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '') + '>' + esc(v) + '</textarea>';
        } else if (tipo === 'checkbox') {
          ctl = '<label class="opt"><input type="checkbox"' + at + (v ? ' checked' : '') + '>' + esc(c.label) + '</label>';
        } else {
          ctl = '<input type="' + (tipo === 'number' ? 'text" inputmode="decimal' : esc(tipo)) + '"' + at + ' value="' + esc(v) + '"' + (c.placeholder ? ' placeholder="' + esc(c.placeholder) + '"' : '') + '>';
        }
        html += '<div class="fld' + (c.ancho === 'full' || tipo === 'textarea' ? ' full' : '') + '">' + (tipo === 'checkbox' ? '' : '<label for="' + id + '">' + esc(c.label) + (c.requerido ? ' *' : '') + '</label>') + ctl +
          (c.ayuda ? '<span class="help" id="' + id + '-h">' + esc(c.ayuda) + '</span>' : '') + '<span class="err" id="' + id + '-err"></span></div>';
      });
      html += '</div>';
      if (!o.sinBotones) html += '<div class="form-actions">' + (o.alCancelar ? '<button type="button" class="btn sec" data-cancel>Cancelar</button>' : '') + '<button type="submit" class="btn amb">' + esc(o.textoEnviar || 'Guardar') + '</button></div>';
      form.innerHTML = html;

      function esquema() {
        var s = {};
        campos.forEach(function (c) {
          var t = c.tipo === 'number' ? (c.entero ? 'entero' : 'numero') : c.tipo === 'email' ? 'email' : c.tipo === 'date' ? 'fecha' : c.tipo === 'select' ? 'select' : c.tipo === 'checkbox' ? 'booleano' : 'texto';
          s[c.nombre] = { label: c.label, requerido: c.requerido, tipo: t, min: c.min, max: c.max, minLen: c.minLen, maxLen: c.maxLen, patron: c.patron, mensajePatron: c.mensajePatron, custom: c.custom,
            opciones: c.opciones && c.opciones.map(function (x) { return x && typeof x === 'object' ? x.valor : x; }) };
        });
        return s;
      }
      function leer() {
        var v = {};
        campos.forEach(function (c) { var e = form.elements[c.nombre]; v[c.nombre] = !e ? null : (c.tipo === 'checkbox' ? e.checked : e.value); });
        return v;
      }
      function setErrores(errs) {
        errs = errs || {};
        campos.forEach(function (c) {
          var e = form.elements[c.nombre], s = document.getElementById(fid + '-' + c.nombre + '-err');
          if (!e) return;
          if (errs[c.nombre]) { e.setAttribute('aria-invalid', 'true'); s.textContent = errs[c.nombre]; } else { e.removeAttribute('aria-invalid'); s.textContent = ''; }
        });
        var g = document.getElementById(fid + '-gen');
        if (g) { g.textContent = errs._general || ''; g.classList.toggle('hidden', !errs._general); }
      }
      function validar() {
        var r = EDU.validacion.validar(leer(), esquema());
        setErrores(r.errores);
        if (!r.ok) { var p = campos.filter(function (c) { return r.errores[c.nombre]; })[0]; var e = p && form.elements[p.nombre]; if (e) e.focus(); }
        return r;
      }
      var api = {
        el: form,
        valores: function () { return EDU.validacion.validar(leer(), esquema()).valores; },
        validar: function () { return validar().ok; },
        setErrores: setErrores,
        enfocar: function () { var e = enfocables(form)[0]; if (e) e.focus(); },
        enviar: async function () {
          var r = validar();
          if (!r.ok) return false;
          var btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
          try { if (o.alEnviar) await o.alEnviar(r.valores); return true; }
          catch (err) { setErrores({ _general: (err && err.message) || 'No se pudo guardar.' }); return false; }
          finally { if (btn) btn.disabled = false; }
        }
      };
      form.addEventListener('submit', function (e) { e.preventDefault(); api.enviar(); });
      var cb = form.querySelector('[data-cancel]'); if (cb) cb.addEventListener('click', function () { if (o.alCancelar) o.alCancelar(); });
      return api;
    },
    /** formularioModal({titulo, campos, valores, textoEnviar, tamano}) -> Promise<valores|null> */
    formularioModal: function (o) {
      var m, f = ui.formulario({ campos: o.campos, valores: o.valores, sinBotones: true, alEnviar: function (v) { m.cerrar(v); } });
      m = ui.modal({ titulo: o.titulo, tamano: o.tamano, contenido: f.el,
        botones: [{ texto: 'Cancelar', tipo: 'sec', valor: null }, { texto: o.textoEnviar || 'Guardar', tipo: 'amb', alClic: function () { f.enviar(); } }] });
      return m.resultado;
    },

    /* ---------------- tabs ---------------- */
    /** tabs({tabs:[{id,titulo,render(panel)}], activa, alCambiar(id), etiqueta}) -> {el, seleccionar(id)} */
    tabs: function (o) {
      var base = 'tb' + (++uid), raiz = document.createElement('div'), lista = document.createElement('div'), paneles = {}, hechos = {}, actual = null;
      lista.className = 'tabs'; lista.setAttribute('role', 'tablist'); lista.setAttribute('aria-label', o.etiqueta || 'Secciones');
      raiz.appendChild(lista);
      var btns = o.tabs.map(function (t) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = base + '-t-' + t.id; b.setAttribute('aria-controls', base + '-p-' + t.id); b.textContent = t.titulo;
        b.addEventListener('click', function () { api.seleccionar(t.id, true); });
        lista.appendChild(b);
        var p = document.createElement('div'); p.setAttribute('role', 'tabpanel'); p.id = base + '-p-' + t.id; p.setAttribute('aria-labelledby', b.id); p.hidden = true; raiz.appendChild(p); paneles[t.id] = p;
        return b;
      });
      lista.addEventListener('keydown', function (e) {
        var i = btns.indexOf(document.activeElement); if (i < 0) return;
        var n = e.key === 'ArrowRight' ? (i + 1) % btns.length : e.key === 'ArrowLeft' ? (i - 1 + btns.length) % btns.length : e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : -1;
        if (n >= 0) { e.preventDefault(); btns[n].focus(); api.seleccionar(o.tabs[n].id, true); }
      });
      var api = {
        el: raiz,
        actual: function () { return actual; },
        seleccionar: function (id, aviso) {
          o.tabs.forEach(function (t, i) {
            var on = t.id === id; btns[i].setAttribute('aria-selected', on); btns[i].tabIndex = on ? 0 : -1; paneles[t.id].hidden = !on;
            if (on && (!hechos[t.id] || o.siempre)) { hechos[t.id] = true; paneles[t.id].innerHTML = ''; var r = t.render(paneles[t.id]); if (r && r.catch) r.catch(console.error); }
          });
          actual = id; if (aviso && o.alCambiar) o.alCambiar(id);
        }
      };
      api.seleccionar(o.activa || o.tabs[0].id);
      return api;
    },

    /* ---------------- paginacion ---------------- */
    /** paginacion({total, porPagina, pagina, alCambiar(pag)}) -> {el, actualizar({total,pagina})} */
    paginacion: function (o) {
      var n = document.createElement('nav'); n.className = 'pager'; n.setAttribute('aria-label', 'Paginación');
      var st = { total: o.total || 0, pp: o.porPagina || 10, pag: o.pagina || 1 };
      function pintar() {
        var tp = Math.max(1, Math.ceil(st.total / st.pp)); st.pag = Math.min(Math.max(1, st.pag), tp);
        n.innerHTML = '<span>' + esc(st.total) + ' registros · Página ' + st.pag + ' de ' + tp + '</span><button type="button" class="btn sec sm" data-d="-1"' + (st.pag <= 1 ? ' disabled' : '') + '>Anterior</button><button type="button" class="btn sec sm" data-d="1"' + (st.pag >= tp ? ' disabled' : '') + '>Siguiente</button>';
        n.hidden = st.total <= st.pp;
      }
      n.addEventListener('click', function (e) { var b = e.target.closest('button[data-d]'); if (!b || b.disabled) return; st.pag += +b.dataset.d; pintar(); if (o.alCambiar) o.alCambiar(st.pag); var nb = n.querySelector('button:not(:disabled)'); if (nb) nb.focus(); });
      pintar();
      return { el: n, actualizar: function (p) { Object.assign(st, { total: p.total != null ? p.total : st.total, pag: p.pagina != null ? p.pagina : st.pag }); pintar(); } };
    },

    /* ---------------- tabla ---------------- */
    /**
     * tabla({columnas:[{clave, titulo, orden:true, buscable:true, align:'c'|'r', valor(fila)->dato para ordenar/buscar/mostrar,
     *          render(fila)->HTML (¡escapar con EDU.esc!), formato(valor,fila)->texto}],
     *        filas, buscar:true, ordenInicial:'clave', desc, porPagina:10|false, caption, vacio:{titulo,texto},
     *        acciones:[{texto, tipo, alClic(fila), visible(fila)}], etiqueta})
     * -> {el, actualizar(filas), filas()}. Texto por defecto = escapado; solo `render` produce HTML.
     */
    tabla: function (o) {
      var id = 'tb' + (++uid), filas = o.filas || [], st = { q: '', col: o.ordenInicial || null, desc: !!o.desc, pag: 1 }, pp = o.porPagina === false ? 0 : (o.porPagina || 10);
      var raiz = document.createElement('div'), vis = [];
      raiz.innerHTML = (o.buscar === false ? '' : '<div class="tabla-tools"><label class="sr-only" for="' + id + '-q">Buscar en la tabla</label><input type="search" id="' + id + '-q" placeholder="Buscar…" autocomplete="off"></div>') +
        '<div class="tw"><table class="t"><caption' + (o.caption ? '' : ' class="sr-only"') + '>' + esc(o.caption || o.etiqueta || 'Tabla de datos') + '</caption><thead></thead><tbody></tbody></table></div><div class="vac"></div><p class="sr-only" aria-live="polite" id="' + id + '-s"></p>';
      var thead = raiz.querySelector('thead'), tbody = raiz.querySelector('tbody'), vac = raiz.querySelector('.vac'), estado = raiz.querySelector('#' + id + '-s');
      var pag = pp ? ui.paginacion({ total: 0, porPagina: pp, alCambiar: function (p) { st.pag = p; cuerpo(); } }) : null;
      if (pag) raiz.appendChild(pag.el);
      var cols = o.columnas, acc = o.acciones || [];
      function val(c, f) { return c.valor ? c.valor(f) : f[c.clave]; }
      function cab() {
        thead.innerHTML = '<tr>' + cols.map(function (c, i) {
          var s = st.col === c.clave ? (st.desc ? 'descending' : 'ascending') : 'none';
          return '<th scope="col" class="' + (c.align || '') + '" aria-sort="' + (c.orden === false ? 'none' : s) + '">' + (c.orden === false ? esc(c.titulo) : '<button type="button" data-c="' + i + '">' + esc(c.titulo) + '</button>') + '</th>';
        }).join('') + (acc.length ? '<th scope="col"><span class="sr-only">Acciones</span></th>' : '') + '</tr>';
      }
      function filtrar() {
        var q = EDU.fmt.norm(st.q).trim(), l = filas.slice();
        if (q) l = l.filter(function (f) { return cols.some(function (c) { return c.buscable !== false && EDU.fmt.norm(val(c, f)).indexOf(q) !== -1; }); });
        var c = cols.filter(function (x) { return x.clave === st.col; })[0];
        if (c) l.sort(function (a, b) {
          var x = val(c, a), y = val(c, b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' })) * (st.desc ? -1 : 1);
        });
        return l;
      }
      function cuerpo() {
        var l = filtrar(), tp = pp ? Math.max(1, Math.ceil(l.length / pp)) : 1; st.pag = Math.min(st.pag, tp);
        vis = pp ? l.slice((st.pag - 1) * pp, st.pag * pp) : l;
        tbody.innerHTML = vis.map(function (f, i) {
          return '<tr>' + cols.map(function (c) {
            var v = val(c, f), t = c.render ? aHtml(c.render(f)) : esc(c.formato ? c.formato(v, f) : (v == null || v === '' ? '—' : v));
            return '<td class="' + (c.align || '') + '">' + t + '</td>';
          }).join('') + (acc.length ? '<td class="r">' + acc.map(function (a, j) { return (a.visible && !a.visible(f)) ? '' : '<button type="button" class="btn sm ' + esc(a.tipo || 'sec') + '" data-a="' + j + '" data-i="' + i + '">' + esc(a.texto) + '</button> '; }).join('') + '</td>' : '') + '</tr>';
        }).join('');
        vac.innerHTML = l.length ? '' : aHtml(ui.vacio(o.vacio || { titulo: st.q ? 'Sin resultados' : 'Sin datos', texto: st.q ? 'Prueba con otra búsqueda.' : '' }));
        if (pag) pag.actualizar({ total: l.length, pagina: st.pag });
        estado.textContent = l.length + ' resultados';
      }
      thead.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-c]'); if (!b) return;
        var c = cols[+b.dataset.c]; st.desc = st.col === c.clave ? !st.desc : false; st.col = c.clave; st.pag = 1; cab(); cuerpo();
        var nb = thead.querySelector('button[data-c="' + b.dataset.c + '"]'); if (nb) nb.focus();
      });
      tbody.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-a]'); if (!b) return;
        var a = acc[+b.dataset.a]; if (a && a.alClic) a.alClic(vis[+b.dataset.i]);
      });
      var q = raiz.querySelector('input[type=search]');
      if (q) q.addEventListener('input', function () { st.q = q.value; st.pag = 1; cuerpo(); });
      cab(); cuerpo();
      return { el: raiz, filas: function () { return filas; }, actualizar: function (nf) { filas = nf || []; cuerpo(); } };
    }
  };
  EDU.ui = ui;
})();
