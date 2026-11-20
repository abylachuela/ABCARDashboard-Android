// Reglas de INTEGRIDAD de la capa genérica (Fase 3A). Se ejecutan en el servidor, después de autorizar y antes de escribir,
// para toda escritura que llegue por /c/:col (y por los lotes): el cliente que use PUT/POST genérico no puede saltárselas.
//   · campos protegidos (estado de matrículas/inscripciones/cursos/personas, autoría, turno…): solo cambian por sus endpoints;
//   · validadores de datos (cédula, capacidad, pesos, escalas, fechas…) y de referencias (mismo centro);
//   · dependencias de borrado (409 `tiene_dependencias`) y cascadas transaccionales;
//   · propiedad y estados (planes impartidos, comunicados, asistencia).
// Las unicidades de negocio las impone PostgreSQL (migración 0010) y se traducen a 409 en errores.ts.
import { ErrorHttp } from '../errores.js';
import { calculo } from '../domain/calculo-shim.js';
import type { Registro } from '../domain/autorizacion.js';
import type { MetaColeccion } from '../domain/colecciones.js';
import { curriculoCompartido } from '../domain/curriculo-shim.js';
import type { Peticion } from './generico.js';
import { validarFranjaGenerica, prepararBorradoFranja, validarHorarioGenerico } from './negocio-horarios.js';
import { validarMatriculas } from './negocio-matriculas.js';
import {
  EPS, contar, esFecha, diaSemana, existeEnCentro, hoyServidor, igual, invalido, protegido, siguienteSecuencia, str,
} from './util-negocio.js';

export interface EntradaInt {
  p: Peticion;
  meta: MetaColeccion;
  accion: 'crear' | 'editar' | 'borrar';
  centro: string;
  id: string;
  antes: Registro | null;
  /** Campos nuevos (sin id/centroId). MUTABLE. null al borrar. */
  nuevo: Registro | null;
}

const ROLES_DIRECCION = ['director', 'admin_red'];
const COLECCIONES_INTEGRIDAD = new Set([
  'estudiantes', 'docentes', 'tutores', 'matriculas', 'inscripciones', 'cursosExtra', 'periodos', 'secciones', 'cursos', 'asignaturas', 'cargas', 'anios',
  'escalas', 'asistencia', 'comunicados', 'planes', 'secuencias', 'horarios', 'franjas', 'curriculoVersiones', 'curriculoContenidos',
]);
export const tieneIntegridad = (nombre: string): boolean => COLECCIONES_INTEGRIDAD.has(nombre);

const esNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const esEntero = (x: unknown): x is number => esNum(x) && Number.isInteger(x);
const conflicto = (codigo: string, mensaje: string, extra?: Record<string, unknown>): ErrorHttp => new ErrorHttp(409, codigo, mensaje, undefined, extra);

/** Campo cuyo valor solo lo fija el servidor: al editar, si el cliente manda otro valor → 422; si no, se conserva el actual. */
function fijar(e: EntradaInt, campos: string[], mensaje: string): void {
  const n = e.nuevo as Registro;
  for (const c of campos) {
    if (e.accion === 'editar') {
      const antes = e.antes?.[c];
      if (n[c] !== undefined && !igual(n[c], antes)) throw protegido(c, mensaje);
      if (antes === undefined) delete n[c];
      else n[c] = antes;
    }
  }
}

async function dependencias(e: EntradaInt, lista: [tabla: string, expr: string, etiqueta: string][]): Promise<void> {
  for (const [tabla, expr, etiqueta] of lista) {
    const n = await contar(e.p, tabla, expr, e.id);
    if (n) throw conflicto('tiene_dependencias', `No se puede eliminar: tiene ${n} ${etiqueta} asociados.`, { dependencias: { [tabla]: n } });
  }
}

// ----------------------------------------------------------------------------------------------------------- personas
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const DOC = /^\d{3}-?\d{7}-?\d$/;

async function reglaPersona(e: EntradaInt): Promise<void> {
  const col = e.meta.nombre;
  if (e.accion === 'borrar') {
    if (col === 'estudiantes') await dependencias(e, [['matriculas', 'estudiante_id', 'matrículas']]);
    if (col === 'docentes') await dependencias(e, [['cargas', 'docente_id', 'asignaciones docentes']]);
    return;
  }
  const n = e.nuevo as Registro;
  // estado y baja: solo POST /{col}/:id/baja y /reactivar
  if (e.accion === 'crear') {
    if (n.estado !== undefined && n.estado !== 'activo') throw protegido('estado', 'La baja se registra con «dar de baja» (POST /…/baja); una persona nueva siempre queda activa.');
    delete n.fechaBaja;
    delete n.motivoBaja;
    n.estado = 'activo';
  } else {
    if (e.antes && e.antes.estado === undefined && n.estado === 'activo') delete n.estado; // fichas antiguas sin campo: «activo» implícito
    fijar(e, ['estado', 'fechaBaja', 'motivoBaja'], 'El estado y la fecha de baja solo cambian con «dar de baja» y «reactivar».');
  }
  // documento (cédula): 000-0000000-0, único por colección y centro (índice de la migración 0010)
  if (n.documento === '' || n.documento === null) delete n.documento;
  if (n.documento !== undefined) {
    if (typeof n.documento !== 'string' || !DOC.test(n.documento.trim())) throw invalido('El documento debe tener el formato de cédula 000-0000000-0 (11 dígitos).', 'documento', 'documento_invalido');
    const d = n.documento.replace(/\D/g, '');
    n.documento = `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
  }
  if (n.email !== undefined && n.email !== null && n.email !== '' && (typeof n.email !== 'string' || n.email.length > 200 || !EMAIL.test(n.email))) throw invalido('El correo electrónico no es válido.', 'email');
  if (col === 'estudiantes') {
    const f = n.fechaNacimiento;
    if (f !== undefined && f !== null && f !== '') {
      if (!esFecha(f)) throw invalido('La fecha de nacimiento no es válida (AAAA-MM-DD).', 'fechaNacimiento');
      if (f > hoyServidor()) throw invalido('La fecha de nacimiento no puede ser futura.', 'fechaNacimiento');
      if (f < '1930-01-01') throw invalido('La fecha de nacimiento no es plausible.', 'fechaNacimiento');
    }
    // código de matrícula: lo asigna el servidor con una secuencia por centro (MAT-<centro>-<n>); no se edita ni lo manda el cliente
    if (e.accion === 'crear') {
      const mx = (await e.p.tx.query<{ n: string }>(
        `SELECT coalesce(max((regexp_match(datos->>'matricula', '([0-9]{1,15})$'))[1]::bigint), 0)::text AS n FROM estudiantes WHERE centro_id = $1`,
        [e.centro],
      )).rows[0]?.n;
      const num = await siguienteSecuencia(e.p, e.centro, 'matricula_mat', Math.max(Number(mx ?? 0), 2000));
      n.matricula = `MAT-${e.centro.replace(/\D/g, '') || '0'}-${num}`;
    } else fijar(e, ['matricula'], 'El código de matrícula lo asigna el sistema y no se puede cambiar.');
  }
  if (col === 'tutores' && n.estudianteIds !== undefined) {
    const ids = n.estudianteIds;
    if (!Array.isArray(ids) || ids.length > 30 || ids.some((x) => typeof x !== 'string' || x.length > 100)) throw invalido('estudianteIds debe ser una lista de hasta 30 ids.', 'estudianteIds');
    const unicos = [...new Set(ids as string[])];
    if (unicos.length) {
      const r = await e.p.tx.query<{ n: number }>('SELECT count(*)::int AS n FROM estudiantes WHERE id = ANY($1::text[]) AND centro_id = $2 AND borrado_en IS NULL', [unicos, e.centro]);
      if ((r.rows[0]?.n ?? 0) !== unicos.length) throw new ErrorHttp(422, 'referencia_invalida', 'Algún estudiante vinculado no existe en este centro.', ['estudianteIds']);
    }
    n.estudianteIds = unicos;
  }
}

// ---------------------------------------------------------------------------------------------------------- matrículas
async function reglaMatricula(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') return;
  const n = e.nuevo as Registro;
  if (e.accion === 'crear') {
    const est = str(n.estudianteId), sec = str(n.seccionId), anio = str(n.anioId);
    if (!est) throw invalido('estudianteId es obligatorio.', 'estudianteId');
    if (!sec) throw invalido('seccionId es obligatorio.', 'seccionId');
    if (!anio) throw invalido('anioId es obligatorio.', 'anioId');
    if (n.estado !== undefined && n.estado !== 'activa') throw protegido('estado', 'Una matrícula nueva siempre queda activa; el retiro y la reactivación tienen su propio endpoint.');
    for (const k of ['fechaRetiro', 'motivoRetiro']) delete n[k];
    n.estado = 'activa';
    if (n.fecha === undefined || n.fecha === null || n.fecha === '') n.fecha = hoyServidor();
    else if (!esFecha(n.fecha)) throw invalido('La fecha de matrícula no es válida (AAAA-MM-DD).', 'fecha');
    await validarMatriculas(e.p, e.centro, { anioId: anio, seccionId: sec, estudianteIds: [est] });
    return;
  }
  fijar(e, ['estado', 'fechaRetiro', 'motivoRetiro', 'estudianteId', 'anioId'], 'Ese campo de la matrícula no se puede cambiar así: usa retirar/reactivar.');
  if (n.fecha !== undefined && n.fecha !== null && !esFecha(n.fecha)) throw invalido('La fecha de matrícula no es válida (AAAA-MM-DD).', 'fecha');
  // traslado de sección: cupo y coherencia con el año
  if (str(n.seccionId) && n.seccionId !== e.antes?.seccionId) {
    await validarMatriculas(e.p, e.centro, {
      anioId: str(e.antes?.anioId) as string, seccionId: n.seccionId as string, estudianteIds: [str(e.antes?.estudianteId) as string], excluirMatricula: e.id, contarCupo: e.antes?.estado === 'activa',
    });
  }
}

// -------------------------------------------------------------------------------------------------------- inscripciones
const PROTEGIDOS_INSCRIPCION = ['estado', 'turno', 'fecha', 'fechaRetiro', 'motivoRetiro', 'promovidoEn', 'fechaCierre', 'cursoId', 'estudianteId'];
async function reglaInscripcion(e: EntradaInt): Promise<void> {
  if (e.accion === 'crear') throw conflicto('usar_endpoint', 'Las inscripciones se crean con POST /cursos/:id/inscripciones (valida cupo, grado, choques y lista de espera).');
  if (e.accion === 'borrar') {
    const estado = e.antes?.estado;
    if (estado === 'inscrito' || estado === 'en_lista_espera') throw conflicto('inscripcion_activa', 'Retira primero la inscripción (POST /inscripciones/:id/retirar): así se promueve la lista de espera.');
    return;
  }
  const n = e.nuevo as Registro;
  fijar(e, PROTEGIDOS_INSCRIPCION, 'El estado, el turno y las fechas de una inscripción solo cambian con los endpoints de inscripción.');
  if (n.asistencia !== undefined) {
    if (!Array.isArray(n.asistencia) || n.asistencia.length > 400) throw invalido('La asistencia debe ser una lista de hasta 400 registros.', 'asistencia');
    for (const a of n.asistencia as unknown[]) {
      const r = a as Registro;
      if (typeof a !== 'object' || a === null || !esFecha(r.fecha) || !['P', 'A', 'T', 'J'].includes(String(r.estado))) throw invalido('Cada asistencia necesita fecha válida y estado P, A, T o J.', 'asistencia');
    }
  }
  if (n.nota !== undefined && n.nota !== null && n.nota !== '' && (!esNum(n.nota) || n.nota < 0 || n.nota > 100)) throw invalido('La nota debe estar entre 0 y 100.', 'nota', 'fuera_de_rango');
}

// ------------------------------------------------------------------------------------------------------- cursos y talleres
async function reglaCursoExtra(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    const n = await contar(e.p, 'inscripciones', 'curso_id', e.id);
    if (n) throw conflicto('tiene_dependencias', `No se puede eliminar el curso: tiene ${n} inscripciones. Ciérralo en su lugar.`);
    return;
  }
  const n = e.nuevo as Registro;
  if (e.accion === 'crear') {
    if (n.estado !== undefined && n.estado !== 'abierto') throw protegido('estado', 'Un curso nuevo siempre empieza «abierto»; los cambios de estado usan POST /cursos/:id/estado.');
    n.estado = 'abierto';
  } else fijar(e, ['estado'], 'El estado del curso solo cambia con POST /cursos/:id/estado (cerrar pasa la lista de espera a retirado).');
  const cupo = n.cupo;
  if (cupo !== undefined && cupo !== null && cupo !== '') {
    if (!esEntero(cupo) || cupo < 1 || cupo > 500) throw invalido('El cupo debe ser un entero entre 1 y 500.', 'cupo', 'fuera_de_rango');
    if (e.accion === 'editar') {
      const ocup = await e.p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM inscripciones WHERE curso_id = $1 AND estado IN ('inscrito','completado') AND borrado_en IS NULL`, [e.id]);
      if ((ocup.rows[0]?.n ?? 0) > cupo) throw conflicto('cupo_menor_inscritos', `El cupo no puede ser menor que los ${ocup.rows[0]?.n} inscritos.`);
    }
  }
  if (n.grados !== undefined && (!Array.isArray(n.grados) || n.grados.some((g) => typeof g !== 'string' || !/^[^:]{1,40}:[1-9]\d?$/.test(g)))) throw invalido('Los grados deben tener el formato «Nivel:grado».', 'grados');
  if (n.horario !== undefined && (!Array.isArray(n.horario) || n.horario.length > 20)) throw invalido('El horario debe ser una lista de hasta 20 bloques.', 'horario');
  if (n.inicio && n.fin && esFecha(n.inicio) && esFecha(n.fin) && n.inicio > n.fin) throw invalido('La fecha de inicio es posterior al fin.', 'inicio');
  const doc = str(n.docenteId);
  if (doc && !(await existeEnCentro(e.p, 'docentes', doc, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'El docente no existe en este centro.', ['docenteId']);
}

// -------------------------------------------------------------------------------------------------- config académica
async function reglaAnio(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['periodos', 'anio_id', 'periodos'], ['secciones', 'anio_id', 'secciones'], ['cargas', `datos->>'anioId'`, 'cargas'], ['matriculas', 'anio_id', 'matrículas']]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.nombre !== undefined && (typeof n.nombre !== 'string' || !n.nombre.trim() || n.nombre.length > 100)) throw invalido('El nombre del año lectivo es obligatorio (máx. 100 caracteres).', 'nombre');
  for (const k of ['inicio', 'fin']) if (n[k] !== undefined && n[k] !== null && !esFecha(n[k])) throw invalido(`La fecha «${k}» no es válida (AAAA-MM-DD).`, k);
  if (esFecha(n.inicio) && esFecha(n.fin) && n.fin <= n.inicio) throw invalido('La fecha de fin debe ser posterior al inicio.', 'fin');
  if (n.activo !== undefined && typeof n.activo !== 'boolean') throw invalido('activo debe ser verdadero o falso.', 'activo');
  // activar otro año: POST /anios/:id/activar (el índice único impide dos activos por centro)
}

async function reglaPeriodo(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['actividades', 'periodo_id', 'actividades']]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.peso !== undefined && n.peso !== null && (!esNum(n.peso) || n.peso < 0.01 || n.peso > 100)) throw invalido('El peso del periodo debe estar entre 0,01 y 100.', 'peso', 'fuera_de_rango');
  const anio = str(n.anioId) ?? str(e.antes?.anioId);
  if (anio) {
    const a = await e.p.tx.query<{ datos: Registro }>('SELECT datos FROM anios WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL', [anio, e.centro]);
    if (!a.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'El año lectivo del periodo no existe en este centro.', ['anioId']);
    const ini = str(n.inicio), fin = str(n.fin), ai = str(a.rows[0].datos.inicio), af = str(a.rows[0].datos.fin);
    if (ai && af) {
      for (const [k, v] of [['inicio', ini], ['fin', fin]] as const) if (v && esFecha(v) && (v < ai || v > af)) throw invalido(`La fecha «${k}» debe estar dentro del año lectivo (${ai} a ${af}).`, k);
    }
    if (esNum(n.peso)) {
      // los periodos de un año se editan de uno en uno: se serializan para que la suma no se pase de 100 por una carrera
      await e.p.tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`peso:${e.centro}:${anio}`]);
      const s = await e.p.tx.query<{ s: string }>(`SELECT coalesce(sum(peso), 0)::text AS s FROM periodos WHERE centro_id = $1 AND anio_id = $2 AND borrado_en IS NULL AND id <> $3`, [e.centro, anio, e.id]);
      const suma = Number(s.rows[0]?.s ?? 0) + n.peso;
      if (suma > 100 + EPS) throw new ErrorHttp(422, 'suma_pesos_excedida', `Con este peso la suma de los periodos del año sería ${Math.round(suma * 1e6) / 1e6}; el máximo es 100.`, ['peso'], { suma });
    }
  }
}

async function reglaCurso(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['secciones', 'curso_id', 'secciones']]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.grado !== undefined && n.grado !== null && (!esEntero(n.grado) || n.grado < 1 || n.grado > 6)) throw invalido('El grado debe ser un entero entre 1 y 6.', 'grado', 'fuera_de_rango');
  if (n.nombre !== undefined && (typeof n.nombre !== 'string' || !n.nombre.trim() || n.nombre.length > 100)) throw invalido('El nombre del curso es obligatorio (máx. 100 caracteres).', 'nombre');
}

async function reglaSeccion(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['matriculas', 'seccion_id', 'matrículas'], ['cargas', 'seccion_id', 'cargas docentes']]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.nombre !== undefined && (typeof n.nombre !== 'string' || !n.nombre.trim() || n.nombre.length > 40)) throw invalido('El nombre de la sección es obligatorio (máx. 40 caracteres).', 'nombre');
  if (n.capacidad !== undefined && n.capacidad !== null && n.capacidad !== '') {
    if (!esEntero(n.capacidad) || n.capacidad < 1 || n.capacidad > 60) throw invalido('La capacidad debe ser un entero entre 1 y 60.', 'capacidad', 'fuera_de_rango');
    if (e.accion === 'editar') {
      const act = await e.p.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM matriculas WHERE seccion_id = $1 AND estado = 'activa' AND borrado_en IS NULL`, [e.id]);
      if ((act.rows[0]?.n ?? 0) > n.capacidad) throw conflicto('capacidad_menor_ocupacion', `La capacidad no puede ser menor que las ${act.rows[0]?.n} matrículas activas.`);
    }
  }
  const curso = str(n.cursoId), anio = str(n.anioId);
  if (curso && !(await existeEnCentro(e.p, 'cursos', curso, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'El curso no existe en este centro.', ['cursoId']);
  if (anio && !(await existeEnCentro(e.p, 'anios', anio, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'El año lectivo no existe en este centro.', ['anioId']);
}

async function reglaAsignatura(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['cargas', 'asignatura_id', 'cargas docentes']]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.nombre !== undefined && (typeof n.nombre !== 'string' || !n.nombre.trim() || n.nombre.length > 120)) throw invalido('El nombre de la asignatura es obligatorio (máx. 120 caracteres).', 'nombre');
}

async function reglaCarga(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    await dependencias(e, [['categorias', 'carga_id', 'categorías de evaluación'], ['actividades', 'carga_id', 'actividades'], ['horarios', 'carga_id', 'bloques de horario']]);
    return;
  }
  const n = e.nuevo as Registro;
  const { p } = e;
  const sec = str(n.seccionId), asig = str(n.asignaturaId), doc = str(n.docenteId), anio = str(n.anioId);
  if (sec) {
    const s = await p.tx.query<{ datos: Registro }>('SELECT datos FROM secciones WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL', [sec, e.centro]);
    if (!s.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'La sección no existe en este centro.', ['seccionId']);
    const as = str(s.rows[0].datos.anioId);
    if (anio && as && anio !== as) throw new ErrorHttp(422, 'anio_incoherente', 'El año de la carga no coincide con el de la sección.', ['anioId']);
  }
  if (asig && !(await existeEnCentro(p, 'asignaturas', asig, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'La asignatura no existe en este centro.', ['asignaturaId']);
  if (anio && !(await existeEnCentro(p, 'anios', anio, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'El año lectivo no existe en este centro.', ['anioId']);
  if (doc && doc !== e.antes?.docenteId) {
    // FOR SHARE: una baja concurrente del docente espera a que esta carga se confirme (y la baja verá la carga)
    const d = await p.tx.query<{ datos: Registro }>('SELECT datos FROM docentes WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL FOR SHARE', [doc, e.centro]);
    if (!d.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'El docente no existe en este centro.', ['docenteId']);
    if ((str(d.rows[0].datos.estado) ?? 'activo') !== 'activo') throw conflicto('docente_inactivo', 'El docente está dado de baja: no se le pueden asignar cargas.');
  }
  if (n.horasSemana !== undefined && n.horasSemana !== null && (!esEntero(n.horasSemana) || n.horasSemana < 0 || n.horasSemana > 40)) throw invalido('Las horas semanales deben ser un entero entre 0 y 40.', 'horasSemana', 'fuera_de_rango');
}

async function reglaEscala(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') return;
  const n = e.nuevo as Registro;
  const m: Registro = { ...(e.antes ?? {}), ...n };
  if (m.min === undefined && m.max === undefined && m.notaMinAprobar === undefined && m.tramos === undefined) return;
  const v = calculo().edu.escala.validar!(JSON.parse(JSON.stringify(m)));
  const errores = (v as { ok: boolean; errores: string[] }).errores;
  if (!(v as { ok: boolean }).ok) throw new ErrorHttp(422, 'escala_invalida', errores[0] as string, ['min'], { errores });
  const min = Number(m.min), max = Number(m.max);
  if (m.tramos !== undefined && m.tramos !== null) {
    const t = m.tramos;
    if (!Array.isArray(t) || !t.length || t.length > 20) throw invalido('Los tramos deben ser una lista de 1 a 20.', 'tramos');
    const vistos = new Set<number>();
    for (const x of t as Registro[]) {
      if (typeof x !== 'object' || x === null || !esNum(x.desde) || x.desde < min - EPS || x.desde > max + EPS) throw invalido('Cada tramo necesita «desde» dentro de la escala.', 'tramos');
      if (vistos.has(x.desde)) throw invalido('Hay tramos con el mismo «desde».', 'tramos');
      vistos.add(x.desde);
      for (const k of ['etiqueta', 'letra']) if (x[k] !== undefined && x[k] !== null && (typeof x[k] !== 'string' || (x[k] as string).length > 60)) throw invalido(`El campo «${k}» del tramo no es válido.`, 'tramos');
    }
    if (Math.min(...vistos) > min + EPS) throw invalido('Algún tramo debe empezar en el mínimo de la escala para cubrir todas las notas.', 'tramos');
  }
  if (n.activa !== undefined && typeof n.activa !== 'boolean') throw invalido('activa debe ser verdadero o falso.', 'activa');
}

// ------------------------------------------------------------------------------------------------------------- asistencia
const ESTADOS_ASISTENCIA = ['P', 'A', 'T', 'J'];
async function reglaAsistencia(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') return;
  const { p } = e;
  const n = e.nuevo as Registro;
  const sec = str(n.seccionId), est = str(n.estudianteId);
  if (!sec) throw invalido('seccionId es obligatorio.', 'seccionId');
  if (!est) throw invalido('estudianteId es obligatorio.', 'estudianteId');
  if (!esFecha(n.fecha)) throw invalido('La fecha no es válida (AAAA-MM-DD).', 'fecha', 'fecha_invalida');
  if (n.fecha > hoyServidor()) throw invalido('No se puede registrar asistencia de fechas futuras.', 'fecha', 'fecha_futura');
  if (!ESTADOS_ASISTENCIA.includes(String(n.estado))) throw invalido('El estado debe ser P, A, T o J.', 'estado');
  if (e.antes && (e.antes.seccionId !== sec || e.antes.estudianteId !== est || e.antes.fecha !== n.fecha)) {
    throw invalido('La sección, el estudiante y la fecha de un registro de asistencia no se pueden cambiar.', 'fecha', 'campo_inmutable');
  }
  if (!e.antes) {
    if (!(await existeEnCentro(p, 'secciones', sec, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'La sección no existe en este centro.', ['seccionId']);
    const m = await p.tx.query(`SELECT 1 FROM matriculas WHERE estudiante_id = $1 AND seccion_id = $2 AND estado = 'activa' AND borrado_en IS NULL`, [est, sec]);
    if (!m.rowCount) throw conflicto('estudiante_no_matriculado', 'El estudiante no tiene matrícula activa en esa sección.');
  }
  if (n.nota !== undefined && n.nota !== null && (typeof n.nota !== 'string' || n.nota.length > 200)) throw invalido('La nota debe ser texto de hasta 200 caracteres.', 'nota');
  // autoría y fechas: las fija el servidor
  const ahora = new Date().toISOString();
  n.registradoPor = e.antes ? (e.antes.registradoPor ?? p.ses.usuarioId) : p.ses.usuarioId;
  n.registradoEn = e.antes ? (e.antes.registradoEn ?? ahora) : ahora;
  if (n.estado === 'J') {
    const just = typeof n.justificacion === 'string' ? n.justificacion.replace(/\s+/g, ' ').trim() : '';
    if (just.length < 3 || just.length > 300) throw invalido('La justificación es obligatoria (3 a 300 caracteres).', 'justificacion', 'justificacion_requerida');
    n.justificacion = just;
    if (e.antes?.estado === 'J' && e.antes.justificacion === just && e.antes.justificadoPor) {
      n.justificadoPor = e.antes.justificadoPor;
      n.justificadoEn = e.antes.justificadoEn;
    } else {
      n.justificadoPor = p.ses.usuarioId;
      n.justificadoEn = ahora;
    }
  } else {
    delete n.justificacion;
    delete n.justificadoPor;
    delete n.justificadoEn;
  }
}

// ------------------------------------------------------------------------------------------------------------ comunicados
const AUDIENCIAS = ['todos', 'docentes', 'tutores', 'estudiantes'];
const SEGMENTOS: Record<string, string> = { curso: 'cursos', seccion: 'secciones', tutor: 'tutores' };
async function reglaComunicado(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') return;
  const { p } = e;
  const n = e.nuevo as Registro;
  for (const k of ['totalDestinatarios', 'totalLeidos', 'leido', 'nDest', 'nLeidos']) delete n[k]; // contadores: se calculan en el servidor al leer
  if (n.titulo !== undefined && (typeof n.titulo !== 'string' || n.titulo.trim().length < 3 || n.titulo.length > 120)) throw invalido('El título debe tener entre 3 y 120 caracteres.', 'titulo');
  if (n.cuerpo !== undefined && (typeof n.cuerpo !== 'string' || n.cuerpo.trim().length < 5 || n.cuerpo.length > 2000)) throw invalido('El mensaje debe tener entre 5 y 2000 caracteres.', 'cuerpo');
  const estado = n.estado === undefined ? (e.antes?.estado ?? 'borrador') : n.estado;
  if (estado !== 'borrador' && estado !== 'publicado') throw invalido('El estado debe ser borrador o publicado.', 'estado');
  n.estado = estado;
  const aud = n.destinatarios === undefined ? (e.antes?.destinatarios ?? 'todos') : n.destinatarios;
  if (!AUDIENCIAS.includes(String(aud))) throw invalido('Los destinatarios deben ser todos, docentes, tutores o estudiantes.', 'destinatarios');
  n.destinatarios = aud;
  const seg = n.segmento === undefined ? e.antes?.segmento : n.segmento;
  if (seg !== undefined && seg !== null) {
    const s = seg as Registro;
    if (typeof seg !== 'object' || Array.isArray(seg) || !['centro', 'curso', 'seccion', 'tutor'].includes(String(s.tipo))) throw invalido('El segmento debe ser centro, curso, sección o tutor.', 'segmento');
    if (s.tipo === 'centro') n.segmento = { tipo: 'centro', id: null };
    else {
      const id = str(s.id);
      if (!id || !(await existeEnCentro(p, SEGMENTOS[String(s.tipo)] as string, id, e.centro))) throw new ErrorHttp(422, 'segmento_inexistente', 'El segmento elegido no existe en este centro.', ['segmento']);
      n.segmento = { tipo: s.tipo, id };
      if (s.tipo === 'tutor' && aud !== 'tutores') throw invalido('Un comunicado dirigido a un tutor tiene como destinatarios «tutores».', 'destinatarios');
    }
  }
  // autoría y fecha de publicación: las fija el servidor
  if (e.accion === 'crear') n.autorId = p.ses.usuarioId;
  else n.autorId = e.antes?.autorId ?? p.ses.usuarioId;
  const publicaAhora = estado === 'publicado' && e.antes?.estado !== 'publicado';
  if (publicaAhora) {
    n.fecha = hoyServidor();
    n.publicadoEn = new Date().toISOString();
  } else if (e.antes) {
    n.fecha = e.antes.fecha ?? hoyServidor();
    if (e.antes.publicadoEn !== undefined) n.publicadoEn = e.antes.publicadoEn;
    else delete n.publicadoEn;
  } else {
    n.fecha = hoyServidor();
    delete n.publicadoEn;
  }
}

// ------------------------------------------------------------------------------------------------------ planes y secuencias
const ESTADOS_PLAN = ['borrador', 'listo', 'impartido'];
const SIGUIENTES: Record<string, string[]> = { borrador: ['borrador', 'listo'], listo: ['listo', 'borrador', 'impartido'], impartido: ['impartido'] };

async function reglaPlan(e: EntradaInt): Promise<void> {
  const { p } = e;
  const direccion = ROLES_DIRECCION.includes(p.ses.rol);
  if (e.accion !== 'crear' && e.antes?.estado === 'impartido' && !direccion) {
    throw conflicto('plan_impartido', `Un plan impartido está bloqueado: solo la dirección puede ${e.accion === 'borrar' ? 'eliminarlo' : 'modificarlo'}.`);
  }
  if (e.accion === 'borrar') return;
  const n = e.nuevo as Registro;
  const estado = n.estado === undefined ? (e.antes?.estado ?? 'borrador') : n.estado;
  if (!ESTADOS_PLAN.includes(String(estado))) throw invalido('El estado del plan debe ser borrador, listo o impartido.', 'estado');
  const antes = (e.antes?.estado as string | undefined) ?? null;
  if (!direccion) {
    const permitido = antes === null ? ['borrador', 'listo'] : (SIGUIENTES[antes] ?? ['borrador']);
    if (!permitido.includes(String(estado))) {
      throw conflicto('transicion_invalida', `Transición no permitida: de «${antes ?? 'nuevo'}» a «${String(estado)}». El orden es borrador → listo → impartido.`);
    }
  }
  n.estado = estado;
  if (n.fecha !== undefined && n.fecha !== null && n.fecha !== '') {
    if (!esFecha(n.fecha)) throw invalido('La fecha del plan no es válida (AAAA-MM-DD).', 'fecha');
    if (diaSemana(n.fecha) > 5) throw invalido('Los planes de clase se programan de lunes a viernes.', 'fecha', 'dia_no_lectivo');
  }
  if (p.ses.rol === 'docente') n.docenteId = p.ses.refId; // el docente no decide la autoría
  const carga = str(n.cargaId) ?? str(e.antes?.cargaId);
  if (carga && !(await existeEnCentro(p, 'cargas', carga, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente no pertenece al centro.', ['cargaId']);
  const secId = n.secuenciaId === undefined ? str(e.antes?.secuenciaId) : str(n.secuenciaId);
  const inds = n.indicadorIds === undefined ? e.antes?.indicadorIds : n.indicadorIds;
  if (secId) {
    const s = await p.tx.query<{ datos: Registro }>('SELECT datos FROM secuencias WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL', [secId, e.centro]);
    if (!s.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'La secuencia didáctica no existe en este centro.', ['secuenciaId']);
    if (!carga || s.rows[0].datos.cargaId !== carga) throw new ErrorHttp(422, 'secuencia_incoherente', 'La secuencia didáctica pertenece a otra carga docente.', ['secuenciaId']);
    if (inds !== undefined && inds !== null) {
      if (!Array.isArray(inds) || inds.length > 200 || inds.some((x) => typeof x !== 'string')) throw invalido('indicadorIds debe ser una lista de ids.', 'indicadorIds');
      const validos = new Set((Array.isArray(s.rows[0].datos.indicadoresLogro) ? (s.rows[0].datos.indicadoresLogro as Registro[]) : []).map((i) => i.uid));
      const mal = (inds as string[]).filter((u) => !validos.has(u));
      if (mal.length) throw invalido('Algún indicador no pertenece a la secuencia didáctica elegida.', 'indicadorIds', 'indicador_invalido');
    }
  } else if (Array.isArray(inds) && inds.length) {
    throw invalido('Los indicadores solo pueden marcarse si el plan tiene una secuencia didáctica de la misma carga.', 'indicadorIds', 'indicador_sin_secuencia');
  } else if (n.indicadorIds !== undefined) n.indicadorIds = [];
}

async function reglaSecuencia(e: EntradaInt): Promise<void> {
  const { p } = e;
  if (e.accion === 'borrar') {
    // cascada transaccional: los planes vinculados se desvinculan (el bloqueo de «impartido» no aplica a esta limpieza del servidor)
    await p.tx.query(
      `UPDATE planes SET datos = jsonb_set(jsonb_set(datos, '{secuenciaId}', 'null'::jsonb), '{indicadorIds}', '[]'::jsonb) WHERE borrado_en IS NULL AND datos->>'secuenciaId' = $1`,
      [e.id],
    );
    return;
  }
  const n = e.nuevo as Registro;
  const carga = str(n.cargaId);
  if (carga) {
    if (!(await existeEnCentro(p, 'cargas', carga, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'La carga docente no pertenece al centro.', ['cargaId']);
    if (e.antes?.cargaId !== undefined && e.antes.cargaId !== carga) throw invalido('La carga de una secuencia no se puede cambiar.', 'cargaId', 'campo_inmutable');
  }
  const ver = str(n.curriculoVersionId);
  if (ver && !(await existeEnCentro(p, 'curriculo_versiones', ver, e.centro))) throw new ErrorHttp(422, 'referencia_invalida', 'La versión de currículo no existe en este centro.', ['curriculoVersionId']);
  for (const k of ['fechaInicio', 'fechaFin']) if (n[k] !== undefined && n[k] !== null && n[k] !== '' && !esFecha(n[k])) throw invalido(`La fecha «${k}» no es válida (AAAA-MM-DD).`, k);
  if (esFecha(n.fechaInicio) && esFecha(n.fechaFin) && n.fechaFin < n.fechaInicio) throw invalido('La fecha de fin es anterior al inicio.', 'fechaFin');
}

// ----------------------------------------------------------------------------------------------------------------- currículo
const ESTADOS_VERSION = ['borrador', 'vigente', 'anterior'];

/** Recalcula hash y total de una versión a partir de sus contenidos vivos (el cliente no los fija). */
export async function recalcularVersion(p: Peticion, versionId: string): Promise<{ hash: string; total: number }> {
  const r = await p.tx.query<{ id: string; datos: Registro }>('SELECT id, datos FROM curriculo_contenidos WHERE version_id = $1 AND borrado_en IS NULL', [versionId]);
  const items = r.rows.map((x) => ({ ...x.datos, id: x.id }));
  return { hash: curriculoCompartido().hashItems(items), total: items.length };
}

async function reglaVersion(e: EntradaInt): Promise<void> {
  const { p } = e;
  if (e.accion === 'borrar') {
    if (e.antes?.esConfig) return;
    if (e.antes?.estado === 'vigente') throw conflicto('version_vigente_no_eliminable', 'La versión vigente no se puede eliminar: marca otra como vigente primero.');
    const n = await contar(p, 'secuencias', `datos->>'curriculoVersionId'`, e.id);
    if (n) throw conflicto('version_referenciada', `No se puede eliminar: ${n} ${n === 1 ? 'secuencia didáctica usa' : 'secuencias didácticas usan'} esta versión.`, { secuencias: n });
    // cascada: sus contenidos (todo o nada con el borrado de la versión)
    await p.tx.query('UPDATE curriculo_contenidos SET borrado_en = now() WHERE version_id = $1 AND borrado_en IS NULL', [e.id]);
    return;
  }
  const n = e.nuevo as Registro;
  if (n.esConfig || e.antes?.esConfig) return; // registro de configuración de revisión: no es una versión
  if (e.antes?.estado === 'anterior') throw conflicto('version_anterior_solo_lectura', 'Una versión anterior es de solo lectura.');
  if (e.accion === 'crear') {
    if (n.estado !== undefined && n.estado !== 'borrador') throw protegido('estado', 'Una versión nueva empieza como borrador; usa «marcar vigente» (POST /curriculo/versiones/:id/vigente).');
    n.estado = 'borrador';
  } else fijar(e, ['estado'], 'El estado de la versión solo cambia con POST /curriculo/versiones/:id/vigente.');
  if (!ESTADOS_VERSION.includes(String(n.estado))) throw invalido('Estado de versión no válido.', 'estado');
  if (n.nombre !== undefined && (typeof n.nombre !== 'string' || !n.nombre.trim() || n.nombre.length > 300)) throw invalido('El nombre de la versión es obligatorio.', 'nombre');
  for (const k of ['fechaPublicacion', 'vigenteDesde']) if (n[k] !== undefined && n[k] !== null && n[k] !== '' && !esFecha(n[k])) throw invalido(`La fecha «${k}» no es válida (AAAA-MM-DD).`, k);
  // hash y total los calcula el servidor desde los contenidos
  if (e.accion === 'editar') Object.assign(n, await recalcularVersion(p, e.id));
  else {
    delete n.hash;
    delete n.total;
  }
}

async function reglaContenido(e: EntradaInt): Promise<void> {
  const { p } = e;
  const ver = str(e.nuevo?.versionId) ?? str(e.antes?.versionId);
  if (!ver) throw invalido('versionId es obligatorio.', 'versionId');
  const v = await p.tx.query<{ datos: Registro }>('SELECT datos FROM curriculo_versiones WHERE id = $1 AND centro_id = $2 AND borrado_en IS NULL', [ver, e.centro]);
  if (!v.rows[0]) throw new ErrorHttp(422, 'referencia_invalida', 'La versión del currículo no existe en este centro.', ['versionId']);
  if (v.rows[0].datos.estado === 'anterior') throw conflicto('version_anterior_solo_lectura', 'Una versión anterior es de solo lectura.');
  if (e.accion === 'borrar') return;
  const n = e.nuevo as Registro;
  if (e.antes && e.antes.versionId !== undefined && e.antes.versionId !== ver) throw invalido('Un contenido no se puede mover a otra versión.', 'versionId', 'campo_inmutable');
  if (n.estado !== undefined && !['verificado', 'pendiente'].includes(String(n.estado))) throw invalido('El estado de verificación debe ser verificado o pendiente.', 'estado');
  if (n.descripcion !== undefined && (typeof n.descripcion !== 'string' || n.descripcion.length > 4000)) throw invalido('La descripción debe ser texto de hasta 4000 caracteres.', 'descripcion');
  if (n.estado === 'verificado') {
    if (typeof n.fuente !== 'string' || !/^https?:\/\/\S+$/.test(n.fuente)) throw invalido('Un dato verificado necesita una fuente con url http(s).', 'fuente', 'fuente_requerida');
    if (!esFecha(n.fecha)) throw invalido('Un dato verificado necesita una fecha válida (AAAA-MM-DD).', 'fecha', 'fecha_invalida');
  } else if (n.fecha !== undefined && n.fecha !== null && n.fecha !== '' && !esFecha(n.fecha)) throw invalido('La fecha no es válida (AAAA-MM-DD).', 'fecha', 'fecha_invalida');
}

// ----------------------------------------------------------------------------------------------------------------- horarios
async function reglaHorario(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') return;
  await validarHorarioGenerico(e.p, e.centro, e.id, e.nuevo as Registro);
}
async function reglaFranja(e: EntradaInt): Promise<void> {
  if (e.accion === 'borrar') {
    if (e.antes?.tipo !== 'config') await prepararBorradoFranja(e.p, e.id);
    return;
  }
  await validarFranjaGenerica(e.p, e.centro, e.id, e.nuevo as Registro);
}

// ----------------------------------------------------------------------------------------------------------------- entrada
export async function aplicarIntegridad(e: EntradaInt): Promise<void> {
  switch (e.meta.nombre) {
    case 'estudiantes': case 'docentes': case 'tutores': return reglaPersona(e);
    case 'matriculas': return reglaMatricula(e);
    case 'inscripciones': return reglaInscripcion(e);
    case 'cursosExtra': return reglaCursoExtra(e);
    case 'anios': return reglaAnio(e);
    case 'periodos': return reglaPeriodo(e);
    case 'cursos': return reglaCurso(e);
    case 'secciones': return reglaSeccion(e);
    case 'asignaturas': return reglaAsignatura(e);
    case 'cargas': return reglaCarga(e);
    case 'escalas': return reglaEscala(e);
    case 'asistencia': return reglaAsistencia(e);
    case 'comunicados': return reglaComunicado(e);
    case 'planes': return reglaPlan(e);
    case 'secuencias': return reglaSecuencia(e);
    case 'curriculoVersiones': return reglaVersion(e);
    case 'curriculoContenidos': return reglaContenido(e);
    case 'horarios': return reglaHorario(e);
    case 'franjas': return reglaFranja(e);
    default: return;
  }
}
