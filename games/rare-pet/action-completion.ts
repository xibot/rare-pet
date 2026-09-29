export type ActionCompletionScope = Readonly<{ friend: string; context: string }>;
export type ActionCompletionTicket = Readonly<{
  id: number;
  action: 'play' | 'launch';
  scope: ActionCompletionScope;
}>;
export type ActionCompletionResult = { kind: 'play' } | {
  kind: 'launch'; mode: 'friend' | 'self'; friend: string | null; hash: string;
};

/** Keep confirmed moments until their modal closes, without replaying stale work. */
export function createActionCompletionQueue() {
  let nextId = 0;
  let active: { ticket: ActionCompletionTicket; completed: boolean } | null = null;
  const seenLaunches = new Set<string>();

  function current(ticket: ActionCompletionTicket | null, scope: ActionCompletionScope) {
    if (!ticket || active?.ticket !== ticket) return null;
    if (ticket.scope.friend !== scope.friend || ticket.scope.context !== scope.context) {
      active = null;
      return null;
    }
    return active;
  }

  return {
    begin(action: ActionCompletionTicket['action'], scope: ActionCompletionScope): ActionCompletionTicket {
      const ticket = Object.freeze({ id: ++nextId, action, scope: Object.freeze({ ...scope }) });
      active = { ticket, completed: false };
      return ticket;
    },
    complete(ticket: ActionCompletionTicket | null, scope: ActionCompletionScope, result: ActionCompletionResult): boolean {
      const pending = current(ticket, scope);
      if (!pending || result.kind !== pending.ticket.action) return false;
      if (result.kind === 'launch') {
        if (result.mode !== 'friend' || result.friend !== pending.ticket.scope.friend || !result.hash) return false;
        const hash = result.hash.toLowerCase();
        if (seenLaunches.has(hash)) return false;
        seenLaunches.add(hash);
      }
      // Each finished Play run is accepted; the host still owns its reward rules.
      pending.completed = true;
      return true;
    },
    consume(ticket: ActionCompletionTicket | null, scope: ActionCompletionScope): ActionCompletionTicket['action'] | null {
      const pending = current(ticket, scope);
      if (!pending) return null;
      active = null;
      return pending.completed ? pending.ticket.action : null;
    },
    clear(): void { active = null; },
  };
}
