import { validateEvent, type EventName, type UsageEvent } from './analytics-contract';
type State = { consent: boolean; installation?: string; events: UsageEvent[] };
type Properties = Pick<UsageEvent, 'screen' | 'outcome' | 'duration'>;
type Dependencies = {
  load: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
  uuid: () => string;
  now: () => number;
  platform: 'ios' | 'android';
  send: (event: UsageEvent, signal: AbortSignal) => Promise<boolean>;
};
/** All persistence is serialized; revocation also aborts any request already in flight. */
export class UsageCollector {
  private state: State = { consent: false, events: [] };
  private work: Promise<unknown> = Promise.resolve();
  private initialized: Promise<void> | undefined;
  private generation = 0;
  private request: AbortController | undefined;
  constructor(private readonly deps: Dependencies) {}
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.work.then(task, task);
    this.work = next.catch(() => {});
    return next;
  }
  initialize(): Promise<void> {
    return (this.initialized ??= this.serialize(async () => {
      const generation = this.generation;
      try {
        const value = await this.deps.load();
        if (generation !== this.generation) return;
        const saved = value ? (JSON.parse(value) as State) : null;
        if (
          saved?.consent &&
          typeof saved.installation === 'string' &&
          Array.isArray(saved.events)
        ) {
          this.state = {
            consent: true,
            installation: saved.installation,
            events: saved.events.filter(validateEvent),
          };
          this.prune();
        }
      } catch {
        this.state = { consent: false, events: [] };
      }
    }));
  }
  async enabled(): Promise<boolean> {
    await this.initialize();
    return this.state.consent;
  }
  async consent(enabled: boolean): Promise<void> {
    // Change synchronously so a queued event cannot race withdrawal.
    const generation = ++this.generation;
    this.request?.abort();
    this.state = { consent: false, events: [] };
    await this.initialize();
    await this.serialize(async () => {
      if (generation !== this.generation) return;
      this.state = enabled
        ? { consent: true, installation: this.deps.uuid(), events: [] }
        : { consent: false, events: [] };
      try {
        await this.persist();
      } catch (error) {
        this.state = { consent: false, events: [] };
        throw error;
      }
    });
  }
  private prune() {
    const cutoff = this.deps.now() - 7 * 86400000;
    this.state.events = this.state.events.filter((e) => Date.parse(e.at) > cutoff).slice(-200);
  }
  private persist() {
    return this.deps.save(JSON.stringify(this.state));
  }
  async track(name: EventName, properties: Properties = {}): Promise<void> {
    if (Object.keys(properties).some((key) => !['screen', 'outcome', 'duration'].includes(key)))
      return;
    await this.initialize();
    const generation = this.generation;
    await this.serialize(async () => {
      if (!this.state.consent || generation !== this.generation || !this.state.installation) return;
      const event = {
        id: this.deps.uuid(),
        installation: this.state.installation,
        at: new Date(this.deps.now()).toISOString(),
        platform: this.deps.platform,
        version: '0.1.0',
        name,
        ...properties,
      };
      if (!validateEvent(event)) return;
      this.state.events.push(event);
      this.prune();
      await this.persist();
      while (this.state.consent && generation === this.generation && this.state.events.length) {
        this.request = new AbortController();
        const abort = this.request;
        const timer = setTimeout(() => abort.abort(), 5000);
        let sent = false;
        try {
          sent = await this.deps.send(this.state.events[0]!, abort.signal);
        } catch {
          /* Keep bounded queue for the next foreground event. */
        } finally {
          clearTimeout(timer);
          this.request = undefined;
        }
        if (generation !== this.generation || !sent) break;
        this.state.events.shift();
        await this.persist();
      }
    }).catch(() => {
      /* Optional statistics never block the records workflow. */
    });
  }
}
