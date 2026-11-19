/* EDU.router: router por hash (#/ruta/:param?query). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var rutas = [], oyentes = [], contenedor = null, limpieza = null, token = 0, actual = null;

  function partes(s) { return s.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } }); }
  function parsear() {
    var h = (location.hash || '').replace(/^#\/?/, ''), i = h.indexOf('?');
    var path = i === -1 ? h : h.slice(0, i), qs = i === -1 ? '' : h.slice(i + 1);
    var q = {}; new URLSearchParams(qs).forEach(function (v, k) { q[k] = v; });
    return { path: path, segs: partes(path), query: q };
  }
  function buscar(segs) {
    for (var i = 0; i < rutas.length; i++) {
      var r = rutas[i];
      if (r.segs.length !== segs.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < segs.length; j++) {
        if (r.segs[j][0] === ':') params[r.segs[j].slice(1)] = segs[j];
        else if (r.segs[j] !== segs[j]) { ok = false; break; }
      }
      if (ok) return { r: r, params: params };
    }
    return null;
  }
  function puede(def, modulo, rol) {
    if (def.publica) return true;
    if (def.roles) return def.roles.indexOf(rol) !== -1;
    return EDU.permisos.puedeModulo(rol, modulo);
  }
  function msg(titulo, texto, extra) {
    contenedor.innerHTML = '<div class="card vacio"><h1 style="font-size:28px">' + EDU.esc(titulo) + '</h1><p>' + EDU.esc(texto) + '</p>' +
      '<a class="btn" href="#/dashboard">Ir al panel</a></div>';
  }
  function avisar(info) { oyentes.forEach(function (f) { try { f(info); } catch (e) { console.error(e); } }); }

  async function resolver(enfocar) {
    if (!contenedor) return;
    var p = parsear(), auth = EDU.estado.autenticado();
    if (!p.path) { location.replace('#/' + (auth ? 'dashboard' : 'login')); return; }
    var m = buscar(p.segs), modulo = p.segs[0];
    if (typeof limpieza === 'function') { try { limpieza(); } catch (e) { console.error(e); } }
    limpieza = null;
    var mi = ++token;
    if (!m) { actual = { ruta: p.path, modulo: modulo, titulo: 'No encontrada' }; document.title = 'No encontrada · EduCentro'; msg('Página no encontrada (404)', 'La ruta "' + p.path + '" no existe.'); avisar(actual); return; }
    var def = m.r.def;
    if (!def.publica && !auth) { location.replace('#/login'); return; }
    if (auth && modulo !== 'cambiar-clave' && EDU.estado.debeCambiarClave && EDU.estado.debeCambiarClave()) { location.replace('#/cambiar-clave'); return; } // modo api: cambio de contrasena obligatorio
    if (def.publica && auth && modulo === 'login') { location.replace('#/dashboard'); return; }
    var rol = EDU.estado.rol();
    actual = { ruta: p.path, modulo: modulo, titulo: def.titulo || modulo, params: Object.assign({}, p.query, m.params) };
    document.title = (def.titulo || 'EduCentro') + ' · EduCentro';
    avisar(actual);
    if (!puede(def, modulo, rol)) { msg('Acceso denegado (403)', 'Tu rol (' + EDU.permisos.etiquetaRol(rol) + ') no tiene acceso a este módulo.'); return; }
    contenedor.innerHTML = '';
    contenedor.setAttribute('aria-busy', 'true');
    try {
      var res = await def.render(contenedor, actual.params);
      if (mi !== token) { if (typeof res === 'function') res(); return; }
      limpieza = typeof res === 'function' ? res : null;
    } catch (err) {
      if (mi !== token) return;
      console.error(err);
      contenedor.innerHTML = '<div class="card"><h2>Ocurrió un error</h2><p class="note">' + EDU.esc(err && err.message ? err.message : err) + '</p></div>';
    }
    contenedor.removeAttribute('aria-busy');
    if (enfocar) { var mn = document.getElementById('main'); if (mn) mn.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  EDU.router = {
    /** register(ruta, {titulo, roles?, publica?, render(container, params)}) ; ruta: 'libro-notas', 'personas/:id' */
    register: function (ruta, def) {
      var segs = partes(ruta);
      rutas = rutas.filter(function (r) { return r.ruta !== ruta; });
      rutas.push({ ruta: ruta, segs: segs, def: def });
    },
    iniciar: function (cont) {
      contenedor = cont;
      window.addEventListener('hashchange', function () { resolver(true); });
      return resolver(false);
    },
    /** ir('libro-notas', {cargaId:'x'}) */
    ir: function (ruta, query) {
      var qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
      var h = '#/' + ruta + qs;
      if (location.hash === h) resolver(true); else location.hash = h;
    },
    /** Vuelve a renderizar la vista actual (p. ej. tras cambiar de centro). */
    recargar: function () { return resolver(false); },
    actual: function () { return actual; },
    onNavegar: function (fn) { oyentes.push(fn); },
    rutas: function () { return rutas.map(function (r) { return r.ruta; }); }
  };
})();
