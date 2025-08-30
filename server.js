const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'turtle23secret',
  resave: false,
  saveUninitialized: true
}));

// SQLite setup
const db = new sqlite3.Database('users.db', (err) => {
  if (err) console.error('Database error:', err.message);
  else console.log('Connected to SQLite database.');
});

// Create tables
const tableQueries = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    is_group INTEGER,
    title TEXT,
    created_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
    conversation_id INTEGER,
    username TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    sender TEXT,
    content_encrypted TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`
];
tableQueries.forEach(query => db.run(query));

// Auth middleware
function requireLogin(req, res, next) {
  if (!req.session.username) return res.redirect('/error.html');
  next();
}

// Public routes
const publicPages = [
  'login.html',
  'register.html',
  'error.html',
  'registryCompleted.html',
  'loginCompleted.html',
  'index.html',
  'UserInterface.html'
];
publicPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', page));
  });
});

// Protected routes
const protectedPages = [
  'TurtleResourcePack.html',
  'CentrumInformacyjne.html',
  'BialaLista.html',
  'BlogStanMara.html'
];
protectedPages.forEach(page => {
  app.get(`/${page}`, requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', page));
  });
});

// API routes
app.get('/current-user', (req, res) => {
  res.json({ username: req.session.username || null });
});

app.post('/register', async (req, res) => {
  const { username, password1, password2 } = req.body;

  if (!username || !password1 || !password2) {
    return res.json({ success: false, message: 'All fields are required.' });
  }

  const usernameRegex = /^[a-zA-Z0-9 ]{1,17}$/;
  if (!usernameRegex.test(username)) {
    return res.json({ success: false, message: 'Invalid username format.' });
  }

  if (password1 !== password2) {
    return res.json({ success: false, message: 'Passwords do not match!' });
  }

  if (password1.length < 8) {
    return res.json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  const hashedPassword = await bcrypt.hash(password1, 10);
  db.run(`INSERT INTO users(username, password) VALUES (?, ?)`, [username, hashedPassword], function (err) {
    if (err) {
      return res.json({ success: false, message: 'User already exists or error occurred.' });
    }
    res.json({ success: true, redirect: '/registryCompleted.html' });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err || !row) {
      return res.json({ success: false, message: 'Invalid username or password.' });
    }

    const match = await bcrypt.compare(password, row.password);
    if (match) {
      req.session.username = username;
      res.json({ success: true, redirect: '/loginCompleted.html' });
    } else {
      res.json({ success: false, message: 'Invalid username or password.' });
    }
  });
});

app.post('/verify-password', (req, res) => {
  const { password } = req.body;
  const username = req.session.username;

  db.get(`SELECT password FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err || !row) return res.json({ valid: false });

    const match = await bcrypt.compare(password, row.password);
    res.json({ valid: match });
  });
});

app.post('/update-password', async (req, res) => {
  const { newPassword } = req.body;
  const username = req.session.username;

  if (!newPassword || newPassword.length < 8) {
    return res.json({ success: false, message: 'Password too short.' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  db.run(`UPDATE users SET password = ? WHERE username = ?`, [hashed, username], function (err) {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

app.delete('/delete-account', (req, res) => {
  const username = req.session.username;

  db.run(`DELETE FROM users WHERE username = ?`, [username], function (err) {
    if (err) return res.json({ success: false });

    req.session.destroy(() => {
      res.json({ success: true });
    });
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

/* =========================
   Chat API
========================= */

// Create conversation
app.post('/api/chat/conversations', requireLogin, (req, res) => {
  const { is_group, title, participants } = req.body;
  const createdBy = req.session.username;

  const list = Array.isArray(participants) ? participants : [];
  const allParticipants = Array.from(new Set([...list, createdBy]));

  db.run(
    `INSERT INTO conversations (is_group, title, created_by) VALUES (?, ?, ?)`,
    [is_group ? 1 : 0, title || null, createdBy],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const convoId = this.lastID;
      const stmt = db.prepare(`INSERT INTO participants (conversation_id, username) VALUES (?, ?)`);

      allParticipants.forEach(username => stmt.run(convoId, username));
      stmt.finalize();

      res.json({ id: convoId, title: title || null, is_group: !!is_group });
    }
  );
});

// List conversations for current user (includes global)
app.get('/api/chat/conversations', requireLogin, (req, res) => {
  const username = req.session.username;

  db.all(
    `
    SELECT
      c.id,
      c.is_group,
      c.title,
      (SELECT p2.username FROM participants p2 WHERE p2.conversation_id = c.id AND p2.username != ? LIMIT 1) AS peerUsername,
      (SELECT m.content_encrypted FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC LIMIT 1) AS lastMessageEncrypted
    FROM conversations c
    JOIN participants p ON c.id = p.conversation_id
    WHERE p.username = ?
    ORDER BY c.id DESC
    `,
    [username, username],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      const mapped = rows.map(r => ({
        id: r.id,
        is_group: !!r.is_group,
        title: r.title,
        peerUsername: r.peerUsername || null,
        lastMessagePreview: r.lastMessageEncrypted ? '[encrypted]' : null
      }));

      const globalConversation = {
        id: 'global',
        is_group: true,
        title: 'Globalna rozmowa',
        peerUsername: null,
        lastMessagePreview: '[global chat]'
      };

      res.json([globalConversation, ...mapped]);
    }
  );
});

// Get messages for global conversation
app.get('/api/chat/global/messages', requireLogin, (req, res) => {
  db.all(
    `SELECT * FROM messages WHERE conversation_id IS NULL ORDER BY timestamp ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Send message to global conversation
app.post('/api/chat/global/messages', requireLogin, (req, res) => {
  const sender = req.session.username;
  const { content_encrypted } = req.body;

  if (!content_encrypted) {
    return res.status(400).json({ error: 'Missing content_encrypted' });
  }

  db.run(
    `INSERT INTO messages (conversation_id, sender, content_encrypted) VALUES (NULL, ?, ?)`,
    [sender, JSON.stringify(content_encrypted)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// Get messages for a regular conversation
app.get('/api/chat/conversations/:id/messages', requireLogin, (req, res) => {
  const convoId = Number(req.params.id);
  const username = req.session.username;

  db.get(
    `SELECT 1 FROM participants WHERE conversation_id = ? AND username = ? LIMIT 1`,
    [convoId, username],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(403).json({ error: 'Not a participant' });

      db.all(
        `SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC`,
        [convoId],
        (err2, rows) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json(rows);
        }
      );
    }
  );
});

// Send message to a regular conversation
app.post('/api/chat/conversations/:id/messages', requireLogin, (req, res) => {
  const convoId = Number(req.params.id);
  const sender = req.session.username;
  const { content_encrypted } = req.body;

  if (!content_encrypted) {
    return res.status(400).json({ error: 'Missing content_encrypted' });
  }

  db.get(
    `SELECT 1 FROM participants WHERE conversation_id = ? AND username = ? LIMIT 1`,
    [convoId, sender],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(403).json({ error: 'Not a participant' });

      db.run(
        `INSERT INTO messages (conversation_id, sender, content_encrypted) VALUES (?, ?, ?)`,
        [convoId, sender, JSON.stringify(content_encrypted)],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, id: this.lastID });
        }
      );
    }
  );
});

// Delete conversation (only creator)
app.delete('/api/chat/conversations/:id', requireLogin, (req, res) => {
  const convoId = Number(req.params.id);
  const username = req.session.username;

  db.get(`SELECT created_by FROM conversations WHERE id = ?`, [convoId], (err, convo) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    if (convo.created_by !== username) {
      return res.status(403).json({ error: 'Only the creator can delete this conversation' });
    }

    db.run(`DELETE FROM messages WHERE conversation_id = ?`, [convoId], function (err1) {
      if (err1) return res.status(500).json({ error: err1.message });

      db.run(`DELETE FROM participants WHERE conversation_id = ?`, [convoId], function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });

        db.run(`DELETE FROM conversations WHERE id = ?`, [convoId], function (err3) {
          if (err3) return res.status(500).json({ error: err3.message });

          res.json({ success: true });
        });
      });
    });
  });
});

/* =========================
   Socket.IO
========================= */

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('chat:join', ({ conversation_id }) => {
    const room = conversation_id === 'global' ? 'global_room' : `convo_${conversation_id}`;
    socket.join(room);
  });

  socket.on('chat:send', ({ conversation_id, content_encrypted, sender }) => {
    const room = conversation_id === 'global' ? 'global_room' : `convo_${conversation_id}`;
    const convoId = conversation_id === 'global' ? null : conversation_id;

    db.run(
      `INSERT INTO messages (conversation_id, sender, content_encrypted) VALUES (?, ?, ?)`,
      [convoId, sender, JSON.stringify(content_encrypted)],
      function (err) {
        if (err) {
          console.error('Message insert error:', err.message);
          return;
        }

        io.to(room).emit('chat:message', {
          id: this.lastID,
          conversation_id,
          sender,
          content_encrypted,
          timestamp: new Date().toISOString()
        });
      }
    );
  });

  socket.on('disconnect', () => {
    // Optional: handle presence
  });
});

/* =========================
   Start server
========================= */

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
