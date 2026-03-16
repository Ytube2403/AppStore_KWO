'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreVertical, Edit2, Trash2, Database } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'

export default function DatasetCard({ dataset, workspaceId }: { dataset: any, workspaceId: string }) {
    const router = useRouter()
    const [isEditing, setIsEditing] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [newName, setNewName] = useState(dataset.name)
    const [newMarket, setNewMarket] = useState(dataset.market || '')
    const [newConcept, setNewConcept] = useState(dataset.concept || '')
    const [loading, setLoading] = useState(false)

    const handleEdit = async () => {
        if (!newName.trim()) {
            toast.error("Dataset name cannot be empty")
            return
        }
        if (newName === dataset.name && newMarket === (dataset.market || '') && newConcept === (dataset.concept || '')) {
            setIsEditing(false)
            return
        }
        setLoading(true)
        try {
            const res = await fetch(`/api/datasets/${dataset.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName,
                    market: newMarket,
                    concept: newConcept
                })
            })
            if (!res.ok) throw new Error('Failed to update dataset')
            toast.success('Dataset updated')
            router.refresh()
            setIsEditing(false)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/datasets/${dataset.id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Failed to delete dataset')
            toast.success('Dataset deleted')
            router.refresh()
            setIsDeleting(false)
        } catch (e: any) {
            toast.error(e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div className="relative group h-full">
                <Link href={`/app/w/${workspaceId}/datasets/${dataset.id}`}>
                    <Card className="hover:border-[#FEB107] transition-all cursor-pointer h-full relative">
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2 pr-8">
                                <Database className="h-4 w-4 text-[#FF8903]" />
                                {dataset.name}
                            </CardTitle>
                            <CardDescription>
                                {new Date(dataset.created_at).toLocaleDateString()}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* Badges for Market & Concept */}
                            {(dataset.market || dataset.concept) && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {dataset.market && (
                                        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                                            {dataset.market}
                                        </span>
                                    )}
                                    {dataset.concept && (
                                        <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                                            {dataset.concept}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="text-sm text-gray-500">
                                <div>Competitors tracked: {dataset.competitor_count}</div>
                                {dataset.source_filename && (
                                    <div className="mt-2 text-xs truncate" title={dataset.source_filename}>
                                        Source: {dataset.source_filename}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </Link>

                <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 text-gray-500">
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setIsEditing(true)}>
                                <Edit2 className="h-4 w-4 mr-2" /> Edit Dataset
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsDeleting(true)} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="h-4 w-4 mr-2" /> Delete Dataset
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Edit Dialog */}
            <Dialog open={isEditing} onOpenChange={setIsEditing}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Dataset</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Dataset Name <span className="text-red-500">*</span></label>
                            <Input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Dataset Name"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleEdit()}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Country / Market <span className="text-gray-400 font-normal">(Optional)</span></label>
                            <Input
                                value={newMarket}
                                onChange={e => setNewMarket(e.target.value)}
                                placeholder="e.g. US, Brazil"
                                onKeyDown={e => e.key === 'Enter' && handleEdit()}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Concept / Topic <span className="text-gray-400 font-normal">(Optional)</span></label>
                            <Input
                                value={newConcept}
                                onChange={e => setNewConcept(e.target.value)}
                                placeholder="e.g. Brand, Core Features"
                                onKeyDown={e => e.key === 'Enter' && handleEdit()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsEditing(false)} disabled={loading}>Cancel</Button>
                        <Button onClick={handleEdit} disabled={loading || !newName.trim()}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <Dialog open={isDeleting} onOpenChange={setIsDeleting}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Dataset</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <b>{dataset.name}</b>? This action cannot be undone and all keywords data will be lost.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleting(false)} disabled={loading}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={loading}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
