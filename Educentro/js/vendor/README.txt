SheetJS Community Edition (xlsx) 0.18.5 - Apache-2.0 (ver xlsx.LICENSE.txt). Origen: paquete npm "xlsx@0.18.5" (ultima version publicada en npm).
Se usa solo en el navegador, 100% local, para leer/escribir .xlsx; nunca se evalua contenido del archivo.

AVISO DE SEGURIDAD: 0.18.5 tiene CVE-2023-30533 (contaminacion de prototipos, corregido en 0.19.3) y CVE-2024-22363 (ReDoS, corregido en 0.20.2). No se pudo obtener >= 0.20.3
(https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz bloqueado por la red del entorno: no se evadio). Mitigaciones en js/core/planilla.js; ver docs/SEGURIDAD.md.
Para actualizar: descargar xlsx-0.20.3.tgz, extraer package/dist/xlsx.full.min.js a este directorio y ejecutar tests/planilla.test.html.
