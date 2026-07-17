export function findFocusSessionOverlaps(sessions, options = {}) {
  const fromBoundary = options.from ? new Date(options.from) : null;
  const toBoundary = options.to ? new Date(options.to) : null;
  const now = options.now ? new Date(options.now) : new Date();
  const intervals = sessions
    .map((session) => {
      const rawFrom = new Date(session.started_at);
      const rawTo = session.stopped_at ? new Date(session.stopped_at) : now;
      const from = fromBoundary && fromBoundary > rawFrom ? fromBoundary : rawFrom;
      const to = toBoundary && toBoundary < rawTo ? toBoundary : rawTo;
      return { session, from, to };
    })
    .filter(({ from, to }) => Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && to > from)
    .sort((left, right) => left.from.getTime() - right.from.getTime());

  const overlaps = [];
  for (let firstIndex = 0; firstIndex < intervals.length; firstIndex += 1) {
    const first = intervals[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < intervals.length; secondIndex += 1) {
      const second = intervals[secondIndex];
      if (second.from >= first.to) break;

      const from = second.from > first.from ? second.from : first.from;
      const to = second.to < first.to ? second.to : first.to;
      if (to > from) {
        overlaps.push({
          first: first.session,
          second: second.session,
          from,
          to,
          seconds: Math.floor((to.getTime() - from.getTime()) / 1000),
        });
      }
    }
  }

  return overlaps;
}

export function formatFocusOverlap(overlap, formatTime, formatDuration) {
  const firstTitle = overlap.first.work_item_title ?? overlap.first.title;
  const secondTitle = overlap.second.work_item_title ?? overlap.second.title;
  return `«${firstTitle}» и «${secondTitle}» одновременно ${formatTime(overlap.from)}-${formatTime(overlap.to)} (${formatDuration(overlap.seconds)})`;
}
