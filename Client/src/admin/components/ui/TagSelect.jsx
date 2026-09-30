import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';


export default function TagSelect({ label, placeholder, suggestions = [], selectedTags = [], onTagsChange }) {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = (tag) => {
    const cleaned = String(tag || '').trim();
    if (cleaned && !selectedTags.includes(cleaned)) onTagsChange([...selectedTags, cleaned]);
    setInput('');
    setIsOpen(false);
  };

  const filtered = suggestions.filter(
    (item) => item.toLowerCase().includes(input.toLowerCase()) && !selectedTags.includes(item)
  );

  return (
    <div ref={containerRef} className="relative sm:col-span-2">
      {label ? <label className="label">{label}</label> : null}
      <div
        onClick={() => setIsOpen(true)}
        className="input min-h-[46px] h-auto flex flex-wrap items-center gap-1.5 cursor-text py-2 pr-9"
      >
        {selectedTags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-primary-50 text-primary-800 border border-primary-100 px-2 py-0.5 text-xs font-medium"
          >
            {tag}
            <button
              type="button"
              className="text-primary-400 hover:text-red-500"
              onClick={(e) => {
                e.stopPropagation();
                onTagsChange(selectedTags.filter((t) => t !== tag));
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
          value={input}
          placeholder={selectedTags.length ? '' : placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setInput(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (input.trim()) addTag(filtered[0] || input);
            }
          }}
        />
        <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2">
              <Search className="w-3.5 h-3.5" />
              {input.trim() ? (
                <button type="button" className="text-primary-600 hover:underline" onClick={() => addTag(input)}>
                  Add “{input.trim()}”
                </button>
              ) : (
                'No matches'
              )}
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50"
                onClick={() => addTag(item)}
              >
                {item}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
