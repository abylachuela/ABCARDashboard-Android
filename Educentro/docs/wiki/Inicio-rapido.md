# Inicio rápido

## Abrir la app
No requiere servidor ni instalación: abre `Educentro/index.html` en el navegador (doble clic o `file:///.../Educentro/index.html`). Funciona por `file://` porque no usa ES modules. Las fuentes (Fraunces e Inter) se piden a Google Fonts; sin red se usan fuentes del sistema.

## Usuarios demo
La pantalla de ingreso lista usuarios de ejemplo agrupados por rol (no hay contraseña: es un selector). Con la semilla v4 existen tres centros ficticios:

| Centro | Nivel | Modelo de calificación |
|---|---|---|
| `cen_1` Liceo Experimental Cibao | Secundario (2.º, 4.º, 5.º) | Ponderado |
| `cen_2` Centro Educativo Los Prados | Primario (4.º, 6.º) | Ponderado |
| `cen_3` Liceo Politécnico Demo (competencias) | 6.º de Secundaria | Por competencias |

Identificadores estables de usuarios: `usr_admin` (admin de red), `usr_dir_1`/`_2`/`_3` (director), `usr_sec_1`… (secretaría), `usr_doc_1_01`… (docentes), `usr_tut_1`… (tutor), `usr_est_1`… (estudiante). Los nombres mostrados son inventados por la semilla.

Sugerencias:
- Ver el modelo ponderado: entra como un docente de `cen_1` y abre **Calificaciones**.
- Ver el modelo por competencias: docente o director de `cen_3`.
- Probar el importador: director de `cen_3`, ruta `#/importar-planilla`.
- Ver todo el sistema: `usr_admin` con "Todos los centros (red)".

## Restablecer datos demo
Botón **Restablecer datos demo** en la pantalla de ingreso y en la barra lateral: borra todo y vuelve a sembrar (cierra la sesión). La semilla se vuelve a generar sola cuando cambia su versión (hoy 4). Solo `admin_red` puede restablecer desde el módulo Respaldo.

## Pruebas
Abre `tests/calculo.test.html` y `tests/planilla.test.html` en el navegador: el título de la pestaña dice `PASS` o `FAIL`. Detalle en [Pruebas](Pruebas).

## Dónde se guardan los datos
En `localStorage` bajo claves `edu:v1:col:<coleccion>`; la sesión en `edu:sesion`. Borrar los datos del sitio equivale a restablecer. Para llevarse los datos: módulo **Respaldo** (JSON).

Siguiente: [Arquitectura](Arquitectura).
