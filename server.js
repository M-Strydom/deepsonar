const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server });

// rooms[roomCode] = { state: {}, clients: Set<ws> }
const rooms = {};

function broadcast(room, msg, excludeWs = null) {
  if (!rooms[room]) return;
  const data = JSON.stringify(msg);
  rooms[room].clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(data);
    }
  });
}

function broadcastAll(room, msg) {
  if (!rooms[room]) return;
  const data = JSON.stringify(msg);
  rooms[room].clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, room, state, role, crew, heading } = msg;

    if (type === 'host_create') {
      const code = Math.random().toString(36).substring(2, 7).toUpperCase();
      rooms[code] = { state: msg.state, clients: new Set([ws]) };
      currentRoom = code;
      ws.send(JSON.stringify({ type: 'hosted', code, state: msg.state }));
      return;
    }

    if (type === 'join') {
      if (!rooms[room]) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found. Check the code.' })); return; }
      rooms[room].clients.add(ws);
      currentRoom = room;
      ws.send(JSON.stringify({ type: 'joined', state: rooms[room].state }));
      return;
    }

    if (type === 'state_update') {
      if (!rooms[room]) return;
      rooms[room].state = msg.state;
      broadcast(room, { type: 'state_update', state: msg.state }, ws);
      return;
    }

    if (type === 'sonar_ping') {
      if (!rooms[room]) return;
      broadcast(room, { type: 'sonar_ping', heading, crew }, ws);
      return;
    }

    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
  });

  ws.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].clients.delete(ws);
      if (rooms[currentRoom].clients.size === 0) {
        setTimeout(() => {
          if (rooms[currentRoom] && rooms[currentRoom].clients.size === 0) {
            delete rooms[currentRoom];
          }
        }, 1000 * 60 * 30);
      }
    }
  });
});

server.listen(PORT, () => console.log('Deep Sonar running on port ' + PORT));
