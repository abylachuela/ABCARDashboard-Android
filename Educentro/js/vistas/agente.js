/* Vista "agente" + capa EDU.agente: configuracion del agente IA, consola "Pidele al agente" (respuestas SIMULADAS locales),
   registro de actividad (agenteLog) y proveedor intercambiable (simulado / backend real). Ver docs/API.md seccion "Agente IA".
   Reglas: la API key NUNCA vive en el navegador; el contexto se minimiza/anonimiza; borrador_notas y proponer_horario SIEMPRE exigen
   aprobacion humana (el agente nunca guarda horarios ni notas por si mismo); borrador_notas nunca toca periodos cerrados. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  var esc = EDU.esc, ui = EDU.ui, fmt = EDU.fmt;

  var TAREAS = {
    generar_plan: { titulo: 'Generar plan de clase', desc: 'Borrador de plan; al aprobarlo se crea en Planificación como borrador.', sensible: false },
    proponer_actividades: { titulo: 'Proponer actividades', desc: 'Ideas de actividades evaluables para un tema.', sensible: false },
    crear_rubricas: { titulo: 'Crear rúbricas', desc: 'Criterios y niveles de desempeño.', sensible: false },
    redactar_comunicado: { titulo: 'Comunicados a tutores', desc: 'Redacta el texto; nunca se publica sin aprobación.', sensible: false },
    resumir_rendimiento: { titulo: 'Resumen de rendimiento', desc: 'Resumen agregado de notas de una asignatura/sección.', sensible: false },
    borrador_notas: { titulo: 'Borrador de notas', desc: 'Estimación preliminar de notas faltantes. SIEMPRE requiere aprobación humana; nunca toca periodos cerrados.', sensible: true },
    proponer_horario: { titulo: 'Proponer horario', desc: 'Propuesta de horario semanal con vista previa y conflictos. SIEMPRE requiere aprobación humana: el agente nunca guarda horarios. Solo dirección, secretaría y administración de red con permiso de edición en Horarios.', sensible: true,
      roles: ['director', 'secretaria', 'admin_red'], permiso: ['horarios', 'editar'] }
  };
  var MAX_RESTRICCION = 300, MAX_ASIGNACIONES = 2000;
  /** ¿Puede este rol solicitar/aprobar la tarea? Las tareas con `roles` exigen rol listado Y el permiso indicado (no dependen del modulo agente); el resto, agente.ver. */
  function puedeTarea(rol, tarea) {
    var T = TAREAS[tarea]; if (!T) return false;
    if (T.roles) return T.roles.indexOf(rol) !== -1 && EDU.permisos.puede(rol, T.permiso[0], T.permiso[1]);
    return EDU.permisos.puede(rol, 'agente', 'ver');
  }
  var AUTONOMIAS = {
    sugiere: { titulo: 'Solo sugiere', desc: 'El agente propone; usted decide qué usar. No se aplica ningún cambio automático.' },
    sugiere_y_aprueba: { titulo: 'Sugiere y espera aprobación', desc: 'Cada propuesta queda pendiente hasta que usted la apruebe o rechace.' },
    ejecuta_con_registro: { titulo: 'Ejecuta con registro', desc: 'Aplica borradores sin efecto sobre notas y lo registra. Las notas siempre requieren aprobación.' }
  };
  var ORDEN_AUT = ['sugiere', 'sugiere_y_aprueba', 'ejecuta_con_registro'];
  var TONOS = ['cercano', 'formal', 'neutro'];
  var NIVELES = ['Inicial', 'Primario', 'Secundario'];
  var CLAVES_PII = /^(nombre|nombres|apellido|apellidos|email|correo|telefono|celular|cedula|direccion|estudianteId|estudianteIds|tutorId|usuarioId|docenteId)$/i;

  /* ======================= Anonimizacion ======================= */
  function plano(s) { return String(s == null ? '' : s).split('').map(function (c) { return c.normalize('NFD').charAt(0); }).join('').toLowerCase(); }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function alias(i) { return 'E' + (i < 9 ? '0' : '') + (i + 1); }

  /** anonimizar(estudiantes) -> {mapa:{E01:id}, inverso:{id:'E01'}, aliasDe(id)}. El mapa NO se envia al proveedor. */
  function anonimizar(estudiantes) {
    var mapa = {}, inverso = {};
    estudiantes.forEach(function (e, i) { var a = alias(i); mapa[a] = e.id; inverso[e.id] = a; });
    return { mapa: mapa, inverso: inverso };
  }
  /** Reemplaza nombres de estudiantes (sin acentos/mayusculas), correos, telefonos y cedulas en texto libre. */
  function limpiarTexto(texto, estudiantes, inverso) {
    var t = String(texto == null ? '' : texto);
    t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]').replace(/\b\d{3}-?\d{7}-?\d\b/g, '[cédula]').replace(/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g, '[teléfono]');
    var reemplazos = [];
    (estudiantes || []).forEach(function (e) {
      var a = (inverso && inverso[e.id]) || 'Estudiante';
      ((e.nombres || '') + ' ' + (e.apellidos || '')).split(/\s+/).forEach(function (tk) { if (tk.length >= 4) reemplazos.push([plano(tk), a]); });
    });
    if (!reemplazos.length) return t;
    reemplazos.sort(function (x, y) { return y[0].length - x[0].length; });
    var f = plano(t), out = '', i = 0;
    while (i < t.length) {
      var hit = null;
      if (!/[a-z0-9]/.test(f.charAt(i - 1) || ' ')) {
        for (var k = 0; k < reemplazos.length; k++) {
          var w = reemplazos[k][0];
          if (f.substr(i, w.length) === w && !/[a-z0-9]/.test(f.charAt(i + w.length) || ' ')) { hit = reemplazos[k]; break; }
        }
      }
      if (hit) { out += hit[1]; i += hit[0].length; } else { out += t.charAt(i); i++; }
    }
    return out;
  }
  /** Rechaza contextos con claves que identifican personas. */
  function verificarContexto(o, ruta) {
    ruta = ruta || 'contexto';
    if (Array.isArray(o)) { o.forEach(function (x, i) { verificarContexto(x, ruta + '[' + i + ']'); }); return; }
    if (o && typeof o === 'object') Object.keys(o).forEach(function (k) {
      if (CLAVES_PII.test(k)) throw new Error('El contexto contiene un dato personal (' + ruta + '.' + k + ') y no se envía.');
      verificarContexto(o[k], ruta + '.' + k);
    });
  }

  /* ======================= Proveedores ======================= */
  function hash(s) { var h = 7; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
  function pick(arr, seed) { return arr[seed % arr.length]; }

  var simulado = {
    nombre: 'simulado', simulado: true,
    /** solicitar(tarea, contexto) -> Promise<propuesta>. Sin red: plantillas deterministas locales. */
    solicitar: function (tarea, ctx, opts) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try { resolve(generarSimulada(tarea, ctx || {}, opts || {})); } catch (e) { reject(e); }
        }, 350);
      });
    }
  };
  function base(tarea, tipo, resumen, ctx, opts, extra) {
    return Object.assign({ tarea: tarea, tipo: tipo, resumen: resumen, requiereAprobacion: true, simulado: true, proveedor: 'simulado', modelo: (opts && opts.modelo) || 'simulado-1',
      generadoEn: new Date().toISOString() }, extra);
  }
  function generarSimulada(tarea, c, opts) {
    if (tarea === 'proponer_horario') return generarHorarioSimulado(c, opts);
    var tema = c.tema || 'el tema de la unidad', asig = c.asignatura || 'la asignatura', grado = c.grado || 'el grado', s = hash(tarea + tema + asig);
    var formal = c.tono === 'formal';
    if (tarea === 'generar_plan') {
      var min = c.minutos || 45;
      return base(tarea, 'plan', 'Plan de clase de ' + asig + ' (' + grado + '): ' + tema, c, opts, { plan: {
        tema: tema, objetivos: ['Comprender los conceptos centrales de ' + tema, 'Aplicar lo aprendido en situaciones del contexto', 'Valorar el trabajo colaborativo y el respeto por las ideas de los demás'],
        competencias: ['Comunicativa', 'Pensamiento lógico, creativo y crítico', 'Resolución de problemas'],
        actividades: [{ fase: 'inicio', minutos: Math.round(min * 0.2), descripcion: 'Activación de saberes previos con preguntas sobre ' + tema },
          { fase: 'desarrollo', minutos: Math.round(min * 0.55), descripcion: 'Explicación breve y trabajo guiado en parejas con ejemplos de ' + tema },
          { fase: 'cierre', minutos: min - Math.round(min * 0.2) - Math.round(min * 0.55), descripcion: 'Puesta en común y síntesis de lo aprendido' }],
        recursos: 'Pizarra, libro de texto, hojas de trabajo', evaluacion: 'Lista de cotejo y observación directa', tarea: 'Resolver 5 ejercicios de práctica sobre ' + tema } });
    }
    if (tarea === 'proponer_actividades') {
      return base(tarea, 'actividades', '4 actividades propuestas sobre ' + tema, c, opts, { items: [
        { nombre: 'Taller en parejas: ' + tema, descripcion: 'Resolución guiada de problemas contextualizados.', puntosSugeridos: 10 },
        { nombre: 'Quiz corto de ' + tema, descripcion: '5 preguntas de selección y desarrollo breve.', puntosSugeridos: 10 },
        { nombre: 'Mapa conceptual de ' + tema, descripcion: 'Organizador gráfico individual con ejemplos propios.', puntosSugeridos: 15 },
        { nombre: pick(['Exposición breve', 'Proyecto corto', 'Portafolio'], s) + ' sobre ' + tema, descripcion: 'Producto final con rúbrica compartida.', puntosSugeridos: 20 }] });
    }
    if (tarea === 'crear_rubricas') {
      var niveles = function (a, b, c2, d) { return [{ nivel: 'Excelente', descriptor: a, puntos: 4 }, { nivel: 'Bueno', descriptor: b, puntos: 3 }, { nivel: 'En proceso', descriptor: c2, puntos: 2 }, { nivel: 'Inicial', descriptor: d, puntos: 1 }]; };
      return base(tarea, 'rubrica', 'Rúbrica de 3 criterios para ' + tema, c, opts, { criterios: [
        { criterio: 'Dominio de conceptos', niveles: niveles('Explica con precisión y ejemplos propios', 'Explica correctamente con apoyo mínimo', 'Explica parcialmente', 'Necesita acompañamiento constante') },
        { criterio: 'Aplicación en situaciones', niveles: niveles('Resuelve situaciones nuevas', 'Resuelve situaciones similares a las vistas', 'Resuelve con ayuda', 'No logra aplicar aún') },
        { criterio: 'Comunicación y presentación', niveles: niveles('Clara, ordenada y creativa', 'Clara y ordenada', 'Comprensible con lagunas', 'Confusa o incompleta') }] });
    }
    if (tarea === 'redactar_comunicado') {
      var aud = c.audiencia || 'tutores', asu = c.asunto || tema;
      return base(tarea, 'comunicado', 'Borrador de comunicado: ' + asu, c, opts, { asunto: asu, cuerpo: (formal ? 'Estimados ' : 'Hola, queridos ') + aud + ':\n\n' +
        'Les escribimos para informarles sobre ' + asu + '. ' + (c.detalle ? c.detalle + ' ' : '') + 'Agradecemos su colaboración y quedamos atentos a cualquier consulta en la dirección del centro.\n\n' +
        (formal ? 'Atentamente,' : 'Un saludo cordial,') + '\nLa dirección' });
    }
    if (tarea === 'resumir_rendimiento') {
      var r = c.rendimiento || {}, hall = [];
      if (r.promedioPct != null) hall.push('Promedio del grupo: ' + fmt.num(r.promedioPct, 1) + '% sobre 100.');
      if (r.aprobadosPct != null) hall.push(fmt.num(r.aprobadosPct, 0) + '% de los estudiantes con nota final aprueba.');
      if ((r.enRiesgo || []).length) hall.push((r.enRiesgo.length) + ' estudiante(s) en riesgo: ' + r.enRiesgo.map(function (x) { return x.ref; }).join(', ') + '.');
      if (!hall.length) hall.push('Aún no hay calificaciones suficientes para resumir.');
      return base(tarea, 'resumen', 'Resumen de rendimiento de ' + asig + ' (' + grado + ')', c, opts, { texto: 'Resumen agregado generado a partir de datos anonimizados.', hallazgos: hall,
        recomendaciones: ['Reforzar los contenidos con menor logro mediante práctica guiada.', 'Contactar a los tutores de los estudiantes en riesgo.', 'Programar una evaluación de recuperación breve.'] });
    }
    if (tarea === 'borrador_notas') {
      var act = c.actividad || {}, items = [], adv = ['Estimación preliminar basada en el promedio previo del estudiante: el docente debe revisarla antes de aprobar.'];
      (c.estudiantes || []).forEach(function (e) {
        if (e.promedioPct == null) { adv.push(e.ref + ': sin historial, no se propone nota.'); return; }
        var v = Math.max(0, Math.min(1, e.promedioPct / 100 + ((hash(e.ref + act.titulo) % 11) - 5) / 100));
        items.push({ ref: e.ref, puntos: Math.round(v * act.puntosMax * 2) / 2 });
      });
      return base(tarea, 'notas', 'Borrador de ' + items.length + ' nota(s) para «' + (act.titulo || 'actividad') + '»', c, opts, { actividadId: act.id, puntosMax: act.puntosMax, items: items, advertencias: adv });
    }
    throw new Error('Tarea desconocida: ' + tarea);
  }

  /** Proponer horario SIMULADO (local, determinista, sin red): reconstruye un ctx del motor a partir del contexto MINIMO (docentes = alias) y reutiliza
      proponerLocal con una heuristica distinta a la del boton automatico: (1) las asignaturas pesadas (>= 4 h semanales) se reparten en las primeras
      franjas; (2) se penalizan los huecos dentro del dia de cada seccion (se pega a los bloques ya puestos y se empieza en la primera franja);
      (3) desempate determinista por hash(cargaId) + dia. El texto libre NO se interpreta (solo un backend real lo haria). */
  function generarHorarioSimulado(c, opts) {
    var H = EDU.horarios; if (!H || !H.motor) throw new Error('El módulo de Horarios no está cargado.');
    var M = H.motor, secs = {}, alc = [];
    (c.cargas || []).forEach(function (x) { if (!secs[x.seccionId]) secs[x.seccionId] = { id: x.seccionId, nombre: x.seccionId, tanda: x.tanda }; if (x.enAlcance) alc.push(x.id); });
    var ctx = M.armar({ franjas: c.franjas || [], horarios: (c.fijos || []).map(function (e, i) { return { id: 'fx' + i, cargaId: e.cargaId, dia: e.dia, franjaId: e.franjaId, aula: '' }; }),
      disponibilidad: (c.noDisponible || []).map(function (x) { return { docenteId: x.docente, dia: x.dia, franjaId: x.franjaId, disponible: false }; }),
      cargas: (c.cargas || []).map(function (x) { return { id: x.id, seccionId: x.seccionId, asignaturaId: x.asignaturaId, docenteId: x.docente, horasSemana: x.horasSemana }; }),
      secciones: Object.keys(secs).map(function (k) { return secs[k]; }), cursos: [], asignaturas: [], docentes: [] });
    ctx.topeDefecto = (c.topes && c.topes.defecto) || ctx.topeDefecto; ctx.topes = (c.topes && c.topes.porDocente) || {};
    var posDe = {}, porTanda = {};
    ctx.franjas.forEach(function (f) { if (f.tipo === 'clase') (porTanda[f.tanda] = porTanda[f.tanda] || []).push(f); });
    Object.keys(porTanda).forEach(function (t) { porTanda[t].forEach(function (f, i) { posDe[f.id] = i; }); });
    function ajuste(carga, sl, aux) {
      var pesada = M.horasDe(carga) >= 4, sc = pesada ? sl.pos * 1.5 : -sl.pos * 0.1;
      var occ = aux.ocupadas.map(function (f) { return posDe[f.id]; }).filter(function (n) { return typeof n === 'number'; });
      if (!occ.length) sc += sl.pos; else sc += Math.max(0, Math.min.apply(null, occ.map(function (o) { return Math.abs(o - sl.pos); })) - 1) * 3;
      return sc + ((hash(carga.id) + sl.dia * 7) % 11) * 0.01;
    }
    var r = M.proponerLocal(ctx, { conservar: true, cargaIds: alc, ajuste: ajuste, maxNodos: 4000 });
    var notas = ['Propuesta simulada determinista (sin red): asignaturas de 4 o más horas semanales en las primeras franjas y días sin huecos.'];
    if (c.restriccionTexto) notas.push('La restricción de texto libre se registró, pero el proveedor simulado no la interpreta; un backend real sí podría aplicarla.');
    if (!r.completo) notas.push('No se pudieron colocar todas las horas con las restricciones actuales.');
    return base('proponer_horario', 'horario', 'Propuesta de horario (simulada): ' + r.asignaciones.length + ' bloque(s)', c, opts, { asignaciones: r.asignaciones, sinColocar: r.sinColocar, notas: notas });
  }

  var proveedores = { simulado: simulado };
  var proveedor = {
    nombre: 'despachador',
    /** solicitar(tarea, contexto[, {proveedor, modelo, tono}]) -> Promise<propuesta>. Elige el proveedor registrado (por defecto 'simulado'). */
    solicitar: function (tarea, contexto, opts) {
      var n = (opts && opts.proveedor) || 'simulado', p = proveedores[n];
      if (!p) return Promise.reject(new Error('El proveedor «' + n + '» no está registrado. Registre un adaptador con EDU.agente.registrarProveedor.'));
      return Promise.resolve(p.solicitar(tarea, contexto, opts));
    }
  };
  /** Adaptador para un backend real. NO envia credenciales: el servidor guarda la API key y autentica al usuario (cookie de sesion/proxy). */
  function crearProveedorHttp(o) {
    o = o || {};
    return {
      nombre: 'backend', simulado: false,
      solicitar: function (tarea, contexto, opts) {
        var f = o.fetch || (typeof fetch === 'function' ? fetch.bind(window) : null);
        if (!f) return Promise.reject(new Error('fetch no disponible'));
        return f(o.url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: 1, tarea: tarea, contexto: contexto, modelo: opts && opts.modelo, tono: opts && opts.tono }) })
          .then(function (r) { if (!r.ok) throw new Error('El servicio del agente respondió ' + r.status); return r.json(); });
      }
    };
  }
  function validarPropuesta(p) {
    if (!p || typeof p !== 'object' || typeof p.tipo !== 'string' || typeof p.resumen !== 'string') throw new Error('Respuesta del proveedor inválida (se espera {tipo, resumen, ...}).');
    var req = { plan: 'plan', actividades: 'items', rubrica: 'criterios', comunicado: 'cuerpo', resumen: 'hallazgos', notas: 'items', horario: 'asignaciones' }[p.tipo];
    if (!req) throw new Error('Tipo de propuesta desconocido: ' + p.tipo);
    if (p[req] == null) throw new Error('La propuesta no incluye «' + req + '».');
    if (p.tipo === 'horario' && !Array.isArray(p.asignaciones)) throw new Error('La propuesta de horario debe incluir «asignaciones» como lista.');
    return p;
  }
  function txt(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n || 200); }
  /** Esquema de la salida del proveedor para proponer_horario (simulado o backend): descarta lo que no cumple y recalcula lo no colocado.
      Valido: cargaId conocida y en alcance, dia entero 1-5, franjaId existente de tipo clase, aula texto (<=40), sin duplicados. El motor lo vuelve a validar (conflictos). */
  function normalizarHorario(p, c) {
    var cargas = {}, franjas = {}, ok = [], desc = [], vistos = {}, cnt = {}, fijosN = {};
    (c.cargas || []).forEach(function (x) { cargas[x.id] = x; });
    (c.franjas || []).forEach(function (f) { franjas[f.id] = f; });
    (c.fijos || []).forEach(function (e) { if (franjas[e.franjaId] && franjas[e.franjaId].tipo === 'clase') fijosN[e.cargaId] = (fijosN[e.cargaId] || 0) + 1; });
    function malo(a, motivo) { desc.push({ cargaId: txt(a && a.cargaId, 40), motivo: txt(motivo, 160) }); }
    var lista = p.asignaciones;
    lista.forEach(function (a, i) {
      if (i >= MAX_ASIGNACIONES) { malo(a, 'Excede el máximo de ' + MAX_ASIGNACIONES + ' asignaciones.'); return; }
      if (!a || typeof a !== 'object' || Array.isArray(a)) { malo(null, 'Entrada que no es un objeto.'); return; }
      if (typeof a.cargaId !== 'string' || !Object.prototype.hasOwnProperty.call(cargas, a.cargaId)) { malo(a, 'Carga desconocida «' + txt(a.cargaId, 40) + '».'); return; }
      if (!cargas[a.cargaId].enAlcance) { malo(a, 'Carga fuera del alcance solicitado.'); return; }
      if (typeof a.dia !== 'number' || !Number.isInteger(a.dia) || a.dia < 1 || a.dia > 5) { malo(a, 'Día no válido (debe ser 1 a 5).'); return; }
      if (typeof a.franjaId !== 'string' || !Object.prototype.hasOwnProperty.call(franjas, a.franjaId) || franjas[a.franjaId].tipo !== 'clase') { malo(a, 'Franja inexistente o que no es de clase.'); return; }
      var k = a.cargaId + '|' + a.dia + '|' + a.franjaId; if (vistos[k]) { malo(a, 'Asignación duplicada.'); return; } vistos[k] = 1;
      ok.push({ cargaId: a.cargaId, dia: a.dia, franjaId: a.franjaId, aula: typeof a.aula === 'string' ? txt(a.aula, 40) : '' }); cnt[a.cargaId] = (cnt[a.cargaId] || 0) + 1;
    });
    var sin = [], horasSin = 0;
    (c.cargas || []).forEach(function (x) { if (!x.enAlcance) return; var r = (+x.horasSemana || 0) - (fijosN[x.id] || 0) - (cnt[x.id] || 0); if (r > 0) { sin.push({ cargaId: x.id, faltan: r }); horasSin += r; } });
    var notas = (Array.isArray(p.notas) ? p.notas : []).filter(function (n) { return typeof n === 'string'; }).map(function (n) { return txt(n, 300); }).slice(0, 12);
    return Object.assign({}, p, { asignaciones: ok, descartadas: desc.slice(0, 50), nDescartadas: desc.length, sinColocar: sin, notas: notas, conservar: c.conservar !== false, seccionId: c.seccionId || null,
      resumen: ok.length + ' bloque(s) propuestos, ' + desc.length + ' descartado(s), ' + horasSin + ' hora(s) sin colocar' });
  }

  /* ======================= Datos y configuracion ======================= */
  function ses() { return EDU.estado.sesion(); }
  function hoyMas(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function configPorDefecto(centroId, docenteId) {
    return { centroId: centroId, docenteId: docenteId || null, activo: false, nombre: 'Asistente EduCentro', proveedor: 'simulado', modelo: 'simulado-1', autonomia: 'sugiere',
      tareas: ['generar_plan', 'proponer_actividades', 'crear_rubricas'], tono: 'cercano', nivel: 'Primario', instrucciones: '', limites: { maxSolicitudesDia: 50 }, consentimientoDatos: false };
  }
  async function leerConfigs() {
    var s = ses(), cid = EDU.estado.centroActivo();
    var lista = cid ? await EDU.repo.listar('agenteConfig', { centroId: cid }) : [];
    var centro = lista.filter(function (c) { return !c.docenteId; })[0] || null;
    var doc = s.rol === 'docente' ? (lista.filter(function (c) { return c.docenteId === s.refId; })[0] || null) : null;
    return { centro: centro, docente: doc, centroId: cid };
  }
  /** Efectiva = centro (techo) restringida por la config del docente (solo puede reducir). */
  function combinar(centro, doc) {
    var c = centro || configPorDefecto(null);
    var ef = Object.assign({}, c, { tareas: (c.tareas || []).slice(), limites: Object.assign({ maxSolicitudesDia: 50 }, c.limites) });
    if (doc) {
      ef.activo = !!(c.activo && doc.activo);
      ef.nombre = doc.nombre || c.nombre; ef.tono = doc.tono || c.tono; ef.nivel = doc.nivel || c.nivel; ef.instrucciones = [c.instrucciones, doc.instrucciones].filter(Boolean).join('\n');
      ef.autonomia = ORDEN_AUT[Math.min(ORDEN_AUT.indexOf(c.autonomia || 'sugiere'), ORDEN_AUT.indexOf(doc.autonomia || 'sugiere'))] || 'sugiere';
      ef.tareas = ef.tareas.filter(function (t) { return (doc.tareas || []).indexOf(t) !== -1; });
      if (doc.limites && doc.limites.maxSolicitudesDia) ef.limites.maxSolicitudesDia = Math.min(ef.limites.maxSolicitudesDia, doc.limites.maxSolicitudesDia);
    }
    return ef;
  }
  async function configEfectiva() { var c = await leerConfigs(); return combinar(c.centro, c.docente); }

  async function datos(cols) { return EDU.consultas.cargar(cols); }
  function etiquetaCarga(d, cg) {
    var sec = d.secciones.filter(function (x) { return x.id === cg.seccionId; })[0], cur = sec && d.cursos.filter(function (x) { return x.id === sec.cursoId; })[0];
    var as = d.asignaturas.filter(function (x) { return x.id === cg.asignaturaId; })[0];
    return (as ? as.nombre : cg.asignaturaId) + ' · ' + (cur ? cur.nombre : '') + ' ' + (sec ? sec.nombre : '');
  }

  /* ======================= Contexto minimizado ======================= */
  /** Contexto de proponer_horario: SOLO ids, horas y restricciones (lista blanca de campos); docentes como alias D01… (el mapa queda local) y texto libre
      saneado con limpiarTexto (nombres de estudiantes y docentes, correos, telefonos, cedulas), sin control y <= 300 caracteres. */
  async function contextoHorario(tarea, e, cfg) {
    var H = EDU.horarios; if (!H || !H.motor) throw new Error('El módulo de Horarios no está cargado.');
    var d = await datos(H.motor.COLS.concat(['estudiantes']));
    var o = { seccionId: e.seccionId || null, conservar: e.conservar !== false };
    if (o.seccionId && !d.secciones.some(function (x) { return x.id === o.seccionId; })) throw new Error('La sección elegida no existe.');
    var b = e.contextoHorario || H.contextoParaProponedor(H.motor.armar(d), o);
    if (!b || !Array.isArray(b.franjas) || !Array.isArray(b.cargas)) throw new Error('Contexto de horario inválido.');
    var alias = {}, mapa = {}, n = 0, inv = anonimizar(d.estudiantes).inverso, docs = d.docentes.slice().sort(function (x, y) { return String(x.id) < String(y.id) ? -1 : 1; });
    function dAlias(id) { if (!id) return null; if (!alias[id]) { n++; alias[id] = 'D' + (n < 10 ? '0' : '') + n; mapa[alias[id]] = id; } return alias[id]; }
    docs.forEach(function (x) { dAlias(x.id); });
    var personas = d.estudiantes.concat(docs.map(function (x) { return { id: x.id, nombres: x.nombres || x.nombre || '', apellidos: x.apellidos || '' }; }));
    Object.keys(alias).forEach(function (id) { inv[id] = alias[id]; });
    var limpio = function (t, max) { return limpiarTexto(txt(t, max), personas, inv).slice(0, max); };
    var texto = limpio(e.texto || '', MAX_RESTRICCION);
    var topes = {}; Object.keys((b.topes && b.topes.porDocente) || {}).forEach(function (id) { topes[dAlias(id)] = b.topes.porDocente[id]; });
    var ctx = { tarea: tarea, version: 1, tono: cfg.tono, nivel: cfg.nivel, instrucciones: limpio(cfg.instrucciones || '', 800), seccionId: o.seccionId, conservar: o.conservar,
      franjas: b.franjas.map(function (f) { return { id: f.id, tanda: f.tanda, inicio: f.inicio, fin: f.fin, tipo: f.tipo }; }),
      cargas: b.cargas.map(function (c) { return { id: c.id, seccionId: c.seccionId, asignaturaId: c.asignaturaId, docente: dAlias(c.docenteId), horasSemana: +c.horasSemana || 0, tanda: c.tanda, enAlcance: c.enAlcance !== false }; }),
      fijos: (b.fijos || []).map(function (f) { return { cargaId: f.cargaId, dia: f.dia, franjaId: f.franjaId }; }),
      noDisponible: (b.noDisponible || []).map(function (x) { return { docente: dAlias(x.docenteId), dia: x.dia, franjaId: x.franjaId }; }),
      topes: { defecto: b.topes ? b.topes.defecto : null, porDocente: topes }, restriccionTexto: texto };
    verificarContexto(ctx);
    var nAlc = ctx.cargas.filter(function (c) { return c.enAlcance; }).length;
    return { contexto: ctx, mapaLocal: mapa, textoLimpio: texto, carga: null,
      entradaResumen: ('Proponer horario · alcance: ' + (o.seccionId || 'todas las secciones') + ' · ' + nAlc + ' cargas, ' + ctx.fijos.length + ' bloques fijos, conservar: ' + (o.conservar ? 'sí' : 'no') + (texto ? ' · restricción: ' + texto : '')).slice(0, 400) };
  }
  async function construirContexto(tarea, e, cfg) {
    if (tarea === 'proponer_horario') return contextoHorario(tarea, e, cfg);
    var d = await datos(['cargas', 'secciones', 'cursos', 'asignaturas', 'estudiantes', 'matriculas', 'actividades', 'categorias', 'calificaciones', 'periodos', 'escalas']);
    var cg = e.cargaId ? d.cargas.filter(function (x) { return x.id === e.cargaId; })[0] : null;
    var sec = cg && d.secciones.filter(function (x) { return x.id === cg.seccionId; })[0], cur = sec && d.cursos.filter(function (x) { return x.id === sec.cursoId; })[0];
    var as = cg && d.asignaturas.filter(function (x) { return x.id === cg.asignaturaId; })[0];
    var ests = cg ? d.matriculas.filter(function (m) { return m.seccionId === cg.seccionId && m.estado === 'activa'; }).map(function (m) { return d.estudiantes.filter(function (x) { return x.id === m.estudianteId; })[0]; }).filter(Boolean) : d.estudiantes;
    var an = anonimizar(ests);
    var texto = limpiarTexto(e.texto || '', d.estudiantes, an.inverso);
    var ctx = { tarea: tarea, tono: cfg.tono, nivel: cfg.nivel, instrucciones: limpiarTexto(cfg.instrucciones || '', d.estudiantes, an.inverso) };
    if (cg) { ctx.asignatura = as ? as.nombre : ''; ctx.grado = cur ? cur.nombre : ''; ctx.nivelEducativo = cur ? cur.nivel : ''; }
    if (tarea === 'generar_plan' || tarea === 'proponer_actividades' || tarea === 'crear_rubricas') { ctx.tema = texto || 'tema de la unidad'; ctx.minutos = 45; }
    if (tarea === 'redactar_comunicado') { ctx.asunto = texto || 'información general'; ctx.audiencia = e.audiencia || 'tutores'; ctx.detalle = limpiarTexto(e.detalle || '', d.estudiantes, an.inverso); }
    if (tarea === 'resumir_rendimiento') {
      var filas = EDU.consultas.resumenNotas(d).filter(function (f) { return !cg || f.cargaId === cg.id; }).filter(function (f) { return f.final != null; });
      var med = filas.length ? filas.reduce(function (s, f) { return s + f.pct; }, 0) / filas.length : null;
      ctx.rendimiento = { n: filas.length, promedioPct: med, aprobadosPct: filas.length ? filas.filter(function (f) { return f.aprobado; }).length / filas.length * 100 : null,
        enRiesgo: filas.filter(function (f) { return !f.aprobado; }).map(function (f) { return { ref: an.inverso[f.estudianteId] || 'E??', pct: Math.round(f.pct) }; }) };
    }
    if (tarea === 'borrador_notas') {
      var act = d.actividades.filter(function (x) { return x.id === e.actividadId && cg && x.cargaId === cg.id; })[0];
      if (!act) throw new Error('Elija una actividad de la asignatura seleccionada.');
      var per = d.periodos.filter(function (p) { return p.id === act.periodoId; })[0];
      if (per && per.cerrado) throw new Error('El periodo «' + per.nombre + '» está cerrado: el agente no puede proponer notas para él.');
      var res = EDU.consultas.resumenNotas(d).filter(function (f) { return f.cargaId === cg.id; }), pctDe = {};
      res.forEach(function (f) { pctDe[f.estudianteId] = f.final != null ? f.pct : null; });
      var con = {}; d.calificaciones.forEach(function (c) { if (c.actividadId === act.id && c.puntos != null) con[c.estudianteId] = 1; });
      var faltan = ests.filter(function (x) { return !con[x.id]; });
      if (!faltan.length) throw new Error('Todos los estudiantes ya tienen nota en esa actividad.');
      ctx.actividad = { id: act.id, titulo: act.nombre, puntosMax: act.puntosMax };
      ctx.estudiantes = faltan.map(function (x) { return { ref: an.inverso[x.id], promedioPct: pctDe[x.id] == null ? null : Math.round(pctDe[x.id] * 10) / 10 }; });
    }
    verificarContexto(ctx);
    return { contexto: ctx, mapaLocal: an.mapa, textoLimpio: texto, carga: cg };
  }

  /* ======================= Orquestador ======================= */
  async function solicitar(tarea, entrada, opts) {
    opts = opts || {};
    var s = ses();
    if (!s) throw new Error('Sin permiso para usar el agente.');
    if (!TAREAS[tarea]) throw new Error('Tarea desconocida.');
    if (!puedeTarea(s.rol, tarea)) throw new Error(TAREAS[tarea].roles ? 'Su rol no puede solicitar «' + TAREAS[tarea].titulo + '» (requiere director, secretaría o administración de red con permiso de edición en Horarios).' : 'Sin permiso para usar el agente.');
    var cfg = await configEfectiva();
    if (!cfg.activo) throw new Error('El agente está desactivado para este centro/usuario.');
    if (cfg.tareas.indexOf(tarea) === -1) throw new Error('La tarea «' + TAREAS[tarea].titulo + '» no está habilitada.');
    if (cfg.proveedor === 'backend' && !cfg.consentimientoDatos) throw new Error('El centro no ha dado consentimiento para enviar datos a un proveedor externo.');
    var logs = await EDU.repo.listar('agenteLog'), hoy = fmt.hoy();
    var hoyN = logs.filter(function (l) { return l.usuarioId === s.usuarioId && String(l.fecha).slice(0, 10) === hoy; }).length;
    if (hoyN >= (cfg.limites.maxSolicitudesDia || 50)) throw new Error('Se alcanzó el límite diario de solicitudes (' + cfg.limites.maxSolicitudesDia + ').');
    if (s.rol === 'docente' && entrada.cargaId) {
      var cs = await EDU.repo.listar('cargas');
      var c1 = cs.filter(function (x) { return x.id === entrada.cargaId; })[0];
      if (!c1 || c1.docenteId !== s.refId) throw new Error('Solo puede consultar sobre sus propias asignaturas.');
    }
    var cx = await construirContexto(tarea, entrada, cfg);
    var prop = validarPropuesta(await proveedor.solicitar(tarea, cx.contexto, { proveedor: cfg.proveedor, modelo: cfg.modelo, tono: cfg.tono }));
    if (tarea === 'proponer_horario') { if (prop.tipo !== 'horario') throw new Error('El proveedor no devolvió una propuesta de horario.'); prop = normalizarHorario(prop, cx.contexto); }
    else if (prop.tipo === 'horario') throw new Error('El proveedor devolvió un tipo de propuesta que no corresponde a la tarea.');
    prop.requiereAprobacion = true;
    var log = await EDU.repo.guardar('agenteLog', { centroId: EDU.estado.centroActivo(), usuarioId: s.usuarioId, fecha: new Date().toISOString(), tarea: tarea,
      entrada: (cx.entradaResumen || (TAREAS[tarea].titulo + (cx.textoLimpio ? ': ' + cx.textoLimpio : ''))).slice(0, 400), salida: prop.resumen, aprobadoPor: null,
      estado: cfg.autonomia === 'sugiere' ? 'sugerida' : 'pendiente', autonomia: cfg.autonomia, proveedor: prop.proveedor || cfg.proveedor, modelo: prop.modelo || cfg.modelo,
      simulado: !!prop.simulado, cargaId: entrada.cargaId || null, fechaPlan: entrada.fecha || null, propuesta: prop, contexto: cx.contexto, mapaLocal: cx.mapaLocal, efecto: null,
      resumenHorario: tarea === 'proponer_horario' ? { asignaciones: prop.asignaciones.length, descartadas: prop.nDescartadas || 0, sinColocar: prop.sinColocar.reduce(function (t, x) { return t + x.faltan; }, 0) } : undefined });
    // ejecuta_con_registro: aplica solo lo que no toca notas (nunca borrador_notas).
    if (cfg.autonomia === 'ejecuta_con_registro' && !TAREAS[tarea].sensible && !opts.sinAuto && EDU.permisos.puede(s.rol, 'agente', 'aprobar')) {
      log = await aprobar(log.id, { auto: true });
    }
    return log;
  }

  async function aplicar(log, aplicarCambios) {
    var s = ses(), p = log.propuesta, efecto = null;
    if (!aplicarCambios) return null;
    if (p.tipo === 'plan') {
      var cg = (await EDU.repo.listar('cargas')).filter(function (x) { return x.id === log.cargaId; })[0];
      if (!cg) throw new Error('No se encontró la asignatura del plan.');
      var pl = p.plan, g = await EDU.repo.guardar('planes', { centroId: log.centroId, cargaId: cg.id, docenteId: cg.docenteId, fecha: log.fechaPlan || hoyMas(1), tema: String(pl.tema || ''),
        objetivos: pl.objetivos || [], competencias: pl.competencias || [], actividades: pl.actividades || [], recursos: pl.recursos || '', evaluacion: pl.evaluacion || '', tarea: pl.tarea || '',
        estado: 'borrador', origen: 'agente', agenteLogId: log.id });
      efecto = { coleccion: 'planes', id: g.id, descripcion: 'Borrador de plan creado en Planificación' };
    } else if (p.tipo === 'notas') {
      var d = await datos(['actividades', 'periodos', 'cargas', 'calificaciones']);
      var act = d.actividades.filter(function (x) { return x.id === p.actividadId; })[0];
      if (!act) throw new Error('La actividad ya no existe.');
      var per = d.periodos.filter(function (x) { return x.id === act.periodoId; })[0];
      if (per && per.cerrado) throw new Error('El periodo «' + per.nombre + '» está cerrado: no se modifican notas.');
      var cg2 = d.cargas.filter(function (x) { return x.id === act.cargaId; })[0];
      if (s.rol === 'docente' && (!cg2 || cg2.docenteId !== s.refId)) throw new Error('Solo el docente de la asignatura o la dirección pueden aprobar notas.');
      if (!EDU.permisos.puedeEscribirColeccion(s.rol, 'calificaciones')) throw new Error('Su rol no puede modificar calificaciones.');
      var n = 0;
      for (var i = 0; i < (p.items || []).length; i++) {
        var it = p.items[i], estId = (log.mapaLocal || {})[it.ref];
        if (!estId || typeof it.puntos !== 'number' || !isFinite(it.puntos)) continue;
        var cid = 'cal_' + act.id + '_' + estId, prev = d.calificaciones.filter(function (x) { return x.id === cid; })[0];
        if (prev && prev.puntos != null) continue; // nunca pisa una nota existente
        await EDU.repo.guardar('calificaciones', Object.assign({}, prev || {}, { id: cid, centroId: log.centroId, actividadId: act.id, estudianteId: estId,
          puntos: Math.max(0, Math.min(act.puntosMax, it.puntos)), comentario: 'Borrador del agente IA aprobado por ' + s.nombre }));
        n++;
      }
      efecto = { coleccion: 'calificaciones', cantidad: n, descripcion: n + ' nota(s) registradas (solo celdas vacías)' };
    } else if (p.tipo === 'horario') {
      if (!puedeTarea(s.rol, 'proponer_horario')) throw new Error('Su rol no puede aprobar propuestas de horario.');
      if (log.centroId !== EDU.estado.centroActivo()) throw new Error('La propuesta es de otro centro; seleccione ese centro.');
      if (p.conservar === false) throw new Error('Esta propuesta reemplaza bloques existentes: apruébela desde Horarios (vista previa).');
      var ev = await evaluarHorario(log);
      if (ev.conflictos.length) throw new Error('La propuesta tiene ' + ev.conflictos.length + ' conflicto(s) con el horario actual; no se guarda.');
      if (!ev.nuevas.length) throw new Error('No hay bloques que guardar.');
      var M = EDU.horarios.motor, regs = ev.nuevas.map(function (a) { var f = ev.ctx.franjaPor[a.franjaId];
        return { centroId: log.centroId, cargaId: a.cargaId, dia: a.dia, franjaId: a.franjaId, aula: a.aula || '', hora: f.inicio, duracion: M.mins(f.fin) - M.mins(f.inicio) }; });
      await EDU.repo.guardarMuchos('horarios', regs);
      efecto = { coleccion: 'horarios', cantidad: regs.length, descripcion: regs.length + ' bloque(s) añadidos al horario (aprobados por una persona)' };
      await EDU.repo.auditar('proponer_horario_aprobado', { centroId: log.centroId, coleccion: 'horarios', registros: regs.length, motivo: 'agenteLog ' + log.id });
    } else if (p.tipo === 'comunicado' && EDU.permisos.puedeEscribirColeccion(s.rol, 'comunicados')) {
      var cm = await EDU.repo.guardar('comunicados', { centroId: log.centroId, titulo: String(p.asunto || 'Comunicado'), cuerpo: String(p.cuerpo || ''), destinatarios: 'tutores',
        segmento: { tipo: 'centro', id: null }, fecha: fmt.hoy(), estado: 'borrador', autorId: s.usuarioId, lecturas: [], origen: 'agente', agenteLogId: log.id });
      efecto = { coleccion: 'comunicados', id: cm.id, descripcion: 'Borrador de comunicado creado (no publicado)' };
    }
    return efecto;
  }

  /** Re-valida con el motor una propuesta de horario contra los datos ACTUALES (solo anade a lo existente). -> {ctx, nuevas, conflictos[], sobrecarga[], lineas[], invalidas}. */
  async function evaluarHorario(log) {
    var H = EDU.horarios, M = H.motor, d = await datos(M.COLS), ctx = M.armar(d), p = log.propuesta || {};
    var nuevas = (p.asignaciones || []).filter(function (a) { return a && ctx.cargaPor[a.cargaId] && ctx.franjaPor[a.franjaId] && a.dia >= 1 && a.dia <= 5; });
    var v = M.validar(ctx, ctx.horarios.concat(nuevas.map(function (a, i) { return Object.assign({ _k: 'p' + i }, a); })));
    return { ctx: ctx, nuevas: nuevas, invalidas: (p.asignaciones || []).length - nuevas.length, conflictos: v.conflictos.map(function (c) { return c.msg; }),
      sobrecarga: v.avisos.filter(function (a) { return a.tipo === 'sobrecarga'; }).map(function (a) { return a.msg; }),
      lineas: nuevas.slice(0, 15).map(function (a) { var c = ctx.cargaPor[a.cargaId], f = ctx.franjaPor[a.franjaId]; return H.DIAS[a.dia - 1] + ' ' + f.inicio + '–' + f.fin + ' · ' + M.nombreAsig(ctx, c.asignaturaId) + ' · ' + M.etiquetaSeccion(ctx, c.seccionId); }) };
  }
  /** Lo llama la vista Horarios tras guardar la propuesta que una persona aprobo en la vista previa (el agente nunca guarda horarios). */
  async function confirmarHorario(logId, info) {
    var s = ses(); if (!s || !puedeTarea(s.rol, 'proponer_horario')) throw new Error('Su rol no puede aprobar propuestas de horario.');
    var log = await EDU.repo.obtener('agenteLog', logId);
    if (!log || log.tarea !== 'proponer_horario' || (log.estado !== 'pendiente' && log.estado !== 'sugerida')) throw new Error('La propuesta ya fue resuelta.');
    if (log.usuarioId !== s.usuarioId) throw new Error('Solo puede aprobar sus propias propuestas.');
    var n = (info && +info.cambios) || 0;
    log.estado = 'aprobada'; log.aprobadoPor = s.usuarioId; log.resueltoEn = new Date().toISOString();
    log.efecto = { coleccion: 'horarios', cantidad: n, descripcion: 'Propuesta aprobada y guardada desde Horarios (' + n + ' cambio(s))' };
    await EDU.repo.guardar('agenteLog', log);
    await EDU.repo.auditar('proponer_horario_aprobado', { centroId: log.centroId, coleccion: 'horarios', registros: n, motivo: 'agenteLog ' + log.id });
    return log;
  }

  /** aprobar(logId, {auto, aplicar:true}) -> log. aplicar:false = solo "uso el texto" (sin efectos en datos; permitido tambien en modo "solo sugiere"). */
  async function aprobar(logId, opts) {
    opts = opts || {};
    var s = ses();
    if (!s) throw new Error('Su rol no puede aprobar propuestas del agente.');
    var log = await EDU.repo.obtener('agenteLog', logId);
    if (!log) throw new Error('Propuesta no encontrada.');
    var esH = !!(log.propuesta && log.propuesta.tipo === 'horario');
    if (!(esH ? puedeTarea(s.rol, 'proponer_horario') : EDU.permisos.puede(s.rol, 'agente', 'aprobar'))) throw new Error(esH ? 'Su rol no puede aprobar propuestas de horario.' : 'Su rol no puede aprobar propuestas del agente.');
    if (esH && opts.auto) throw new Error('Las propuestas de horario siempre requieren aprobación humana.');
    if (log.estado !== 'pendiente' && log.estado !== 'sugerida') throw new Error('La propuesta ya fue resuelta.');
    if (s.rol === 'docente' && log.usuarioId !== s.usuarioId) throw new Error('Solo puede aprobar sus propias propuestas.');
    var aplicarCambios = opts.aplicar !== false;
    if (log.estado === 'sugerida' && aplicarCambios) throw new Error('En modo «solo sugiere» el agente no aplica cambios; use el texto manualmente.');
    if (log.propuesta.tipo === 'notas' && opts.auto) throw new Error('Las notas siempre requieren aprobación humana.');
    var efecto = await aplicar(log, aplicarCambios);
    log.estado = opts.auto ? 'ejecutada' : 'aprobada';
    log.aprobadoPor = opts.auto ? 'auto:ejecuta_con_registro' : s.usuarioId;
    log.resueltoEn = new Date().toISOString(); log.efecto = efecto;
    return EDU.repo.guardar('agenteLog', log);
  }
  async function rechazar(logId, motivo) {
    var s = ses();
    if (!s) throw new Error('Sin permiso.');
    var log = await EDU.repo.obtener('agenteLog', logId);
    if (!log || !(log.propuesta && log.propuesta.tipo === 'horario' ? puedeTarea(s.rol, 'proponer_horario') : EDU.permisos.puede(s.rol, 'agente', 'ver'))) throw new Error('Sin permiso.');
    if ((log.estado !== 'pendiente' && log.estado !== 'sugerida')) throw new Error('La propuesta ya fue resuelta.');
    if (s.rol === 'docente' && log.usuarioId !== s.usuarioId) throw new Error('Solo puede rechazar sus propias propuestas.');
    log.estado = 'rechazada'; log.aprobadoPor = null; log.rechazadoPor = s.usuarioId; log.motivo = motivo || ''; log.resueltoEn = new Date().toISOString();
    return EDU.repo.guardar('agenteLog', log);
  }
  /** Disponibilidad rapida para otros modulos: {ok, motivo}. */
  async function disponible(tarea) {
    var s = ses();
    if (!s) return { ok: false, motivo: 'Sin sesión.' };
    if (TAREAS[tarea] && TAREAS[tarea].roles) { if (!puedeTarea(s.rol, tarea)) return { ok: false, motivo: 'Su rol no puede usar «' + TAREAS[tarea].titulo + '» (requiere edición en Horarios).' }; }
    else if (!EDU.permisos.puede(s.rol, 'agente', 'aprobar')) return { ok: false, motivo: 'Su rol no puede aprobar propuestas del agente.' };
    try { var c = await configEfectiva(); if (!c.activo) return { ok: false, motivo: 'El agente IA está desactivado para este centro/usuario (actívelo en Agente IA › Configuración).' }; if (c.tareas.indexOf(tarea) === -1) return { ok: false, motivo: 'La tarea «' + (TAREAS[tarea] ? TAREAS[tarea].titulo : tarea) + '» no está habilitada en la configuración del agente.' };
      if (c.proveedor === 'backend' && !c.consentimientoDatos) return { ok: false, motivo: 'El centro no ha dado consentimiento para enviar datos a un proveedor externo.' }; return { ok: true, config: c }; } catch (e) { return { ok: false, motivo: e.message }; }
  }

  EDU.agente = { puedeTarea: puedeTarea, normalizarHorario: normalizarHorario, confirmarHorario: confirmarHorario, TAREAS: TAREAS, AUTONOMIAS: AUTONOMIAS, proveedor: proveedor, proveedores: proveedores, registrarProveedor: function (n, impl) { if (!impl || typeof impl.solicitar !== 'function') throw new Error('El proveedor debe implementar solicitar(tarea, contexto).'); proveedores[n] = impl; },
    crearProveedorHttp: crearProveedorHttp, anonimizar: anonimizar, limpiarTexto: limpiarTexto, configEfectiva: configEfectiva, solicitar: solicitar, aprobar: aprobar, rechazar: rechazar, disponible: disponible };

  /* ======================= Vista ======================= */
  function estadoBadge(st) { return ui.badge({ pendiente: 'Pendiente', sugerida: 'Sugerencia', aprobada: 'Aprobada', ejecutada: 'Ejecutada', rechazada: 'Rechazada' }[st] || st, { pendiente: 'warn', sugerida: 'info', aprobada: 'ok', ejecutada: 'ok', rechazada: 'bad' }[st] || 'neu'); }
  function lista(arr) { return '<ul>' + (arr || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }

  var evalHorario = {};
  function renderPropuesta(log, nombres) {
    var p = log.propuesta, h = '';
    if (p.tipo === 'plan') {
      var pl = p.plan;
      h += '<h4>' + esc(pl.tema) + '</h4><p><strong>Objetivos</strong></p>' + lista(pl.objetivos) + '<p><strong>Competencias:</strong> ' + esc((pl.competencias || []).join(', ')) + '</p><p><strong>Actividades</strong></p><ul>' +
        (pl.actividades || []).map(function (a) { return '<li><strong>' + esc(a.fase) + '</strong> (' + esc(a.minutos) + ' min): ' + esc(a.descripcion) + '</li>'; }).join('') + '</ul>' +
        '<p><strong>Recursos:</strong> ' + esc(pl.recursos) + '<br><strong>Evaluación:</strong> ' + esc(pl.evaluacion) + '<br><strong>Tarea:</strong> ' + esc(pl.tarea) + '</p>';
    } else if (p.tipo === 'actividades') {
      h += '<ul>' + (p.items || []).map(function (a) { return '<li><strong>' + esc(a.nombre) + '</strong> · ' + esc(a.puntosSugeridos) + ' pts<br>' + esc(a.descripcion) + '</li>'; }).join('') + '</ul>';
    } else if (p.tipo === 'rubrica') {
      (p.criterios || []).forEach(function (c) { h += '<p><strong>' + esc(c.criterio) + '</strong></p><ul>' + c.niveles.map(function (n) { return '<li>' + esc(n.nivel) + ' (' + esc(n.puntos) + '): ' + esc(n.descriptor) + '</li>'; }).join('') + '</ul>'; });
    } else if (p.tipo === 'comunicado') {
      h += '<p><strong>' + esc(p.asunto) + '</strong></p><p style="white-space:pre-wrap">' + esc(p.cuerpo) + '</p>';
    } else if (p.tipo === 'resumen') {
      h += '<p>' + esc(p.texto) + '</p><p><strong>Hallazgos</strong></p>' + lista(p.hallazgos) + '<p><strong>Recomendaciones</strong></p>' + lista(p.recomendaciones);
    } else if (p.tipo === 'horario') {
      var ev = evalHorario[log.id], desc = p.descartadas || [], sinH = (p.sinColocar || []).reduce(function (t, x) { return t + x.faltan; }, 0);
      h += '<p>' + esc((p.asignaciones || []).length) + ' bloque(s) propuestos · ' + esc(p.nDescartadas || 0) + ' descartado(s) · ' + esc(sinH) + ' hora(s) sin colocar.</p>';
      if (ev && ev.lineas.length) h += '<ul>' + ev.lineas.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + ((p.asignaciones || []).length > ev.lineas.length ? '<li>' + esc('…y ' + ((p.asignaciones || []).length - ev.lineas.length) + ' más') + '</li>' : '') + '</ul>';
      if (ev && ev.conflictos.length) h += '<div class="alert red"><div><strong>Conflictos con el horario actual (no se puede aprobar)</strong><ul>' + ev.conflictos.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
      if (ev && ev.sobrecarga.length) h += '<div class="alert"><div><strong>Avisos de sobrecarga</strong><ul>' + ev.sobrecarga.slice(0, 6).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
      if (desc.length) h += '<div class="alert red"><div><strong>Asignaciones descartadas</strong><ul>' + desc.slice(0, 6).map(function (x) { return '<li>' + esc(x.motivo) + '</li>'; }).join('') + '</ul></div></div>';
      if ((p.notas || []).length) h += '<p><strong>Notas</strong></p>' + lista(p.notas);
    } else if (p.tipo === 'notas') {
      h += '<div class="tw"><table class="t"><caption class="sr-only">Borrador de notas</caption><thead><tr><th scope="col">Estudiante</th><th scope="col" class="r">Nota propuesta (de ' + esc(p.puntosMax) + ')</th></tr></thead><tbody>' +
        (p.items || []).map(function (i) { var id = (log.mapaLocal || {})[i.ref]; return '<tr><td>' + esc((nombres && nombres[id]) || i.ref) + ' <small>(el agente solo vio «' + esc(i.ref) + '»)</small></td><td class="r">' + esc(i.puntos) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<ul>' + (p.advertencias || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>';
    }
    return h;
  }

  function tarjeta(log, nombres, puedeAprobar) {
    var pend = log.estado === 'pendiente', sug = log.estado === 'sugerida', sens = log.propuesta.tipo === 'notas', esH = log.propuesta.tipo === 'horario', evH = evalHorario[log.id];
    var h = '<article class="card ag-card" data-log="' + esc(log.id) + '" style="margin-top:14px" aria-labelledby="t-' + esc(log.id) + '"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between">' +
      '<h3 id="t-' + esc(log.id) + '" style="font-size:18px">' + esc(TAREAS[log.tarea] ? TAREAS[log.tarea].titulo : log.tarea) + '</h3><span>' + estadoBadge(log.estado) + (log.simulado ? ' ' + ui.badge('Simulado', 'neu') : '') + '</span></div>' +
      '<p class="note" style="margin-top:4px">' + esc(fmt.fechaHora(log.fecha)) + ' · ' + esc(log.salida) + '</p>' + renderPropuesta(log, nombres);
    if (sens) h += '<div class="alert"><div><strong>Cambia notas</strong><small>Requiere su aprobación; solo llena celdas vacías y nunca modifica periodos cerrados.</small></div></div>';
    if (esH) h += '<div class="alert"><div><strong>Cambia el horario del centro</strong><small>Requiere su aprobación y no se guarda sin ella; solo añade bloques y se re-valida contra el horario actual (también puede revisarla en Horarios).</small></div></div>';
    if (log.efecto && log.efecto.descripcion) h += '<div class="alert ok"><div><strong>Resultado</strong><small>' + esc(log.efecto.descripcion) + '</small></div></div>';
    if (pend && puedeAprobar) h += '<div class="form-actions"><button type="button" class="btn dng" data-ac="rechazar">Rechazar</button><button type="button" class="btn amb" data-ac="aprobar"' + (esH && evH && evH.conflictos.length ? ' disabled' : '') + '>' + (esH ? 'Aprobar y guardar' : 'Aprobar') + '</button></div>';
    else if (sug) h += '<div class="form-actions"><span class="note" style="margin-right:auto">Modo «solo sugiere»: copie lo que le sirva; no se aplican cambios.</span><button type="button" class="btn sec" data-ac="rechazar">Descartar</button></div>';
    else if (pend) h += '<p class="note">Su rol no puede aprobar propuestas.</p>';
    return h + '</article>';
  }

  async function tabConsola(panel, ctx) {
    var s = ses(), cfg = await configEfectiva(), puedeAprobar = EDU.permisos.puede(s.rol, 'agente', 'aprobar');
    var d = await datos(['cargas', 'secciones', 'cursos', 'asignaturas', 'actividades', 'periodos', 'estudiantes']);
    var secsOpc = d.secciones.map(function (x) { var cu = d.cursos.filter(function (c) { return c.id === x.cursoId; })[0]; return { id: x.id, texto: ((cu ? cu.nombre : '') + ' ' + x.nombre).trim() }; });
    var cargas = s.rol === 'docente' ? d.cargas.filter(function (c) { return c.docenteId === s.refId; }) : d.cargas;
    var tareas = Object.keys(TAREAS).filter(function (t) { return cfg.tareas.indexOf(t) !== -1 && puedeTarea(s.rol, t); });
    if (!cfg.activo || !tareas.length || !puedeAprobar) {
      panel.innerHTML = '<div class="card">' + ui.vacio({ titulo: !puedeAprobar ? 'Su rol no usa la consola del agente' : 'El agente está desactivado', texto: !puedeAprobar ? 'Puede revisar la configuración y el registro de actividad.' :
        (EDU.permisos.puede(s.rol, 'agente', 'editar') ? 'Actívelo y habilite tareas en la pestaña «Configuración».' : 'Pida a la dirección que lo active.') }) + '</div>';
      return;
    }
    var nombres = {}; d.estudiantes.forEach(function (e) { nombres[e.id] = fmt.nombreCompleto(e); });
    panel.innerHTML = '<div class="card"><h2 id="askT">Pídele al agente</h2><p class="note" style="margin-top:4px">Respuestas ' + (cfg.proveedor === 'backend' ? 'del proveedor configurado' : 'simuladas localmente, sin red') + '. Modo: <strong>' + esc(AUTONOMIAS[cfg.autonomia].titulo) + '</strong>. Los nombres de estudiantes se anonimizan antes de enviar.</p>' +
      '<form id="agForm" aria-labelledby="askT" novalidate><div class="fgrid" style="margin-top:12px">' +
      '<label class="fld">Tarea<select id="agTarea" name="tarea">' + tareas.map(function (t) { return '<option value="' + esc(t) + '">' + esc(TAREAS[t].titulo) + '</option>'; }).join('') + '</select><span class="help" id="agTareaAy"></span></label>' +
      '<label class="fld" id="wAlc" hidden>Alcance<select id="agAlc" name="alcance"><option value="">Todas las secciones</option>' + secsOpc.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.texto) + '</option>'; }).join('') + '</select><span class="help">Solo se añaden bloques a las horas faltantes; nada se guarda sin su aprobación.</span></label>' +
      '<label class="fld" id="wCarga">Asignatura y sección<select id="agCarga" name="carga">' + cargas.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(etiquetaCarga(d, c)) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld" id="wAct" hidden>Actividad<select id="agAct" name="actividad"></select><span class="help">Solo actividades de periodos abiertos.</span></label>' +
      '<label class="fld" id="wFecha">Fecha del plan<input type="date" id="agFecha" name="fecha" value="' + esc(hoyMas(1)) + '"></label>' +
      '<label class="fld full" id="wTexto"><span id="agTextoT">Tema o instrucción</span><textarea id="agTexto" name="texto" maxlength="500" placeholder="Ej.: Fracciones equivalentes"></textarea><span class="help">No escriba datos personales; se anonimizan antes de enviar.</span></label></div>' +
      '<div class="form-error" id="agErr" role="alert" hidden></div><div class="form-actions"><span id="agEstado" class="note" role="status" style="margin-right:auto"></span><button type="submit" class="btn amb" id="agEnviar">Enviar al agente</button></div></form></div>' +
      '<div id="agLista" aria-live="polite" aria-label="Propuestas del agente"></div>';
    var $ = function (id) { return panel.querySelector('#' + id); };
    function ajustar() {
      var t = $('agTarea').value, cid = $('agCarga').value;
      var esH = t === 'proponer_horario';
      $('agTareaAy').textContent = TAREAS[t].desc; $('wAct').hidden = t !== 'borrador_notas'; $('wFecha').hidden = t !== 'generar_plan'; $('wCarga').hidden = esH; $('wAlc').hidden = !esH;
      $('agTextoT').textContent = esH ? 'Restricción opcional (texto libre)' : 'Tema o instrucción'; $('agTexto').maxLength = esH ? MAX_RESTRICCION : 500; $('agTexto').placeholder = esH ? 'Ej.: no poner Matemática a última hora' : 'Ej.: Fracciones equivalentes';
      $('agAct').innerHTML = d.actividades.filter(function (a) { var p = d.periodos.filter(function (x) { return x.id === a.periodoId; })[0]; return a.cargaId === cid && p && !p.cerrado; })
        .map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(a.nombre) + ' (' + esc(a.puntosMax) + ' pts)</option>'; }).join('') || '<option value="">Sin actividades en periodos abiertos</option>';
    }
    $('agTarea').addEventListener('change', ajustar); $('agCarga').addEventListener('change', ajustar); ajustar();
    async function pintarLista() {
      var logs = await EDU.repo.listar('agenteLog', { orden: 'fecha', desc: true }), mine = logs.filter(function (l) { return l.usuarioId === s.usuarioId && l.propuesta; });
      var abiertas = mine.filter(function (l) { return l.estado === 'pendiente' || l.estado === 'sugerida'; }), cerradas = mine.filter(function (l) { return l.estado !== 'pendiente' && l.estado !== 'sugerida'; }).slice(0, 3);
      evalHorario = {};
      for (var q = 0; q < abiertas.length; q++) if (abiertas[q].propuesta.tipo === 'horario') { try { evalHorario[abiertas[q].id] = await evaluarHorario(abiertas[q]); } catch (e) { /* sin vista previa de conflictos */ } }
      var h = '<h2 style="margin-top:22px;font-size:20px">Propuestas pendientes (' + abiertas.length + ')</h2>' + (abiertas.length ? abiertas.map(function (l) { return tarjeta(l, nombres, puedeAprobar); }).join('') : '<p class="note">No hay propuestas pendientes.</p>');
      if (cerradas.length) h += '<h2 style="margin-top:22px;font-size:20px">Resueltas recientemente</h2>' + cerradas.map(function (l) { return tarjeta(l, nombres, puedeAprobar); }).join('');
      $('agLista').innerHTML = h;
    }
    $('agLista').addEventListener('click', async function (e) {
      var b = e.target.closest('button[data-ac]'); if (!b) return;
      var id = b.closest('[data-log]').dataset.log; b.disabled = true;
      try {
        if (b.dataset.ac === 'aprobar') { var l = await aprobar(id); ui.toast('Propuesta aprobada' + (l.efecto ? ': ' + l.efecto.descripcion : ''), 'ok'); }
        else { await rechazar(id); ui.toast('Propuesta rechazada; no se aplicó ningún cambio', 'info'); }
      } catch (err) { ui.toast(err.message, 'error'); }
      await pintarLista();
    });
    $('agForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = $('agErr'); err.hidden = true;
      var t = $('agTarea').value, texto = $('agTexto').value.trim();
      if (t === 'proponer_horario') {
        $('agEnviar').disabled = true; $('agEstado').textContent = 'Consultando al agente…';
        try { await solicitar(t, { seccionId: $('agAlc').value || null, conservar: true, texto: texto }); $('agEstado').textContent = 'Propuesta lista.'; $('agTexto').value = ''; }
        catch (er) { err.textContent = er.message; err.hidden = false; $('agEstado').textContent = ''; }
        $('agEnviar').disabled = false; await pintarLista(); return;
      }
      if (!$('agCarga').value) { err.textContent = 'No tiene asignaturas asignadas.'; err.hidden = false; return; }
      if (t !== 'borrador_notas' && t !== 'resumir_rendimiento' && !texto) { err.textContent = 'Escriba el tema o la instrucción.'; err.hidden = false; $('agTexto').setAttribute('aria-invalid', 'true'); $('agTexto').focus(); return; }
      $('agTexto').removeAttribute('aria-invalid');
      $('agEnviar').disabled = true; $('agEstado').textContent = 'Consultando al agente…';
      try {
        await solicitar(t, { cargaId: $('agCarga').value, texto: texto, actividadId: $('agAct').value, fecha: $('agFecha').value || null });
        $('agEstado').textContent = 'Propuesta lista.'; $('agTexto').value = '';
      } catch (er) { err.textContent = er.message; err.hidden = false; $('agEstado').textContent = ''; }
      $('agEnviar').disabled = false; await pintarLista();
    });
    await pintarLista();
  }

  function formConfig(pref, cfg, techo, esCentro) {
    var rolU = ses().rol;
    var tareasOk = (esCentro ? Object.keys(TAREAS) : Object.keys(TAREAS).filter(function (t) { return (techo.tareas || []).indexOf(t) !== -1; })).filter(function (t) { return !TAREAS[t].roles || puedeTarea(rolU, t); });
    var autOk = esCentro ? ORDEN_AUT : ORDEN_AUT.slice(0, ORDEN_AUT.indexOf(techo.autonomia || 'sugiere') + 1);
    var h = '<form id="' + pref + 'F" novalidate aria-label="' + (esCentro ? 'Configuración del centro' : 'Mi configuración') + '"><div class="fgrid">' +
      '<label class="opt full"><input type="checkbox" id="' + pref + 'activo"' + (cfg.activo ? ' checked' : '') + '> Activar agente</label>' +
      '<label class="fld">Nombre del agente<input id="' + pref + 'nombre" maxlength="40" value="' + esc(cfg.nombre) + '" aria-required="true" required></label>' +
      '<label class="fld">Proveedor<select id="' + pref + 'proveedor"' + (esCentro ? '' : ' disabled') + '><option value="simulado"' + (cfg.proveedor === 'simulado' ? ' selected' : '') + '>Simulado (local, sin red)</option><option value="backend"' + (cfg.proveedor === 'backend' ? ' selected' : '') + '>Backend real (servidor propio)</option></select></label>' +
      '<label class="fld">Modelo<input id="' + pref + 'modelo" maxlength="60" value="' + esc(cfg.modelo) + '"' + (esCentro ? '' : ' disabled') + '><span class="help">Etiqueta informativa; el servidor decide el modelo real.</span></label>' +
      '<label class="fld">Clave de API<input id="' + pref + 'key" type="password" value="" placeholder="No se guarda en el navegador" disabled aria-describedby="' + pref + 'keyH" autocomplete="off"><span class="help" id="' + pref + 'keyH">La clave vive solo en el servidor. Este campo es informativo y nunca se guarda ni se envía.</span></label>' +
      '<fieldset class="fld full" style="border:0;padding:0;margin:0"><legend style="font-weight:600;color:var(--ink)">Modo de autonomía</legend>' + autOk.map(function (a) {
        return '<label class="opt" style="margin-top:6px"><input type="radio" name="' + pref + 'aut" value="' + a + '"' + (cfg.autonomia === a ? ' checked' : '') + '><span>' + esc(AUTONOMIAS[a].titulo) + '<br><small class="note" style="margin:0">' + esc(AUTONOMIAS[a].desc) + '</small></span></label>'; }).join('') + '</fieldset>' +
      '<fieldset class="fld full" style="border:0;padding:0;margin:0"><legend style="font-weight:600;color:var(--ink)">Tareas habilitadas</legend>' + tareasOk.map(function (t) {
        return '<label class="opt" style="margin-top:6px"><input type="checkbox" name="' + pref + 'tarea" value="' + t + '"' + ((cfg.tareas || []).indexOf(t) !== -1 ? ' checked' : '') + '><span>' + esc(TAREAS[t].titulo) + (TAREAS[t].sensible ? ' ' + ui.badge('Siempre con aprobación', 'warn') : '') + '<br><small class="note" style="margin:0">' + esc(TAREAS[t].desc) + '</small></span></label>'; }).join('') + '</fieldset>' +
      '<label class="fld">Tono<select id="' + pref + 'tono">' + TONOS.map(function (t) { return '<option' + (cfg.tono === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld">Nivel<select id="' + pref + 'nivel">' + NIVELES.map(function (t) { return '<option' + (cfg.nivel === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld full">Instrucciones<textarea id="' + pref + 'instr" maxlength="800">' + esc(cfg.instrucciones || '') + '</textarea><span class="help">No incluya nombres de estudiantes ni datos personales.</span></label>' +
      '<label class="fld">Máximo de solicitudes por día<input type="number" id="' + pref + 'lim" min="1" max="500" value="' + esc((cfg.limites && cfg.limites.maxSolicitudesDia) || 50) + '"></label>' +
      (esCentro ? '<label class="opt"><input type="checkbox" id="' + pref + 'cons"' + (cfg.consentimientoDatos ? ' checked' : '') + '> El centro consiente enviar datos anonimizados a un proveedor externo</label>' : '') +
      '</div><div class="form-error" id="' + pref + 'err" role="alert" hidden></div><div class="form-actions"><button type="submit" class="btn amb">Guardar configuración</button></div></form>';
    return h;
  }
  function leerForm(root, pref, esCentro) {
    var g = function (id) { return root.querySelector('#' + pref + id); };
    var errores = [], nombre = g('nombre').value.trim(), lim = parseInt(g('lim').value, 10);
    if (!nombre) errores.push(['nombre', 'El nombre es obligatorio.']);
    if (!(lim >= 1 && lim <= 500)) errores.push(['lim', 'El límite debe estar entre 1 y 500.']);
    var aut = root.querySelector('input[name=' + pref + 'aut]:checked');
    var v = { activo: g('activo').checked, nombre: nombre, proveedor: g('proveedor').value, modelo: g('modelo').value.trim() || 'simulado-1', autonomia: aut ? aut.value : 'sugiere',
      tareas: Array.prototype.map.call(root.querySelectorAll('input[name=' + pref + 'tarea]:checked'), function (i) { return i.value; }), tono: g('tono').value, nivel: g('nivel').value,
      instrucciones: g('instr').value.trim(), limites: { maxSolicitudesDia: lim } };
    if (esCentro) { v.consentimientoDatos = g('cons').checked; if (v.proveedor === 'backend' && !v.consentimientoDatos) errores.push(['cons', 'Un proveedor externo exige el consentimiento de datos del centro.']); }
    return { v: v, errores: errores };
  }

  async function tabConfig(panel) {
    var s = ses(), c = await leerConfigs();
    if (!c.centroId) { panel.innerHTML = '<div class="card">' + ui.vacio({ titulo: 'Elija un centro', texto: 'Seleccione un centro en la barra superior para configurar su agente.' }) + '</div>'; return; }
    var centro = c.centro || configPorDefecto(c.centroId, null);
    var esDoc = s.rol === 'docente', editaCentro = !esDoc && EDU.permisos.puede(s.rol, 'agente', 'editar');
    var h = '<div class="alert"><div><strong>La clave de API nunca está en el navegador</strong><small>Se guarda y usa solo en el servidor (proxy backend). Aquí no se almacena ni se envía ninguna clave. Todo lo que hace el agente queda en el registro de actividad.</small></div></div>' +
      '<div class="card" style="margin-top:14px"><h2>Configuración del centro</h2>' + (editaCentro ? formConfig('c', centro, centro, true) : '<p class="note">Estado: ' + (centro.activo ? ui.badge('Activo', 'ok') : ui.badge('Desactivado', 'neu')) + ' · Modo: ' + esc(AUTONOMIAS[centro.autonomia || 'sugiere'].titulo) +
        ' · Tareas: ' + esc((centro.tareas || []).filter(function (t) { return puedeTarea(s.rol, t); }).map(function (t) { return TAREAS[t] ? TAREAS[t].titulo : t; }).join(', ') || '—') + '. Solo la dirección puede modificarla.</p>') + '</div>';
    if (esDoc) {
      var doc = c.docente || Object.assign(configPorDefecto(c.centroId, s.refId), { activo: true, autonomia: centro.autonomia || 'sugiere', tareas: (centro.tareas || []).slice(), nivel: centro.nivel, tono: centro.tono, proveedor: centro.proveedor, modelo: centro.modelo });
      h += '<div class="card" style="margin-top:14px"><h2>Mi configuración</h2><p class="note">Solo puede restringir lo que el centro permite.</p>' + formConfig('d', doc, centro, false) + '</div>';
    }
    panel.innerHTML = h;
    async function guardar(pref, esCentro, base) {
      var r = leerForm(panel, pref, esCentro), er = panel.querySelector('#' + pref + 'err');
      Array.prototype.forEach.call(panel.querySelectorAll('#' + pref + 'F [aria-invalid]'), function (n) { n.removeAttribute('aria-invalid'); });
      if (r.errores.length) { er.textContent = r.errores.map(function (x) { return x[1]; }).join(' '); er.hidden = false; var f = panel.querySelector('#' + pref + r.errores[0][0]); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); } return; }
      er.hidden = true;
      var reg = Object.assign({}, base, r.v, { centroId: c.centroId, docenteId: esCentro ? null : s.refId });
      if (!esCentro) { reg.proveedor = centro.proveedor; reg.modelo = centro.modelo; }
      try { await EDU.repo.guardar('agenteConfig', reg); ui.toast('Configuración guardada', 'ok'); EDU.router.recargar(); } catch (e) { er.textContent = e.message; er.hidden = false; }
    }
    var fc = panel.querySelector('#cF'), fd = panel.querySelector('#dF');
    if (fc) fc.addEventListener('submit', function (e) { e.preventDefault(); guardar('c', true, centro); });
    if (fd) fd.addEventListener('submit', function (e) { e.preventDefault(); guardar('d', false, c.docente || { }); });
  }

  async function tabRegistro(panel) {
    var s = ses(), d = await datos(['usuarios']), logs = await EDU.repo.listar('agenteLog', { orden: 'fecha', desc: true });
    if (s.rol === 'docente') logs = logs.filter(function (l) { return l.usuarioId === s.usuarioId; });
    var un = {}; d.usuarios.forEach(function (u) { un[u.id] = u.nombre; });
    var t = ui.tabla({ caption: 'Registro de actividad del agente', etiqueta: 'Registro del agente', filas: logs, ordenInicial: 'fecha', desc: true, porPagina: 10,
      columnas: [{ clave: 'fecha', titulo: 'Cuándo', valor: function (l) { return l.fecha; }, formato: function (v) { return fmt.fechaHora(v); } },
        { clave: 'quien', titulo: 'Quién', valor: function (l) { return un[l.usuarioId] || l.usuarioId; } },
        { clave: 'tarea', titulo: 'Tarea', valor: function (l) { return TAREAS[l.tarea] ? TAREAS[l.tarea].titulo : l.tarea; } },
        { clave: 'entrada', titulo: 'Entrada' }, { clave: 'salida', titulo: 'Salida' },
        { clave: 'estado', titulo: 'Estado', valor: function (l) { return l.estado || 'aprobada'; }, render: function (l) { return estadoBadge(l.estado || 'aprobada'); } },
        { clave: 'aprobadoPor', titulo: 'Aprobado por', valor: function (l) { return l.aprobadoPor ? (un[l.aprobadoPor] || l.aprobadoPor) : ''; } }],
      acciones: [{ texto: 'Detalle', alClic: function (l) {
        ui.modal({ titulo: 'Detalle de la solicitud', tamano: 'lg', contenido: '<p><strong>Proveedor:</strong> ' + esc(l.proveedor || '—') + ' · ' + esc(l.modelo || '') + ' ' + (l.simulado ? '(simulado)' : '') + '</p>' +
          '<p><strong>Contexto enviado (anonimizado):</strong></p><pre style="white-space:pre-wrap;font-size:12px;background:#f5f3ee;padding:10px;border-radius:8px;overflow:auto">' + esc(l.contexto ? JSON.stringify(l.contexto, null, 2) : 'No registrado') + '</pre>' +
          (l.resumenHorario ? '<p><strong>Horario:</strong> ' + esc(l.resumenHorario.asignaciones) + ' asignaciones propuestas · ' + esc(l.resumenHorario.descartadas) + ' descartadas · ' + esc(l.resumenHorario.sinColocar) + ' horas sin colocar</p>' : '') + '<p><strong>Resultado:</strong> ' + esc(l.efecto ? l.efecto.descripcion : 'Sin cambios en datos') + '</p>', botones: [{ texto: 'Cerrar', tipo: 'amb', valor: true }] });
      } }], vacio: { titulo: 'Sin actividad', texto: 'Cuando use el agente, cada solicitud quedará registrada aquí.' } });
    panel.innerHTML = '<div class="card"><h2>Registro de actividad</h2><p class="note" style="margin-top:4px">Quién, cuándo, tarea, entrada, salida y quién aprobó.</p></div>';
    panel.firstChild.appendChild(t.el);
  }

  EDU.router.register('agente', {
    titulo: 'Agente IA',
    render: async function (cont) {
      var s = ses(), cid = EDU.estado.centroActivo();
      cont.innerHTML = EDU.ui.cabecera({ eyebrow: 'Asistente', titulo: 'Agente IA', descripcion: 'Configure el asistente y revise sus propuestas. Nada que cambie notas se aplica sin su aprobación.' }).toString() + '<div id="agTabs"></div>';
      var puedeAp = EDU.permisos.puede(s.rol, 'agente', 'aprobar');
      var tabs = [];
      if (puedeAp) tabs.push({ id: 'consola', titulo: 'Pídele al agente', render: function (p) { return tabConsola(p); } });
      tabs.push({ id: 'config', titulo: 'Configuración', render: tabConfig }, { id: 'registro', titulo: 'Registro de actividad', render: tabRegistro });
      if (!cid && s.rol === 'admin_red') tabs = [{ id: 'config', titulo: 'Configuración', render: tabConfig }];
      var t = ui.tabs({ tabs: tabs, etiqueta: 'Agente IA', siempre: true });
      cont.querySelector('#agTabs').appendChild(t.el);
    }
  });
})();
