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

        const updates: { id: string, dataset_id: string, keyword_en: string }[] = []
        const errors: { error: string, keyword?: string }[] = []

        // Initialize Gemini Client
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

        // 1. Tăng chunkSize lên 200 (Flash xử lý JSON rất tốt và keyword ngắn)
        const chunkSize = 200;

        // 2. Chạy song song (Concurrency = 3) để tối ưu tốc độ mà không dính rate limit (15 req/min)
        const concurrencyLimit = 3;

        const chunks = [];
        for (let i = 0; i < keywordsToTranslate.length; i += chunkSize) {
            chunks.push(keywordsToTranslate.slice(i, i + chunkSize));
        }

        for (let i = 0; i < chunks.length; i += concurrencyLimit) {
            const batchChunks = chunks.slice(i, i + concurrencyLimit);

            const promises = batchChunks.map(async (chunk, chunkIndex) => {
                const payload = chunk.map(kw => ({ id: kw.id, keyword: kw.keyword }));

                const prompt = `You are an expert translator specializing in App Store Optimization (ASO) for mobile apps and games. 
Translate the following keywords into English. 
Return ONLY a valid JSON object matching this schema: 
{ "translations": [ { "id": "string", "keyword_en": "string" } ] }

Input Keywords:
${JSON.stringify(payload)}`;

                try {
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: {
                            responseMimeType: "application/json",
                            temperature: 0.1,
                        }
                    });

                    if (response.text) {
                        const parsed = JSON.parse(response.text);
                        if (parsed && Array.isArray(parsed.translations)) {
                            for (const item of parsed.translations) {
                                if (item.id && item.keyword_en) {
                                    updates.push({
                                        id: item.id,
                                        dataset_id: datasetId,
                                        keyword_en: item.keyword_en
                                    });
                                }
                            }
                        }
                    }
                } catch (translationErr: any) {
                    console.error(`Failed to translate chunk`, translationErr);
                    errors.push({ error: translationErr.message || 'Gemini API translation failed for a chunk' });
                }
            });

            await Promise.all(promises);

            // Delay giữa các đợt 3 concurrent requests để tránh lỗi 429 Too many requests
            if (i + concurrencyLimit < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (updates.length > 0) {
            // Use update instead of upsert to perform partial updates and avoid violating NOT NULL constraints on other columns like 'keyword'
            for (const update of updates) {
                const { error: updateError } = await supabase
                    .from('keywords')
                    .update({ keyword_en: update.keyword_en })
                    .eq('id', update.id)

                if (updateError) throw updateError
            }
        }

        return NextResponse.json({ success: true, updatedCount: updates.length, errors: errors.length > 0 ? errors : undefined })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
