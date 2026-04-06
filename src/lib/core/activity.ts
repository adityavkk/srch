export interface ActivityEntry {
  id: string;
  type: "api" | "fetch";
  startTime: number;
  endTime?: number;
  query?: string;
  url?: string;
  status: number | null;
  error?: string;
}

export class ActivityMonitor {
  private entries: ActivityEntry[] = [];
  private nextId = 1;

  logStart(partial: Omit<ActivityEntry, "id" | "startTime" | "status">): string {
    const id = `act-${this.nextId++}`;
    this.entries.push({ ...partial, id, startTime: Date.now(), status: null });
    this.entries = this.entries.slice(-20);
    return id;
  }

  logComplete(id: string, status: number): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return;
    entry.endTime = Date.now();
    entry.status = status;
  }

  logError(id: string, error: string): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return;
    entry.endTime = Date.now();
    entry.error = error;
  }

  getEntries(): readonly ActivityEntry[] {
    return this.entries;
  }
}

export const activityMonitor = new ActivityMonitor();
