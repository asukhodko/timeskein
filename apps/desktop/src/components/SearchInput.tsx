import { useRef, useEffect } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onCreateNew: () => void
  autoFocus?: boolean
}

export default function SearchInput({ value, onChange, onCreateNew, autoFocus = true }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey && value.trim()) {
      // Shift+Enter creates new item with current search as title
      onCreateNew()
    }
    // Alt+N to create new (works in input)
    if (e.code === 'KeyN' && e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      onCreateNew()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Search or type command..."
      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg 
                 text-gray-200 placeholder-gray-500
                 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  )
}
