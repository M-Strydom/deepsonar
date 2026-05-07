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
  } else { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocketServer({ server });
const rooms = {};

const ROLE_ORDER = ['captain','engineer','sonar','weapons','firefighter','comms'];

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

function assignRoles(crew) {
  if (crew.length === 0) return [];
  const supporting = ['engineer','sonar','weapons','firefighter','comms'].sort(() => Math.random() - 0.5);
  const shuffled = [...crew].sort(() => Math.random() - 0.5);
  // Determine how many real role slots exist (6 total: 1 captain + 5 supporting)
  const totalRoles = 6;
  const stacks = shuffled.map(() => []);
  stacks[0].push('captain');
  supporting.forEach((role, i) => { stacks[(i + 1) % shuffled.length].push(role); });
  return shuffled.map((name, i) => ({
    name,
    roles: stacks[i].sort((a,b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)),
    isShadow: stacks[i].length === 0
  }));
}

function getSector(pos, size) {
  const half = Math.floor(size / 2);
  if (pos.r < half && pos.c < half) return 'A';
  if (pos.r < half && pos.c >= half) return 'B';
  if (pos.r >= half && pos.c < half) return 'C';
  return 'D';
}

function isAdjacent(pos, target) {
  const dr = Math.abs(pos.r - target.r);
  const dc = Math.abs(pos.c - target.c);
  return (dr <= 1 && dc <= 1) && !(dr === 0 && dc === 0);
}

function makeGrid(size) { return Array(size).fill(null).map(() => Array(size).fill(0)); }
function randPos(size) { return { r: Math.floor(Math.random()*size), c: Math.floor(Math.random()*size) }; }

function makeCrew(hp, pos) {
  return {
    hp, pos: {...pos}, trail: [{...pos}],
    charge: 0, sonarFix: false, sonarCoords: null,
    weaponsArmed: false, fireApproved: false, pendingFireCell: null, weapChargeAttempted: false,
    decoyUsed: false, goSilent: false,
    commsCharge: 0, commsOption: null, commsActive: null,
    damage: null, maintenancePuzzle: null,
    surfacing: false, surfaceChallenges: {}, surfaceSecondsLeft: 30,
    currentTurnRole: 'captain', roundNum: 1,
    roundDone: {}
  };
}

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const { type, room } = msg;

    if (type === 'host_create') {
      const code = Math.random().toString(36).substring(2,7).toUpperCase();
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
      const s = r.settings;
      let names = r.lobby.map(p => p.name);
      // host opts in as player
      if (s.hostJoins && s.hostName) names = [s.hostName, ...names];
      if (names.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Need at least 2 players.' })); return; }
      const shuffled = [...names].sort(() => Math.random() - 0.5);
      const half = Math.ceil(shuffled.length / 2);
      // role assignment respecting host preference
      function assignWithPref(crew) {
        if (!crew.length) return [];
        const sc = [...crew].sort(() => Math.random() - 0.5);
        const hostPref = s.hostJoins && s.hostName && s.hostRole !== 'random' ? s.hostRole : null;
        const hostIdx = hostPref ? sc.indexOf(s.hostName) : -1;
        if (hostIdx > 0 && hostPref === 'captain') [sc[0], sc[hostIdx]] = [sc[hostIdx], sc[0]];

        // Build complete role list: captain first, then 5 supporting roles shuffled
        const supporting = ['engineer','sonar','weapons','firefighter','comms'].sort(() => Math.random() - 0.5);
        const allRoles = ['captain', ...supporting]; // always exactly 6 roles

        // Handle host role preference
        if (hostIdx >= 0 && hostPref && hostPref !== 'random') {
          const hi = allRoles.indexOf(hostPref);
          if (hi > -1) {
            // swap so host's preferred role lands on their index
            const realIdx = sc.indexOf(s.hostName);
            // find which role is currently at realIdx position and swap
            const roleAtSlot = allRoles[realIdx] || allRoles[hi];
            allRoles[hi] = roleAtSlot;
            allRoles[realIdx] = hostPref;
          }
        }

        // Distribute: if more players than roles, extras shadow
        // If fewer players than roles, stack extras onto players round-robin starting slot 0
        const stacks = sc.map(() => []);
        allRoles.forEach((role, i) => {
          stacks[i % sc.length].push(role);
        });

        // Sort each stack by ROLE_ORDER and ensure no empty stacks
        return sc.map((name, i) => ({
          name,
          roles: stacks[i].sort((a,b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b)),
          isShadow: stacks[i].length === 0
        }));
      }
      const posA = randPos(s.size), posB = randPos(s.size);
      const state = {
        size: s.size, nameA: s.nameA, nameB: s.nameB, maxHp: s.hp,
        A: makeCrew(s.hp, posA),
        B: makeCrew(s.hp, posB),
        players: { A: assignWithPref(shuffled.slice(0, half)), B: assignWithPref(shuffled.slice(half)) },
        log: ['Mission commenced. Find and sink the enemy.'],
        targetGridA: makeGrid(s.size),
        targetGridB: makeGrid(s.size)
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

    // Server-side torpedo resolution — ensures both sides see hit/damage
    if (type === 'fire_torpedo') {
      const r = rooms[room];
      if (!r || !r.state) return;
      const { firingCrew, row, col } = msg;
      const state = r.state;
      const opp = firingCrew === 'A' ? 'B' : 'A';
      const oppCrew = state[opp];
      const targetGrid = firingCrew === 'A' ? state.targetGridA : state.targetGridB;

      const directHit = oppCrew.pos.r === row && oppCrew.pos.c === col;
      const adjacent = isAdjacent(oppCrew.pos, { r: row, c: col });

      let result = 'miss';
      let damage = 0;
      if (directHit) { result = 'direct'; damage = 2; }
      else if (adjacent) { result = 'partial'; damage = 1; }

      targetGrid[row][col] = result === 'direct' ? 2 : result === 'partial' ? 3 : 1;

      // Reset weapons state
      state[firingCrew].charge = 0;
      state[firingCrew].sonarFix = false;
      state[firingCrew].sonarCoords = null;
      state[firingCrew].weaponsArmed = false;
      state[firingCrew].fireApproved = false;
      state[firingCrew].pendingFireCell = null;
      state[firingCrew].weapChargeAttempted = false;

      if (damage > 0) {
        oppCrew.hp = Math.max(0, oppCrew.hp - damage);
        // Create damage event for firefighter — 3 puzzles required
        oppCrew.damage = { fixed: false, timeLeft: 60, puzzles: [], solved: 0 };
      }

      const won = oppCrew.hp <= 0;
      if (won) state.winner = firingCrew;

      r.state = state;
      broadcastAll(room, {
        type: 'torpedo_result',
        result, damage, row, col,
        firingCrew, state,
        won, winnerName: won ? (firingCrew === 'A' ? state.nameA : state.nameB) : null,
        loserName: won ? (opp === 'A' ? state.nameA : state.nameB) : null
      });
      return;
    }

    if (type === 'sonar_ping') {
      if (!rooms[room]) return;
      broadcast(room, { type: 'sonar_ping', heading: msg.heading, crew: msg.crew, silent: msg.silent }, ws);
      return;
    }

    if (type === 'surface_alert') {
      if (!rooms[room]) return;
      broadcast(room, { type: 'surface_alert', crew: msg.crew, sector: msg.sector }, ws);
      return;
    }

    if (type === 'sector_ping_alert') {
      if (!rooms[room]) return;
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
      setTimeout(() => { if (rooms[currentRoom] && rooms[currentRoom].clients.size === 0) delete rooms[currentRoom]; }, 30*60*1000);
    }
  });
});

server.listen(PORT, () => console.log('Deep Sonar on port ' + PORT));
