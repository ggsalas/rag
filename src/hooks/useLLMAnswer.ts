import { useState, useCallback, useRef } from 'react'
import { useAppStore } from '@/store/app.store'
import { initLLMModel, generateAnswer, abortLLMGeneration } from '@/services/llm/llm.service'
import type { LLMCitation } from '@/services/llm/llm.service'
import type { SearchResult } from '@/types/search'

const AI_MODE_KEY = 'rag:ai-mode'

interface LLMAnswerInit {
  answer?: string
  citations?: LLMCitation[]
  answeredQuery?: string
}

/** Hook that manages AI answer mode — model loading, generation, and streaming state */
export function useLLMAnswer(init: LLMAnswerInit = {}) {
  const [isAiMode, setIsAiMode] = useState(() => localStorage.getItem(AI_MODE_KEY) === 'true')
  const [answer, setAnswer] = useState(init.answer ?? '')
  const [citations, setCitations] = useState<LLMCitation[]>(init.citations ?? [])
  const [answeredQuery, setAnsweredQuery] = useState(init.answeredQuery ?? '')
  const [isGenerating, setIsGenerating] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const genIdRef = useRef(0)

  const llmStatus = useAppStore((s) => s.llmStatus)
  const llmProgress = useAppStore((s) => s.llmProgress)
  const setLlmStatus = useAppStore((s) => s.setLlmStatus)
  const setLlmProgress = useAppStore((s) => s.setLlmProgress)

  const loadModel = useCallback(async () => {
    if (llmStatus === 'ready' || llmStatus === 'loading') return
    setLoadError(null)
    setLlmStatus('loading')
    setLlmProgress(0)
    try {
      await initLLMModel((progress, _text) => {
        setLlmProgress(Math.round(progress * 100))
      })
      setLlmStatus('ready')
    } catch (err) {
      console.error('Failed to load LLM:', err)
      setLoadError(err instanceof Error ? err.message : 'Failed to load AI model')
      setLlmStatus('error')
    }
  }, [llmStatus, setLlmStatus, setLlmProgress])

  const toggleAiMode = useCallback(() => {
    const next = !isAiMode
    setIsAiMode(next)
    localStorage.setItem(AI_MODE_KEY, String(next))
    if (next) loadModel()
  }, [isAiMode, loadModel])

  const generate = useCallback(
    async (query: string, results: SearchResult[], maxTokens?: number) => {
      if (!query.trim() || results.length === 0) {
        setAnswer('')
        setCitations([])
        setAnsweredQuery('')
        return
      }

      // Abort any in-progress generation. abortLLMGeneration() is a no-op when idle
      // (guarded by isRunning in the service), so this is always safe to call.
      abortLLMGeneration()

      const id = ++genIdRef.current
      setIsGenerating(true)
      setAnswer('')
      setCitations([])
      setAnsweredQuery(query)
      setLlmError(null)

      try {
        const foundCitations = await generateAnswer(
          query,
          results,
          (token, done) => {
            if (id !== genIdRef.current) return
            if (!done && token) setAnswer((prev) => prev + token)
          },
          maxTokens,
        )
        if (id === genIdRef.current) setCitations(foundCitations)
      } catch (err) {
        if (id === genIdRef.current) {
          setLlmError(err instanceof Error ? err.message : 'Generation failed')
        }
      } finally {
        if (id === genIdRef.current) setIsGenerating(false)
      }
    },
    [],
  )

  const clear = useCallback(() => {
    genIdRef.current++
    abortLLMGeneration()
    setAnswer('')
    setCitations([])
    setAnsweredQuery('')
    setIsGenerating(false)
    setLlmError(null)
  }, [])

  return {
    isAiMode,
    toggleAiMode,
    answer,
    citations,
    answeredQuery,
    isGenerating,
    llmStatus,
    llmProgress,
    llmError,
    loadError,
    generate,
    clear,
    loadModel,
  }
}
