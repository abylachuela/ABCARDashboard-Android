# Roles y permisos

Seis roles (`EDU.permisos.ROLES`): `admin_red` (Administrador de red), `director`, `docente`, `secretaria`, `tutor`, `estudiante`. Todo dato lleva `centroId`; la sesión fija el centro activo. Solo `admin_red` ve "Todos los centros".

## Matriz módulo × rol (leída de `js/core/permisos.js`)
Acciones posibles: `ver crear editar borrar exportar importar imprimir cerrar aprobar`. "—" = el módulo no aparece en el menú.

| Módulo | admin_red | director | docente | secretaria | tutor | estudiante |
|---|---|---|---|---|---|---|
| Panel (`dashboard`) | ver | ver | ver | ver | ver | ver |
| Centros educativos (`centros`) | ver, crear, editar, borrar | — | — | — | — | — |
| Configuración (`config`) | ver | ver, crear, editar, borrar, cerrar | — | — | — | — |
| Currículo (`curriculo`) | ver, crear, editar, borrar | ver, crear, editar, borrar | ver | ver | ver | ver |
| Personas (`personas`) | ver, crear, editar, borrar | ver, crear, editar, borrar | ver | ver, crear, editar | ver | ver |
| Matrícula (`matricula`) | — | ver, crear, editar, borrar | ver | ver, crear, editar, borrar | — | — |
| Cursos y talleres (`cursos`) | ver | ver, crear, editar, borrar | ver, editar | ver, crear, editar, borrar | ver | ver |
| Horarios (`horarios`) | ver, crear, editar, borrar | ver, crear, editar, borrar | ver | ver, crear, editar, borrar | ver | ver |
| Aula virtual (`aula`) | ver | ver | ver, crear, editar, borrar | ver | ver | ver, crear |
| Calificaciones (`libro-notas`) | — | ver, editar, cerrar | ver, crear, editar | ver | — | — |
| Planificación (`planificacion`) | — | ver, editar | ver, crear, editar, borrar | ver | — | — |
| Secuencias didácticas (`secuencias`) | — | ver, editar | ver, crear, editar, borrar | ver | — | — |
| Agente IA (`agente`) | ver, editar | ver, editar, aprobar | ver, editar, aprobar | — | — | — |
| Asistencia (`asistencia`) | — | ver | ver, crear, editar | ver, crear, editar | ver | ver |
| Boletín (`boletin`) | ver, imprimir | ver, imprimir | — | ver, imprimir | ver, imprimir | ver, imprimir |
| Comunicados (`comunicados`) | ver, crear, editar, borrar | ver, crear, editar, borrar | ver | ver, crear, editar | ver | ver |
| Reportes (`reportes`) | ver, exportar | ver, exportar | — | — | — | — |
| Importar planilla (`importar-planilla`) | ver, exportar, importar | ver, exportar, importar | — | ver, exportar, importar | — | — |
| Respaldo (`respaldo`) | ver, exportar, importar | ver, exportar, importar | — | — | — | — |

## Escritura por colección (guardia del repositorio)
- **admin_red**: todas las colecciones y `centros`.
- **director**: todas salvo `centros` (incluye `calificaciones`; `auditoria` nunca se escribe directamente).
- **docente**: aula (`aulaContenidos tareas entregas cuestionarios intentos foros foroMensajes anuncios`), `inscripciones`, `calificaciones`, `notasCompetencia`, `actividades`, `categorias`, `asistencia`, `planes`, `horarios`, `secuencias`, `agenteConfig`, `agenteLog`.
- **secretaría**: `notasCompetencia` (solo vía importación), `franjas horarios disponibilidad cursosExtra inscripciones estudiantes tutores matriculas comunicados asistencia`.
- **tutor**: ninguna. **estudiante**: `entregas`, `intentos`, `foroMensajes`.

## Alcance dentro del centro
`EDU.permisos.alcance(sesion, datos)`: el **docente** ve solo sus cargas, secciones y estudiantes; el **tutor** solo a sus hijos; el **estudiante** solo a sí mismo. Director, secretaría y admin_red ven todo el centro activo.

## Reglas de propiedad (en `EDU.repo`)
- Un docente solo escribe notas, actividades y categorías de **sus** cargas.
- Un estudiante solo escribe entregas/intentos propios y foros firmados por él.
- Nadie cambia su propio rol, centro o `refId`; solo `admin_red` crea o modifica usuarios `admin_red`.
- Calificaciones: el director tiene `editar` (edita con motivo auditado en periodos cerrados) y `cerrar` (cerrar/reabrir periodos).

> **Importante:** todo esto se ejecuta en el navegador. Un backend real debe repetirlo; ver [Seguridad y privacidad](Seguridad-y-privacidad).
