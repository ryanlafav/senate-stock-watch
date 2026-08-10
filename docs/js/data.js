// Fetch + in-memory cache of the static JSON files under docs/data/.
// Each path is only ever fetched once per page load, even if requested from
// multiple places (e.g. the view toggle and a filter rebuild both wanting
// trades.json).
const DataStore = (() => {
  const cache = new Map();

  async function load(path) {
    if (cache.has(path)) {
      return cache.get(path);
    }
    const promise = fetch(`data/${path}`).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load data/${path}: HTTP ${res.status}`);
      }
      return res.json();
    });
    cache.set(path, promise);
    try {
      return await promise;
    } catch (err) {
      cache.delete(path);
      throw err;
    }
  }

  return {
    meta: () => load("meta.json"),
    flags: () => load("flags.json"),
    trades: () => load("trades.json"),
    members: () => load("members.json"),
    committees: () => load("committees.json"),
    jurisdiction: () => load("jurisdiction.json"),
  };
})();
