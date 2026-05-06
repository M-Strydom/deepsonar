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
const rooms = {};

function broadcastAll(code, msg) {
  if (!rooms[code]) return;
  const data = JSON.stringify(msg);
  rooms[code].clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

function broadcast(code, msg, excludeWs) {
  if (!rooms[code]) return;
  const data = JSON.stringify(msg);
  rooms[code].clients.forEach(c => { if (c !== excludeWs && c.readyState === 1) c.send(data); });
}

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, room } = msg;

    if (type === 'host_create') {
      const code = Math.random().toString(36).substring(2, 7).toUpperCase();
      rooms[code] = { settings: msg.settings, lobby: [], state: null, clients: new Set([ws]), hostWs: ws };
      currentRoom = code;
      ws.send(JSON.stringify({ type: 'hosted', code }));
      return;
    }

    if (type === 'join') {
      const r = rooms[room];
      if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found. Check the code.' })); return; }
      if (r.state) { ws.send(JSON.stringify({ type: 'error', msg: 'Game already started.' })); return; }
      const name = (msg.name || 'Player').trim();
      r.lobby.push({ name });
      r.clients.add(ws);
      currentRoom = room;
      ws.send(JSON.stringify({ type: 'joined', name }));
      broadcastAll(room, { type: 'lobby_update', lobby: r.lobby });
      return;
    }

    if (type === 'start_game') {
      const r = rooms[room];
      if (!r || ws !== r.hostWs) return;
      const names = r.lobby.map(p => p.name);
      if (names.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Need at least 2 players.' })); return; }

      // shuffle
      for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
      }

      const half = Math.ceil(names.length / 2);
      const crewA = names.slice(0, half);
      const crewB = names.slice(half);

      const ROLES = ['captain','navigator','engineer','weapons','sonar','comms','damage','decoy'];
      function assignRoles(crew) {
        const roles = [...ROLES].sort(() => Math.random() - 0.5);
        return crew.map((name, i) => ({ name, role: roles[i % roles.length] }));
      }

      const s = r.settings;
      const size = s.size;
      function randPos() { return { r: Math.floor(Math.random()*size), c: Math.floor(Math.random()*size) }; }
      function makeGrid() { return Array(size).fill(null).map(() => Array(size).fill(0)); }

      const posA = randPos(), posB = randPos();
      const state = {
        size, nameA: s.nameA, nameB: s.nameB, maxHp: s.hp,
        turn: 1, phase: 'move', activeCrew: 'A',
        A: { hp: s.hp, pos: {...posA}, trail: [{...posA}], charge: 0, sonarFix: false, decoyUsed: false, targetHits: makeGrid(), fireApproved: false },
        B: { hp: s.hp, pos: {...posB}, trail: [{...posB}], charge: 0, sonarFix: false, decoyUsed: false, targetHits: makeGrid(), fireApproved: false },
        players: { A: assignRoles(crewA), B: assignRoles(crewB) },
        rolesReady: { A: {}, B: {} },
        log: ['Game started! ' + s.nameA + ' vs ' + s.nameB + '. Good luck.'],
        lastHeading: null, lastHeadingCrew: null, engineQ: null
      };

      r.state = state;
      broadcastAll(room, { type: 'game_started', state });
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
      broadcast(room, { type: 'sonar_ping', heading: msg.heading, crew: msg.crew }, ws);
      return;
    }

    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    rooms[currentRoom].clients.delete(ws);
    if (rooms[currentRoom].clients.size === 0) {
      setTimeout(() => {
        if (rooms[currentRoom] && rooms[currentRoom].clients.size === 0) delete rooms[currentRoom];
      }, 30 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => console.log('Deep Sonar running on port ' + PORT));
