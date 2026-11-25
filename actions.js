export function viewForTail(owner, view) {
  return view && view.seq === owner.turn.end?.seq ? view : null;
}

// This selects what to display; the Host schedules the review independently.
export function reviewRouteForCard(card, route) {
  return card?.kind === 'next_task' || card?.kind === 'session_choice' ? '' : route;
}

// The target and request id survive a failed acknowledgement. A retry must not
// create a second session or queue the same text twice.
export async function deliver(ctx, attempt, placement, text, origin, remember) {
  if (!attempt.target) {
    if (placement === 'new') {
      attempt.candidate ??= crypto.randomUUID();
      remember();
      attempt.target = await ctx.sessions.create({...origin.options,sessionId:attempt.candidate});
    } else attempt.target = origin.id;
    remember();
  }
  const result = await ctx.sessions.using(attempt.target, {source:'controllerOperation'}, ({binding}) => {
    const snap = binding.session.getSnapshot();
    if (snap.openState !== 'open') throw Error(snap.openError?.message || 'Session unavailable');
    attempt.possiblySent = true;
    remember();
    return binding.session.prompt([{type:'text',text}], 'queue', undefined, attempt.requestId);
  });
  if (!result.ok || !result.value?.accepted) throw Error(result.error?.message || 'No acceptance receipt');
  attempt.done = true;
  remember();
  if (placement === 'new') ctx.uiWorkspace.openSession(attempt.target);
}
