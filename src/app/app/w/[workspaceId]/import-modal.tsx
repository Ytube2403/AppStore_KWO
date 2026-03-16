'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ImportModal({ workspaceId }: { workspaceId: string }) {
    const [open, setOpen] = useState(false)
    const router = useRouter()
    const [file, setFile] = useState<File | null>(null)
    const [datasetName, setDatasetName] = useState('')
    const [market, setMarket] = useState('')
    const [concept, setConcept] = useState('')
    const [headers, setHeaders] = useState<string[]>([])
    const [parsedData, setParsedData] = useState<any[]>([])

    // Mapping State
    const [keywordCol, setKeywordCol] = useState('')
    const [volumeCol, setVolumeCol] = useState('')
    const [maxVolumeCol, setMaxVolumeCol] = useState('')
    const [difficultyCol, setDifficultyCol] = useState('')
    const [keiCol, setKeiCol] = useState('')
    const [appNameCol, setAppNameCol] = useState('')
    const [rankCol, setRankCol] = useState('')

    // App Selection State
    const [uniqueApps, setUniqueApps] = useState<string[]>([])
    const [myApp, setMyApp] = useState('')
    const [competitorApps, setCompetitorApps] = useState<string[]>([])

    const [isProcessing, setIsProcessing] = useState(false)

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return
        setFile(f)
        if (!datasetName) {
            // Auto fill name based on file (removing .csv)
            setDatasetName(f.name.replace(/\.[^/.]+$/, ''))
        }

        Papa.parse(f, {
            header: true,
            skipEmptyLines: 'greedy',
            complete: (results) => {
                if (results.meta.fields) {
                    setHeaders(results.meta.fields)
                    setParsedData(results.data)

                    // Auto-mapping heuristics for AppTweak
                    const h = results.meta.fields.map(field => field.toLowerCase())

                    const guessCol = (keywords: string[]) => {
                        return results.meta.fields?.find(field =>
                            keywords.some(k => field.toLowerCase().includes(k))
                        ) || ''
                    }

                    const foundAppNameCol = guessCol(['app name', 'app'])
                    const foundRankCol = guessCol(['rank'])

                    setKeywordCol(guessCol(['keyword']))
                    setVolumeCol(guessCol(['volume']))
                    // Guess max volume by checking precisely, else blank
                    setMaxVolumeCol(guessCol(['max volume', 'max. volume']))
                    setDifficultyCol(guessCol(['difficulty']))
                    setKeiCol(guessCol(['kei', 'k.e.i']))
                    setAppNameCol(foundAppNameCol)
                    setRankCol(foundRankCol)

                    // Find Unique Apps if appNameCol is found
                    if (foundAppNameCol && results.data.length > 0) {
                        const apps = new Set<string>()
                        results.data.forEach((row: any) => {
                            if (row[foundAppNameCol]) apps.add(row[foundAppNameCol])
                        })
                        const uniqueAppsArr = Array.from(apps).filter(Boolean)
                        setUniqueApps(uniqueAppsArr)
                        if (uniqueAppsArr.length > 0) {
                            setMyApp(uniqueAppsArr[0])
                            setCompetitorApps(uniqueAppsArr.slice(1, 11)) // Default select up to 10
                        }
                    }
                }
            },
            error: (err) => {
                toast.error("Failed to parse CSV")
                console.error(err)
            }
        })
    }

    const handleCompetitorToggle = (app: string) => {
        setCompetitorApps(prev => {
            if (prev.includes(app)) return prev.filter(c => c !== app)
            if (prev.length >= 10) {
                toast.error("Maximum 10 competitors allowed")
                return prev
            }
            return [...prev, app]
        })
    }

    const handleSubmit = async () => {
        if (!datasetName) return toast.error("Dataset name is required")
        if (!keywordCol) return toast.error("Keyword column mapping is required")
        if (parsedData.length === 0) return toast.error("No data found in CSV")

        setIsProcessing(true)

        const columnMapping = {
            keyword: keywordCol,
            volume: volumeCol,
            maxVolume: maxVolumeCol,
            difficulty: difficultyCol,
            kei: keiCol,
            appName: appNameCol,
            rank: rankCol
        }

        const appMapping = {
            myApp: myApp,
            competitors: competitorApps
        }

        try {
            const res = await fetch('/api/datasets/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId,
                    name: datasetName,
                    market,
                    concept,
                    sourceFilename: file?.name,
                    columnMapping,
                    appMapping,
                    keywordsData: parsedData
                })
            })

            const json = await res.json()
            if (res.ok) {
                toast.success(`Imported ${json.totalInserted} keywords successfully!`)
                setOpen(false)
                router.refresh()
                router.push(`/app/w/${workspaceId}/datasets/${json.datasetId}`)
            } else {
                toast.error(json.error || "Failed to import")
            }
        } catch (err) {
            toast.error("Network error during import")
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-[#FF8903] hover:bg-[#FEB107] text-white">
                    Import CSV
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Import AppTweak CSV</DialogTitle>
                    <DialogDescription>Map columns to build your dataset</DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    <div className="grid gap-2 relative">
                        <Label>1. Drop CSV File</Label>
                        <Input type="file" accept=".csv" onChange={handleFileUpload} disabled={isProcessing} />
                    </div>

                    {headers.length > 0 && (
                        <div className="space-y-4 animate-in fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                <div className="grid gap-2">
                                    <Label>Dataset Name <span className="text-red-500">*</span></Label>
                                    <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} disabled={isProcessing} placeholder="e.g. Q1 Keyword Research" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Country / Market <span className="text-gray-400 font-normal">(Optional)</span></Label>
                                    <Input value={market} onChange={(e) => setMarket(e.target.value)} disabled={isProcessing} placeholder="e.g. US, Brazil, Global" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Concept / Topic <span className="text-gray-400 font-normal">(Optional)</span></Label>
                                    <Input value={concept} onChange={(e) => setConcept(e.target.value)} disabled={isProcessing} placeholder="e.g. Brand, Casual, Competitors" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 bg-muted/30 p-4 rounded-md border">
                                <div className="space-y-4">
                                    <h4 className="font-semibold text-sm">Core Columns</h4>
                                    {[
                                        { label: 'Keyword', value: keywordCol, setter: setKeywordCol, req: true },
                                        { label: 'Volume', value: volumeCol, setter: setVolumeCol, req: false },
                                        { label: 'Max Volume', value: maxVolumeCol, setter: setMaxVolumeCol, req: false },
                                        { label: 'Difficulty', value: difficultyCol, setter: setDifficultyCol, req: false },
                                        { label: 'KEI', value: keiCol, setter: setKeiCol, req: false },
                                        { label: 'App Name', value: appNameCol, setter: setAppNameCol, req: true },
                                        { label: 'Rank', value: rankCol, setter: setRankCol, req: true },
                                    ].map((field) => (
                                        <div key={field.label} className="flex items-center gap-3">
                                            <Label className="text-right text-xs w-[85px] shrink-0 leading-tight">
                                                {field.label} {field.req && <span className="text-red-500">*</span>}
                                            </Label>
                                            <select
                                                className="flex-1 h-8 min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                                                value={field.value}
                                                onChange={(e) => field.setter(e.target.value)}
                                                disabled={isProcessing}
                                            >
                                                <option value="">-- Ignore --</option>
                                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                                            </select>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-4">
                                    <h4 className="font-semibold text-sm flex gap-2">
                                        App Mapping
                                        <span className="text-xs font-normal text-muted-foreground self-end">(My App vs Competitors)</span>
                                    </h4>

                                    <div className="flex items-center gap-3">
                                        <Label className="text-right text-xs text-[#FF8903] font-bold w-[85px] shrink-0 leading-tight">My App</Label>
                                        <select
                                            className="flex-1 h-8 min-w-0 rounded-md border border-[#FF8903] bg-background px-3 py-1 text-sm shadow-sm"
                                            value={myApp}
                                            onChange={(e) => setMyApp(e.target.value)}
                                            disabled={isProcessing || uniqueApps.length === 0}
                                        >
                                            <option value="">-- Select App --</option>
                                            {uniqueApps.map(app => <option key={app} value={app}>{app}</option>)}
                                        </select>
                                    </div>

                                    <div className="mt-2">
                                        <Label className="text-xs mb-2 block">Select Competitors (Max 10)</Label>
                                        <div className="max-h-52 overflow-y-auto border rounded-md p-2 bg-white flex flex-col gap-1">
                                            {uniqueApps.length === 0 && <span className="text-xs text-gray-500 px-2">No apps found. Make sure App Name column is selected.</span>}
                                            {uniqueApps.map(app => {
                                                if (app === myApp) return null; // Don't show myApp in competitors list
                                                return (
                                                    <label key={app} className="flex items-center gap-2 text-xs">
                                                        <input
                                                            type="checkbox"
                                                            checked={competitorApps.includes(app)}
                                                            onChange={() => handleCompetitorToggle(app)}
                                                            disabled={isProcessing}
                                                        />
                                                        <span className="text-gray-700 truncate" title={app}>{app}</span>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Button
                                onClick={handleSubmit}
                                disabled={isProcessing}
                                className="w-full bg-[#FF8903] hover:bg-[#FEB107] text-white"
                            >
                                {isProcessing ? "Importing (This might take a minute)..." : `Import ${parsedData.length} Keywords`}
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
