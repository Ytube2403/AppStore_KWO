'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import DatasetCard from './dataset-card'
import { Database, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function WorkspaceDetailClient({ datasets, workspaceId }: { datasets: any[], workspaceId: string }) {
    const [searchQuery, setSearchQuery] = useState('')
    const [marketFilter, setMarketFilter] = useState<string>('all')
    const [conceptFilter, setConceptFilter] = useState<string>('all')

    // Extract unique labels for filters
    const markets = useMemo(() => {
        const unique = new Set(datasets.map(d => d.market).filter(Boolean))
        return Array.from(unique).sort()
    }, [datasets])

    const concepts = useMemo(() => {
        const unique = new Set(datasets.map(d => d.concept).filter(Boolean))
        return Array.from(unique).sort()
    }, [datasets])

    // Apply filtering
    const filteredDatasets = useMemo(() => {
        return datasets.filter(ds => {
            const matchesSearch = ds.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (ds.source_filename && ds.source_filename.toLowerCase().includes(searchQuery.toLowerCase()))

            const matchesMarket = marketFilter === 'all' || ds.market === marketFilter
            const matchesConcept = conceptFilter === 'all' || ds.concept === conceptFilter

            return matchesSearch && matchesMarket && matchesConcept
        })
    }, [datasets, searchQuery, marketFilter, conceptFilter])

    return (
        <div className="flex flex-col gap-6">
            {/* Filters */}
            {datasets.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-xl shadow-sm border">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search datasets..."
                            className="pl-9 h-9"
                        />
                    </div>

                    {(markets.length > 0) && (
                        <Select value={marketFilter} onValueChange={setMarketFilter}>
                            <SelectTrigger className="w-[180px] h-9">
                                <SelectValue placeholder="All Countries" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Countries</SelectItem>
                                {markets.map(m => (
                                    <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {(concepts.length > 0) && (
                        <Select value={conceptFilter} onValueChange={setConceptFilter}>
                            <SelectTrigger className="w-[180px] h-9">
                                <SelectValue placeholder="All Concepts" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Concepts</SelectItem>
                                {concepts.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>
            )}

            {/* List */}
            {filteredDatasets.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {filteredDatasets.map(ds => (
                        <DatasetCard key={ds.id} dataset={ds} workspaceId={workspaceId} />
                    ))}
                </div>
            ) : (
                datasets.length > 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        No datasets match your filters.
                    </div>
                ) : (
                    <Card className="border-dashed border-2 py-12 bg-white">
                        <CardContent className="flex flex-col items-center justify-center text-center">
                            <div className="rounded-full bg-gray-100 p-3 mb-4">
                                <DatabaseIcon className="h-6 w-6 text-gray-400" />
                            </div>
                            <CardTitle className="text-lg">No datasets found</CardTitle>
                            <CardDescription className="max-w-md mt-2">
                                Get started by importing your first AppTweak CSV file to analyze keywords.
                            </CardDescription>
                        </CardContent>
                    </Card>
                )
            )}
        </div>
    )
}

function DatabaseIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5V19A9 3 0 0 0 21 19V5" />
            <path d="M3 12A9 3 0 0 0 21 12" />
        </svg>
    )
}
