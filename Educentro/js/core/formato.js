/* EDU.esc (escape HTML), EDU.html/EDU.raw (plantillas seguras) y EDU.fmt (formato es-DO). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** Escapa texto para insertarlo en HTML (contenido y atributos entre comillas). */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }
  EDU.esc = esc;

  /** HTML ya seguro. Los helpers de EDU.ui devuelven Safe. */
  function Safe(s) { this.s = s; }
  Safe.prototype.toString = function () { return this.s; };
  Safe.prototype.valueOf = function () { return this.s; };
  EDU.Safe = Safe;
  EDU.raw = function (s) { return new Safe(String(s == null ? '' : s)); };
  function aHtml(v) {
    if (v instanceof Safe) return v.s;
    if (Array.isArray(v)) return v.map(aHtml).join('');
    return esc(v);
  }
  /** Plantilla etiquetada: EDU.html`<b>${dato}</b>` escapa cada ${} salvo Safe/arrays de Safe. */
  EDU.html = function (strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += aHtml(arguments[i]) + strings[i];
    return new Safe(out);
  };

  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }

  EDU.fmt = {
    MESES: MESES_L,
    /** Nota para mostrar: redondeo half-up solo aqui. null -> '—'. */
    nota: function (n, escala) {
      if (n == null || !isFinite(n)) return '—';
      var d = escala && escala.decimales != null ? escala.decimales : 1;
      var r = EDU.calculo.redondear(n, d);
      return r.toFixed(d);
    },
    num: function (n, d) {
      if (n == null || !isFinite(n)) return '—';
      return EDU.calculo.redondear(n, d == null ? 0 : d).toFixed(d == null ? 0 : d);
    },
    pct: function (n, d) {
      if (n == null || !isFinite(n)) return '—';
      return EDU.fmt.num(n, d == null ? 0 : d) + '%';
    },
    /** Moneda dominicana: RD$ 1,250.00 */
    moneda: function (n) {
      if (n == null || !isFinite(n)) return '—';
      var s = EDU.calculo.redondear(n, 2).toFixed(2).split('.');
      s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return 'RD$ ' + s.join('.');
    },
    /** 'YYYY-MM-DD' -> '19 nov 2026' (sin depender de zona horaria). */
    fecha: function (iso, largo) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
      if (!m) return iso ? String(iso) : '—';
      var mes = (largo ? MESES_L : MESES)[+m[2] - 1];
      return (+m[3]) + (largo ? ' de ' : ' ') + mes + (largo ? ' de ' : ' ') + m[1];
    },
    fechaHora: function (iso) {
      var d = new Date(iso);
      if (isNaN(d)) return '—';
      return EDU.fmt.fecha(d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    },
    /** Fecha local de hoy 'YYYY-MM-DD'. */
    hoy: function () {
      var d = new Date();
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    },
    nombreCompleto: function (p) {
      return p ? ((p.nombres || p.nombre || '') + ' ' + (p.apellidos || p.apellido || '')).trim() : '';
    },
    iniciales: function (txt) {
      var t = String(txt || '').trim().split(/\s+/).filter(Boolean);
      if (!t.length) return '?';
      return (t[0][0] + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase();
    },
    plural: function (n, sing, plur) { return n + ' ' + (n === 1 ? sing : (plur || sing + 's')); },
    /** Normaliza para busqueda: minusculas sin acentos. */
    norm: function (s) {
      return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
  };
})();
