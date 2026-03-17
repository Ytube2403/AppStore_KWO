import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'

export async function POST(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY environment variable is missing.' }, { status: 500 })
    }

    try {
        const { datasetId } = await params
        const { keywordIds } = await request.json()

        // ── Feature Flag: USE_WORKER_TRANSLATION ─────────────────────────────
        // Set USE_WORKER_TRANSLATION=true in .env.local to route translation
        // through the background Worker (dùng OpenRouter) thay vì chạy sync ở đây.
        // Default là false — Gemini sync path chạy như cũ.
        if (process.env.USE_WORKER_TRANSLATION === 'true') {
            if (!datasetId || !keywordIds || !Array.isArray(keywordIds) || keywordIds.length === 0) {
                return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
            }

            const { data: dataset, error: dsErr } = await supabase
                .from('datasets')
                .select('workspace_id')
                .eq('id', datasetId)
                .single()

            if (dsErr || !dataset) {
                return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
            }

            const { data: job, error: jobErr } = await supabase
                .from('analysis_jobs')
                .insert({
                    workspace_id: dataset.workspace_id,
                    dataset_id: datasetId,
                    job_type: 'translation',
                    status: 'pending',
                    priority: 5,
                    payload: { keyword_ids: keywordIds },
                    progress_percent: 0,
                    processed_count: 0,
                    total_count: keywordIds.length,
                })
                .select('id, status, created_at')
                .single()

            if (jobErr || !job) {
                console.error('Failed to enqueue translation job:', jobErr)
                return NextResponse.json({ error: 'Failed to enqueue translation job' }, { status: 500 })
            }

            return NextResponse.json({
                async: true,
                jobId: job.id,
                status: job.status,
                message: `Translation job queued. Poll /api/jobs/${job.id} for status.`,
            })
        }
        // ── End Feature Flag ─────────────────────────────────────────────────

        if (!datasetId || !keywordIds || !Array.isArray(keywordIds) || keywordIds.length === 0) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        // Fetch keywords to translate
        const { data: keywords, error: fetchError } = await supabase
            .from('keywords')
            .select('id, keyword, keyword_en')
            .eq('dataset_id', datasetId)
            .in('id', keywordIds)

        if (fetchError) throw fetchError

        const keywordsToTranslate = keywords.filter(kw => !kw.keyword_en)
        if (keywordsToTranslate.length === 0) {
            return NextResponse.json({ success: true, updatedCount: 0 })
        }

        const updates: { id: string, keyword_en: string }[] = []
        const errors: { error: string }[] = []

        // Initialize Gemini Client
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

        // gemini-3.1-flash-lite: RPM=35 → concurrency 7, delay 1200ms
        const chunkSize = 200
        const concurrencyLimit = 7
        const interBatchDelay = 1200

        const chunks: typeof keywordsToTranslate[] = []
        for (let i = 0; i < keywordsToTranslate.length; i += chunkSize) {
            chunks.push(keywordsToTranslate.slice(i, i + chunkSize))
        }

        for (let i = 0; i < chunks.length; i += concurrencyLimit) {
            const batchChunks = chunks.slice(i, i + concurrencyLimit)

            const promises = batchChunks.map(async (chunk) => {
                const payload = chunk.map(kw => ({ id: kw.id, keyword: kw.keyword }))

                const prompt = `You are an expert translator specializing in App Store Optimization (ASO) for mobile apps and games. 
Translate the following keywords into English. 
Return ONLY a valid JSON object matching this schema: 
{ "translations": [ { "id": "string", "keyword_en": "string" } ] }

Input Keywords:
${JSON.stringify(payload)}`

                try {
                    const response = await ai.models.generateContent({
                        model: 'gemini-3.1-flash-lite-preview',
                        contents: prompt,
                        config: {
                            responseMimeType: 'application/json',
                            temperature: 0.1,
                        }
                    })

                    if (response.text) {
                        const parsed = JSON.parse(response.text)
                        if (parsed && Array.isArray(parsed.translations)) {
                            for (const item of parsed.translations) {
                                if (item.id && item.keyword_en) {
                                    updates.push({ id: item.id, keyword_en: item.keyword_en })
                                }
                            }
                        }
                    }
                } catch (translationErr: any) {
                    console.error(`Failed to translate chunk`, translationErr)
                    errors.push({ error: translationErr.message || 'Gemini API translation failed for a chunk' })
                }
            })

            await Promise.all(promises)

            if (i + concurrencyLimit < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, interBatchDelay))
            }
        }

        // Parallel DB writes
        if (updates.length > 0) {
            await Promise.all(
                updates.map(update =>
                    supabase
                        .from('keywords')
                        .update({ keyword_en: update.keyword_en })
                        .eq('id', update.id)
                )
            )
        }

        return NextResponse.json({
            success: true,
            updatedCount: updates.length,
            errors: errors.length > 0 ? errors : undefined
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
