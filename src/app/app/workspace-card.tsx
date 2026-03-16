'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreVertical, Edit2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'

export default function WorkspaceCard({ workspace, isOwner }: { workspace: any, isOwner: boolean }) {
    const router = useRouter()
    const [isEditing, setIsEditing] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [newName, setNewName] = useState(workspace.name)
    const [loading, setLoading] = useState(false)

    const handleEdit = async () => {
        if (!newName.trim() || newName === workspace.name) {
            setIsEditing(false)
            return
        }
        setLoading(true)
        try {
            const res = await fetch(`/api/workspaces/${workspace.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName })
            })
            if (!res.ok) throw new Error('Failed to update workspace')
            toast.success('Workspace updated')
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
            const res = await fetch(`/api/workspaces/${workspace.id}`, {
                method: 'DELETE',
            })
            if (!res.ok) throw new Error('Failed to delete workspace')
            toast.success('Workspace deleted')
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
                <Link href={`/app/w/${workspace.id}`}>
                    <Card className="h-full hover:border-[#FEB107] transition-all hover:shadow-sm cursor-pointer relative">
                        <CardHeader>
                            <CardTitle className="pr-8">{workspace.name}</CardTitle>
                            <CardDescription>
                                {isOwner ? 'Owner' : 'Member'}
                                • Created {new Date(workspace.created_at).toLocaleDateString()}
                            </CardDescription>
                        </CardHeader>
                    </Card>
                </Link>

                {isOwner && (
                    <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 text-gray-500">
                                    <MoreVertical className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                                    <Edit2 className="h-4 w-4 mr-2" /> Edit Name
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setIsDeleting(true)} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete Workspace
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            {/* Edit Dialog */}
            <Dialog open={isEditing} onOpenChange={setIsEditing}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Workspace</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="Workspace Name"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleEdit()}
                        />
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
                        <DialogTitle>Delete Workspace</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <b>{workspace.name}</b>? This action cannot be undone and all associated datasets will be deleted.
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
