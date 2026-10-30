import { Project, Task, DEFAULT_PROJECTS } from './supabase';

/**
 * Score how well a given text matches a project based on keywords, name, and instructions.
 */
export function scoreProjectMatch(text: string, project: Project): number {
  if (!text) return 0;
  const lowerText = text.toLowerCase();
  let score = 0;

  // 1. Check configured keywords (highest weight)
  if (project.keywords && Array.isArray(project.keywords)) {
    for (const kw of project.keywords) {
      const lowerKw = kw.toLowerCase().trim();
      if (!lowerKw) continue;
      // Word boundary or containment check
      if (lowerText.includes(lowerKw)) {
        score += 15;
      }
    }
  }

  // 2. Check project name and slug
  const pName = project.name.toLowerCase();
  const pSlug = project.slug.toLowerCase();
  if (lowerText.includes(pName) || lowerText.includes(pSlug)) {
    score += 20;
  }

  // Check specific common abbreviations
  if (project.slug === '843fc' && (lowerText.includes('843') || lowerText.includes('soccer') || lowerText.includes('crowded'))) {
    score += 15;
  }
  if (project.slug === 'turn90' && (lowerText.includes('t90') || lowerText.includes('reentry') || lowerText.includes('re-entry') || lowerText.includes('apricot'))) {
    score += 15;
  }
  if (project.slug === 'book-memoir-and-synapse' && (lowerText.includes('book') || lowerText.includes('memoir') || lowerText.includes('synapse') || lowerText.includes('cbt'))) {
    score += 15;
  }

  // 3. Check instructions / context
  if (project.instructions) {
    const instWords = project.instructions.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    for (const word of instWords) {
      if (lowerText.includes(word)) {
        score += 3;
      }
    }
  }

  return score;
}

/**
 * Automatically determine which project a task belongs to based on its title and description.
 */
export function determineProjectForTask(
  title: string,
  description?: string | null,
  projects: Project[] = DEFAULT_PROJECTS
): Project {
  const combined = `${title || ''} ${description || ''}`.trim();
  if (!combined) {
    return projects.find((p) => p.slug === 'general') || projects[0] || DEFAULT_PROJECTS[0];
  }

  let bestProject: Project | null = null;
  let highestScore = 0;

  // Evaluate candidate projects (excluding General for initial evaluation so specific projects win)
  const candidateProjects = projects.filter((p) => p.slug !== 'general');
  for (const proj of candidateProjects) {
    const score = scoreProjectMatch(combined, proj);
    if (score > highestScore) {
      highestScore = score;
      bestProject = proj;
    }
  }

  // Threshold: if score >= 10, assign to that project
  if (bestProject && highestScore >= 10) {
    return bestProject;
  }

  // Fallback to General
  const general = projects.find((p) => p.slug === 'general');
  return general || projects[0] || DEFAULT_PROJECTS[0];
}

/**
 * Helper to derive auto-routing keywords from a title/description.
 */
export function deriveKeywordsFromText(title: string, description?: string | null): string[] {
  const text = `${title} ${description || ''}`.toLowerCase();
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'make', 'about',
    'will', 'into', 'some', 'than', 'them', 'then', 'what', 'when', 'where', 'which',
    'would', 'could', 'should', 'with', 'task', 'todo', 'plan', 'call', 'email'
  ]);

  const rawWords = text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  return Array.from(new Set(rawWords)).slice(0, 10);
}

/**
 * Convert a Todo into a full Project with auto-generated keywords and routing.
 */
export function createProjectFromTask(
  task: Task,
  customName?: string,
  customColor?: string,
  customIcon?: string
): { project: Project; updatedTask: Task } {
  const projectName = (customName || task.title).trim();
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const derivedKeywords = deriveKeywordsFromText(projectName, task.description);
  derivedKeywords.unshift(slug);

  const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];
  const pickedColor = customColor || colors[Math.floor(Math.random() * colors.length)];
  const pickedIcon = customIcon || 'folder';

  const newProject: Project = {
    id: crypto.randomUUID(),
    name: projectName,
    slug: slug || `project-${Date.now()}`,
    color: pickedColor,
    icon: pickedIcon,
    goal: `Dedicated focus on: ${projectName}`,
    keywords: derivedKeywords,
    instructions: `Tasks relating to ${projectName}. Keywords: ${derivedKeywords.join(', ')}`,
  };

  const updatedTask: Task = {
    ...task,
    projectId: newProject.id,
    listName: newProject.name,
  };

  return { project: newProject, updatedTask };
}
