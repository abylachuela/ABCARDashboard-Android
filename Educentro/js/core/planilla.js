/* EDU.planilla: lectura/analisis/exportacion de la planilla de calificaciones MINERD (.xlsx) con SheetJS (js/vendor/xlsx.full.min.js, 100 % local).
   Sin DOM ni almacenamiento: solo transforma datos. NUNCA evalua contenido del archivo: las formulas se leen como TEXTO para compararlas con la regla de Educentro.
   Todo texto leido es dato no confiable: quien lo muestre debe usar EDU.esc. Al exportar, el texto que empieza por = + - @ se neutraliza. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var LIM = { bytes: 10 * 1024 * 1024, descomprimido: 120 * 1024 * 1024, hojas: 40, filas: 1500, columnas: 120, avisos: 400 };
  var calc = function () { return EDU.calculo; };

  /* ---------- utilidades ---------- */
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hnorm(s) { return norm(s).replace(/[^a-z0-9%.]/g, '').toUpperCase(); } // 'P2 ' -> 'P2', 'No.' -> 'NO.'
  var PARTICULAS = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1 };
  function tokens(s) { return norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) { return t && !PARTICULAS[t]; }); }
  /** Clave de nombre independiente del orden (apellidos/nombres), tildes y mayusculas. */
  function claveNombre(s) { return tokens(s).sort().join(' '); }
  function neutralizar(v) { if (typeof v !== 'string') return v; return /^[=+\-@\t\r]/.test(v) ? "'" + v : v; }
  function colLetra(c) { return window.XLSX.utils.encode_col(c); }
  function ref(r, c) { return colLetra(c) + (r + 1); }
  function exigirXlsx() { if (!window.XLSX) throw new Error('La biblioteca de Excel (SheetJS) no está cargada.'); }

  /** Lee una celda: {v:number|null, texto:string|null, error:string|null, f:string|null} */
  function celda(ws, r, c) {
    var x = ws[ref(r, c)];
    if (!x) return { v: null, texto: null, error: null, f: null };
    var o = { v: null, texto: null, error: null, f: typeof x.f === 'string' ? x.f : null };
    if (x.t === 'e') { o.error = String(x.w || '#ERROR'); return o; }
    if (x.t === 'n' && isFinite(x.v)) { o.v = x.v; return o; }
    if (x.t === 'b') { o.texto = x.v ? 'VERDADERO' : 'FALSO'; return o; }
    if (x.v === undefined || x.v === null) return o;
    var t = String(x.v).trim();
    if (t === '') return o;
    if (/^-?\d+([.,]\d+)?$/.test(t)) { o.v = parseFloat(t.replace(',', '.')); return o; }
    o.texto = t.slice(0, 200); return o;
  }

  /* ---------- validacion del archivo ---------- */
  /** Valida tamano, extension, firma ZIP (xlsx) y tamano descomprimido declarado. -> {ok, errores[]} */
  function validarArchivo(nombre, bytes, buffer) {
    var er = [];
    if (!/\.xlsx$/i.test(nombre || '')) er.push('Solo se admiten archivos .xlsx.');
    if (bytes > LIM.bytes) er.push('El archivo supera el máximo de ' + (LIM.bytes / 1048576) + ' MB.');
    if (bytes === 0) er.push('El archivo está vacío.');
    if (buffer && !er.length) {
      var u = new Uint8Array(buffer);
      if (!(u[0] === 0x50 && u[1] === 0x4b && u[2] === 3 && u[3] === 4)) er.push('El contenido no es un libro .xlsx válido.');
      else { // suma de tamanos descomprimidos del directorio central (defensa ante zip-bombs)
        var dv = new DataView(buffer), total = 0, n = 0;
        for (var i = u.length - 22; i >= 0 && i > u.length - 70000; i--) {
          if (dv.getUint32(i, true) === 0x06054b50) {
            var cnt = dv.getUint16(i + 10, true), off = dv.getUint32(i + 16, true);
            if (cnt > 5000) { er.push('El libro contiene demasiados componentes.'); break; }
            for (var k = 0; k < cnt && off + 46 <= u.length && dv.getUint32(off, true) === 0x02014b50; k++) {
              total += dv.getUint32(off + 24, true); off += 46 + dv.getUint16(off + 28, true) + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true); n++;
            }
            break;
          }
        }
        if (total > LIM.descomprimido) er.push('El libro descomprimido es demasiado grande.');
      }
    }
    return { ok: er.length === 0, errores: er };
  }

  /* ---------- analisis de hojas ---------- */
  function rango(ws) {
    if (!ws || !ws['!ref']) return null;
    var r = window.XLSX.utils.decode_range(ws['!ref']);
    return { f0: r.s.r, f1: Math.min(r.e.r, LIM.filas + 20), c0: r.s.c, c1: Math.min(r.e.c, LIM.columnas) };
  }

  function analizarCalificaciones(ws, nombre) {
    var R = rango(ws), avisos = [], filaCab = -1, i, c;
    if (!R) return null;
    for (i = R.f0; i <= Math.min(R.f1, R.f0 + 15) && filaCab < 0; i++) {
      var np = 0; for (c = R.c0; c <= R.c1; c++) if (hnorm(celda(ws, i, c).texto) === 'P1') np++;
      if (np >= 1) filaCab = i;
    }
    if (filaCab < 0) return null;
    var H = {}; for (c = R.c0; c <= R.c1; c++) H[c] = hnorm(celda(ws, filaCab, c).texto);
    var inicios = []; for (c = R.c0; c <= R.c1; c++) if (H[c] === 'P1') inicios.push(c);
    var cols = { no: -1, ap: -1, nom: -1, unico: -1, comps: [], cf: -1, cfc: -1, cec: -1, cex: -1, cexf: -1, esp: -1, a: -1, r: -1 };
    for (c = R.c0; c < inicios[0]; c++) {
      var h = H[c];
      if (h === 'NO.' || h === 'NO' || h === 'N.') cols.no = c;
      else if (h === 'APELLIDOS') cols.ap = c;
      else if (h === 'NOMBRES') cols.nom = c;
      else if (h === 'NOMBRE' || h === 'NOMBRESYAPELLIDOS' || h === 'ESTUDIANTE' || h === 'ESTUDIANTES') cols.unico = c;
    }
    if (cols.ap < 0 && cols.nom < 0 && cols.unico < 0) { avisos.push('No se encontró la columna de nombres.'); return { tipo: 'calificaciones', nombre: nombre, filas: [], avisos: avisos, valida: false }; }
    var NP = 4, finGrupos = R.c0;
    inicios.forEach(function (c0, g) {
      var fin = g + 1 < inicios.length ? inicios[g + 1] - 1 : R.c1, grp = { p: [], rp: [], prom: -1 };
      for (var k = 1; k <= NP; k++) {
        var pc = -1; for (var cc = c0; cc <= fin; cc++) if (H[cc] === 'P' + k) { pc = cc; break; }
        grp.p.push(pc); grp.rp.push(pc >= 0 && H[pc + 1] === 'RP' ? pc + 1 : -1);
      }
      for (var cp = c0; cp <= fin; cp++) if (H[cp] === 'PROM') { grp.prom = cp; break; }
      cols.comps.push(grp); finGrupos = Math.max(finGrupos, grp.prom >= 0 ? grp.prom : grp.rp[NP - 1] >= 0 ? grp.rp[NP - 1] : grp.p[NP - 1]);
    });
    if (cols.comps.length !== 4) avisos.push('Se esperaban 4 competencias y se encontraron ' + cols.comps.length + '.');
    for (c = finGrupos + 1; c <= R.c1; c++) {
      var hh = H[c];
      if (hh === 'CF' && cols.cf < 0) cols.cf = c; else if (hh === 'CFC' && cols.cfc < 0) cols.cfc = c; else if (hh === 'CEC' && cols.cec < 0) cols.cec = c;
      else if ((hh === 'CEEX' || hh === 'CEX') && cols.cex < 0) cols.cex = c; else if (hh === 'CEXF' && cols.cexf < 0) cols.cexf = c;
      else if (hh === 'CE' && cols.esp < 0) cols.esp = c; else if (hh === 'A' && cols.a < 0 && cols.esp >= 0) cols.a = c; else if (hh === 'R' && cols.r < 0 && cols.esp >= 0) cols.r = c;
    }
    var filas = [], maxFilas = Math.min(R.f1, filaCab + LIM.filas);
    if (R.f1 > filaCab + LIM.filas) avisos.push('La hoja supera ' + LIM.filas + ' filas: se ignoran las siguientes.');
    for (i = filaCab + 1; i <= maxFilas; i++) {
      var ap = cols.ap >= 0 ? celda(ws, i, cols.ap) : {}, nm = cols.nom >= 0 ? celda(ws, i, cols.nom) : {}, un = cols.unico >= 0 ? celda(ws, i, cols.unico) : {};
      var apT = ap.texto || '', nmT = nm.texto || '', unT = un.texto || '';
      if (!apT && !nmT && !unT) continue;
      if (hnorm(apT) === 'APELLIDOS' || hnorm(unT) === 'NOMBRESYAPELLIDOS') continue;
      var f = { fila: i + 1, no: cols.no >= 0 ? celda(ws, i, cols.no).v : null, apellidos: apT, nombres: nmT, unico: unT, nombreCompleto: unT || (apT + ' ' + nmT).trim(), c: [], cec: null, cex: null, esp: null, avisos: [], archivo: { prom: [], cf: null, cfc: null, cexf: null, marca: null, errores: [] }, formulas: { prom: [], cf: null } };
      function num(cel, et) { // numero valido de nota; texto o fuera de rango -> aviso
        if (cel.error) { f.archivo.errores.push(et + ': ' + cel.error); return null; }
        if (cel.v === null && cel.texto) { f.avisos.push(et + ': valor no numérico omitido'); return null; }
        if (cel.v !== null && (cel.v < 0 || cel.v > 100)) { f.avisos.push(et + ': ' + cel.v + ' fuera de 0–100, omitido'); return null; }
        return cel.v;
      }
      cols.comps.forEach(function (g, gi) {
        var comp = { p: [], rp: [] };
        for (var k = 0; k < NP; k++) {
          comp.p.push(g.p[k] >= 0 ? num(celda(ws, i, g.p[k]), 'C' + (gi + 1) + ' P' + (k + 1)) : null);
          comp.rp.push(g.rp[k] >= 0 ? num(celda(ws, i, g.rp[k]), 'C' + (gi + 1) + ' RP' + (k + 1)) : null);
        }
        f.c.push(comp);
        if (g.prom >= 0) {
          var pc = celda(ws, i, g.prom); f.archivo.prom.push(pc.v); if (pc.error) f.archivo.errores.push('Prom C' + (gi + 1) + ': ' + pc.error);
          f.formulas.prom.push(clasificarFormula(pc.f, g));
        } else { f.archivo.prom.push(null); f.formulas.prom.push(null); }
      });
      if (cols.cec >= 0) f.cec = num(celda(ws, i, cols.cec), 'CEC');
      if (cols.cex >= 0) f.cex = num(celda(ws, i, cols.cex), 'CEX');
      if (cols.esp >= 0) f.esp = num(celda(ws, i, cols.esp), 'CE');
      if (cols.cf >= 0) { var cf = celda(ws, i, cols.cf); f.archivo.cf = cf.v; if (cf.error) f.archivo.errores.push('CF: ' + cf.error); f.formulas.cf = clasificarCF(cf.f, cols); }
      if (cols.cfc >= 0) f.archivo.cfc = celda(ws, i, cols.cfc).v;
      if (cols.cexf >= 0) f.archivo.cexf = celda(ws, i, cols.cexf).v;
      if (cols.a >= 0 && celda(ws, i, cols.a).texto) f.archivo.marca = 'A'; else if (cols.r >= 0 && celda(ws, i, cols.r).texto) f.archivo.marca = 'R';
      filas.push(f);
    }
    return { tipo: 'calificaciones', nombre: nombre, filaCab: filaCab + 1, cols: cols, filas: filas, avisos: avisos, valida: true };
  }

  var RE_REF = /\$?([A-Z]{1,3})\$?(\d+)/g;
  function refsDe(f) { var o = [], m; RE_REF.lastIndex = 0; while ((m = RE_REF.exec(f))) o.push(window.XLSX.utils.decode_col(m[1])); return o; }
  /** Clasifica la formula de Prom: 'estandar' (IF(P<min,RP,P) o la nuestra), 'solo-P' (ignora RP), 'mezcla' (P y RP mezclados sin regla), 'ref' (#REF!), 'otra', 'valor' (sin formula). */
  function clasificarFormula(f, g) {
    if (!f) return 'valor';
    if (/#REF!/i.test(f)) return 'ref';
    if (/\bIF\s*\(/i.test(f)) return 'estandar';
    var cs = refsDe(f), P = g.p, RP = g.rp, soloP = cs.length >= 2 && cs.every(function (c) { return P.indexOf(c) !== -1; }), alguno = cs.some(function (c) { return RP.indexOf(c) !== -1; });
    if (soloP) return 'solo-P'; if (alguno) return 'mezcla'; return 'otra';
  }
  function clasificarCF(f, cols) {
    if (!f) return 'valor'; if (/#REF!/i.test(f)) return 'ref';
    var proms = cols.comps.map(function (g) { return g.prom; }), cs = refsDe(f);
    if (/\bAVERAGE\s*\(/i.test(f) || (cs.length === proms.length && cs.every(function (c) { return proms.indexOf(c) !== -1; }))) return 'estandar';
    return 'otra';
  }

  function analizarMeritorios(ws, nombre) {
    var R = rango(ws), fc = -1, c, i, avisos = [];
    if (!R) return null;
    for (i = R.f0; i <= Math.min(R.f1, R.f0 + 10) && fc < 0; i++) for (c = R.c0; c <= R.c1; c++) if (hnorm(celda(ws, i, c).texto) === 'PROMEDIO') { fc = i; break; }
    if (fc < 0) return null;
    var H = {}, cNom = -1, cAp = -1, cProm = -1, cNo = -1, subj = [];
    for (c = R.c0; c <= R.c1; c++) { H[c] = hnorm(celda(ws, fc, c).texto); if (H[c] === 'APELLIDOS') cAp = c; else if (H[c] === 'NOMBRES') cNom = c; else if (H[c] === 'PROMEDIO') cProm = c; else if (H[c] === 'NO.') cNo = c; }
    if (cNom < 0 && cAp < 0) return null;
    for (c = Math.max(cNom, cAp) + 1; c < cProm; c++) if (H[c]) subj.push({ col: c, cod: String(celda(ws, fc, c).texto || '').slice(0, 20) });
    var titulo = ''; for (i = R.f0; i < fc && !titulo; i++) for (c = R.c0; c <= R.c1; c++) { var t = celda(ws, i, c).texto; if (t) { titulo = t; break; } }
    var filas = [];
    for (i = fc + 1; i <= Math.min(R.f1, fc + LIM.filas); i++) {
      var n = ((cAp >= 0 ? celda(ws, i, cAp).texto || '' : '') + ' ' + (cNom >= 0 ? celda(ws, i, cNom).texto || '' : '')).trim(); if (!n) continue;
      var notas = subj.map(function (s) { var x = celda(ws, i, s.col); return x.v; }), pc = celda(ws, i, cProm), vals = notas.filter(function (x) { return x !== null; });
      var calcMedia = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
      var nrefs = pc.f ? refsDe(pc.f).length : null;
      filas.push({ fila: i + 1, no: cNo >= 0 ? celda(ws, i, cNo).v : null, nombreCompleto: n, notas: notas, prom: pc.v, error: pc.error, media: calcMedia, refs: nrefs, nSubj: vals.length });
    }
    return { tipo: 'meritorios', nombre: nombre, titulo: titulo, asignaturas: subj.map(function (s) { return s.cod; }), filas: filas, avisos: avisos, valida: true };
  }

  function analizarCompletivo(ws, nombre) {
    var R = rango(ws), grupos = [], actual = null, i, titulo = '';
    if (!R) return null;
    for (i = R.f0; i <= Math.min(R.f1, R.f0 + LIM.filas); i++) {
      var a = celda(ws, i, R.c0), b = celda(ws, i, R.c0 + 1);
      if (a.v === null && !a.texto && b.texto) { // etiqueta de grupo o titulo
        var sig = celda(ws, i + 1, R.c0); if (hnorm(sig.texto) === 'NO.' || hnorm(celda(ws, i + 1, R.c0 + 1).texto) === 'NOMBRE') { actual = { etiqueta: b.texto, nombres: [] }; grupos.push(actual); }
      } else if (a.texto && !b.texto && !grupos.length && !titulo) titulo = a.texto;
      else if (a.v !== null && b.texto && actual) actual.nombres.push({ fila: i + 1, no: a.v, nombreCompleto: b.texto });
    }
    if (!titulo) { var t0 = celda(ws, R.f0, R.c0).texto; if (t0) titulo = t0; }
    return { tipo: 'completivo', nombre: nombre, titulo: titulo, grupos: grupos, avisos: [], valida: true };
  }

  /** Lee y analiza un .xlsx. buffer: ArrayBuffer. -> {hojas:[...], ignoradas:[nombres]} (lanza Error si el archivo no es valido). */
  function analizarLibro(buffer, nombreArchivo) {
    exigirXlsx();
    var v = validarArchivo(nombreArchivo, buffer.byteLength, buffer);
    if (!v.ok) throw new Error(v.errores.join(' '));
    var wb;
    try { wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellFormula: true, cellStyles: false, cellNF: false, cellHTML: false, cellDates: false, bookVBA: false, sheetRows: LIM.filas + 25 }); }
    catch (e) { throw new Error('No se pudo leer el libro: ' + (e && e.message ? e.message : 'formato no válido')); }
    if (wb.SheetNames.length > LIM.hojas) throw new Error('El libro tiene demasiadas hojas (máximo ' + LIM.hojas + ').');
    var hojas = [], ignoradas = [];
    wb.SheetNames.forEach(function (n) {
      var ws = wb.Sheets[n], h = null; if (!ws || !ws['!ref']) { ignoradas.push(n); return; }
      var rg = window.XLSX.utils.decode_range(ws['!ref']);
      if (rg.e.c > LIM.columnas + 40) { ignoradas.push(n); return; }
      if (/merit/i.test(n)) h = analizarMeritorios(ws, n);
      else if (/complet/i.test(n)) h = analizarCompletivo(ws, n);
      if (!h) h = analizarCalificaciones(ws, n) || analizarMeritorios(ws, n);
      if (!h && !/complet/i.test(n)) h = null;
      if (h && h.valida !== false) hojas.push(h); else ignoradas.push(n);
    });
    return { hojas: hojas, ignoradas: ignoradas };
  }

  /* ---------- emparejar estudiantes ---------- */
  /** emparejar(nombreCompleto, estudiantes, preferidos:Set de ids) -> {estado:'ok'|'noEncontrado'|'ambiguo', est, candidatos} */
  function emparejar(nombre, estudiantes, preferidos) {
    var k = claveNombre(nombre), t = tokens(nombre), cand = estudiantes.filter(function (e) { return claveNombre(e.apellidos + ' ' + e.nombres) === k; });
    if (!cand.length && t.length >= 2) { // inclusion de palabras (p. ej. falta un segundo nombre) con al menos 2 palabras
      cand = estudiantes.filter(function (e) {
        var te = tokens(e.apellidos + ' ' + e.nombres), peq = t.length <= te.length ? t : te, gr = t.length <= te.length ? te : t;
        return peq.length >= 2 && peq.every(function (x) { return gr.indexOf(x) !== -1; });
      });
    }
    if (cand.length > 1 && preferidos) { var pr = cand.filter(function (e) { return preferidos.has(e.id); }); if (pr.length) cand = pr; }
    if (cand.length === 1) return { estado: 'ok', est: cand[0], candidatos: cand };
    return { estado: cand.length ? 'ambiguo' : 'noEncontrado', est: null, candidatos: cand };
  }
  /** Divide "Nombres Apellidos" (columna unica) en {nombres, apellidos}: las dos ultimas palabras son apellidos (heuristica; revisable). */
  function partirNombre(txt) {
    var w = String(txt).trim().split(/\s+/);
    if (w.length <= 1) return { nombres: w[0] || '', apellidos: '' };
    if (w.length === 2) return { nombres: w[0], apellidos: w[1] };
    return { nombres: w.slice(0, w.length - 2).join(' '), apellidos: w.slice(-2).join(' '), heuristica: true };
  }

  /* ---------- aplicar a registros y revisar ---------- */
  function nuevoRec() { var a = []; for (var c = 0; c < 4; c++) a.push({ p: [null, null, null, null], rp: [null, null, null, null] }); return { c: a, cec: null, cex: null, esp: null }; }
  /** Mezcla una fila del archivo sobre un registro existente (o nuevo). Las celdas en blanco no borran lo existente salvo vaciar=true. -> {rec, cambios} */
  function aplicarFila(fila, existente, vaciar) {
    var rec = JSON.parse(JSON.stringify(existente && existente.c ? existente : Object.assign({}, existente || {}, nuevoRec()))), cambios = 0;
    function poner(v, antes, set) { if (v === null && !vaciar) return; if (v !== antes) { if (!(v === null && antes === null)) cambios++; set(v); } }
    fila.c.forEach(function (cm, ci) {
      rec.c[ci] = rec.c[ci] || { p: [null, null, null, null], rp: [null, null, null, null] };
      for (var k = 0; k < 4; k++) (function (k) {
        poner(cm.p[k], rec.c[ci].p[k] === undefined ? null : rec.c[ci].p[k], function (v) { rec.c[ci].p[k] = v; });
        poner(cm.rp[k], rec.c[ci].rp[k] === undefined ? null : rec.c[ci].rp[k], function (v) { rec.c[ci].rp[k] = v; });
      })(k);
    });
    ['cec', 'cex', 'esp'].forEach(function (k) { poner(fila[k], rec[k] === undefined ? null : rec[k], function (v) { rec[k] = v; }); });
    return { rec: rec, cambios: cambios };
  }
  function calcDeRec(rec, escala) { return calc().calcularCompetencias({ competencias: rec.c, cec: rec.cec, cex: rec.cex, esp: rec.esp, escala: escala }); }

  /** Compara lo que dice el archivo con el calculo de Educentro para una fila. -> [{tipo, detalle}] tipos: 'formula','valor','error','estado','aviso' */
  function revisarFila(fila, rec, escala, tol) {
    tol = tol || 0.005; var out = [], r = calcDeRec(rec, escala), ET = { 'solo-P': 'promedia solo P (ignora RP)', mezcla: 'mezcla P y RP sin la regla', ref: 'referencia rota (#REF!)', otra: 'fórmula distinta a la estándar' };
    fila.avisos.forEach(function (a) { out.push({ tipo: 'aviso', detalle: a }); });
    fila.archivo.errores.forEach(function (e) { out.push({ tipo: 'error', detalle: e }); });
    fila.formulas.prom.forEach(function (c, i) { if (c && ET[c]) out.push({ tipo: 'formula', detalle: 'Prom C' + (i + 1) + ': ' + ET[c] }); });
    if (fila.formulas.cf && ET[fila.formulas.cf]) out.push({ tipo: 'formula', detalle: 'CF: ' + ET[fila.formulas.cf] });
    fila.archivo.prom.forEach(function (v, i) { var c = r.competencias[i]; if (v !== null && c && c.promedio !== null && Math.abs(v - c.promedio) > tol) out.push({ tipo: 'valor', detalle: 'Prom C' + (i + 1) + ': archivo ' + calc().redondear(v, 2) + ' vs Educentro ' + calc().redondear(c.promedio, 2) }); });
    if (fila.archivo.cf !== null && r.cf !== null && Math.abs(fila.archivo.cf - r.cf) > tol) out.push({ tipo: 'valor', detalle: 'CF: archivo ' + calc().redondear(fila.archivo.cf, 2) + ' vs Educentro ' + calc().redondear(r.cf, 2) });
    if (fila.archivo.cfc !== null && r.cfc !== null && Math.abs(fila.archivo.cfc - r.cfc) > tol) out.push({ tipo: 'valor', detalle: 'CFC: archivo ' + calc().redondear(fila.archivo.cfc, 2) + ' vs Educentro ' + calc().redondear(r.cfc, 2) });
    if (fila.archivo.cexf !== null && r.cexf !== null && Math.abs(fila.archivo.cexf - r.cexf) > tol) out.push({ tipo: 'valor', detalle: 'CEXF: archivo ' + calc().redondear(fila.archivo.cexf, 2) + ' vs Educentro ' + calc().redondear(r.cexf, 2) });
    if (fila.archivo.marca && r.estado !== 'Pendiente') {
      var esperado = r.estado === 'Aprobado' ? 'A' : (r.estado === 'Reprobado' ? 'R' : null);
      if (esperado && esperado !== fila.archivo.marca) out.push({ tipo: 'estado', detalle: 'Resultado: archivo ' + fila.archivo.marca + ' vs Educentro ' + r.estado });
    }
    return out;
  }

  /* ---------- exportacion ---------- */
  function ordenCols(N, P) { // posiciones 0-based de las columnas de la hoja de calificaciones
    var o = { no: 0, ap: 1, nom: 2, g: [], P: P, N: N }, c = 3, g, k;
    for (g = 0; g < N; g++) { var gr = { p: [], rp: [], prom: 0 }; for (k = 0; k < P; k++) { gr.p.push(c++); gr.rp.push(c++); } gr.prom = c++; o.g.push(gr); }
    o.cf = c++; o.cf50 = c++; o.cec = c++; o.cec50 = c++; o.cfc = c++; o.cf30 = c++; o.cex = c++; o.cex70 = c++; o.cexf = c++; o.cfx = c++; o.esp = c++; o.a = c++; o.r = c++; o.fin = c++; o.res = c++; o.np = c++; o.fin1 = c;
    return o;
  }
  function num(x) { return String(x).replace(/\.?0+$/, function (m) { return m.indexOf('.') === 0 ? '' : m; }); }
  /** Formulas de una fila (excel fila 1-based `x`). Misma regla que EDU.calculo.calcularCompetencias en TODAS las filas. */
  function formulasFila(O, cfg, escala, x) {
    var m = calc().configCompetencias(escala), min = escala.notaMinAprobar, A = function (c) { return colLetra(c) + x; }, F = {}, nterms = [];
    var w = m.completiva, we = m.extraordinaria, wc = m.especial.ce / 100, regla = m.regla;
    O.g.forEach(function (g, gi) {
      var ef = [], nn = [];
      for (var k = 0; k < O.P; k++) {
        var p = A(g.p[k]), rp = A(g.rp[k]), rr = regla === 'maximo' ? 'MAX(' + p + ',' + rp + ')' : rp;
        ef.push('IF(ISNUMBER(' + p + '),IF(AND(' + p + '<' + min + ',ISNUMBER(' + rp + ')),' + rr + ',' + p + '),IF(ISNUMBER(' + rp + '),' + rp + ',0))');
        nn.push('IF(OR(ISNUMBER(' + p + '),ISNUMBER(' + rp + ')),1,0)');
      }
      F[g.prom] = 'IF(' + nn.join('+') + '=0,"",(' + ef.join('+') + ')/(' + nn.join('+') + '))'; nterms = nterms.concat(nn);
    });
    var proms = O.g.map(function (g) { return A(g.prom); }).join(',');
    var cf = A(O.cf), cec = A(O.cec), cfc = A(O.cfc), cex = A(O.cex), cexf = A(O.cexf), esp = A(O.esp), tol = '-0.000000001', tot = O.N * O.P;
    F[O.cf] = 'IF(COUNT(' + proms + ')=0,"",AVERAGE(' + proms + '))';
    F[O.cf50] = 'IF(ISNUMBER(' + cf + '),' + cf + '*' + num(w.cf / (w.cf + w.cec)) + ',"")';
    F[O.cec50] = 'IF(ISNUMBER(' + cec + '),' + cec + '*' + num(w.cec / (w.cf + w.cec)) + ',"")';
    F[O.cfc] = 'IF(AND(ISNUMBER(' + A(O.cf50) + '),ISNUMBER(' + A(O.cec50) + ')),' + A(O.cf50) + '+' + A(O.cec50) + ',"")';
    F[O.cf30] = 'IF(ISNUMBER(' + cf + '),' + cf + '*' + num(we.cf / (we.cf + we.cex)) + ',"")';
    F[O.cex70] = 'IF(ISNUMBER(' + cex + '),' + cex + '*' + num(we.cex / (we.cf + we.cex)) + ',"")';
    F[O.cexf] = 'IF(AND(ISNUMBER(' + A(O.cf30) + '),ISNUMBER(' + A(O.cex70) + ')),' + A(O.cf30) + '+' + A(O.cex70) + ',"")';
    F[O.cfx] = 'IF(ISNUMBER(' + cf + '),' + cf + ',"")';
    var np = A(O.np);
    F[O.np] = nterms.join('+');
    F[O.res] = 'IF(OR(NOT(ISNUMBER(' + cf + ')),' + np + '<' + tot + '),"Pendiente",IF(' + cf + '>=' + min + tol + ',"Aprobado",IF(NOT(ISNUMBER(' + cec + ')),"Completiva",IF(' + cfc + '>=' + min + tol + ',"Aprobado",IF(NOT(ISNUMBER(' + cex + ')),"Extraordinaria",IF(' + cexf + '>=' + min + tol + ',"Aprobado",IF(AND(ISNUMBER(' + esp + '),' + esp + '*' + num(wc) + '>=' + min + tol + '),"Aprobado","Reprobado")))))))';
    F[O.fin] = 'IF(NOT(ISNUMBER(' + cf + ')),"",IF(OR(' + np + '<' + tot + ',' + cf + '>=' + min + tol + '),' + cf + ',IF(NOT(ISNUMBER(' + cec + ')),' + cf + ',IF(' + cfc + '>=' + min + tol + ',' + cfc + ',IF(NOT(ISNUMBER(' + cex + ')),' + cfc + ',IF(' + cexf + '>=' + min + tol + ',' + cexf + ',IF(ISNUMBER(' + esp + '),' + esp + '*' + num(wc) + ',' + cexf + ')))))))';
    F[O.a] = 'IF(' + A(O.res) + '="Aprobado","X","")'; F[O.r] = 'IF(' + A(O.res) + '="Reprobado","X","")';
    return F;
  }

  /** Construye un libro SheetJS. d: {escala, hojas:[{nombre,titulo,estudiantes:[{apellidos,nombres,rec}]}], meritorios?:{nombre,titulo,asignaturas:[cod],filas:[{apellidos,nombres,notas:[n|null]}]}, completivo?:{nombre,titulo,grupos:[{etiqueta,estudiantes:[{apellidos,nombres}]}]}} */
  function construirLibro(d) {
    exigirXlsx(); var X = window.XLSX, wb = X.utils.book_new(), usados = {}, cf = calc().configCompetencias(d.escala);
    function nombreHoja(n) { var b = String(n || 'Hoja').replace(/[\\\/?*\[\]:]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Hoja', k = b, i = 2; while (usados[k.toLowerCase()]) { k = b.slice(0, 28) + ' ' + i++; } usados[k.toLowerCase()] = 1; return k; }
    function S(v) { return { t: 's', v: neutralizar(String(v == null ? '' : v)) }; }
    d.hojas.forEach(function (h) {
      var O = ordenCols(cf.competencias, cf.periodos), ws = {}, x;
      ws[ref(0, 0)] = S(h.titulo || h.nombre);
      O.g.forEach(function (g, gi) { ws[ref(1, g.p[0])] = S('COMPETENCIA ' + (gi + 1) + ' · ' + cf.nombres[gi]); });
      ws[ref(1, O.cec)] = S('Calificación completiva'); ws[ref(1, O.cex)] = S('Calificación extraordinaria'); ws[ref(1, O.cfx)] = S('Calificación especial'); ws[ref(1, O.fin)] = S('Calculado por Educentro');
      ws[ref(2, 0)] = S('No.'); ws[ref(2, 1)] = S('Apellidos'); ws[ref(2, 2)] = S('Nombres');
      O.g.forEach(function (g) { for (var k = 0; k < O.P; k++) { ws[ref(2, g.p[k])] = S('P' + (k + 1)); ws[ref(2, g.rp[k])] = S('RP'); } ws[ref(2, g.prom)] = S('Prom'); });
      var tit = [[O.cf, 'CF'], [O.cf50, Math.round(cf.completiva.cf) + '%CF'], [O.cec, 'CEC'], [O.cec50, Math.round(cf.completiva.cec) + '%CEC'], [O.cfc, 'CFC'], [O.cf30, Math.round(cf.extraordinaria.cf) + '%CF'], [O.cex, 'CEEX'], [O.cex70, Math.round(cf.extraordinaria.cex) + '%CEX'], [O.cexf, 'CEXF'], [O.cfx, 'CF'], [O.esp, 'CE'], [O.a, 'A'], [O.r, 'R'], [O.fin, 'Nota final'], [O.res, 'Resultado'], [O.np, 'Periodos con nota']];
      tit.forEach(function (t) { ws[ref(2, t[0])] = S(t[1]); });
      h.estudiantes.forEach(function (e, i) {
        var r = 3 + i; x = r + 1; var rec = e.rec || { c: [], cec: null, cex: null, esp: null }, res = calc().calcularCompetencias({ competencias: rec.c, cec: rec.cec, cex: rec.cex, esp: rec.esp, escala: d.escala });
        ws[ref(r, 0)] = { t: 'n', v: i + 1 }; ws[ref(r, 1)] = S(e.apellidos); ws[ref(r, 2)] = S(e.nombres);
        O.g.forEach(function (g, gi) { for (var k = 0; k < O.P; k++) { var c = rec.c && rec.c[gi]; var p = c && c.p ? c.p[k] : null, rp = c && c.rp ? c.rp[k] : null; if (p != null) ws[ref(r, g.p[k])] = { t: 'n', v: p }; if (rp != null) ws[ref(r, g.rp[k])] = { t: 'n', v: rp }; } });
        if (rec.cec != null) ws[ref(r, O.cec)] = { t: 'n', v: rec.cec }; if (rec.cex != null) ws[ref(r, O.cex)] = { t: 'n', v: rec.cex }; if (rec.esp != null) ws[ref(r, O.esp)] = { t: 'n', v: rec.esp };
        var F = formulasFila(O, cf, d.escala, x);
        function cv(col, val) { var o = typeof val === 'number' ? { t: 'n', v: val } : { t: 's', v: val == null ? '' : val }; o.f = F[col]; ws[ref(r, col)] = o; }
        O.g.forEach(function (g, gi) { cv(g.prom, res.competencias[gi].promedio); });
        var w1 = cf.completiva, w2 = cf.extraordinaria;
        cv(O.cf, res.cf); cv(O.cf50, res.cf == null ? null : res.cf * w1.cf / (w1.cf + w1.cec)); cv(O.cec50, rec.cec == null ? null : rec.cec * w1.cec / (w1.cf + w1.cec));
        var cfc = res.cf != null && rec.cec != null ? (res.cf * w1.cf + rec.cec * w1.cec) / (w1.cf + w1.cec) : null, cexf = res.cf != null && rec.cex != null ? (res.cf * w2.cf + rec.cex * w2.cex) / (w2.cf + w2.cex) : null;
        cv(O.cfc, cfc); cv(O.cf30, res.cf == null ? null : res.cf * w2.cf / (w2.cf + w2.cex)); cv(O.cex70, rec.cex == null ? null : rec.cex * w2.cex / (w2.cf + w2.cex)); cv(O.cexf, cexf);
        cv(O.cfx, res.cf); cv(O.fin, res.final == null ? null : res.final); cv(O.res, res.estado); cv(O.a, res.estado === 'Aprobado' ? 'X' : ''); cv(O.r, res.estado === 'Reprobado' ? 'X' : '');
        var np = 0; (rec.c || []).forEach(function (c) { for (var k = 0; k < O.P; k++) if (c && ((c.p && c.p[k] != null) || (c.rp && c.rp[k] != null))) np++; }); cv(O.np, np);
      });
      var ult = 3 + Math.max(h.estudiantes.length, 1) - 1; ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ult, c: O.fin1 - 1 } });
      var cw = []; for (var c = 0; c < O.fin1; c++) cw.push({ wch: c === 1 || c === 2 ? 22 : c === 0 ? 5 : 7 }); cw[O.res] = { wch: 14 }; ws['!cols'] = cw;
      X.utils.book_append_sheet(wb, ws, nombreHoja(h.nombre));
    });
    if (d.meritorios) {
      var M = d.meritorios, ws2 = {}, ns = M.asignaturas.length;
      ws2[ref(1, 2)] = S(M.titulo || 'Meritorios');
      ['No.', 'Apellidos', 'Nombres'].forEach(function (t, i) { ws2[ref(2, 1 + i)] = S(t); });
      M.asignaturas.forEach(function (a, i) { ws2[ref(2, 4 + i)] = S(a); }); ws2[ref(2, 4 + ns)] = S('Promedio');
      M.filas.forEach(function (f, i) {
        var r = 3 + i; ws2[ref(r, 1)] = { t: 'n', v: i + 1 }; ws2[ref(r, 2)] = S(f.apellidos); ws2[ref(r, 3)] = S(f.nombres);
        var vals = []; f.notas.forEach(function (n, k) { if (n != null) { ws2[ref(r, 4 + k)] = { t: 'n', v: n }; vals.push(n); } });
        var rng = colLetra(4) + (r + 1) + ':' + colLetra(3 + ns) + (r + 1), o = vals.length ? { t: 'n', v: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length } : { t: 's', v: '' };
        o.f = 'IF(COUNT(' + rng + ')=0,"",AVERAGE(' + rng + '))'; ws2[ref(r, 4 + ns)] = o;
      });
      ws2['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + Math.max(M.filas.length, 1), c: 4 + ns } }); ws2['!cols'] = [{ wch: 2 }, { wch: 5 }, { wch: 22 }, { wch: 22 }];
      X.utils.book_append_sheet(wb, ws2, nombreHoja(M.nombre || 'Meritorios'));
    }
    if (d.completivo) {
      var C = d.completivo, ws3 = {}, r3 = 2; ws3[ref(0, 0)] = S(C.titulo || 'Estudiantes en completivo');
      C.grupos.forEach(function (g) {
        ws3[ref(r3, 1)] = S(g.etiqueta); r3++; ws3[ref(r3, 0)] = S('No.'); ws3[ref(r3, 1)] = S('Nombre'); r3++;
        g.estudiantes.forEach(function (e, i) { ws3[ref(r3, 0)] = { t: 'n', v: i + 1 }; ws3[ref(r3, 1)] = S((e.nombres + ' ' + e.apellidos).trim()); r3++; }); r3++;
      });
      ws3['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r3, 2), c: 1 } }); ws3['!cols'] = [{ wch: 5 }, { wch: 40 }];
      X.utils.book_append_sheet(wb, ws3, nombreHoja(C.nombre || 'Completivo'));
    }
    return wb;
  }
  function libroABytes(wb) { exigirXlsx(); return window.XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }); }

  EDU.planilla = { LIM: LIM, norm: norm, claveNombre: claveNombre, neutralizar: neutralizar, validarArchivo: validarArchivo, analizarLibro: analizarLibro, emparejar: emparejar, partirNombre: partirNombre,
    aplicarFila: aplicarFila, calcDeRec: calcDeRec, revisarFila: revisarFila, construirLibro: construirLibro, libroABytes: libroABytes, ordenCols: ordenCols, nuevoRec: nuevoRec };
})();
