import { Task, isTaskScheduledForFuture } from './supabase';

export interface DayPlanResult {
  scheduledTasks: Task[];
  totalMinutes: number;
  availableMinutes: number;
  remainingMinutes: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  lowPriorityCount: number;
  unscheduledTasks: Task[];
}

export function buildDaySchedule(tasks: Task[], availableMinutes: number): DayPlanResult {
  // 1. Filter out completed and future tasks
  const eligible = tasks.filter(
    (t) => t.status !== 'completed' && !isTaskScheduledForFuture(t.dueDate)
  );

  // 2. Priority scoring: High = 3, Medium = 2, Low = 1
  const priorityWeight = (p?: string): number => {
    if (p === 'high') return 3;
    if (p === 'medium') return 2;
    if (p === 'low') return 1;
    return 2; // default
  };

  // 3. Sort:
  // - Priority descending (High first, then Medium, then Low)
  // - Within same priority, shorter tasks first to maximize velocity, or tie-break by title
  const sorted = [...eligible].sort((a, b) => {
    const pA = priorityWeight(a.priority);
    const pB = priorityWeight(b.priority);
    if (pA !== pB) return pB - pA;

    const durA = a.estimatedMinutes || 15;
    const durB = b.estimatedMinutes || 15;
    return durA - durB;
  });

  const scheduledTasks: Task[] = [];
  const unscheduledTasks: Task[] = [];
  let currentUsedMinutes = 0;

  for (const task of sorted) {
    const dur = task.estimatedMinutes || 15;
    if (currentUsedMinutes + dur <= availableMinutes) {
      scheduledTasks.push(task);
      currentUsedMinutes += dur;
    } else {
      unscheduledTasks.push(task);
    }
  }

  // Count by priority
  const highPriorityCount = scheduledTasks.filter((t) => t.priority === 'high').length;
  const mediumPriorityCount = scheduledTasks.filter((t) => t.priority === 'medium').length;
  const lowPriorityCount = scheduledTasks.filter((t) => t.priority === 'low').length;

  return {
    scheduledTasks,
    totalMinutes: currentUsedMinutes,
    availableMinutes,
    remainingMinutes: Math.max(0, availableMinutes - currentUsedMinutes),
    highPriorityCount,
    mediumPriorityCount,
    lowPriorityCount,
    unscheduledTasks,
  };
}
