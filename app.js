const $ = s => document.querySelector(s);
const modal = $('#modal');
const body = $('#body');
let filter = 'all';

$('#year').textContent = new Date().getFullYear();

const API_BASE = 'https://anaghaye-ai-api.anaghaye-ai.workers.dev';

const AUTH_TOKEN_KEY = 'anaghaye_ai_session';
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';
let currentUser = null;
let cloudConversations = [];
let activeConversationId = null;
let activeConversationTool = null;

async function authRequest(path, method = 'GET', payload = null) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (payload) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}/api/auth/${path}`, {
    method, headers, ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Authentication failed (${response.status})`);
  return data;
}

async function conversationRequest(path, method = 'GET', payload = null) {
  if (!authToken) throw new Error('Please log in to use cloud chat history.');
  const headers = { Authorization: `Bearer ${authToken}` };
  if (payload) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}/api/conversations${path}`, {
    method, headers, ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function updateAccountButton() {
  const area = $('#accountArea');
  if (!area) return;
  area.innerHTML = currentUser
    ? `<button id="accountButton" class="ghost" title="Account">${escapeHtml(currentUser.email || 'My account')}</button>`
    : '<button id="accountButton" class="ghost">Login / Sign up</button>';
  $('#accountButton').onclick = () => currentUser ? showAccountMenu() : showAuth('login');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function showAccountMenu() {
  const choice = prompt(`Signed in as ${currentUser.email}\nType "logout" to sign out, or Cancel to close.`);
  if (choice && choice.trim().toLowerCase() === 'logout') logout();
}

function showAuth(mode = 'login') {
  const authModal = $('#authModal');
  const authBody = $('#authBody');
  $('#authTitle').textContent = mode === 'signup' ? 'Create your account' : 'Login to ANAGHAYE AI';
  authBody.innerHTML = `
    <div class="field"><label for="authEmail">Email address</label><input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" required></div>
    <div class="field"><label for="authPassword">Password</label><input id="authPassword" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" placeholder="${mode === 'signup' ? 'At least 10 characters' : 'Your password'}" required></div>
    ${mode === 'signup' ? '<p class="hint">Use at least 10 characters. Your account gets a unique User ID.</p>' : ''}
    <div class="actions"><button id="authSubmit" class="primary">${mode === 'signup' ? 'Create account' : 'Login'}</button><button id="authSwitch" class="secondary">${mode === 'signup' ? 'I already have an account' : 'Create a new account'}</button></div>
    <p id="authError" class="hint" aria-live="polite"></p>`;
  authModal.classList.remove('hidden');
  $('#authSwitch').onclick = () => showAuth(mode === 'signup' ? 'login' : 'signup');
  $('#authSubmit').onclick = async () => {
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const error = $('#authError');
    if (!email || !password) {
      error.textContent = 'Enter your email and password.';
      return;
    }
    const btn = $('#authSubmit');
    btn.disabled = true;
    error.textContent = 'Please wait…';
    try {
      const data = await authRequest(mode === 'signup' ? 'signup' : 'login', 'POST', { email, password });
      if (!data.token) throw new Error('The server did not return a session token. Please check the Worker response.');
      authToken = data.token;
      localStorage.setItem(AUTH_TOKEN_KEY, authToken);
      currentUser = data.user || { email };
      if (!currentUser.email) currentUser.email = email;
      authModal.classList.add('hidden');
      updateAccountButton();
      await loadCloudConversations();
      toast(mode === 'signup' ? 'Account created successfully' : 'Logged in successfully');
      if (pendingToolToOpen) {
        const next = pendingToolToOpen;
        pendingToolToOpen = null;
        open(next);
      }
    } catch (e) {
      error.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  };
}

let pendingToolToOpen = null;

async function restoreSession() {
  if (!authToken) {
    updateAccountButton();
    return;
  }
  try {
    const data = await authRequest('me');
    currentUser = data.user || data;
    await loadCloudConversations();
  } catch {
    authToken = '';
    currentUser = null;
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
  updateAccountButton();
}

async function logout() {
  try {
    await authRequest('logout', 'POST', {});
  } catch {}
  authToken = '';
  currentUser = null;
  cloudConversations = [];
  activeConversationId = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  updateAccountButton();
  toast('You have been logged out');
}

async function loadCloudConversations() {
  const data = await conversationRequest('');
  cloudConversations = data.conversations || [];
  renderCloudSidebar();
}

async function createCloudConversation() {
  const data = await conversationRequest('', 'POST', { title: 'New Chat' });
  activeConversationId = data.conversation.id;
  await loadCloudConversations();
  return activeConversationId;
}

async function loadCloudConversation(id) {
  const data = await conversationRequest(`/${encodeURIComponent(id)}`);
  activeConversationId = id;
  renderCloudMessages(data.messages || []);
  renderCloudSidebar();
}

function renderCloudMessages(messages) {
  const out = $('#out');
  if (!out) return;
  out.textContent = messages.map(m =>
    (m.role === 'user' ? 'You:\n' : 'ANAGHAYE AI:\n') + m.content
  ).join('\n\n--------------------\n\n');
}

function renderCloudSidebar() {
  const list = $('#chatHistoryList');
  if (!list) return;
  list.innerHTML = '';
  cloudConversations.forEach(item => {
    const row = document.createElement('div');
    row.className = 'chat-history-row';

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'secondary';
    select.textContent = item.title || 'New Chat';
    select.style.flex = '1';
    select.onclick = async () => {
      try {
        await loadCloudConversation(item.id);
      } catch (e) {
        toast(e.message);
      }
    };

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'ghost';
    rename.textContent = 'Rename';
    rename.onclick = async () => {
      const title = prompt('Enter a new chat title:', item.title || 'New Chat');
      if (!title || !title.trim()) return;
      try {
        await conversationRequest(`/${encodeURIComponent(item.id)}`, 'PATCH', { title: title.trim() });
        await loadCloudConversations();
      } catch (e) {
        toast(e.message);
      }
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost';
    remove.textContent = 'Delete';
    remove.onclick = async () => {
      if (!confirm(`Delete "${item.title || 'New Chat'}"? This cannot be undone.`)) return;
      try {
        await conversationRequest(`/${encodeURIComponent(item.id)}`, 'DELETE');
        if (activeConversationId === item.id) {
          activeConversationId = null;
          if ($('#out')) $('#out').textContent = '';
        }
        await loadCloudConversations();
      } catch (e) {
        toast(e.message);
      }
    };

    row.append(select, rename, remove);
    list.append(row);
  });
}

async function ensureCloudChat(tool) {
  if (!currentUser || !authToken) {
    pendingToolToOpen = tool;
    showAuth('login');
    return false;
  }
  activeConversationTool = tool;
  if (!activeConversationId || !cloudConversations.some(c => c.id === activeConversationId)) {
    await createCloudConversation();
  }
  return true;
}

async function sendCloudMessage(tool, prompt, options = {}) {
  if (!activeConversationId) await createCloudConversation();
  const data = await conversationRequest(`/${encodeURIComponent(activeConversationId)}/ask`, 'POST', {
    tool, prompt, tone: options.tone, format: options.format
  });
  await loadCloudConversations();
  const history = await conversationRequest(`/${encodeURIComponent(activeConversationId)}`);
  renderCloudMessages(history.messages || []);
  return data.assistantMessage?.content || '';
}

$('#authClose').onclick = () => $('#authModal').classList.add('hidden');
$('#authModal').addEventListener('click', e => {
  if (e.target === $('#authModal')) $('#authModal').classList.add('hidden');
});

restoreSession();

fetch(`${API_BASE}/health`)
  .then(r => r.json())
  .then(d => {
    const el = $('#backendStatus');
    if (el) el.textContent = d.ok ? 'Backend connected' : 'Backend unavailable';
  })
  .catch(() => {
    const el = $('#backendStatus');
    if (el) el.textContent = 'Backend status unavailable';
  });

$('#theme').onclick = () => document.body.classList.toggle('dark');
$('#search').addEventListener('input', render);

document.querySelectorAll('[data-filter]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    filter = b.dataset.filter;
    render();
  };
});

function render() {
  const q = $('#search').value.toLowerCase();
  let n = 0;

  document.querySelectorAll('.tile').forEach(t => {
    const ok =
      (filter === 'all' || t.dataset.cat.split(' ').includes(filter)) &&
      (t.dataset.key + ' ' + t.innerText).toLowerCase().includes(q);

    t.classList.toggle('hidden', !ok);
    if (ok) n++;
  });

  $('#empty').classList.toggle('hidden', n > 0);
}

function toast(s) {
  const t = $('#toast');
  t.textContent = s;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

function open(id) {
  if (['chat', 'writer', 'code'].includes(id) && (!currentUser || !authToken)) {
    pendingToolToOpen = id;
    showAuth('login');
    return;
  }

  const titles = {
    chat: 'AI Chat',
    writer: 'AI Writing Studio',
    translator: 'AI Translator',
    pdf: 'PDF Assistant',
    image: 'AI Image Studio',
    video: 'AI Video Studio',
    voice: 'Text to Speech',
    code: 'Coding Assistant',
    word: 'Word Counter',
    case: 'Case Converter',
    clean: 'Text Cleaner',
    reverse: 'Text Reverser',
    frequency: 'Word Frequency',
    percentage: 'Percentage Calculator',
    age: 'Age Calculator',
    bmi: 'BMI Calculator',
    resume: 'Resume Builder',
    seo: 'SEO Meta Helper',
    caption: 'Caption & Hashtag Helper',
    prompt: 'Prompt Builder'
  };

  $('#modalTitle').textContent = titles[id];
  $('#modalTag').textContent =
    document.querySelector(`[data-id="${id}"]`).querySelector('small').textContent;

  modal.classList.remove('hidden');
  body.innerHTML = '';

  ({
    chat, writer, translator, pdf, image, video, voice, code,
    word, case: caseTool, clean, reverse, frequency,
    percentage, age, bmi, resume, seo, caption, prompt
  })[id]?.();
}

document.querySelectorAll('.tile').forEach(t => {
  t.onclick = () => open(t.dataset.id);
});

$('#close').onclick = () => modal.classList.add('hidden');

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') modal.classList.add('hidden');
});

function field(label, id, placeholder = '', type = 'text') {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <input id="${id}" type="${type}" placeholder="${placeholder}">
  </div>`;
}

function area(label, id, placeholder = 'Enter text here…') {
  return `<div class="field">
    <label for="${id}">${label}</label>
    <textarea id="${id}" placeholder="${placeholder}"></textarea>
  </div>`;
}

function actions(html) {
  return `<div class="actions">${html}</div>`;
}
function result(id = 'out') {
  return `<div class="result" id="${id}" aria-live="polite"></div>`;
}

function button(label, fn, cls = 'primary') {
  return `<button class="${cls}" id="${fn}">${label}</button>`;
}

function copyOut(id = 'out') {
  const el = $('#' + id);
  const v = el?.innerText || '';

  if (!v.trim()) return toast('Nothing to copy yet');

  navigator.clipboard?.writeText(v)
    .then(() => toast('Copied'))
    .catch(() => toast('Clipboard unavailable'));
}

async function callApi(route, payload) {
  const r = await fetch(`${API_BASE}/api/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let d = {};
  try {
    d = await r.json();
  } catch {}

  if (!r.ok) throw Error(d.error || `Request failed (${r.status})`);
  return d;
}

// Conversation memory for the current browser session.
const conversationState = {
  chat: [],
  code: [],
  writer: []
};

async function api(tool, prompt, messages = null) {
  let route = tool;
  let payload = { prompt };

  if (tool === 'writer') {
    route = 'write';
    payload = {
      prompt,
      tone: 'clear and professional',
      format: 'the requested content'
    };
  } else if (tool === 'caption') {
    route = 'write';
    payload = {
      prompt,
      tone: 'engaging and platform-appropriate',
      format: '3 social captions with relevant hashtags'
    };
  } else if (tool === 'video') {
    route = 'write';
    payload = {
      prompt,
      tone: 'creative and clear',
      format: 'video script, storyboard and shot prompts (not a rendered video)'
    };
  } else if (tool === 'summarize') {
    route = 'summarize';
    payload = { text: prompt };
  }

  if (messages) payload.messages = messages;

  const d = await callApi(route, payload);
  return d.result || d.response || d.text || 'No result returned.';
}

function cloudChatLayout(label, placeholder, tool, extraFields = '') {
  if (activeConversationTool !== tool) activeConversationId = null;
  activeConversationTool = tool;

  body.innerHTML =
    `<div class="cloud-chat-layout">
      <aside class="chat-history">
        <button id="cloudNewChat" class="primary">+ New Chat</button>
        <div id="chatHistoryList"></div>
      </aside>
      <section class="chat-workspace">
        ${extraFields}
        ${area(label, 'input', placeholder)}
        ${actions(button('Send message', 'go') + button('Copy conversation', 'copy', 'secondary'))}
        ${result()}
      </section>
    </div>
    <p class="hint">Your chats are saved to your account and sync when you log in on another device.</p>`;

  renderCloudSidebar();

  if (activeConversationId && cloudConversations.some(c => c.id === activeConversationId)) {
    loadCloudConversation(activeConversationId).catch(e => toast(e.message));
  } else {
    createCloudConversation().catch(e => toast(e.message));
  }

  $('#cloudNewChat').onclick = async () => {
    try {
      await createCloudConversation();
      $('#out').textContent = '';
      $('#input').value = '';
      toast('New chat started');
    } catch (e) {
      toast(e.message);
    }
  };

  $('#go').onclick = async () => {
    const input = $('#input');
    const value = input.value.trim();
    if (!value) return toast('Please enter a message');

    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = 'Thinking…';

    try {
      const prompt = extraFields && $('#kind')
        ? `${$('#kind').value}\n${value}`
        : value;

      const options = tool === 'write'
        ? {
            tone: 'clear and professional',
            format: 'Follow the selected content type and user instructions.'
          }
        : {};

      await sendCloudMessage(tool, prompt, options);
      input.value = '';
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send message';
    }
  };

  $('#copy').onclick = () => copyOut();
}

function aiForm(id, label, placeholder, tool = id) {
  cloudChatLayout(label, placeholder, tool);
}

function chat() {
  aiForm(
    'chat',
    'What would you like help with?',
    'Ask a question…',
    'chat'
  );
}

function writer() {
  const extra = `<div class="field">
    <label>Content type</label>
    <select id="kind">
      <option>Blog post</option>
      <option>Email</option>
      <option>Social media caption</option>
      <option>Product description</option>
      <option>Rewrite and improve</option>
      <option>Video script</option>
    </select>
  </div>`;

  cloudChatLayout(
    'Topic and instructions',
    'Describe your topic, audience, tone and key points…',
    'write',
    extra
  );
}

function translator() {
  body.innerHTML =
    `<div class="field">
      <label>Translate to</label>
      <select id="lang">
        <option>English</option>
        <option>Hindi</option>
        <option>Spanish</option>
        <option>French</option>
        <option>German</option>
        <option>Arabic</option>
        <option>Japanese</option>
        <option>Chinese (Simplified)</option>
      </select>
    </div>` +
    area('Text to translate', 'input') +
    actions(
      button('Translate', 'go') +
      button('Copy translation', 'copy', 'secondary')
    ) +
    result();

  $('#go').onclick = async () => {
    const text = $('#input').value.trim();
    if (!text) return toast('Enter text to translate');

    $('#go').disabled = true;

    try {
      const d = await callApi('translate', {
        prompt: text,
        targetLanguage: $('#lang').value,
        sourceLanguage: 'auto-detect'
      });

      $('#out').textContent = d.result || 'No translation returned.';
    } catch (e) {
      $('#out').textContent = e.message;
    } finally {
      $('#go').disabled = false;
    }
  };

  $('#copy').onclick = () => copyOut();
}

function code() {
  aiForm(
    'code',
    'Describe the code task',
    'Paste code or describe what you want to build. Include language and error message if debugging.',
    'code'
  );
}

function image() {
  body.innerHTML =
    area('Describe the image', 'input', 'A cinematic mountain landscape at sunrise…') +
    actions(
      button('Generate image', 'go') +
      button('Copy prompt', 'copy', 'secondary')
    ) +
    result() +
    '<p class="hint">Generates a JPEG image using the connected Cloudflare image model. Generation counts toward the shared daily limit.</p>';

  $('#go').onclick = async () => {
    const prompt = $('#input').value.trim();
    if (!prompt) return toast('Please describe the image');

    $('#go').disabled = true;
    $('#go').textContent = 'Generating…';

    try {
      const d = await callApi('image', { prompt });
      if (!d.imageBase64) throw Error('Image data was not returned');

      const raw = atob(d.imageBase64);
      const bytes = new Uint8Array(raw.length);

      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: d.mimeType || 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      $('#out').innerHTML = '';

      const im = document.createElement('img');
      im.src = url;
      im.style.maxWidth = '100%';
      im.style.borderRadius = '12px';
      im.alt = 'AI-generated image';
      $('#out').append(im);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'anaghaye-ai-image.jpg';
      a.textContent = 'Download image';
      a.style.display = 'inline-block';
      a.style.marginTop = '12px';
      $('#out').append(a);
    } catch (e) {
      $('#out').textContent = e.message;
    } finally {
      $('#go').disabled = false;
      $('#go').textContent = 'Generate image';
    }
  };

  $('#copy').onclick = () => copyOut();
}

function video() {
  body.innerHTML =
    `<div class="field">
      <label>Video format</label>
      <select id="format">
        <option>Short social video (30–60 sec)</option>
        <option>YouTube video</option>
        <option>Product advertisement</option>
        <option>Educational explainer</option>
        <option>Story / cinematic scene</option>
      </select>
    </div>` +
    area('Video idea', 'input', 'Describe the story, product or topic…') +
    actions(
      button('Build storyboard & prompts', 'go') +
      button('Copy result', 'copy', 'secondary')
    ) +
    result() +
    '<p class="hint">This creates a script and shot prompts, not a rendered video.</p>';

  $('#go').onclick = async () => {
    const v = $('#input').value.trim();
    if (!v) return toast('Describe your video idea');

    $('#go').disabled = true;

    try {
      $('#out').textContent = await api(
        'video',
        $('#format').value + '\n' + v
      );
    } catch (e) {
      $('#out').textContent = e.message;
    } finally {
      $('#go').disabled = false;
    }
  };

  $('#copy').onclick = () => copyOut();
}

function voice() {
  body.innerHTML =
    area('Text to read aloud', 'input', 'Type or paste text…') +
    `<div class="field">
      <label>Voice</label>
      <select id="voices"></select>
    </div>` +
    actions(
      button('Speak', 'speak') +
      button('Stop', 'stop', 'secondary')
    );

  const sel = $('#voices');

  function load() {
    sel.innerHTML = '';
    (speechSynthesis.getVoices() || []).forEach((v, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = v.name + ' (' + v.lang + ')';
      sel.append(o);
    });
  }

  load();
  speechSynthesis.onvoiceschanged = load;

  $('#speak').onclick = () => {
    const u = new SpeechSynthesisUtterance($('#input').value);
    u.voice = speechSynthesis.getVoices()[+sel.value] || null;
    speechSynthesis.speak(u);
  };

  $('#stop').onclick = () => speechSynthesis.cancel();
}

function pdf() {
  body.innerHTML =
    `<div class="field">
      <label for="file">Choose a PDF</label>
      <input id="file" type="file" accept="application/pdf">
    </div>` +
    actions(
      button('Extract PDF text', 'extract') +
      button('Summarize extracted text', 'sum', 'secondary')
    ) +
    result() +
    '<p class="hint">PDF text extraction uses PDF.js. Scanned image-only PDFs need OCR, which is not included.</p>';

  $('#extract').onclick = async () => {
    const f = $('#file').files[0];
    if (!f) return toast('Choose a PDF first');

    try {
      const buf = await f.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(x => x.str).join(' ') + '\n';
      }

      $('#out').textContent = text || 'No selectable text found.';
      window.pdfText = text;
    } catch (e) {
      $('#out').textContent = 'PDF extraction failed: ' + e.message;
    }
  };

  $('#sum').onclick = async () => {
    if (!window.pdfText) return toast('Extract PDF text first');

    try {
      $('#out').textContent = await api('summarize', window.pdfText);
    } catch (e) {
      $('#out').textContent = e.message;
    }
  };
}
  $('#extract').onclick = async () => {
    const f = $('#file').files[0];
    if (!f) return toast('Choose a PDF first');

    try {
      const lib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

      const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
      let txt = '';

      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const c = await p.getTextContent();
        txt += c.items.map(x => x.str).join(' ') + '\n';
      }

      window.pdfText = txt;
      $('#out').textContent = txt || 'No selectable text found in this PDF.';
    } catch (e) {
      $('#out').textContent = 'Could not read PDF: ' + e.message;
    }
  };

  $('#sum').onclick = async () => {
    if (!window.pdfText) return toast('Extract text first');

    try {
      $('#out').textContent = await api(
        'summarize',
        'Summarize this PDF text with key points:\n' + window.pdfText.slice(0, 25000)
      );
    } catch (e) {
      $('#out').textContent = e.message;
    }
  };
}

function word() {
  body.innerHTML = area('Your text', 'input') + result();

  $('#input').oninput = () => {
    const t = $('#input').value;
    const w = t.trim() ? t.trim().split(/\s+/).length : 0;

    $('#out').textContent =
      `Words: ${w}\n` +
      `Characters: ${t.length}\n` +
      `Characters (no spaces): ${t.replace(/\s/g, '').length}\n` +
      `Sentences: ${(t.match(/[.!?]+/g) || []).length}\n` +
      `Lines: ${t ? t.split(/\n/).length : 0}`;
  };
}

function caseTool() {
  body.innerHTML =
    area('Your text', 'input') +
    actions(
      button('UPPERCASE', 'up') +
      button('lowercase', 'low', 'secondary') +
      button('Title Case', 'title', 'secondary') +
      button('Sentence case', 'sentence', 'secondary')
    ) +
    result();

  const t = () => $('#input').value;

  $('#up').onclick = () => $('#out').textContent = t().toUpperCase();
  $('#low').onclick = () => $('#out').textContent = t().toLowerCase();

  $('#title').onclick = () => {
    $('#out').textContent = t().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };

  $('#sentence').onclick = () => {
    $('#out').textContent = t().toLowerCase().replace(
      /(^\s*|[.!?]\s+)([a-z])/g,
      (m, a, b) => a + b.toUpperCase()
    );
  };
}

function clean() {
  body.innerHTML =
    area('Text to clean', 'input') +
    actions(button('Clean text', 'go')) +
    result();

  $('#go').onclick = () => {
    $('#out').textContent = $('#input').value
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
}

function reverse() {
  body.innerHTML =
    area('Text', 'input') +
    actions(
      button('Reverse characters', 'chars') +
      button('Reverse words', 'words', 'secondary')
    ) +
    result();

  $('#chars').onclick = () => {
    $('#out').textContent = [...$('#input').value].reverse().join('');
  };

  $('#words').onclick = () => {
    $('#out').textContent = $('#input').value.trim().split(/\s+/).reverse().join(' ');
  };
}

function frequency() {
  body.innerHTML =
    area('Text', 'input') +
    actions(button('Analyse', 'go')) +
    result();

  $('#go').onclick = () => {
    const m = $('#input').value.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
    const c = {};

    m.forEach(w => c[w] = (c[w] || 0) + 1);

    $('#out').textContent = Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([w, n]) => `${w}: ${n}`)
      .join('\n') || 'Enter some text.';
  };
}

function percentage() {
  body.innerHTML =
    field('Percentage', 'p', 'e.g. 15', 'number') +
    field('Number', 'n', 'e.g. 200', 'number') +
    actions(button('Calculate', 'go')) +
    result();

  $('#go').onclick = () => {
    $('#out').textContent = ($('#p').value * $('#n').value / 100).toLocaleString();
  };
}

function age() {
  body.innerHTML =
    field('Date of birth', 'dob', '', 'date') +
    actions(button('Calculate age', 'go')) +
    result();

  $('#go').onclick = () => {
    const d = new Date($('#dob').value);
    const n = new Date();

    if (!$('#dob').value || d > n) {
      return $('#out').textContent = 'Enter a valid past date.';
    }

    let y = n.getFullYear() - d.getFullYear();
    let m = n.getMonth() - d.getMonth();
    let day = n.getDate() - d.getDate();

    if (day < 0) {
      m--;
      day += new Date(n.getFullYear(), n.getMonth(), 0).getDate();
    }

    if (m < 0) {
      y--;
      m += 12;
    }

    $('#out').textContent = `${y} years, ${m} months, ${day} days`;
  };
}

function bmi() {
  body.innerHTML =
    field('Weight (kg)', 'kg', 'e.g. 65', 'number') +
    field('Height (cm)', 'cm', 'e.g. 165', 'number') +
    actions(button('Calculate BMI', 'go')) +
    result() +
    '<p class="hint">BMI is a screening measure, not a diagnosis.</p>';

  $('#go').onclick = () => {
    const kg = +$('#kg').value;
    const m = +$('#cm').value / 100;
    const b = kg / (m * m);

    $('#out').textContent =
      kg > 0 && m > 0 ? `BMI: ${b.toFixed(1)}` : 'Enter valid height and weight.';
  };
}

function resume() {
  body.innerHTML =
    field('Full name', 'name', 'Your name') +
    field('Email', 'email', 'you@example.com', 'email') +
    field('Phone', 'phone', 'Phone number') +
    area('Professional summary', 'summary') +
    area('Skills', 'skills', 'Separate skills with commas') +
    area('Experience / Education', 'exp', 'Add your experience and education') +
    actions(button('Preview & print / save PDF', 'go')) +
    result();

  $('#go').onclick = () => {
    const v =
      `${$('#name').value}\n` +
      `${$('#email').value} | ${$('#phone').value}\n\n` +
      `SUMMARY\n${$('#summary').value}\n\n` +
      `SKILLS\n${$('#skills').value}\n\n` +
      `EXPERIENCE & EDUCATION\n${$('#exp').value}`;

    $('#out').textContent = v;

    const w = window.open('', '_blank');

    if (w) {
      w.document.write(
        '<pre style="font:14px Arial;white-space:pre-wrap;margin:40px">' +
        v.replace(/[&<>]/g, c => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;'
        }[c])) +
        '</pre>'
      );

      w.document.close();
      w.print();
    }
  };
}

function seo() {
  body.innerHTML =
    field('Page topic', 'topic', 'e.g. Best budget travel backpacks') +
    field('SEO title', 'title', 'Keep it concise') +
    area('Meta description', 'desc') +
    actions(button('Count & review', 'go')) +
    result();

  $('#go').onclick = () => {
    $('#out').textContent =
      `Title length: ${$('#title').value.length} characters\n` +
      `Description length: ${$('#desc').value.length} characters\n\n` +
      'Tip: Write a clear, accurate title and a useful description. Avoid keyword stuffing.';
  };
}

function caption() {
  body.innerHTML =
    area('Describe your post', 'input', 'What is the post about? Who is it for?') +
    actions(
      button('Create caption with AI', 'go') +
      button('Copy result', 'copy', 'secondary')
    ) +
    result();

  $('#go').onclick = async () => {
    const v = $('#input').value.trim();
    if (!v) return toast('Describe your post first');

    $('#go').disabled = true;

    try {
      $('#out').textContent = await api(
        'caption',
        v + '\nWrite 3 caption options and relevant hashtags.'
      );
    } catch (e) {
      $('#out').textContent = e.message;
    } finally {
      $('#go').disabled = false;
    }
  };

  $('#copy').onclick = () => copyOut();
}

function prompt() {
  body.innerHTML =
    `<div class="field">
      <label>Prompt type</label>
      <select id="ptype">
        <option>Image generation</option>
        <option>Video generation</option>
        <option>AI chat / research</option>
      </select>
    </div>` +
    area('Your rough idea', 'input') +
    actions(
      button('Structure prompt', 'go') +
      button('Copy result', 'copy', 'secondary')
    ) +
    result();

  $('#go').onclick = () => {
    $('#out').textContent =
      `Goal: ${$('#ptype').value}\n` +
      `Subject / task: ${$('#input').value}\n` +
      'Style and tone: Specify the desired visual or writing style.\n' +
      'Details: Include setting, composition, audience, constraints and important details.\n' +
      'Output: State the exact format, length, aspect ratio or structure required.';
  };

  $('#copy').onclick = () => copyOut();
}
