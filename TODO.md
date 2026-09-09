# Roadmap de mejora RAG

Hoja de ruta acordada para mejorar la calidad de búsqueda y de las respuestas IA. Se valida de forma incremental: cada paso se comprueba con PDFs reales antes de pasar al siguiente (ver [Validación](#criterios-de-aceptaci%C3%B3n-y-validaci%C3%B3n)).

## Paso activo: refinar el chunking

**No es la implementación inicial del chunking** (ya existe chunking contextual en `src/services/ingest/chunking.service.ts`). El objetivo es refinarlo:

- [x] Un párrafo completo por chunk siempre que sea posible.
- [x] Preservar el contexto de sección completo en cada chunk.
- [x] Nunca partir enlaces Markdown entre chunks.
- [x] Nunca partir oraciones entre chunks.

**Validación:** el chunking refinado se probó con PDFs reales y fue aceptado por el usuario.

**Política para casos límite:** si un párrafo u oración supera el tamaño objetivo del chunk, se acepta un chunk sobredimensionado. **Nunca** se corta una oración o un enlace por ajustar al tamaño.

## Criterios de aceptación y validación

- Aceptación de un chunk: párrafos y oraciones íntegros, enlaces Markdown sin partir, contexto de sección preservado, y ningún corte artificial por tamaño.
- Flujo de validación: tras **cada paso**, el usuario prueba la ingestión y búsqueda con **PDFs reales** antes de continuar.

## Completado

- [x] Limpieza de la ingestión de PDF/Markdown.
- [x] Filtrado de sidebars / bloques de maquetación malformados.
- [x] Filtrado de secciones boilerplate.
- [x] Doble representación por chunk: `text` (visualización) / `searchText` (búsqueda).
- [x] Metadatos de sección por chunk.
- [x] Chunking contextual inicial.
- [x] Inspector de chunks.
- [x] Salvaguardas IA/WebGPU: contexto del LLM acotado usando `searchText`, y manejo para el usuario de errores de GPU y de ventana de contexto.

## Próximos pasos

- [ ] **Presets de búsqueda**: `balanced` (50/50) y `semantic` (10/90), más mejoras en el score floor.
- [ ] **Mejoras de prompting** en el modo de respuesta IA.
- [ ] Evaluar **HyDE + RRF** (solo después de los dos anteriores).

## Aplazado (deferred)

- Cambio de modelo de embeddings (estrategia 6).
- Reindexación explícita (estrategia 11).
- Estrategias 12–14.

> **Nota sobre la numeración de estrategias:** es ambigua en el documento de origen — prompting es la estrategia **10** y HyDE/RRF la **9**. El orden planificado no sigue la numeración: **presets → prompting → HyDE/RRF**.
