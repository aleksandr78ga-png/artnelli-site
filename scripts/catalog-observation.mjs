const validId = id => Number.isSafeInteger(id) && id > 0;

// Telegram Web renders an album under one of its message IDs. Published
// catalogue IDs may identify another photo in the same album. Use observed
// member IDs, never an inferred numeric range or a matching model name.
export function catalogPostsFromAlbums(albums, knownProducts = []) {
  if (!Array.isArray(albums)) throw new Error('Pass observed Telegram albums');
  const known = new Map(knownProducts.map(p => [p.id, p]));
  const owners = new Map();
  for (const p of known.values()) {
    for (const id of [p.id,p.observedAlbumRootId,...(p.observedMessageIds || [])].filter(validId)) {
      if (!owners.has(id)) owners.set(id,new Set());
      owners.get(id).add(p.id);
    }
  }
  const posts = new Map();
  const remember = (id, post) => {
    const previous = posts.get(id);
    if (!previous) return posts.set(id,post);
    const observedMessageIds = [...new Set([...previous.observedMessageIds,...post.observedMessageIds])].sort((a,b)=>a-b);
    posts.set(id,{...post,observedMessageIds,
      observedAlbumRootId:previous.observedMessageIds.length >= post.observedMessageIds.length
        ? previous.observedAlbumRootId : post.observedAlbumRootId});
  };
  for (const album of albums) {
    if (!validId(album.rootId) || !Array.isArray(album.memberIds) ||
        album.memberIds.some(id => !validId(id)) ||
        album.isAlbum === true && album.memberIds.length === 0)
      throw new Error('Album observations need actual visible message IDs');
    const ids = new Set([album.rootId, ...album.memberIds]);
    if (album.mainId != null) {
      if (!validId(album.mainId)) throw new Error('Invalid observed album main ID');
      ids.add(album.mainId);
    }
    const matches = [...new Set([...ids].flatMap(id=>[...(owners.get(id)||[])]))];
    const details = {telegramTopicId:album.topicId || null,
      observedAlbumRootId:album.mainId || album.rootId,
      observedMessageIds:[...ids].sort((a,b)=>a-b)};
    if (matches.length) {
      for (const id of matches) remember(id,{id,name:known.get(id).name,...details});
      continue;
    }
    const text = album.ownText || '';
    if (album.isReply || !/купальник|leotard|unitard|платье|dress|комбинезон/i.test(text) ||
        !/рост|height|размер|size|ОГ|дуга/i.test(text)) continue;
    const name = text.match(/[«“"]([^»”"\n]+)[»”"]/)?.[1] || '';
    const id = album.mainId || album.rootId;
    remember(id,{id,name,...details});
  }
  return [...posts.values()].sort((a,b)=>a.id-b.id);
}

export function normalizeHistoryObservation(observation, knownProducts) {
  return observation?.albums === undefined ? observation :
    {...observation,posts:catalogPostsFromAlbums(observation.albums,knownProducts)};
}

export function withHistoryMessageIds(products, previous) {
  const records = new Map((previous?.records || []).map(p=>[p.id,p]));
  return products.map(p=>({...records.get(p.id),...p}));
}
