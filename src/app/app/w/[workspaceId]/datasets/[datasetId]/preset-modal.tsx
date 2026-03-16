'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'

const DEFAULT_CONFIG = {
    weights: { volume: 0.3, difficulty: 0.3, kei: 0.1, relevancy: 0.2, rankPenalty: 0.1 },
    relevancy: { T: 50, wTop: 1, wRanked: 1, wBest: 1, bonus: 0, minCompetitorsRanked: 0 },
    topNConditions: [{ count: 2, topN: 10 }], // e.g., At least 2 competitors in Top 10
    filters: { minVolume: '', maxDifficulty: '', minMyRank: '' },
    transforms: { logVolume: true }
}

export default function PresetConfigModal({ workspaceId, datasetId, onRecomputeComplete }: { workspaceId: string, datasetId: string, onRecomputeComplete: () => void }) {
    const [open, setOpen] = useState(false)
    const router = useRouter()

    const [presetName, setPresetName] = useState('New Preset')
    const [weights, setWeights] = useState(DEFAULT_CONFIG.weights)
    const [filters, setFilters] = useState(DEFAULT_CONFIG.filters)
    const [topNConditions, setTopNConditions] = useState(DEFAULT_CONFIG.topNConditions)
    const [minCompetitorsRanked, setMinCompetitorsRanked] = useState(DEFAULT_CONFIG.relevancy.minCompetitorsRanked)
    const [isProcessing, setIsProcessing] = useState(false)

    const handleWeightChange = (key: keyof typeof weights, value: number[]) => {
        setWeights(prev => ({ ...prev, [key]: value[0] }))
    }

    const addTopNCondition = () => {
        setTopNConditions(prev => [...prev, { count: 1, topN: 20 }])
    }

    const removeTopNCondition = (index: number) => {
        setTopNConditions(prev => prev.filter((_, i) => i !== index))
    }

    const updateTopNCondition = (index: number, field: 'count' | 'topN', val: string) => {
        setTopNConditions(prev => {
            const next = [...prev]
            next[index][field] = Number(val) || 0
            return next
        })
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
                    name: presetName,
                    config: {
                        ...DEFAULT_CONFIG,
                        weights,
                        filters,
                        topNConditions,
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

            toast.success('Preset saved and scores recomputed!')
            setOpen(false)
            onRecomputeComplete() // Notify parent to refresh data
            router.refresh()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="border-dashed bg-white">Configure Scoring Preset</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Preset Configuration</DialogTitle>
                </DialogHeader>

                <div className="space-y-6 mt-4">
                    <div className="grid gap-2">
                        <Label>Preset Name</Label>
                        <Input value={presetName} onChange={e => setPresetName(e.target.value)} disabled={isProcessing} />
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-semibold text-sm border-b pb-2">Global Visibility Filters</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label className="text-xs text-gray-500">Min Volume</Label>
                                <Input type="number" value={filters.minVolume} onChange={e => setFilters(prev => ({ ...prev, minVolume: e.target.value }))} placeholder="e.g. 50" className="h-8" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-gray-500">Max Difficulty</Label>
                                <Input type="number" value={filters.maxDifficulty} onChange={e => setFilters(prev => ({ ...prev, maxDifficulty: e.target.value }))} placeholder="e.g. 60" className="h-8" />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between items-center border-b pb-2">
                            <h4 className="font-semibold text-sm">Relevancy Conditions</h4>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={addTopNCondition}>
                                <Plus className="h-3 w-3 mr-1" /> Add Rule
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-xs text-gray-500">Min. Competitors Ranked (Any Position)</Label>
                            <Input type="number" value={minCompetitorsRanked} onChange={e => setMinCompetitorsRanked(Number(e.target.value))} placeholder="e.g. 3" className="h-8" />
                        </div>

                        {topNConditions.map((cond, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-gray-50 p-2 rounded border">
                                <span className="text-xs">At least</span>
                                <Input type="number" value={cond.count} onChange={e => updateTopNCondition(idx, 'count', e.target.value)} className="h-8 w-16" />
                                <span className="text-xs">competitors in Top</span>
                                <Input type="number" value={cond.topN} onChange={e => updateTopNCondition(idx, 'topN', e.target.value)} className="h-8 w-16" />
                                <Button variant="ghost" size="sm" className="text-red-500 ml-auto h-8 w-8 p-0" onClick={() => removeTopNCondition(idx)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-semibold text-sm border-b pb-2">Formula Weights</h4>

                        {Object.entries(weights).map(([key, val]) => (
                            <div key={key} className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="capitalize">{key} Weight</span>
                                    <span className="font-mono">{val.toFixed(2)}</span>
                                </div>
                                <Slider
                                    value={[val]}
                                    min={0} max={1} step={0.05}
                                    onValueChange={(v) => handleWeightChange(key as keyof typeof weights, v)}
                                    disabled={isProcessing}
                                />
                            </div>
                        ))}
                    </div>

                    <Button
                        className="w-full bg-[#FF8903] hover:bg-[#FEB107] text-white"
                        onClick={handleSaveAndApply}
                        disabled={isProcessing}
                    >
                        {isProcessing ? 'Applying...' : 'Save & Recompute Scores'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
