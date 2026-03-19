/**
 * ADVANCED TODO MANAGER - ENTERPRISE GRADE
 * Sophisticated patterns: Observer, Command, Strategy, Mediator, Singleton
 * Features: IndexedDB async storage, undo/redo, fuzzy search, perf monitoring, event bus
 */

const STORAGE_VERSION = '3.0';
const DB_NAME = 'AdvancedTodoApp';
const STORE_NAME = 'todos';

// ============================================================================
// ADVANCED STORAGE WITH INDEXEDDB + FALLBACK
// ============================================================================
class StorageManager {
  constructor() {
    this.db = null;
    this.dbReady = this.initDB();
    this.cache = new Map();
  }

  async initDB() {
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const os = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          os.createIndex('done', 'done', { unique: false });
          os.createIndex('due', 'due', { unique: false });
          os.createIndex('prio', 'prio', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  async getAllTodos() {
    if (!this.db) return JSON.parse(localStorage.getItem('todos_fallback') || '[]');
    return new Promise((resolve) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  }

  async addTodo(todo) {
    this.cache.set(todo.id, todo);
    if (!this.db) {
      const todos = JSON.parse(localStorage.getItem('todos_fallback') || '[]');
      todos.push(todo);
      localStorage.setItem('todos_fallback', JSON.stringify(todos));
      return todo;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).add(todo);
      req.onsuccess = () => resolve(todo);
    });
  }

  async updateTodo(todo) {
    this.cache.set(todo.id, todo);
    if (!this.db) {
      const todos = JSON.parse(localStorage.getItem('todos_fallback') || '[]');
      const idx = todos.findIndex(t => t.id === todo.id);
      if (idx >= 0) todos[idx] = todo;
      localStorage.setItem('todos_fallback', JSON.stringify(todos));
      return todo;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(todo);
      req.onsuccess = () => resolve(todo);
    });
  }

  async deleteTodo(id) {
    this.cache.delete(id);
    if (!this.db) {
      const todos = JSON.parse(localStorage.getItem('todos_fallback') || '[]');
      const filtered = todos.filter(t => t.id !== id);
      localStorage.setItem('todos_fallback', JSON.stringify(filtered));
      return;
    }
    return new Promise((resolve) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
    });
  }

  clearCache() { this.cache.clear(); }
}

// ============================================================================
// EVENT BUS - MEDIATOR PATTERN
// ============================================================================
class EventBus {
  constructor() {
    this.listeners = new Map();
    this.eventHistory = [];
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const idx = this.listeners.get(event).indexOf(callback);
    if (idx >= 0) this.listeners.get(event).splice(idx, 1);
  }

  emit(event, data) {
    this.eventHistory.push({ event, data, timestamp: Date.now() });
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`Event error on ${event}:`, e); }
      });
    }
  }

  getHistory() { return [...this.eventHistory]; }
}

// ============================================================================
// COMMAND PATTERN - UNDO/REDO
// ============================================================================
class Command {
  execute() { throw new Error('implement execute'); }
  undo() { throw new Error('implement undo'); }
}

class AddTodoCommand extends Command {
  constructor(todo, store, eventBus) {
    super();
    this.todo = todo;
    this.store = store;
    this.eventBus = eventBus;
  }
  async execute() {
    await this.store.addTodo(this.todo);
    this.eventBus.emit('todo:added', this.todo);
  }
  async undo() {
    await this.store.deleteTodo(this.todo.id);
    this.eventBus.emit('todo:deleted', this.todo.id);
  }
}

class UpdateTodoCommand extends Command {
  constructor(id, newData, oldData, store, eventBus) {
    super();
    this.id = id;
    this.newData = newData;
    this.oldData = oldData;
    this.store = store;
    this.eventBus = eventBus;
  }
  async execute() {
    const todo = { ...this.oldData, ...this.newData };
    await this.store.updateTodo(todo);
    this.eventBus.emit('todo:updated', todo);
  }
  async undo() {
    await this.store.updateTodo(this.oldData);
    this.eventBus.emit('todo:updated', this.oldData);
  }
}

class CommandHistory {
  constructor(maxSize = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
  }

  push(command) {
    command.execute();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  async undo() {
    if (this.undoStack.length === 0) return false;
    const cmd = this.undoStack.pop();
    await cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  async redo() {
    if (this.redoStack.length === 0) return false;
    const cmd = this.redoStack.pop();
    await cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  clear() { this.undoStack = []; this.redoStack = []; }
}

// ============================================================================
// STRATEGY PATTERN - FILTERING
// ============================================================================
class FilterStrategy {
  apply(todos) { throw new Error('implement apply'); }
}

class DoneFilter extends FilterStrategy {
  constructor(done) { super(); this.done = done; }
  apply(todos) { return todos.filter(t => t.done === this.done); }
}

class PriorityFilter extends FilterStrategy {
  constructor(prio) { super(); this.prio = prio; }
  apply(todos) { return todos.filter(t => t.prio === this.prio); }
}

class DueSoonFilter extends FilterStrategy {
  apply(todos) {
    const now = new Date();
    return todos.filter(t => t.due && new Date(t.due) <= addDays(now, 3));
  }
}

class FuzzySearchFilter extends FilterStrategy {
  constructor(query) { super(); this.query = query.toLowerCase(); }
  apply(todos) {
    if (!this.query) return todos;
    return todos.filter(t => this.fuzzyMatch(this.query, t.text.toLowerCase()));
  }
  fuzzyMatch(query, text) {
    let qIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === query[qIdx]) qIdx++;
      if (qIdx === query.length) return true;
    }
    return false;
  }
}

class CompositeFilter extends FilterStrategy {
  constructor(strategies = []) { super(); this.strategies = strategies; }
  addStrategy(s) { this.strategies.push(s); return this; }
  apply(todos) {
    return this.strategies.reduce((acc, s) => s.apply(acc), todos);
  }
}

// ============================================================================
// PERFORMANCE UTILITIES
// ============================================================================
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function throttle(fn, interval) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= interval) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

class Memoizer {
  constructor() { this.cache = new Map(); }
  memoize(key, fn, ttl = 5000) {
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.timestamp < ttl) return cached.value;
      this.cache.delete(key);
    }
    const value = fn();
    this.cache.set(key, { value, timestamp: Date.now() });
    return value;
  }
  clear() { this.cache.clear(); }
}

class PerformanceMonitor {
  constructor() { this.metrics = new Map(); }

  measure(label, fn) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    this._recordMetric(label, duration);
    return result;
  }

  async measureAsync(label, fn) {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    this._recordMetric(label, duration);
    return result;
  }

  _recordMetric(label, duration) {
    if (!this.metrics.has(label)) {
      this.metrics.set(label, { count: 0, total: 0, min: Infinity, max: -Infinity });
    }
    const m = this.metrics.get(label);
    m.count++;
    m.total += duration;
    m.min = Math.min(m.min, duration);
    m.max = Math.max(m.max, duration);
  }

  getMetrics() {
    const result = {};
    this.metrics.forEach((v, k) => {
      result[k] = { ...v, average: (v.total / v.count).toFixed(2) };
    });
    return result;
  }

  clear() { this.metrics.clear(); }
}

// ============================================================================
// SINGLETON - STATE MANAGER
// ============================================================================
class StateManager {
  static instance = null;

  constructor() {
    if (StateManager.instance) return StateManager.instance;
    this.state = {
      todos: [],
      settings: {},
      currentFilter: 'all',
      searchQuery: '',
      isDirty: false
    };
    this.listeners = new Set();
    StateManager.instance = this;
  }

  static getInstance() {
    if (!StateManager.instance) new StateManager();
    return StateManager.instance;
  }

  getState() { return { ...this.state }; }

  setState(updates) {
    const newState = { ...this.state, ...updates };
    if (JSON.stringify(newState) !== JSON.stringify(this.state)) {
      this.state = newState;
      this.notifyListeners();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
const eventBus = new EventBus();
const storage = new StorageManager();
const stateManager = StateManager.getInstance();
const commandHistory = new CommandHistory();
const perfMonitor = new PerformanceMonitor();
const memoizer = new Memoizer();

const form = document.getElementById('todo-form');
const input = document.getElementById('todo-input');
const dueInput = document.getElementById('due-input');
const prioSelect = document.getElementById('prio-select');
const listEl = document.getElementById('todo-list');
const clearCompletedBtn = document.getElementById('clear-completed');
const clearAllBtn = document.getElementById('clear-all');
const themeSelect = document.getElementById('theme-select');
const accentPreset = document.getElementById('accent-preset');
const importBtn = document.getElementById('import-btn');
const exportBtn = document.getElementById('export-btn');
const importFile = document.getElementById('import-file');
const filters = document.querySelectorAll('.filter');
const progressFill = document.querySelector('.progress-fill');
const progressText = document.getElementById('progress-text');
const toastEl = document.getElementById('toast');

let todos = [];
let settings = { theme: 'light', accent: '#2b7cff' };
let currentFilter = 'all';

// ============================================================================
// STARTUP
// ============================================================================
(async () => {
  await storage.dbReady;
  todos = await storage.getAllTodos();
  settings = JSON.parse(localStorage.getItem('settings') || '{"theme":"light","accent":"#2b7cff"}');
  applySettings();
  render();
  input.focus();
})();

// ============================================================================
// EVENT HANDLERS
// ============================================================================
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return showToast('Enter a task first');

  const todo = {
    id: Date.now().toString(),
    text,
    done: false,
    due: dueInput.value || null,
    prio: prioSelect.value,
    created: Date.now(),
    updated: Date.now(),
    tags: []
  };

  const cmd = new AddTodoCommand(todo, storage, eventBus);
  await commandHistory.push(cmd);
  todos.push(todo);
  stateManager.setState({ todos: [...todos], isDirty: true });

  input.value = '';
  dueInput.value = '';
  prioSelect.value = 'medium';
  input.focus();
  showToast('✓ Task added');
  render();
});

document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmd = isMac ? e.metaKey : e.ctrlKey;

  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }

  if (cmd && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    input.focus();
  }

  if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (commandHistory.canUndo()) {
      commandHistory.undo().then(() => {
        render();
        showToast('↶ Undone');
      });
    }
  }

  if (cmd && e.key.toLowerCase() === 'z' && e.shiftKey) {
    e.preventDefault();
    if (commandHistory.canRedo()) {
      commandHistory.redo().then(() => {
        render();
        showToast('↷ Redone');
      });
    }
  }

  if (e.key === 'Escape' && document.activeElement === input) {
    input.value = '';
  }
});

clearCompletedBtn.addEventListener('click', async () => {
  const completed = todos.filter(t => t.done);
  if (!completed.length) return showToast('No completed tasks');

  for (const t of completed) {
    await storage.deleteTodo(t.id);
  }
  todos = todos.filter(t => !t.done);
  stateManager.setState({ todos: [...todos], isDirty: true });
  render();
  showToast(`✓ ${completed.length} tasks cleared`);
});

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Clear ALL tasks?')) return;
  for (const t of todos) await storage.deleteTodo(t.id);
  todos = [];
  commandHistory.clear();
  stateManager.setState({ todos: [], isDirty: true });
  render();
  showToast('✓ All tasks cleared');
});

themeSelect.addEventListener('change', (e) => {
  settings.theme = e.target.value;
  localStorage.setItem('settings', JSON.stringify(settings));
  applySettings();
  eventBus.emit('settings:changed', settings);
});

accentPreset.addEventListener('change', (e) => {
  settings.accent = e.target.value;
  localStorage.setItem('settings', JSON.stringify(settings));
  applySettings();
  eventBus.emit('settings:changed', settings);
});

exportBtn.addEventListener('click', () => {
  const data = {
    version: STORAGE_VERSION,
    exportDate: new Date().toISOString(),
    stats: { total: todos.length, completed: todos.filter(t => t.done).length },
    todos,
    settings
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `todos-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('✓ Exported');
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.todos)) throw new Error('Invalid format');

      const imported = data.todos.map(t => ({
        id: t.id || Date.now().toString(),
        text: t.text || '',
        done: !!t.done,
        due: t.due || null,
        prio: t.prio || 'medium',
        created: t.created || Date.now(),
        updated: t.updated || Date.now(),
        tags: t.tags || []
      }));

      todos = imported;
      storage.clearCache();
      for (const t of todos) await storage.addTodo(t);

      if (data.settings) {
        settings = { ...settings, ...data.settings };
        localStorage.setItem('settings', JSON.stringify(settings));
      }

      applySettings();
      render();
      showToast(`✓ Imported ${todos.length} tasks`);
    } catch (err) {
      showToast('❌ Import failed');
      console.error(err);
    }
  };
  reader.readAsText(f);
});

filters.forEach(btn => btn.addEventListener('click', (e) => {
  filters.forEach(b => b.classList.remove('active'));
  e.currentTarget.classList.add('active');
  currentFilter = e.currentTarget.dataset.filter;
  render();
}));

// ============================================================================
// FILTERING & RENDERING
// ============================================================================
function getFilteredTodos() {
  const filter = new CompositeFilter();
  
  if (currentFilter === 'active') {
    filter.addStrategy(new DoneFilter(false));
  } else if (currentFilter === 'completed') {
    filter.addStrategy(new DoneFilter(true));
  } else if (currentFilter === 'due') {
    filter.addStrategy(new DueSoonFilter());
  }

  return filter.apply(todos);
}

function naturalSort(a, b) {
  if (a.due && b.due) {
    const diff = new Date(a.due) - new Date(b.due);
    if (diff !== 0) return diff;
  } else if (a.due) return -1;
  else if (b.due) return 1;

  const prioMap = { high: 0, medium: 1, low: 2 };
  const prioDiff = (prioMap[a.prio] || 1) - (prioMap[b.prio] || 1);
  if (prioDiff !== 0) return prioDiff;

  return (b.created || 0) - (a.created || 0);
}

const debouncedRender = debounce(render, 100);

function render() {
  perfMonitor.measure('render', () => {
    listEl.innerHTML = '';
    const filtered = getFilteredTodos().sort(naturalSort);

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = currentFilter === 'all' ? 'No tasks' : 'No matches';
      listEl.appendChild(empty);
      updateProgress();
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(todo => frag.appendChild(createTodoElement(todo)));
    listEl.appendChild(frag);
    updateProgress();
  });
}

function createTodoElement(todo) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (todo.done ? ' completed' : '');
  li.dataset.id = todo.id;

  const checkbox = document.createElement('button');
  checkbox.className = 'icon';
  checkbox.innerHTML = todo.done ? '✅' : '⬜';
  checkbox.addEventListener('click', () => toggleTodo(todo.id));

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = 'true';
  text.spellcheck = 'false';
  text.textContent = todo.text;
  text.addEventListener('blur', () => editTodo(todo.id, text.textContent));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
    if (e.key === 'Escape') { text.textContent = todo.text; text.blur(); }
  });

  const meta = document.createElement('div');
  meta.className = 'meta';

  const prio = document.createElement('div');
  prio.className = 'badge prio-' + (todo.prio || 'medium');
  prio.textContent = (todo.prio || 'medium').toUpperCase();
  meta.appendChild(prio);

  if (todo.due) {
    const due = document.createElement('div');
    due.className = 'due';
    due.textContent = formatDue(todo.due);
    meta.appendChild(due);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Delete "${todo.text}"?`)) removeTodo(todo.id);
  });

  li.appendChild(checkbox);
  li.appendChild(text);
  li.appendChild(meta);
  li.appendChild(deleteBtn);

  return li;
}

// ============================================================================
// TODO ACTIONS
// ============================================================================
async function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  const oldData = { ...todo };
  todo.done = !todo.done;
  todo.updated = Date.now();

  const cmd = new UpdateTodoCommand(id, { done: todo.done }, oldData, storage, eventBus);
  await commandHistory.push(cmd);
  stateManager.setState({ todos: [...todos], isDirty: true });
  render();
}

async function editTodo(id, newText) {
  const todo = todos.find(t => t.id === id);
  if (!todo || !newText.trim()) return;

  const oldData = { ...todo };
  todo.text = newText.trim();
  todo.updated = Date.now();

  const cmd = new UpdateTodoCommand(id, { text: todo.text }, oldData, storage, eventBus);
  await commandHistory.push(cmd);
  render();
}

async function removeTodo(id) {
  const idx = todos.findIndex(t => t.id === id);
  if (idx < 0) return;

  const deleted = todos.splice(idx, 1)[0];
  await storage.deleteTodo(id);
  stateManager.setState({ todos: [...todos], isDirty: true });
  render();

  showToast('🗑️ Deleted', async () => {
    todos.push(deleted);
    await storage.addTodo(deleted);
    stateManager.setState({ todos: [...todos], isDirty: true });
    render();
    showToast('✓ Restored');
  });
}

// ============================================================================
// UTILITIES
// ============================================================================
function formatDue(dateStr) {
  const due = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));

  if (diff === 0) return '📅 Today';
  if (diff === 1) return '📅 Tomorrow';
  if (diff === -1) return '🔴 Yesterday';
  if (diff < 0) return `🔴 ${Math.abs(diff)}d ago`;
  if (diff <= 7) return `📅 In ${diff}d`;

  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function addDays(date, days) {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}

function updateProgress() {
  const total = todos.length;
  const done = todos.filter(t => t.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  progressFill.style.width = pct + '%';
  progressText.textContent = `${done}/${total}`;

  if (pct === 100 && total > 0) {
    showToast('🎉 All tasks done!');
  }
}

function applySettings() {
  document.documentElement.setAttribute('data-theme', settings.theme || 'light');
  document.documentElement.style.setProperty('--accent', settings.accent || '#2b7cff');
  themeSelect.value = settings.theme || 'light';
  accentPreset.value = settings.accent || '#2b7cff';
}

let toastTimer = null;

function showToast(msg, undoCb) {
  toastEl.innerHTML = '';
  toastEl.style.display = 'flex';

  const span = document.createElement('div');
  span.textContent = msg;
  toastEl.appendChild(span);

  if (undoCb) {
    const btn = document.createElement('button');
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => { undoCb(); clearToast(); });
    toastEl.appendChild(btn);
  }

  clearTimeout(toastTimer);
  toastTimer = setTimeout(clearToast, 4000);
}

function clearToast() {
  toastEl.style.display = 'none';
  toastEl.innerHTML = '';
  clearTimeout(toastTimer);
}

// ============================================================================
// DEBUG API
// ============================================================================
window.DEBUG = {
  getState: () => stateManager.getState(),
  getMetrics: () => perfMonitor.getMetrics(),
  getEvents: () => eventBus.getHistory(),
  exportData: () => ({ todos, settings, metrics: perfMonitor.getMetrics() }),
  clearMetrics: () => perfMonitor.clear(),
  getTodoById: (id) => todos.find(t => t.id === id),
  getAllTodos: () => todos,
  getSettings: () => settings
};

// ============================================================================
// STATE SUBSCRIPTION
// ============================================================================
stateManager.subscribe((state) => {
  if (state.isDirty) {
    // Auto-save logic could go here
  }
});


 