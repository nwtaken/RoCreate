/* Local directory controls. React keeps ownership of cards and their actions. */
(() => {
  let prefs = { enabled: true, friendsPage: true, groupsPage: true }, features = {}, ready = false;
  const views = new Map();
  const routes = {
    friends: () => /^\/users\/\d+\/friends\/?$/.test(location.pathname) || /^\/friends\/?$/.test(location.pathname),
    groups: () => /^\/(?:communities|groups)(?:\/|$)/.test(location.pathname),
  };
  const definitions = {
    friends: { selector: 'ul.avatar-cards', item: ':scope > li.avatar-card', name: '.avatar-name, .avatar-card-name, .avatar-card-caption .text-overflow', title: 'Connections', placeholder: 'Search loaded names or usernames', feature: 'friendsPage' },
    groups: { selector: '.groups-list-sidebar', item: 'a.groups-list-item', name: '.groups-list-item-name, .group-name', title: 'Communities', placeholder: 'Search loaded communities', feature: 'groupsPage' },
  };
  function clear(kind) {
    const view = views.get(kind);
    if (view) {
      view.bar.remove();
      view.empty.remove();
      view.list.classList.remove('rc-directory-list');
      for (const parent of view.parents) parent.classList.remove('rc-directory-items');
      for (const item of view.items) { item.classList.remove('rc-directory-hidden'); item.style.order = view.orders.get(item) || ''; }
      views.delete(kind);
    }
    document.documentElement.classList.remove('rc-directory-' + kind);
  }
  function update(kind) {
    const def = definitions[kind], view = views.get(kind);
    const items = [...view.list.querySelectorAll(def.item)];
    for (const old of view.items) if (!items.includes(old)) { old.classList.remove('rc-directory-hidden'); old.style.order = view.orders.get(old) || ''; }
    for (const item of items) if (!view.orders.has(item)) view.orders.set(item, item.style.order);
    view.items = items;
    for (const item of items) {
      if (kind === 'groups' && item.parentElement?.querySelectorAll(':scope > a.groups-list-item').length > 1) {
        view.parents.add(item.parentElement);
        item.parentElement.classList.add('rc-directory-items');
      }
    }
    const query = view.search.value.trim().toLocaleLowerCase();
    const ordered = view.sort.value === 'name' ? [...items].sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base', numeric: true })) : items;
    function label(item) { return (item.querySelector(def.name)?.textContent || item.textContent).trim(); }
    let count = 0;
    for (const [index, item] of ordered.entries()) {
      const hidden = !!query && !item.textContent.toLocaleLowerCase().includes(query);
      item.classList.toggle('rc-directory-hidden', hidden);
      const order = view.sort.value === 'name' ? String(index) : view.orders.get(item) || '';
      if (item.style.order !== order) item.style.order = order;
      if (!hidden) count++;
    }
    const text = `${count} of ${items.length} loaded`;
    if (view.count.textContent !== text) view.count.textContent = text;
    view.empty.hidden = !query || count > 0;
    view.reset.hidden = !query && view.sort.value === 'default';
  }
  function mount(kind, list) {
    const def = definitions[kind], bar = document.createElement('section');
    bar.className = 'rc-directory-toolbar';
    bar.setAttribute('aria-label', def.title);
    bar.innerHTML = `<div class="rc-directory-heading"><div><span class="rc-directory-eyebrow">ROCREATE</span><h2>${def.title}</h2></div><span class="rc-directory-count" aria-live="polite"></span></div><div class="rc-directory-controls"><input type="search" aria-label="${def.placeholder}" placeholder="${def.placeholder}"><label>Sort <select aria-label="Sort loaded ${kind}"><option value="default">Roblox order</option><option value="name">Name A to Z</option></select></label><button type="button" hidden>Reset</button></div><p>Filters apply to loaded results. Use Roblox's tabs and load more to browse the rest.</p>`;
    const empty = document.createElement('p');
    empty.className = 'rc-directory-empty'; empty.hidden = true;
    empty.textContent = 'No loaded results match. Clear your search or load more results.';
    if (kind === 'groups') list.prepend(bar); else list.before(bar);
    if (kind === 'groups') list.append(empty); else list.after(empty);
    list.classList.add('rc-directory-list');
    const view = { list, bar, empty, items: [], parents: new Set(), orders: new WeakMap(), search: bar.querySelector('input'), sort: bar.querySelector('select'), count: bar.querySelector('.rc-directory-count'), reset: bar.querySelector('button') };
    views.set(kind, view);
    view.search.addEventListener('input', () => update(kind));
    view.sort.addEventListener('change', () => update(kind));
    view.reset.addEventListener('click', () => { view.search.value = ''; view.sort.value = 'default'; update(kind); view.search.focus(); });
  }
  function scan() {
    if (!ready || !rcAlive()) return;
    for (const [kind, def] of Object.entries(definitions)) {
      const on = prefs.enabled && prefs[def.feature] && features[def.feature] !== false && routes[kind]();
      const list = on && document.querySelector(def.selector);
      if (!list) { clear(kind); continue; }
      if (views.get(kind)?.list !== list || !views.get(kind)?.bar.isConnected) { clear(kind); mount(kind, list); }
      document.documentElement.classList.add('rc-directory-' + kind);
      update(kind);
    }
  }
  Promise.all([
    chrome.storage.sync.get(prefs),
    fetch(chrome.runtime.getURL('config.json')).then(r => r.json()),
  ]).then(([settings, config]) => {
    prefs = settings; features = config.features || {}; ready = true;
    if (document.body) { scan(); rcWatch(scan, { text: true }); }
    else document.addEventListener('DOMContentLoaded', () => { scan(); rcWatch(scan, { text: true }); }, { once: true });
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(prefs)) if (changes[key]) prefs[key] = changes[key].newValue ?? true;
    scan();
  });
})();
