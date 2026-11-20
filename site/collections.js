export const collectionVideoLimit = 12;
export const backupSizeLimit = 2_000_000;
const backupFormat = 'everything-class-library';

export function cleanVideoIds(ids) {
  return Array.isArray(ids)
    ? [...new Set(ids.filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))]
    : [];
}

export function readCollections(data) {
  if (!Array.isArray(data)) return [];
  const ids = new Set();
  return data.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,60}$/.test(item.id) || ids.has(item.id)) return [];
    if (typeof item.name !== 'string' || !item.name.trim()) return [];
    ids.add(item.id);
    return [{ id: item.id, name: item.name.trim().slice(0, 50), videos: cleanVideoIds(item.videos).slice(0, collectionVideoLimit) }];
  });
}

export function readSharedCollection(params) {
  const value = params.get('bundle');
  if (!value || value.length > collectionVideoLimit * 12) return null;
  const videos = cleanVideoIds(value.split('.'));
  if (!videos.length || videos.length > collectionVideoLimit) return null;
  return { name: (params.get('name') || '').trim().slice(0, 50) || '공유받은 수업 꾸러미', videos };
}

export function moveCollectionVideo(ids, index, offset) {
  const nextIndex = index + offset;
  if (index < 0 || index >= ids.length || nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = ids.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function exportLibrary({ favorites, collections }) {
  return JSON.stringify({ format: backupFormat, version: 1, favorites, collections }, null, 2);
}

export function readLibraryBackup(text) {
  const data = JSON.parse(text);
  if (data?.format !== backupFormat || data.version !== 1
      || !Array.isArray(data.favorites) || !Array.isArray(data.collections)) throw new Error('invalid backup');

  const favorites = cleanVideoIds(data.favorites);
  const collections = readCollections(data.collections);
  if (favorites.length !== data.favorites.length || collections.length !== data.collections.length
      || collections.some((item, i) => !Array.isArray(data.collections[i].videos)
        || item.videos.length !== data.collections[i].videos.length)) {
    throw new Error('invalid backup contents');
  }
  return { favorites, collections };
}

export function mergeLibrary(current, backup, newId = () => crypto.randomUUID()) {
  const favorites = [...new Set([...current.favorites, ...backup.favorites])];
  const collections = [...current.collections];
  const ids = new Set(collections.map(({ id }) => id));
  const signature = ({ name, videos }) => JSON.stringify([name, videos]);
  const contents = new Set(collections.map(signature));
  for (const item of backup.collections) {
    const key = signature(item);
    if (contents.has(key)) continue;
    let id = item.id;
    while (ids.has(id)) id = newId();
    ids.add(id);
    contents.add(key);
    collections.push({ ...item, id });
  }
  return { ...current, favorites, collections };
}
