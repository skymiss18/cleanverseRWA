"use client";

import { useRef, useState } from "react";

interface Props {
  label: string;
  value: string;        // extracted text
  fileName: string | null;
  onExtracted: (text: string, fileName: string) => void;
  onClear: () => void;
  placeholder?: string;
}

export default function DocumentUploadField({
  label, value, fileName, onExtracted, onClear, placeholder,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  async function handleFile(file: File) {
    setExtracting(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/extract-document", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      onExtracted(data.text as string, data.fileName as string);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleClear() {
    onClear();
    setShowPreview(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // ── Uploaded & extracted ───────────────────────────────────────────────────
  if (fileName && value) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-300">{label}</label>
        <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-emerald-400 text-base shrink-0">✓</span>
              <span className="text-sm text-emerald-300 font-medium truncate max-w-xs">{fileName}</span>
              <span className="text-xs text-gray-500 shrink-0">({value.length.toLocaleString()} chars)</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-700 transition-colors"
              >
                {showPreview ? "Hide text" : "Preview text"}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-800 transition-colors"
              >
                Re-upload
              </button>
            </div>
          </div>
          {showPreview && (
            <pre className="text-xs text-gray-300 font-mono bg-gray-900/70 rounded p-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
              {value}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // ── Upload dropzone ────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => !extracting && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors select-none ${
          extracting
            ? "border-emerald-600 bg-emerald-900/10 cursor-wait"
            : "border-gray-700 hover:border-emerald-600 hover:bg-gray-800/50 cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.txt"
          onChange={handleChange}
          className="hidden"
        />
        {extracting ? (
          <div className="space-y-2">
            <div className="text-3xl animate-spin inline-block">⏳</div>
            <p className="text-sm text-emerald-400 font-medium">Extracting text with AI…</p>
            <p className="text-xs text-gray-500">This may take a few seconds for images</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-4xl">📄</div>
            <p className="text-sm font-semibold text-gray-200">Click to upload or drag & drop</p>
            <p className="text-xs text-gray-500">PDF · JPG · PNG · TXT — max 10 MB</p>
            {placeholder && <p className="text-xs text-gray-600 italic mt-1">{placeholder}</p>}
          </div>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">{error}</p>
      )}
    </div>
  );
}
