'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Mail, Copy } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function InviteMemberForm({ workspaceId }: { workspaceId: string }) {
    const [email, setEmail] = useState('')
    const [role, setRole] = useState('editor')
    const [isSending, setIsSending] = useState(false)
    const [inviteLink, setInviteLink] = useState('')
    const router = useRouter()

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!email.trim()) return

        setIsSending(true)
        setInviteLink('')
        try {
            const res = await fetch('/api/workspaces/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId, email, role })
            })

            const data = await res.json()

            if (res.ok) {
                toast.success(`Invite mapped to ${email}`)
                setEmail('')
                setInviteLink(data.inviteLink)
                router.refresh()
            } else {
                toast.error(data.error || 'Failed to send invite')
            }
        } catch (err) {
            toast.error('Network error')
        } finally {
            setIsSending(false)
        }
    }

    return (
        <div className="space-y-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                        id="email"
                        type="email"
                        placeholder="colleague@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isSending}
                    />
                </div>

                <div className="grid gap-2">
                    <Label htmlFor="role">Role</Label>
                    <select
                        id="role"
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isSending}
                    >
                        <option value="editor">Editor (Can edit datasets & selected keys)</option>
                        <option value="viewer">Viewer (Read-only)</option>
                    </select>
                </div>

                <Button
                    type="submit"
                    disabled={isSending || !email.trim()}
                    className="bg-black text-white hover:bg-gray-800 w-full"
                >
                    <Mail className="mr-2 h-4 w-4" />
                    Send Invitation
                </Button>
            </form>

            {inviteLink && (
                <div className="p-3 bg-green-50 rounded-md border border-green-200 mt-4">
                    <Label className="text-green-700 text-xs font-semibold uppercase tracking-wider mb-2 block">
                        Invite Link (MVP Simulation)
                    </Label>
                    <p className="text-xs text-green-900 mb-2">
                        In a real app, this link would be emailed. For now, copy it to test the invite receipt flow:
                    </p>
                    <div className="flex gap-2 items-center">
                        <Input readOnly value={inviteLink} className="h-8 text-xs font-mono" />
                        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => {
                            navigator.clipboard.writeText(inviteLink)
                            toast.success("Link copied!")
                        }}>
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
