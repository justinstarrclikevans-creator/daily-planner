'use client';

import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

const BRIEF_KEY_RE = /"briefMarkdown"\s*:/;
const BRIEF_STRING_RE = /"briefMarkdown"\s*:\s*"((?:\\.|[^"\\])*)"/;
const STRAY_BRACKET_RE = /"\s*\],\s*"proposedSlackCheckins"/g;

function tryParseBrief(text: string): string | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.briefMarkdown === 'string') {
      return parsed.briefMarkdown;
    }
  } catch {
    // not valid JSON
  }
  return null;
}

function stripOuterMarkdownFence(text: string): string {
  const s = text.trim();
  const m = s.match(/^```(?:markdown|md)?[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/i);
  return m ? m[1].trim() : s;
}

/**
 * Normalize AI brief content: unwrap a leaked JSON wrapper ({ "briefMarkdown": ... } / ```json fences)
 * and strip an outer ```markdown / ```md fence around the whole document.
 */
export function unwrapBriefMarkdown(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let text = String(raw).trim();
  if (!text) return '';

  for (let depth = 0; depth < 2; depth++) {
    const looksWrapped = (/^```json/i.test(text) || text.startsWith('{')) && BRIEF_KEY_RE.test(text);
    if (!looksWrapped) break;

    let body = text;
    const jsonFence = body.match(/^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/i);
    if (jsonFence) body = jsonFence[1].trim();

    let unwrapped = tryParseBrief(body);
    if (unwrapped === null) {
      const a = body.indexOf('{');
      const b = body.lastIndexOf('}');
      if (a !== -1 && b > a) unwrapped = tryParseBrief(body.slice(a, b + 1));
    }
    if (unwrapped === null) {
      const repaired = body.replace(STRAY_BRACKET_RE, '",\n"proposedSlackCheckins"');
      if (repaired !== body) unwrapped = tryParseBrief(repaired);
    }
    if (unwrapped === null) {
      const m = body.match(BRIEF_STRING_RE);
      if (m) {
        try {
          unwrapped = JSON.parse(`"${m[1]}"`) as string;
        } catch {
          unwrapped = null;
        }
      }
    }
    if (unwrapped === null) break;
    text = unwrapped.trim();
  }

  return stripOuterMarkdownFence(text);
}

/** Plain-text preview of Markdown content for compact list cards. */
export function stripMarkdownForPreview(raw: string | null | undefined, maxChars = 110): string {
  const text = unwrapBriefMarkdown(raw)
    .replace(/```[a-z]*\s*/gi, ' ')
    .replace(/`/g, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const clean = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${clean.replace(/[\s.,;:–—-]+$/, '')}…`;
}

type FormattedDocumentProps = {
  content: string;
  hideTopHeadingIfMatches?: string;
  variant?: 'article' | 'compact';
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <div className="pb-3 mb-4 border-b border-white/[0.08]">
      <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight [text-wrap:balance]">{children}</h2>
    </div>
  ),
  h2: ({ children }) => (
    <div className="mt-6 pt-4 border-t border-white/[0.07] first:mt-0 first:pt-0 first:border-t-0 mb-2.5">
      <h3 className="text-base sm:text-[1.0625rem] font-bold text-indigo-300 tracking-tight [text-wrap:balance]">
        {children}
      </h3>
    </div>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 mb-1.5 text-sm sm:text-[0.9375rem] font-semibold text-amber-200/95 [text-wrap:balance]">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-3 mb-1 text-sm font-semibold text-slate-100 [text-wrap:balance]">{children}</h5>
  ),
  h5: ({ children }) => (
    <h6 className="mt-3 mb-1 text-sm font-semibold text-slate-200 [text-wrap:balance]">{children}</h6>
  ),
  h6: ({ children }) => (
    <h6 className="mt-3 mb-1 text-sm font-medium text-slate-300 [text-wrap:balance]">{children}</h6>
  ),
  p: ({ children }) => (
    <p className="my-2 text-[0.9375rem] leading-[1.68] text-slate-200 [text-wrap:pretty]">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-2.5 space-y-2 marker:text-indigo-400">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-2.5 space-y-2.5 marker:text-emerald-400 marker:font-semibold">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-[0.9375rem] leading-[1.65] text-slate-200 pl-0.5 [text-wrap:pretty]">{children}</li>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-amber-400/70 bg-amber-500/[0.06] rounded-r-xl px-3.5 py-2.5 my-3 text-[0.9375rem] text-amber-100/95 italic [text-wrap:pretty]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-white/[0.08]" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-300 underline underline-offset-2 decoration-indigo-400/50 hover:text-indigo-200"
    >
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl bg-[#0D0F14] border border-white/[0.06] p-3.5 text-[0.8125rem] leading-[1.6] text-slate-200 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code
      className={`rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] text-emerald-200 ${className || ''}`}
    >
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  th: ({ children }) => (
    <th scope="col" className="px-3 py-2 font-semibold text-slate-100 border-b border-white/[0.08] whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-slate-200 border-b border-white/[0.05] leading-[1.55]">{children}</td>
  ),
};

export default function FormattedDocument({ content, hideTopHeadingIfMatches, variant = 'article' }: FormattedDocumentProps) {
  let markdown = unwrapBriefMarkdown(content);

  if (hideTopHeadingIfMatches) {
    const m = markdown.match(/^#\s+(.+?)\s*(?:\r?\n|$)/);
    if (m && m[1].trim().toLowerCase() === hideTopHeadingIfMatches.trim().toLowerCase()) {
      markdown = markdown.slice(m[0].length).trimStart();
    }
  }

  const sizing =
    variant === 'compact'
      ? 'text-sm [&_p]:text-sm [&_li]:text-sm'
      : 'text-[0.9375rem] sm:text-base';

  return (
    <div className={`formatted-document max-w-[70ch] leading-[1.68] text-slate-200 break-words [overflow-wrap:break-word] ${sizing}`}>
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </div>
  );
}
