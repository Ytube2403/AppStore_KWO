import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
    const supabase = await createClient()
    const { datasetId } = await params

    // 1. Authenticate Request
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const {
            columnMapping,
            appMapping, // { myApp: '', competitors: [] }
            keywordsData // Array of parsed objects matching mapping 
        } = body

        if (!keywordsData || keywordsData.length === 0) {
            return NextResponse.json({ error: 'Missing required fields or empty data' }, { status: 400 })
        }

        // 2. Fetch Existing Keywords to get their IDs
        const { data: existingKeywords, error: fetchError } = await supabase
            .from('keywords')
            .select('id, keyword')
            .eq('dataset_id', datasetId)

        if (fetchError) throw fetchError

        // Build a map for fast lookup: keyword -> id
        const existingMap = new Map<string, string>()
        existingKeywords?.forEach(k => {
            existingMap.set(k.keyword.toLowerCase().trim(), k.id)
        })

        // We will deduplicate keywords by normalized keyword string
        const processedKeywordsMap = new Map<string, any>()

        for (const raw of keywordsData) {
            const keywordStr = String(raw[columnMapping.keyword] || '').toLowerCase().trim().replace(/\s+/g, ' ')
            if (!keywordStr || keywordStr === 'null' || keywordStr === 'n/a' || keywordStr === '-' || keywordStr === 'na') {
                continue // skip invalid keywords
            }

            const parseNum = (val: any, allowZero: boolean = false) => {
                if (val === null || val === undefined || val === '') return null
                const strVal = String(val).toLowerCase().trim()
                if (strVal === 'null' || strVal === 'n/a' || strVal === '-' || strVal === 'na') return null
                const num = parseFloat(strVal)
                if (isNaN(num)) return null
                if (!allowZero && num <= 0) return null // ranks must be > 0 (or allowZero for difficulty)
                return num
            }

            const vol = parseNum(raw[columnMapping.volume], true)
            const maxVol = columnMapping.maxVolume ? parseNum(raw[columnMapping.maxVolume], true) : null
            const diff = parseNum(raw[columnMapping.difficulty], true)
            const keival = parseNum(raw[columnMapping.kei], true)

            const appName = String(raw[columnMapping.appName] || '').trim()
            const rank = parseNum(raw[columnMapping.rank], false) // Rank > 0

            // Initialize Keyword Data if not exists
            if (!processedKeywordsMap.has(keywordStr)) {
                // Check if this keyword already exists in DB
                const existingId = existingMap.get(keywordStr)

                const baseObject: any = {
                    dataset_id: datasetId,
                    keyword: keywordStr,
                    volume: vol,
                    max_volume: maxVol,
                    difficulty: diff,
                    kei: keival,
                    my_rank: null,
                    competitor_ranks: {},
                    competitor_ranked_count: 0,
                    competitor_topn_count: 0,
                    competitor_best_rank: null
                    // Note: We don't overwrite total_score, relevancy_score here if they exist, but actually it's better to reset them
                    // Since new data invalidates old scoring
                }

                if (existingId) {
                    baseObject.id = existingId // Adding ID triggers UPDATE during upsert
                }

                processedKeywordsMap.set(keywordStr, baseObject)
            }

            const existing = processedKeywordsMap.get(keywordStr)

            // Overwrite missing aggregate stats across rows
            if (existing.volume === null && vol !== null) existing.volume = vol
            if (existing.max_volume === null && maxVol !== null) existing.max_volume = maxVol
            if (existing.difficulty === null && diff !== null) existing.difficulty = diff
            if (existing.kei === null && keival !== null) existing.kei = keival

            // Assign rank mapped to the correct App
            if (rank !== null) {
                if (appName === appMapping.myApp) {
                    // Update My Rank
                    if (existing.my_rank === null || rank < existing.my_rank) {
                        existing.my_rank = rank
                    }
                } else if (appMapping.competitors && appMapping.competitors.includes(appName)) {
                    // Update Competitor Ranks
                    if (existing.competitor_ranks[appName] === undefined || existing.competitor_ranks[appName] === null || rank < existing.competitor_ranks[appName]) {
                        existing.competitor_ranks[appName] = rank
                    }
                }
            }
        }

        // Post-process to calculate derived competitor statistics
        for (const kData of processedKeywordsMap.values()) {
            let rankedCount = 0
            let topNCount = 0
            let bestRank: number | null = null

            for (const cRank of Object.values(kData.competitor_ranks)) {
                const rankNum = cRank as number
                if (rankNum > 0) {
                    if (rankNum <= 100) rankedCount++
                    if (rankNum <= 20) topNCount++
                    if (bestRank === null || rankNum < bestRank) bestRank = rankNum
                }
            }

            kData.competitor_ranked_count = rankedCount
            kData.competitor_topn_count = topNCount
            kData.competitor_best_rank = bestRank
        }

        // 4. Batch Upsert Keywords
        const finalKeywords = Array.from(processedKeywordsMap.values())

        // Insert in batches of 1000
        const chunkSize = 1000
        for (let i = 0; i < finalKeywords.length; i += chunkSize) {
            const chunk = finalKeywords.slice(i, i + chunkSize)
            const { error: upsertError } = await supabase
                .from('keywords')
                .upsert(chunk) // By default checks primary key `id`

            if (upsertError) {
                console.error("Batch upsert error:", upsertError)
                throw upsertError
            }
        }

        // Optionally trigger recompute if a preset is active, but for now we just return success
        // and let the client call recompute manually.

        return NextResponse.json({ success: true, datasetId, totalUpserted: finalKeywords.length })

    } catch (error: any) {
        console.error("Update API Error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
