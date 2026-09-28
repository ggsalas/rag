# Roadmap de mejora RAG

La búsqueda actual ya fue validada con el corpus de Britney y dos papers QASPER. Las métricas y limitaciones detalladas están en `OPTIMIZATION.md`.

## Estado actual

- [x] Chunking contextual con límite de tokens, overlap y enlaces Markdown atómicos.
- [x] Texto original preservado mediante offsets `sourceStart`/`sourceEnd`.
- [x] Navegación exacta al chunk desde los resultados.
- [x] Embeddings sin truncación silenciosa en los chunks producidos.
- [x] Recuperación híbrida con pesos fijos `text: 0.25`, `vector: 0.75`.
- [x] Cross-encoder bajo demanda con degradación elegante.
- [x] Abstención conservadora con umbral de logit `-6.0`.
- [x] Ground truth reproducible y benchmarks offline bajo `src/dev/`.
- [x] Validación con Britney y QASPER.

## Próximos pasos

- [ ] Validar con más documentos Markdown y DOCX representativos.
- [ ] Mejorar la abstención para preguntas plausibles sin respuesta.
- [ ] Investigar el caso `first-album` del benchmark.
- [ ] Evaluar mejoras de prompting en modo IA.
- [ ] Considerar soporte multilingüe, empezando por español.

## Limitaciones conocidas

- La abstención no distingue de forma fiable preguntas plausibles sin respuesta.
- La validación sigue limitada a pocos corpus.
- Los DOCX pierden contexto de sección y muestran una pequeña caída de ranking.
- Los benchmarks pesados requieren ejecutar sus variables de entorno específicas.

## Verificación

Usar siempre:

```bash
npm run typecheck
npx vitest run
npm run build
```
