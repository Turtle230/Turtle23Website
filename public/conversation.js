document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOM załadowany');

  const qs = new URLSearchParams(location.search);
  const convoId = qs.get('convoId');
  const convoTitle = qs.get('title');

  const chatTitleEl = document.getElementById('chatTitle');
  const messageListEl = document.getElementById('message-list');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const backBtn = document.getElementById('backBtn');
  const deleteBtn = document.getElementById('deleteBtn');

  let currentUsername = null;
  let socket;
  const renderedMessageIds = new Set(); // 🔒 zapamiętujemy wiadomości

  try {
    socket = io();
    console.log('🔌 Socket.IO połączony');
  } catch (err) {
    console.warn('⚠️ Socket.IO niedostępny — tryb offline', err);
    socket = { emit() {}, on() {}, off() {} };
  }

  if (convoTitle && chatTitleEl) {
    chatTitleEl.textContent = decodeURIComponent(convoTitle);
  }

  if (convoId === 'global') {
    deleteBtn.style.display = 'none';
  }

  function scrollToBottom() {
    messageListEl.scrollTop = messageListEl.scrollHeight;
  }

  function generateMessageId(sender, timestamp, plaintext) {
    return `${sender}-${timestamp}-${plaintext}`;
  }

  function renderMessage({ sender, plaintext, timestamp }) {
    const id = generateMessageId(sender, timestamp, plaintext);
    if (renderedMessageIds.has(id)) return;
    renderedMessageIds.add(id);

    const wrapper = document.createElement('div');
    wrapper.className = 'msg ' + (sender === currentUsername ? 'me' : 'them');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = `<strong>${sender}</strong><br>${plaintext}`;

    if (timestamp) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = new Date(timestamp).toLocaleString();
      bubble.appendChild(meta);
    }

    wrapper.appendChild(bubble);
    messageListEl.appendChild(wrapper);
  }

  function decodePayload(raw) {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return obj?.ct || '[encrypted]';
    } catch {
      return '[encrypted]';
    }
  }

  async function boot() {
    try {
      const res = await fetch('/current-user');
      const me = await res.json();
      currentUsername = me.username;

      if (!currentUsername) {
        location.href = '/error.html';
        return;
      }

      socket.emit('chat:join', { conversation_id: convoId });

      const historyRes = await fetch(
        convoId === 'global'
          ? '/api/chat/global/messages'
          : `/api/chat/conversations/${convoId}/messages`
      );

      if (!historyRes.ok) {
        alert('Nie można załadować wiadomości.');
        return;
      }

      const messages = await historyRes.json();
      messageListEl.innerHTML = '';
      renderedMessageIds.clear(); // 🔄 resetujemy pamięć wiadomości

      if (messages.length === 0) {
        messageListEl.innerHTML = '<p style="color:#aaa;">Brak wiadomości w tej rozmowie.</p>';
      } else {
        messages.forEach(m => {
          renderMessage({
            sender: m.sender,
            plaintext: decodePayload(m.content_encrypted),
            timestamp: m.timestamp
          });
        });
      }

      scrollToBottom();
    } catch (err) {
      console.error('Błąd inicjalizacji:', err);
      alert('Wystąpił błąd podczas ładowania rozmowy.');
    }
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    const encrypted = { iv: [1, 2, 3], ct: text };

    try {
      await fetch(
        convoId === 'global'
          ? '/api/chat/global/messages'
          : `/api/chat/conversations/${convoId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_encrypted: encrypted })
        }
      );

      socket.emit('chat:send', {
        conversation_id: convoId,
        content_encrypted: encrypted,
        sender: currentUsername,
        timestamp: Date.now() // ⏱️ dodajemy timestamp
      });

      inputEl.value = '';
    } catch (err) {
      console.error('Błąd wysyłania wiadomości:', err);
      alert('Nie udało się wysłać wiadomości.');
    }
  }

  socket.on('chat:message', msg => {
    if (msg.conversation_id !== convoId) return;

    renderMessage({
      sender: msg.sender,
      plaintext: decodePayload(msg.content_encrypted),
      timestamp: msg.timestamp
    });

    scrollToBottom();
  });

  backBtn?.addEventListener('click', () => {
    location.href = 'OnlineChat.html';
  });

  deleteBtn?.addEventListener('click', async () => {
    const confirmed = confirm('Czy na pewno chcesz usunąć tę rozmowę?');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/chat/conversations/${convoId}`, { method: 'DELETE' });
      if (res.ok) {
        alert('Rozmowa została usunięta.');
        location.href = 'OnlineChat.html';
      } else {
        alert('Nie udało się usunąć rozmowy.');
      }
    } catch (err) {
      console.error('Błąd usuwania rozmowy:', err);
      alert('Wystąpił błąd.');
    }
  });

  sendBtn?.addEventListener('click', sendMessage);
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
  });

  boot();
});
