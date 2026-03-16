export default function DatasetLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col h-full">
            {children}
        </div>
    )
}
