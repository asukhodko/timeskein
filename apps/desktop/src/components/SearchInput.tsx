import { useRef, useEffect } from 'react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onCreateNew: () => void
  autoFocus?: boolean
}

export default function SearchInput({ value, onChange, onCreateNew, autoFocus = true }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus()
    }
  }, [autoFocus])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey && value.trim()) {
      onCreateNew()
    }

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
      placeholder="Найти или ввести команду..."
      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg 
                 text-gray-200 placeholder-gray-500
                 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  )
}
