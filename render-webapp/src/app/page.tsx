"use client";

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Mic, Plus } from 'lucide-react';

export default function Home() {
  const [data, setData] = useState<{reminders: any[], letterly: any[]}>({ reminders: [], letterly: [] });
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [activeTab, setActiveTab] = useState<'reminders' | 'letterly'>('reminders');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/todos');
      const json = await res.json();
      if (!json.error) {
        setData(json);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (rowNumber: number) => {
    // Optimistic update
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-12">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Daily Planner
          </h1>
          <div className="flex gap-4">
            <button 
              onClick={() => setActiveTab('reminders')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors \${activeTab === 'reminders' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              Todos
            </button>
            <button 
              onClick={() => setActiveTab('letterly')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors \${activeTab === 'letterly' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              <Mic size={16} /> Letterly Notes
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {activeTab === 'reminders' && (
              <>
                <form onSubmit={handleAdd} className="flex gap-4">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Add a new task to your Google Sheet..."
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 transition-all">
                    <Plus size={20} /> Add
                  </button>
                </form>

                <div className="space-y-3">
                  {data.reminders.map((todo, i) => (
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
                  
                  {data.reminders.length === 0 && (
                    <p className="text-slate-400 text-center py-12">No tasks in your Google Sheet!</p>
                  )}
                </div>
              </>
            )}

            {activeTab === 'letterly' && (
              <div className="grid gap-6 md:grid-cols-2">
                {data.letterly.map((note, i) => (
                  <div key={i} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl flex flex-col h-full">
                    <span className="text-xs font-mono text-indigo-400 mb-4">{note.timestamp}</span>
                    <div className="prose prose-invert prose-sm max-w-none flex-1">
                      {note.summary}
                    </div>
                  </div>
                ))}
                {data.letterly.length === 0 && (
                  <p className="text-slate-400 col-span-2 text-center py-12">No voice notes processed yet.</p>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </main>
  );
}
