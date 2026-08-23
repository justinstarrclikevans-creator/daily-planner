'use client';
import { useEffect, useState, useRef } from 'react';
import { CheckCircle2, Circle, Mic, Plus, Calendar, Mail, MessageSquare, Trash2, Edit2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type Todo = {
  rowNumber: number;
  id: string;
  title: string;
  description: string;
  status: string;
};

type LetterlyNote = {
  rowNumber: number;
  id: string;
  timestamp: string;
  original: string;
  summary: string;
};

type ProjectNames = {
  proj1: string;
  proj2: string;
  proj3: string;
};

const COLUMN_KEYS = ['To Do', 'In Progress', 'Done', 'proj1', 'proj2', 'proj3'];

export default function Home() {
  const [data, setData] = useState<{
    reminders: Todo[], 
    letterly: LetterlyNote[],
    dailySummary: { date: string, summary: string } | null,
    projectNames: ProjectNames
  }>({
    reminders: [],
    letterly: [],
    dailySummary: null,
    projectNames: { proj1: 'Project 1', proj2: 'Project 2', proj3: 'Project 3' }
  });

  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<'board' | 'daily' | 'letterly'>('board');
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Drag and drop state
  const draggedTodoRef = useRef<Todo | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/todos');
      const json = await res.json();
      if (json.projectNames) {
         setData(json);
      } else {
         setData({ ...json, projectNames: { proj1: 'Project 1', proj2: 'Project 2', proj3: 'Project 3' } });
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    // Optimistic UI
    const tempTodo: Todo = {
      rowNumber: -1,
      id: 'temp_' + Date.now(),
      title: newTitle,
      description: '',
      status: 'To Do'
    };
    
    setData(prev => ({
      ...prev,
      reminders: [...prev.reminders, tempTodo]
    }));
    setNewTitle("");

    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_todo', title: tempTodo.title })
    });
    fetchData();
  };

  const handleDelete = async (rowNumber: number) => {
    setData(prev => ({
      ...prev,
      reminders: prev.reminders.filter(t => t.rowNumber !== rowNumber)
    }));
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_todo', rowNumber })
    });
  };

  const handleDeleteLetterly = async (rowNumber: number) => {
    setData(prev => ({
      ...prev,
      letterly: prev.letterly.filter(t => t.rowNumber !== rowNumber)
    }));
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_letterly', rowNumber })
    });
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, todo: Todo) => {
    draggedTodoRef.current = todo;
    // For firefox compatibility
    e.dataTransfer.setData('text/plain', todo.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, targetStatus: string) => {
    e.preventDefault();
    const todo = draggedTodoRef.current;
    if (!todo) return;
    if (todo.status === targetStatus) return;
    
    // Normalizing legacy 'Pending' -> 'To Do' in comparison
    const sourceStatus = todo.status === 'Pending' ? 'To Do' : todo.status;
    if (sourceStatus === targetStatus) return;

    // Optimistic UI Update
    setData(prev => ({
      ...prev,
      reminders: prev.reminders.map(t => t.id === todo.id ? { ...t, status: targetStatus } : t)
    }));

    // API Call
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_todo_status', rowNumber: todo.rowNumber, newStatus: targetStatus })
    });
    draggedTodoRef.current = null;
  };

  // --- Column Renaming Handlers ---
  const handleEditColumnStart = (colKey: string, currentName: string) => {
    if (!['proj1', 'proj2', 'proj3'].includes(colKey)) return;
    setEditingColumn(colKey);
    setEditingName(currentName);
  };

  const handleEditColumnSave = async (colKey: string) => {
    if (!editingName.trim()) return;
    
    // Optimistic UI
    setData(prev => ({
      ...prev,
      projectNames: { ...prev.projectNames, [colKey]: editingName.trim() }
    }));
    setEditingColumn(null);

    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_project_name', key: `${colKey}_name`, value: editingName.trim() })
    });
  };

  const getColumnName = (colKey: string) => {
    if (colKey === 'proj1') return data.projectNames.proj1;
    if (colKey === 'proj2') return data.projectNames.proj2;
    if (colKey === 'proj3') return data.projectNames.proj3;
    return colKey;
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-8 flex flex-col">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col">
        
        {/* Header & Tabs */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-3">
            <CheckCircle2 className="text-blue-400" size={32} />
            Command Center
          </h1>
          <div className="flex bg-slate-900 p-1.5 rounded-2xl border border-slate-800 gap-1">
            <button 
              onClick={() => setActiveTab('board')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'board' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              Kanban Board
            </button>
            <button 
              onClick={() => setActiveTab('daily')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'daily' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <Calendar size={16} /> Daily Plan
            </button>
            <button 
              onClick={() => setActiveTab('letterly')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'letterly' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <Mic size={16} /> Letterly Notes
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 flex flex-col min-h-0">
          
          {/* KANBAN BOARD */}
          {activeTab === 'board' && (
            <div className="flex-1 flex gap-6 overflow-x-auto pb-4 snap-x">
              {COLUMN_KEYS.map(colKey => {
                const colName = getColumnName(colKey);
                // Filter items that belong in this column (mapping legacy 'Pending' -> 'To Do')
                const colTodos = data.reminders.filter(t => {
                  const s = t.status === 'Pending' ? 'To Do' : t.status;
                  return s === colKey;
                });
                const isCustom = colKey.startsWith('proj');

                return (
                  <div 
                    key={colKey}
                    className="flex-shrink-0 w-80 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col snap-center h-full max-h-full"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, colKey)}
                  >
                    {/* Column Header */}
                    <div className="p-4 border-b border-slate-800/50 flex items-center justify-between group">
                      {editingColumn === colKey ? (
                        <input 
                          type="text" 
                          value={editingName} 
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => handleEditColumnSave(colKey)}
                          onKeyDown={(e) => e.key === 'Enter' && handleEditColumnSave(colKey)}
                          autoFocus
                          className="bg-slate-800 text-white px-2 py-1 rounded text-lg font-semibold w-full outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <h2 
                          className="text-lg font-semibold text-slate-100 flex items-center gap-2 cursor-pointer w-full"
                          onClick={() => handleEditColumnStart(colKey, colName)}
                        >
                          {colName}
                          <span className="text-sm font-normal text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full ml-auto">
                            {colTodos.length}
                          </span>
                        </h2>
                      )}
                    </div>

                    {/* Quick Add (Only for To Do column) */}
                    {colKey === 'To Do' && (
                      <div className="p-4 pb-0">
                        <form onSubmit={handleAdd} className="flex gap-2">
                          <input
                            type="text"
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            placeholder="Add a new task..."
                            className="flex-1 bg-slate-800/50 text-white border border-slate-700/50 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                          />
                          <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl transition-colors">
                            <Plus size={20} />
                          </button>
                        </form>
                      </div>
                    )}

                    {/* Column Items */}
                    <div className="p-4 flex-1 overflow-y-auto space-y-3">
                      {colTodos.map((todo) => (
                        <div 
                          key={todo.id} 
                          draggable
                          onDragStart={(e) => handleDragStart(e, todo)}
                          className="group bg-slate-800 border border-slate-700 p-4 rounded-xl shadow-sm hover:border-slate-500 transition-all cursor-grab active:cursor-grabbing flex flex-col gap-2 relative"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-slate-200 font-medium leading-snug">{todo.title}</p>
                            <button 
                              onClick={() => handleDelete(todo.rowNumber)} 
                              className="text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                              title="Delete task"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          {todo.description && (
                            <p className="text-slate-400 text-xs line-clamp-2">{todo.description}</p>
                          )}
                          {/* Source badges if it came from AI */}
                          {todo.id.startsWith('slack_') && (
                            <span className="self-start text-[10px] font-bold tracking-wider uppercase bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded flex items-center gap-1 mt-1">
                              <MessageSquare size={10} /> Slack
                            </span>
                          )}
                          {todo.id.startsWith('email_') && (
                            <span className="self-start text-[10px] font-bold tracking-wider uppercase bg-red-500/20 text-red-400 px-2 py-0.5 rounded flex items-center gap-1 mt-1">
                              <Mail size={10} /> Gmail
                            </span>
                          )}
                        </div>
                      ))}
                      {colTodos.length === 0 && (
                        <div className="h-full flex items-center justify-center text-slate-600 text-sm italic py-8 border-2 border-dashed border-slate-800/50 rounded-xl">
                          Drop tasks here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* DAILY PLAN */}
          {activeTab === 'daily' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl max-w-4xl mx-auto w-full">
              {data.dailySummary ? (
                <>
                  <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-800">
                    <Calendar className="text-emerald-400" size={28} />
                    <h2 className="text-2xl font-bold text-white">Daily Plan <span className="text-slate-500 font-normal text-lg ml-2">{data.dailySummary.date}</span></h2>
                  </div>
                  <div className="prose prose-invert prose-emerald max-w-none">
                    <ReactMarkdown>{data.dailySummary.summary}</ReactMarkdown>
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-500 py-12 flex flex-col items-center gap-4">
                  <Calendar size={48} className="opacity-20" />
                  <p>No daily summary found. The sync daemon runs at 6:00 AM.</p>
                </div>
              )}
            </div>
          )}

          {/* LETTERLY NOTES */}
          {activeTab === 'letterly' && (
            <div className="space-y-6 max-w-4xl mx-auto w-full">
              {data.letterly.map((note, i) => (
                <div key={i} className="group bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden flex justify-between items-start">
                  <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <Mic className="text-purple-400" size={20} />
                      <span className="text-sm font-medium text-purple-400">{note.timestamp}</span>
                    </div>
                    <div className="mb-6">
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Original Audio</h3>
                      <p className="text-slate-300 italic">"{note.original}"</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">AI Summary</h3>
                      <div className="prose prose-invert prose-purple max-w-none prose-sm">
                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteLetterly(note.rowNumber)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-4 p-2">
                    <Trash2 size={20} />
                  </button>
                </div>
              ))}
              {data.letterly.length === 0 && (
                <div className="text-center text-slate-500 py-12 flex flex-col items-center gap-4 bg-slate-900 rounded-2xl border border-slate-800">
                  <Mic size={48} className="opacity-20" />
                  <p>No letterly notes synced yet.</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
