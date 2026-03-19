import { createClient } from '@/utils/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { scrapeAppInfo, parseStoreUrl } from '@/lib/store-scraper'
import { GoogleGenAI } from '@google/genai'

// Use stable model — not preview/experimental which may be unavailable or deprecated
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite'

export type AppProfile = {
    title: string
    category: string
    primary_use_cases: string[]
    negative_intents: string[]
}

/**
 * POST /api/datasets/[datasetId]/generate-profile
 * Reads `target_app_url` from the dataset, scrapes app info,
 * checks global cache (TTL 30 days), calls Gemini if needed,
 * and saves profile to both `global_app_profiles` and `datasets.target_app_profile`.
 */
export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ datasetId: string }> }
) {
    const supabase = await createClient()

    // Auth check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
    }

    const { datasetId } = await params

    // Fetch dataset
    const { data: dataset, error: dsErr } = await supabase
        .from('datasets')
        .select('id, target_app_url, workspace_id')
        .eq('id', datasetId)
        .single()

    if (dsErr || !dataset) {
        return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
    }

    if (!dataset.target_app_url) {
        return NextResponse.json({
            error: 'No target_app_url set on this dataset. Please add an App Store URL first.'
        }, { status: 400 })
    }

    // Parse store URL to get canonical IDs
    const storeInfo = parseStoreUrl(dataset.target_app_url)
    if (!storeInfo) {
        return NextResponse.json({
            error: 'Invalid app URL. Must be apps.apple.com or play.google.com'
        }, { status: 400 })
    }

    const { appId, store, country } = storeInfo

    // ── Check global cache ────────────────────────────────────────────────────
    const { data: cached } = await supabase
        .from('global_app_profiles')
        .select('*')
        .eq('app_store_id', appId)
        .eq('store', store)
        .eq('country', country)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

    if (cached?.semantic_profile) {
        // Cache hit — save profile + store + country to dataset and return immediately
        await supabase
            .from('datasets')
            .update({
                target_app_profile: cached.semantic_profile,
                store,           // 'apple' | 'google_play' — needed by serp-fetch worker
                country_code: country,
            })
            .eq('id', datasetId)

        return NextResponse.json({
            profile: cached.semantic_profile as AppProfile,
            cached: true,
            app: { title: cached.title, category: cached.category },
        })
    }

    // ── Cache miss — scrape + Gemini ──────────────────────────────────────────
    let appInfo
    try {
        appInfo = await scrapeAppInfo(dataset.target_app_url)
    } catch (err: any) {
        return NextResponse.json({ error: `Failed to scrape app info: ${err.message}` }, { status: 502 })
    }

    // Build Gemini prompt (feed scraped text, no URL fetching needed)
    const prompt = `You are an App Store Optimization expert analyzing an app for keyword intent analysis.

App Name: ${appInfo.title}
Category: ${appInfo.category}
Description: ${appInfo.description}

Based on this app's metadata, generate a semantic profile to identify which search keywords are relevant vs misleading.

Return ONLY valid JSON (no markdown):
{
  "title": "${appInfo.title}",
  "category": "${appInfo.category}",
  "primary_use_cases": ["3-5 short phrases describing core user tasks"],
  "negative_intents": ["2-4 intent categories this app does NOT serve"]
}`

    let profile: AppProfile
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
        const response = await ai.models.generateContent({
            model: geminiModel,
            contents: prompt,
            config: { responseMimeType: 'application/json', temperature: 0.2 },
        })
        const text = (response.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        profile = JSON.parse(text) as AppProfile
    } catch (err: any) {
        return NextResponse.json({ error: `Gemini analysis failed: ${err.message}` }, { status: 502 })
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    // ── Save to global cache ──────────────────────────────────────────────────
    await supabase
        .from('global_app_profiles')
        .upsert({
            app_store_id: appId,
            store,
            country,
            title: profile.title,
            category: profile.category,
            semantic_profile: profile,
            last_analyzed_at: new Date().toISOString(),
            expires_at: expiresAt,
        }, { onConflict: 'app_store_id,store,country' })

    // ── Save to dataset ───────────────────────────────────────────────────────
    await supabase
        .from('datasets')
        .update({
            target_app_profile: profile,
            store,           // 'apple' | 'google_play' — used by serp-fetch worker to pick correct scraper
            country_code: country,
        })
        .eq('id', datasetId)

    return NextResponse.json({
        profile,
        cached: false,
        app: { title: profile.title, category: profile.category },
    })
}
