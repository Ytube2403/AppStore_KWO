'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetFooter,
    SheetClose,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { Plus, Trash2, Settings2, Sparkles, ChevronDown, ChevronRight, Calculator, HelpCircle } from 'lucide-react'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// --- Scoring Presets Configuration ---
export const PRESET_TEMPLATES = {
    'custom': { name: 'Custom Configuration', weights: { volume: 0.3, difficulty: 0.3, kei: 0.1, relevancy: 0.2, rankPenalty: 0.1 } },
    'balanced': { name: 'Balanced (Default)', weights: { volume: 0.35, difficulty: 0.25, kei: 0.05, relevancy: 0.15, rankPenalty: 0.20 }, defaults: { minVolume: '5', minMaxVolume: '6', maxDifficulty: '80', minCompetitorsRanked: 2, topNConditions: [{ count: 2, topN: 20 }] } },
    'ua_focus': { name: 'UA Focus (Volume Priority)', weights: { volume: 0.50, difficulty: 0.25, kei: 0.0, relevancy: 0.20, rankPenalty: 0.05 }, defaults: { minVolume: '3', minMaxVolume: '6', maxDifficulty: '90', minCompetitorsRanked: 1, topNConditions: [{ count: 1, topN: 50 }] } },
    'quick_win': { name: 'Quick Win (Rank 11-50)', weights: { volume: 0.30, difficulty: 0.20, kei: 0.05, relevancy: 0.10, rankPenalty: 0.35 }, defaults: { minVolume: '5', minMaxVolume: '6', maxDifficulty: '80', minCompetitorsRanked: 2, topNConditions: [{ count: 2, topN: 20 }] } },
    'expansion': { name: 'Expansion (Targeting Competitors)', weights: { volume: 0.40, difficulty: 0.15, kei: 0.10, relevancy: 0.30, rankPenalty: 0.05 }, defaults: { minVolume: '5', minMaxVolume: '6', maxDifficulty: '80', minCompetitorsRanked: 2, topNConditions: [{ count: 2, topN: 20 }] } },
    'defense': { name: 'Defense (Protect Top 1-10)', weights: { volume: 0.40, difficulty: 0.10, kei: 0.0, relevancy: 0.0, rankPenalty: 0.50 }, defaults: { minVolume: '5', minMaxVolume: '6', maxDifficulty: '80', minCompetitorsRanked: 2, topNConditions: [{ count: 2, topN: 20 }] } },
}

const DEFAULT_CONFIG = {
    weights: PRESET_TEMPLATES.balanced.weights,
    relevancy: { T: 50, wTop: 1, wRanked: 1, wBest: 1, bonus: 0, minCompetitorsRanked: 2 },
    topNConditions: [{ count: 2, topN: 20 }],
    filters: { minVolume: '5', minMaxVolume: '6', maxDifficulty: '80', minMyRank: '' },
    transforms: { logVolume: true }
}

export default function PresetConfigDrawer({
    workspaceId,
    datasetId,
    onRecomputeComplete,
    onConfigMutated
}: {
    workspaceId: string,
    datasetId: string,
    onRecomputeComplete: () => void,
    onConfigMutated?: (isDirty: boolean) => void
}) {
    const [open, setOpen] = useState(false)
    const router = useRouter()

    const [presetTemplate, setPresetTemplate] = useState<keyof typeof PRESET_TEMPLATES>('balanced')
    const [filters, setFilters] = useState(DEFAULT_CONFIG.filters)
    const [minMaxVolume, setMinMaxVolume] = useState(DEFAULT_CONFIG.filters.minMaxVolume)
    const [topNConditions, setTopNConditions] = useState(DEFAULT_CONFIG.topNConditions)
    const [minCompetitorsRanked, setMinCompetitorsRanked] = useState(DEFAULT_CONFIG.relevancy.minCompetitorsRanked)
    const [weights, setWeights] = useState(DEFAULT_CONFIG.weights)
    const [logVolume, setLogVolume] = useState(DEFAULT_CONFIG.transforms.logVolume)
    const [isProcessing, setIsProcessing] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)

    // Track original clean state stringified
    const [initialConfigJson, setInitialConfigJson] = useState('')

    // Evaluate dirty state efficiently whenever config primitives change
    // Because this happens per render on React, just calling useMemo is safer.
    // Wait, let's keep it simple: any UI interaction mutates -> dirty.
    const notifyMutation = () => {
        if (onConfigMutated) onConfigMutated(true)
    }

    const addTopNCondition = () => {
        setTopNConditions(prev => [...prev, { count: 1, topN: 20 }])
        notifyMutation()
    }

    const removeTopNCondition = (index: number) => {
        setTopNConditions(prev => prev.filter((_, i) => i !== index))
        notifyMutation()
    }

    const updateTopNCondition = (index: number, field: 'count' | 'topN', val: string) => {
        setTopNConditions(prev => {
            const next = [...prev]
            next[index][field] = Number(val) || 0
            return next
        })
        notifyMutation()
    }

    const handleTemplateChange = (val: keyof typeof PRESET_TEMPLATES) => {
        setPresetTemplate(val)
        if (val !== 'custom') {
            const templateData = PRESET_TEMPLATES[val]

            // Set hardcoded weights for UI visualization
            setWeights(templateData.weights)
            setShowAdvanced(false) // Auto hide advanced when picking a template

            // If template has specific defaults, override them
            if ('defaults' in templateData) {
                setFilters(prev => ({
                    ...prev,
                    minVolume: templateData.defaults.minVolume,
                    maxDifficulty: templateData.defaults.maxDifficulty
                }))
                setMinMaxVolume(templateData.defaults.minMaxVolume ?? '')
                setMinCompetitorsRanked(templateData.defaults.minCompetitorsRanked)
                setTopNConditions(templateData.defaults.topNConditions)
            }

        } else {
            setShowAdvanced(true)
        }
        notifyMutation()
    }

    const handleSaveAndApply = async () => {
        setIsProcessing(true)
        try {
            // 1. Save Preset
            const pRes = await fetch('/api/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId,
                    name: PRESET_TEMPLATES[presetTemplate].name,
                    config: {
                        template: presetTemplate,
                        weights,
                        filters: { ...filters, minMaxVolume },
                        topNConditions,
                        transforms: { logVolume },
                        relevancy: {
                            ...DEFAULT_CONFIG.relevancy,
                            minCompetitorsRanked
                        }
                    }
                })
            })
            const pData = await pRes.json()

            if (!pRes.ok) throw new Error(pData.error || 'Failed to save preset')

            const newPresetId = pData.preset.id

            // 2. Trigger Recompute
            const rRes = await fetch(`/api/datasets/${datasetId}/recompute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presetId: newPresetId })
            })

            if (!rRes.ok) {
                const errorData = await rRes.json()
                throw new Error(errorData.error || 'Failed to recompute')
            }

            toast.success('Preset saved and keywords filtered!')
            setOpen(false)
            if (onConfigMutated) onConfigMutated(false) // Clean
            onRecomputeComplete() // Notify parent to refresh data
            router.refresh()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="bg-white flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Configure Preset
                </Button>
            </SheetTrigger>
            <SheetContent className="w-[95vw] sm:max-w-[600px] overflow-y-auto p-6 sm:p-8 border-l shadow-2xl">
                <SheetHeader className="mb-8">
                    <SheetTitle className="text-xl">Preset Configuration</SheetTitle>
                </SheetHeader>

                <div className="space-y-8">
                    {/* SECTION 1: INFO & TEMPLATE */}
                    <div className="space-y-4">
                        <div className="space-y-3">
                            <Label className="font-semibold text-sm">Preset Template</Label>
                            <select
                                value={presetTemplate}
                                onChange={e => handleTemplateChange(e.target.value as keyof typeof PRESET_TEMPLATES)}
                                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background"
                            >
                                {Object.entries(PRESET_TEMPLATES).map(([key, data]) => (
                                    <option key={key} value={key}>{data.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* FILTERS & RELEVANCY RULES COMBINED */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h4 className="font-semibold text-sm">Filters & Relevancy Rules</h4>
                            <Button variant="outline" size="sm" className="h-7 px-3 text-xs rounded-full bg-white shadow-sm" onClick={addTopNCondition}>
                                <Plus className="h-3 w-3 mr-1" /> Add Rule
                            </Button>
                        </div>

                        <div className="grid grid-cols-3 gap-3 pb-2">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-gray-500">Min Volume &ge;</Label>
                                <Input type="number" value={filters.minVolume} onChange={e => setFilters(prev => ({ ...prev, minVolume: e.target.value }))} placeholder="e.g. 5" className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-gray-500">Min Max Volume &ge;</Label>
                                <Input type="number" value={minMaxVolume} onChange={e => setMinMaxVolume(e.target.value)} placeholder="e.g. 6" className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-gray-500">Max Difficulty &le;</Label>
                                <Input type="number" value={filters.maxDifficulty} onChange={e => setFilters(prev => ({ ...prev, maxDifficulty: e.target.value }))} placeholder="e.g. 80" className="h-9" />
                            </div>
                        </div>

                        <div className="space-y-1.5 mb-4">
                            <Label className="text-xs text-gray-500">Min Competitors (Any Rank) &ge;</Label>
                            <Input type="number" value={minCompetitorsRanked} onChange={e => setMinCompetitorsRanked(Number(e.target.value))} placeholder="e.g. 2" className="h-9 max-w-[120px]" />
                        </div>

                        <div className="space-y-3">
                            {topNConditions.map((cond, idx) => (
                                <div key={idx} className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border">
                                    <span className="text-xs font-medium text-gray-600 truncate">Apps in Top</span>
                                    <Input
                                        type="number"
                                        value={cond.topN}
                                        onChange={e => updateTopNCondition(idx, 'topN', e.target.value)}
                                        className="h-9 w-20 text-sm font-semibold"
                                        placeholder="e.g. 15"
                                    />
                                    <span className="text-sm font-medium text-gray-600">&ge;</span>
                                    <Input
                                        type="number"
                                        value={cond.count}
                                        onChange={e => updateTopNCondition(idx, 'count', e.target.value)}
                                        className="h-9 w-16 text-sm"
                                    />

                                    <Button variant="ghost" size="icon" className="text-red-500 ml-auto h-8 w-8 hover:bg-red-50 hover:text-red-700 rounded-full" onClick={() => removeTopNCondition(idx)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ADVANCED SCORE SETTINGS */}
                    <div className="space-y-4 pt-4 border-t">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-black w-full"
                        >
                            {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            Advanced Scoring Weights & Config
                        </button>

                        {showAdvanced && (
                            <div className="space-y-6 bg-gray-50/50 p-4 rounded-xl border animate-in slide-in-from-top-2">
                                <div className="bg-blue-50/50 border border-blue-100 text-blue-800 p-3 rounded-lg text-[11px] leading-relaxed">
                                    <p className="font-semibold mb-1">How Scoring Works:</p>
                                    <p>The selected <em>Preset Template</em> determines the mathematical formula and strategy for ranking keywords (e.g. <em>Quick Win</em> heavily targets ranks 11-50, while <em>Defense</em> calculates dropping risks to Top 10 words). If you want to use a pure standard weighted linear model, switch to <strong>Custom Configuration</strong> and manually adjust the sliders below.</p>
                                    {presetTemplate !== 'custom' && (
                                        <p className="mt-2 text-red-600 font-medium">⚠️ Since you are currently using a pre-configured template ({PRESET_TEMPLATES[presetTemplate].name}), altering these weight sliders will not impact the final score until you switch to Custom.</p>
                                    )}
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <Label className="text-sm font-medium">Logarithmic Volume</Label>
                                        <p className="text-[11px] text-gray-500">Apply log10 to volume scores preventing massive outliers.</p>
                                    </div>
                                    <Switch checked={logVolume} onCheckedChange={setLogVolume} disabled={presetTemplate !== 'custom'} />
                                </div>

                                <TooltipProvider>
                                    <div className="space-y-5 pt-2 border-t">
                                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Weight Distribution</h5>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Label>Volume Weight</Label>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">
                                                            <p className="max-w-xs text-xs">How much search traffic potential (Volume) impacts the score.</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <span className="font-semibold text-[#FF8903]">{Math.round(weights.volume * 100)}%</span>
                                            </div>
                                            <Slider
                                                value={[weights.volume * 100]}
                                                onValueChange={(vals) => setWeights(prev => ({ ...prev, volume: vals[0] / 100 }))}
                                                max={100} step={5}
                                            />
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Label>Difficulty Inverse Weight</Label>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">
                                                            <p className="max-w-[200px] text-xs">Rewards keywords with lower competition. Higher weight prioritizes easier keywords.</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <span className="font-semibold text-[#FF8903]">{Math.round(weights.difficulty * 100)}%</span>
                                            </div>
                                            <Slider
                                                value={[weights.difficulty * 100]}
                                                onValueChange={(vals) => setWeights(prev => ({ ...prev, difficulty: vals[0] / 100 }))}
                                                max={100} step={5}
                                            />
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Label>KEI Weight</Label>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">
                                                            <p className="max-w-[200px] text-xs">Keyword Effectiveness Index. Balances search volume against keyword difficulty directly.</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <span className="font-semibold text-[#FF8903]">{Math.round(weights.kei * 100)}%</span>
                                            </div>
                                            <Slider
                                                value={[weights.kei * 100]}
                                                onValueChange={(vals) => setWeights(prev => ({ ...prev, kei: vals[0] / 100 }))}
                                                max={100} step={5}
                                            />
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Label>Relevancy Weight</Label>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">
                                                            <p className="max-w-[200px] text-xs">Scores based on how many competitors rank for this keyword. High weight focuses on pure niche-specific keywords.</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <span className="font-semibold text-[#FF8903]">{Math.round(weights.relevancy * 100)}%</span>
                                            </div>
                                            <Slider
                                                value={[weights.relevancy * 100]}
                                                onValueChange={(vals) => setWeights(prev => ({ ...prev, relevancy: vals[0] / 100 }))}
                                                max={100} step={5}
                                            />
                                        </div>

                                        <div className="space-y-3 pt-2">
                                            <div className="flex justify-between items-center text-xs">
                                                <div className="flex items-center gap-1.5">
                                                    <Label className="text-red-600">Missing Rank Penalty</Label>
                                                    <Tooltip delayDuration={150}>
                                                        <TooltipTrigger asChild>
                                                            <HelpCircle className="h-3 w-3 text-red-400 cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top">
                                                            <p className="max-w-[200px] text-xs">Deduction applied to the score if your app does not currently rank for this keyword.</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </div>
                                                <span className="font-semibold text-red-600">-{Math.round(weights.rankPenalty * 100)}%</span>
                                            </div>
                                            <Slider
                                                value={[weights.rankPenalty * 100]}
                                                onValueChange={(vals) => setWeights(prev => ({ ...prev, rankPenalty: vals[0] / 100 }))}
                                                max={100} step={5}
                                            />
                                        </div>
                                    </div>
                                </TooltipProvider>
                            </div>
                        )}
                    </div>

                    <div className="pt-8 flex justify-end gap-3 border-t">
                        <SheetClose asChild>
                            <Button variant="outline" disabled={isProcessing}>Cancel</Button>
                        </SheetClose>
                        <Button
                            className="bg-[#FEB107] hover:bg-[#FF8903] text-black font-semibold"
                            onClick={handleSaveAndApply}
                            disabled={isProcessing}
                        >
                            {isProcessing ? 'Applying...' : 'Save & Apply'}
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
