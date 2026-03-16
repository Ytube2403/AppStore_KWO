'use client'

import { useState } from 'react'
import { createWorkspace } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

export default function CreateWorkspaceForm() {
    const [isCreating, setIsCreating] = useState(false)
    const [name, setName] = useState('')

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!name.trim()) return

        setIsCreating(true)
        const formData = new FormData()
        formData.append('name', name)

        const result = await createWorkspace(formData)
        setIsCreating(false)

        if (result.success) {
            toast.success('Workspace created successfully')
            setName('')
        } else {
            toast.error(result.message || 'Failed to create workspace')
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-sm">
            <Input
                placeholder="Workspace Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isCreating}
            />
            <Button
                type="submit"
                disabled={isCreating || !name.trim()}
                className="bg-[#FF8903] hover:bg-[#FEB107] text-white w-full"
            >
                <Plus className="mr-2 h-4 w-4" />
                Create Workspace
            </Button>
        </form>
    )
}
