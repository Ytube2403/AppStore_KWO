import OpenAI from 'openai'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { markJobCompleted, markJobFailed, updateJobProgress } from '../lib/jobQueue'
import type { AnalysisJob, TranslationPayload } from '../types'

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY is required in environment')
}

// OpenRouter có API tương thích OpenAI — dùng openai package
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    'HTTP-Referer': 'https://aso-keyword-optimization.app',
    'X-Title': 'ASO Keyword Optimization',
  },
})

const MODEL = 'minimax/minimax-m2.5:free'

// MiniMax M2.5 free — dùng concurrency thấp để an toàn
const CHUNK_SIZE = 100        // keywords per call (giảm để đảm bảo JSON chính xác)
const CONCURRENCY = 3         // concurrent calls
const INTER_BATCH_DELAY = 2000 // ms giữa các batch

interface KeywordRow {
  id: string
  keyword: string
  keyword_en: string | null
}

/**
 * Dịch một batch keywords qua OpenRouter MiniMax M2.5.
 */
async function translateChunk(
  chunk: KeywordRow[],
): Promise<{ id: string; keyword_en: string }[]> {
  const payload = chunk.map((kw) => ({ id: kw.id, keyword: kw.keyword }))

  const prompt = `You are an expert translator specializing in App Store Optimization (ASO) for mobile apps and games.
Translate the following keywords into English.
Return ONLY a valid JSON object matching this schema:
{ "translations": [ { "id": "string", "keyword_en": "string" } ] }

Input Keywords:
${JSON.stringify(payload)}`

  const response = await openrouter.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  })

  const text = response.choices[0]?.message?.content
  if (!text) return []

  try {
    const parsed = JSON.parse(text)
    if (!parsed || !Array.isArray(parsed.translations)) return []
    return parsed.translations.filter(
      (item: any) => item.id && typeof item.keyword_en === 'string',
    ) as { id: string; keyword_en: string }[]
  } catch {
    logger.warn('Failed to parse LLM JSON response', { preview: text.slice(0, 200) })
    return []
  }
}

/**
 * Lưu translations vào Supabase theo lô song song.
 */
async function saveTranslations(updates: { id: string; keyword_en: string }[]): Promise<void> {
  if (updates.length === 0) return
  await Promise.all(
    updates.map((u) =>
      supabase
        .from('keywords')
        .update({ keyword_en: u.keyword_en })
        .eq('id', u.id),
    ),
  )
}

/**
 * Main translation job handler.
 * Hỗ trợ resumability: bỏ qua keywords đã dịch (keyword_en IS NOT NULL).
 */
export async function handleTranslationJob(job: AnalysisJob): Promise<void> {
  const { dataset_id } = job
  const payload = job.payload as Partial<TranslationPayload>

  logger.info('Starting translation job', { jobId: job.id, datasetId: dataset_id, model: MODEL })

  try {
    // 1. Fetch keywords chưa dịch
    let query = supabase
      .from('keywords')
      .select('id, keyword, keyword_en')
      .eq('dataset_id', dataset_id)
      .is('keyword_en', null)

    if (payload.keyword_ids && payload.keyword_ids.length > 0) {
      query = query.in('id', payload.keyword_ids)
    }

    const { data: keywords, error: fetchError } = await query
    if (fetchError) throw new Error(`Failed to fetch keywords: ${fetchError.message}`)

    if (!keywords || keywords.length === 0) {
      logger.info('No keywords to translate — completing job', { jobId: job.id })
      await markJobCompleted(job.id, 0)
      return
    }

    const total = keywords.length
    logger.info(`Translating ${total} keywords via ${MODEL}`, { jobId: job.id })

    // 2. Chia thành chunks
    const chunks: KeywordRow[][] = []
    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
      chunks.push(keywords.slice(i, i + CHUNK_SIZE))
    }

    let processedCount = job.processed_count
    let totalUpdated = 0

    // 3. Xử lý với concurrency control
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batchChunks = chunks.slice(i, i + CONCURRENCY)

      const batchResults = await Promise.allSettled(
        batchChunks.map((chunk) => translateChunk(chunk)),
      )

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const updates = result.value
          await saveTranslations(updates)
          totalUpdated += updates.length
          processedCount += updates.length
        } else {
          logger.warn('Chunk translation failed', {
            jobId: job.id,
            error: result.reason?.message || 'unknown',
          })
        }
      }

      await updateJobProgress(job.id, processedCount, total)

      if (i + CONCURRENCY < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY))
      }
    }

    await markJobCompleted(job.id, totalUpdated)
    logger.info('Translation job completed', { jobId: job.id, updatedCount: totalUpdated, total })
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('Translation job failed', { jobId: job.id, error: msg })
    await markJobFailed(job.id, msg)
  }
}
