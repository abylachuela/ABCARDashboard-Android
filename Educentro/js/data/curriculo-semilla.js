/* EDU.curriculoSemilla: catalogo curricular MINERD sembrado SOLO con lo respaldado por docs/CURRICULO-MINERD.md (informe PARCIAL, confianza media).
   Todo dato lleva estado ('verificado'|'pendiente'), fuente (url) y fecha. Lo no verificado queda como entrada "pendiente de validar" (editable); no se inventan contenidos oficiales.
   Tambien aloja el conversor documento JSON <-> registros planos (aplanar), el hash y el validador del esquema de importacion, usados por js/vistas/curriculo.js. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var FECHA = '2026-11-19';
  var U = {
    comp1: 'https://acento.com.do/opinion/el-enfoque-por-competencias-educacion-utilitarista-9300760.html',
    prim1: 'https://www.ministeriodeeducacion.gob.do/docs/direccion-general-de-curriculo/MusI-diseno-curricular-del-nivel-primario-primer-ciclopdf.pdf',
    prim2: 'https://minerd.gob.do/docs/direccion-general-de-educacion-primaria/VFXG-diseno-curricular-nivel-primario-segundo-ciclopdf.pdf',
    sec1: 'https://elnuevodiario.com.do/consejo-nacional-de-educacion-aprueba-medidas-para-fortalecer-nuevo-curriculo-por-competencias-2/',
    sec2: 'https://ideice.gob.do/pdf/publications/20240708193435.pdf',
    artes: 'https://presidencia.gob.do/noticias/ministerio-de-educacion-resalta-impacto-de-la-modalidad-en-artes-en-el-desarrollo-de-la',
    etp: 'https://www.minerd.gob.do/docs/direccion-de-educacion-tecnico-profesional/565q-2024-registro-6to-etp-20240925pdfpdf.pdf',
    ini: 'https://www.ministeriodeeducacion.gob.do/docs/direccion-general-de-curriculo/raHf-nivel-inicial-diseno-curricular-actualizado-webpdf.pdf',
    ada: 'https://siteal.iiep.unesco.org/sites/default/files/sit_accion_files/ht7x-adecuacion-secundaria-2023pdf.pdf'
  };
  var AREAS = [['LE', 'Lengua Española'], ['MAT', 'Matemática'], ['CS', 'Ciencias Sociales'], ['CN', 'Ciencias de la Naturaleza'], ['ING', 'Lenguas Extranjeras (Inglés)'],
    ['EF', 'Educación Física'], ['EA', 'Educación Artística'], ['FIHR', 'Formación Integral Humana y Religiosa']];
  var PEND = 'Pendiente de validar: transcribir del diseño curricular oficial (no verificado).';

  function pend(id, fuente) { return { id: id, text: PEND, estado: 'pendiente', fuente: fuente }; }
  function areasPend(fuente) {
    return AREAS.map(function (a) { return { id: a[0], name: a[1], specificCompetencies: [pend('ce-pend', fuente)] }; });
  }
  function ciclo(id, label, grados, estado, fuente, nota) {
    return { id: id, label: label, grades: grados, estado: estado, fuente: fuente, note: nota, areas: areasPend(fuente),
      contents: [{ id: 'ct-pend', type: 'concepto', text: PEND, estado: 'pendiente', fuente: fuente, indicators: [{ id: 'in-pend', text: PEND, estado: 'pendiente', fuente: fuente }] }] };
  }

  /** Documento fuente (esquema propuesto en docs/CURRICULO-MINERD.md, con estado/fuente por nodo). */
  var DOC = {
    schemaVersion: '1.0.0',
    curriculum: {
      id: 'minerd-bases-2016-adecuacion-2023', version: '2023-parcial',
      nombre: 'MINERD · Currículo por competencias (Bases 2016 + adecuación 2023) · parcial',
      source: { title: 'Informe de investigación docs/CURRICULO-MINERD.md (solo resúmenes de búsqueda)', url: U.ada, retrievedAt: FECHA, confidence: 'medium' },
      validity: { from: null, to: null, legalInstrument: 'Ordenanza 03-2023 (adecuación curricular)', status: 'vigente' },
      fundamentalCompetencies: [
        'Ética y Ciudadana', 'Comunicativa', 'Pensamiento Lógico, Creativo y Crítico', 'Resolución de Problemas', 'Científica y Tecnológica', 'Ambiental y de la Salud', 'Desarrollo Personal y Espiritual'
      ].map(function (n, i) { return { id: 'cf' + (i + 1), name: n, estado: 'verificado', fuente: U.comp1 }; }),
      crossCuttingAxes: [{ id: 'pend', name: 'Ejes transversales: lista oficial pendiente de validar (la adecuación 2023 los incorpora; no se obtuvo la lista)', estado: 'pendiente', fuente: U.ada }],
      areas: AREAS.map(function (a) { return { id: a[0], name: a[1], estado: 'pendiente', fuente: U.prim1 }; }),
      modalities: [
        { id: 'general', name: 'Modalidad Académica (General): 4.º–6.º de Secundaria', levelId: 'secundario', modalidad: 'General', grades: [4, 5, 6], estado: 'verificado', fuente: U.sec2 },
        { id: 'tecnico-profesional', name: 'Modalidad Técnico Profesional: formación general + profesional (familias profesionales pendientes)', levelId: 'secundario', modalidad: 'Técnico-Profesional', grades: [4, 5, 6], estado: 'verificado', fuente: U.etp },
        { id: 'artes', name: 'Modalidad en Artes: Diseño y Producción Artesanal, Danza, Teatro, Artes Plásticas, Cine y Fotografía, Multimedia', levelId: 'secundario', modalidad: 'Artes', grades: [4, 5, 6], estado: 'verificado', fuente: U.artes }
      ],
      levels: [
        { id: 'inicial', label: 'Inicial', cycles: [
          ciclo('c1', 'Primer ciclo', [], 'pendiente', U.ini, 'Primer ciclo del Nivel Inicial (división por edades no confirmada)'),
          ciclo('c2', 'Segundo ciclo', [], 'pendiente', U.ini, 'Segundo ciclo del Nivel Inicial (división por edades no confirmada)')] },
        { id: 'primario', label: 'Primario', cycles: [
          ciclo('c1', 'Primer ciclo', [1, 2, 3], 'verificado', U.prim1, 'Nivel Primario: 6 años en dos ciclos; 1.º–3.º'),
          ciclo('c2', 'Segundo ciclo', [4, 5, 6], 'verificado', U.prim2, 'Nivel Primario: 4.º–6.º')] },
        { id: 'secundario', label: 'Secundario', cycles: [
          ciclo('c1', 'Primer ciclo', [1, 2, 3], 'verificado', U.sec1, 'Secundaria, primer ciclo: 1.º, 2.º y 3.º'),
          ciclo('c2', 'Segundo ciclo', [4, 5, 6], 'verificado', U.sec2, 'Secundaria, segundo ciclo: 4.º, 5.º y 6.º (antes 2.º–4.º), en tres modalidades')] }
      ]
    }
  };

  /* ---------------- utilidades ---------------- */
  var TIPOS = { competencia_fundamental: 'Competencia fundamental', competencia_especifica: 'Competencia específica', contenido: 'Contenido', indicador: 'Indicador de logro',
    eje_transversal: 'Eje transversal', area: 'Área', estructura: 'Estructura' };
  var NIVELES = { inicial: 'Inicial', primario: 'Primario', secundario: 'Secundario' };

  /** Hash determinista (cyrb53, sin crypto: file:// no garantiza SubtleCrypto). Hex de 14 caracteres. */
  function hash(texto) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < texto.length; i++) { var c = texto.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return ('00000000000000' + n.toString(16)).slice(-14);
  }
  function hashItems(items) {
    return hash(JSON.stringify(items.slice().sort(function (a, b) { return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0; })
      .map(function (i) { return [i.clave, i.tipo, i.nivel, i.ciclo, i.grado, i.modalidad, i.areaId, i.descripcion, i.estado]; })));
  }
  function estadoDe(n, conf) { return n.estado === 'verificado' || n.estado === 'pendiente' ? n.estado : (n.confidence === 'high' || conf === 'high' ? 'verificado' : 'pendiente'); }
  function gradoNum(g) { return g == null ? null : (typeof g === 'number' ? g : (parseInt(String(g.id != null ? g.id : g), 10) || null)); }

  /** Documento (anidado o plano `items`) -> lista plana de items {clave,tipo,nivel,ciclo,grado,modalidad,areaId,padreClave,subtipo,descripcion,estado,fuente,fecha,orden}. */
  function aplanar(doc) {
    var cur = doc.curriculum, out = [], fuenteDoc = (cur.source && cur.source.url) || null, fecha = (cur.source && cur.source.retrievedAt) || FECHA, conf = cur.source && cur.source.confidence, orden = 0;
    function add(o, n) {
      o.estado = estadoDe(n, conf); o.fuente = n.fuente || n.source || fuenteDoc; if (o.fuente && typeof o.fuente === 'object') o.fuente = o.fuente.url || null;
      o.fecha = n.fecha || fecha; o.orden = ++orden; o.nivel = o.nivel || null; o.ciclo = o.ciclo || null; o.grado = o.grado == null ? null : o.grado; o.modalidad = o.modalidad || null; o.areaId = o.areaId || null;
      o.padreClave = o.padreClave || null; o.subtipo = o.subtipo || null; out.push(o); return o;
    }
    if (Array.isArray(cur.items)) {
      cur.items.forEach(function (it) { add(Object.assign({}, it), it); out[out.length - 1].orden = it.orden != null ? it.orden : out[out.length - 1].orden; });
      return out;
    }
    (cur.fundamentalCompetencies || []).forEach(function (c) { add({ clave: 'cf.' + c.id, tipo: 'competencia_fundamental', descripcion: c.name || c.text }, c); });
    (cur.crossCuttingAxes || []).forEach(function (c) { add({ clave: 'eje.' + c.id, tipo: 'eje_transversal', descripcion: c.name || c.text }, c); });
    (cur.areas || []).forEach(function (a) { add({ clave: 'area.' + a.id, tipo: 'area', areaId: a.id, descripcion: a.name }, a); });
    (cur.modalities || []).forEach(function (m) { add({ clave: 'mod.' + m.id, tipo: 'estructura', nivel: NIVELES[m.levelId] || m.levelId, ciclo: 'Segundo ciclo', modalidad: m.modalidad || m.name, descripcion: m.name }, m); });
    (cur.levels || []).forEach(function (lv) {
      var nivel = lv.label || NIVELES[lv.id] || lv.id;
      (lv.cycles || []).forEach(function (cy) {
        var base = lv.id + '.' + cy.id, cicloNom = cy.label || cy.id, gr = cy.grades || [];
        add({ clave: 'est.' + base, tipo: 'estructura', nivel: nivel, ciclo: cicloNom, descripcion: nivel + ' · ' + cicloNom + (gr.length ? ' (' + gr.map(function (g) { return gradoNum(g) + '.º'; }).join(', ') + ')' : '') + (cy.note ? ': ' + cy.note : '') }, cy);
        function areas(lista, grado, gid) {
          (lista || []).forEach(function (ar) {
            var p = base + '.' + gid + '.' + ar.id;
            (ar.specificCompetencies || []).forEach(function (sc) {
              add({ clave: 'ce.' + p + '.' + sc.id, tipo: 'competencia_especifica', nivel: nivel, ciclo: cicloNom, grado: grado, areaId: ar.id, padreClave: sc.fundamentalId ? 'cf.' + sc.fundamentalId : null, descripcion: sc.text }, sc);
            });
            (ar.contents || []).forEach(function (ct) { contenido(ct, p, nivel, cicloNom, grado, ar.id); });
          });
        }
        function contenido(ct, p, nv, cc, grado, areaId) {
          var ck = 'ct.' + p + '.' + ct.id;
          add({ clave: ck, tipo: 'contenido', subtipo: ct.type, nivel: nv, ciclo: cc, grado: grado, areaId: areaId, descripcion: ct.text }, ct);
          (ct.indicators || []).forEach(function (ind) { add({ clave: 'in.' + p + '.' + ct.id + '.' + ind.id, tipo: 'indicador', nivel: nv, ciclo: cc, grado: grado, areaId: areaId, padreClave: ck, descripcion: ind.text }, ind); });
        }
        areas(cy.areas, null, '*');
        (cy.contents || []).forEach(function (ct) { contenido(ct, base + '.*.*', nivel, cicloNom, null, null); });
        (cy.grades || []).forEach(function (g) { if (g && typeof g === 'object') areas(g.areas, gradoNum(g), g.id); });
      });
    });
    return out;
  }

  /** Valida un documento importado. Devuelve lista de errores (vacia = ok). */
  function validarDoc(doc) {
    var er = [];
    if (!doc || typeof doc !== 'object') return ['El archivo no contiene un objeto JSON.'];
    if (typeof doc.schemaVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(doc.schemaVersion)) er.push('Falta schemaVersion (ej. "1.0.0").');
    var c = doc.curriculum;
    if (!c || typeof c !== 'object') { er.push('Falta el objeto "curriculum".'); return er; }
    if (!c.id || typeof c.id !== 'string') er.push('curriculum.id es obligatorio.');
    if (!c.version && !c.nombre) er.push('curriculum.version o curriculum.nombre es obligatorio.');
    if (!Array.isArray(c.levels) && !Array.isArray(c.items) && !Array.isArray(c.fundamentalCompetencies)) er.push('Debe incluir levels, items o fundamentalCompetencies.');
    if (!er.length) {
      var items;
      try { items = aplanar(doc); } catch (e) { return ['Estructura inválida: ' + e.message]; }
      if (!items.length) er.push('El documento no contiene ningún elemento curricular.');
      var vistos = {};
      items.forEach(function (i) {
        if (!i.clave || !i.tipo || !TIPOS[i.tipo]) er.push('Elemento inválido (clave/tipo): ' + JSON.stringify(i.clave || i.descripcion || '').slice(0, 60));
        else if (vistos[i.clave]) er.push('Clave duplicada: ' + i.clave); else vistos[i.clave] = 1;
        if (!i.descripcion || typeof i.descripcion !== 'string') er.push('Sin texto/descripción: ' + i.clave);
        if (i.estado === 'verificado' && !/^https?:\/\//.test(i.fuente || '')) er.push('Elemento verificado sin fuente (url): ' + i.clave);
      });
      if (er.length > 12) { var n = er.length; er = er.slice(0, 12); er.push('… y ' + (n - 12) + ' errores más.'); }
    }
    return er;
  }

  /** Registros listos para guardar (sin ids de BD) de la version indicada. */
  function registros(doc, centroId, versionId) {
    return aplanar(doc).map(function (i) { return Object.assign({ centroId: centroId, versionId: versionId }, i); });
  }
  function versionDe(doc, items, extra) {
    var c = doc.curriculum, v = c.validity || {}, s = c.source || {};
    return Object.assign({
      nombre: c.nombre || ('Currículo ' + c.version), idExterno: c.id, version: c.version || null, fuente: s.url || null, fuenteTitulo: s.title || null, confianza: s.confidence || null,
      fechaPublicacion: c.publishedAt || null, vigenteDesde: v.from || null, instrumentoLegal: v.legalInstrument || null, schemaVersion: doc.schemaVersion,
      estado: 'borrador', hash: hashItems(items), total: items.length, descargadoEn: s.retrievedAt || null
    }, extra || {});
  }

  /** Siembra la version MINERD parcial en cada centro de D (objeto de colecciones de la semilla). */
  function sembrar(D) {
    var ahora = '2026-01-05T08:00:00.000Z';
    D.centros.forEach(function (c) {
      var n = c.id.split('_')[1], vid = 'cv_' + n + '_minerd2023', items = aplanar(DOC);
      D.curriculoVersiones.push(Object.assign(versionDe(DOC, items, { id: vid, centroId: c.id, estado: 'vigente', creadoEn: ahora, actualizadoEn: ahora })));
      items.forEach(function (it, i) { D.curriculoContenidos.push(Object.assign({ id: 'cc_' + n + '_' + (i + 1), centroId: c.id, versionId: vid, creadoEn: ahora, actualizadoEn: ahora }, it)); });
    });
  }

  EDU.curriculoSemilla = { DOC: DOC, TIPOS: TIPOS, AREAS: AREAS, FECHA: FECHA, hash: hash, hashItems: hashItems, aplanar: aplanar, validarDoc: validarDoc, registros: registros, versionDe: versionDe, sembrar: sembrar };
})();
