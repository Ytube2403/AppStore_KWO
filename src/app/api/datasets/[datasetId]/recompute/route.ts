import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request, { params }: { params: Promise<{ datasetId: string }> }) {
    const resolvedParams = await params
    const datasetId = resolvedParams.datasetId
    const supabase = await createClient()

    // 1. Authenticate Request
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { presetId } = await request.json()

        if (presetId === null || presetId === undefined) {
            // It's a reset command!
            const { error: resetKwError } = await supabase
                .from('keywords')
                .update({
                    is_qualified: true,
                    relevancy_score: null,
                    total_score: null
                })
                .eq('dataset_id', datasetId)

            if (resetKwError) return NextResponse.json({ error: resetKwError.message }, { status: 500 })



            return NextResponse.json({ success: true, message: 'Dataset reset to default correctly.' })
        }

        // 2. Fetch the new preset config
        const { data: preset, error: presetError } = await supabase
            .from('presets')
            .select('config')
            .eq('id', presetId)
            .single()

        if (presetError || !preset) {
            return NextResponse.json({ error: 'Preset not found' }, { status: 404 })
        }

        const config = preset.config

        // Default weights structure if not perfectly formed
        const wVol = config.weights?.volume || 0
        const wDiff = config.weights?.difficulty || 0
        const wKEI = config.weights?.kei || 0
        const wRel = config.weights?.relevancy || 0
        const wRank = config.weights?.rankPenalty || 0

        // Relevancy config
        const factorTop = config.relevancy?.wTop || 1
        const factorRanked = config.relevancy?.wRanked || 1
        const factorBest = config.relevancy?.wBest || 1
        const boolBonus = config.relevancy?.bonus || 0
        const T = config.relevancy?.T || 50

        // Advanced Filters
        const filters = config.filters || { minVolume: '', maxDifficulty: '', minMyRank: '' }
        const minCompetitorsRanked = config.relevancy?.minCompetitorsRanked || 0

        // [{ count: 2, topN: 10 }, ...]
        const topNConditions: { count: number, topN: number }[] = config.topNConditions || [{ count: config.relevancy?.minTopCount || 2, topN: config.relevancy?.N || 20 }]

        // 3. Instead of processing via RPC on DB (which is cleaner but needs custom SQL), 
        // we fetch keywords for this dataset, recalculate, and batch upsert.
        // Given the 10000 row MVP limit, fetching all and computing in Node is plausible but slightly slow. 
        // Let's implement Node-side calculation since the formulas might be highly dynamic/customized over time.

        const { data: keywords, error: fetchError } = await supabase
            .from('keywords')
            .select('*')
            .eq('dataset_id', datasetId)

        if (fetchError || !keywords) throw fetchError

        // Step 3a: Finding Min/Max for Normalization (0-100)
        let maxV = -Infinity, minV = Infinity
        let maxD = -Infinity, minD = Infinity
        let maxK = -Infinity, minK = Infinity

        // if using log volume
        const useLogVolume = config.transforms?.logVolume === true

        // Preset Target Template from Config
        // e.g. "balanced", "quick_win", "expansion", "defense", "custom"
        // By default we fallback to balanced logic if missing.
        const presetTemplate = preset.config?.template || 'balanced'
        const maxDifficultyPreset = filters.maxDifficulty ? parseFloat(filters.maxDifficulty) : 100

        keywords.forEach(k => {
            const currentVolume = k.volume || 0
            const maxVolume = k.max_volume ? k.max_volume : currentVolume

            // 70% max_volume + 30% current_volume
            const effectiveVolume = (0.70 * maxVolume) + (0.30 * currentVolume)

            const v = useLogVolume && effectiveVolume > 0 ? Math.log10(effectiveVolume + 1) : effectiveVolume
            const d = k.difficulty || 0
            const kei = k.kei || 0

            if (v > maxV) maxV = v; if (v < minV) minV = v;
            if (d > maxD) maxD = d; if (d < minD) minD = d;
            if (kei > maxK) maxK = kei; if (kei < minK) minK = kei;
        })

        const safeMinMax = (x: number, min: number, max: number) => {
            if (max === min) return 0.5
            return Math.min(1, Math.max(0, (x - min) / (max - min)))
        }

        const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

        // We also need the competitor_count from the dataset to normalize topN
        const { data: datasetInfo } = await supabase.from('datasets').select('competitor_count').eq('id', datasetId).single()
        const compCount = datasetInfo?.competitor_count || 1; // avoid division by 0

        // Step 3b: Loop and calculate
        const updatePayloads = keywords.map(k => {
            // --- Determine Qualification (Visibility) ---
            let is_qualified = true

            // Global Vol/Diff bounds
            const effectiveMaxVol = k.max_volume ? k.max_volume : (k.volume || 0)
            if (filters.minVolume && (k.volume === null || k.volume < parseFloat(filters.minVolume))) is_qualified = false
            if (filters.minMaxVolume && (effectiveMaxVol < parseFloat(filters.minMaxVolume))) is_qualified = false
            if (filters.maxDifficulty && (k.difficulty !== null && k.difficulty > parseFloat(filters.maxDifficulty))) is_qualified = false
            if (filters.minMyRank && (k.my_rank === null || k.my_rank > parseFloat(filters.minMyRank))) is_qualified = false

            // Relevancy stats
            let customBestRank: number | null = null
            let compTop100Count = 0

            // Map each condition topN so we can track counts dynamically
            const topNCounts: Record<number, number> = {}
            topNConditions.forEach(c => topNCounts[c.topN] = 0)

            Object.values(k.competitor_ranks).forEach(val => {
                const cRank = val as number | null
                if (cRank !== null) {
                    if (customBestRank === null || cRank < customBestRank) customBestRank = cRank

                    if (cRank <= 100) {
                        compTop100Count++
                    }

                    // Increment any requested bucket
                    topNConditions.forEach(c => {
                        if (cRank <= c.topN) topNCounts[c.topN]++
                    })
                }
            })

            // Use our newly strictly calculated Top 100 filter to overwrite the database's generic Any Rank variable 
            // for saving back into the standard representation
            const activeCompetitorRankedCount = compTop100Count

            // Min Competitors Ranked check
            if (minCompetitorsRanked > 0 && activeCompetitorRankedCount < minCompetitorsRanked) {
                is_qualified = false
            }

            // Top N Conditions check (OR logic: if ANY condition passes, the Relevancy Gate passes)
            let passGate = topNConditions.length === 0 ? true : false
            if (topNConditions.length > 0) {
                for (const cond of topNConditions) {
                    if (topNCounts[cond.topN] >= cond.count) {
                        passGate = true
                        break;
                    }
                }
            }
            if (!passGate) {
                is_qualified = false
            }

            // If we have just 1 default condition, use its count for the old legacy multiplier metric visually
            const primaryTopNCount = topNConditions.length > 0 ? topNCounts[topNConditions[0].topN] : 0

            const topFactor = primaryTopNCount / compCount // 0 to 1
            const rankedFactor = activeCompetitorRankedCount / compCount // 0 to 1
            const bestFactor = customBestRank !== null
                ? Math.max(0, (T - Math.min(customBestRank, T)) / T)
                : 0

            // Relevancy raw scale roughly ~ 0 to 3+
            let relRaw = (factorTop * topFactor) + (factorRanked * rankedFactor) + (factorBest * bestFactor)
            if (passGate) relRaw += boolBonus

            // --- 0. Chuẩn hoá dữ liệu (Normalization Tools) ---
            const currentVolume = k.volume || 0
            const maxVolume = k.max_volume ? k.max_volume : currentVolume
            const effectiveVolume = (0.70 * maxVolume) + (0.30 * currentVolume)

            const rawVol = useLogVolume && effectiveVolume > 0 ? Math.log10(effectiveVolume + 1) : effectiveVolume
            const volN = safeMinMax(rawVol, minV, maxV)

            // Difficulty parsing
            const diffInput = k.difficulty || 0
            // Using preset max config bounds (Rule B)
            const diffInv = clamp01(1 - (diffInput / maxDifficultyPreset))
            // Alternative Rule A (Min-Max over exact set): const diffN = safeMinMax(k.difficulty || 0, minD, maxD); const diffInv2 = 1 - diffN;

            const keiN = safeMinMax(k.kei || 0, minK, maxK)

            // --- 0.5 Competitor Signal (CompN) ---
            const maxCompetitors = compCount > 0 ? compCount : 5 // Fallback to 5 if compCount missing
            const compN = clamp01(activeCompetitorRankedCount / maxCompetitors)

            // --- 0.6 Rank Signals ---
            const rankCap = config.relevancy?.T || 50
            const unrankedValue = 999
            const myRankEff = k.my_rank !== null ? k.my_rank : unrankedValue

            // RankN
            const rankN = clamp01((rankCap - myRankEff) / rankCap)

            // GainFromRank
            const gainFromRank = (myRankEff <= rankCap) ? (myRankEff - 1) / (rankCap - 1) : 1

            // QuickWinRank
            const qwRank = (11 <= myRankEff && myRankEff <= 50) ? clamp01((50 - myRankEff) / (50 - 11)) : 0

            // ==================
            // SCORING TEMPLATES
            // ==================
            let totalScore = 0

            if (presetTemplate === 'quick_win') {
                // 2) Quick Win
                const base = (0.26 * volN) + (0.18 * diffInv) + (0.10 * keiN) + (0.12 * compN) + (0.34 * qwRank)

                let focus = 0.35 // fallback
                if (myRankEff >= 11 && myRankEff <= 30) focus = 1.00
                else if (myRankEff >= 31 && myRankEff <= 50) focus = 0.85
                else if (myRankEff >= 1 && myRankEff <= 10) focus = 0.55

                const penaltyDifficulty = Math.pow(diffInv, 1.15)
                const boostCompetitor = 0.80 + (0.20 * compN)

                totalScore = 100 * clamp01(base * focus * penaltyDifficulty * boostCompetitor)

            } else if (presetTemplate === 'expansion') {
                // 3) Expansion
                const base = (0.36 * volN) + (0.18 * diffInv) + (0.14 * keiN) + (0.30 * compN) + (0.02 * gainFromRank)

                const penaltyDifficulty = Math.pow(diffInv, 1.45)
                const boostCompetitor = 0.65 + (0.35 * compN)
                const missingRankFactor = 1.00 // Expansion doesn't penalize unranked

                totalScore = 100 * clamp01(base * penaltyDifficulty * boostCompetitor * missingRankFactor)

            } else if (presetTemplate === 'defense') {
                // 4) Defense
                if (myRankEff <= 10) {
                    const value = (0.55 * volN) + (0.25 * compN) + (0.20 * keiN)
                    const rankRisk = clamp01((myRankEff - 1) / 9)
                    // We need DiffN where 1 is hardest. Which is 1 - DiffInv.
                    const diffN = 1 - diffInv
                    const hardnessRisk = diffN

                    const vuln = (0.70 * rankRisk) + (0.30 * hardnessRisk)
                    totalScore = 100 * clamp01(value * vuln)
                } else {
                    totalScore = 0
                }

            } else if (presetTemplate === 'custom') {
                // Custom logic - user injected mapping. Maps exactly to the frontend weights sliders
                // Linear Base (volume + difficulty + relevancy + kei — rank handled separately as penalty)
                const baseScore =
                    (wVol * volN) +
                    (wDiff * diffInv) +
                    (wRel * compN) +
                    (wKEI * keiN)

                const clampedBase = clamp01(baseScore)

                // Missing Rank Penalty: rankN=0 (unranked) → multiplier = (1 - wRank); rankN=1 (top) → no penalty
                const rankPenaltyMultiplier = clamp01(1 - wRank * (1 - rankN))

                const penaltyDifficulty = Math.pow(diffInv, 1.3)
                const boostCompetitor = 0.7 + (0.3 * compN)

                totalScore = 100 * clamp01(clampedBase * penaltyDifficulty * boostCompetitor * rankPenaltyMultiplier)

            } else if (presetTemplate === 'ua_focus') {
                // UA Focus: Volume + Difficulty dominant, minimal rank penalty
                // Guard: if effectiveVolume is truly 0 (both volume and max_volume are 0), score = 0
                if (effectiveVolume === 0) {
                    totalScore = 0
                } else {
                    const base =
                        (wVol * volN) +
                        (wDiff * diffInv) +
                        (wRel * compN) +
                        (wKEI * keiN)

                    // Soft penalty if unranked (5% rank penalty weight)
                    const unrankedPenalty = (k.my_rank === null) ? (1 - wRank) : 1

                    const penaltyDifficulty = 0.70 + (0.30 * diffInv)
                    const boostCompetitor = 0.75 + (0.25 * compN)

                    totalScore = 100 * clamp01(clamp01(base) * penaltyDifficulty * boostCompetitor * unrankedPenalty)
                }

            } else {
                // 1) Balanced (default)
                const base = (0.30 * volN) + (0.18 * diffInv) + (0.12 * keiN) + (0.20 * compN) + (0.20 * rankN)

                const penaltyDifficulty = 0.65 + (0.35 * diffInv) // phạt nhẹ, KHÔNG về 0

                totalScore = 100 * clamp01(base * penaltyDifficulty)
            }


            // Determine Priority Tier based on final score
            let tier = 'P3'
            if (totalScore >= 80) tier = 'P0'
            else if (totalScore >= 65) tier = 'P1'
            else if (totalScore >= 45) tier = 'P2'

            return {
                id: k.id,
                relevancy_score: relRaw, // Keep raw available for UI if needed
                total_score: totalScore,
                competitor_topn_count: primaryTopNCount,
                competitor_best_rank: customBestRank,
                competitor_ranked_count: activeCompetitorRankedCount, // Send back our newly filtered top 100 count mapping to column
                is_qualified: is_qualified,
                tier: tier
            }
        })

        // Bulk update via RPC to avoid N+1 queries issue
        const chunkSize = 1000
        for (let i = 0; i < updatePayloads.length; i += chunkSize) {
            const chunk = updatePayloads.slice(i, i + chunkSize)
            const { error: rpcError } = await supabase.rpc('bulk_update_keywords_fast', {
                ids: chunk.map(c => c.id),
                best_ranks: chunk.map(c => c.competitor_best_rank),
                ranked_counts: chunk.map(c => c.competitor_ranked_count),
                topn_counts: chunk.map(c => c.competitor_topn_count),
                is_quals: chunk.map(c => c.is_qualified),
                rel_scores: chunk.map(c => c.relevancy_score),
                total_scores: chunk.map(c => c.total_score)
            })

            if (rpcError) {
                console.error("Bulk update error:", rpcError)
                throw rpcError
            }
        }

        return NextResponse.json({ success: true, count: keywords.length })

    } catch (error: any) {
        console.error("Recompute error", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
