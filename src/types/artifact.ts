export type MessageTuple = ["u" | "a", string];

export interface DailyArtifact {
  date: string;
  timezone: string;
  projects: Project[];
}

export interface Project {
  project_key: string;
  threads: Thread[];
}

export interface Thread {
  title: string;
  branch: string | null;
  context: MessageTuple[];
  messages: MessageTuple[];
}
