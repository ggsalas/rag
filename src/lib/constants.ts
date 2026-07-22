export const CHUNK_SIZE = 500
export const CHUNK_OVERLAP = 100
export const DEFAULT_MAX_RESULTS = 10
export const DEFAULT_MIN_SCORE = 70
export const DEFAULT_HYBRID_WEIGHTS = { text: 0.5, vector: 0.5 }
export const EMBEDDING_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
/** User-facing embedding model name and approximate download size (shown in the loading toast). */
export const EMBEDDING_MODEL_DISPLAY_NAME = 'MiniLM-L6-v2'
export const EMBEDDING_MODEL_DOWNLOAD_SIZE = '~90 MB'
export const EMBEDDING_DIMENSIONS = 384

export const LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
/** User-facing model name and approximate download size (shown in the enable dialog / toast). */
export const LLM_MODEL_NAME = 'Llama 3.2 1B'
export const LLM_MODEL_DOWNLOAD_SIZE = '~880 MB'
export const LLM_CONTEXT_CHUNKS = 10
export const LLM_MAX_TOKENS = 512
