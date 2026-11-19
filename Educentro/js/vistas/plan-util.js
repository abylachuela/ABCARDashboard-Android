/* EDU.planUtil: helpers compartidos por las vistas "planificacion" y "secuencias" (contexto de cargas, fechas, currículo vigente, estilos). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc;
  var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

  function iso(d) { return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function aFecha(s) { return new Date(s + 'T12:00:00Z'); }
  function sumaDias(s, n) { var d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function lunesDe(s) { var d = aFecha(s), w = d.getUTCDay(); return sumaDias(s, w === 0 ? -6 : 1 - w); }
  function fechaValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && iso(aFecha(s)) === s; }
  function diaSemana(s) { var w = aFecha(s).getUTCDay(); return w === 0 ? 7 : w; } // 1=lunes .. 7=domingo

  var CSS = '.pl-sem{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}' +
    '.pl-dia{background:var(--card);border:1px solid #efece4;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;box-shadow:var(--shadow);min-width:0}' +
    '.pl-dia h3{font-size:15px;display:flex;justify-content:space-between;align-items:baseline}.pl-dia h3 small{font:500 12px var(--sans);color:var(--muted)}' +
    '.pl-dia.hoy{outline:2px solid var(--amber)}' +
    '.pl-blk{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:9px;background:var(--soft);border-left:5px solid var(--c,var(--navy));font-size:13px;min-width:0;overflow-wrap:anywhere}' +
    '.pl-blk:hover{background:#f0ece1}.pl-blk:focus-visible{outline:3px solid var(--amber)}.pl-blk .t{font-size:12px;color:var(--muted);font-weight:600}.pl-blk strong{color:var(--c,var(--navy))}' +
    '.pl-blk.vacio-plan em{color:var(--muted)}.pl-blk em{font-style:normal}' +
    '.pl-nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.pl-nav .sp{flex:1}' +
    '.pl-act{display:grid;grid-template-columns:130px 90px 1fr auto;gap:8px;align-items:start;margin-bottom:8px}' +
    '.pl-act select,.pl-act input,.pl-act textarea{width:100%;padding:8px 10px;border:1px solid var(--field-line);border-radius:8px;background:#fff;min-width:0}' +
    '.pl-ed label.l{display:block;font-size:13px;color:var(--muted);font-weight:500;margin:10px 0 4px}' +
    '.pl-ed input[type=text],.pl-ed input[type=date],.pl-ed input[type=time],.pl-ed input[type=number],.pl-ed select,.pl-ed textarea{width:100%;padding:8px 10px;border:1px solid var(--field-line);border-radius:8px;background:#fff;font:inherit;min-width:0}' +
    '.pl-ed textarea{min-height:64px;resize:vertical}.pl-ed [aria-invalid=true]{border-color:var(--bad);background:var(--bad-bg)}' +
    '.pl-ed .g2{display:grid;grid-template-columns:repeat(2,1fr);gap:0 14px}.pl-ed .g3{display:grid;grid-template-columns:repeat(3,1fr);gap:0 14px}' +
    '.pl-ed .err{display:block}.pl-ed fieldset{border:1px solid var(--line);border-radius:10px;margin:12px 0;padding:8px 12px}.pl-ed legend{font-weight:600;color:var(--navy);padding:0 6px}' +
    '.pl-ed .ck{display:flex;gap:8px;align-items:flex-start;margin:4px 0;font-size:14px}.pl-ed .ck input{margin-top:4px}' +
    '.pl-lock{background:var(--amber-soft);border-left:4px solid var(--amber);padding:10px 12px;border-radius:8px;font-size:13.5px;margin-bottom:8px}' +
    '.sq-lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}.sq-lista li{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;background:var(--soft);border-radius:8px;padding:6px 10px;font-size:14px}' +
    '.sq-lista li span{min-width:0;overflow-wrap:anywhere}.sq-doc h2{font-size:18px;margin:0 0 8px}.sq-doc .card{margin-bottom:14px}.sq-doc dl{margin:0;display:grid;grid-template-columns:200px 1fr;gap:6px 14px}.sq-doc dt{color:var(--muted);font-size:13px}.sq-doc dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.sq-fases{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.sq-pick{max-height:52vh;overflow:auto;margin-top:8px}' +
    '@media(max-width:1000px){.pl-sem{grid-template-columns:repeat(2,minmax(0,1fr))}.sq-fases{grid-template-columns:1fr}}' +
    '@media(max-width:620px){.pl-sem{grid-template-columns:1fr}.pl-act{grid-template-columns:1fr 1fr}.pl-act>:nth-child(3){grid-column:1/-1}.pl-ed .g2,.pl-ed .g3{grid-template-columns:1fr}.sq-doc dl{grid-template-columns:1fr}}' +
    '@media print{.sq-fases{grid-template-columns:repeat(3,1fr)}.sq-doc dl{grid-template-columns:150px 1fr}}';

  EDU.planUtil = {
    DIAS: DIAS, iso: iso, aFecha: aFecha, sumaDias: sumaDias, lunesDe: lunesDe, fechaValida: fechaValida, diaSemana: diaSemana,
    estilos: function () {
      if (document.getElementById('pl-estilos')) return;
      var s = document.createElement('style'); s.id = 'pl-estilos'; s.textContent = CSS; document.head.appendChild(s);
    },
    /** Lineas de un textarea -> array (sin vacias). */
    lineas: function (t) { return String(t || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); },
    /** Contexto del centro activo: cargas visibles segun alcance + mapas. */
    contexto: async function () {
      var D = await EDU.consultas.cargar(['cargas', 'secciones', 'cursos', 'asignaturas', 'docentes', 'periodos', 'matriculas', 'horarios', 'planes', 'secuencias']);
      var ses = EDU.estado.sesion(), al = EDU.permisos.alcance(ses, { cargas: D.cargas, matriculas: D.matriculas, tutores: [] });
      var cargas = EDU.permisos.filtrar(al, 'cargas', D.cargas);
      var m = function (l) { var o = {}; l.forEach(function (x) { o[x.id] = x; }); return o; };
      var ctx = { D: D, ses: ses, cargas: cargas, secc: m(D.secciones), cursos: m(D.cursos), asig: m(D.asignaturas), docs: m(D.docentes), cargaPorId: m(cargas), todasCargas: m(D.cargas) };
      ctx.curso = function (cg) { var s = ctx.secc[cg.seccionId]; return s ? ctx.cursos[s.cursoId] : null; };
      ctx.etiqueta = function (cg) {
        if (!cg) return '—';
        var a = ctx.asig[cg.asignaturaId], s = ctx.secc[cg.seccionId], c = s && ctx.cursos[s.cursoId];
        return (a ? a.nombre : '?') + ' · ' + (c ? c.nombre : '') + (s ? ' ' + s.nombre : '');
      };
      ctx.docente = function (cg) { var d = cg && ctx.docs[cg.docenteId]; return d ? EDU.fmt.nombreCompleto(d) : '—'; };
      ctx.color = function (cg) { var a = cg && ctx.asig[cg.asignaturaId]; return (a && a.color) || '#14315c'; };
      return ctx;
    },
    /** Puede el usuario editar este plan/secuencia (rol + propiedad)? `bloqueado` = impartido/finalizado y no es director. */
    puedeEditarDe: function (modulo, ctx, reg) {
      var rol = ctx.ses.rol;
      if (!EDU.permisos.puede(rol, modulo, 'editar')) return false;
      if (rol === 'docente') { var cg = ctx.todasCargas[reg.cargaId]; return !!cg && cg.docenteId === ctx.ses.refId; }
      return true;
    },
    /** Version de currículo vigente del centro (o la primera) y sus items. */
    versiones: async function () {
      var v = await EDU.repo.listar('curriculoVersiones', { filtro: function (x) { return !x.esConfig; } });
      var vig = v.filter(function (x) { return x.estado === 'vigente'; })[0] || v[0] || null;
      return { lista: v, vigente: vig };
    },
    itemsDe: async function (versionId) {
      return EDU.repo.listar('curriculoContenidos', { filtro: { versionId: versionId }, orden: 'orden' });
    },
    /** Items del currículo aplicables a una carga (nivel/ciclo/grado/modalidad/área). */
    aplicables: function (items, curso, asig) {
      return items.filter(function (i) {
        if (i.tipo === 'estructura' || i.tipo === 'area') return false;
        if (i.nivel && curso && i.nivel !== curso.nivel) return false;
        if (i.ciclo && curso && curso.ciclo && i.ciclo !== curso.ciclo) return false;
        if (i.grado != null && curso && i.grado !== curso.grado) return false;
        if (i.modalidad && curso && i.modalidad !== curso.modalidad) return false;
        if (i.areaId && asig && i.areaId !== asig.codigo) return false;
        return true;
      });
    },
    /** Cobertura de indicadores de una secuencia segun los planes vinculados (plan.secuenciaId + plan.indicadorIds). */
    cobertura: function (sec, planes) {
      var inds = sec.indicadoresLogro || [], mios = (planes || []).filter(function (p) { return p.secuenciaId === sec.id; }), plan = {}, imp = {};
      mios.forEach(function (p) { (p.indicadorIds || []).forEach(function (u) { plan[u] = true; if (p.estado === 'impartido') imp[u] = true; }); });
      var pl = inds.filter(function (i) { return plan[i.uid]; }), im = inds.filter(function (i) { return imp[i.uid]; });
      return { total: inds.length, planificados: pl.length, impartidos: im.length, faltan: inds.filter(function (i) { return !plan[i.uid]; }), sesiones: mios.length };
    },
    badgeEstado: function (e) {
      var m = { borrador: ['Borrador', 'warn'], listo: ['Listo', 'info'], lista: ['Lista', 'info'], impartido: ['Impartido', 'ok'], en_ejecucion: ['En ejecución', 'info'], finalizada: ['Finalizada', 'ok'] }[e] || [e || '—', 'neu'];
      return EDU.ui.badge(m[0], m[1]);
    },
    enlaceSeguro: function (u) { return /^https?:\/\//i.test(u || '') ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">fuente</a>' : '—'; }
  };
})();
