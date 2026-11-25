'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AgentJob,
  AgentJobType,
  AgentSettings,
  AgentVenture,
  LeadRecord,
  Project,
  RerunCoworkerConfig,
} from '@/lib/supabase';
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GraduationCap,
  Hammer,
  Mail,
  MessageSquare,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  Webhook,
  X,
  Zap,
} from 'lucide-react';

type SubTabId = 'needs_you' | 'ventures' | 'activity' | 'connections';

type AICeoWorkspaceProps = {
  ventures: AgentVenture[];
  jobs: AgentJob[];
  settings: AgentSettings;
  projects: Project[];
  needsMigration: boolean;
  onRefresh: () => Promise<void>;
  onTasksRefresh?: () => Promise<void>;
};

const AGENT_SCHEMA_SQL = `-- AI CEO & Autonomous Agent Workforce Schema (Idempotent)
create table if not exists public.agent_ventures (
    id uuid primary key default gen_random_uuid(),
    project_id uuid references public.projects(id) on delete set null,
    name text not null,
    slug text not null unique,
    idea_prompt text not null default '',
    target_audience text not null default '',
    icp_query text not null default '',
    stage text not null default 'planning',
    autopilot_enabled boolean not null default true,
    strategy_markdown text not null default '',
    rerun_webhook_url text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.agent_jobs (
    id uuid primary key default gen_random_uuid(),
    venture_id uuid references public.agent_ventures(id) on delete cascade,
    project_id uuid references public.projects(id) on delete set null,
    source_task_id uuid references public.tasks(id) on delete set null,
    agent_role text not null default 'ceo',
    job_type text not null default 'plan_venture',
    title text not null,
    prompt text not null default '',
    status text not null default 'queued',
    output_markdown text not null default '',
    output_payload jsonb not null default '{}'::jsonb,
    revision_feedback text not null default '',
    execution_result jsonb not null default '{}'::jsonb,
    execution_error text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    executed_at timestamptz
);

create table if not exists public.agent_settings (
    id text primary key default 'default',
    default_rerun_webhook_url text not null default '',
    rerun_coworkers jsonb not null default '[]'::jsonb,
    default_from_email text not null default '',
    auto_send_on_approve boolean not null default true,
    daemon_heartbeat_at timestamptz,
    daemon_capabilities jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create index if not exists idx_agent_jobs_status on public.agent_jobs(status);
create index if not exists idx_agent_jobs_venture_id on public.agent_jobs(venture_id);
create index if not exists idx_agent_jobs_created_at on public.agent_jobs(created_at desc);
create index if not exists idx_agent_ventures_project_id on public.agent_ventures(project_id);

do $$ begin alter publication supabase_realtime add table public.agent_ventures; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.agent_jobs; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.agent_settings; exception when others then null; end $$;

alter table public.agent_ventures enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_settings enable row level security;

drop policy if exists "Allow all operations for anon/authenticated" on public.agent_ventures;
create policy "Allow all operations for anon/authenticated" on public.agent_ventures for all using (true) with check (true);
drop policy if exists "Allow all operations for anon/authenticated" on public.agent_jobs;
create policy "Allow all operations for anon/authenticated" on public.agent_jobs for all using (true) with check (true);
drop policy if exists "Allow all operations for anon/authenticated" on public.agent_settings;
create policy "Allow all operations for anon/authenticated" on public.agent_settings for all using (true) with check (true);

insert into public.agent_settings (id) values ('default') on conflict (id) do nothing;`;

const AUTO_TRIGGER_OPTIONS: { id: AgentJobType; label: string }[] = [
  { id: 'plan_venture', label: 'AI CEO Plan' },
  { id: 'market_research', label: 'Market Research' },
  { id: 'lead_search', label: 'LeadOcean Leads' },
  { id: 'content_draft', label: 'Content Draft' },
  { id: 'task_assist', label: 'Task Assist' },
];

const ROLE_LABELS: Record<string, string> = {
  ceo: 'AI CEO',
  researcher: 'Researcher',
  leads: 'LeadOcean',
  outreach: 'Outreach',
  content: 'Content',
  rerun: 'Rerun',
  trainer: 'Trainer',
  builder: 'AI Builder',
};

const CODE_REPO_OPTIONS: { id: string; label: string }[] = [
  { id: 'todo', label: 'ToDo App' },
  { id: 'turn90', label: 'Turn90' },
  { id: 'synapse', label: 'SYNAPSE App' },
  { id: 'liturgy', label: 'Liturgy App' },
  { id: 'resource', label: 'Resource App' },
];

const CODE_REPO_LABELS: Record<string, string> = Object.fromEntries(
  CODE_REPO_OPTIONS.map((r) => [r.id, r.label])
);

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'Never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'Unknown';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

function isDaemonOnline(heartbeatIso?: string | null): boolean {
  if (!heartbeatIso) return false;
  const ts = new Date(heartbeatIso).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < 3 * 60 * 1000;
}

function isEmailJob(job: AgentJob): boolean {
  return (
    job.job_type === 'email_outreach' ||
    (job.job_type === 'task_assist' && Boolean(job.output_payload?.isEmail))
  );
}

// Outbound Slack DM drafts — always 1-tap approval before sending.
function isSlackJob(job: AgentJob): boolean {
  return job.job_type === 'slack_message' || Boolean(job.output_payload?.isSlack);
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-xs text-slate-200 leading-relaxed break-words">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-sm font-bold text-white mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xs font-bold text-indigo-300 mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-semibold text-slate-100 mt-1.5 mb-0.5">{children}</h3>,
          p: ({ children }) => <p className="text-xs text-slate-300 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 text-slate-300">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 text-slate-300">{children}</ol>,
          li: ({ children }) => <li className="text-xs text-slate-300">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded bg-black/40 text-indigo-300 font-mono text-[11px]">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-amber-500/60 pl-2.5 text-amber-200/90 italic my-1.5">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 rounded-lg border border-white/[0.08]">
              <table className="w-full text-left border-collapse text-[11px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1.5 bg-white/[0.05] text-slate-200 font-semibold border-b border-white/[0.08]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1.5 text-slate-300 border-b border-white/[0.05]">{children}</td>
          ),
        }}
      >
        {content || '_No content generated yet._'}
      </ReactMarkdown>
    </div>
  );
}

export default function AICeoWorkspace({
  ventures,
  jobs,
  settings,
  projects,
  needsMigration,
  onRefresh,
  onTasksRefresh,
}: AICeoWorkspaceProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('needs_you');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [originUrl, setOriginUrl] = useState('https://your-render-site.onrender.com');

  const tabRefs = useRef<Record<SubTabId, HTMLButtonElement | null>>({
    needs_you: null,
    ventures: null,
    activity: null,
    connections: null,
  });

  // Launch Venture Form State
  const [launchMode, setLaunchMode] = useState<'new' | 'existing'>('new');
  const [selectedExistingProjectId, setSelectedExistingProjectId] = useState<string>('');
  const [ventureName, setVentureName] = useState('');
  const [ventureIdea, setVentureIdea] = useState('');
  const [ventureAudience, setVentureAudience] = useState('');
  const [ventureIcp, setVentureIcp] = useState('');
  const [ventureWebhook, setVentureWebhook] = useState('');
  const [ventureFormErrors, setVentureFormErrors] = useState<{ name?: string; idea?: string; project?: string }>({});
  const [isLaunchingVenture, setIsLaunchingVenture] = useState(false);

  const ventureNameInputRef = useRef<HTMLInputElement | null>(null);
  const ventureIdeaInputRef = useRef<HTMLTextAreaElement | null>(null);
  const existingProjSelectRef = useRef<HTMLSelectElement | null>(null);

  // Per-job Draft Edit & Revision State
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [markdownDrafts, setMarkdownDrafts] = useState<Record<string, string>>({});
  const [emailDrafts, setEmailDrafts] = useState<Record<string, { to: string; subject: string; body: string }>>({});
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, Record<string, any>>>({});
  const [rerunDispatchByJob, setRerunDispatchByJob] = useState<Record<string, string>>({});
  const [revisingJobId, setRevisingJobId] = useState<string | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [busyJobIds, setBusyJobIds] = useState<Record<string, boolean>>({});
  const [slackDrafts, setSlackDrafts] = useState<Record<string, { recipientName: string; messageText: string }>>({});

  // Quick Actions & App Builder State
  const [quickPanel, setQuickPanel] = useState<'none' | 'code' | 'slack'>('none');
  const [codeRepo, setCodeRepo] = useState('todo');
  const [codeMode, setCodeMode] = useState<'antigravity_claude' | 'claude_direct'>('antigravity_claude');
  const [codeTitle, setCodeTitle] = useState('');
  const [codeSpec, setCodeSpec] = useState('');
  const [codePushOnApprove, setCodePushOnApprove] = useState(false);
  const [codeFormError, setCodeFormError] = useState<string | null>(null);
  const [stageSlackRecipient, setStageSlackRecipient] = useState('');
  const [stageSlackText, setStageSlackText] = useState('');
  const [stageSlackError, setStageSlackError] = useState<string | null>(null);
  const [isQuickSubmitting, setIsQuickSubmitting] = useState(false);

  // Venture Inline Edit / Outreach Drawer State
  const [expandedStrategyId, setExpandedStrategyId] = useState<string | null>(null);
  const [ventureEdits, setVentureEdits] = useState<Record<string, { icp: string; webhook: string }>>({});
  const [quickEmailVentureId, setQuickEmailVentureId] = useState<string | null>(null);
  const [quickEmailTo, setQuickEmailTo] = useState('');
  const [quickEmailPrompt, setQuickEmailPrompt] = useState('');

  // Activity Filter State
  const [activityFilter, setActivityFilter] = useState<'all' | 'active' | 'executed' | 'failed' | 'rejected'>('all');

  // Connections / Rerun Coworker Form State
  const [defaultRerunUrl, setDefaultRerunUrl] = useState(settings.default_rerun_webhook_url || '');
  const [defaultFromEmail, setDefaultFromEmail] = useState(settings.default_from_email || '');
  const [cwName, setCwName] = useState('');
  const [cwRole, setCwRole] = useState('');
  const [cwUrl, setCwUrl] = useState('');
  const [cwTriggers, setCwTriggers] = useState<AgentJobType[]>(['content_draft']);
  const [cwErrors, setCwErrors] = useState<{ name?: string; url?: string }>({});
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [webhookTestResults, setWebhookTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const cwNameRef = useRef<HTMLInputElement | null>(null);
  const cwUrlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setOriginUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    setDefaultRerunUrl(settings.default_rerun_webhook_url || '');
    setDefaultFromEmail(settings.default_from_email || '');
  }, [settings.default_rerun_webhook_url, settings.default_from_email]);

  const customProjects = useMemo(
    () => projects.filter((p) => p.slug !== 'general' && p.name.toLowerCase() !== 'general'),
    [projects]
  );

  const needsYouJobs = useMemo(
    () => jobs.filter((j) => j.status === 'needs_approval' || j.status === 'failed'),
    [jobs]
  );

  const pendingApprovalCount = useMemo(
    () => jobs.filter((j) => j.status === 'needs_approval').length,
    [jobs]
  );

  const activeQueueCount = useMemo(
    () => jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'approved').length,
    [jobs]
  );

  const filteredActivityJobs = useMemo(() => {
    if (activityFilter === 'all') return jobs;
    if (activityFilter === 'active') {
      return jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'approved');
    }
    return jobs.filter((j) => j.status === activityFilter);
  }, [jobs, activityFilter]);

  const daemonOnline = isDaemonOnline(settings.daemon_heartbeat_at);
  const caps = settings.daemon_capabilities || {};
  const coworkers = Array.isArray(settings.rerun_coworkers) ? settings.rerun_coworkers : [];

  const showStatus = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => {
      setStatusBanner((prev) => (prev === msg ? null : prev));
    }, 5000);
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (key === 'sql') setCopiedSql(true);
      setTimeout(() => {
        setCopiedKey(null);
        if (key === 'sql') setCopiedSql(false);
      }, 2200);
    } catch {
      showStatus('Copy failed — please select and copy manually.');
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Accessible Tablist Keyboard Handler (roving tabindex + selection follows focus + scrollIntoView)
  const subTabs: { id: SubTabId; label: string; count?: number }[] = [
    { id: 'needs_you', label: 'Needs You', count: needsYouJobs.length },
    { id: 'ventures', label: 'Ventures', count: ventures.length },
    { id: 'activity', label: 'Activity & Queue', count: activeQueueCount },
    { id: 'connections', label: 'Connections' },
  ];

  const selectSubTab = (tabId: SubTabId, focusTab = false) => {
    setActiveSubTab(tabId);
    const el = tabRefs.current[tabId];
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (focusTab) el.focus();
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (index + 1) % subTabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (index - 1 + subTabs.length) % subTabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = subTabs.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      selectSubTab(subTabs[nextIdx].id, true);
    }
  };

  const getEmailDraftForJob = (job: AgentJob) => {
    if (emailDrafts[job.id]) return emailDrafts[job.id];
    const p = job.output_payload || {};
    return {
      to: String(p.to || ''),
      subject: String(p.subject || job.title || ''),
      body: String(p.body || job.output_markdown || ''),
    };
  };

  const getPayloadForJob = (job: AgentJob) => {
    return payloadDrafts[job.id] || job.output_payload || {};
  };

  const getSlackDraftForJob = (job: AgentJob) => {
    if (slackDrafts[job.id]) return slackDrafts[job.id];
    const p = job.output_payload || {};
    return {
      recipientName: String(p.recipientName || p.recipientQuery || ''),
      messageText: String(p.messageText || job.prompt || ''),
    };
  };

  const buildSlackPayload = (job: AgentJob) => {
    const draft = getSlackDraftForJob(job);
    const original = job.output_payload || {};
    const recipientEdited =
      draft.recipientName.trim() !== String(original.recipientName || original.recipientQuery || '').trim();
    return {
      ...getPayloadForJob(job),
      isSlack: true,
      recipientName: draft.recipientName.trim(),
      messageText: draft.messageText.trim(),
      // Daemon re-resolves the Slack user at send time if Justin changed the recipient.
      recipientEdited: recipientEdited || Boolean(original.recipientEdited),
      ...(recipientEdited ? { slackUserId: null, slackChannelId: null } : {}),
    };
  };

  const createAgentJob = async (body: Record<string, any>, successMsg: string) => {
    const res = await fetch('/api/agents/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showStatus(`Could not queue job: ${data.error || `HTTP ${res.status}`}`);
      return false;
    }
    showStatus(successMsg);
    await onRefresh();
    return true;
  };

  const easternDateLabel = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  const handleQueueTrainingBrief = async () => {
    setIsQuickSubmitting(true);
    try {
      await createAgentJob(
        {
          agentRole: 'trainer',
          jobType: 'training_brief',
          title: `Daily Classroom & CM Training Brief — ${easternDateLabel()}`,
          prompt: 'Generate the Daily Classroom & Case Management Training Brief from local Turn90 feedback sources.',
          outputPayload: { days: 7, onDemand: true },
        },
        'Queued Daily Training Brief — it will land in Needs You when ready.'
      );
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const handleQueueL10Brief = async (l10Type: 'program' | 'leadership') => {
    const label = l10Type === 'leadership' ? 'Leadership L10' : 'Program L10';
    setIsQuickSubmitting(true);
    try {
      await createAgentJob(
        {
          agentRole: 'ceo',
          jobType: 'l10_brief',
          title: `${label} Pre-Meeting Brief — ${easternDateLabel()}`,
          prompt: `Prepare the ${label} pre-meeting brief.`,
          outputPayload: { l10Type, onDemand: true },
        },
        `Queued ${label} brief — it will land in Needs You when ready.`
      );
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const handleSubmitCodeChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeSpec.trim()) {
      setCodeFormError('Describe the change you want Claude Code to make.');
      return;
    }
    setCodeFormError(null);
    setIsQuickSubmitting(true);
    try {
      const title = codeTitle.trim() || codeSpec.trim().split('\n')[0].slice(0, 80);
      const ok = await createAgentJob(
        {
          agentRole: 'builder',
          jobType: 'code_change',
          title,
          prompt: codeSpec.trim(),
          outputPayload: {
            targetRepo: codeRepo,
            executionMode: codeMode,
            verbatimSpec: codeSpec.trim(),
            pushOnApprove: codePushOnApprove,
          },
        },
        `Queued code change for ${CODE_REPO_LABELS[codeRepo] || codeRepo} — review the diff in Needs You before anything is committed.`
      );
      if (ok) {
        setCodeTitle('');
        setCodeSpec('');
        setCodePushOnApprove(false);
        setQuickPanel('none');
      }
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const handleStageSlack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageSlackRecipient.trim() || !stageSlackText.trim()) {
      setStageSlackError('Enter both a staff recipient and a message.');
      return;
    }
    setStageSlackError(null);
    setIsQuickSubmitting(true);
    try {
      const recipient = stageSlackRecipient.trim();
      const text = stageSlackText.trim();
      // Queued -> daemon resolves the Slack user -> lands in Needs You. Never sent until Approve.
      const ok = await createAgentJob(
        {
          agentRole: 'outreach',
          jobType: 'slack_message',
          title: `Slack ${recipient}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
          prompt: text,
          status: 'queued',
          outputPayload: { isSlack: true, recipientName: recipient, recipientQuery: recipient, messageText: text },
        },
        `Staged Slack draft for ${recipient} — approve it in Needs You to send.`
      );
      if (ok) {
        setStageSlackRecipient('');
        setStageSlackText('');
        setQuickPanel('none');
      }
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const handleLaunchVenture = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { name?: string; idea?: string; project?: string } = {};

    let resolvedName = ventureName.trim();
    let resolvedProjectId: string | undefined;

    if (launchMode === 'existing') {
      const matched = customProjects.find((p) => p.id === selectedExistingProjectId);
      if (!matched) {
        errors.project = 'Select an existing project to activate its AI team.';
      } else {
        resolvedProjectId = matched.id;
        if (!resolvedName) resolvedName = matched.name;
      }
    } else if (!resolvedName) {
      errors.name = 'Enter a venture or project name.';
    }

    if (!ventureIdea.trim() && launchMode === 'new') {
      errors.idea = 'Describe your idea or goal in 1–2 sentences so the AI CEO can plan it.';
    }

    if (Object.keys(errors).length > 0) {
      setVentureFormErrors(errors);
      if (errors.project) existingProjSelectRef.current?.focus();
      else if (errors.name) ventureNameInputRef.current?.focus();
      else if (errors.idea) ventureIdeaInputRef.current?.focus();
      return;
    }

    setVentureFormErrors({});
    setIsLaunchingVenture(true);

    try {
      const matchedProj = customProjects.find((p) => p.id === resolvedProjectId);
      const res = await fetch('/api/agents/ventures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: resolvedName,
          projectId: resolvedProjectId,
          createLinkedProject: launchMode === 'new',
          ideaPrompt:
            ventureIdea.trim() ||
            matchedProj?.goal ||
            matchedProj?.instructions ||
            `Execute and grow ${resolvedName}`,
          targetAudience: ventureAudience.trim(),
          icpQuery: ventureIcp.trim(),
          rerunWebhookUrl: ventureWebhook.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showStatus(`Could not launch venture: ${data.error || 'Unknown error'}`);
        return;
      }

      setVentureName('');
      setVentureIdea('');
      setVentureAudience('');
      setVentureIcp('');
      setVentureWebhook('');
      showStatus(
        `Launched "${resolvedName}" — AI CEO is building the strategy and task plan now.`
      );
      await onRefresh();
      selectSubTab('activity');
    } catch (err: any) {
      showStatus(`Failed to launch venture: ${err?.message || String(err)}`);
    } finally {
      setIsLaunchingVenture(false);
    }
  };

  const handleApproveJob = async (job: AgentJob) => {
    setBusyJobIds((prev) => ({ ...prev, [job.id]: true }));
    try {
      const nextPayload: Record<string, any> = { ...getPayloadForJob(job) };
      let nextMarkdown =
        markdownDrafts[job.id] !== undefined ? markdownDrafts[job.id] : job.output_markdown;

      if (isEmailJob(job)) {
        const draft = getEmailDraftForJob(job);
        if (!draft.to.trim() || !draft.to.includes('@')) {
          showStatus('Please enter a valid recipient email address before approving.');
          setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
          return;
        }
        nextPayload.to = draft.to.trim();
        nextPayload.subject = draft.subject.trim() || job.title;
        nextPayload.body = draft.body;
        nextPayload.isEmail = true;
        nextMarkdown = `**To:** ${nextPayload.to}\n**Subject:** ${nextPayload.subject}\n\n---\n\n${nextPayload.body}`;
      }

      if (isSlackJob(job)) {
        const slackPayload = buildSlackPayload(job);
        if (!slackPayload.recipientName) {
          showStatus('Please enter a staff recipient before approving this Slack message.');
          setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
          return;
        }
        if (!slackPayload.messageText) {
          showStatus('Slack message is empty — add the message text before approving.');
          setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
          return;
        }
        Object.assign(nextPayload, slackPayload);
        nextMarkdown = `**Slack DM to:** ${slackPayload.recipientName}\n\n---\n\n${slackPayload.messageText}`;
      }

      const selectedRerunUrl = rerunDispatchByJob[job.id];
      if (selectedRerunUrl) {
        const cw = coworkers.find((c) => c.webhookUrl === selectedRerunUrl);
        nextPayload.rerunWebhookUrl = selectedRerunUrl;
        nextPayload.coworkerName = cw?.name || 'Rerun Coworker';
        nextPayload.dispatchToRerun = true;
      }

      const res = await fetch('/api/agents/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          action: 'approve',
          outputMarkdown: nextMarkdown,
          outputPayload: nextPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showStatus(`Approval failed: ${data.error || 'Unknown error'}`);
        return;
      }

      setEditingJobId((prev) => (prev === job.id ? null : prev));
      showStatus(
        isEmailJob(job)
          ? `Approved — sending email to ${nextPayload.to} via Gmail right now.`
          : isSlackJob(job)
          ? `Approved — sending Slack DM to ${nextPayload.recipientName} now.`
          : job.job_type === 'code_change'
          ? `Approved — committing "${job.title}" now.`
          : `Approved "${job.title}" — executing in background.`
      );
      await onRefresh();
      if (job.job_type === 'plan_venture' && onTasksRefresh) {
        setTimeout(() => onTasksRefresh(), 2500);
      }
    } finally {
      setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const handleSubmitRevision = async (e: React.FormEvent, job: AgentJob) => {
    e.preventDefault();
    if (!revisionText.trim()) {
      setRevisionError('Tell the agent what to change before sending back.');
      return;
    }
    setRevisionError(null);
    setBusyJobIds((prev) => ({ ...prev, [job.id]: true }));
    try {
      const res = await fetch('/api/agents/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          action: 'revise',
          revisionFeedback: revisionText.trim(),
        }),
      });
      if (res.ok) {
        setRevisingJobId(null);
        setRevisionText('');
        showStatus(`Sent revision instructions back to ${ROLE_LABELS[job.agent_role] || job.agent_role}.`);
        await onRefresh();
      }
    } finally {
      setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const handleRejectJob = async (job: AgentJob) => {
    setBusyJobIds((prev) => ({ ...prev, [job.id]: true }));
    try {
      await fetch('/api/agents/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, action: 'reject' }),
      });
      showStatus(`Dismissed "${job.title}".`);
      await onRefresh();
    } finally {
      setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const handleRetryJob = async (job: AgentJob, retryMode: 'execute' | 'regenerate') => {
    setBusyJobIds((prev) => ({ ...prev, [job.id]: true }));
    try {
      const nextPayload = isEmailJob(job)
        ? {
            ...getPayloadForJob(job),
            ...getEmailDraftForJob(job),
            isEmail: true,
          }
        : isSlackJob(job)
        ? buildSlackPayload(job)
        : getPayloadForJob(job);

      await fetch('/api/agents/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          action: 'retry',
          retryMode,
          outputPayload: nextPayload,
        }),
      });
      showStatus(
        retryMode === 'execute'
          ? `Retrying execution for "${job.title}"...`
          : `Re-queued "${job.title}" for regeneration.`
      );
      await onRefresh();
    } finally {
      setBusyJobIds((prev) => ({ ...prev, [job.id]: false }));
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await fetch(`/api/agents/jobs?id=${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    await onRefresh();
  };

  const handleSpawnVentureJob = async (
    venture: AgentVenture,
    agentRole: string,
    jobType: AgentJobType,
    title: string,
    prompt: string,
    outputPayload: Record<string, any> = {}
  ) => {
    try {
      const res = await fetch('/api/agents/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ventureId: venture.id,
          projectId: venture.project_id || null,
          agentRole,
          jobType,
          title,
          prompt,
          outputPayload,
        }),
      });
      if (res.ok) {
        showStatus(`Queued ${ROLE_LABELS[agentRole] || agentRole} job: "${title}"`);
        await onRefresh();
      }
    } catch (err: any) {
      showStatus(`Failed to queue agent job: ${err?.message || String(err)}`);
    }
  };

  const handleSaveVentureEdits = async (venture: AgentVenture) => {
    const edits = ventureEdits[venture.id];
    if (!edits) return;
    await fetch('/api/agents/ventures', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: venture.id,
        icpQuery: edits.icp,
        rerunWebhookUrl: edits.webhook,
      }),
    });
    showStatus(`Updated ICP & Rerun webhook for ${venture.name}.`);
    await onRefresh();
  };

  const handleToggleVentureAutopilot = async (venture: AgentVenture) => {
    await fetch('/api/agents/ventures', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: venture.id,
        autopilotEnabled: !venture.autopilot_enabled,
      }),
    });
    await onRefresh();
  };

  const handleDeleteVenture = async (venture: AgentVenture) => {
    if (!window.confirm(`Delete venture "${venture.name}" and its agent jobs? (Your linked Project/Tasks remain.)`)) {
      return;
    }
    await fetch(`/api/agents/ventures?id=${encodeURIComponent(venture.id)}`, { method: 'DELETE' });
    showStatus(`Deleted venture "${venture.name}".`);
    await onRefresh();
  };

  const handleSaveGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await fetch('/api/agents/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_rerun_webhook_url: defaultRerunUrl.trim(),
          default_from_email: defaultFromEmail.trim(),
        }),
      });
      if (res.ok) {
        showStatus('Saved AI CEO connection defaults.');
        await onRefresh();
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleAddCoworker = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { name?: string; url?: string } = {};
    if (!cwName.trim()) errs.name = 'Coworker name is required.';
    if (!cwUrl.trim() || !/^https?:\/\//i.test(cwUrl.trim())) {
      errs.url = 'Enter a valid https:// Rerun webhook URL.';
    }
    if (Object.keys(errs).length > 0) {
      setCwErrors(errs);
      if (errs.name) cwNameRef.current?.focus();
      else cwUrlRef.current?.focus();
      return;
    }
    setCwErrors({});
    setIsSavingSettings(true);
    try {
      const nextList: RerunCoworkerConfig[] = [
        ...coworkers,
        {
          id: crypto.randomUUID(),
          name: cwName.trim(),
          role: cwRole.trim() || 'Operations Coworker',
          webhookUrl: cwUrl.trim(),
          autoTriggers: cwTriggers,
        },
      ];
      const res = await fetch('/api/agents/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerun_coworkers: nextList }),
      });
      if (res.ok) {
        setCwName('');
        setCwRole('');
        setCwUrl('');
        setCwTriggers(['content_draft']);
        showStatus(`Added Rerun Coworker "${cwName.trim()}".`);
        await onRefresh();
      }
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleRemoveCoworker = async (cwId: string) => {
    const nextList = coworkers.filter((c) => c.id !== cwId);
    await fetch('/api/agents/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rerun_coworkers: nextList }),
    });
    await onRefresh();
  };

  const handleTestWebhook = async (idKey: string, webhookUrl: string, coworkerName: string) => {
    setTestingWebhookId(idKey);
    try {
      const res = await fetch('/api/agents/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testWebhook: true, webhookUrl, coworkerName }),
      });
      const data = await res.json();
      setWebhookTestResults((prev) => ({
        ...prev,
        [idKey]: {
          ok: Boolean(data.ok),
          msg: data.ok
            ? `Connected (HTTP ${data.status})`
            : data.error || 'Connection failed',
        },
      }));
    } catch (err: any) {
      setWebhookTestResults((prev) => ({
        ...prev,
        [idKey]: { ok: false, msg: err?.message || 'Network error' },
      }));
    } finally {
      setTestingWebhookId(null);
    }
  };

  return (
    <main className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#111318]">
      {/* Header & Live Capabilities Strip */}
      <header className="px-4 md:px-5 py-3 border-b border-white/[0.06] space-y-2.5 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              <Bot className="h-4 w-4 text-indigo-400" />
              <span>AI CEO & Autonomous Workforce</span>
              {pendingApprovalCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold">
                  {pendingApprovalCount} Needs You
                </span>
              )}
            </h1>
            <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">
              Launch ideas, source prospects via LeadOcean, orchestrate Rerun coworkers, and auto-send approved emails via Gmail.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                daemonOnline
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              }`}
              title={`Last heartbeat: ${formatRelativeTime(settings.daemon_heartbeat_at)}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  daemonOnline ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span>{daemonOnline ? 'Daemon Online' : 'Daemon Offline'}</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border ${
                caps.gmailSendReady
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
              }`}
            >
              <Mail className="h-3 w-3" />
              <span>{caps.gmailSendReady ? 'Gmail Auto-Send Ready' : 'Gmail Needs Auth'}</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border ${
                caps.leadoceanConfigured
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
              }`}
            >
              <Users className="h-3 w-3" />
              <span>{caps.leadoceanConfigured ? 'LeadOcean Live' : 'LeadOcean Preview'}</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border ${
                coworkers.length > 0 || Boolean(defaultRerunUrl)
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
              }`}
            >
              <Webhook className="h-3 w-3" />
              <span>Rerun ({coworkers.length})</span>
            </span>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Accessible Single-Row Tablist (No wrapping, non-color active indicator) */}
        <div
          role="tablist"
          aria-label="AI CEO views"
          className="flex items-center gap-1 overflow-x-auto border-t border-white/[0.05] pt-2"
        >
          {subTabs.map((tab, idx) => {
            const isSelected = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[tab.id] = el;
                }}
                id={`aiceo-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => selectSubTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`relative flex-none inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 ${
                  isSelected
                    ? 'text-white border-indigo-400 bg-white/[0.04] rounded-t-lg'
                    : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-white/[0.03] rounded-lg'
                }`}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      tab.id === 'needs_you' && tab.count > 0
                        ? 'bg-amber-500/25 text-amber-300'
                        : 'bg-white/[0.08] text-slate-300'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Live Status Announcement Region */}
      <div role="status" aria-live="polite" className="shrink-0">
        {statusBanner && (
          <div className="mx-4 md:mx-5 mt-3 px-3.5 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/35 text-xs text-indigo-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span>{statusBanner}</span>
            </span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              aria-label="Dismiss notification"
              className="text-indigo-300 hover:text-white p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Quick Actions & App Builder */}
        <section
          aria-labelledby="quick-actions-heading"
          className="mx-4 md:mx-5 mt-4 rounded-2xl bg-[#151820] border border-white/[0.08] p-3 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="quick-actions-heading" className="text-xs font-bold text-white flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              <span>Quick Actions & App Builder</span>
            </h2>
            {!daemonOnline && (
              <span className="text-[10px] text-amber-300">Daemon offline — jobs will run when it reconnects.</span>
            )}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setQuickPanel(quickPanel === 'code' ? 'none' : 'code')}
              aria-expanded={quickPanel === 'code'}
              className={`flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                quickPanel === 'code'
                  ? 'bg-sky-600 text-white'
                  : 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
              }`}
            >
              <Hammer className="h-3.5 w-3.5" />
              <span>Code Change (AG + Claude Code)</span>
            </button>
            <button
              type="button"
              disabled={isQuickSubmitting}
              onClick={handleQueueTrainingBrief}
              className="flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold disabled:opacity-50"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              <span>Generate Daily Training Brief Now</span>
            </button>
            <button
              type="button"
              disabled={isQuickSubmitting}
              onClick={() => handleQueueL10Brief('program')}
              className="flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 text-xs font-semibold disabled:opacity-50"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>Prep Program L10 (Tue)</span>
            </button>
            <button
              type="button"
              disabled={isQuickSubmitting}
              onClick={() => handleQueueL10Brief('leadership')}
              className="flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 text-xs font-semibold disabled:opacity-50"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span>Prep Leadership L10 (Wed 12:00)</span>
            </button>
            <button
              type="button"
              onClick={() => setQuickPanel(quickPanel === 'slack' ? 'none' : 'slack')}
              aria-expanded={quickPanel === 'slack'}
              className={`flex-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                quickPanel === 'slack'
                  ? 'bg-fuchsia-600 text-white'
                  : 'bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Stage 1-Tap Staff Slack</span>
            </button>
          </div>

          {quickPanel === 'code' && (
            <form
              onSubmit={handleSubmitCodeChange}
              aria-label="Queue a code change"
              className="rounded-xl bg-[#111318] border border-sky-500/25 p-3 space-y-3"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="code-repo" className="text-[11px] font-semibold text-slate-400">
                    Repo
                  </label>
                  <select
                    id="code-repo"
                    value={codeRepo}
                    onChange={(e) => setCodeRepo(e.target.value)}
                    className="bg-[#1B1E26] border border-white/[0.08] rounded-lg px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    {CODE_REPO_OPTIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset className="flex flex-col gap-1">
                  <legend className="text-[11px] font-semibold text-slate-400">Mode</legend>
                  <div className="flex flex-wrap items-center gap-3 pt-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="radio"
                        name="codeMode"
                        checked={codeMode === 'antigravity_claude'}
                        onChange={() => setCodeMode('antigravity_claude')}
                        className="h-4 w-4 accent-sky-500"
                      />
                      <span>Antigravity Orchestrates Claude Code</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="radio"
                        name="codeMode"
                        checked={codeMode === 'claude_direct'}
                        onChange={() => setCodeMode('claude_direct')}
                        className="h-4 w-4 accent-sky-500"
                      />
                      <span>Direct Claude Code (0 AG Credits)</span>
                    </label>
                  </div>
                </fieldset>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="code-title" className="text-[11px] font-semibold text-slate-400">
                  Title (optional)
                </label>
                <input
                  id="code-title"
                  type="text"
                  value={codeTitle}
                  onChange={(e) => setCodeTitle(e.target.value)}
                  placeholder="e.g. Add Training folder shortcut to Notes"
                  className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="code-spec" className="text-[11px] font-semibold text-slate-400">
                  Spec (your words go to Claude Code verbatim)
                </label>
                <textarea
                  id="code-spec"
                  rows={4}
                  value={codeSpec}
                  aria-invalid={Boolean(codeFormError)}
                  onChange={(e) => {
                    setCodeSpec(e.target.value);
                    if (codeFormError) setCodeFormError(null);
                  }}
                  className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                />
                {codeFormError && <span className="text-[11px] text-rose-400">{codeFormError}</span>}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={codePushOnApprove}
                    onChange={(e) => setCodePushOnApprove(e.target.checked)}
                    className="h-4 w-4 accent-sky-500"
                  />
                  <span>Push to remote after I approve the commit</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500">
                    {caps.claudeCodeReady ? 'Claude Code ready' : 'Claude Code not detected on daemon'}
                  </span>
                  <button
                    type="submit"
                    disabled={isQuickSubmitting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Queue Code Change</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {quickPanel === 'slack' && (
            <form
              onSubmit={handleStageSlack}
              aria-label="Stage a Slack message for approval"
              className="rounded-xl bg-[#111318] border border-fuchsia-500/25 p-3 space-y-3"
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="stage-slack-to" className="text-[11px] font-semibold text-slate-400">
                  Staff Recipient
                </label>
                <input
                  id="stage-slack-to"
                  type="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={stageSlackRecipient}
                  onChange={(e) => setStageSlackRecipient(e.target.value)}
                  placeholder="e.g. Matt, Jenn, Casey"
                  className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="stage-slack-text" className="text-[11px] font-semibold text-slate-400">
                  Message
                </label>
                <textarea
                  id="stage-slack-text"
                  rows={3}
                  value={stageSlackText}
                  onChange={(e) => setStageSlackText(e.target.value)}
                  className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-slate-100 focus:outline-none focus:border-fuchsia-500"
                />
                {stageSlackError && <span className="text-[11px] text-rose-400">{stageSlackError}</span>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  Lands in Needs You as a draft — nothing sends until you tap Approve.
                </span>
                <button
                  type="submit"
                  disabled={isQuickSubmitting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-xs font-bold text-white disabled:opacity-50"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Stage Draft</span>
                </button>
              </div>
            </form>
          )}
        </section>

        {/* One-time Supabase Migration Card */}
        {needsMigration && (
          <section className="mx-4 md:mx-5 mt-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-bold text-amber-200">
                    One-Time Database Setup Required
                  </h2>
                  <p className="text-xs text-amber-200/80 mt-0.5">
                    Copy this SQL and run it once in your Supabase SQL Editor to create{' '}
                    <code className="text-white">agent_ventures</code>,{' '}
                    <code className="text-white">agent_jobs</code>, and{' '}
                    <code className="text-white">agent_settings</code>.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopy(AGENT_SCHEMA_SQL, 'sql')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                >
                  {copiedSql ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedSql ? 'Copied SQL' : 'Copy SQL'}</span>
                </button>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white font-medium"
                >
                  <span>Supabase</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                >
                  Re-check Database
                </button>
              </div>
            </div>
            <pre className="max-h-40 overflow-auto rounded-xl bg-black/40 border border-white/[0.08] p-3 text-[11px] text-slate-300 font-mono">
              {AGENT_SCHEMA_SQL}
            </pre>
          </section>
        )}

        {/* TAB 1: NEEDS YOU INBOX */}
        <div
          role="tabpanel"
          aria-labelledby="aiceo-tab-needs_you"
          hidden={activeSubTab !== 'needs_you'}
          tabIndex={activeSubTab === 'needs_you' && needsYouJobs.length === 0 ? 0 : undefined}
        >
          <div className="p-4 md:p-5 space-y-4">
            {needsYouJobs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/[0.1] bg-[#151820]/60 p-8 text-center space-y-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto" />
                <h2 className="text-sm font-bold text-white">Your Needs You Inbox is Clear</h2>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Launch a new venture idea or delegate any task from your ToDo list with the{' '}
                  <strong className="text-slate-200">AI Assist</strong> button. Finished drafts,
                  LeadOcean prospects, and outreach emails will land right here for 1-click approval.
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => selectSubTab('ventures')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                  >
                    <Rocket className="h-3.5 w-3.5" />
                    <span>Launch New Venture</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSubTab('connections')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-200"
                  >
                    <Webhook className="h-3.5 w-3.5" />
                    <span>Setup Gmail & Rerun</span>
                  </button>
                </div>
              </div>
            ) : (
              needsYouJobs.map((job) => {
                const venture = ventures.find((v) => v.id === job.venture_id);
                const isBusy = Boolean(busyJobIds[job.id]);
                const isEditing = editingJobId === job.id;
                const emailMode = isEmailJob(job);
                const emailDraft = getEmailDraftForJob(job);
                const slackMode = isSlackJob(job);
                const slackDraft = getSlackDraftForJob(job);
                const payload = getPayloadForJob(job);
                const isFailed = job.status === 'failed';
                const isCodeChange = job.job_type === 'code_change';
                const isTrainingBrief = job.job_type === 'training_brief';
                const isL10Brief = job.job_type === 'l10_brief';

                return (
                  <article
                    key={job.id}
                    className={`rounded-2xl border p-4 space-y-3.5 ${
                      isFailed
                        ? 'bg-rose-950/20 border-rose-500/35'
                        : 'bg-[#151820] border-white/[0.08]'
                    }`}
                  >
                    {/* Card Header */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase tracking-wider">
                            {ROLE_LABELS[job.agent_role] || job.agent_role}
                          </span>
                          {slackMode && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-semibold">
                              <MessageSquare className="h-2.5 w-2.5" />
                              <span>1-Tap Staff Slack</span>
                            </span>
                          )}
                          {isCodeChange && (
                            <>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 text-[10px] font-semibold">
                                <GitBranch className="h-2.5 w-2.5" />
                                <span>{CODE_REPO_LABELS[payload.targetRepo] || payload.targetRepo || 'ToDo App'}</span>
                              </span>
                              <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-[10px] font-semibold">
                                {payload.executionMode === 'claude_direct' ? 'Direct Claude' : 'Antigravity → Claude Code'}
                              </span>
                            </>
                          )}
                          {isTrainingBrief && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                              <GraduationCap className="h-2.5 w-2.5" />
                              <span>Training Brief{payload.briefDate ? ` · ${payload.briefDate}` : ''}</span>
                            </span>
                          )}
                          {isL10Brief && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-200 text-[10px] font-semibold">
                              <CalendarClock className="h-2.5 w-2.5" />
                              <span>{payload.l10Type === 'leadership' ? 'Leadership L10 (Wed 12:00)' : 'Program L10 (Tue)'}</span>
                            </span>
                          )}
                          {venture && (
                            <span className="px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-300 text-[10px] font-medium">
                              {venture.name}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                              isFailed
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {isFailed ? 'Failed — Action Needed' : 'Needs You'}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatRelativeTime(job.updated_at || job.created_at)}
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-white break-words">{job.title}</h2>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!emailMode && !slackMode && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!isEditing && markdownDrafts[job.id] === undefined) {
                                setMarkdownDrafts((prev) => ({ ...prev, [job.id]: job.output_markdown || '' }));
                              }
                              setEditingJobId(isEditing ? null : job.id);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>{isEditing ? 'Preview' : 'Edit'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRevisingJobId(revisingJobId === job.id ? null : job.id);
                            setRevisionError(null);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Revise</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectJob(job)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-rose-500/20 text-xs text-slate-400 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>

                    {/* Failure Banner */}
                    {isFailed && job.execution_error && (
                      <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 px-3 py-2.5 text-xs text-rose-200 space-y-2">
                        <div className="font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          <span>Error Details</span>
                        </div>
                        <p className="font-mono text-[11px] break-all text-rose-100">
                          {job.execution_error}
                        </p>
                      </div>
                    )}

                    {/* Card Body by Job Type */}
                    {emailMode ? (
                      <div className="rounded-xl bg-[#111318] border border-white/[0.06] p-3.5 space-y-3">
                        {(payload.toName || payload.company || payload.title) && (
                          <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                            <span>Prospect:</span>
                            <strong className="text-slate-200">{payload.toName || 'Contact'}</strong>
                            {payload.title && <span>• {payload.title}</span>}
                            {payload.company && <span>at {payload.company}</span>}
                            {payload.linkedinUrl && (
                              <a
                                href={payload.linkedinUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-400 hover:underline inline-flex items-center gap-0.5"
                              >
                                <span>LinkedIn</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`email-to-${job.id}`}
                              className="text-[11px] font-semibold text-slate-400"
                            >
                              To (Recipient Email)
                            </label>
                            <input
                              id={`email-to-${job.id}`}
                              type="email"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={emailDraft.to}
                              onChange={(e) =>
                                setEmailDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: { ...emailDraft, to: e.target.value },
                                }))
                              }
                              placeholder="name@company.com"
                              className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                            />
                          </div>

                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`email-subject-${job.id}`}
                              className="text-[11px] font-semibold text-slate-400"
                            >
                              Subject
                            </label>
                            <input
                              id={`email-subject-${job.id}`}
                              type="text"
                              value={emailDraft.subject}
                              onChange={(e) =>
                                setEmailDrafts((prev) => ({
                                  ...prev,
                                  [job.id]: { ...emailDraft, subject: e.target.value },
                                }))
                              }
                              className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`email-body-${job.id}`}
                            className="text-[11px] font-semibold text-slate-400"
                          >
                            Email Body (Auto-sends immediately on Approve)
                          </label>
                          <textarea
                            id={`email-body-${job.id}`}
                            rows={6}
                            value={emailDraft.body}
                            onChange={(e) =>
                              setEmailDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...emailDraft, body: e.target.value },
                              }))
                            }
                            className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    ) : slackMode ? (
                      <div className="rounded-xl bg-[#111318] border border-fuchsia-500/20 p-3.5 space-y-3">
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`slack-to-${job.id}`}
                            className="text-[11px] font-semibold text-slate-400"
                          >
                            Staff Recipient (Slack)
                          </label>
                          <input
                            id={`slack-to-${job.id}`}
                            type="text"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={slackDraft.recipientName}
                            onChange={(e) =>
                              setSlackDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...slackDraft, recipientName: e.target.value },
                              }))
                            }
                            placeholder="e.g. Matt"
                            className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-500"
                          />
                          {payload.slackHandle && (
                            <span className="text-[11px] text-slate-500">Resolved: @{payload.slackHandle}</span>
                          )}
                          {payload.resolveError && !payload.slackUserId && !payload.slackChannelId && (
                            <span className="text-[11px] text-amber-300">
                              Recipient not resolved yet ({String(payload.resolveError)}) — the daemon will look them up when you approve.
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`slack-body-${job.id}`}
                            className="text-[11px] font-semibold text-slate-400"
                          >
                            Message Text (sent only when you tap Approve)
                          </label>
                          <textarea
                            id={`slack-body-${job.id}`}
                            rows={5}
                            value={slackDraft.messageText}
                            onChange={(e) =>
                              setSlackDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...slackDraft, messageText: e.target.value },
                              }))
                            }
                            className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-fuchsia-500"
                          />
                        </div>
                        {payload.verbatimQuote && (
                          <blockquote className="border-l-2 border-amber-500/60 pl-2.5 text-[11px] text-amber-200/90 italic">
                            Verbatim (Letterly): &ldquo;{String(payload.verbatimQuote)}&rdquo;
                          </blockquote>
                        )}
                      </div>
                    ) : isEditing ? (
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`edit-md-${job.id}`}
                          className="text-[11px] font-semibold text-slate-400"
                        >
                          Edit Deliverable Markdown
                        </label>
                        <textarea
                          id={`edit-md-${job.id}`}
                          rows={10}
                          value={markdownDrafts[job.id] ?? job.output_markdown ?? ''}
                          onChange={(e) =>
                            setMarkdownDrafts((prev) => ({ ...prev, [job.id]: e.target.value }))
                          }
                          className="w-full bg-[#111318] border border-white/[0.08] rounded-xl p-3 text-base sm:text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ) : (
                      <div className="rounded-xl bg-[#111318] border border-white/[0.06] p-3.5 max-h-96 overflow-y-auto">
                        <MarkdownPreview content={markdownDrafts[job.id] ?? job.output_markdown} />
                      </div>
                    )}

                    {/* Plan Venture Interactive Checklists */}
                    {job.job_type === 'plan_venture' && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <fieldset className="rounded-xl bg-[#111318] border border-white/[0.06] p-3 space-y-2">
                          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            ToDo Tasks to Create ({(payload.humanTasks || []).length})
                          </legend>
                          {(payload.humanTasks || []).map((t: any, idx: number) => {
                            const cid = `plan-task-${job.id}-${idx}`;
                            const checked = t.selected !== false;
                            return (
                              <div key={cid} className="flex items-start gap-2">
                                <input
                                  id={cid}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextTasks = [...(payload.humanTasks || [])];
                                    nextTasks[idx] = { ...t, selected: e.target.checked };
                                    setPayloadDrafts((prev) => ({
                                      ...prev,
                                      [job.id]: { ...payload, humanTasks: nextTasks },
                                    }));
                                  }}
                                  className="mt-0.5 h-4 w-4 accent-indigo-500 shrink-0"
                                />
                                <label htmlFor={cid} className="text-xs text-slate-200 cursor-pointer">
                                  <span>{t.title}</span>
                                  <span className="ml-1.5 text-[10px] text-slate-500">
                                    ({t.estimatedMinutes || 15}m)
                                  </span>
                                </label>
                              </div>
                            );
                          })}
                        </fieldset>

                        <fieldset className="rounded-xl bg-[#111318] border border-white/[0.06] p-3 space-y-2">
                          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Next Agents to Auto-Queue ({(payload.recommendedAgentJobs || []).length})
                          </legend>
                          {(payload.recommendedAgentJobs || []).map((aj: any, idx: number) => {
                            const cid = `plan-job-${job.id}-${idx}`;
                            const checked = aj.selected !== false;
                            return (
                              <div key={cid} className="flex items-start gap-2">
                                <input
                                  id={cid}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextJobs = [...(payload.recommendedAgentJobs || [])];
                                    nextJobs[idx] = { ...aj, selected: e.target.checked };
                                    setPayloadDrafts((prev) => ({
                                      ...prev,
                                      [job.id]: { ...payload, recommendedAgentJobs: nextJobs },
                                    }));
                                  }}
                                  className="mt-0.5 h-4 w-4 accent-indigo-500 shrink-0"
                                />
                                <label htmlFor={cid} className="text-xs text-slate-200 cursor-pointer">
                                  <span className="text-indigo-300 font-semibold mr-1">
                                    [{ROLE_LABELS[aj.agentRole] || aj.agentRole}]
                                  </span>
                                  <span>{aj.title}</span>
                                </label>
                              </div>
                            );
                          })}
                        </fieldset>
                      </div>
                    )}

                    {/* LeadOcean Lead Selection Checkboxes */}
                    {job.job_type === 'lead_search' && Array.isArray(payload.leads) && payload.leads.length > 0 && (
                      <fieldset className="rounded-xl bg-[#111318] border border-white/[0.06] p-3 space-y-2">
                        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Select Prospects to Auto-Draft Outreach Emails
                        </legend>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {(payload.leads as LeadRecord[]).map((lead, idx) => {
                            const cid = `lead-sel-${job.id}-${idx}`;
                            const hasEmail = Boolean(lead.email && lead.email.includes('@'));
                            const checked = hasEmail && lead.selected !== false;
                            return (
                              <div
                                key={cid}
                                className="flex items-start gap-2 p-2 rounded-lg bg-[#1B1E26]/70 border border-white/[0.05]"
                              >
                                <input
                                  id={cid}
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!hasEmail}
                                  onChange={(e) => {
                                    const nextLeads = [...(payload.leads as LeadRecord[])];
                                    nextLeads[idx] = { ...lead, selected: e.target.checked };
                                    setPayloadDrafts((prev) => ({
                                      ...prev,
                                      [job.id]: { ...payload, leads: nextLeads },
                                    }));
                                  }}
                                  className="mt-0.5 h-4 w-4 accent-indigo-500 shrink-0"
                                />
                                <label htmlFor={cid} className="text-xs text-slate-200 cursor-pointer min-w-0">
                                  <div className="font-semibold truncate">{lead.name}</div>
                                  <div className="text-[11px] text-slate-400 truncate">
                                    {lead.title} {lead.company ? `• ${lead.company}` : ''}
                                  </div>
                                  <div className="text-[11px] font-mono text-indigo-300 truncate">
                                    {lead.email || 'No email available'}
                                  </div>
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </fieldset>
                    )}

                    {/* AI Builder: Code Change Diff Preview */}
                    {isCodeChange && (
                      <div className="rounded-xl bg-[#111318] border border-sky-500/20 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          <Code2 className="h-3.5 w-3.5 text-sky-400" />
                          <span>Files Changed ({Array.isArray(payload.changedFiles) ? payload.changedFiles.length : 0})</span>
                          {payload.claudeTimedOut && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 normal-case">Timed out</span>
                          )}
                        </div>
                        {Array.isArray(payload.changedFiles) && payload.changedFiles.length > 0 ? (
                          <ul className="text-[11px] font-mono text-sky-200 space-y-0.5">
                            {(payload.changedFiles as string[]).map((f) => (
                              <li key={f} className="break-all">{f}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-slate-500">No file changes detected yet.</p>
                        )}
                        {payload.diffStat && (
                          <pre className="text-[11px] font-mono text-slate-300 bg-black/30 rounded-lg p-2 overflow-x-auto">
                            {String(payload.diffStat)}
                          </pre>
                        )}
                        {payload.diffPreview && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer text-sky-300 hover:text-sky-200">Show full diff</summary>
                            <pre className="mt-2 max-h-80 overflow-auto font-mono text-[11px] text-slate-300 bg-black/40 rounded-lg p-2 whitespace-pre">
                              {String(payload.diffPreview)}
                            </pre>
                          </details>
                        )}
                        <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={payload.pushOnApprove === true}
                            onChange={(e) =>
                              setPayloadDrafts((prev) => ({
                                ...prev,
                                [job.id]: { ...payload, pushOnApprove: e.target.checked },
                              }))
                            }
                            className="h-4 w-4 accent-sky-500"
                          />
                          <span>Also push to remote after committing</span>
                        </label>
                      </div>
                    )}

                    {/* Training Brief: optional 1-tap Slack coaching check-ins */}
                    {isTrainingBrief &&
                      Array.isArray(payload.proposedSlackCheckins) &&
                      payload.proposedSlackCheckins.length > 0 && (
                        <fieldset className="rounded-xl bg-[#111318] border border-white/[0.06] p-3 space-y-2">
                          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Optional Staff Slack Check-ins (each becomes its own 1-tap approval card)
                          </legend>
                          {(payload.proposedSlackCheckins as { recipientName: string; messageText: string; selected?: boolean }[]).map(
                            (c, idx) => {
                              const cid = `checkin-${job.id}-${idx}`;
                              return (
                                <div key={cid} className="flex items-start gap-2">
                                  <input
                                    id={cid}
                                    type="checkbox"
                                    checked={c.selected === true}
                                    onChange={(e) => {
                                      const next = [...payload.proposedSlackCheckins];
                                      next[idx] = { ...c, selected: e.target.checked };
                                      setPayloadDrafts((prev) => ({
                                        ...prev,
                                        [job.id]: { ...payload, proposedSlackCheckins: next },
                                      }));
                                    }}
                                    className="mt-0.5 h-4 w-4 accent-fuchsia-500 shrink-0"
                                  />
                                  <label htmlFor={cid} className="text-xs text-slate-200 cursor-pointer">
                                    <span className="text-fuchsia-300 font-semibold mr-1">{c.recipientName}:</span>
                                    <span>{c.messageText}</span>
                                  </label>
                                </div>
                              );
                            }
                          )}
                        </fieldset>
                      )}

                    {/* Inline Revision Form */}
                    {revisingJobId === job.id && (
                      <form
                        onSubmit={(e) => handleSubmitRevision(e, job)}
                        aria-labelledby={`revise-title-${job.id}`}
                        className="rounded-xl bg-[#111318] border border-amber-500/35 p-3 space-y-2.5"
                      >
                        <h3 id={`revise-title-${job.id}`} className="text-xs font-bold text-amber-300">
                          Send Revision Feedback to Agent
                        </h3>
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`revise-input-${job.id}`} className="text-[11px] text-slate-400">
                            What should the agent change or focus on?
                          </label>
                          <textarea
                            id={`revise-input-${job.id}`}
                            rows={2}
                            value={revisionText}
                            aria-invalid={Boolean(revisionError)}
                            onChange={(e) => {
                              setRevisionText(e.target.value);
                              if (revisionError) setRevisionError(null);
                            }}
                            placeholder="e.g. Make the email shorter, focus on cost savings, or search HR Directors in Charleston..."
                            className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-lg px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-amber-400"
                          />
                          {revisionError && (
                            <span className="text-[11px] text-rose-400">{revisionError}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={isBusy}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
                          >
                            Re-run with Feedback
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevisingJobId(null)}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-xs text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Action Footer */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1 border-t border-white/[0.06]">
                      {!emailMode && !slackMode && !isCodeChange && coworkers.length > 0 ? (
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`rerun-dispatch-${job.id}`}
                            className="text-[11px] text-slate-400 whitespace-nowrap"
                          >
                            Also send to Rerun:
                          </label>
                          <select
                            id={`rerun-dispatch-${job.id}`}
                            value={rerunDispatchByJob[job.id] || ''}
                            onChange={(e) =>
                              setRerunDispatchByJob((prev) => ({
                                ...prev,
                                [job.id]: e.target.value,
                              }))
                            }
                            className="bg-[#1B1E26] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
                          >
                            <option value="">None (Save to Notes only)</option>
                            {coworkers.map((cw) => (
                              <option key={cw.id} value={cw.webhookUrl}>
                                {cw.name} ({cw.role})
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          {emailMode
                            ? caps.gmailSendReady
                              ? 'Approving triggers immediate Gmail send.'
                              : 'Requires Gmail send OAuth (see Connections tab).'
                            : slackMode
                            ? 'Nothing is sent until you tap Approve.'
                            : isCodeChange
                            ? 'Approving commits only the files listed above.'
                            : isTrainingBrief
                            ? 'Approving saves the brief + stages checked Slack check-ins as separate approval cards.'
                            : isL10Brief
                            ? 'Approving saves the brief to Turn90 Ops & Dual L10s.'
                            : job.job_type === 'plan_venture'
                            ? 'Approving creates checked tasks + starts checked agents.'
                            : job.job_type === 'lead_search'
                            ? 'Approving saves lead table to Notes + drafts emails for checked leads.'
                            : 'Approving saves deliverable to your Notes workspace.'}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {isFailed ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRetryJob(job, 'execute')}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white disabled:opacity-50"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              <span>Retry Execution</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleRetryJob(job, 'regenerate')}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-slate-200 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>Regenerate</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleApproveJob(job)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-sm disabled:opacity-50"
                          >
                            {emailMode || slackMode ? (
                              <Send className="h-3.5 w-3.5" />
                            ) : isCodeChange ? (
                              <GitBranch className="h-3.5 w-3.5" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {isBusy
                                ? 'Submitting...'
                                : emailMode
                                ? 'Approve & Auto-Send'
                                : slackMode
                                ? 'Approve & Send Slack'
                                : isCodeChange
                                ? 'Approve & Commit'
                                : isTrainingBrief || isL10Brief
                                ? 'Approve & Save Brief'
                                : job.job_type === 'plan_venture'
                                ? 'Approve & Launch AI Team'
                                : job.job_type === 'lead_search'
                                ? 'Approve & Draft Outreach'
                                : 'Approve & Execute'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* TAB 2: VENTURES */}
        <div
          role="tabpanel"
          aria-labelledby="aiceo-tab-ventures"
          hidden={activeSubTab !== 'ventures'}
        >
          <div className="p-4 md:p-5 space-y-5">
            {/* Launch New Venture Form */}
            <form
              onSubmit={handleLaunchVenture}
              aria-labelledby="launch-venture-heading"
              className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 id="launch-venture-heading" className="text-sm font-bold text-white flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-indigo-400" />
                    <span>Launch New Idea or Activate Project AI Team</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    The AI CEO will draft your strategy, add your human steps to ToDos, and queue Research + LeadOcean agents.
                  </p>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-[11px] font-semibold text-slate-400">
                  Launch Mode
                </legend>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input
                      id="launch-mode-new"
                      type="radio"
                      name="launchMode"
                      value="new"
                      checked={launchMode === 'new'}
                      onChange={() => {
                        setLaunchMode('new');
                        setVentureFormErrors({});
                      }}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    <label htmlFor="launch-mode-new" className="text-xs text-slate-200 cursor-pointer">
                      New Idea + Linked Project
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="launch-mode-existing"
                      type="radio"
                      name="launchMode"
                      value="existing"
                      checked={launchMode === 'existing'}
                      onChange={() => {
                        setLaunchMode('existing');
                        setVentureFormErrors({});
                      }}
                      className="h-4 w-4 accent-indigo-500"
                    />
                    <label htmlFor="launch-mode-existing" className="text-xs text-slate-200 cursor-pointer">
                      Activate Existing ToDo Project
                    </label>
                  </div>
                </div>
              </fieldset>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {launchMode === 'existing' ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="venture-existing-proj" className="text-[11px] font-semibold text-slate-300">
                      Existing ToDo Project <span aria-hidden="true">*</span>
                    </label>
                    <select
                      ref={existingProjSelectRef}
                      id="venture-existing-proj"
                      value={selectedExistingProjectId}
                      aria-invalid={Boolean(ventureFormErrors.project)}
                      aria-describedby={ventureFormErrors.project ? 'venture-proj-err' : undefined}
                      onChange={(e) => {
                        const pid = e.target.value;
                        setSelectedExistingProjectId(pid);
                        const match = customProjects.find((p) => p.id === pid);
                        if (match && !ventureName) setVentureName(match.name);
                        if (match && !ventureIdea && (match.goal || match.instructions)) {
                          setVentureIdea(match.goal || match.instructions || '');
                        }
                        setVentureFormErrors((prev) => ({ ...prev, project: undefined }));
                      }}
                      className="w-full min-h-[44px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">Choose a project...</option>
                      {customProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {ventureFormErrors.project && (
                      <span id="venture-proj-err" className="text-[11px] text-rose-400">
                        {ventureFormErrors.project}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="venture-name-input" className="text-[11px] font-semibold text-slate-300">
                      Venture / Idea Name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      ref={ventureNameInputRef}
                      id="venture-name-input"
                      type="text"
                      value={ventureName}
                      aria-invalid={Boolean(ventureFormErrors.name)}
                      aria-describedby={ventureFormErrors.name ? 'venture-name-err' : undefined}
                      onChange={(e) => {
                        setVentureName(e.target.value);
                        if (ventureFormErrors.name) setVentureFormErrors((prev) => ({ ...prev, name: undefined }));
                      }}
                      placeholder="e.g. ShiftBridge Employer Network"
                      className="w-full min-h-[44px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    {ventureFormErrors.name && (
                      <span id="venture-name-err" className="text-[11px] text-rose-400">
                        {ventureFormErrors.name}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label htmlFor="venture-audience-input" className="text-[11px] font-semibold text-slate-300">
                    Target Audience / Buyer
                  </label>
                  <input
                    id="venture-audience-input"
                    type="text"
                    value={ventureAudience}
                    onChange={(e) => setVentureAudience(e.target.value)}
                    placeholder="e.g. HR Directors at mid-size logistics companies in SC"
                    className="w-full min-h-[44px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="venture-idea-input" className="text-[11px] font-semibold text-slate-300">
                  Idea / Goal Prompt {launchMode === 'new' && <span aria-hidden="true">*</span>}
                </label>
                <textarea
                  ref={ventureIdeaInputRef}
                  id="venture-idea-input"
                  rows={3}
                  value={ventureIdea}
                  aria-invalid={Boolean(ventureFormErrors.idea)}
                  aria-describedby={ventureFormErrors.idea ? 'venture-idea-err' : undefined}
                  onChange={(e) => {
                    setVentureIdea(e.target.value);
                    if (ventureFormErrors.idea) setVentureFormErrors((prev) => ({ ...prev, idea: undefined }));
                  }}
                  placeholder="Describe what you're building or growing, who it helps, and what outcome you want..."
                  className="w-full bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2.5 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
                {ventureFormErrors.idea && (
                  <span id="venture-idea-err" className="text-[11px] text-rose-400">
                    {ventureFormErrors.idea}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="venture-icp-input" className="text-[11px] font-semibold text-slate-300">
                    LeadOcean Search Query (Optional)
                  </label>
                  <input
                    id="venture-icp-input"
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={ventureIcp}
                    onChange={(e) => setVentureIcp(e.target.value)}
                    placeholder="e.g. HR Director manufacturing Charleston"
                    className="w-full min-h-[44px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="venture-webhook-input" className="text-[11px] font-semibold text-slate-300">
                    Rerun Coworker Webhook URL (Optional)
                  </label>
                  <input
                    id="venture-webhook-input"
                    type="url"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={ventureWebhook}
                    onChange={(e) => setVentureWebhook(e.target.value)}
                    placeholder="https://app.rerun.build/api/webhooks/..."
                    className="w-full min-h-[44px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={isLaunchingVenture}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{isLaunchingVenture ? 'Launching...' : 'Launch AI CEO Plan'}</span>
                </button>
              </div>
            </form>

            {/* Active Ventures List */}
            <div className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Active Ventures ({ventures.length})
              </h2>

              {ventures.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-xs text-slate-500">
                  No ventures yet. Launch your first idea above!
                </div>
              ) : (
                ventures.map((v) => {
                  const linkedProj = projects.find((p) => p.id === v.project_id);
                  const editState = ventureEdits[v.id] || {
                    icp: v.icp_query || '',
                    webhook: v.rerun_webhook_url || '',
                  };
                  const strategyExpanded = expandedStrategyId === v.id;

                  return (
                    <article
                      key={v.id}
                      className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-white">{v.name}</h3>
                            <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold uppercase">
                              {v.stage}
                            </span>
                            {linkedProj && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] text-slate-300 text-[10px]">
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: linkedProj.color }}
                                />
                                <span>{linkedProj.name}</span>
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-300">{v.idea_prompt}</p>
                          {v.target_audience && (
                            <p className="text-[11px] text-slate-400">
                              Audience: {v.target_audience}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <input
                              id={`autopilot-${v.id}`}
                              type="checkbox"
                              checked={v.autopilot_enabled}
                              onChange={() => handleToggleVentureAutopilot(v)}
                              className="h-4 w-4 accent-indigo-500"
                            />
                            <label htmlFor={`autopilot-${v.id}`} className="text-xs text-slate-300 cursor-pointer">
                              Autopilot
                            </label>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteVenture(v)}
                            className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                            title="Delete venture"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Quick Agent Triggers */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleSpawnVentureJob(
                              v,
                              'researcher',
                              'market_research',
                              `Market & Competitor Brief: ${v.name}`,
                              `Research competitors, pricing benchmarks, and SEO opportunities for ${v.name}: ${v.idea_prompt}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-indigo-500/25 text-xs text-slate-200"
                        >
                          <Search className="h-3 w-3 text-indigo-400" />
                          <span>Run Research</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleSpawnVentureJob(
                              v,
                              'leads',
                              'lead_search',
                              `LeadOcean Prospects: ${editState.icp || v.name}`,
                              editState.icp || v.target_audience || v.idea_prompt
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-indigo-500/25 text-xs text-slate-200"
                        >
                          <Users className="h-3 w-3 text-emerald-400" />
                          <span>Find Leads (LeadOcean)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleSpawnVentureJob(
                              v,
                              'content',
                              'content_draft',
                              `SEO & Launch Content: ${v.name}`,
                              `Write a high-converting SEO blog post and 2 LinkedIn launch posts for ${v.name}: ${v.idea_prompt}`
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-indigo-500/25 text-xs text-slate-200"
                        >
                          <FileText className="h-3 w-3 text-amber-400" />
                          <span>Draft Content</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setQuickEmailVentureId(quickEmailVentureId === v.id ? null : v.id);
                            setQuickEmailTo('');
                            setQuickEmailPrompt('');
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-indigo-500/25 text-xs text-slate-200"
                        >
                          <Mail className="h-3 w-3 text-sky-400" />
                          <span>Draft Email</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleSpawnVentureJob(
                              v,
                              'rerun',
                              'rerun_coworker',
                              `Rerun Coworker Handoff: ${v.name}`,
                              `Prepare an actionable workflow brief for Rerun Coworker on ${v.name}: ${v.idea_prompt}`,
                              { rerunWebhookUrl: editState.webhook || defaultRerunUrl }
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-violet-500/25 text-xs text-slate-200"
                        >
                          <Webhook className="h-3 w-3 text-violet-400" />
                          <span>Trigger Rerun</span>
                        </button>

                        {v.strategy_markdown && (
                          <button
                            type="button"
                            onClick={() => setExpandedStrategyId(strategyExpanded ? null : v.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-300 text-xs font-medium ml-auto"
                          >
                            <span>{strategyExpanded ? 'Hide Strategy' : 'View Strategy'}</span>
                          </button>
                        )}
                      </div>

                      {/* Quick Email Draft Drawer */}
                      {quickEmailVentureId === v.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSpawnVentureJob(
                              v,
                              'outreach',
                              'email_outreach',
                              `Outreach: ${quickEmailTo || v.name}`,
                              quickEmailPrompt || `Write a personalized outreach email for ${v.name}`,
                              { to: quickEmailTo.trim(), isEmail: true }
                            );
                            setQuickEmailVentureId(null);
                          }}
                          className="rounded-xl bg-[#111318] border border-white/[0.08] p-3 space-y-2.5"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`qe-to-${v.id}`} className="text-[11px] text-slate-400">
                                Recipient Email
                              </label>
                              <input
                                id={`qe-to-${v.id}`}
                                type="email"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={quickEmailTo}
                                onChange={(e) => setQuickEmailTo(e.target.value)}
                                placeholder="prospect@company.com"
                                className="w-full min-h-[40px] bg-[#1B1E26] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-base sm:text-xs text-white"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label htmlFor={`qe-prompt-${v.id}`} className="text-[11px] text-slate-400">
                                Email Angle / Goal
                              </label>
                              <input
                                id={`qe-prompt-${v.id}`}
                                type="text"
                                value={quickEmailPrompt}
                                onChange={(e) => setQuickEmailPrompt(e.target.value)}
                                placeholder="Intro partnership pitch with 15-min call link"
                                className="w-full min-h-[40px] bg-[#1B1E26] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-base sm:text-xs text-white"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
                            >
                              Queue Email Draft
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickEmailVentureId(null)}
                              className="px-3 py-1.5 rounded-lg bg-white/[0.05] text-xs text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Venture ICP & Webhook Inline Settings */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-white/[0.05]">
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`v-icp-${v.id}`} className="text-[10px] font-semibold uppercase text-slate-500">
                            LeadOcean ICP Query
                          </label>
                          <input
                            id={`v-icp-${v.id}`}
                            type="text"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={editState.icp}
                            onChange={(e) =>
                              setVentureEdits((prev) => ({
                                ...prev,
                                [v.id]: { ...editState, icp: e.target.value },
                              }))
                            }
                            className="bg-[#111318] border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-base sm:text-xs text-slate-200"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`v-hook-${v.id}`} className="text-[10px] font-semibold uppercase text-slate-500">
                            Venture Rerun Webhook
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              id={`v-hook-${v.id}`}
                              type="url"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={editState.webhook}
                              onChange={(e) =>
                                setVentureEdits((prev) => ({
                                  ...prev,
                                  [v.id]: { ...editState, webhook: e.target.value },
                                }))
                              }
                              placeholder="https://..."
                              className="flex-1 bg-[#111318] border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-base sm:text-xs text-slate-200"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveVentureEdits(v)}
                              className="px-2.5 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs text-white font-medium shrink-0"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>

                      {strategyExpanded && v.strategy_markdown && (
                        <div className="rounded-xl bg-[#111318] border border-white/[0.06] p-3.5 max-h-80 overflow-y-auto">
                          <MarkdownPreview content={v.strategy_markdown} />
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* TAB 3: ACTIVITY & QUEUE */}
        <div
          role="tabpanel"
          aria-labelledby="aiceo-tab-activity"
          hidden={activeSubTab !== 'activity'}
        >
          <div className="p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Agent Job Log ({filteredActivityJobs.length})
              </h2>
              <div className="flex items-center gap-1 flex-wrap">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Queued / Running' },
                    { id: 'executed', label: 'Executed' },
                    { id: 'failed', label: 'Failed' },
                    { id: 'rejected', label: 'Rejected' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActivityFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                      activityFilter === f.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white/[0.05] text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredActivityJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-xs text-slate-500">
                No agent jobs match this filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredActivityJobs.map((job) => {
                  const venture = ventures.find((v) => v.id === job.venture_id);
                  const resMeta = job.execution_result || {};
                  return (
                    <div
                      key={job.id}
                      className="rounded-xl bg-[#151820] border border-white/[0.07] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[10px] font-bold uppercase text-indigo-300">
                            {ROLE_LABELS[job.agent_role] || job.agent_role}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              job.status === 'executed'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : job.status === 'needs_approval'
                                ? 'bg-amber-500/20 text-amber-300'
                                : job.status === 'failed'
                                ? 'bg-rose-500/20 text-rose-300'
                                : job.status === 'running' || job.status === 'approved'
                                ? 'bg-indigo-500/25 text-indigo-300'
                                : 'bg-white/[0.06] text-slate-400'
                            }`}
                          >
                            {job.status === 'approved'
                              ? isEmailJob(job)
                                ? 'Sending via Gmail...'
                                : 'Executing...'
                              : job.status}
                          </span>
                          {venture && <span className="text-[11px] text-slate-400">{venture.name}</span>}
                          <span className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            <span>{formatRelativeTime(job.updated_at || job.created_at)}</span>
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-white truncate">{job.title}</p>
                        {job.execution_error && (
                          <p className="text-[11px] text-rose-300 font-mono break-all">
                            {job.execution_error}
                          </p>
                        )}
                        {resMeta.action === 'gmail_sent' && (
                          <p className="text-[11px] text-emerald-300">
                            Sent to {resMeta.to} (Gmail ID: {resMeta.messageId})
                          </p>
                        )}
                        {resMeta.action === 'venture_launched' && (
                          <p className="text-[11px] text-emerald-300">
                            Created {resMeta.createdTaskCount || 0} ToDo tasks, queued{' '}
                            {resMeta.queuedJobCount || 0} follow-up agents, saved strategy note.
                          </p>
                        )}
                        {resMeta.action === 'leads_saved_and_queued' && (
                          <p className="text-[11px] text-emerald-300">
                            Saved leads to Notes and queued {resMeta.outreachJobsQueued || 0} email drafts.
                          </p>
                        )}
                        {resMeta.action === 'rerun_webhook_triggered' && (
                          <p className="text-[11px] text-violet-300">
                            Triggered {resMeta.coworkerName} (HTTP {resMeta.status})
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {job.status === 'needs_approval' && (
                          <button
                            type="button"
                            onClick={() => selectSubTab('needs_you')}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold"
                          >
                            Review
                          </button>
                        )}
                        {job.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => handleRetryJob(job, isEmailJob(job) ? 'execute' : 'regenerate')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white"
                          >
                            <Play className="h-3 w-3" />
                            <span>Retry</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteJob(job.id)}
                          className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                          title="Delete job"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* TAB 4: CONNECTIONS (GMAIL, LEADOCEAN, RERUN) */}
        <div
          role="tabpanel"
          aria-labelledby="aiceo-tab-connections"
          hidden={activeSubTab !== 'connections'}
        >
          <div className="p-4 md:p-5 space-y-5">
            {/* Gmail & LeadOcean Status Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Mail className="h-4 w-4 text-emerald-400" />
                    <span>Gmail Auto-Send</span>
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      caps.gmailSendReady
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {caps.gmailSendReady ? `Connected (${caps.gmailTokenFile})` : 'One-Time Auth Needed'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Approved outreach emails send automatically through your connected Google account via{' '}
                  <code className="text-slate-200">mac-daemon</code>. To grant{' '}
                  <code className="text-slate-200">gmail.send</code> permission once:
                </p>
                <div className="flex items-center gap-2 bg-[#111318] border border-white/[0.07] rounded-xl p-2.5">
                  <code className="flex-1 text-[11px] font-mono text-indigo-300 break-all">
                    node &quot;/Users/justinevans/Desktop/ToDo App/mac-daemon/auth-gmail-send.js&quot;
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        'node "/Users/justinevans/Desktop/ToDo App/mac-daemon/auth-gmail-send.js"',
                        'gmail-cmd'
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-xs text-white shrink-0"
                  >
                    {copiedKey === 'gmail-cmd' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-400" />
                    <span>LeadOcean B2B Prospecting</span>
                  </h2>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      caps.leadoceanConfigured
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {caps.leadoceanConfigured ? 'API Key Active' : 'Add API Key'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  LeadOcean powers live people search (<code className="text-slate-200">/v1/people/search</code>)
                  and verified work email enrichment (<code className="text-slate-200">/v1/people/enrich</code>). Add
                  your key to <code className="text-slate-200">mac-daemon/.env</code> and restart PM2:
                </p>
                <div className="flex items-center gap-2 bg-[#111318] border border-white/[0.07] rounded-xl p-2.5">
                  <code className="flex-1 text-[11px] font-mono text-indigo-300 break-all">
                    LEADOCEAN_API_KEY=your_key_here
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('LEADOCEAN_API_KEY=', 'leadocean-env')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-xs text-white shrink-0"
                  >
                    {copiedKey === 'leadocean-env' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </section>
            </div>

            {/* Daemon Capabilities + Letterly Instant Webhook */}
            <section className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mic className="h-4 w-4 text-rose-400" />
                  <span>Letterly, Slack & AI Builder</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Voice notes route verbatim into Tasks, Notes, L10 agendas, Slack drafts and code changes. Every
                  outbound Slack message and email waits for your 1-tap approval in{' '}
                  <strong className="text-slate-200">Needs You</strong>.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { key: 'claudeCodeReady', label: 'Claude Code', icon: <Code2 className="h-3 w-3" /> },
                  { key: 'antigravityApiReady', label: 'Antigravity API', icon: <Bot className="h-3 w-3" /> },
                  { key: 'slackReady', label: 'Slack', icon: <MessageSquare className="h-3 w-3" /> },
                  { key: 'letterlyReady', label: 'Letterly', icon: <Mic className="h-3 w-3" /> },
                ].map((pill) => {
                  const ready = Boolean((caps as Record<string, unknown>)[pill.key]);
                  return (
                    <span
                      key={pill.key}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border ${
                        ready
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                          : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
                      }`}
                    >
                      {pill.icon}
                      <span>
                        {pill.label}: {ready ? 'Ready' : 'Not detected'}
                      </span>
                    </span>
                  );
                })}
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-slate-400">Letterly Instant Webhook URL</span>
                <div className="flex items-center gap-2 bg-[#111318] border border-white/[0.07] rounded-xl p-2.5">
                  <code className="flex-1 text-[11px] font-mono text-indigo-300 break-all">
                    {`${originUrl}/api/letterly-webhook`}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(`${originUrl}/api/letterly-webhook`, 'letterly-webhook')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-xs text-white shrink-0"
                  >
                    {copiedKey === 'letterly-webhook' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Paste into Letterly → Actions → Webhook. If <code className="text-slate-300">LETTERLY_WEBHOOK_SECRET</code>{' '}
                  is set on Render, send it as the <code className="text-slate-300">x-letterly-secret</code> header (or{' '}
                  <code className="text-slate-300">?secret=</code>). The Mac daemon also polls Letterly every 15 minutes.
                </p>
              </div>
            </section>

            {/* Rerun Inbound Callback Info */}
            <section className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-violet-400" />
                  <span>Rerun Two-Way Integration</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Have any Rerun Coworker POST deliverables back to your ToDo Companion Desk (lands in{' '}
                  <strong className="text-slate-200">Needs You</strong>, <strong className="text-slate-200">Tasks</strong>, or{' '}
                  <strong className="text-slate-200">Notes</strong>).
                </p>
              </div>
              <div className="flex items-center gap-2 bg-[#111318] border border-white/[0.07] rounded-xl p-2.5">
                <code className="flex-1 text-xs font-mono text-violet-300 break-all">
                  {originUrl}/api/agents/rerun-webhook
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(`${originUrl}/api/agents/rerun-webhook`, 'rerun-inbound')}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] text-xs text-white shrink-0"
                >
                  {copiedKey === 'rerun-inbound' ? 'Copied' : 'Copy URL'}
                </button>
              </div>
              <pre className="rounded-xl bg-[#111318] border border-white/[0.06] p-3 text-[11px] font-mono text-slate-300 overflow-x-auto">
{`POST ${originUrl}/api/agents/rerun-webhook
{
  "mode": "approval",
  "title": "Weekly Competitor Pulse from Rerun",
  "content": "## Summary\\n..."
}`}
              </pre>
            </section>

            {/* Rerun Coworkers Registry + Defaults */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <form
                onSubmit={handleAddCoworker}
                aria-labelledby="add-coworker-heading"
                className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-3.5"
              >
                <h2 id="add-coworker-heading" className="text-sm font-bold text-white flex items-center gap-2">
                  <Plus className="h-4 w-4 text-violet-400" />
                  <span>Add Rerun Coworker</span>
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cw-name" className="text-[11px] font-semibold text-slate-300">
                      Coworker Name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      ref={cwNameRef}
                      id="cw-name"
                      type="text"
                      value={cwName}
                      aria-invalid={Boolean(cwErrors.name)}
                      onChange={(e) => {
                        setCwName(e.target.value);
                        if (cwErrors.name) setCwErrors((prev) => ({ ...prev, name: undefined }));
                      }}
                      placeholder="e.g. Social Publisher"
                      className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white"
                    />
                    {cwErrors.name && <span className="text-[11px] text-rose-400">{cwErrors.name}</span>}
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="cw-role" className="text-[11px] font-semibold text-slate-300">
                      Role / Specialty
                    </label>
                    <input
                      id="cw-role"
                      type="text"
                      value={cwRole}
                      onChange={(e) => setCwRole(e.target.value)}
                      placeholder="e.g. LinkedIn & Newsletter Ops"
                      className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="cw-url" className="text-[11px] font-semibold text-slate-300">
                    Rerun Trigger Webhook URL <span aria-hidden="true">*</span>
                  </label>
                  <input
                    ref={cwUrlRef}
                    id="cw-url"
                    type="url"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={cwUrl}
                    aria-invalid={Boolean(cwErrors.url)}
                    onChange={(e) => {
                      setCwUrl(e.target.value);
                      if (cwErrors.url) setCwErrors((prev) => ({ ...prev, url: undefined }));
                    }}
                    placeholder="https://app.rerun.build/api/webhooks/..."
                    className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white"
                  />
                  {cwErrors.url && <span className="text-[11px] text-rose-400">{cwErrors.url}</span>}
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-[11px] font-semibold text-slate-300">
                    Auto-Trigger When Approved
                  </legend>
                  <div className="flex flex-wrap gap-3">
                    {AUTO_TRIGGER_OPTIONS.map((opt) => {
                      const cid = `cw-trig-${opt.id}`;
                      const checked = cwTriggers.includes(opt.id);
                      return (
                        <div key={opt.id} className="flex items-center gap-1.5">
                          <input
                            id={cid}
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setCwTriggers((prev) =>
                                e.target.checked
                                  ? Array.from(new Set([...prev, opt.id]))
                                  : prev.filter((x) => x !== opt.id)
                              );
                            }}
                            className="h-4 w-4 accent-violet-500"
                          />
                          <label htmlFor={cid} className="text-xs text-slate-300 cursor-pointer">
                            {opt.label}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>

                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Rerun Coworker</span>
                </button>
              </form>

              <form
                onSubmit={handleSaveGlobalSettings}
                aria-labelledby="global-settings-heading"
                className="rounded-2xl bg-[#151820] border border-white/[0.08] p-4 space-y-3.5"
              >
                <h2 id="global-settings-heading" className="text-sm font-bold text-white">
                  Default Endpoints & Preferences
                </h2>

                <div className="flex flex-col gap-1">
                  <label htmlFor="default-rerun-url" className="text-[11px] font-semibold text-slate-300">
                    Default Rerun Webhook URL
                  </label>
                  <input
                    id="default-rerun-url"
                    type="url"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={defaultRerunUrl}
                    onChange={(e) => setDefaultRerunUrl(e.target.value)}
                    placeholder="https://app.rerun.build/api/webhooks/..."
                    className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="default-from-email" className="text-[11px] font-semibold text-slate-300">
                    Sender Label / Reference Email
                  </label>
                  <input
                    id="default-from-email"
                    type="email"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={defaultFromEmail}
                    onChange={(e) => setDefaultFromEmail(e.target.value)}
                    placeholder="justin@turnninety.com"
                    className="w-full min-h-[42px] bg-[#1B1E26] border border-white/[0.08] rounded-xl px-3 py-2 text-base sm:text-xs text-white"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Defaults'}
                  </button>
                  {defaultRerunUrl && (
                    <button
                      type="button"
                      disabled={testingWebhookId === 'default'}
                      onClick={() => handleTestWebhook('default', defaultRerunUrl, 'Default Webhook')}
                      className="px-3 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.14] text-xs text-slate-200"
                    >
                      {testingWebhookId === 'default' ? 'Testing...' : 'Test Default Webhook'}
                    </button>
                  )}
                </div>
                {webhookTestResults['default'] && (
                  <p
                    className={`text-xs ${
                      webhookTestResults['default'].ok ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {webhookTestResults['default'].msg}
                  </p>
                )}

                {/* Configured Coworkers List */}
                {coworkers.length > 0 && (
                  <div className="pt-3 border-t border-white/[0.06] space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Configured Rerun Coworkers ({coworkers.length})
                    </h3>
                    {coworkers.map((cw) => (
                      <div
                        key={cw.id}
                        className="rounded-xl bg-[#111318] border border-white/[0.06] p-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {cw.name}{' '}
                            <span className="text-slate-400 font-normal">• {cw.role}</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 truncate">
                            {cw.webhookUrl}
                          </div>
                          {webhookTestResults[cw.id] && (
                            <div
                              className={`text-[11px] mt-0.5 ${
                                webhookTestResults[cw.id].ok ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {webhookTestResults[cw.id].msg}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={testingWebhookId === cw.id}
                            onClick={() => handleTestWebhook(cw.id, cw.webhookUrl, cw.name)}
                            className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-slate-200"
                          >
                            {testingWebhookId === cw.id ? 'Testing...' : 'Test Webhook'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCoworker(cw.id)}
                            className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                            title="Remove coworker"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
