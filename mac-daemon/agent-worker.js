const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { supabase } = require('./supabase');
const { callGeminiWithRetry } = require('./gemini-helper');
const { hasGmailSendScope, sendGmailEmail } = require('./google');
const { isLeadOceanConfigured, searchPeople, enrichPerson } = require('./leadocean');
const { isRerunMcpConfigured, triggerRerunWebhook, callRerunMcpTool } = require('./rerun');

const POLL_INTERVAL_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 60000;

let workerStarted = false;
let missingTableWarned = false;
let isDraining = false;
const inFlightIds = new Set();

function isMissingTableError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || err.details || err.hint || err || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('Could not find the table') ||
    msg.includes('does not exist') ||
    msg.includes('relation "public.agent_')
  );
}

function logMissingSchemaOnce(err) {
  if (!missingTableWarned) {
    missingTableWarned = true;
    console.warn(
      '[Agent Worker] Waiting for Supabase tables (agent_ventures, agent_jobs, agent_settings). ' +
        'Run supabase/agent_schema.sql in your Supabase SQL Editor to activate autonomous agents.',
      err?.message || ''
    );
  }
}

function parseJsonFromGemini(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        // continue
      }
    }
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function generateTextWithGemini(prompt, { useSearch = false, temperature = 0.35 } = {}) {
  const options = {
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      temperature,
      ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
    },
  };

  try {
    const res = await callGeminiWithRetry(options, 2);
    if (res && res.text) return res.text;
  } catch (err) {
    if (useSearch) {
      console.warn('[Agent Worker] Google Search grounding failed, falling back to standard Gemini:', err?.message || err);
      const fallbackRes = await callGeminiWithRetry(
        {
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: { temperature },
        },
        2
      );
      if (fallbackRes && fallbackRes.text) return fallbackRes.text;
    } else {
      throw err;
    }
  }
  throw new Error('Gemini returned an empty response or credits are exhausted.');
}

async function getAgentSettings() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('agent_settings').select('*').eq('id', 'default').maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      logMissingSchemaOnce(error);
      return null;
    }
    return null;
  }
  return data;
}

async function getVentureById(ventureId) {
  if (!supabase || !ventureId) return null;
  const { data } = await supabase.from('agent_ventures').select('*').eq('id', ventureId).maybeSingle();
  return data || null;
}

async function getProjectById(projectId) {
  if (!supabase || !projectId) return null;
  const { data } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  return data || null;
}

async function getTaskById(taskId) {
  if (!supabase || !taskId) return null;
  const { data } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  return data || null;
}

async function saveDeliverableNote({ title, content, folder, source = 'ai_ceo' }) {
  if (!supabase || !content) return null;
  const now = new Date().toISOString();
  const payload = {
    id: crypto.randomUUID(),
    title: String(title || 'AI Agent Deliverable').trim().slice(0, 180),
    content: String(content),
    folder: String(folder || 'AI CEO').trim() || 'AI CEO',
    source,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('notes').insert([payload]).select();
  if (error) {
    console.error('[Agent Worker] Failed saving note:', error.message);
    return null;
  }
  return Array.isArray(data) ? data[0] : payload;
}

async function updateDaemonHeartbeat() {
  if (!supabase) return;
  try {
    const gmailStatus = hasGmailSendScope();
    const capabilities = {
      gmailSendReady: gmailStatus.ready,
      gmailTokenFile: gmailStatus.tokenFile,
      leadoceanConfigured: isLeadOceanConfigured(),
      rerunMcpConfigured: isRerunMcpConfigured(),
      geminiConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
    };

    const { error } = await supabase.from('agent_settings').upsert(
      {
        id: 'default',
        daemon_heartbeat_at: new Date().toISOString(),
        daemon_capabilities: capabilities,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) {
      if (isMissingTableError(error)) {
        logMissingSchemaOnce(error);
      } else {
        console.warn('[Agent Worker] Heartbeat update warning:', error.message);
      }
    } else {
      missingTableWarned = false;
    }
  } catch (err) {
    if (isMissingTableError(err)) logMissingSchemaOnce(err);
  }
}

function buildFeedbackSection(job) {
  if (!job.revision_feedback || !String(job.revision_feedback).trim()) return '';
  return `\n\nREVISION FEEDBACK FROM HUMAN FOUNDER (HIGHEST PRIORITY — APPLY THESE CHANGES):\n${job.revision_feedback.trim()}\n`;
}

async function handlePlanVenture(job, venture) {
  const ventureName = venture?.name || job.title || 'New Venture';
  const ideaPrompt = venture?.idea_prompt || job.prompt || job.title;
  const targetAudience = venture?.target_audience || '';
  const icpQuery = venture?.icp_query || '';

  const prompt = `You are the AI CEO for Justin Evans. Turn this venture/project idea into a sharp, practical execution plan.

Venture Name: ${ventureName}
Idea / Goal: ${ideaPrompt}
Target Audience Hint: ${targetAudience || 'Not specified — infer the highest-leverage ICP'}
LeadOcean ICP Query Hint: ${icpQuery || 'Not specified'}
${buildFeedbackSection(job)}

Return ONLY valid JSON matching this exact structure (no prose outside JSON):
{
  "strategyMarkdown": "# ${ventureName}\\n\\n## Positioning & Value Proposition\\n...\\n## Target Customer & Pricing\\n...\\n## 7-Day Launch Plan\\n...",
  "targetAudience": "Concise 1-sentence description of the primary buyer/audience",
  "icpQuery": "Short 2-5 word B2B search query suitable for LeadOcean people search (e.g. 'VP Operations healthcare' or 'HR Director manufacturing')",
  "humanTasks": [
    {
      "title": "Active imperative task title starting with a verb (no hashtags, no exclamation marks)",
      "estimatedMinutes": 15,
      "priority": "high",
      "notes": "Why this matters and the immediate first step"
    }
  ],
  "recommendedAgentJobs": [
    {
      "agentRole": "researcher",
      "jobType": "market_research",
      "title": "Competitor & Positioning Brief for ${ventureName}",
      "prompt": "Research top 5 competitors, pricing benchmarks, and SEO angles for ${ventureName}: ${ideaPrompt}"
    },
    {
      "agentRole": "leads",
      "jobType": "lead_search",
      "title": "Prospect List (LeadOcean) for ${ventureName}",
      "prompt": "Find 8 high-fit decision makers matching the ICP for ${ventureName}"
    },
    {
      "agentRole": "content",
      "jobType": "content_draft",
      "title": "Launch Landing Copy & Outreach Playbook for ${ventureName}",
      "prompt": "Draft hero copy, value props, and 2 social launch posts for ${ventureName}"
    }
  ]
}

Provide 3-5 realistic humanTasks and 2-3 recommendedAgentJobs.`;

  const rawText = await generateTextWithGemini(prompt, { useSearch: true, temperature: 0.35 });
  const parsed = parseJsonFromGemini(rawText);

  const strategyMarkdown =
    parsed?.strategyMarkdown ||
    `# ${ventureName} — AI CEO Plan\n\n${rawText}`;
  const resolvedAudience = parsed?.targetAudience || targetAudience;
  const resolvedIcp = parsed?.icpQuery || icpQuery || ventureName;
  const humanTasks = Array.isArray(parsed?.humanTasks)
    ? parsed.humanTasks.map((t) => ({
        title: String(t.title || '').replace(/!+/g, '').trim(),
        estimatedMinutes: Math.max(5, Math.min(120, Number(t.estimatedMinutes) || 15)),
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        notes: String(t.notes || '').trim(),
        selected: true,
      })).filter((t) => t.title)
    : [];

  const recommendedAgentJobs = Array.isArray(parsed?.recommendedAgentJobs)
    ? parsed.recommendedAgentJobs.map((j) => ({
        agentRole: j.agentRole || 'researcher',
        jobType: j.jobType || 'market_research',
        title: String(j.title || 'Follow-up Agent Task').trim(),
        prompt: String(j.prompt || ideaPrompt).trim(),
        selected: true,
      }))
    : [
        {
          agentRole: 'researcher',
          jobType: 'market_research',
          title: `Competitor & Market Brief: ${ventureName}`,
          prompt: `Research competitors, pricing, and messaging angles for ${ventureName}: ${ideaPrompt}`,
          selected: true,
        },
        {
          agentRole: 'leads',
          jobType: 'lead_search',
          title: `LeadOcean Prospect Search: ${resolvedIcp}`,
          prompt: resolvedIcp,
          selected: true,
        },
      ];

  if (venture?.id) {
    await supabase
      .from('agent_ventures')
      .update({
        strategy_markdown: strategyMarkdown,
        target_audience: resolvedAudience,
        icp_query: resolvedIcp,
        stage: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', venture.id);
  }

  return {
    output_markdown: strategyMarkdown,
    output_payload: {
      humanTasks,
      recommendedAgentJobs,
      icpQuery: resolvedIcp,
      targetAudience: resolvedAudience,
    },
  };
}

async function handleMarketResearch(job, venture) {
  const context = venture
    ? `Venture: ${venture.name}\nIdea: ${venture.idea_prompt}\nTarget Audience: ${venture.target_audience}\n`
    : '';
  const prompt = `You are a sharp Market & Competitor Research Analyst.
${context}Task: ${job.title}
Instructions: ${job.prompt || venture?.idea_prompt || job.title}
${buildFeedbackSection(job)}

Produce a clean, scannable Markdown brief covering:
1. **Top 3-5 Competitors / Alternatives** (name, positioning, pricing if public)
2. **Market Gaps & Differentiation Angle**
3. **Target Buyer Pain Points & Search Keywords**
4. **Recommended Immediate Next Move**

Keep it factual, specific, and actionable.`;

  const markdown = await generateTextWithGemini(prompt, { useSearch: true, temperature: 0.3 });
  return {
    output_markdown: markdown,
    output_payload: {
      topic: job.title,
      ventureName: venture?.name || '',
    },
  };
}

async function deriveLeadQuery(rawPrompt, venture) {
  const candidate = (rawPrompt || venture?.icp_query || venture?.target_audience || venture?.name || '').trim();
  if (candidate && candidate.length <= 55 && !candidate.includes('\n')) {
    return candidate;
  }
  const distilled = await generateTextWithGemini(
    `Distill this lead search request into a concise 2-5 word B2B job-title/industry search query for a people database (e.g. "VP Operations logistics" or "HR Director healthcare"). Return ONLY the 2-5 words with no quotes.\n\nRequest: ${candidate}\nVenture: ${venture?.idea_prompt || ''}`,
    { useSearch: false, temperature: 0.1 }
  );
  return distilled.replace(/["'`\n]/g, ' ').trim().slice(0, 60) || venture?.name || 'Founder';
}

function formatLeadsMarkdown(leads, query, provider, notice = '') {
  const header = `### Prospect Search Results (${provider === 'leadocean' ? 'LeadOcean Live Data' : 'Gemini Preview'})\n**Query:** \`${query}\` • **Found:** ${leads.length} leads\n`;
  const noteLine = notice ? `\n> ${notice}\n` : '';
  if (!leads.length) {
    return `${header}${noteLine}\nNo matching prospects were returned for this query. Try broadening the ICP query and revising.`;
  }

  const rows = leads
    .map((l, idx) => {
      const emailText = l.email || '—';
      const linkText = l.linkedinUrl ? `[LinkedIn](${l.linkedinUrl})` : '—';
      return `| ${idx + 1} | ${l.name || '—'} | ${l.title || '—'} | ${l.company || '—'} | ${emailText} | ${linkText} |`;
    })
    .join('\n');

  return `${header}${noteLine}\n| # | Name | Title | Company | Email | Profile |\n|---|---|---|---|---|---|${rows ? `\n${rows}` : ''}`;
}

async function handleLeadSearch(job, venture) {
  const rawGoal = [job.prompt, job.revision_feedback].filter(Boolean).join(' — ');
  const query = await deriveLeadQuery(rawGoal, venture);

  let leads = [];
  let provider = 'gemini_preview';
  let notice = '';
  let quota = null;

  if (isLeadOceanConfigured()) {
    const searchRes = await searchPeople({ q: query, limit: 8 });
    if (!searchRes.ok) {
      throw new Error(searchRes.error || 'LeadOcean search failed.');
    }
    provider = 'leadocean';
    quota = searchRes.quota || null;
    leads = (searchRes.people || []).slice(0, 8);

    // Enrich up to 5 leads missing emails
    let enrichedCount = 0;
    for (let i = 0; i < leads.length && enrichedCount < 5; i++) {
      const person = leads[i];
      if (!person.email && (person.linkedinUrl || person.id)) {
        enrichedCount++;
        const enriched = await enrichPerson({
          linkedin_url: person.linkedinUrl || undefined,
          person_id: person.id || undefined,
        });
        if (enriched.ok && enriched.person) {
          leads[i] = {
            ...person,
            ...enriched.person,
            email: enriched.person.email || person.email,
          };
        }
      }
    }
  } else {
    notice =
      'LeadOcean API key is not configured yet (`LEADOCEAN_API_KEY` in `mac-daemon/.env`), so this is a Gemini research preview. Add your LeadOcean API key for live verified B2B emails & enrichments.';
    const previewPrompt = `Identify 5 real organizations and decision-maker roles matching this target prospect query: "${query}".
Venture Context: ${venture ? `${venture.name} — ${venture.idea_prompt}` : job.prompt}
${buildFeedbackSection(job)}

Return ONLY valid JSON array of objects:
[
  {
    "name": "Contact or Role Placeholder if private",
    "title": "Exact Decision Maker Title",
    "company": "Real Company Name",
    "domain": "company.com",
    "email": "",
    "linkedinUrl": "",
    "location": "City, State"
  }
]
Leave "email" empty unless a public general contact email is verified on the company website.`;

    const previewText = await generateTextWithGemini(previewPrompt, { useSearch: true, temperature: 0.25 });
    const parsed = parseJsonFromGemini(previewText);
    if (Array.isArray(parsed)) {
      leads = parsed.map((item, idx) => ({
        id: `preview-${idx + 1}`,
        name: String(item.name || 'Decision Maker').trim(),
        title: String(item.title || '').trim(),
        company: String(item.company || '').trim(),
        domain: String(item.domain || '').trim(),
        email: String(item.email || '').trim(),
        linkedinUrl: String(item.linkedinUrl || '').trim(),
        location: String(item.location || '').trim(),
      }));
    }
  }

  const normalizedLeads = leads.map((l, idx) => ({
    ...l,
    id: l.id || `lead-${idx + 1}`,
    selected: Boolean(l.email),
  }));

  const markdown = formatLeadsMarkdown(normalizedLeads, query, provider, notice);
  return {
    output_markdown: markdown,
    output_payload: {
      query,
      provider,
      quota,
      leads: normalizedLeads,
    },
  };
}

async function handleEmailOutreach(job, venture) {
  const existing = job.output_payload || {};
  const to = String(existing.to || '').trim();
  const toName = String(existing.toName || '').trim();
  const company = String(existing.company || '').trim();
  const title = String(existing.title || '').trim();
  const linkedinUrl = String(existing.linkedinUrl || '').trim();

  const prompt = `You are a top-performing B2B Outreach Copywriter writing on behalf of Justin Evans.
Write a crisp, human, high-reply-rate cold outreach email (under 135 words, plain text, no hype, no exclamation points).

Venture Context: ${venture ? `${venture.name} — ${venture.idea_prompt}` : 'Personal/Business Outreach'}
Recipient Name: ${toName || 'Unknown'}
Recipient Title: ${title || 'Unknown'}
Company: ${company || 'Unknown'}
Recipient Email: ${to || 'Leave empty if not provided'}
Task Instructions: ${job.prompt || job.title}
${buildFeedbackSection(job)}

Return ONLY valid JSON:
{
  "to": "${to}",
  "subject": "Short specific subject line (3-7 words)",
  "body": "Plain text email body with greeting, personalized value hook, and simple low-friction CTA"
}`;

  const rawText = await generateTextWithGemini(prompt, { useSearch: Boolean(company), temperature: 0.4 });
  const parsed = parseJsonFromGemini(rawText);

  const finalTo = String(parsed?.to || to || '').trim();
  const subject = String(parsed?.subject || job.title || 'Quick question').trim();
  const body = String(parsed?.body || rawText).trim();

  const previewMarkdown = `**To:** ${finalTo || '_Enter recipient email before approving_'}\n**Subject:** ${subject}\n\n---\n\n${body}`;

  return {
    output_markdown: previewMarkdown,
    output_payload: {
      ...existing,
      to: finalTo,
      toName,
      company,
      title,
      linkedinUrl,
      subject,
      body,
      isEmail: true,
    },
  };
}

async function handleContentDraft(job, venture) {
  const prompt = `You are a Content & SEO Strategist writing for Justin Evans.
Venture: ${venture ? `${venture.name} — ${venture.idea_prompt}` : 'General'}
Target Audience: ${venture?.target_audience || 'General professionals'}
Assignment: ${job.title}
Instructions: ${job.prompt || job.title}
${buildFeedbackSection(job)}

Write a ready-to-publish Markdown draft (include suggested headline, hook/meta description if relevant, clear sections, and a concise CTA). Avoid generic AI fluff.`;

  const markdown = await generateTextWithGemini(prompt, { useSearch: true, temperature: 0.45 });
  return {
    output_markdown: markdown,
    output_payload: {
      ventureName: venture?.name || '',
      contentType: job.title,
    },
  };
}

async function handleTaskAssist(job, venture) {
  const task = await getTaskById(job.source_task_id);
  const project = await getProjectById(job.project_id || task?.project_id);

  const taskTitle = task?.title || job.title;
  const taskDesc = task?.description || job.prompt || '';
  const projectContext = project ? `Project: ${project.name}\nGoal: ${project.goal || ''}\nRules: ${project.instructions || ''}` : '';

  const prompt = `You are Justin's autonomous execution assistant. Justin delegated this ToDo task to you so you can complete the heavy lifting and put a ready-to-approve deliverable in his "Needs You" inbox.

Task Title: ${taskTitle}
Task Notes/Context: ${taskDesc}
${projectContext}
${venture ? `Venture Context: ${venture.name} — ${venture.idea_prompt}` : ''}
Additional Instructions: ${job.prompt || ''}
${buildFeedbackSection(job)}

Decide if this task is primarily sending an email ("isEmail": true) or producing a research/plan/draft deliverable ("isEmail": false).
Return ONLY valid JSON:
{
  "isEmail": false,
  "to": "",
  "subject": "",
  "body": "",
  "deliverableMarkdown": "## Completed Draft / Action Plan\\n..."
}`;

  const rawText = await generateTextWithGemini(prompt, { useSearch: true, temperature: 0.3 });
  const parsed = parseJsonFromGemini(rawText);

  const isEmail = Boolean(parsed?.isEmail && (parsed?.subject || parsed?.body));
  const deliverableMarkdown = isEmail
    ? `**To:** ${parsed.to || '_Enter recipient email_'}\n**Subject:** ${parsed.subject}\n\n---\n\n${parsed.body}`
    : String(parsed?.deliverableMarkdown || rawText);

  return {
    output_markdown: deliverableMarkdown,
    output_payload: {
      isEmail,
      to: String(parsed?.to || '').trim(),
      subject: String(parsed?.subject || '').trim(),
      body: String(parsed?.body || '').trim(),
      sourceTaskTitle: taskTitle,
    },
  };
}

async function handleRerunCoworkerPrep(job, venture, settings) {
  const existing = job.output_payload || {};
  const coworkers = Array.isArray(settings?.rerun_coworkers) ? settings.rerun_coworkers : [];
  const matchedCoworker =
    coworkers.find((c) => c.id === existing.coworkerId || c.name === existing.coworkerName) || coworkers[0] || null;

  const webhookUrl = existing.rerunWebhookUrl || existing.webhookUrl || matchedCoworker?.webhookUrl || venture?.rerun_webhook_url || settings?.default_rerun_webhook_url || '';

  const prompt = `Prepare a crisp, structured task brief to hand off to an autonomous Rerun AI Coworker.
Coworker: ${existing.coworkerName || matchedCoworker?.name || 'Rerun Coworker'}
Role: ${matchedCoworker?.role || 'Operations & Execution'}
Venture: ${venture ? `${venture.name} — ${venture.idea_prompt}` : 'General'}
Requested Task: ${job.title}
Instructions: ${job.prompt || job.title}
${buildFeedbackSection(job)}

Return clear Markdown with:
1. **Objective**
2. **Inputs & Context**
3. **Expected Output / Callback Instructions**`;

  const markdown = await generateTextWithGemini(prompt, { useSearch: false, temperature: 0.3 });
  return {
    output_markdown: markdown,
    output_payload: {
      ...existing,
      coworkerId: existing.coworkerId || matchedCoworker?.id || '',
      coworkerName: existing.coworkerName || matchedCoworker?.name || 'Rerun Coworker',
      rerunWebhookUrl: webhookUrl,
    },
  };
}

async function processQueuedJob(job) {
  if (!supabase || !job?.id || inFlightIds.has(job.id)) return;
  inFlightIds.add(job.id);

  try {
    // Atomic claim so two cycles never process the same queued job
    const { data: claimed, error: claimErr } = await supabase
      .from('agent_jobs')
      .update({
        status: 'running',
        execution_error: '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select();

    if (claimErr) {
      if (isMissingTableError(claimErr)) logMissingSchemaOnce(claimErr);
      return;
    }
    if (!claimed || claimed.length === 0) return;

    const currentJob = claimed[0];
    console.log(`[Agent Worker] Running ${currentJob.agent_role}/${currentJob.job_type}: "${currentJob.title}"`);

    const [venture, settings] = await Promise.all([
      getVentureById(currentJob.venture_id),
      getAgentSettings(),
    ]);

    let result;
    switch (currentJob.job_type) {
      case 'plan_venture':
        result = await handlePlanVenture(currentJob, venture);
        break;
      case 'market_research':
        result = await handleMarketResearch(currentJob, venture);
        break;
      case 'lead_search':
        result = await handleLeadSearch(currentJob, venture);
        break;
      case 'email_outreach':
        result = await handleEmailOutreach(currentJob, venture);
        break;
      case 'content_draft':
        result = await handleContentDraft(currentJob, venture);
        break;
      case 'task_assist':
        result = await handleTaskAssist(currentJob, venture);
        break;
      case 'rerun_coworker':
        result = await handleRerunCoworkerPrep(currentJob, venture, settings);
        break;
      default:
        result = await handleMarketResearch(currentJob, venture);
        break;
    }

    await supabase
      .from('agent_jobs')
      .update({
        status: 'needs_approval',
        output_markdown: result.output_markdown || '',
        output_payload: result.output_payload || {},
        execution_error: '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentJob.id);

    console.log(`[Agent Worker] Ready for approval ("Needs You"): "${currentJob.title}"`);
  } catch (err) {
    console.error(`[Agent Worker] Job failed (${job.id}):`, err?.message || err);
    await supabase
      .from('agent_jobs')
      .update({
        status: 'failed',
        execution_error: String(err?.message || err),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  } finally {
    inFlightIds.delete(job.id);
  }
}

async function maybeDispatchRerunForJob(job, venture, settings) {
  const payload = job.output_payload || {};
  const explicitUrl = String(payload.rerunWebhookUrl || '').trim();
  const coworkers = Array.isArray(settings?.rerun_coworkers) ? settings.rerun_coworkers : [];
  const matchingCoworkers = coworkers.filter(
    (c) =>
      c &&
      c.webhookUrl &&
      Array.isArray(c.autoTriggers) &&
      c.autoTriggers.includes(job.job_type)
  );

  const targets = [];
  if (explicitUrl) {
    targets.push({ name: payload.coworkerName || 'Selected Rerun Coworker', webhookUrl: explicitUrl });
  }
  for (const cw of matchingCoworkers) {
    if (!targets.some((t) => t.webhookUrl === cw.webhookUrl)) {
      targets.push({ name: cw.name, webhookUrl: cw.webhookUrl });
    }
  }
  if (targets.length === 0 && payload.dispatchToRerun && (venture?.rerun_webhook_url || settings?.default_rerun_webhook_url)) {
    targets.push({
      name: 'Default Rerun Webhook',
      webhookUrl: venture?.rerun_webhook_url || settings?.default_rerun_webhook_url,
    });
  }

  const results = [];
  for (const target of targets) {
    const res = await triggerRerunWebhook(target.webhookUrl, {
      event: `job_executed:${job.job_type}`,
      jobId: job.id,
      ventureId: job.venture_id,
      ventureName: venture?.name || '',
      projectId: job.project_id,
      title: job.title,
      markdown: job.output_markdown,
      payload,
    });
    results.push({ coworker: target.name, ...res });
  }
  return results;
}

async function executeApprovedJob(job) {
  if (!supabase || !job?.id || inFlightIds.has(job.id)) return;
  inFlightIds.add(job.id);

  try {
    // Re-check status to prevent duplicate execution (especially for emails)
    const { data: freshRows, error: fetchErr } = await supabase
      .from('agent_jobs')
      .select('*')
      .eq('id', job.id)
      .eq('status', 'approved');

    if (fetchErr) {
      if (isMissingTableError(fetchErr)) logMissingSchemaOnce(fetchErr);
      return;
    }
    if (!freshRows || freshRows.length === 0) return;

    const currentJob = freshRows[0];
    const payload = currentJob.output_payload || {};
    const [venture, settings, project] = await Promise.all([
      getVentureById(currentJob.venture_id),
      getAgentSettings(),
      getProjectById(currentJob.project_id),
    ]);

    const nowIso = new Date().toISOString();

    // 1. Auto-send email immediately upon approval
    if (
      currentJob.job_type === 'email_outreach' ||
      (currentJob.job_type === 'task_assist' && payload.isEmail && payload.to)
    ) {
      const to = String(payload.to || '').trim();
      const subject = String(payload.subject || currentJob.title || '').trim();
      const body = String(payload.body || currentJob.output_markdown || '').trim();

      if (!to) {
        await supabase
          .from('agent_jobs')
          .update({
            status: 'failed',
            execution_error: 'Recipient email ("to") is missing. Edit the email recipient and retry.',
            updated_at: nowIso,
          })
          .eq('id', currentJob.id);
        return;
      }

      console.log(`[Agent Worker] Auto-sending approved Gmail to ${to}...`);
      const sendRes = await sendGmailEmail({ to, subject, body });

      if (!sendRes.ok) {
        const friendlyErr = sendRes.needsReauth
          ? 'Gmail auto-send requires one-time OAuth permission. Run: node "/Users/justinevans/Desktop/ToDo App/mac-daemon/auth-gmail-send.js"'
          : sendRes.error || 'Failed to send email via Gmail.';

        await supabase
          .from('agent_jobs')
          .update({
            status: 'failed',
            execution_error: friendlyErr,
            updated_at: nowIso,
          })
          .eq('id', currentJob.id);
        return;
      }

      await supabase
        .from('agent_jobs')
        .update({
          status: 'executed',
          executed_at: nowIso,
          execution_error: '',
          execution_result: {
            action: 'gmail_sent',
            messageId: sendRes.messageId,
            threadId: sendRes.threadId,
            tokenFile: sendRes.tokenFile,
            to,
            subject,
          },
          updated_at: nowIso,
        })
        .eq('id', currentJob.id);

      console.log(`[Agent Worker] Sent Gmail (${sendRes.messageId}) to ${to}!`);
      return;
    }

    // 2. Plan Venture: create approved human tasks + spawn selected next agent jobs + save note
    if (currentJob.job_type === 'plan_venture') {
      const humanTasks = Array.isArray(payload.humanTasks)
        ? payload.humanTasks.filter((t) => t && t.title && t.selected !== false)
        : [];
      const nextJobs = Array.isArray(payload.recommendedAgentJobs)
        ? payload.recommendedAgentJobs.filter((j) => j && j.title && j.selected !== false)
        : [];

      let createdTaskCount = 0;
      if (humanTasks.length > 0) {
        const taskRows = humanTasks.map((t) => ({
          id: crypto.randomUUID(),
          project_id: currentJob.project_id || null,
          title: String(t.title).replace(/!+/g, '').trim(),
          description: t.notes ? `${t.notes}\n\n[⏱ ${t.estimatedMinutes || 15}m]` : `[⏱ ${t.estimatedMinutes || 15}m]`,
          list_name: project?.name || venture?.name || 'General',
          status: 'pending',
          source: 'ai_ceo',
          estimated_minutes: Number(t.estimatedMinutes) || 15,
          in_play_queue: false,
          subtasks: [],
          created_at: nowIso,
          updated_at: nowIso,
        }));
        const { error: taskErr } = await supabase.from('tasks').insert(taskRows);
        if (!taskErr) createdTaskCount = taskRows.length;
      }

      let queuedJobCount = 0;
      if (nextJobs.length > 0) {
        const jobRows = nextJobs.map((j) => ({
          id: crypto.randomUUID(),
          venture_id: currentJob.venture_id || null,
          project_id: currentJob.project_id || null,
          agent_role: j.agentRole || 'researcher',
          job_type: j.jobType || 'market_research',
          title: j.title,
          prompt: j.prompt || venture?.idea_prompt || '',
          status: 'queued',
          created_at: nowIso,
          updated_at: nowIso,
        }));
        const { error: jobErr } = await supabase.from('agent_jobs').insert(jobRows);
        if (!jobErr) queuedJobCount = jobRows.length;
      }

      const savedNote = await saveDeliverableNote({
        title: `${venture?.name || currentJob.title} — AI CEO Strategy`,
        content: currentJob.output_markdown,
        folder: `AI CEO / ${venture?.name || 'Ventures'}`,
      });

      const rerunDispatches = await maybeDispatchRerunForJob(currentJob, venture, settings);

      await supabase
        .from('agent_jobs')
        .update({
          status: 'executed',
          executed_at: nowIso,
          execution_error: '',
          execution_result: {
            action: 'venture_launched',
            createdTaskCount,
            queuedJobCount,
            noteId: savedNote?.id || null,
            rerunDispatches,
          },
          updated_at: nowIso,
        })
        .eq('id', currentJob.id);
      return;
    }

    // 3. Lead Search: save lead table note + queue personalized email_outreach drafts for selected leads with email
    if (currentJob.job_type === 'lead_search') {
      const leads = Array.isArray(payload.leads) ? payload.leads : [];
      const selectedWithEmail = leads
        .filter((l) => l && l.selected !== false && l.email && String(l.email).includes('@'))
        .slice(0, 5);

      const savedNote = await saveDeliverableNote({
        title: `${venture?.name || 'Prospecting'} — Leads (${payload.query || ''})`,
        content: currentJob.output_markdown,
        folder: `Leads / ${venture?.name || 'Prospecting'}`,
      });

      let draftedCount = 0;
      if (selectedWithEmail.length > 0) {
        const outreachJobs = selectedWithEmail.map((lead) => ({
          id: crypto.randomUUID(),
          venture_id: currentJob.venture_id || null,
          project_id: currentJob.project_id || null,
          agent_role: 'outreach',
          job_type: 'email_outreach',
          title: `Outreach to ${lead.name}${lead.company ? ` (${lead.company})` : ''}`,
          prompt: `Write a personalized outreach email to ${lead.name}, ${lead.title || 'leader'} at ${lead.company || 'their company'} regarding ${venture?.name || 'our offering'}.`,
          status: 'queued',
          output_payload: {
            to: lead.email,
            toName: lead.name,
            company: lead.company || '',
            title: lead.title || '',
            linkedinUrl: lead.linkedinUrl || '',
          },
          created_at: nowIso,
          updated_at: nowIso,
        }));
        const { error: qErr } = await supabase.from('agent_jobs').insert(outreachJobs);
        if (!qErr) draftedCount = outreachJobs.length;
      }

      const rerunDispatches = await maybeDispatchRerunForJob(currentJob, venture, settings);

      await supabase
        .from('agent_jobs')
        .update({
          status: 'executed',
          executed_at: nowIso,
          execution_error: '',
          execution_result: {
            action: 'leads_saved_and_queued',
            noteId: savedNote?.id || null,
            outreachJobsQueued: draftedCount,
            rerunDispatches,
          },
          updated_at: nowIso,
        })
        .eq('id', currentJob.id);
      return;
    }

    // 4. Rerun Coworker direct handoff
    if (currentJob.job_type === 'rerun_coworker') {
      const mcpTool = String(payload.mcpTool || '').trim();
      const webhookUrl = String(
        payload.rerunWebhookUrl ||
          payload.webhookUrl ||
          venture?.rerun_webhook_url ||
          settings?.default_rerun_webhook_url ||
          ''
      ).trim();

      if (mcpTool) {
        const mcpRes = await callRerunMcpTool(mcpTool, payload.mcpArgs || {
          title: currentJob.title,
          prompt: currentJob.output_markdown || currentJob.prompt,
          ventureName: venture?.name || '',
        });
        if (!mcpRes.ok) {
          await supabase
            .from('agent_jobs')
            .update({
              status: 'failed',
              execution_error: mcpRes.error || 'Rerun MCP call failed.',
              updated_at: nowIso,
            })
            .eq('id', currentJob.id);
          return;
        }
        await supabase
          .from('agent_jobs')
          .update({
            status: 'executed',
            executed_at: nowIso,
            execution_error: '',
            execution_result: { action: 'rerun_mcp_executed', mcpTool, result: mcpRes.result },
            updated_at: nowIso,
          })
          .eq('id', currentJob.id);
        return;
      }

      if (!webhookUrl) {
        await supabase
          .from('agent_jobs')
          .update({
            status: 'failed',
            execution_error: 'No Rerun Webhook URL configured. Add one in the Connections tab or Venture settings.',
            updated_at: nowIso,
          })
          .eq('id', currentJob.id);
        return;
      }

      const hookRes = await triggerRerunWebhook(webhookUrl, {
        event: 'rerun_coworker_handoff',
        jobId: currentJob.id,
        ventureId: currentJob.venture_id,
        ventureName: venture?.name || '',
        projectId: currentJob.project_id,
        coworkerName: payload.coworkerName || 'Rerun Coworker',
        title: currentJob.title,
        markdown: currentJob.output_markdown,
        payload,
      });

      if (!hookRes.ok) {
        await supabase
          .from('agent_jobs')
          .update({
            status: 'failed',
            execution_error: hookRes.error || 'Rerun webhook call failed.',
            updated_at: nowIso,
          })
          .eq('id', currentJob.id);
        return;
      }

      await supabase
        .from('agent_jobs')
        .update({
          status: 'executed',
          executed_at: nowIso,
          execution_error: '',
          execution_result: {
            action: 'rerun_webhook_triggered',
            status: hookRes.status,
            coworkerName: payload.coworkerName || 'Rerun Coworker',
            responseBody: hookRes.body,
          },
          updated_at: nowIso,
        })
        .eq('id', currentJob.id);
      return;
    }

    // 5. Market Research, Content Draft, or non-email Task Assist -> save to Notes (+ optional Rerun dispatch)
    const savedNote = await saveDeliverableNote({
      title: currentJob.title,
      content: currentJob.output_markdown,
      folder: venture?.name ? `AI CEO / ${venture.name}` : `AI CEO / ${project?.name || 'Deliverables'}`,
    });

    const rerunDispatches = await maybeDispatchRerunForJob(currentJob, venture, settings);

    await supabase
      .from('agent_jobs')
      .update({
        status: 'executed',
        executed_at: nowIso,
        execution_error: '',
        execution_result: {
          action: 'saved_to_notes',
          noteId: savedNote?.id || null,
          rerunDispatches,
        },
        updated_at: nowIso,
      })
      .eq('id', currentJob.id);
  } catch (err) {
    console.error(`[Agent Worker] Execution failed (${job.id}):`, err?.message || err);
    await supabase
      .from('agent_jobs')
      .update({
        status: 'failed',
        execution_error: String(err?.message || err),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  } finally {
    inFlightIds.delete(job.id);
  }
}

async function drainAgentJobs() {
  if (!supabase || isDraining) return;
  isDraining = true;

  try {
    // 1. Execute newly approved jobs immediately (prioritize sending approved emails)
    const { data: approvedJobs, error: appErr } = await supabase
      .from('agent_jobs')
      .select('*')
      .eq('status', 'approved')
      .order('updated_at', { ascending: true })
      .limit(10);

    if (appErr) {
      if (isMissingTableError(appErr)) logMissingSchemaOnce(appErr);
      return;
    }

    for (const job of approvedJobs || []) {
      await executeApprovedJob(job);
    }

    // 2. Process queued jobs
    const { data: queuedJobs, error: qErr } = await supabase
      .from('agent_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(5);

    if (qErr) {
      if (isMissingTableError(qErr)) logMissingSchemaOnce(qErr);
      return;
    }

    for (const job of queuedJobs || []) {
      await processQueuedJob(job);
    }
  } catch (err) {
    if (isMissingTableError(err)) {
      logMissingSchemaOnce(err);
    } else {
      console.error('[Agent Worker] Drain error:', err?.message || err);
    }
  } finally {
    isDraining = false;
  }
}

function startAgentWorker() {
  if (workerStarted) return;
  workerStarted = true;

  if (!supabase) {
    console.log('[Agent Worker] Supabase not configured. Autonomous agent worker skipped.');
    return;
  }

  console.log('[Agent Worker] Starting AI CEO, LeadOcean, Rerun & Gmail Auto-Send worker...');
  updateDaemonHeartbeat();
  drainAgentJobs();

  setInterval(() => updateDaemonHeartbeat(), HEARTBEAT_INTERVAL_MS);
  setInterval(() => drainAgentJobs(), POLL_INTERVAL_MS);

  try {
    supabase
      .channel('agent-jobs-daemon-listener')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_jobs' }, () => {
        setTimeout(() => drainAgentJobs(), 250);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_jobs' }, (payload) => {
        const nextStatus = payload?.new?.status;
        if (nextStatus === 'approved' || nextStatus === 'queued') {
          setTimeout(() => drainAgentJobs(), 150);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Agent Worker] Realtime listener active for instant approval execution.');
        }
      });
  } catch (err) {
    console.warn('[Agent Worker] Realtime listener fallback to 15s polling:', err?.message || err);
  }
}

if (require.main === module) {
  startAgentWorker();
}

module.exports = {
  startAgentWorker,
  drainAgentJobs,
  updateDaemonHeartbeat,
};
