/* Horarios · proponedor "Agente IA": conecta la tarea `proponer_horario` de EDU.agente con el punto de extension de Horarios
   (EDU.horarios.registrarProponedor). Se carga DESPUES de agente.js y horarios-motor.js. Aparece en el selector de proponedores solo si el agente
   esta activo y la tarea habilitada para el usuario (si no, la vista explica por que). El resultado se vuelve a validar en el motor (conflictos,
   disponibilidad, horas) y NUNCA se guarda solo: la vista exige aprobacion humana y despues llama a `alResolver` para cerrar el registro del agente. */
(function () {
  'use strict';
  var EDU = (window.EDU = window.EDU || {});
  if (!EDU.horarios || !EDU.agente) return;

  EDU.horarios.registrarProponedor('agente', {
    etiqueta: 'Agente IA',
    admiteTexto: true,
    disponible: function () { return EDU.agente.disponible('proponer_horario'); },
    /** contextoMinimo = EDU.horarios.contextoParaProponedor(ctx, opts): el agente lo anonimiza (docentes -> alias) antes de enviarlo al proveedor. */
    proponer: async function (ctx, opts, contextoMinimo) {
      opts = opts || {};
      var log = await EDU.agente.solicitar('proponer_horario', { seccionId: opts.seccionId || null, conservar: opts.conservar !== false, texto: opts.restriccion || '', contextoHorario: contextoMinimo }, { sinAuto: true });
      var p = log.propuesta;
      return {
        asignaciones: p.asignaciones, sinColocar: p.sinColocar, notas: p.notas, descartadas: p.descartadas, nDescartadas: p.nDescartadas,
        algoritmo: 'Agente IA (' + (p.proveedor || 'proveedor') + (p.simulado ? ', simulado' : '') + ')', agenteLogId: log.id,
        alResolver: async function (estado, info) {
          if (estado === 'aprobada') await EDU.agente.confirmarHorario(log.id, info);
          else await EDU.agente.rechazar(log.id, (info && info.motivo) || 'Descartada en Horarios');
        }
      };
    }
  });
})();
