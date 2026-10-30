'use client';

import React from 'react';
import { Project, Task } from '@/lib/supabase';
import {
  Folder,
  Briefcase,
  Trophy,
  User,
  Sparkles,
  Book,
  Layers,
  Plus,
  Settings,
  Flame,
  CheckCircle2,
} from 'lucide-react';

interface ProjectSidebarProps {
  projects: Project[];
  selectedProjectId: string | null; // null means 'All Tasks'
  onSelectProject: (projectId: string | null) => void;
  tasks: Task[];
  onNewProject: () => void;
  onEditProjectRules: (project: Project) => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  selectedProjectId,
  onSelectProject,
  tasks,
  onNewProject,
  onEditProjectRules,
}) => {
  // Compute counts per project
  const getProjectStats = (projId: string) => {
    const projTasks = tasks.filter((t) => t.projectId === projId && t.status !== 'completed');
    const highPrio = projTasks.filter((t) => t.priority === 'high').length;
    return { count: projTasks.length, highPrio };
  };

  const totalActiveTasks = tasks.filter((t) => t.status !== 'completed').length;
  const totalHighPrio = tasks.filter((t) => t.status !== 'completed' && t.priority === 'high').length;

  const getProjectIcon = (iconName: string, color: string) => {
    const props = { className: 'h-4 w-4 shrink-0', style: { color } };
    switch (iconName) {
      case 'briefcase':
        return <Briefcase {...props} />;
      case 'trophy':
        return <Trophy {...props} />;
      case 'user':
        return <User {...props} />;
      case 'sparkles':
        return <Sparkles {...props} />;
      case 'book':
        return <Book {...props} />;
      default:
        return <Folder {...props} />;
    }
  };

  return (
    <aside className="w-72 shrink-0 border-r border-slate-800 bg-slate-900/70 backdrop-blur-md flex flex-col h-full select-none">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide">Projects</h2>
            <p className="text-[11px] text-slate-400">Select to focus</p>
          </div>
        </div>
        <button
          onClick={onNewProject}
          title="Create New Project"
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Project Navigation List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* All Tasks Item */}
        <button
          type="button"
          onClick={() => onSelectProject(null)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all ${
            selectedProjectId === null
              ? 'bg-indigo-600/20 border border-indigo-500/40 text-white font-medium shadow-sm'
              : 'text-slate-300 hover:bg-slate-800/60 hover:text-white border border-transparent'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-2.5 w-2.5 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
            <span className="text-xs truncate font-semibold">All Tasks</span>
          </div>
          <div className="flex items-center gap-1.5">
            {totalHighPrio > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <Flame className="h-2.5 w-2.5 text-rose-400" />
                {totalHighPrio}
              </span>
            )}
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-400">
              {totalActiveTasks}
            </span>
          </div>
        </button>

        <div className="pt-2 pb-1 px-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Your Projects
        </div>

        {/* Individual Projects */}
        {projects.map((proj) => {
          const isSelected = selectedProjectId === proj.id;
          const { count, highPrio } = getProjectStats(proj.id);

          return (
            <div
              key={proj.id}
              className={`group flex items-center justify-between px-3 py-2 rounded-xl transition-all ${
                isSelected
                  ? 'bg-slate-800 border border-slate-700 text-white shadow-sm font-medium'
                  : 'text-slate-300 hover:bg-slate-800/50 hover:text-white border border-transparent'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectProject(proj.id)}
                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
              >
                {getProjectIcon(proj.icon, proj.color)}
                <span className="text-xs truncate">{proj.name}</span>
              </button>

              <div className="flex items-center gap-1.5">
                {highPrio > 0 && (
                  <span
                    title={`${highPrio} High Priority tasks`}
                    className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  >
                    <Flame className="h-2.5 w-2.5 text-rose-400" />
                    {highPrio}
                  </span>
                )}
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-400">
                  {count}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditProjectRules(proj);
                  }}
                  title="Configure Auto-Routing Rules"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-opacity"
                >
                  <Settings className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Summary Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span>Active: {totalActiveTasks} tasks</span>
        </span>
        <button
          onClick={onNewProject}
          className="text-indigo-400 hover:text-indigo-300 font-medium hover:underline text-[11px]"
        >
          + Add Project
        </button>
      </div>
    </aside>
  );
};
