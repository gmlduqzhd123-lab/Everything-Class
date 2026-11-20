export function unitKey({ grade, subject, term, label }) {
  return [grade, subject, term, label.normalize('NFKC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu, '')].join('|');
}

export function alternativeVideos(video, videos, preferredUnits, unavailable) {
  const wanted = new Set((preferredUnits.length ? preferredUnits : video.units).map(unitKey));
  if (!wanted.size) return [];
  return videos.filter((item) => item.id !== video.id && !unavailable.has(item.id)
    && item.units.some((unit) => wanted.has(unitKey(unit))))
    .sort((a, b) => Number(b.channel !== video.channel) - Number(a.channel !== video.channel)
      || Number(b.stages.some((stage) => video.stages.includes(stage))) - Number(a.stages.some((stage) => video.stages.includes(stage)))
      || a.duration - b.duration).slice(0, 3);
}

export function unitCoverage(reference, videos, now = Date.now()) {
  const cutoff = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
  const units = new Map(reference.map(([grade, subject, term, label]) => {
    const entry = { grade, subject, term, label, count: 0, introduction: 0, review: 0 };
    return [unitKey(entry), entry];
  }));
  for (const video of videos) {
    const related = new Map(video.units.map((unit) => [unitKey(unit), unit]));
    for (const [key, unit] of related) {
      const entry = units.get(key);
      if (entry) {
        entry.count++;
        if (video.stages.includes('도입')) entry.introduction++;
        if (video.checkedAt < cutoff) entry.review++;
        entry.filterLabel ??= unit.label;
      }
    }
  }
  return [...units.values()].sort((a, b) => a.count - b.count);
}
