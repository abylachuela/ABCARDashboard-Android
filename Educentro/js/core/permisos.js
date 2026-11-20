/* EDU.permisos: matriz rol -> modulos/acciones, escritura por coleccion y alcance (centro, carga docente, hijos).
   NOTA: control del lado cliente (demo). En produccion debe repetirse en el backend. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});

  var ROLES = { admin_red: 'Administrador de red', director: 'Director/a', docente: 'Docente', secretaria: 'Secretaría', tutor: 'Tutor/a', estudiante: 'Estudiante' };

  /** Menu lateral (orden). `ruta` = modulo = primer segmento del hash. */
  var NAV = [
    { ruta: 'dashboard', titulo: 'Panel', icono: 'dashboard' },
    { ruta: 'centros', titulo: 'Centros educativos', icono: 'centros' },
    { ruta: 'config', titulo: 'Configuración', icono: 'config' },
    { ruta: 'curriculo', titulo: 'Currículo', icono: 'curriculo' },
    { ruta: 'personas', titulo: 'Personas', icono: 'personas' },
    { ruta: 'matricula', titulo: 'Matrícula', icono: 'matricula' },
    { ruta: 'cursos', titulo: 'Cursos y talleres', icono: 'matricula' },
    { ruta: 'horarios', titulo: 'Horarios', icono: 'planificacion' },
    { ruta: 'aula', titulo: 'Aula virtual', icono: 'curriculo' },
    { ruta: 'libro-notas', titulo: 'Calificaciones', icono: 'notas' },
    { ruta: 'planificacion', titulo: 'Planificación', icono: 'planificacion' },
    { ruta: 'secuencias', titulo: 'Secuencias didácticas', icono: 'curriculo' },
    { ruta: 'agente', titulo: 'Agente IA', icono: 'agente' },
    { ruta: 'asistencia', titulo: 'Asistencia', icono: 'asistencia' },
    { ruta: 'boletin', titulo: 'Boletín', icono: 'boletin' },
    { ruta: 'comunicados', titulo: 'Comunicados', icono: 'comunicados' },
    { ruta: 'reportes', titulo: 'Reportes', icono: 'reportes' },
    { ruta: 'importar-planilla', titulo: 'Importar planilla', icono: 'respaldo' },
    { ruta: 'respaldo', titulo: 'Respaldo', icono: 'respaldo' }
  ];

  var V = ['ver'], CRUD = ['ver', 'crear', 'editar', 'borrar'];
  /** MATRIZ[rol][modulo] = acciones. Acciones: ver crear editar borrar exportar importar imprimir cerrar aprobar */
  var MATRIZ = {
    admin_red: { dashboard: V, cursos: V, horarios: CRUD, aula: V, centros: CRUD, config: V, curriculo: CRUD, personas: CRUD, boletin: ['ver', 'imprimir'], reportes: ['ver', 'exportar'],
      agente: ['ver', 'editar'], comunicados: CRUD, respaldo: ['ver', 'exportar', 'importar'], 'importar-planilla': ['ver', 'exportar', 'importar'] },
    director: { dashboard: V, cursos: CRUD, horarios: CRUD, aula: V, config: CRUD.concat(['cerrar']), curriculo: CRUD, personas: CRUD, matricula: CRUD, 'libro-notas': ['ver', 'editar', 'cerrar'], planificacion: ['ver', 'editar'], secuencias: ['ver', 'editar'],
      agente: ['ver', 'editar', 'aprobar'], asistencia: V, boletin: ['ver', 'imprimir'], comunicados: CRUD, reportes: ['ver', 'exportar'], respaldo: ['ver', 'exportar', 'importar'], 'importar-planilla': ['ver', 'exportar', 'importar'] },
    docente: { dashboard: V, cursos: ['ver', 'editar'], horarios: V, aula: CRUD, curriculo: V, personas: V, matricula: V, 'libro-notas': ['ver', 'crear', 'editar'], planificacion: CRUD, secuencias: CRUD, agente: ['ver', 'editar', 'aprobar'],
      asistencia: ['ver', 'crear', 'editar'], comunicados: V },
    secretaria: { dashboard: V, cursos: CRUD, horarios: CRUD, aula: V, curriculo: V, personas: ['ver', 'crear', 'editar'], matricula: CRUD, 'libro-notas': V, planificacion: V, secuencias: V, asistencia: ['ver', 'crear', 'editar'],
      boletin: ['ver', 'imprimir'], comunicados: ['ver', 'crear', 'editar'], 'importar-planilla': ['ver', 'exportar', 'importar'] },
    tutor: { dashboard: V, cursos: V, horarios: V, aula: V, curriculo: V, personas: V, asistencia: V, boletin: ['ver', 'imprimir'], comunicados: V },
    estudiante: { dashboard: V, cursos: V, horarios: V, aula: ['ver', 'crear'], curriculo: V, personas: V, asistencia: V, boletin: ['ver', 'imprimir'], comunicados: V }
  };

  /** Escritura por coleccion (guardia del repositorio). */
  var TODAS = ['usuarios', 'anios', 'periodos', 'cursos', 'secciones', 'asignaturas', 'cargas', 'docentes', 'estudiantes', 'tutores', 'matriculas', 'escalas', 'categorias',
    'actividades', 'calificaciones', 'notasCompetencia', 'asistencia', 'comunicados', 'planes', 'horarios', 'agenteConfig', 'agenteLog', 'curriculoVersiones', 'curriculoContenidos', 'secuencias',
    'franjas', 'disponibilidad', 'cursosExtra', 'inscripciones', 'aulaContenidos', 'tareas', 'entregas', 'cuestionarios', 'intentos', 'foros', 'foroMensajes', 'anuncios'];
  var ESCRIBE = {
    admin_red: TODAS.concat(['centros']),
    director: TODAS.filter(function (c) { return c !== 'calificaciones'; }).concat(['calificaciones']),
    docente: ['aulaContenidos', 'tareas', 'entregas', 'cuestionarios', 'intentos', 'foros', 'foroMensajes', 'anuncios', 'inscripciones', 'calificaciones', 'notasCompetencia', 'actividades', 'categorias', 'asistencia', 'planes', 'horarios', 'secuencias', 'agenteConfig', 'agenteLog'],
    secretaria: ['notasCompetencia', 'franjas', 'horarios', 'disponibilidad', 'cursosExtra', 'inscripciones', 'estudiantes', 'tutores', 'matriculas', 'comunicados', 'asistencia', 'agenteLog'], // agenteLog: solo para registrar la tarea proponer_horario del agente
    tutor: [], estudiante: ['entregas', 'intentos', 'foroMensajes']
  };

  function ids(lista) { var s = new Set(); (lista || []).forEach(function (x) { s.add(x.id || x); }); return s; }

  EDU.permisos = {
    ROLES: ROLES, NAV: NAV, MATRIZ: MATRIZ,
    etiquetaRol: function (r) { return ROLES[r] || r; },
    puedeModulo: function (rol, modulo) { return !!(MATRIZ[rol] && MATRIZ[rol][modulo]); },
    puede: function (rol, modulo, accion) {
      var a = MATRIZ[rol] && MATRIZ[rol][modulo];
      return !!a && a.indexOf(accion || 'ver') !== -1;
    },
    /** Entradas de NAV visibles para el rol. */
    modulosDe: function (rol) { return NAV.filter(function (n) { return EDU.permisos.puedeModulo(rol, n.ruta); }); },
    rolesDeModulo: function (modulo) { return Object.keys(MATRIZ).filter(function (r) { return !!MATRIZ[r][modulo]; }); },
    puedeEscribirColeccion: function (rol, col) { return (ESCRIBE[rol] || []).indexOf(col) !== -1; },
    /** Un usuario puede operar sobre un centro? admin_red: cualquiera; resto: solo el suyo. */
    centroPermitido: function (sesion, centroId) {
      if (!sesion) return false;
      return sesion.rol === 'admin_red' || sesion.centroUsuario === centroId;
    },
    /**
     * alcance(sesion, datos) con datos {cargas, matriculas, tutores, secciones?}. Devuelve
     * {cargaIds:Set|null, seccionIds:Set|null, estudianteIds:Set|null}; null = sin restriccion dentro del centro.
     * docente: sus cargas/secciones/estudiantes. tutor: sus hijos. estudiante: el mismo.
     */
    alcance: function (sesion, datos) {
      var al = { cargaIds: null, seccionIds: null, estudianteIds: null };
      if (!sesion) return { cargaIds: new Set(), seccionIds: new Set(), estudianteIds: new Set() };
      datos = datos || {};
      var cargas = datos.cargas || [], mats = (datos.matriculas || []).filter(function (m) { return m.estado === 'activa'; });
      if (sesion.rol === 'docente') {
        var mias = cargas.filter(function (c) { return c.docenteId === sesion.refId; });
        al.cargaIds = ids(mias);
        al.seccionIds = new Set(mias.map(function (c) { return c.seccionId; }));
        al.estudianteIds = new Set(mats.filter(function (m) { return al.seccionIds.has(m.seccionId); }).map(function (m) { return m.estudianteId; }));
      } else if (sesion.rol === 'tutor' || sesion.rol === 'estudiante') {
        var est;
        if (sesion.rol === 'estudiante') est = [sesion.refId];
        else { var t = (datos.tutores || []).filter(function (x) { return x.id === sesion.refId; })[0]; est = t ? t.estudianteIds || [] : []; }
        al.estudianteIds = new Set(est);
        al.seccionIds = new Set(mats.filter(function (m) { return al.estudianteIds.has(m.estudianteId); }).map(function (m) { return m.seccionId; }));
        al.cargaIds = ids(cargas.filter(function (c) { return al.seccionIds.has(c.seccionId); }));
      }
      return al;
    },
    /** filtrar(alcance, 'cargas'|'secciones'|'estudiantes', lista) filtra por id. */
    filtrar: function (al, tipo, lista) {
      var s = tipo === 'cargas' ? al.cargaIds : tipo === 'secciones' ? al.seccionIds : al.estudianteIds;
      return s ? lista.filter(function (x) { return s.has(x.id); }) : lista;
    },
    /** Filtra registros que tienen estudianteId (calificaciones, asistencia, matriculas...). */
    filtrarPorEstudiante: function (al, lista) { return al.estudianteIds ? lista.filter(function (x) { return al.estudianteIds.has(x.estudianteId); }) : lista; },
    /** Filtra registros que tienen cargaId (actividades, categorias, planes...). */
    filtrarPorCarga: function (al, lista) { return al.cargaIds ? lista.filter(function (x) { return al.cargaIds.has(x.cargaId); }) : lista; }
  };
})();
