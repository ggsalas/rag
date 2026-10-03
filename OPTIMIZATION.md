# OPTIMIZATION.md — Estado final del pipeline de búsqueda RAG

> **Documento definitivo.** Resume el estado final del pipeline de búsqueda tras la
> campaña de optimización, los defectos encontrados y sus causas raíz, los errores
> de medición que más tiempo costaron, los bugs reportados y su resolución, y las
> limitaciones pendientes. El documento anterior (investigación original con
> conclusiones ahora sabidamente erróneas) ha sido reemplazado por completo.

---

## 1. Estado final y resultados

Medido sobre el corpus real (artículo de Wikipedia en inglés sobre Britney Spears)
con ground truth graduado por fragmentos (`search-benchmark.dataset.v2.ts`), tras
el pipeline completo con cross-encoder:

| Métrica              | Inicio   | Final    | Δ         |
| -------------------- | -------- | -------- | --------- |
| nDCG@10              | 0.3408   | 0.6217   | +82%      |
| Hit@10               | 0.643    | 0.8571   | +33%      |
| FPR                  | 50%      | 0%       | −50 pp    |
| Embeddings truncados | 32%      | 0%       | −32 pp    |
| Chunks basura        | 12.5%    | 0%       | −12.5 pp  |

El baseline partía de 104 chunks (chunking antiguo) con Orama sin stemming ni
stopwords; el estado final usa 166 chunks (chunking nuevo), tokenizer con
stemming y stopwords inglesas, y reranker cross-encoder.

> **Nota sobre el coste del arreglo de enlaces.** Los 0.6217 / 0.8571 finales
> incorporan el arreglo del bug de enlaces Markdown partidos (§8.1), que
> desplazó las fronteras de chunking y causó una ligera bajada en Britney
> (nDCG@10 pasó de 0.6666 a 0.6217, Hit@10 de 0.9286 a 0.8571 — 12/14 en
> lugar de 13/14). QASPER no se movió. La bajada es del arreglo de enlaces,
> no una regresión del pipeline de búsqueda. Queda como duda abierta si es
> ruido de muestra pequeña. Adicionalmente, los 166 chunks finales producen
> contenido que es substring literal del documento en el 100% de los casos
> (168/168 en Britney, 67/67 en QASPER), frente al 70.8% / 67.6% anterior;
> esto resuelve el bug de navegación al chunk incorrecto (§8.2).

---

## 2. Pipeline actual

El pipeline de punta a punta, con los valores reales del código:

### 2.1 Ingestión y chunking

- **Parser**: `@llamaindex/liteparse-wasm` (PDF) → Markdown. TXT/MD se leen directamente.
- **Sanitización**: `remark` (unified) con AST; conserva la estructura Markdown.
- **Chunking** (`src/services/ingest/chunking.service.ts`):
  - `CHUNK_SIZE = 900` caracteres de Markdown.
  - `CHUNK_OVERLAP = 150` caracteres entre chunks consecutivos.
  - **Corte por offsets del AST, no re-serialización.** `chunkMarkdown` usa
    `node.position.start.offset` / `.end.offset` para cortar el texto original
    (`sliceBlock`); ya NO re-escribe el Markdown con `remark-stringify`. El
    texto de cada chunk es substring literal del documento original.
  - Partición por frases (`.`, `!`, `?` seguidos de whitespace); fallback a
    `splitAtWhitespace` para frases demasiado largas (párrafos con muchas citas).
    Los enlaces Markdown `[texto](url)` se tratan como atómicos en
    `splitIntoSentences`, `splitAtWhitespace` y `extractOverlapText`
    (`findLinkSpans` / `isInsideLink` / `tokenizeRespectingLinks`): ningún
    corte puede caer dentro de un enlace.
  - Los nodos `thematicBreak` (`***`, `---`) se descartan en `buildSections`:
    no producen contenido semántico y contaminarían las estadísticas BM25.
  - Los chunks con `searchText` vacío o trivial (`isTrivialSearchText`) se
    descartan: esto elimina los artefactos de parsing que no aportan señal.
  - El overlap se extrae con `extractOverlapText`, recortando hacia atrás hasta
    el límite de frase más cercano dentro de la ventana de 150 caracteres.
  - Cada chunk lleva `sourceStart` y `sourceEnd` (campos opcionales en `Chunk`,
    `src/types/document.ts`): apuntan al **contenido propio** del chunk,
    excluyendo el prefijo de overlap. Permiten navegar al chunk sin búsqueda
    textual (`HighlightedText.findHighlightMatch` los usa como vía primaria).
  - **Resultado:** contenido propio es substring literal del documento en el
    100% de los casos (168/168 en Britney, 67/67 en QASPER), frente al 70.8% /
    67.6% de antes. 171 de 171 chunks tienen offsets.
- **Embeddings**: `Xenova/all-MiniLM-L6-v2` (384 dimensiones, ~90 MB). El texto
  de embedding concatena `sectionPath` + `searchText`; con 900 caracteres de
  Markdown el total queda en ~800–900 caracteres ≈ 200–225 tokens, por debajo
  del límite de 256 tokens de MiniLM.

### 2.2 Índice vectorial (Orama)

- Un índice Orama por biblioteca (`Map<libraryId, OramaDB>`), reconstruido en
  memoria al entrar en la biblioteca.
- Tokenizer configurado en `vector-store.ts`:
  - `language: 'english'`
  - `stemming: true`
  - `stopWords: ENGLISH_STOP_WORDS_ARRAY`
- `threshold: ORAMA_LEXICAL_THRESHOLD = 1.0` (el más laxo: devuelve cualquier
  documento con al menos un token de la query). Con el tokenizer ya filtrando
  stopwords y normalizando morfología, el threshold resulta inocuo: un sweep
  experimental (condiciones D/E/F en `hybrid-benchmark.test.ts`) produjo nDCG@10
  idéntico para valores 0.3, 0.5 y 1.0.
- Pesos híbridos fijos: `DEFAULT_HYBRID_WEIGHTS = { text: 0.25, vector: 0.75 }`.
  Validados por sweep sobre el corpus real como el único punto no dominado en
  nDCG@10 y Recall@50 simultáneamente.

### 2.3 Retrieval

`search.service.ts` ejecuta la siguiente cadena:

1. Embed de la query.
2. `searchHybrid` en Orama con `RERANK_CANDIDATE_POOL = 100` candidatos.
3. Filtro de chunks vacíos (`text` o `searchText` en blanco).
4. Reranker léxico (`src/lib/lexical-ranking.ts`): fórmula
   `rerankScore = originalScore * (1 + 0.15·coverage + 0.20·phraseHit + 0.10·headingHit)`,
   boost máximo 0.45; el score Orama sigue siendo la señal dominante.
5. Trunca a `RERANK_CANDIDATES_CROSS_ENCODER = 40` candidatos.
6. Reranker cross-encoder (`cross-encoder.service.ts`): modelo
   `Xenova/ms-marco-MiniLM-L-6-v2` cuantizado q8 (~23 MB), corriendo en un
   Web Worker dedicado (`src/workers/reranker.worker.ts`) vía Comlink. Carga
   bajo demanda y obligatoria para buscar: si el modelo falla al cargar o al
   puntuar, la búsqueda queda bloqueada (`CrossEncoderNotReadyError`) y la
   UI permite reintentar la carga.
7. Trunca a `DEFAULT_MAX_RESULTS = 10`.
8. **Abstención**: se aplica `RERANKER_ABSTENTION_THRESHOLD = -6.0` sobre
   los logits del cross-encoder. Los logits son
   absolutos (no normalizados). El umbral se calibró originalmente en el corpus
   de Britney (separación perfecta: mínimo positivo 1.12, máximo negativo −7.29),
    pero la validación multi-documento con QASPER reveló solapamiento (ver §6).
   El valor −6.0 retiene todas las respuestas válidas observadas en ambos corpus
   y filtra consultas completamente ajenas al dominio. Si ningún candidato supera
   el umbral, se devuelve lista vacía.

---

## 3. Defectos encontrados y causa raíz

Cada defecto se describe con qué era, cómo se midió y si se corrigió.

### D1 — Scores de Orama relativos

**Qué era**: el score híbrido de Orama se normaliza min-max dentro del result
set; el primer resultado tiene siempre score ≈ 1.0. Esto hacía imposible
calibrar umbrales absolutos: `MIN_ABSOLUTE_SCORE = 0.5` nunca filtraba nada
real porque cualquier resultado lo superaba.

**Cómo se midió**: los cuatro queries negativos devolvían scores 0.75–0.84 y
pasaban el filtro de 0.5 sin problema.

**Corrección**: CORREGIDO vía logits del cross-encoder, que son absolutos y
permiten abstención real con `RERANKER_ABSTENTION_THRESHOLD = -6.0`. El antiguo
`DEFAULT_MIN_SCORE = 75` está marcado como DEPRECATED en `constants.ts`.

### D2 — BM25 sin stopwords ni stemming

**Qué era**: el tokenizer por defecto de Orama no filtraba stopwords ni aplicaba
stemming. Con `threshold` por defecto 1, la query "Who wrote the play Hamlet?"
devolvía 79 de 104 chunks porque el artículo `the` matcheaba casi todo el
corpus.

**Cómo se midió**: conteo de resultados por query negativo; 79/104 para Hamlet.

**Corrección**: CORREGIDO parcialmente con el tokenizer actual (stemming +
stopwords inglesas). El threshold resultó inocuo: el sweep D/E/F produjo
métricas idénticas en 0.3, 0.5 y 1.0, así que se dejó en 1.0 (valor por
defecto de Orama, más predecible).

### D3 — Chunks sobredimensionados

**Qué era**: con el chunking antiguo (`CHUNK_SIZE = 500` caracteres, sin control
de tokens), 33 de 104 chunks (32%) excedían el límite de 256 tokens de MiniLM y
se truncaban en silencio al generar el embedding. El chunk de "Legacy" perdía
~77% de su texto.

**Cómo se midió**: conteo de chunks cuyo `searchText` superaba el equivalente en
caracteres de 256 tokens (~4 chars/token).

**Corrección**: CORREGIDO. `CHUNK_SIZE = 900` con `buildEmbeddingText` que
añade ~100 caracteres de `sectionPath` deja el total en ~800–900 caracteres ≈
200–225 tokens, con margen de seguridad.

### D4 — Overlap inexistente

**Qué era**: `computeOverlap` hacía `break` si un párrafo entero no cabía en el
presupuesto, así que el 80% de los pares consecutivos tenía 0 solape.

**Cómo se midió**: distribución de longitudes de overlap por par de chunks.

**Corrección**: CORREGIDO. `extractOverlapText` toma los últimos 150 caracteres
del chunk anterior y recorta hacia atrás hasta el límite de frase. Media actual
~118 caracteres.

### D5 — Chunks basura

**Qué era**: 13 de 104 chunks (12.5%) eran literalmente `***` (artefacto de
`thematicBreak` del PDF), con `searchText` vacío tras la limpieza Markdown.
Inflaban las estadísticas BM25 porque cualquier token de la query los matcheaba.

**Cómo se midió**: inspección manual de los 104 chunks originales; 13 tenían
`text === '***'` y `searchText === ''`.

**Corrección**: CORREGIDO. `buildSections` descarta nodos `thematicBreak`, y
`isTrivialSearchText` descarta cualquier chunk cuyo searchText no contenga al
menos un carácter alfanumérico.

### D6 — Sin reranker real

**Qué era**: el boost léxico multiplicativo (máximo 1.45×) apenas reordenaba;
no había una señal de relevancia independiente de la de Orama.

**Cómo se midió**: comparación de rankings antes/después del reranker léxico:
cambios mínimos en el top-10.

**Corrección**: CORREGIDO con cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2`
(~23 MB, q8) en worker dedicado.

### D7 — Gate léxico frágil

**Qué era**: `MIN_QUERY_LEXICAL_COVERAGE = 0.5` dejaba pasar "Who wrote Hamlet?"
porque la palabra `wrote` existe en el corpus (cobertura 2/3 de los tokens
significativos).

**Cómo se midió**: cobertura léxica de los queries negativos; Hamlet corto
superaba el umbral.

**Corrección**: CORREGIDO. El cross-encoder da logits negativos fuertes para
queries fuera de corpus. La abstención por `RERANKER_ABSTENTION_THRESHOLD = -6.0`
los filtra. Nota: la calibración original usaba negativos artificiales obvios
("Who wrote Hamlet?") con separación perfecta; la validación multi-documento
con QASPER (§6) reveló que esta separación no generaliza a preguntas plausibles
sin respuesta en el documento.

### D8 — Ground truth por anchors inservible

**Qué era**: el ground truth original se definía por anchors (substrings que
debían aparecer en un chunk). "Baby One More Time" aparecía en 20 de 166
chunks, incluidas infobox y tablas de discografía, así que el benchmark
premiaba devolver una tabla.

**Cómo se midió**: auditoría de cobertura de anchors sobre el corpus: 60 chunks
marcados como relevantes frente a 14 que realmente respondían la pregunta.

**Corrección**: CORREGIDO con `search-benchmark.dataset.v2.ts`, que define
relevancia graduada por fragmentos de texto (`chunkRelevanceGrade`), no por
anchors.

---

## 4. Errores de medición

Esta sección recoge las lecciones aprendidas. Es lo que más tiempo costó de
toda la campaña y lo que más riesgo tiene de repetirse.

### (a) El ground truth por anchors sobre-contaba 4.3×

Marcaba 60 chunks como relevantes frente a 14 reales. "Baby One More Time"
aparece en 20 de 166 chunks, incluidas infobox y tablas de discografía: el
benchmark premiaba devolver una tabla en lugar del párrafo narrativo. La
métrica Hit@k no distinguía entre "el chunk correcto" y "un chunk que contiene
el anchor".

**Lección**: los anchors como ground truth sólo son válidos cuando co-ocurren
en un único chunk temáticamente coherente. Si el anchor aparece en muchos
chunks, el benchmark mide cobertura léxica, no relevancia semántica.

### (b) Corpus sintético auto-referente

Medir con un corpus escrito por quien diseña el test produce confirmaciones
falsas: los anchors co-ocurrían porque el propio texto se había redactado así.
No había independencia entre la definición del benchmark y el contenido que
evaluaba.

**Lección**: el ground truth debe construirse sobre un corpus que no haya sido
escrito para pasar el test. El fixture actual (`britnet-corpus.json`) se
exporta desde la consola del navegador con `__rag.exportCorpus()` a partir de
un PDF real de Wikipedia, no de texto generado ad hoc.

### (c) Semántica de `threshold` en Orama interpretada al revés

- `threshold === 1` (default de Orama): devuelve cualquier documento con al
  menos un token de la query. Es el valor **más laxo**, no el más estricto.
- `threshold === 0`: exige que **todos** los tokens estén presentes; si falta
  uno, devuelve `[]`. Es el valor **más estricto**.
- `0 < threshold < 1`: full matches más una fracción `threshold` de partial
  matches.

Un comentario en el código llegó a decir `threshold: 0 // Return all matches`,
justo lo contrario de la realidad. La semántica está ahora documentada en el
JSDoc de `ORAMA_LEXICAL_THRESHOLD` en `constants.ts`.

**Lección**: nunca asumir la semántica de un parámetro por su nombre; leer la
implementación. Los ejes de tokenizer y threshold están acoplados: sin
stopwords, un threshold sub-1.0 no tiene nada que filtrar.

### (d) Optimizar la rama léxica en aislamiento empeoró el resultado híbrido

La mejora léxica (MRR +18%, falsos positivos −82%) se midió en modo
**sólo-BM25**. Al aplicar los mismos cambios en modo híbrido, Hit@10 cayó de
0.70 a 0.50. La razón: en modo híbrido la rama BM25 también actúa como red de
seguridad del recall del pool fusionado; debilitarla (aunque mejore su
precisión pura) reduce el recall total del pipeline.

**Lección**: los componentes de un pipeline híbrido no son independientes.
Cualquier cambio debe medirse sobre el pipeline completo, no sobre la rama
aislada. Una mejora local puede ser una regressión global.

### (e) Bug de truthiness en Orama

En `node_modules/@orama/orama/dist/browser/methods/search-hybrid.js:87`:

```js
hybridWeights && hybridWeights.text && hybridWeights.vector
```

Si cualquiera de los pesos vale `0`, la condición es falsa y Orama **descarta**
los pesos y usa `0.5/0.5` en silencio. Consecuencia: todas las filas
`text-only` (1/0) y `vector-only` (0/1) de la investigación original medían
en realidad `balanced`, y esto explica la hipótesis 8.5 que quedó abierta en
el documento anterior ("¿por qué los rankings de text-only, balanced y
vector-only son idénticos?").

El bug está documentado en el JSDoc de `DEFAULT_HYBRID_WEIGHTS` y en el
comentario de `vector-store.ts` junto a la llamada a `searchHybrid`.

**Regla**: nunca pasar un peso a 0 a Orama. No produce búsqueda *text-only* ni
*vector-only*; produce *balanced* con los pesos ignorados.

### (f) Medición sólo-léxica para un cambio vectorial

Se llegó a concluir que el nuevo chunking empeoraba los resultados, porque la
métrica de evaluación era sólo-BM25. Al medir con embeddings reales, la rama
vectorial pasó de nDCG@10 0.1605 a 0.4020 y de Hit@10 0.357 a 0.643: el
cambio era una mejora enorme, pero la métrica elegida no podía verlo.

**Lección**: una medición sólo-léxica no puede evaluar un cambio cuyo beneficio
es vectorial. El benchmark debe incluir siempre la rama que el cambio pretende
mejorar, idealmente el pipeline completo.

### (g) Calibración con negativos artificiales produce separación falsa

El umbral de abstención `RERANKER_ABSTENTION_THRESHOLD` se calibró originalmente
con 6 negativos artificiales y obvios ("Who wrote Hamlet?", "What is the capital
of France?") sobre el corpus de Britney. Esos negativos produjeron logits entre
−11.06 y −7.29, mientras las 14 positivas dieron logits entre 1.12 y 9.47: una
separación perfecta con hueco de 8.41 puntos. El umbral 0.0 parecía seguro.

La validación multi-documento con QASPER (§6) reveló que esa separación era
artefacto de la elección de negativos. Con 3 preguntas `unanswerable` reales
(del propio dataset QASPER, donde los anotadores marcaron explícitamente que la
pregunta no tenía respuesta en el paper), los logits fueron −5.72, −4.71 y 0.81.
El hueco desapareció: la positiva más baja dio −5.46, la unanswerable más alta
dio 0.81. Con umbral 0.0 se ocultaban 4 de 16 respuestas correctas y aun así
pasaban 2 de 3 unanswerable. Fallaba en ambas direcciones.

Es una variante del error (b) — corpus sintético auto-referente — pero en el
eje de los negativos en vez del corpus. Calibrar con negativos que *sabemos* que
no tienen respuesta (preguntas sobre temas completamente ajenos al documento)
produce una distribución de logits que no representa los negativos reales:
preguntas bien formadas y plausibles cuya respuesta simplemente no está en el
corpus.

**Lección**: los negativos de calibración deben ser plausibles y del mismo
dominio que el corpus. Preguntas del estilo "Who wrote Hamlet?" contra un
artículo sobre Britney Spears miden la capacidad del cross-encoder de rechazar
temas ajenos, no su capacidad de abstenerse ante preguntas sin respuesta. Para
calibrar umbrales de abstención se necesitan negativos del tipo: preguntas que
un usuario real podría hacer sobre el documento, pero cuya respuesta no está en
él. QASPER proporciona estos negativos de forma natural (anotadores que marcan
`unanswerable: true`).

### ★ (h) Verificaciones vacuas — el patrón que más tiempo costó

**Antes de confiar en una verificación, comprueba que falla cuando debe
fallar.** Si una comprobación no es capaz de detectar el error que pretende
capturar, no está comprobando nada; sólo da una falsa sensación de seguridad.
Este patrón se repitió en al menos cinco contextos distintos y fue, en
conjunto, lo que más tiempo consumió durante toda la investigación:

1. **`npx tsc --noEmit` no comprobaba nada.** El `tsconfig.json` raíz es de
   tipo solución (`"files": []` + `references`), así que sin `--build` tsc
   procesa cero ficheros y sale con código 0. Se dio por bueno "tsc limpio"
   durante toda la sesión. El comando canónico es ahora `npm run typecheck`
   (`tsc -b --force`), documentado en `AGENTS.md`.

2. **El test de integridad de enlaces Markdown no detectaba enlaces rotos.**
   Sus regex sólo contaban `[` cuando iba seguido de `](` — es decir, sólo
   enlaces bien formados —, así que ante un enlace roto los contadores daban 0
   y la comprobación se saltaba. Además, su caso de prueba nunca llegaba a
   partir la frase con el enlace (ver §8.1).

3. **La medición de overlap del banco híbrido comparaba carácter a carácter
   dos trozos de longitud fija**, así que sólo detectaba solapes de
   exactamente 200 caracteres: informaba 0 cuando el overlap real era de 118
   de media.

4. **La calibración de abstención con negativos artificiales y obvios**
   producía una separación de logits falsa que no generalizaba a negativos
   plausibles del mismo dominio (ver §4(g) y §6.3).

5. **El corpus sintético escrito por quien diseñaba el test confirmaba la
   hipótesis por construcción** (ver §4(b)). No había independencia entre la
   definición del benchmark y el contenido que evaluaba.

**Regla general**: antes de confiar en una verificación, comprueba que falla
cuando debe fallar. Inyecta un error conocido y verifica que la comprobación
lo detecta. Si no lo detecta, la comprobación es vacua y no aporta ninguna
garantía.

---

## 5. Cómo reproducir

### 5.1 Fixture del corpus

Desde la consola del navegador (en modo dev):

```js
// Listar bibliotecas para obtener el ID
await __rag.listLibraries()

// Exportar el corpus completo (con embeddings) como JSON
await __rag.exportCorpus('<libraryId>')

// O sin embeddings, para un fixture más ligero
await __rag.exportCorpus('<libraryId>', { includeEmbeddings: false })
```

El navegador descarga un archivo `rag-corpus-<libraryId>-<YYYY-MM-DD>.json`.
Depositadlo en `src/dev/fixtures/` para que los benchmarks lo
encuentren (el fixture actual es `britnet-corpus.json`).

La implementación está en `src/dev-tools.ts` (sólo se carga cuando
`import.meta.env.DEV` es true) y delega la exportación en
`src/dev/corpus/corpus-export.service.ts`.

### 5.2 Benchmarks

Todos los benchmarks están gateados por variable de entorno para que
`npx vitest run` siga siendo rápido en CI. Los embeddings y los logits del
cross-encoder se cachean en disco bajo
`src/dev/fixtures/.embedding-cache/`.

```bash
# Benchmark híbrido: seis condiciones (A–F) sobre el mismo corpus,
# con ground truth graduado por fragmentos.
HYBRID_BENCHMARK=1 npx vitest run src/dev/benchmarks/search/hybrid-benchmark.test.ts

# Benchmark del cross-encoder: nDCG@10 y Hit@10 antes/después de reranking,
# y distribución de logits para calibrar la abstención.
CROSS_ENCODER_BENCHMARK=1 npx vitest run src/dev/benchmarks/search/cross-encoder-benchmark.test.ts

# Diagnóstico del caso first-album: top-20 chunks por logit del cross-encoder.
FIRST_ALBUM_DIAGNOSTIC=1 npx vitest run src/dev/benchmarks/search/first-album-diagnostic.test.ts
```

Archivos relevantes:

| Archivo                                                       | Rol                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `src/dev/benchmarks/search/hybrid-benchmark.test.ts`                | Benchmark híbrido con embeddings reales               |
| `src/dev/benchmarks/search/cross-encoder-benchmark.test.ts`         | Benchmark del cross-encoder                           |
| `src/dev/benchmarks/search/first-album-diagnostic.test.ts`          | Diagnóstico del caso `first-album`                    |
| `src/dev/benchmarks/search/search-benchmark.dataset.v2.ts`          | Ground truth graduado por fragmentos                  |
| `src/dev/benchmarks/search/search-benchmark.ndcg.ts`                | Implementación de nDCG@k, Hit@k y Recall@k graduados  |
| `src/dev/benchmarks/search/search-benchmark.relevance.ts`           | Cálculo de `chunkRelevanceGrade` y `relevanceVector`  |
| `src/dev/fixtures/britnet-corpus.json`        | Fixture del corpus de Britney Spears                  |
| `src/dev/fixtures/.embedding-cache/`          | Caché de embeddings y logits                          |

---

## 6. Validación multi-documento (QASPER)

Para verificar que las conclusiones del pipeline generalizan más allá del corpus
de Britney Spears, se ejecutó el benchmark completo sobre dos papers académicos
del dataset QASPER (Dasigi et al. 2021, CC BY 4.0), cargados en una única
librería para probar retrieval multi-documento con distractores cruzados.

### 6.1 Setup

- **Papers**: `1910.11471` (Machine Translation from NL to Code, 13 secciones,
  12.3k chars) y `1908.06606` (QA based Clinical Text Structuring, 19 secciones,
  25.6k chars).
- **Chunks**: 68 totales (24 + 44) vía `chunkMarkdown` con `CHUNK_SIZE=900`,
  `CHUNK_OVERLAP=150`.
- **Ground truth**: 16 preguntas positivas (con `highlighted_evidence` de
  anotadores QASPER, grado 2) y 3 `unanswerable` (todos los anotadores marcaron
  `unanswerable: true`). Se descartaron evidencias `FLOAT SELECTED` (referencias
  a tablas/figuras) y se eliminaron duplicados entre anotadores.
- **Pipeline**: idéntico al de producción — búsqueda híbrida (pesos 0.25/0.75),
  cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` (q8).

### 6.2 Métricas

| Métrica   | Britney | QASPER | Δ      |
| --------- | ------- | ------ | ------ |
| nDCG@10   | 0.6217  | 0.5017 | −19%   |
| Hit@10    | 0.8571  | 0.6875 | −20%   |
| Recall@10 | —       | 0.6875 | —      |

La caída es esperable por tres razones:

1. **Prosa técnica**: los papers contienen jerga de dominio (NLP, clinical text)
   que el cross-encoder (entrenado en MS-MARCO, búsqueda web general) no maneja
   tan bien como la prosa enciclopédica de Wikipedia.
2. **Dos documentos compitiendo**: con 68 chunks de dos papers distintos, el
   retrieval debe distinguir no sólo entre chunks relevantes e irrelevantes,
   sino entre chunks de paper A vs paper B para preguntas específicas de cada
   uno. Esto introduce distractores cruzados que no existen en el corpus
   single-document de Britney.
3. **Fragmentos largos**: 5 de 16 casos positivos tuvieron nDCG@10 = 0 porque
   el fragmento de evidencia (longitud media 300 chars, máximo 617 chars)
   excedía el tamaño de chunk o caía en un chunk que el cross-encoder puntuó
   bajo (logits −3.40 a −10.76 sobre el chunk correcto). Es un límite del
   chunking + cross-encoder, no del ground truth.

### 6.3 Invalidación del umbral de abstención

La calibración original del umbral se hizo sobre el corpus de Britney con 6
negativos artificiales obvios ("Who wrote Hamlet?", "What is the capital of
France?"). Esos negativos dieron logits entre −11.06 y −7.29, mientras las 14
positivas dieron logits entre 1.12 y 9.47: separación perfecta con hueco de
8.41 puntos. El umbral 0.0 parecía seguro.

Con QASPER, la distribución fue:

- **Positivas (16)**: min −5.46, max 7.78, mediana 3.72
- **Unanswerable (3)**: min −5.72, max 0.81, mediana −4.71

El hueco desapareció: −6.27 (solapamiento). Con umbral 0.0 se ocultaban 4 de
16 respuestas correctas (FNR 25%) y aun así pasaban 2 de 3 unanswerable (FPR
67%). Fallaba en ambas direcciones.

### 6.4 Nuevo umbral: −6.0

El valor −6.0 se eligió porque:

- Está por debajo de toda positiva observada en ambos corpus (Britney min 1.12,
  QASPER min −5.46), así que **no oculta respuestas válidas**.
- Sigue filtrando los 6 negativos artificiales de Britney (max −7.29).
- Proporciona 0.54 puntos de margen bajo la positiva más débil observada
  (−5.46).

**No se eligió −5.46 ni −5.5**, pese a que puntuarían marginalmente mejor en
los datos actuales. El margen entre la positiva más baja (−5.46) y la
unanswerable más baja (−5.72) es de sólo 0.26 puntos sobre una muestra de 16
positivas y 3 negativas. Afinar el umbral a ese nivel sería repetir el mismo
sobreajuste que esta validación acaba de destapar: calibrar contra ruido
estadístico de una muestra pequeña.

### 6.5 Negativas cruzadas

Además de las 3 `unanswerable`, se midió la protección del umbral frente a la
**confusión entre documentos**: preguntas del paper A evaluadas contra un índice
que contiene sólo el paper B, y viceversa (16 casos).

- **Distribución de logits**: min −11.06, max −2.06, mediana −7.63.
- Con el umbral −6.0, **13 de 16 (81%) quedan correctamente filtradas**.
- Las 3 que pasan tienen logits −2.06, −2.42 y −3.95, y caen dentro del rango
  de las positivas (−5.46 a 7.78).

**Conclusión**: el umbral ofrece protección parcial y útil frente a la confusión
entre documentos, pero no puede distinguir de forma fiable entre "la respuesta
está en este documento", "la respuesta está en otro documento de la librería" y
"no hay respuesta". Este resultado **refuerza** la decisión de mantener la
abstención en −6.0: filtra el 81% de las cruzadas sin ocultar ninguna respuesta
válida (16/16 positivas de QASPER y 14/14 de Britney se retienen).

### 6.6 Limitación asumida

El umbral −6.0 detecta consultas con **ninguna relación** con el corpus
(preguntas completamente ajenas al dominio). **No detecta de forma fiable
preguntas plausibles sin respuesta en el documento**. Las 3 unanswerable de
QASPER dieron logits −5.72, −4.71 y 0.81: todas por encima de −6.0, así que
el pipeline devuelve resultados (incorrectos) para ellas.

Este es un problema abierto. Requiere un mecanismo distinto: clasificación de
answerability, calibración de confianza del cross-encoder, o detección de
alucinación post-retrieval. El umbral actual es una defensa contra consultas
completamente fuera de dominio, no contra preguntas sin respuesta.

### 6.7 Coste de la ruta de texto plano (.txt)

Los `.txt` se trocean con `chunkText` en lugar de `chunkMarkdown` (ver §7), así
que se midió el coste de esa ruta sobre el mismo contenido de QASPER, con las
mismas 16 preguntas positivas:

| Ruta                                    | nDCG@10 | Hit@10 |
| --------------------------------------- | ------- | ------ |
| Markdown (con `sectionPath`)            | 0.5017  | 0.6875 |
| Texto plano (sin `sectionPath`)         | 0.4659  | 0.6875 |
| Δ                                       | −0.0359 | 0      |

La diferencia es **−0.0359 en nDCG@10 (−3,6 puntos), 0 en Hit@10**.

**Conclusión**: degradación menor. Perder el contexto de sección cuesta
precisión en la ORDENACIÓN pero no afecta a si el chunk relevante se encuentra
o no. Los `.txt` conservan el recall y pierden algo de ranking.

### 6.8 Reproducir

```bash
QASPER_BENCHMARK=1 npx vitest run src/dev/benchmarks/search/qasper-benchmark.test.ts --reporter=verbose
```

Archivos relevantes:

| Archivo                                                       | Rol                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `src/dev/benchmarks/search/qasper-benchmark.test.ts`                | Benchmark multi-documento con QASPER                  |
| `src/dev/benchmarks/search/search-benchmark.dataset.qasper.ts`      | Ground truth QASPER (16 positivas, 3 unanswerable)    |
| `src/dev/benchmarks/search/search-benchmark.qasper.sanity.test.ts`  | Sanity test: fragmentos presentes en Markdown         |
| `src/dev/fixtures/qasper-1910_11471.md`       | Paper 1 (ML from NL to Code)                          |
| `src/dev/fixtures/qasper-1908_06606.md`       | Paper 2 (QA based Clinical Text Structuring)          |
| `src/dev/fixtures/README.md`                  | Atribución QASPER (CC BY 4.0, Dasigi et al. 2021)     |
| `src/dev/fixtures/.qasper-cache/`             | Caché de embeddings y logits QASPER                   |

---

## 7. Limitaciones y trabajo pendiente

- **Validación limitada a dos dominios**. El pipeline está validado sobre el
  artículo de Britney Spears (prosa enciclopédica, single-document) y dos papers
  académicos de QASPER (prosa técnica, multi-documento). La caída de nDCG@10 de
  0.6666 a 0.5017 (§6) muestra que el pipeline generaliza pero con pérdida de
  calidad en dominios técnicos. Falta validar sobre más documentos y dominios
  (legal, financiero, código) antes de confiar plenamente en los números.

- **`first-album` sigue fallando**. El cross-encoder coloca primero (logit
  7.66) un chunk sobre *"Her third studio album, Britney, was released in
  November 2001"* para la pregunta sobre el **primer** álbum; el chunk
  correcto queda en el puesto 18 con logit 2.51. Es un fallo del modelo, no
  del ground truth ni del pipeline. El diagnóstico completo está en
  `first-album-diagnostic.test.ts`.

- **Sin cross-encoder cargado, la búsqueda queda bloqueada**. La UI muestra el
  error y permite reintentar la carga.

- **Los tests no cubren las rutas de React Router.** El fallo de importación
  que rompió la app no lo detectó ni la suite ni el typecheck de entonces.
  `npm run build` es la verificación que lo habría detectado, ya que empaqueta
  todas las rutas y falla si algún import está roto.

- **Se eliminaron el control de `minScore` de la interfaz y la página
  `dev/benchmark`.** El control de `minScore` estaba muerto desde la Fase 3:
  `search()` en `src/services/search/search.service.ts` acepta 4 parámetros
  (`query`, `libraryId`, `maxResults?`, `weights?`) y se le pasaban 5, así que
  el valor se ignoraba. La página `dev/benchmark` importaba experimentos ya
  borrados; los bancos offline (`hybrid-benchmark.test.ts`,
  `cross-encoder-benchmark.test.ts`, etc.) la sustituyen con ventaja.

---

## 8. Bugs reportados por el usuario

### 8.1 Enlaces Markdown partidos — CORREGIDO

**Síntoma**: el corte de chunk podía caer dentro de `[texto](url)` y entonces
fallaba la limpieza de enlaces en `searchText`.

**Causa raíz**: `splitIntoSentences` usaba `split(/(?<=[.!?])\s+/)`, que
partía tras cualquier punto seguido de espacio, **incluidos los puntos dentro
del texto de un enlace**. Caso real del corpus:
`[...her 21st-century bestseller. After starring](https://...)` se cortaba en
"besteller.".

**Corrección**: `findLinkSpans` / `isInsideLink` / `tokenizeRespectingLinks`
hacen atómicos los tramos `[texto](url)` en `splitIntoSentences`,
`splitAtWhitespace` y `extractOverlapText`. El regex
(`MARKDOWN_LINK_REGEX`) pasó a detectar 180 enlaces (antes 146) al soportar
corchetes escapados tipo `\[196\]`.

**Impacto**: de **57 chunks rotos sobre 166 (34%) a 0**.

**Nota importante**: este bug lo introdujo la propia Fase 2. La política
anterior de "no partir nunca un bloque" lo hacía imposible; los 104 chunks
originales del usuario tenían cero enlaces rotos.

**Coste en métricas**: Britney nDCG@10 0.6666 → 0.6217 y Hit@10 0.9286 →
0.8571 (12/14 en lugar de 13/14) por el desplazamiento de fronteras. QASPER
no se movió. Queda como duda abierta si es ruido de muestra pequeña.

**El test no lo detectaba.** El test
`never breaks Markdown link syntax when splitting oversized paragraphs`
(`src/services/ingest/chunking.service.test.ts`) usaba regex que sólo contaban
`[` cuando iba seguido de `](` — sólo enlaces bien formados —, así que ante
un enlace roto los contadores daban 0 y la comprobación se saltaba. Además,
su caso de prueba construía una frase final corta que nunca llegaba a partir
la frase con el enlace.

### 8.2 Navegación a chunk incorrecto — CORREGIDO

**Síntoma**: al pulsar un resultado de búsqueda no siempre se abría el chunk
correcto en el documento.

**Causa raíz**: el visor localizaba el chunk **buscando su texto** en el
documento (`HighlightedText.findChunkInText`), pero `chunk.text` era una
**re-escritura** de remark, no el texto original. La opción `emphasis: '_'`
convertía cada `*cursiva*` del documento en `_cursiva_`, de modo que el chunk
dejaba de existir en el documento y la cascada de heurísticas acababa en la
posición equivocada. Medido: sólo el 70.8% de los chunks eran substring
literal del documento.

**Corrección**: cortar por offsets (ver §2.1) y navegar con
`text.slice(sourceStart, sourceEnd)` en
`HighlightedText.findHighlightMatch`, sin búsquedas. La búsqueda por texto
(`findChunkInText`) se conserva como fallback para librerías indexadas antes
del cambio, cuyos chunks no tienen offsets.

**Coste en métricas**: **cero**. Britney y QASPER idénticas antes y después,
porque lo que se indexa es `searchText`, que ya venía sin sintaxis Markdown.

---

## 9. Ficheros relevantes

### Producción

| Fichero                                                       | Rol                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `src/lib/constants.ts`                                        | Constantes globales del pipeline                          |
| `src/services/ingest/chunking.service.ts`                     | Chunking Markdown con AST, overlap y descarte de basura   |
| `src/services/search/search.service.ts`                       | Pipeline de búsqueda de producción                        |
| `src/lib/lexical-ranking.ts`                                  | Reranker léxico y `RERANK_CANDIDATE_POOL = 100`           |
| `src/services/search/cross-encoder.service.ts`                | Servicio del cross-encoder (obligatorio para buscar)      |
| `src/services/embedding/vector-store.ts`                      | Índice Orama por biblioteca, búsqueda híbrida             |
| `src/services/embedding/embedding.service.ts`                 | Carga del modelo de embeddings                            |
| `src/workers/reranker.worker.ts`                              | Worker del cross-encoder vía Comlink                      |
| `src/dev-tools.ts`                                            | `__rag.listLibraries()` / `__rag.exportCorpus()`          |

### Benchmark y diagnóstico (no producción)

| Fichero                                                       | Rol                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| `src/dev/benchmarks/search/hybrid-benchmark.test.ts`                | Benchmark híbrido con embeddings reales                   |
| `src/dev/benchmarks/search/cross-encoder-benchmark.test.ts`         | Benchmark del cross-encoder                               |
| `src/dev/benchmarks/search/first-album-diagnostic.test.ts`          | Diagnóstico del caso `first-album`                        |
| `src/dev/benchmarks/search/search-benchmark.dataset.v2.ts`          | Ground truth graduado por fragmentos                      |
| `src/dev/benchmarks/search/search-benchmark.ndcg.ts`                | nDCG@k, Hit@k, Recall@k graduados                         |
| `src/dev/benchmarks/search/search-benchmark.relevance.ts`           | Grados de relevancia por chunk                            |
| `src/dev/fixtures/britnet-corpus.json`        | Fixture del corpus                                        |
| `src/dev/fixtures/.embedding-cache/`          | Caché de embeddings y logits                              |

### Tests

Los tests unitarios deben pasar limpios con la configuración actual:

```bash
npx vitest run
npm run typecheck   # → tsc -b --force (NO usar `tsc --noEmit`: no comprueba nada, ver §4(h))
```

Los tests cubren chunking, reranking, evaluación, abstención, corpus coverage,
cross-encoder, y los servicios de búsqueda. Si algún test falla, es señal de
que un cambio posterior rompió una invariante documentada aquí.
