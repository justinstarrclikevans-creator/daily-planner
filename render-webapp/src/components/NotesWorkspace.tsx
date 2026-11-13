'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Note } from '@/lib/supabase';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Save,
  Folder,
  Check,
  Send,
  ArrowLeft,
} from 'lucide-react';

type NotesWorkspaceProps = {
  notes: Note[];
  onRefresh: () => Promise<void>;
  onNotesChange: React.Dispatch<React.SetStateAction<Note[]>>;
};

export default function NotesWorkspace({
  notes,
  onRefresh,
  onNotesChange,
}: NotesWorkspaceProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    notes[0]?.id || null
  );
  const [mobileShowEditor, setMobileShowEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string>('All');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftFolder, setDraftFolder] = useState('Notes');
  const [draftContent, setDraftContent] = useState('');
  const [appendLine, setAppendLine] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const folders = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const n of notes) {
      if (n.folder) set.add(n.folder);
    }
    return Array.from(set);
  }, [notes]);

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((n) => {
      if (selectedFolder !== 'All' && n.folder !== selectedFolder) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.folder.toLowerCase().includes(q)
      );
    });
  }, [notes, searchQuery, selectedFolder]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  // Keep a valid selection when notes load
  useEffect(() => {
    if (!selectedNoteId && notes.length > 0) {
      setSelectedNoteId(notes[0].id);
    } else if (
      selectedNoteId &&
      notes.length > 0 &&
      !notes.some((n) => n.id === selectedNoteId)
    ) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes, selectedNoteId]);

  // Sync draft state when switching selected note
  useEffect(() => {
    if (selectedNote) {
      setDraftTitle(selectedNote.title || '');
      setDraftFolder(selectedNote.folder || 'Notes');
      setDraftContent(selectedNote.content || '');
      setSaveMessage(null);
    } else {
      setDraftTitle('');
      setDraftFolder('Notes');
      setDraftContent('');
    }
  }, [selectedNote?.id]);

  const isDirty = Boolean(
    selectedNote &&
      (draftTitle !== selectedNote.title ||
        draftFolder !== selectedNote.folder ||
        draftContent !== selectedNote.content)
  );

  const handleCreateNote = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Untitled Note',
          content: '',
          folder: selectedFolder !== 'All' ? selectedFolder : 'Notes',
          source: 'webapp',
        }),
      });
      const json = await res.json();
      if (res.ok && json.note) {
        onNotesChange((prev) => [json.note, ...prev]);
        setSelectedNoteId(json.note.id);
        setMobileShowEditor(true);
        setDraftTitle(json.note.title);
        setDraftFolder(json.note.folder);
        setDraftContent(json.note.content);
        setSaveMessage('Created new note');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveNote = async (overrideContent?: string) => {
    if (!selectedNote) return;
    setIsSaving(true);
    setSaveMessage(null);
    const contentToSave =
      overrideContent !== undefined ? overrideContent : draftContent;

    try {
      const res = await fetch('/api/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedNote.id,
          title: draftTitle.trim() || 'Untitled Note',
          folder: draftFolder.trim() || 'Notes',
          content: contentToSave,
        }),
      });
      const json = await res.json();
      if (res.ok && json.note) {
        onNotesChange((prev) =>
          prev
            .map((n) => (n.id === selectedNote.id ? json.note : n))
            .sort(
              (a, b) =>
                new Date(b.updated_at || 0).getTime() -
                new Date(a.updated_at || 0).getTime()
            )
        );
        setSaveMessage('Saved');
        setTimeout(() => setSaveMessage(null), 2000);
      } else {
        setSaveMessage(json.error || 'Failed to save');
      }
    } catch {
      setSaveMessage('Error saving note');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAppendLine = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = appendLine.trim();
    if (!trimmed || !selectedNote) return;

    const nextContent = draftContent
      ? `${draftContent.replace(/\s+$/, '')}\n${trimmed}`
      : trimmed;
    setDraftContent(nextContent);
    setAppendLine('');
    await handleSaveNote(nextContent);
  };

  const handleDeleteNote = async (id: string) => {
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    if (!window.confirm(`Delete note "${target.title}"?`)) return;

    onNotesChange((prev) => prev.filter((n) => n.id !== id));
    if (selectedNoteId === id) {
      const next = notes.find((n) => n.id !== id);
      setSelectedNoteId(next?.id || null);
      setMobileShowEditor(false);
    }

    await fetch(`/api/notes?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  };

  return (
    <main className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#111318]">
      {/* Header */}
      <header className="px-4 md:px-5 py-3 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="h-4 w-4 text-indigo-400" />
              <span>Notes</span>
              <span className="text-xs font-normal text-slate-400">
                ({notes.length})
              </span>
            </h1>
            <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">
              Create, edit, append to, and organize your notes directly in Supabase.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreateNote}
            disabled={isCreating}
            className="sm:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-2.5 md:top-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="w-full bg-[#1B1E26] border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-base md:text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <button
            type="button"
            onClick={onRefresh}
            className="px-2.5 py-2 md:py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 transition-colors shrink-0"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={handleCreateNote}
            disabled={isCreating}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Note</span>
          </button>
        </div>
      </header>

      {/* Body: Note List + Note Editor */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Note List Column */}
        <div
          className={`${
            mobileShowEditor ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 min-h-0 border-r border-white/[0.06] flex-col bg-[#13161E] shrink-0`}
        >
          {folders.length > 2 && (
            <div className="p-2.5 border-b border-white/[0.06] flex items-center gap-1.5 overflow-x-auto">
              {folders.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => setSelectedFolder(folder)}
                  className={`px-2 py-1 rounded-md text-[11px] whitespace-nowrap transition-colors ${
                    selectedFolder === folder
                      ? 'bg-indigo-600/25 text-indigo-300 font-medium border border-indigo-500/30'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                  }`}
                >
                  {folder}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredNotes.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                {notes.length === 0
                  ? 'No notes yet. Click "New Note" to create one.'
                  : 'No notes match your search.'}
              </div>
            ) : (
              filteredNotes.map((note) => {
                const isSelected = note.id === selectedNoteId;
                const preview = (note.content || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 90);
                const updatedLabel = note.updated_at
                  ? new Date(note.updated_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : '';

                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => {
                      setSelectedNoteId(note.id);
                      setMobileShowEditor(true);
                    }}
                    className={`w-full text-left p-2.5 rounded-xl border transition-colors ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500/40'
                        : 'bg-transparent border-transparent hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">
                        {note.title || 'Untitled Note'}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {updatedLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                      {preview || 'Empty note'}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                      <Folder className="h-2.5 w-2.5" />
                      <span>{note.folder || 'Notes'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Note Editor Column */}
        <div
          className={`${
            mobileShowEditor ? 'flex' : 'hidden md:flex'
          } flex-1 min-h-0 flex-col overflow-hidden bg-[#111318]`}
        >
          {selectedNote ? (
            <>
              <div className="px-3 md:px-6 py-2.5 md:py-3 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileShowEditor(false)}
                    className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-300 hover:bg-white/[0.06] shrink-0"
                    aria-label="Back to notes list"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Note title..."
                    className="flex-1 min-w-[120px] bg-transparent text-base font-bold text-white placeholder:text-slate-600 focus:outline-none"
                  />
                  <div className="hidden sm:flex items-center gap-1.5 bg-[#1B1E26] border border-white/[0.06] rounded-lg px-2 py-1">
                    <Folder className="h-3 w-3 text-slate-500" />
                    <input
                      type="text"
                      value={draftFolder}
                      onChange={(e) => setDraftFolder(e.target.value)}
                      placeholder="Folder"
                      className="w-24 bg-transparent text-base md:text-[11px] text-slate-300 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {saveMessage && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {saveMessage}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSaveNote()}
                    disabled={isSaving || !isDirty}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      isDirty
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        : 'bg-white/[0.05] text-slate-400'
                    } disabled:opacity-50`}
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{isSaving ? 'Saving...' : isDirty ? 'Save' : 'Saved'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteNote(selectedNote.id)}
                    title="Delete note"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-4 md:p-6 overflow-y-auto flex flex-col">
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      handleSaveNote();
                    }
                  }}
                  placeholder="Write or paste your note here..."
                  className="flex-1 w-full bg-transparent text-base md:text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none font-sans"
                />
              </div>

              {/* Quick Append Bar */}
              <form
                onSubmit={handleAppendLine}
                className="px-3 md:px-6 py-2.5 md:py-3 border-t border-white/[0.06] bg-[#151820] flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={appendLine}
                  onChange={(e) => setAppendLine(e.target.value)}
                  placeholder="Add to this note..."
                  className="flex-1 bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-1.5 text-base md:text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
                />
                <button
                  type="submit"
                  disabled={!appendLine.trim() || isSaving}
                  className="flex items-center gap-1.5 px-3 py-2 md:py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-40 transition-colors shrink-0"
                >
                  <Send className="h-3 w-3" />
                  <span className="hidden sm:inline">Add to Note</span>
                  <span className="sm:hidden">Add</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3 p-6">
              <FileText className="h-10 w-10 text-slate-600" />
              <p className="text-sm">Select a note or create a new one.</p>
              <button
                type="button"
                onClick={handleCreateNote}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create New Note</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
