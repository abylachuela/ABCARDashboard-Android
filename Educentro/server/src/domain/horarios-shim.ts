// Motor de horarios COMPARTIDO con el cliente: carga js/core/formato.js y js/vistas/horarios-motor.js bajo `vm`
// (EDU.horarios.motor.{armar, validar, validarFranjas}) y lo expone tipado. Única fuente de verdad: lo que el cliente
// muestra como conflicto es lo que el servidor rechaza. Falla cerrado si cambia de forma o de resultados canarios.
import { aPlano, cargarCliente, type Edu } from './cliente-vm.js';

type Json = Record<string, unknown>;
export interface ConflictoHorario {
  tipo: 'docente' | 'seccion' | 'aula' | 'disponibilidad' | 'franja';
  msg: string;
  claves: string[];
  dia?: number;
  franjaId?: string;
}
export interface AvisoHorario {
  tipo: string;
  msg: string;
  cargaId?: string;
  docenteId?: string;
}
export interface ResultadoValidacion {
  conflictos: ConflictoHorario[];
  avisos: AvisoHorario[];
  porEntrada: Record<string, string[]>;
  horasCarga: Record<string, number>;
  horasDocente: Record<string, number>;
}
export interface DatosHorarios {
  franjas: Json[];
  horarios: Json[];
  disponibilidad: Json[];
  cargas: Json[];
  secciones: Json[];
  cursos: Json[];
  asignaturas: Json[];
  docentes: Json[];
}
export interface EntradaHorario {
  id?: string;
  _k?: string;
  cargaId: string;
  dia: number;
  franjaId: string;
  aula?: string;
}
export interface MotorHorarios {
  validar(datos: DatosHorarios, entradas: EntradaHorario[]): ResultadoValidacion;
  validarFranjas(lista: Json[]): string[];
  huellas: Record<string, string>;
}

const ARCHIVOS = ['core/formato.js', 'vistas/horarios-motor.js'] as const;
let instancia: MotorHorarios | null = null;

function cargar(): MotorHorarios {
  const { edu, huellas } = cargarCliente(ARCHIVOS);
  const m = (edu as Edu).horarios?.motor as Record<string, (...a: unknown[]) => unknown> | undefined;
  const falta = ['armar', 'validar', 'validarFranjas', 'mins', 'tandaDe'].filter((n) => typeof m?.[n] !== 'function');
  if (falta.length || !m) throw new Error(`Motor de horarios: EDU.horarios.motor cambió de forma (faltan: ${falta.join(', ')}).`);
  const motor: MotorHorarios = {
    huellas,
    validar(datos, entradas) {
      // el contexto vm exige objetos de su propio mundo: se pasan como JSON y se devuelve JSON
      const ctx = (m.armar as (d: unknown) => unknown)(JSON.parse(JSON.stringify(datos)));
      return aPlano<ResultadoValidacion>((m.validar as (c: unknown, e: unknown) => unknown)(ctx, JSON.parse(JSON.stringify(entradas))));
    },
    validarFranjas(lista) {
      return aPlano<string[]>((m.validarFranjas as (l: unknown) => unknown)(JSON.parse(JSON.stringify(lista))));
    },
  };
  // canario: dos clases del mismo docente a la misma hora deben chocar
  const d: DatosHorarios = {
    franjas: [{ id: 'f1', tanda: 'matutina', orden: 1, inicio: '07:30', fin: '08:15', tipo: 'clase' }],
    horarios: [], disponibilidad: [], secciones: [{ id: 's1', cursoId: 'c1', nombre: 'A' }, { id: 's2', cursoId: 'c1', nombre: 'B' }], cursos: [{ id: 'c1', nombre: '1.º' }],
    asignaturas: [{ id: 'a1', nombre: 'X' }], docentes: [{ id: 'd1', nombres: 'D' }],
    cargas: [{ id: 'g1', docenteId: 'd1', seccionId: 's1', asignaturaId: 'a1', horasSemana: 1 }, { id: 'g2', docenteId: 'd1', seccionId: 's2', asignaturaId: 'a1', horasSemana: 1 }],
  };
  const r = motor.validar(d, [{ _k: 'x', cargaId: 'g1', dia: 1, franjaId: 'f1' }, { _k: 'y', cargaId: 'g2', dia: 1, franjaId: 'f1' }]);
  if (!(r.conflictos.length === 1 && r.conflictos[0]?.tipo === 'docente')) throw new Error('Motor de horarios: el resultado canario no coincide; revisa js/vistas/horarios-motor.js.');
  return motor;
}

export function motorHorarios(): MotorHorarios {
  instancia ??= cargar();
  return instancia;
}
