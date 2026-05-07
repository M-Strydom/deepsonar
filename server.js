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

// 6 roles in fixed turn order
const ROLE_ORDER = ['captain','engineer','sonar','weapons','firefighter','comms'];

// Assign roles fairly - captain always guaranteed, others distributed evenly
function assignRoles(crew) {
  if (crew.length === 0) return [];
  const supporting = ['engineer','sonar','weapons','firefighter','comms'].sort(() => Math.random() - 0.5);
  const shuffled = [...crew].sort(() => Math.random() - 0.5);
  const stacks = shuffled.map(() => []);
  stacks[0].push('captain');
  supporting.forEach((role, i) => { stacks[(i + 1) % shuffled.length].push(role); });
  // Shadow players: if more players than roles, mark extras as shadows
  return shuffled.map((name, i) => ({ name, roles: stacks[i], isShadow: stacks[i].length === 0 }));
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
      if (!r) { ws.send(JSON.stringify({ type: 'error', msg: 'Room not found.' })); return; }
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

      const shuffled = [...names].sort(() => Math.random() - 0.5);
      const half = Math.ceil(shuffled.length / 2);
      const crewA = shuffled.slice(0, half);
      const crewB = shuffled.slice(half);

      const s = r.settings;
      const size = s.size;
      function randPos() { return { r: Math.floor(Math.random()*size), c: Math.floor(Math.random()*size) }; }
      function makeGrid() { return Array(size).fill(null).map(() => Array(size).fill(0)); }

      function makeCrew(hp, pos) {
        return {
          hp, maxHp: s.hp, pos: {...pos}, trail: [{...pos}],
          charge: 0, sonarFix: false, decoyUsed: false,
          targetHits: makeGrid(), fireApproved: false, weaponsArmed: false,
          goSilent: false, commsCharge: 0, commsOption: null,
          damage: null, // active fire/damage event
          currentTurnRole: 'captain', // fixed turn order
          roundNum: 1
        };
      }

      const posA = randPos(), posB = randPos();
      const state = {
        size, nameA: s.nameA, nameB: s.nameB, maxHp: s.hp,
        A: makeCrew(s.hp, posA),
        B: makeCrew(s.hp, posB),
        players: { A: assignRoles(crewA), B: assignRoles(crewB) },
        log: ['Mission commenced. Find and sink the enemy.'],
        lastHeadingCrew: null
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
      broadcast(room, { type: 'sonar_ping', heading: msg.heading, crew: msg.crew, silent: msg.silent }, ws);
      return;
    }

    if (type === 'sector_ping') {
      if (!rooms[room]) return;
      // notify enemy sonar that sector ping was used
      broadcast(room, { type: 'sector_ping_alert', crew: msg.crew }, ws);
      return;
    }

    if (type === 'damage_alert') {
      if (!rooms[room]) return;
      broadcastAll(room, { type: 'damage_alert', crew: msg.crew });
      return;
    }

    if (type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
  });

  ws.on('close', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    rooms[currentRoom].clients.delete(ws);
    if (rooms[currentRoom].clients.size === 0) {
      setTimeout(() => { if (rooms[currentRoom] && rooms[currentRoom].clients.size === 0) delete rooms[currentRoom]; }, 30 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => console.log('Deep Sonar on port ' + PORT));
