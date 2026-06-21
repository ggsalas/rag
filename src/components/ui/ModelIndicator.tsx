export function ModelIndicator({ status }: { status: string }) {
  const config = {
    idle: { color: 'bg-gray-400', label: 'Model idle' },
    loading: {
      color: 'bg-yellow-400 animate-pulse',
      label: 'Loading model...',
    },
    ready: { color: 'bg-green-400', label: 'Model ready' },
    error: { color: 'bg-red-400', label: 'Model error' },
  }[status] ?? { color: 'bg-gray-400', label: 'Unknown' }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <div className={`w-2.5 h-2.5 rounded-full ${config.color}`} />
      <span>{config.label}</span>
    </div>
  )
}
