/* Horarios · motor puro (sin DOM): franjas, validaciones, propuesta automatica, CSV y API publica EDU.horarios.
   Modelo: franjas {centroId,tanda,orden,inicio,fin,tipo}; horarios {cargaId,dia 1-5,franjaId,aula,hora,duracion};
   disponibilidad {docenteId,dia,franjaId,disponible:false}; ajustes del centro: registro en `franjas` con tipo:'config'
   (id 'cfg_<centroId>', {topeHoras, topes:{docenteId:n}}). Una "hora" = un periodo (franja de tipo clase). */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  var DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
  var TANDAS = { matutina: 'Matutina', vespertina: 'Vespertina', extendida: 'Extendida' };
  var TIPOS = { clase: 'Clase', recreo: 'Recreo', almuerzo: 'Almuerzo' };
  var TOPE_DEFECTO = 25; // configurable por centro y por docente; no es una regla oficial

  /* Plantillas de EJEMPLO (editables) para crear franjas rapido. Cada paso: [tipo, minutos]. */
  var PLANTILLAS = {
    matutina: { inicio: '07:30', pasos: [['clase', 45], ['clase', 45], ['clase', 45], ['recreo', 20], ['clase', 45], ['clase', 45], ['clase', 45]] },
    vespertina: { inicio: '13:30', pasos: [['clase', 45], ['clase', 45], ['clase', 45], ['recreo', 15], ['clase', 45], ['clase', 45], ['clase', 45]] },
    extendida: { inicio: '08:00', pasos: [['clase', 45], ['clase', 45], ['clase', 45], ['recreo', 15], ['clase', 45], ['clase', 45], ['almuerzo', 45], ['clase', 45], ['clase', 45], ['clase', 45]] }
  };

  function norm(s) { return EDU.fmt && EDU.fmt.norm ? EDU.fmt.norm(s) : String(s == null ? '' : s).toLowerCase(); }
  function mins(h) { var m = /^(\d{1,2}):(\d{2})/.exec(h || ''); return m ? (+m[1] * 60 + +m[2]) : NaN; }
  function hhmm(n) { n = Math.max(0, Math.round(n)); return ('0' + Math.floor(n / 60)).slice(-2) + ':' + ('0' + (n % 60)).slice(-2); }
  function solapa(a, b) { return mins(a.inicio) < mins(b.fin) && mins(b.inicio) < mins(a.fin); }
  function key(e) { return e.id || e._k; }
  function nombrePersona(p) { return p ? ((p.nombres || p.nombre || '') + ' ' + (p.apellidos || '')).trim() : ''; }

  /** Tanda de una seccion segun su texto ('Jornada Extendida' -> extendida). Por defecto matutina. */
  function tandaDe(sec) {
    var t = norm(sec && sec.tanda);
    if (t.indexOf('vesp') >= 0) return 'vespertina';
    if (t.indexOf('extend') >= 0) return 'extendida';
    return 'matutina';
  }

  function plantillaFranjas(tanda, centroId) {
    var p = PLANTILLAS[tanda], t = mins(p.inicio), out = [];
    p.pasos.forEach(function (s, i) { out.push({ centroId: centroId, tanda: tanda, orden: i + 1, inicio: hhmm(t), fin: hhmm(t + s[1]), tipo: s[0] }); t += s[1]; });
    return out;
  }

  /** Valida las franjas de una tanda: formato, inicio<fin, sin solapes. Devuelve lista de mensajes. */
  function validarFranjas(lista) {
    var err = [], v = lista.slice().sort(function (a, b) { return mins(a.inicio) - mins(b.inicio); });
    v.forEach(function (f, i) {
      if (isNaN(mins(f.inicio)) || isNaN(mins(f.fin))) err.push('La franja ' + (i + 1) + ' tiene una hora no válida.');
      else if (mins(f.inicio) >= mins(f.fin)) err.push('La franja ' + f.inicio + '–' + f.fin + ': el inicio debe ser anterior al fin.');
      if (!TIPOS[f.tipo]) err.push('Tipo no válido en la franja ' + f.inicio + '.');
      if (i && !isNaN(mins(f.inicio)) && mins(f.inicio) < mins(v[i - 1].fin)) err.push('Las franjas ' + v[i - 1].inicio + '–' + v[i - 1].fin + ' y ' + f.inicio + '–' + f.fin + ' se solapan.');
    });
    return err;
  }

  /* ---------------- contexto ---------------- */
  /** armar(datos): datos {franjas, horarios, disponibilidad, cargas, secciones, cursos, asignaturas, docentes}. */
  function armar(d) {
    var cfg = (d.franjas || []).filter(function (f) { return f.tipo === 'config'; })[0] || null;
    var fr = (d.franjas || []).filter(function (f) { return f.tipo !== 'config'; }).sort(function (a, b) { return mins(a.inicio) - mins(b.inicio) || (a.orden || 0) - (b.orden || 0); });
    var ctx = { cfg: cfg, franjas: fr, franjaPor: {}, cargas: d.cargas || [], cargaPor: {}, secciones: d.secciones || [], seccionPor: {}, cursoPor: {}, asigPor: {}, docPor: {},
      disp: (d.disponibilidad || []).filter(function (x) { return x.disponible === false; }), topeDefecto: cfg && cfg.topeHoras != null ? +cfg.topeHoras : TOPE_DEFECTO, topes: (cfg && cfg.topes) || {} };
    fr.forEach(function (f) { ctx.franjaPor[f.id] = f; });
    ctx.cargas.forEach(function (c) { ctx.cargaPor[c.id] = c; });
    ctx.secciones.forEach(function (s) { ctx.seccionPor[s.id] = s; });
    (d.cursos || []).forEach(function (c) { ctx.cursoPor[c.id] = c; });
    (d.asignaturas || []).forEach(function (a) { ctx.asigPor[a.id] = a; });
    (d.docentes || []).forEach(function (x) { ctx.docPor[x.id] = x; });
    ctx.horarios = (d.horarios || []).filter(function (h) { return h.franjaId; });
    return ctx;
  }
  function etiquetaSeccion(ctx, id) { var s = ctx.seccionPor[id], c = s && ctx.cursoPor[s.cursoId]; return s ? ((c ? c.nombre : '') + ' ' + s.nombre).trim() : String(id); }
  function nombreAsig(ctx, id) { var a = ctx.asigPor[id]; return a ? a.nombre : String(id); }
  function nombreDoc(ctx, id) { var x = ctx.docPor[id]; return x ? nombrePersona(x) : (id ? String(id) : 'Sin docente'); }
  function horasDe(c) { return +c.horasSemana || 0; }
  function topeDe(ctx, docenteId) { var t = ctx.topes[docenteId]; return t != null && t !== '' ? +t : ctx.topeDefecto; }
  function etiquetaCarga(ctx, c) { return nombreAsig(ctx, c.asignaturaId) + ' · ' + etiquetaSeccion(ctx, c.seccionId) + ' · ' + nombreDoc(ctx, c.docenteId); }
  function franjaTxt(f) { return f ? f.inicio + '–' + f.fin : '?'; }

  function noDisponible(ctx, docenteId, dia, f) {
    return ctx.disp.some(function (x) { var g = ctx.franjaPor[x.franjaId]; return x.docenteId === docenteId && +x.dia === +dia && g && solapa(g, f); });
  }

  /* ---------------- validacion ---------------- */
  /**
   * validar(ctx, entradas) -> {conflictos:[{tipo,msg,claves,dia,franjaId}], avisos:[{tipo,msg,cargaId?,docenteId?}],
   *   porEntrada:{clave:[tipos]}, horasCarga:{cargaId:n}, horasDocente:{docenteId:n}}
   * Conflictos (BLOQUEAN guardar): docente | seccion | aula | disponibilidad | franja. Avisos: incompleta | exceso | sobrecarga | tanda.
   * Dos bloques chocan si el dia es el mismo y las horas se solapan (aunque sean franjas de tandas distintas).
   */
  function validar(ctx, entradas) {
    var conf = [], avisos = [], porEnt = {}, filas = [], visto = {};
    function marca(clave, tipo) { (porEnt[clave] = porEnt[clave] || []); if (porEnt[clave].indexOf(tipo) < 0) porEnt[clave].push(tipo); }
    function choque(tipo, a, b, msg) {
      var id = tipo + '|' + [a.k, b.k].sort().join('|'); if (visto[id]) return; visto[id] = 1;
      conf.push({ tipo: tipo, msg: msg, claves: [a.k, b.k], dia: a.e.dia, franjaId: a.e.franjaId }); marca(a.k, tipo); marca(b.k, tipo);
    }
    entradas.forEach(function (e) {
      var f = ctx.franjaPor[e.franjaId], c = ctx.cargaPor[e.cargaId], k = key(e), fila = { e: e, k: k, f: f, c: c };
      if (!c) { conf.push({ tipo: 'franja', msg: 'Un bloque apunta a una carga que no existe.', claves: [k] }); marca(k, 'franja'); return; }
      if (!f) { conf.push({ tipo: 'franja', msg: 'Un bloque usa una franja inexistente (' + nombreAsig(ctx, c.asignaturaId) + ').', claves: [k] }); marca(k, 'franja'); return; }
      if (f.tipo !== 'clase') { conf.push({ tipo: 'franja', msg: 'No se puede dar clase en un ' + (TIPOS[f.tipo] || f.tipo).toLowerCase() + ' (' + DIAS[e.dia - 1] + ' ' + franjaTxt(f) + ').', claves: [k], dia: e.dia, franjaId: f.id }); marca(k, 'franja'); }
      if (!(e.dia >= 1 && e.dia <= 5)) { conf.push({ tipo: 'franja', msg: 'Día no válido.', claves: [k] }); marca(k, 'franja'); return; }
      var s = ctx.seccionPor[c.seccionId];
      if (s && f.tanda !== tandaDe(s)) avisos.push({ tipo: 'tanda', msg: nombreAsig(ctx, c.asignaturaId) + ' de ' + etiquetaSeccion(ctx, c.seccionId) + ' está en una franja de la tanda ' + (TANDAS[f.tanda] || f.tanda).toLowerCase() + ' (la sección es ' + TANDAS[tandaDe(s)].toLowerCase() + ').' });
      if (c.docenteId && noDisponible(ctx, c.docenteId, e.dia, f)) {
        conf.push({ tipo: 'disponibilidad', msg: nombreDoc(ctx, c.docenteId) + ' no está disponible el ' + DIAS[e.dia - 1].toLowerCase() + ' ' + franjaTxt(f) + '.', claves: [k], dia: e.dia, franjaId: f.id }); marca(k, 'disponibilidad');
      }
      filas.push(fila);
    });
    function agrupar(fn) { var m = {}; filas.forEach(function (x) { var g = fn(x); if (g) (m[g + '|' + x.e.dia] = m[g + '|' + x.e.dia] || []).push(x); }); return m; }
    function pares(m, tipo, msgFn) {
      Object.keys(m).forEach(function (g) {
        var l = m[g];
        for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) if (solapa(l[i].f, l[j].f)) choque(tipo, l[i], l[j], msgFn(l[i], l[j]));
      });
    }
    var cuando = function (a, b) { return DIAS[a.e.dia - 1].toLowerCase() + ' ' + franjaTxt(a.f) + (franjaTxt(a.f) === franjaTxt(b.f) ? '' : ' / ' + franjaTxt(b.f)); };
    pares(agrupar(function (x) { return x.c.docenteId; }), 'docente', function (a, b) {
      return nombreDoc(ctx, a.c.docenteId) + ' está en dos secciones a la vez (' + etiquetaSeccion(ctx, a.c.seccionId) + ' y ' + etiquetaSeccion(ctx, b.c.seccionId) + ') el ' + cuando(a, b) + '.';
    });
    pares(agrupar(function (x) { return x.c.seccionId; }), 'seccion', function (a, b) {
      return etiquetaSeccion(ctx, a.c.seccionId) + ' tiene dos asignaturas a la vez (' + nombreAsig(ctx, a.c.asignaturaId) + ' y ' + nombreAsig(ctx, b.c.asignaturaId) + ') el ' + cuando(a, b) + '.';
    });
    pares(agrupar(function (x) { return norm(x.e.aula).trim(); }), 'aula', function (a, b) {
      return 'El aula «' + String(a.e.aula).trim() + '» está duplicada (' + etiquetaSeccion(ctx, a.c.seccionId) + ' y ' + etiquetaSeccion(ctx, b.c.seccionId) + ') el ' + cuando(a, b) + '.';
    });
    var hc = {}, hd = {};
    filas.forEach(function (x) { if (x.f && x.f.tipo === 'clase') { hc[x.c.id] = (hc[x.c.id] || 0) + 1; if (x.c.docenteId) hd[x.c.docenteId] = (hd[x.c.docenteId] || 0) + 1; } });
    ctx.cargas.forEach(function (c) {
      var n = hc[c.id] || 0, req = horasDe(c);
      if (req && n < req) avisos.push({ tipo: 'incompleta', cargaId: c.id, msg: nombreAsig(ctx, c.asignaturaId) + ' · ' + etiquetaSeccion(ctx, c.seccionId) + ': ' + n + ' de ' + req + ' horas (faltan ' + (req - n) + ').' });
      else if (req && n > req) avisos.push({ tipo: 'exceso', cargaId: c.id, msg: nombreAsig(ctx, c.asignaturaId) + ' · ' + etiquetaSeccion(ctx, c.seccionId) + ': ' + n + ' horas asignadas, más de las ' + req + ' semanales.' });
    });
    Object.keys(hd).forEach(function (id) {
      var t = topeDe(ctx, id); if (hd[id] > t) avisos.push({ tipo: 'sobrecarga', docenteId: id, msg: nombreDoc(ctx, id) + ' tiene ' + hd[id] + ' horas asignadas; el tope es ' + t + '.' });
    });
    return { conflictos: conf, avisos: avisos, porEntrada: porEnt, horasCarga: hc, horasDocente: hd };
  }

  /* ---------------- propuesta automatica ---------------- */
  /**
   * proponerLocal(ctx, {conservar:true, seccionId?, cargaIds?, maxNodos, ajuste?(carga, {dia,f,pos}, {ocupadas:[franja]}) -> numero que se SUMA al puntaje (menor = mas preferido)}) -> {asignaciones:[{cargaId,dia,franjaId,aula}], sinColocar:[{cargaId,faltan}], nodos, completo, algoritmo, validacion}
   * Heuristica voraz (la carga con menos opciones primero; MRV) + retroceso limitado (maxNodos). Respeta: docente libre, seccion libre,
   * disponibilidad y franjas de clase de la tanda de la seccion. Distribuye (evita repetir la asignatura el mismo dia y equilibra los dias).
   */
  function proponerLocal(ctx, o) {
    o = o || {}; var maxNodos = o.maxNodos || 4000, nodos = 0, abortado = false;
    var alcance = ctx.cargas.filter(function (c) { return (!o.seccionId || c.seccionId === o.seccionId) && (!o.cargaIds || o.cargaIds.indexOf(c.id) >= 0); });
    var enAlc = {}; alcance.forEach(function (c) { enAlc[c.id] = 1; });
    var fijos = ctx.horarios.filter(function (e) { return ctx.franjaPor[e.franjaId] && ctx.cargaPor[e.cargaId] && (o.conservar !== false || !enAlc[e.cargaId]); });
    var busyDoc = {}, busySec = {}, nCD = {}, nDD = {}, nSD = {}, aulaSec = {}, col = [];
    function add(m, k, v) { (m[k] = m[k] || []).push(v); }
    function libre(l, dia, f) { if (!l) return true; for (var i = 0; i < l.length; i++) if (l[i].dia === dia && solapa(l[i].f, f)) return false; return true; }
    function inc(m, k, d) { m[k] = (m[k] || 0) + d; }
    function poner(c, dia, f, signo, ent) {
      if (signo > 0) { add(busyDoc, c.docenteId || '', { dia: dia, f: f, ent: ent }); add(busySec, c.seccionId, { dia: dia, f: f, ent: ent }); }
      else { busyDoc[c.docenteId || ''].pop(); busySec[c.seccionId].pop(); }
      inc(nCD, c.id + '|' + dia, signo); inc(nDD, (c.docenteId || '') + '|' + dia, signo); inc(nSD, c.seccionId + '|' + dia, signo);
    }
    var puestos = {};
    fijos.forEach(function (e) {
      var c = ctx.cargaPor[e.cargaId], f = ctx.franjaPor[e.franjaId]; poner(c, +e.dia, f, 1, e);
      if (f.tipo === 'clase') puestos[c.id] = (puestos[c.id] || 0) + 1;
      if (e.aula) (aulaSec[c.seccionId] = aulaSec[c.seccionId] || {})[String(e.aula).trim()] = 1;
    });
    var aulaBase = {}; Object.keys(aulaSec).forEach(function (s) { var k = Object.keys(aulaSec[s]); if (k.length === 1) aulaBase[s] = k[0]; });
    var falta = {}, total = 0;
    alcance.forEach(function (c) { var r = horasDe(c) - (puestos[c.id] || 0); if (r > 0) { falta[c.id] = r; total += r; } });
    var carga = {}; alcance.forEach(function (c) { if (falta[c.id]) carga[c.docenteId || ''] = (carga[c.docenteId || ''] || 0) + falta[c.id]; });
    var slotsDe = {};
    function slots(c) {
      if (slotsDe[c.id]) return slotsDe[c.id];
      var s = ctx.seccionPor[c.seccionId], t = s ? tandaDe(s) : 'matutina', l = [];
      var fr = ctx.franjas.filter(function (f) { return f.tanda === t && f.tipo === 'clase'; });
      if (!fr.length) fr = ctx.franjas.filter(function (f) { return f.tipo === 'clase'; });
      for (var d = 1; d <= 5; d++) fr.forEach(function (f, i) { l.push({ dia: d, f: f, pos: i }); });
      return (slotsDe[c.id] = l);
    }
    function candidatos(c, limite) {
      var out = [];
      slots(c).forEach(function (s) {
        if (!libre(busySec[c.seccionId], s.dia, s.f) || !libre(busyDoc[c.docenteId || ''], s.dia, s.f)) return;
        if (c.docenteId && noDisponible(ctx, c.docenteId, s.dia, s.f)) return;
        var sc = (nCD[c.id + '|' + s.dia] || 0) * 20 + (nDD[(c.docenteId || '') + '|' + s.dia] || 0) * 2 + (nSD[c.seccionId + '|' + s.dia] || 0) + s.pos * 0.5 + s.dia * 0.01;
        if (o.ajuste) sc += +o.ajuste(c, s, { ocupadas: (busySec[c.seccionId] || []).filter(function (x) { return x.dia === s.dia; }).map(function (x) { return x.f; }) }) || 0; // sesgo opcional (p. ej. proponedor del agente)
        out.push({ dia: s.dia, f: s.f, sc: sc });
      });
      if (limite) out.sort(function (a, b) { return a.sc - b.sc; });
      return out;
    }
    var mejor = [], mejorN = -1, quedan = total;
    function dfs() {
      if (quedan === 0) { mejor = col.slice(); mejorN = col.length; return true; }
      if (col.length > mejorN) { mejor = col.slice(); mejorN = col.length; }
      if (nodos++ > maxNodos) { abortado = true; return false; }
      var elegido = null, cands = null, bestN = 1e9;
      for (var i = 0; i < alcance.length; i++) {
        var c = alcance[i]; if (!(falta[c.id] > 0)) continue;
        var l = candidatos(c, false), n = l.length;
        if (n < bestN || (n === bestN && elegido && (carga[c.docenteId || ''] || 0) > (carga[elegido.docenteId || ''] || 0))) { bestN = n; elegido = c; cands = l; }
        if (n === 0) break;
      }
      if (!elegido || bestN === 0) return false;
      cands = candidatos(elegido, true).slice(0, 5);
      for (var k = 0; k < cands.length; k++) {
        var cd = cands[k], ent = { cargaId: elegido.id, dia: cd.dia, franjaId: cd.f.id, aula: aulaBase[elegido.seccionId] || '' };
        poner(elegido, cd.dia, cd.f, 1, ent); col.push(ent); falta[elegido.id]--; quedan--;
        if (dfs()) return true;
        col.pop(); poner(elegido, cd.dia, cd.f, -1); falta[elegido.id]++; quedan++;
        if (abortado) return false;
      }
      return false;
    }
    var completo = dfs();
    var cnt = {}; mejor.forEach(function (e) { cnt[e.cargaId] = (cnt[e.cargaId] || 0) + 1; });
    var sin = [];
    alcance.forEach(function (c) { var r = horasDe(c) - (puestos[c.id] || 0) - (cnt[c.id] || 0); if (r > 0) sin.push({ cargaId: c.id, faltan: r }); });
    var asign = mejor.map(function (e) { return { cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId, aula: e.aula || '' }; });
    var todo = fijos.map(function (e) { return { id: e.id, cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId, aula: e.aula }; })
      .concat(asign.map(function (e, i) { return Object.assign({ _k: 'p' + i }, e); }));
    return { asignaciones: asign, sinColocar: sin, nodos: nodos, completo: completo && !sin.length, algoritmo: 'local-voraz-retroceso', validacion: validar(ctx, todo) };
  }

  /* ---------------- punto de extension (agente IA) ---------------- */
  var proponedores = { local: { etiqueta: 'Automático (algoritmo local)', proponer: function (ctx, o) { return Promise.resolve(proponerLocal(ctx, o)); } } };
  /** Contexto MINIMIZADO para un proponedor externo (sin nombres de personas): ids, horas y restricciones. */
  function contextoParaProponedor(ctx, o) {
    o = o || {};
    return {
      version: 1, conservar: o.conservar !== false, seccionId: o.seccionId || null,
      franjas: ctx.franjas.map(function (f) { return { id: f.id, tanda: f.tanda, inicio: f.inicio, fin: f.fin, tipo: f.tipo }; }),
      // Todas las cargas (los bloques fijos de otras secciones ocupan a sus docentes); `enAlcance` marca las que hay que completar.
      cargas: ctx.cargas.map(function (c) {
        var s = ctx.seccionPor[c.seccionId]; return { id: c.id, seccionId: c.seccionId, asignaturaId: c.asignaturaId, docenteId: c.docenteId, horasSemana: horasDe(c), tanda: s ? tandaDe(s) : 'matutina', enAlcance: !o.seccionId || c.seccionId === o.seccionId };
      }),
      // conservar:false -> solo se descartan los bloques de las cargas del alcance (igual que la re-validacion de proponer()).
      fijos: ctx.horarios.filter(function (e) { var c = ctx.cargaPor[e.cargaId]; return o.conservar !== false ? true : !(c && (!o.seccionId || c.seccionId === o.seccionId)); })
        .map(function (e) { return { cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId }; }),
      noDisponible: ctx.disp.map(function (x) { return { docenteId: x.docenteId, dia: x.dia, franjaId: x.franjaId }; }),
      topes: { defecto: ctx.topeDefecto, porDocente: ctx.topes }
    };
  }
  /**
   * proponer(ctx, opts, nombre) -> Promise<{asignaciones, sinColocar, validacion, ...}>. El resultado de CUALQUIER proponedor se vuelve a validar aqui
   * y nunca se guarda solo: la vista exige aprobacion humana.
   */
  async function proponer(ctx, o, nombre) {
    var p = proponedores[nombre || 'local']; if (!p) throw new Error('Proponedor no registrado: ' + nombre);
    var r = await (p.proponer.length >= 3 ? p.proponer(ctx, o, contextoParaProponedor(ctx, o)) : p.proponer(ctx, o));
    if (!r || !Array.isArray(r.asignaciones)) throw new Error('El proponedor no devolvió {asignaciones:[...]}.');
    var asign = r.asignaciones.filter(function (a) { return a && ctx.cargaPor[a.cargaId] && ctx.franjaPor[a.franjaId] && a.dia >= 1 && a.dia <= 5; })
      .map(function (a) { return { cargaId: a.cargaId, dia: +a.dia, franjaId: a.franjaId, aula: a.aula ? String(a.aula) : '' }; });
    var fijos = o && o.conservar === false ? ctx.horarios.filter(function (e) { var c = ctx.cargaPor[e.cargaId]; return !(c && (!o.seccionId || c.seccionId === o.seccionId)); }) : ctx.horarios;
    var todo = fijos.concat(asign.map(function (a, i) { return Object.assign({ _k: 'p' + i }, a); }));
    var val = validar(ctx, todo);
    var sin = (Array.isArray(r.sinColocar) ? r.sinColocar : []).filter(function (x) { return x && ctx.cargaPor[x.cargaId] && +x.faltan > 0; }).map(function (x) { return { cargaId: x.cargaId, faltan: +x.faltan }; });
    return Object.assign({}, r, { asignaciones: asign, validacion: val, todo: todo, sinColocar: sin, invalidas: r.asignaciones.length - asign.length, algoritmo: r.algoritmo || nombre || 'local', fijos: fijos });
  }
  /** def: {etiqueta, proponer(ctx, opts, contextoMinimo), disponible?() -> Promise<{ok, motivo}>, admiteTexto?: acepta opts.restriccion (texto libre)}. */
  function registrarProponedor(nombre, def) {
    if (!nombre || !def || typeof def.proponer !== 'function') throw new Error('registrarProponedor(nombre, {etiqueta, proponer(ctx, opts, contextoMinimo)})');
    proponedores[nombre] = { etiqueta: def.etiqueta || nombre, proponer: def.proponer, disponible: typeof def.disponible === 'function' ? def.disponible : null, admiteTexto: !!def.admiteTexto };
  }
  /** Lista los proponedores con su disponibilidad para el usuario actual: [{id, etiqueta, ok, motivo, admiteTexto}]. */
  async function proponedoresDisponibles() {
    var out = [];
    for (var k of Object.keys(proponedores)) {
      var p = proponedores[k], r = { ok: true, motivo: '' };
      if (p.disponible) { try { r = (await p.disponible()) || { ok: false, motivo: 'No disponible.' }; } catch (e) { r = { ok: false, motivo: e.message || 'No disponible.' }; } }
      out.push({ id: k, etiqueta: p.etiqueta, ok: !!r.ok, motivo: r.motivo || '', admiteTexto: !!p.admiteTexto });
    }
    return out;
  }

  /* ---------------- CSV ---------------- */
  /** Neutraliza formulas de hoja de calculo (= + - @ y tab/CR iniciales) y cita si hace falta. */
  function csvCelda(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvFila(a) { return a.map(csvCelda).join(','); }

  /* ---------------- datos y API publica ---------------- */
  var COLS = ['franjas', 'horarios', 'disponibilidad', 'cargas', 'secciones', 'cursos', 'asignaturas', 'docentes', 'matriculas', 'tutores'];
  function diaDe(iso) { var d = new Date(iso + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
  function sumaDias(iso, n) { var t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

  /** Clases visibles para la sesion dentro del alcance de su rol. */
  async function clasesDe(sesion, o) {
    o = o || {};
    var d = await EDU.consultas.cargar(COLS), ctx = armar(d), al = EDU.permisos.alcance(sesion, d);
    var ents = d.horarios.filter(function (h) { return h.franjaId && ctx.franjaPor[h.franjaId]; });
    if (!ents.length) ents = d.horarios.filter(function (h) { return !h.franjaId && h.hora; }); // compat: horario heredado (hora + duracion)
    var out = [];
    ents.forEach(function (h) {
      var c = ctx.cargaPor[h.cargaId]; if (!c) return;
      if (al.cargaIds && !al.cargaIds.has(c.id)) return;
      if (sesion && sesion.rol === 'docente' && c.docenteId !== sesion.refId) return;
      var f = h.franjaId ? ctx.franjaPor[h.franjaId] : null, ini = f ? f.inicio : h.hora, fin = f ? f.fin : hhmm(mins(h.hora) + (h.duracion || 45));
      var cu = ctx.cursoPor[(ctx.seccionPor[c.seccionId] || {}).cursoId];
      out.push({ id: h.id, cargaId: c.id, seccionId: c.seccionId, seccion: etiquetaSeccion(ctx, c.seccionId), grado: cu ? cu.nombre : '', asignaturaId: c.asignaturaId, asignatura: nombreAsig(ctx, c.asignaturaId),
        docenteId: c.docenteId, docente: c.docenteId ? nombreDoc(ctx, c.docenteId) : '', dia: +h.dia, diaNombre: DIAS[h.dia - 1] || '', franjaId: h.franjaId || null, tanda: f ? f.tanda : null,
        inicio: ini, fin: fin, hora: ini, duracion: mins(fin) - mins(ini), aula: h.aula || '', centroId: h.centroId });
    });
    out.sort(function (a, b) { return a.dia - b.dia || mins(a.inicio) - mins(b.inicio); });
    return out;
  }

  /**
   * deSemana(sesion, fecha?) -> Promise<{lunes, dias:[{dia, nombre, fecha, esHoy, clases:[...]}]}>
   * deHoy(sesion, fecha?) -> Promise<clases[]> (vacia en fin de semana). Ver docs/API.md.
   */
  async function deSemana(sesion, fecha) {
    fecha = fecha || EDU.fmt.hoy(); var hoy = EDU.fmt.hoy(), lunes = sumaDias(fecha, 1 - diaDe(fecha)), clases = await clasesDe(sesion);
    return { lunes: lunes, dias: DIAS.map(function (n, i) {
      var f = sumaDias(lunes, i);
      return { dia: i + 1, nombre: n, fecha: f, esHoy: f === hoy, clases: clases.filter(function (c) { return c.dia === i + 1; }).map(function (c) { return Object.assign({ fecha: f, esHoy: f === hoy }, c); }) };
    }) };
  }
  async function deHoy(sesion, fecha) {
    fecha = fecha || EDU.fmt.hoy(); var dia = diaDe(fecha); if (dia > 5) return [];
    var hoy = EDU.fmt.hoy();
    return (await clasesDe(sesion)).filter(function (c) { return c.dia === dia; }).map(function (c) { return Object.assign({ fecha: fecha, esHoy: fecha === hoy }, c); });
  }

  EDU.horarios = {
    DIAS: DIAS, DIAS_CORTO: DIAS_CORTO, TANDAS: TANDAS, TIPOS: TIPOS, TOPE_DEFECTO: TOPE_DEFECTO, PLANTILLAS: PLANTILLAS,
    deHoy: deHoy, deSemana: deSemana,
    proponer: proponer, registrarProponedor: registrarProponedor, proponedores: function () { return Object.keys(proponedores).map(function (k) { return { id: k, etiqueta: proponedores[k].etiqueta }; }); }, proponedoresDisponibles: proponedoresDisponibles,
    contextoParaProponedor: contextoParaProponedor,
    motor: { armar: armar, validar: validar, validarFranjas: validarFranjas, proponerLocal: proponerLocal, plantillaFranjas: plantillaFranjas, tandaDe: tandaDe, solapa: solapa, mins: mins, hhmm: hhmm,
      csvCelda: csvCelda, csvFila: csvFila, etiquetaSeccion: etiquetaSeccion, nombreAsig: nombreAsig, nombreDoc: nombreDoc, etiquetaCarga: etiquetaCarga, horasDe: horasDe, topeDe: topeDe,
      noDisponible: noDisponible, key: key, clasesDe: clasesDe, diaDe: diaDe, sumaDias: sumaDias, COLS: COLS }
  };
})();
