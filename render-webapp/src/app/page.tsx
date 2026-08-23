'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Mic, Plus, Calendar, Mail, MessageSquare, Trash2 } from 'lucide-react';
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

export default function Home() {
  const [data, setData] = useState<{
    reminders: Todo[], 
    letterly: LetterlyNote[],
    dailySummary: { date: string, summary: string } | null,
    error?: string
  }>({ reminders: [], letterly: [], dailySummary: null });
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<'general' | 'comm' | 'letterly' | 'daily'>('general');

  const fetchData = async () => {
    try {
      const res = await fetch('/api/todos');
      const json = await res.json();
      if (json.error) {
          setData({ reminders: [], letterly: [], dailySummary: null, error: json.error });
      } else {
          setData({
              reminders: json.reminders || [],
              letterly: json.letterly || [],
              dailySummary: json.dailySummary || null
          });
      }
    } catch (e: any) {
      console.error(e);
      setData({ reminders: [], letterly: [], dailySummary: null, error: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (rowNumber: number) => {
    setData(prev => ({
      ...prev,
      reminders: prev.reminders.filter(r => r.rowNumber !== rowNumber)
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
      letterly: prev.letterly.filter(r => r.rowNumber !== rowNumber)
    }));

    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_letterly', rowNumber })
    });
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_todo', title: newTitle })
    });
    setNewTitle("");
    fetchData();
  };

  // Filter lists based on prefix
  const isCommTodo = (t: Todo) => t.title && (t.title.startsWith('[SLACK]') || t.title.startsWith('[EMAIL]'));
  const generalTodos = (data.reminders || []).filter(t => !isCommTodo(t));
  const commTodos = (data.reminders || []).filter(t => isCommTodo(t));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Daily Planner
          </h1>
        </header>

        <div className="flex flex-wrap gap-3 mb-8 bg-slate-900 p-2 rounded-2xl w-fit">
          <button 
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'general' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            General Todos
          </button>
          <button 
            onClick={() => setActiveTab('comm')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'comm' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
          >
            <MessageSquare size={16} /> Comms
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

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {data.error && (
              <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl text-red-200">
                <h3 className="font-bold text-red-400 mb-1">Failed to load data</h3>
                <p className="text-sm">{data.error}</p>
                <p className="text-sm mt-2 opacity-75">Check your Render Environment Variables (especially your Google Private Key) to ensure they are configured correctly.</p>
              </div>
            )}

            {activeTab === 'general' && (
              <>
                <form onSubmit={handleAdd} className="flex gap-4">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Add a new general task..."
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all">
                    <Plus size={20} /> Add
                  </button>
                </form>

                <div className="space-y-3">
                  {generalTodos.map((todo, i) => (
                    <div key={i} className="group flex items-start gap-4 bg-slate-900/50 border border-slate-800 p-4 rounded-xl hover:bg-slate-800/50 transition-colors">
                      <button onClick={() => handleDelete(todo.rowNumber)} className="mt-1 text-slate-400 hover:text-green-400 transition-colors">
                        <Circle size={24} />
                      </button>
                      <div>
                        <h3 className="font-medium text-lg">{todo.title}</h3>
                        {todo.description && <p className="text-slate-400 text-sm mt-1">{todo.description}</p>}
                      </div>
                    </div>
                  ))}
                  
                  {generalTodos.length === 0 && (
                    <p className="text-slate-400 text-center py-12">No general tasks in your Google Sheet!</p>
                  )}
                </div>
              </>
            )}

            {activeTab === 'comm' && (
              <div className="space-y-3">
                {commTodos.map((todo, i) => (
                  <div key={i} className="group flex items-start gap-4 bg-slate-900/50 border border-slate-800 p-4 rounded-xl hover:bg-slate-800/50 transition-colors">
                    <button onClick={() => handleDelete(todo.rowNumber)} className="mt-1 text-slate-400 hover:text-green-400 transition-colors">
                      <Circle size={24} />
                    </button>
                    <div>
                      <h3 className="font-medium text-lg text-indigo-200">{todo.title}</h3>
                      {todo.description && <p className="text-slate-400 text-sm mt-2 leading-relaxed whitespace-pre-wrap">{todo.description}</p>}
                    </div>
                  </div>
                ))}
                
                {commTodos.length === 0 && (
                  <p className="text-slate-400 text-center py-12">No communication action items right now!</p>
                )}
              </div>
            )}

            {activeTab === 'daily' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
                {data.dailySummary ? (
                  <>
                    <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-800">
                      <Calendar className="text-emerald-400" size={28} />
                      <h2 className="text-2xl font-semibold text-emerald-50">Plan for {data.dailySummary.date}</h2>
                    </div>
                    <div className="prose prose-invert prose-emerald max-w-none prose-p:leading-relaxed prose-li:my-1">
                      <ReactMarkdown>{data.dailySummary.summary}</ReactMarkdown>
                    </div>
                  </>
                ) : (
                  <p className="text-slate-400 text-center py-12">Your first daily plan hasn't been generated yet! Check back after 6 AM.</p>
                )}
              </div>
            )}

            {activeTab === 'letterly' && (
              <div className="space-y-6">
                {data.letterly.map((note, i) => (
                  <div key={i} className="group bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden flex justify-between items-start">
                    <div className="absolute top-0 left-0 w-1 h-full bg-purple-500"></div>
                    <div className="flex-1">
                      <p className="text-sm text-slate-500 mb-3">{note.timestamp}</p>
                      <div className="prose prose-invert max-w-none">
                        <ReactMarkdown>{note.summary}</ReactMarkdown>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteLetterly(note.rowNumber)} 
                      className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-2 bg-slate-800 rounded-lg hover:bg-slate-700"
                      title="Dismiss Note"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
                
                {data.letterly.length === 0 && (
                  <p className="text-slate-400 text-center py-12">No Letterly notes synced yet.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
