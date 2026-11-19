/* EDU.validacion: validacion declarativa de formularios. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  function vacio(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length); }
  function esEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s)); }
  function esFecha(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }

  /**
   * validar(valores, esquema) -> {ok, errores:{campo:msg}, valores:{campo:valorLimpio}}
   * esquema[campo] = {label, requerido, tipo:'texto'|'numero'|'entero'|'email'|'fecha'|'select'|'booleano',
   *   min, max, minLen, maxLen, patron:RegExp, mensajePatron, opciones:[valor|{valor}], custom(valor, todos)->msg|null}
   */
  function validar(valores, esquema) {
    var errores = {}, limpios = {};
    valores = valores || {};
    Object.keys(esquema).forEach(function (k) {
      var r = esquema[k] || {}, lab = r.label || k, v = valores[k], tipo = r.tipo || 'texto';
      if (typeof v === 'string') v = v.trim();
      if (tipo === 'booleano') { limpios[k] = !!v; return; }
      if (vacio(v)) {
        limpios[k] = null;
        if (r.requerido) errores[k] = lab + ' es obligatorio.';
        return;
      }
      var msg = null;
      if (tipo === 'numero' || tipo === 'entero') {
        var n = EDU.calculo.aNumero(v);
        if (n === null) msg = lab + ' debe ser un numero.';
        else if (tipo === 'entero' && Math.floor(n) !== n) msg = lab + ' debe ser un entero.';
        else if (r.min != null && n < r.min) msg = lab + ' no puede ser menor que ' + r.min + '.';
        else if (r.max != null && n > r.max) msg = lab + ' no puede ser mayor que ' + r.max + '.';
        v = n;
      } else if (tipo === 'email') {
        if (!esEmail(v)) msg = lab + ' no es un correo valido.';
      } else if (tipo === 'fecha') {
        if (!esFecha(v)) msg = lab + ' debe ser una fecha valida (AAAA-MM-DD).';
      } else if (tipo === 'select') {
        var ops = (r.opciones || []).map(function (o) { return String(o && typeof o === 'object' ? o.valor : o); });
        if (ops.length && ops.indexOf(String(v)) === -1) msg = lab + ' tiene un valor no permitido.';
      } else {
        v = String(v);
        if (r.minLen != null && v.length < r.minLen) msg = lab + ' debe tener al menos ' + r.minLen + ' caracteres.';
        else if (r.maxLen != null && v.length > r.maxLen) msg = lab + ' no puede superar ' + r.maxLen + ' caracteres.';
      }
      if (!msg && r.patron && !r.patron.test(String(v))) msg = r.mensajePatron || lab + ' no tiene el formato correcto.';
      limpios[k] = v;
      if (msg) errores[k] = msg;
    });
    Object.keys(esquema).forEach(function (k) {
      var r = esquema[k];
      if (r && r.custom && !errores[k]) { var m = r.custom(limpios[k], limpios); if (m) errores[k] = m; }
    });
    return { ok: Object.keys(errores).length === 0, errores: errores, valores: limpios };
  }

  /** Valida una nota/puntos de actividad: numero entre 0 y max (o vacio = sin nota). */
  function puntos(valor, max) {
    if (vacio(valor)) return { ok: true, valor: null };
    var n = EDU.calculo.aNumero(valor);
    if (n === null) return { ok: false, mensaje: 'Debe ser un numero.' };
    if (n < 0) return { ok: false, mensaje: 'No puede ser negativo.' };
    if (max != null && n > max) return { ok: false, mensaje: 'No puede superar ' + max + '.' };
    return { ok: true, valor: n };
  }

  EDU.validacion = { validar: validar, esEmail: esEmail, esFecha: esFecha, vacio: vacio, puntos: puntos, parseNumero: function (v) { return EDU.calculo.aNumero(v); } };
})();
