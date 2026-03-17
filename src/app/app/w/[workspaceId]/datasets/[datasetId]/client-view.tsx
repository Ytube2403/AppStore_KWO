'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import PresetConfigDrawer from './preset-drawer'
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender,
    SortingState,
    ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import React from 'react'
import { Download, Edit2, Check, X, Loader2, ChevronDown, Filter, Sparkles, HelpCircle, Globe, PlayCircle, AlertTriangle, BarChart2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import UpdateDataModal from './update-modal'

const MemoizedTableRow = React.memo(({
    row,
    virtualRow,
    isActive,
    isQualified,
    isSelected,
    onClick
}: {
    row: any;
    virtualRow: any;
    isActive: boolean;
    isQualified: boolean;
    isSelected: boolean;
    onClick: (rowOriginal: any) => void;
}) => {
    return (
        <div
            onClick={() => onClick(row.original)}
            className={`flex border-b transition-colors absolute w-full cursor-pointer 
                ${isActive ? 'bg-[#FF8903]/10 border-l-4 border-l-[#FF8903]' : 'hover:bg-gray-100'} 
                ${isSelected && !isActive ? 'bg-blue-50/50' : ''}
                ${!isQualified ? 'opacity-40 grayscale bg-gray-50' : ''}`}
            style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
            }}
        >
            {row.getVisibleCells().map((cell: any) => (
                <div
                    key={cell.id}
                    className="p-3 border-r last:border-r-0 truncate flex items-center"
                    style={{ width: cell.column.getSize(), flex: `0 0 ${cell.column.getSize()}px` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    )
})
MemoizedTableRow.displayName = 'MemoizedTableRow'

export default function DatasetClientView({ dataset, workspaceId }: { dataset: any, workspaceId: string }) {
    const supabase = createClient()
    const [data, setData] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [sorting, setSorting] = useState<SortingState>([{ id: 'total_score', desc: true }])
    const [activeRow, setActiveRow] = useState<any | null>(null)
    const [rowSelection, setRowSelection] = useState({})
    const [isClearingPreset, setIsClearingPreset] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [isTranslating, setIsTranslating] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false)
    // Job polling state (for async Worker translation)
    const [activeJobId, setActiveJobId] = useState<string | null>(null)
    const [jobProgress, setJobProgress] = useState(0)

    // Preset Config State changes
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

    const handleRowClick = React.useCallback((rowOriginal: any) => {
        setActiveRow(rowOriginal)
    }, [])

    // Dataset Name & Settings Editing
    const [datasetName, setDatasetName] = useState(dataset.name)
    const [datasetMarket, setDatasetMarket] = useState(dataset.market)
    const [datasetConcept, setDatasetConcept] = useState(dataset.concept)
    const [datasetTargetAppUrl, setDatasetTargetAppUrl] = useState<string>(dataset.target_app_url || '')
    const [datasetTargetAppProfile, setDatasetTargetAppProfile] = useState<any>(dataset.target_app_profile || null)

    const [isEditingSettings, setIsEditingSettings] = useState(false)
    const [newName, setNewName] = useState(dataset.name)
    const [newMarket, setNewMarket] = useState(dataset.market || '')
    const [newConcept, setNewConcept] = useState(dataset.concept || '')
    const [newTargetAppUrl, setNewTargetAppUrl] = useState<string>(dataset.target_app_url || '')
    const [isSavingSettings, setIsSavingSettings] = useState(false)

    // Tab 2 — Intent & Clusters state
    const [activeTab, setActiveTab] = useState<'keywords' | 'intent'>('keywords')
    const [isGeneratingProfile, setIsGeneratingProfile] = useState(false)
    const [isStartingAnalysis, setIsStartingAnalysis] = useState(false)
    const [analysisRunId, setAnalysisRunId] = useState<string | null>(null)
    const [analysisProgress, setAnalysisProgress] = useState(0)

    // Basic Filter States
    const [minVolume, setMinVolume] = useState('')
    const [minMaxVolume, setMinMaxVolume] = useState('')
    const [maxDifficulty, setMaxDifficulty] = useState('')
    const [minMyRank, setMinMyRank] = useState('')
    const [showSelectedOnly, setShowSelectedOnly] = useState(false)
    const [hideDisqualified, setHideDisqualified] = useState(true)

    // Derived KPI Metrics
    const myKeywordsCount = useMemo(() => data.filter(k => k.my_rank !== null).length, [data])
    const filteredKeywordsCount = useMemo(() => data.filter(k => k.is_qualified !== false).length, [data])
    const opportunityKeywordsCount = useMemo(() => data.filter(k => k.is_qualified !== false && k.my_rank !== null).length, [data])

    const rankDistribution = useMemo(() => {
        const dist = { '1-10': 0, '11-20': 0, '21-50': 0, '51-100': 0, 'Unranked': 0 }
        data.forEach(k => {
            if (k.my_rank === null) dist['Unranked']++
            else if (k.my_rank <= 10) dist['1-10']++
            else if (k.my_rank <= 20) dist['11-20']++
            else if (k.my_rank <= 50) dist['21-50']++
            else if (k.my_rank <= 100) dist['51-100']++
            else dist['Unranked']++
        })
        return dist
    }, [data])

    const loadData = async () => {
        setIsLoading(true)

        // 1. Fetch Keywords
        const { data: kData, error: kError } = await supabase
            .from('keywords')
            .select('*')
            .eq('dataset_id', dataset.id)
            .limit(10000)

        // 2. Fetch User Selections (if any)
        const { data: { user } } = await supabase.auth.getUser()
        let preSelections: Record<string, boolean> = {}

        if (user) {
            const { data: sData } = await supabase
                .from('selections')
                .select('keyword_id, is_selected, tags, note')
                .eq('dataset_id', dataset.id)
                .eq('user_id', user.id)

            if (sData) {
                sData.forEach(s => {
                    const rowIndex = kData?.findIndex(k => k.id === s.keyword_id)
                    if (rowIndex !== undefined && rowIndex !== -1) {
                        // Apply selection and metadata
                        if (s.is_selected) {
                            if (kData) preSelections[kData[rowIndex].id] = true
                        }
                        if (kData) {
                            kData[rowIndex].is_selected = s.is_selected
                            kData[rowIndex].tags = s.tags || []
                            kData[rowIndex].note = s.note || ''
                        }
                    }
                })
            }
        }

        if (!kError && kData) {
            setData(kData)
            setRowSelection(preSelections)
        } else {
            console.error("Failed to load keywords", kError)
        }
        setIsLoading(false)
    }

    useEffect(() => {
        loadData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataset.id])

    const columns = useMemo<ColumnDef<any>[]>(() => [
        {
            id: 'select',
            header: ({ table }) => (
                <div className="flex items-center justify-center h-full">
                    <Checkbox
                        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
                        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                        aria-label="Select all"
                    />
                </div>
            ),
            cell: ({ row }) => (
                <div className="flex items-center justify-center h-full">
                    <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) => row.toggleSelected(!!value)}
                        aria-label="Select row"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            ),
            size: 50,
        },
        {
            accessorKey: 'keyword',
            header: 'Keyword',
            size: 250,
        },
        {
            accessorKey: 'total_score',
            header: 'Score',
            size: 80,
            cell: (info) => {
                const score = info.getValue() as number
                if (score === null || score === undefined) return <span className="text-gray-300">-</span>

                // Parse Tier
                let tier = 'P3'
                let colorClass = 'text-gray-500'
                if (score >= 80) { tier = 'P0'; colorClass = 'text-red-500 font-bold' }
                else if (score >= 65) { tier = 'P1'; colorClass = 'text-[#FF8903] font-bold' }
                else if (score >= 45) { tier = 'P2'; colorClass = 'text-[#FEB107] font-semibold' }

                return (
                    <div className="flex items-center justify-between w-full pr-4">
                        <span className="font-semibold">{score.toFixed(1)}</span>
                        <span className={`text-[10px] ${colorClass}`}>{tier}</span>
                    </div>
                )
            }
        },
        {
            accessorKey: 'keyword_en',
            header: 'English',
            size: 250,
            cell: (info) => {
                const text = info.getValue() as string
                return text ? <span className="text-gray-600">{text}</span> : <span className="text-gray-300 italic">Not translated</span>
            }
        },
        {
            accessorKey: 'volume',
            header: 'Volume',
            size: 100,
        },
        {
            accessorKey: 'max_volume',
            header: 'Max Vol',
            size: 100,
            cell: (info) => {
                const val = info.getValue() as number | null
                const originalVol = info.row.original.volume ?? 0
                const effectiveVol = !val || val === 0 ? originalVol : val
                return <span className={!val || val === 0 ? "text-gray-400" : "text-gray-500"}>{effectiveVol}</span>
            }
        },
        {
            accessorKey: 'difficulty',
            header: 'Difficulty',
            size: 100,
        },
        {
            accessorKey: 'kei',
            header: 'KEI',
            size: 100,
        },
        {
            accessorKey: 'my_rank',
            header: 'My Rank',
            size: 100,
        },
        {
            accessorKey: 'competitor_ranked_count',
            header: 'Relevancy',
            size: 100,
            cell: (info) => {
                const count = info.getValue() as number
                let badgeClass = "text-gray-400"
                if (count >= 2 && count <= 3) badgeClass = "text-[#FF8903] font-medium"
                else if (count >= 4) badgeClass = "bg-[#FEB107]/20 text-[#FF8903] px-2 py-0.5 rounded font-bold"

                return <span className={badgeClass}>{count || 0}</span>
            }
        }
    ], [])

    const rowSelectionDependency = showSelectedOnly ? rowSelection : null;

    const filteredData = useMemo(() => {
        return data.filter((row, index) => {
            if (minVolume && (row.volume === null || row.volume < parseFloat(minVolume))) return false
            // minMaxVolume: passes if max_volume >= threshold (OR if max_volume is null, let it pass)
            const effectiveMaxVol = !row.max_volume || row.max_volume === 0 ? (row.volume ?? 0) : row.max_volume
            if (minMaxVolume && (effectiveMaxVol < parseFloat(minMaxVolume))) return false
            if (maxDifficulty && (row.difficulty !== null && row.difficulty > parseFloat(maxDifficulty))) return false
            if (minMyRank && (row.my_rank === null || row.my_rank > parseFloat(minMyRank))) return false
            if (hideDisqualified && row.is_qualified === false) return false
            if (showSelectedOnly) {
                // Check if it's currently selected in DB OR temporarily selected in UI state
                if (!row.is_selected && !rowSelection[row.id as keyof typeof rowSelection]) return false
            }
            return true
        })
    }, [data, minVolume, minMaxVolume, maxDifficulty, minMyRank, showSelectedOnly, hideDisqualified, rowSelectionDependency])

    const table = useReactTable({
        data: filteredData,
        columns,
        state: {
            sorting,
            rowSelection,
        },
        enableRowSelection: true,
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: (row) => row.id,
    })

    // Actions
    const handleClearPreset = async () => {
        setIsClearingPreset(true)
        try {
            const rRes = await fetch(`/api/datasets/${dataset.id}/recompute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ presetId: null }) // Using default config
            })
            if (!rRes.ok) {
                const errData = await rRes.json().catch(() => ({}))
                throw new Error(errData.error || 'Failed to reset preset')
            }
            toast.success('Preset cleared and reset to defaults')
            setMinVolume('')
            setMaxDifficulty('')
            setMinMyRank('')
            setHideDisqualified(false)
            setShowSelectedOnly(false)
            loadData()
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setIsClearingPreset(false)
        }
    }

    const handleSaveSettings = async () => {
        if (!newName.trim() || !newName) {
            toast.error("Dataset name is required")
            return
        }
        setIsSavingSettings(true)
        try {
            const res = await fetch(`/api/datasets/${dataset.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName,
                    market: newMarket,
                    concept: newConcept,
                    target_app_url: newTargetAppUrl,
                })
            })
            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}))
                throw new Error(errJson.error || 'Failed to update dataset settings')
            }
            const savedData = await res.json()
            setDatasetName(savedData.name)
            setDatasetMarket(savedData.market)
            setDatasetConcept(savedData.concept)
            if (newTargetAppUrl !== datasetTargetAppUrl) {
                setDatasetTargetAppUrl(newTargetAppUrl)
                setDatasetTargetAppProfile(null)  // cleared on URL change
            }
            setIsEditingSettings(false)
            toast.success('Dataset updated')
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setIsSavingSettings(false)
        }
    }

    // handleSaveSelections removed as the button was changed to Export CSV



    const handleExport = async (format: 'csv' | 'xlsx') => {
        if (!filteredData || filteredData.length === 0) {
            toast("No data to export.")
            return
        }

        setIsExporting(true)
        try {
            // Format data rows
            const formatRow = (row: any) => ({
                Keyword: row.keyword,
                'English Translation': row.keyword_en || '',
                Volume: row.volume,
                'Max Volume': (!row.max_volume || row.max_volume === 0) ? (row.volume ?? '') : row.max_volume,
                Difficulty: row.difficulty,
                KEI: row.kei,
                'My Rank': row.my_rank,
                'Ranked Competitors Count': row.competitor_ranked_count,
                'Top N Count': row.competitor_topn_count,
                'Best Competitor Rank': row.competitor_best_rank,
                'Relevance Score': row.relevancy_score,
                'Total Score': row.total_score,
                Tags: row.tags?.join(', ') || '',
                Note: row.note || ''
            })

            let sortedData = [...filteredData]
            if (sorting.length > 0) {
                const { id, desc } = sorting[0]
                sortedData.sort((a, b) => {
                    let valA = a[id]
                    let valB = b[id]
                    if (valA === null || valA === undefined) valA = desc ? -Infinity : Infinity
                    if (valB === null || valB === undefined) valB = desc ? -Infinity : Infinity

                    if (valA < valB) return desc ? 1 : -1
                    if (valA > valB) return desc ? -1 : 1
                    return 0
                })
            }

            const selectedData = sortedData.filter(row => rowSelection[row.id as keyof typeof rowSelection]).map(formatRow)
            const exportFilteredData = sortedData.map(formatRow)

            const res = await fetch(`/api/datasets/${dataset.id}/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    format,
                    datasetName,
                    selectedData,
                    filteredData: exportFilteredData,
                    presetMetadata: {
                        'Min Volume': minVolume,
                        'Max Difficulty': maxDifficulty,
                        'Min My Rank': minMyRank,
                        'Hide Unqualified': hideDisqualified,
                        'User Selection Count': selectedData.length,
                        'Export Timestamp': new Date().toISOString()
                    }
                })
            })

            if (!res.ok) throw new Error('Failed to export dataset')

            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            const ext = format === 'csv' ? 'csv' : 'xlsx'
            link.download = `ASO_Export_${datasetName}_${new Date().toISOString().split('T')[0]}.${ext}`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)

            toast.success(`Exported ${format.toUpperCase()} successfully!`)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setIsExporting(false)
        }
    }

    const handleTranslateFiltered = async () => {
        if (!filteredData || filteredData.length === 0) {
            toast("No keywords to translate.")
            return
        }

        setIsTranslating(true)
        try {
            // Find keywords that don't have a translation yet
            const keysToTranslate = filteredData.filter(row => !row.keyword_en).map(row => row.id)

            if (keysToTranslate.length === 0) {
                toast.success("All keywords in the current view are already translated!")
                setIsTranslating(false)
                return
            }

            const res = await fetch(`/api/datasets/${dataset.id}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywordIds: keysToTranslate })
            })

            const result = await res.json()
            if (!res.ok) throw new Error(result.error || 'Translation failed')

            // ── Async Worker path (USE_WORKER_TRANSLATION=true) ──────────────
            if (result.async && result.jobId) {
                setActiveJobId(result.jobId)
                setJobProgress(0)
                toast.info(`Translating ${keysToTranslate.length} keywords in background...`)
                // Don't setIsTranslating(false) yet — button stays disabled while job runs
                return
            }

            // ── Synchronous path (USE_WORKER_TRANSLATION=false, default) ────
            if (result.errors && result.errors.length > 0) {
                console.warn("Some translations failed:", result.errors)
                toast.warning(`Translated ${result.updatedCount} keywords. ${result.errors.length} failed (Check console).`)
            } else {
                toast.success(`Successfully translated ${result.updatedCount} keywords.`)
            }
            loadData() // Refresh data to show translations

        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setIsTranslating(false)
        }
    }

    // ── Job polling useEffect — polls Supabase directly on the client ─────────
    useEffect(() => {
        if (!activeJobId) return

        const interval = setInterval(async () => {
            try {
                const { data: job, error } = await supabase
                    .from('analysis_jobs')
                    .select('status, progress_percent, error_message, completed_at')
                    .eq('id', activeJobId)
                    .single()

                if (error || !job) return

                setJobProgress(job.progress_percent ?? 0)

                if (job.status === 'completed') {
                    clearInterval(interval)
                    setActiveJobId(null)
                    setJobProgress(0)
                    setIsTranslating(false)
                    loadData()
                    toast.success('Translation complete! Keywords updated.')
                } else if (job.status === 'failed') {
                    clearInterval(interval)
                    setActiveJobId(null)
                    setJobProgress(0)
                    setIsTranslating(false)
                    toast.error(`Translation failed: ${job.error_message || 'Unknown error'}`)
                } else if (job.status === 'cancelled') {
                    clearInterval(interval)
                    setActiveJobId(null)
                    setJobProgress(0)
                    setIsTranslating(false)
                    toast.info('Translation was cancelled.')
                }
            } catch (err) {
                console.error('Polling error:', err)
            }
        }, 5000)  // poll every 5s

        return () => clearInterval(interval)
    }, [activeJobId, supabase])

    // Virtualizer
    const parentRef = useRef<HTMLDivElement>(null)

    const { rows } = table.getRowModel()

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 44, // 44px row height as per spec
        overscan: 10,
    })

    return (
        <>
            <div className="flex flex-col h-full w-[calc(100%-3rem)] mx-auto bg-white border-x border-gray-200 relative overflow-hidden shadow-[0_0_20px_rgb(0,0,0,0.03)]">
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b bg-white z-10 shrink-0">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 group">
                            <h2 className="text-xl font-bold text-gray-900">{datasetName}</h2>

                            {(datasetMarket || datasetConcept) && (
                                <div className="flex gap-2 ml-2">
                                    {datasetMarket && (
                                        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                                            {datasetMarket}
                                        </span>
                                    )}
                                    {datasetConcept && (
                                        <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                                            {datasetConcept}
                                        </span>
                                    )}
                                </div>
                            )}

                            <Dialog open={isEditingSettings} onOpenChange={setIsEditingSettings}>
                                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500" onClick={() => setIsEditingSettings(true)}>
                                    <Edit2 className="h-3.5 w-3.5" />
                                </Button>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Dataset Settings</DialogTitle>
                                    </DialogHeader>
                                    <div className="py-4 space-y-4">
                                        <div className="space-y-2">
                                            <Label>Dataset Name <span className="text-red-500">*</span></Label>
                                            <Input
                                                value={newName}
                                                onChange={e => setNewName(e.target.value)}
                                                placeholder="Dataset Name"
                                                autoFocus
                                                onKeyDown={e => e.key === 'Enter' && handleSaveSettings()}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Country / Market <span className="text-gray-400 font-normal">(Optional)</span></Label>
                                            <Input
                                                value={newMarket}
                                                onChange={e => setNewMarket(e.target.value)}
                                                placeholder="e.g. US, Brazil, Global"
                                                onKeyDown={e => e.key === 'Enter' && handleSaveSettings()}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Concept / Topic <span className="text-gray-400 font-normal">(Optional)</span></Label>
                                            <Input
                                                value={newConcept}
                                                onChange={e => setNewConcept(e.target.value)}
                                                placeholder="e.g. Brand, Casual, Competitors"
                                                onKeyDown={e => e.key === 'Enter' && handleSaveSettings()}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="flex items-center gap-1">
                                                <Globe className="h-3.5 w-3.5" /> Target App Store URL <span className="text-gray-400 font-normal">(Optional)</span>
                                            </Label>
                                            <Input
                                                value={newTargetAppUrl}
                                                onChange={e => setNewTargetAppUrl(e.target.value)}
                                                placeholder="https://apps.apple.com/... or https://play.google.com/..."
                                            />
                                            <p className="text-[11px] text-gray-400">Used to generate an AI-powered App Profile for Intent Analysis.</p>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsEditingSettings(false)} disabled={isSavingSettings}>Cancel</Button>
                                        <Button onClick={handleSaveSettings} disabled={isSavingSettings || !newName.trim()}>Save Changes</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                        </div>

                        {isLoading ? (
                            <span className="text-xs text-muted-foreground">Loading keywords...</span>
                        ) : (
                            <span className="text-xs text-muted-foreground">{filteredData.length} keywords loaded</span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" disabled={isExporting}>
                                    {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                                    Export
                                    <ChevronDown className="h-3 w-3 ml-2" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleExport('csv')} className="cursor-pointer">
                                    Export as CSV (Canonical)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleExport('xlsx')} className="cursor-pointer">
                                    Export as Excel (.xlsx)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <PresetConfigDrawer
                            workspaceId={workspaceId}
                            datasetId={dataset.id}
                            onRecomputeComplete={() => {
                                setHasUnsavedChanges(false)
                                loadData()
                            }}
                            onConfigMutated={setHasUnsavedChanges}
                        />
                    </div>
                </div>

                <div className={`flex w-full items-stretch transition-all duration-300 origin-top overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0 border-b-0' : 'max-h-[500px] opacity-100 border-b'}`}>
                    <TooltipProvider delayDuration={150}>
                        <div className="p-6 bg-gray-50/50 flex flex-col md:flex-row justify-between gap-6 shadow-sm z-10 shrink-0 flex-1">
                            <div className="flex flex-wrap items-center gap-4 text-sm flex-1">
                                <div className="flex flex-col gap-1 bg-white p-4 rounded-xl border shadow-sm flex-1 min-w-[160px]">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">My Keywords</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <HelpCircle className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    <p className="max-w-xs">Total number of keywords imported into this dataset directly from your tool.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <span className="h-6 w-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-medium">K</span>
                                    </div>
                                    <span className="text-3xl font-black text-gray-900 mt-1">{myKeywordsCount}</span>
                                </div>
                                <div className="flex flex-col gap-1 bg-white p-4 rounded-xl border shadow-sm flex-1 min-w-[160px]">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-[#FF8903] font-bold uppercase tracking-wider">Filtered</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <HelpCircle className="h-3.5 w-3.5 text-[#FF8903]/60 cursor-help" />
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    <p className="max-w-xs">Keywords remaining after applying the Relevancy gates, Min Volume, Max Difficulty, and Max Rank conditions.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <span className="h-6 w-6 rounded-full bg-[#FF8903]/10 flex items-center justify-center text-[#FF8903] font-medium">F</span>
                                    </div>
                                    <span className="text-3xl font-black text-[#FF8903] mt-1">{filteredKeywordsCount}</span>
                                </div>
                                <div className="flex flex-col gap-1 bg-white p-4 rounded-xl border shadow-sm flex-1 min-w-[160px]">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-[#FEB107] font-bold uppercase tracking-wider">Opportunity</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <HelpCircle className="h-3.5 w-3.5 text-[#FEB107]/60 cursor-help" />
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    <p className="max-w-xs">Keywords that passed all filters AND are currently considered strong priority (P0, P1, P2) indicating an actionable keyword.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <span className="h-6 w-6 rounded-full bg-[#FEB107]/10 flex items-center justify-center text-[#FEB107] font-medium">O</span>
                                    </div>
                                    <span className="text-3xl font-black text-[#FEB107] mt-1">{opportunityKeywordsCount}</span>
                                </div>
                                <div className="flex flex-col gap-1 bg-white p-4 rounded-xl border shadow-sm flex-1 min-w-[160px]">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Total</span>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <HelpCircle className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    <p className="max-w-xs">The absolute total of known keywords in this dataset, including competitors' unseen terms.</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <span className="h-6 w-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-medium">T</span>
                                    </div>
                                    <span className="text-3xl font-black text-gray-900 mt-1">{data.length}</span>
                                </div>
                            </div>
                        </div>
                    </TooltipProvider>

                    <div className="flex gap-4 p-5 shrink-0 bg-white rounded-xl border shadow-sm min-w-[320px] justify-between items-end h-[120px]">
                        {['1-10', '11-20', '21-50', '51-100', 'Unranked'].map(key => {
                            const count = rankDistribution[key as keyof typeof rankDistribution]
                            const maxDist = Math.max(...Object.values(rankDistribution)) || 1
                            const heightPc = count > 0 ? Math.max((count / maxDist) * 100, 8) : 0

                            let color = 'bg-[#E5E7EB]'
                            if (key === '1-10') color = 'bg-[#FFB107]'
                            else if (key === '11-20') color = 'bg-[#FFD166]'
                            else if (key === '21-50') color = 'bg-[#E5E7EB]'
                            else if (key === '51-100') color = 'bg-[#CECECE]'
                            else if (key === 'Unranked') color = 'bg-[#F3F4F6]'

                            return (
                                <div key={key} className="flex flex-col items-center justify-end gap-1.5 w-12 relative group">
                                    <span className="text-xs text-gray-600 font-bold leading-none">{count}</span>
                                    <div className="w-full flex items-end h-[60px]">
                                        <div className={`w-full ${color} rounded-t-sm transition-all duration-500 group-hover:opacity-80`} style={{ height: `${heightPc}%` }}></div>
                                    </div>
                                    <span className="text-[10px] text-gray-500 font-semibold leading-none whitespace-nowrap">{key}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="p-3 border-b bg-white flex gap-4 flex-wrap items-center">
                    <div className="flex gap-2 flex-wrap items-center flex-1">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-2 flex items-center gap-1">
                            <Filter className="h-3 w-3" /> Filters:
                        </span>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={`h-8 rounded-full text-xs font-medium border-dashed ${minVolume ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                    Min Vol {minVolume ? `≥ ${minVolume}` : ''} <ChevronDown className="h-3 w-3 ml-1 text-gray-400" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-4" align="start">
                                <div className="space-y-3">
                                    <h4 className="font-medium text-sm">Volume Threshold</h4>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">≥</span>
                                        <Input
                                            type="number"
                                            placeholder="e.g. 100"
                                            value={minVolume}
                                            onChange={e => setMinVolume(e.target.value)}
                                            className="h-8 shadow-sm flex-1"
                                        />
                                        {minVolume && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMinVolume('')}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={`h-8 rounded-full text-xs font-medium border-dashed ${minMaxVolume ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                    Min Max Vol {minMaxVolume ? `≥ ${minMaxVolume}` : ''} <ChevronDown className="h-3 w-3 ml-1 text-gray-400" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-4" align="start">
                                <div className="space-y-3">
                                    <h4 className="font-medium text-sm">Max Volume Threshold</h4>
                                    <p className="text-xs text-gray-500">Include keywords where <b>Max Volume</b> ≥ value. Useful for keywords with low current volume but high peak potential.</p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">≥</span>
                                        <Input
                                            type="number"
                                            placeholder="e.g. 50"
                                            value={minMaxVolume}
                                            onChange={e => setMinMaxVolume(e.target.value)}
                                            className="h-8 shadow-sm flex-1"
                                        />
                                        {minMaxVolume && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMinMaxVolume('')}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={`h-8 rounded-full text-xs font-medium border-dashed ${maxDifficulty ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                    Max Diff {maxDifficulty ? `≤ ${maxDifficulty}` : ''} <ChevronDown className="h-3 w-3 ml-1 text-gray-400" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-4" align="start">
                                <div className="space-y-3">
                                    <h4 className="font-medium text-sm">Difficulty Ceiling</h4>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">≤</span>
                                        <Input
                                            type="number"
                                            placeholder="e.g. 50"
                                            value={maxDifficulty}
                                            onChange={e => setMaxDifficulty(e.target.value)}
                                            className="h-8 shadow-sm flex-1"
                                        />
                                        {maxDifficulty && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMaxDifficulty('')}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className={`h-8 rounded-full text-xs font-medium border-dashed ${minMyRank ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                                    My Rank {minMyRank ? `≤ ${minMyRank}` : ''} <ChevronDown className="h-3 w-3 ml-1 text-gray-400" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-4" align="start">
                                <div className="space-y-3">
                                    <h4 className="font-medium text-sm">Rank Threshold</h4>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-500">≤</span>
                                        <Input
                                            type="number"
                                            placeholder="Top X (e.g. 50)"
                                            value={minMyRank}
                                            onChange={e => setMinMyRank(e.target.value)}
                                            className="h-8 shadow-sm flex-1"
                                        />
                                        {minMyRank && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMinMyRank('')}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex items-center gap-4">
                        <UpdateDataModal
                            workspaceId={workspaceId}
                            datasetId={dataset.id}
                            datasetName={dataset.name}
                            existingMyApp={dataset.my_rank_column_name}
                            existingCompetitors={dataset.competitor_column_names}
                        />

                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleTranslateFiltered}
                            disabled={isTranslating}
                            className="bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 h-8 font-medium shadow-sm transition-colors border border-blue-200/50"
                        >
                            {isTranslating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                            {isTranslating ? 'Translating...' : 'Translate English'}
                        </Button>

                        <div className="flex items-center gap-4 border-l pl-4 border-gray-200 h-8">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="hideDisqual"
                                    checked={hideDisqualified}
                                    onCheckedChange={(val) => setHideDisqualified(!!val)}
                                />
                                <label htmlFor="hideDisqual" className="text-xs font-medium cursor-pointer text-gray-700 select-none">
                                    Hide Unqualified
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="showSelected"
                                    checked={showSelectedOnly}
                                    onCheckedChange={(val) => setShowSelectedOnly(!!val)}
                                />
                                <label htmlFor="showSelected" className="text-xs font-medium cursor-pointer text-gray-700 select-none">
                                    Show Selected Only
                                </label>
                            </div>
                        </div>

                        <div className="pl-4 ml-1 border-l border-gray-200">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleClearPreset}
                                disabled={isClearingPreset}
                                className="bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 h-8 font-medium shadow-sm transition-colors border border-red-200/50"
                            >
                                {isClearingPreset ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                                {isClearingPreset ? 'Resetting...' : 'Reset Default'}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex border-b bg-white px-4 shrink-0">
                    <button
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'keywords'
                                ? 'border-[#FF8903] text-[#FF8903]'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                        onClick={() => setActiveTab('keywords')}
                    >
                        Keywords
                    </button>
                    <button
                        className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                            activeTab === 'intent'
                                ? 'border-[#FF8903] text-[#FF8903]'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                        onClick={() => setActiveTab('intent')}
                    >
                        <BarChart2 className="h-3.5 w-3.5" />
                        Intent & Clusters
                        {datasetTargetAppProfile && (
                            <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5 font-semibold">AI</span>
                        )}
                    </button>
                </div>

                {activeTab === 'keywords' && (
                <>
                {/* Main Table Area */}
                <div className="flex-1 min-h-0 flex flex-col relative">

                    {hasUnsavedChanges && (
                        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm font-medium px-4 py-2 flex items-center justify-center animate-in slide-in-from-top-2 shrink-0">
                            <Sparkles className="h-4 w-4 mr-2" />
                            You have unapplied modifications to the Preset Configuration. Your current Table view might not reflect these updates yet.
                        </div>
                    )}

                    <div className="flex-1 min-h-0 flex relative bg-white">
                        {/* Left Table Section + Floating Bar Wrapper */}
                        <div className="flex-1 min-h-0 flex flex-col relative min-w-0">
                            {/* Virtualized Table Container */}
                            <div ref={parentRef} onScroll={(e) => {
                                if (e.currentTarget.scrollTop > 50 && !isCollapsed) setIsCollapsed(true);
                                else if (e.currentTarget.scrollTop <= 10 && isCollapsed) setIsCollapsed(false);
                            }} className="flex-1 overflow-auto bg-white relative">
                                <div className="w-full text-sm text-left inline-block min-w-max">
                                    {/* Header */}
                                    <div className="sticky top-0 bg-gray-100 z-10 shadow-sm flex flex-col w-full">
                                        {table.getHeaderGroups().map(headerGroup => (
                                            <div key={headerGroup.id} className="flex border-b">
                                                {headerGroup.headers.map(header => (
                                                    <div
                                                        key={header.id}
                                                        style={{ width: header.getSize(), flex: `0 0 ${header.getSize()}px` }}
                                                        className="p-3 font-semibold text-gray-700 border-r last:border-r-0 cursor-pointer select-none hover:bg-gray-200"
                                                        onClick={header.column.getToggleSortingHandler()}
                                                    >
                                                        <div className="flex items-center gap-1 whitespace-nowrap">
                                                            {flexRender(
                                                                header.column.columnDef.header,
                                                                header.getContext()
                                                            )}
                                                            {{
                                                                asc: ' 🔼',
                                                                desc: ' 🔽',
                                                            }[header.column.getIsSorted() as string] ?? null}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                    {/* Body */}
                                    <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
                                        {virtualizer.getVirtualItems().map((virtualRow) => {
                                            const row = rows[virtualRow.index]
                                            return (
                                                <MemoizedTableRow
                                                    key={row.id}
                                                    row={row}
                                                    virtualRow={virtualRow}
                                                    isActive={activeRow?.id === row.original.id}
                                                    isQualified={row.original.is_qualified !== false}
                                                    isSelected={row.getIsSelected()}
                                                    onClick={handleRowClick}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>

                                {!isLoading && data.length === 0 && (
                                    <div className="flex items-center justify-center h-40 text-gray-500">
                                        No keywords found for this dataset.
                                    </div>
                                )}
                            </div>


                            {/* Floating Bottom Action Pill */}
                            <div className="fixed bottom-8 left-[calc(50%-160px)] -translate-x-1/2 shadow-[0_8px_30px_rgb(0,0,0,0.16)] border border-gray-300 rounded-full px-8 py-4 bg-white/95 backdrop-blur-md z-[100] flex items-center justify-between w-max min-w-[800px] max-w-[90%]">
                                <div className="text-sm font-semibold text-gray-600 flex items-center gap-6 shrink-0">
                                    <span><b className="text-black text-base">{filteredData.length}</b> / {data.length} <span className="text-gray-400 font-medium ml-0.5">KWs</span></span>
                                    <span className="w-0.5 h-5 bg-gray-200 rounded-full hidden sm:block"></span>
                                    <span className="hidden sm:inline">
                                        Avg Vol: <b className="text-black ml-1">
                                            {filteredData.length > 0
                                                ? Math.round(filteredData.reduce((acc, curr) => acc + (curr.volume || 0), 0) / filteredData.length)
                                                : 0}
                                        </b>
                                    </span>
                                    <span className="hidden sm:inline">
                                        Avg Dif: <b className="text-black ml-1">
                                            {filteredData.length > 0
                                                ? Math.round(filteredData.reduce((acc, curr) => acc + (curr.difficulty || 0), 0) / filteredData.length)
                                                : 0}
                                        </b>
                                    </span>
                                    <span className="w-0.5 h-5 bg-gray-200 rounded-full"></span>
                                    <span>
                                        Ranked: <b className="text-[#FF8903] ml-1 text-base">
                                            {filteredData.filter(k => k.my_rank !== null).length}
                                        </b>
                                        <span className="text-gray-400 font-medium ml-1 hidden lg:inline">({filteredData.filter(k => k.my_rank === null).length} Unranked)</span>
                                    </span>
                                </div>

                                <div className={`flex items-center gap-4 shrink-0 ml-6 pl-6 border-l border-gray-200 transition-opacity duration-300 ${Object.keys(rowSelection).length > 0 ? 'opacity-100' : 'opacity-40'}`}>
                                    <span className={`text-base font-bold ${Object.keys(rowSelection).length > 0 ? 'text-[#FF8903]' : 'text-gray-500'}`}>
                                        {Object.keys(rowSelection).length} <span className="text-sm font-semibold">Selected</span>
                                    </span>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="ghost" className="rounded-full h-10 px-4 text-sm" onClick={() => setRowSelection({})} disabled={Object.keys(rowSelection).length === 0}>Clear</Button>
                                        <Button size="sm" className="bg-[#FF8903] text-white hover:bg-[#FEB107] rounded-full px-6 h-10 shadow-sm text-sm disabled:opacity-50" onClick={() => handleExport('csv')} disabled={Object.keys(rowSelection).length === 0 || isExporting}>
                                            {isExporting ? 'Exporting...' : 'Export Selected (CSV)'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right Floating Proof Panel */}
                        {activeRow && (
                            <div className="absolute right-0 top-0 h-full w-[360px] bg-white/95 backdrop-blur-md border-l shadow-[-10px_0_30px_rgb(0,0,0,0.05)] p-5 z-20 flex flex-col gap-4 overflow-y-auto animate-in slide-in-from-right-8 fade-in duration-300">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Proof Panel</h3>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full -mt-1 -mr-1" onClick={() => setActiveRow(null)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="space-y-5 flex-1 scrollbar-thin">
                                    <div>
                                        <div className="text-xl font-black text-gray-900 leading-tight">{activeRow.keyword}</div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 text-xs bg-gray-50/80 p-4 rounded-xl border border-gray-100">
                                        <div className="flex flex-col gap-1"><span className="text-gray-500 font-medium">Volume</span> <span className="font-bold text-sm">{activeRow.volume || '-'}</span></div>
                                        <div className="flex flex-col gap-1"><span className="text-gray-500 font-medium">Difficulty</span> <span className="font-bold text-sm">{activeRow.difficulty !== null ? activeRow.difficulty : '-'}</span></div>
                                        <div className="flex flex-col gap-1"><span className="text-gray-500 font-medium">KEI</span> <span className="font-bold text-sm">{activeRow.kei || '-'}</span></div>
                                        <div className="flex flex-col gap-1"><span className="text-gray-500 font-medium">My Rank</span> <span className="font-bold text-sm text-[#FF8903]">{activeRow.my_rank || '-'}</span></div>
                                    </div>

                                    <div>
                                        <h4 className="text-[11px] font-bold uppercase text-gray-400 mb-2.5">Competitor Ranks</h4>
                                        <div className="bg-white rounded-xl border shadow-sm overflow-hidden divide-y">
                                            {Object.entries(activeRow.competitor_ranks || {}).map(([comp, rank]: [string, any]) => (
                                                <div key={comp} className="flex justify-between items-center p-3 hover:bg-gray-50 transition-colors">
                                                    <span className="text-xs font-medium text-gray-600 truncate w-[200px]" title={comp}>{comp}</span>
                                                    <span className="font-bold text-sm">{rank || '-'}</span>
                                                </div>
                                            ))}
                                            {(!activeRow.competitor_ranks || Object.keys(activeRow.competitor_ranks).length === 0) && (
                                                <div className="p-4 text-center text-xs text-gray-400 italic">No competitor data found</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="bg-white rounded-xl border shadow-sm p-4">
                                        <h4 className="text-[11px] font-bold uppercase text-gray-400 mb-3">Relevancy Metrics</h4>
                                        <div className="text-xs text-gray-600 space-y-2.5">
                                            <div className="flex justify-between items-center"><span className="font-medium">Ranked Count (Top 100):</span> <span className="font-bold text-[#FF8903] text-sm bg-[#FF8903]/10 px-2 py-0.5 rounded">{activeRow.competitor_ranked_count}</span></div>
                                            <div className="flex justify-between items-center"><span className="font-medium">Top N Count:</span> <span className="font-bold">{activeRow.competitor_topn_count}</span></div>
                                            <div className="flex justify-between items-center"><span className="font-medium">Best Rank:</span> <span className="font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded">{activeRow.competitor_best_rank || '-'}</span></div>
                                            <div className="flex justify-between items-center pt-2 border-t mt-2"><span className="font-medium">Total Score:</span> <span className="font-black text-base">{activeRow.total_score?.toFixed(1) || '-'}</span></div>
                                        </div>
                                    </div>

                                    {(activeRow.note || (activeRow.tags && activeRow.tags.length > 0)) && (
                                        <div className="pt-2">
                                            <h4 className="text-[11px] font-bold uppercase text-gray-400 mb-2">My Annotations</h4>
                                            <div className="bg-[#FFF8E7] rounded-xl border border-[#FF8903]/20 p-4 flex flex-col gap-3">
                                                {activeRow.tags && activeRow.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {activeRow.tags.map((tag: string) => (
                                                            <span key={tag} className="text-[10px] bg-white border border-[#FEB107] px-2.5 py-1 rounded-full text-[#FF8903] font-bold shadow-sm">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {activeRow.note && (
                                                    <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{activeRow.note}</p>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                </> )}

                {activeTab === 'intent' && (
                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-gray-50/40 p-8 gap-6">
                        {/* State A: No target_app_url set */}
                        {!datasetTargetAppUrl && (
                            <div className="max-w-md w-full bg-white rounded-2xl border shadow-sm p-8 flex flex-col items-center text-center gap-4">
                                <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center">
                                    <Globe className="h-7 w-7 text-gray-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 text-lg">Add your Target App URL</h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        To run Intent Analysis, link this dataset to an App Store or Google Play page so we can build a Semantic App Profile.
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    className="gap-2 bg-[#FF8903] hover:bg-[#FEB107] text-white"
                                    onClick={() => { setNewTargetAppUrl(datasetTargetAppUrl); setIsEditingSettings(true); setActiveTab('keywords') }}
                                >
                                    <Edit2 className="h-4 w-4" />
                                    Open Dataset Settings
                                </Button>
                            </div>
                        )}

                        {/* State B: Has URL but no profile yet (not running) */}
                        {datasetTargetAppUrl && !datasetTargetAppProfile && !analysisRunId && (
                            <div className="max-w-lg w-full flex flex-col gap-4">
                                <div className="bg-white rounded-2xl border shadow-sm p-8 flex flex-col items-center text-center gap-4">
                                    <div className="h-14 w-14 rounded-full bg-[#FF8903]/10 flex items-center justify-center">
                                        <Sparkles className="h-7 w-7 text-[#FF8903]" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-900 text-lg">Generate App Profile</h3>
                                        <p className="text-sm text-gray-500 mt-1">
                                            We&apos;ll scrape your App Store page and use Gemini AI to build a Semantic Profile — identifying your app&apos;s primary use cases and irrelevant intents.
                                        </p>
                                        <p className="text-xs text-gray-400 mt-2 font-mono break-all">{datasetTargetAppUrl}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={isGeneratingProfile}
                                        className="gap-2 bg-[#FF8903] hover:bg-[#FEB107] text-white min-w-[180px]"
                                        onClick={async () => {
                                            setIsGeneratingProfile(true)
                                            try {
                                                const res = await fetch(`/api/datasets/${dataset.id}/generate-profile`, { method: 'POST' })
                                                const json = await res.json()
                                                if (!res.ok) throw new Error(json.error || 'Failed to generate profile')
                                                setDatasetTargetAppProfile(json.profile)
                                                toast.success(`Profile generated for ${json.app?.title || 'your app'}!`)
                                            } catch (e: any) {
                                                toast.error(e.message)
                                            } finally {
                                                setIsGeneratingProfile(false)
                                            }
                                        }}
                                    >
                                        {isGeneratingProfile ? (
                                            <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                                        ) : (
                                            <><Sparkles className="h-4 w-4" /> Generate Profile</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* State B2: Has profile — show summary card + Start Analysis */}
                        {datasetTargetAppUrl && datasetTargetAppProfile && !analysisRunId && (
                            <div className="max-w-lg w-full flex flex-col gap-4">
                                <div className="bg-white rounded-2xl border shadow-sm p-6 flex flex-col gap-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">App Profile</p>
                                            <h3 className="font-semibold text-gray-900">{datasetTargetAppProfile.title}</h3>
                                            <p className="text-xs text-gray-500">{datasetTargetAppProfile.category}</p>
                                        </div>
                                        <span className="text-[10px] bg-emerald-100 text-emerald-700 rounded-full px-2 py-1 font-semibold shrink-0">AI Profile</span>
                                    </div>
                                    {datasetTargetAppProfile.primary_use_cases?.length > 0 && (
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Primary Use Cases</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {datasetTargetAppProfile.primary_use_cases.map((uc: string) => (
                                                    <span key={uc} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2.5 py-0.5">{uc}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {datasetTargetAppProfile.negative_intents?.length > 0 && (
                                        <div>
                                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Excluded Intents</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {datasetTargetAppProfile.negative_intents.map((ni: string) => (
                                                    <span key={ni} className="text-[11px] bg-red-50 text-red-600 border border-red-100 rounded-full px-2.5 py-0.5">{ni}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col gap-3">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                        <div className="flex-1 text-sm text-amber-800">
                                            <p className="font-semibold mb-0.5">Cost Estimate</p>
                                            <p className="text-xs">
                                                {(() => {
                                                    const cnt = data.filter(k => (k.base_score ?? 0) >= 60 && (k.volume ?? 0) >= 10 && (k.difficulty ?? 100) <= 70).length
                                                    return <>{cnt} keywords eligible for SERP analysis.{cnt > 500 && <span className="font-bold text-amber-900"> (capped at 500)</span>}</>
                                                })()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            disabled={isStartingAnalysis || data.length === 0}
                                            className="flex-1 bg-[#FF8903] hover:bg-[#FEB107] text-white gap-2"
                                            onClick={async () => {
                                                const eligible = data
                                                    .filter(k => (k.base_score ?? 0) >= 60 && (k.volume ?? 0) >= 10 && (k.difficulty ?? 100) <= 70)
                                                    .map((k: any) => k.id)
                                                    .slice(0, 500)
                                                if (eligible.length === 0) return toast.error('No eligible keywords found. Adjust your filters.')
                                                setIsStartingAnalysis(true)
                                                try {
                                                    const res = await fetch(`/api/datasets/${dataset.id}/analyze`, {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ keywordIds: eligible })
                                                    })
                                                    const json = await res.json()
                                                    if (!res.ok) throw new Error(json.error || 'Failed to start analysis')
                                                    setAnalysisRunId(json.runId)
                                                    setAnalysisProgress(0)
                                                    toast.success(`Analysis started — ${eligible.length} keywords queued`)
                                                } catch (e: any) {
                                                    toast.error(e.message)
                                                } finally {
                                                    setIsStartingAnalysis(false)
                                                }
                                            }}
                                        >
                                            {isStartingAnalysis
                                                ? <><Loader2 className="h-4 w-4 animate-spin" /> Starting...</>
                                                : <><PlayCircle className="h-4 w-4" /> Start Analysis</>}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="gap-2"
                                            onClick={() => { setNewTargetAppUrl(datasetTargetAppUrl); setIsEditingSettings(true); setActiveTab('keywords') }}
                                        >
                                            <Globe className="h-4 w-4" /> Change URL
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* State C: Analysis job running */}
                        {analysisRunId && (
                            <div className="max-w-md w-full bg-white rounded-2xl border shadow-sm p-8 flex flex-col items-center text-center gap-6">
                                <div className="h-14 w-14 rounded-full bg-[#FF8903]/10 flex items-center justify-center">
                                    <Loader2 className="h-7 w-7 text-[#FF8903] animate-spin" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 text-lg">Fetching SERP data…</h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        The Worker is fetching search results for your keywords. This may take a few minutes.
                                    </p>
                                </div>
                                <div className="w-full">
                                    <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                                        <span>Progress</span>
                                        <span>{analysisProgress}%</span>
                                    </div>
                                    <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-[#FF8903] transition-all duration-500"
                                            style={{ width: `${analysisProgress}%` }}
                                        />
                                    </div>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { setAnalysisRunId(null); setAnalysisProgress(0) }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        )}
                    </div>
                )}

            </div>

            {/* Floating Progress Toast — shown while async translation job is running */}
            {activeJobId && (
                <div
                    className="fixed bottom-5 right-5 z-50 w-72 rounded-2xl border border-orange-200 bg-white shadow-xl"
                    role="status"
                    aria-live="polite"
                    aria-label="Translation progress"
                >
                    <div className="p-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-50">
                                <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-gray-900">Translating keywords</p>
                                <p className="text-xs text-gray-500">{jobProgress}% complete</p>
                            </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-orange-100 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-orange-500 transition-all duration-500 ease-out"
                                style={{ width: `${jobProgress}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

