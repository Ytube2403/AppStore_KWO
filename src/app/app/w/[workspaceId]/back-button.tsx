'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function WorkspaceBackButton({ workspaceId }: { workspaceId: string }) {
    const pathname = usePathname()
    let backHref = '/app'

    if (pathname.includes('/datasets/')) {
        backHref = `/app/w/${workspaceId}`
    } else if (pathname.includes('/settings')) {
        backHref = `/app/w/${workspaceId}`
    }

    return (
        <Link href={backHref} className="text-muted-foreground hover:text-black">
            <ArrowLeft className="h-4 w-4" />
        </Link>
    )
}
