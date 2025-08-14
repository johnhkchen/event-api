// Type definitions for the agent management system

export interface KanbanMetadata {
  project: string;
  max_agents: number;
  created: string;
  last_updated: string;
}

export interface AgentStatus {
  status: 'available' | 'working' | 'blocked' | 'offline';
  current_task: string | null;
  worktree: string | null;
  last_active: string | null;
}

export interface TaskRequirement {
  description: string;
  completed: boolean;
}

export interface Task {
  id: string;
  title: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  estimated_hours: number;
  description: string;
  requirements: string[];
  files: string[];
  dependencies: string[];
  labels: string[];
  assignee?: string | null;
  created?: string;
  started?: string | null;
  completed?: string;
}

export interface TaskPipeline {
  backlog: Task[];
  todo: Task[];
  in_progress: Task[];
  review: Task[];
  done: Task[];
}

export interface AssignmentRules {
  priority_order: ('critical' | 'high' | 'normal' | 'low')[];
  agent_specialties: Record<string, string[]>;
  auto_assign: boolean;
  respect_dependencies: boolean;
}

export interface WorkflowState {
  description: string;
  next_states: string[];
}

export interface IntegrationSettings {
  git: {
    branch_prefix: string;
    worktree_prefix: string;
  };
  notification: {
    slack_webhook: string | null;
    email: string | null;
  };
  reporting: {
    daily_standup: boolean;
    weekly_summary: boolean;
  };
}

export interface KanbanBoard {
  metadata: KanbanMetadata;
  agents: Record<string, AgentStatus>;
  tasks: TaskPipeline;
  assignment_rules: AssignmentRules;
  workflow: Record<string, WorkflowState>;
  integration: IntegrationSettings;
}

export interface AgentSummary {
  agent_id: string;
  task_id: string;
  workspace: string;
  status: string;
  started: string;
  last_startup: string;
}

export interface CommandOptions {
  verbose?: boolean;
  dry_run?: boolean;
  agent_id?: string;
  task_id?: string;
}

export interface AgentInfo {
  id: string;
  worktree_path: string;
  branch_name: string;
  task: Task;
  status: AgentStatus;
}