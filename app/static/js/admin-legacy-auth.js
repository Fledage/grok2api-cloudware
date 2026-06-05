/* Compatibility bridge for legacy admin feature pages.
   These pages still call ensureApiKey/buildAuthHeaders/logout, but the whole
   admin UI now uses the /admin/login password store and header. */
let cachedApiKey = null;

async function ensureApiKey() {
  const key = await adminKey.get();
  if (!key || !await verifyKey(ADMIN_API + '/verify', key).catch(() => false)) {
    location.href = '/admin/login';
    return null;
  }
  cachedApiKey = `Bearer ${key}`;
  return cachedApiKey;
}

function buildAuthHeaders(apiKey) {
  return apiKey ? { Authorization: apiKey } : {};
}

function logout() {
  adminLogout();
}

async function fetchStorageType() {
  const apiKey = await ensureApiKey();
  if (apiKey === null) return null;
  try {
    const res = await fetch('/admin/api/storage', {
      headers: buildAuthHeaders(apiKey),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.storage || data?.type || null;
  } catch {
    return null;
  }
}

function formatStorageLabel(type) {
  if (!type) return '-';
  const normalized = String(type).toLowerCase();
  const map = {
    local: 'local',
    mysql: 'mysql',
    pgsql: 'pgsql',
    postgres: 'pgsql',
    postgresql: 'pgsql',
    d1: 'd1',
    redis: 'redis',
  };
  return map[normalized] || '-';
}

async function updateStorageModeButton() {
  const buttons = Array.from(document.querySelectorAll('#storage-mode-btn, [data-storage-mode-btn]'));
  if (!buttons.length) return;
  buttons.forEach((btn) => {
    btn.textContent = '...';
    btn.title = '存储模式';
    btn.classList.remove('storage-ready');
  });
  const storageType = await fetchStorageType();
  const label = formatStorageLabel(storageType);
  buttons.forEach((btn) => {
    btn.textContent = label === '-' ? label : label.toUpperCase();
    btn.title = '存储模式';
    if (label !== '-') btn.classList.add('storage-ready');
  });
}
