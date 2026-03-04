const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const menuScreenEl = document.getElementById('menuScreen');
const playBtn = document.getElementById('playBtn');

const scoreALabelEl = document.getElementById('scoreALabel');
const scoreAValueEl = document.getElementById('scoreAValue');
const scoreBLabelEl = document.getElementById('scoreBLabel');
const scoreBValueEl = document.getElementById('scoreBValue');
const statusEl = document.getElementById('status');
const winnerScreenEl = document.getElementById('winnerScreen');
const winnerTitleEl = document.getElementById('winnerTitle');
const winnerSubtitleEl = document.getElementById('winnerSubtitle');

const modeOneBtn = document.getElementById('modeOne');
const modeTwoBtn = document.getElementById('modeTwo');
const formatTeamBtn = document.getElementById('formatTeam');
const formatFfaBtn = document.getElementById('formatFfa');
const sizeLabelEl = document.getElementById('sizeLabel');
const sizeButtons = Array.from(document.querySelectorAll('#sizeGrid .pill'));
const roundButtons = Array.from(document.querySelectorAll('#roundGrid .pill'));
const characterButtons = Array.from(document.querySelectorAll('#characterGrid .pill'));
const backgroundButtons = Array.from(document.querySelectorAll('#backgroundGrid .pill'));

const p2LabelEl = document.getElementById('p2Label');
const p2MoveEl = document.getElementById('p2Move');
const p2ThrowEl = document.getElementById('p2Throw');

const TEAM_SIZES = [1, 2, 3, 4, 5, 8];
const ROUND_TARGETS = [3, 5, 7, 10];

const BASE_PLAYER_RADIUS = 12;
const BALL_RADIUS = 5;
const BASE_PLAYER_SPEED = 260;
const BALL_SPEED = 540;
const COURT_BALL_RESPAWN_MS = 700;
const HIDE_COLLAPSE_SECONDS = 1;
const OBSTACLE_RESPAWN_MS = 5200;
const BALL_EXPLOSION_RADIUS = 90;

const CHARACTER_STATS = {
  striker: { name: 'Striker', color: '#ff9f45', speedMult: 1.0, cooldownMult: 1.0 },
  blazer: { name: 'Blazer', color: '#ff5d5d', speedMult: 0.95, cooldownMult: 0.82 },
  frost: { name: 'Frost', color: '#4ad0ff', speedMult: 0.9, cooldownMult: 0.92 },
  volt: { name: 'Volt', color: '#b2f15f', speedMult: 1.13, cooldownMult: 1.15 }
};

const BACKGROUND_THEMES = {
  gym: { top: '#2e6f46', bottom: '#1a3c2a', circle: 'rgba(255,255,255,0.08)', line: 'rgba(255,255,255,0.22)' },
  street: { top: '#495662', bottom: '#2f3842', circle: 'rgba(255,223,160,0.08)', line: 'rgba(255,223,160,0.2)' },
  beach: { top: '#6ec8ff', bottom: '#d7b16d', circle: 'rgba(255,255,255,0.2)', line: 'rgba(255,255,255,0.35)' },
  space: { top: '#1b2240', bottom: '#080d1f', circle: 'rgba(142,172,255,0.16)', line: 'rgba(142,172,255,0.35)' }
};

const keys = new Set();

const state = {
  menuOpen: true,
  mode: 'cpu',
  format: 'team',
  teamSize: 1,
  winScore: 5,
  selectedCharacter: 'striker',
  selectedBackground: 'gym',
  running: false,
  gameOver: false,
  winner: null,
  teamScores: { 1: 0, 2: 0 },
  ffaScores: {},
  players: [],
  balls: [],
  explosions: [],
  courtBalls: [],
  obstacles: [],
  nextCourtBallSpawnAt: 0,
  lastBoomAt: 0,
  humanThrowRequest: { 1: false, 2: false },
  world: {
    width: 900,
    height: 520,
    midX: 450
  }
};

let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playBoomSound(now) {
  if (now - state.lastBoomAt < 120) return;
  state.lastBoomAt = now;

  const ctxAudio = ensureAudioContext();
  if (!ctxAudio) return;

  const time = ctxAudio.currentTime;

  const osc = ctxAudio.createOscillator();
  const oscGain = ctxAudio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(120, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.18);
  oscGain.gain.setValueAtTime(0.0001, time);
  oscGain.gain.exponentialRampToValueAtTime(0.45, time + 0.01);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
  osc.connect(oscGain);
  oscGain.connect(ctxAudio.destination);
  osc.start(time);
  osc.stop(time + 0.27);

  const bufferSize = Math.max(1, Math.floor(ctxAudio.sampleRate * 0.24));
  const buffer = ctxAudio.createBuffer(1, bufferSize, ctxAudio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    const t = i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * (1 - t);
  }

  const noise = ctxAudio.createBufferSource();
  noise.buffer = buffer;
  const filter = ctxAudio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(520, time);
  const noiseGain = ctxAudio.createGain();
  noiseGain.gain.setValueAtTime(0.0001, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.3, time + 0.01);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctxAudio.destination);
  noise.start(time);
  noise.stop(time + 0.24);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(640, Math.floor(rect.width));
  canvas.height = Math.max(360, Math.floor(rect.height));
  state.world.width = canvas.width;
  state.world.height = canvas.height;
  state.world.midX = canvas.width / 2;

  if (!state.running) {
    resetRound();
  }
}

function humanCount() {
  return state.mode === 'pvp' ? 2 : 1;
}

function totalPlayers() {
  return state.teamSize * 2;
}

function getConfigText() {
  const sizeText = state.format === 'team' ? `${state.teamSize}v${state.teamSize}` : `${state.teamSize * 2} FFA`;
  const modeText = state.mode === 'cpu' ? '1P' : '2P';
  return `${modeText} ${sizeText}`;
}

function getCharacter(id) {
  return CHARACTER_STATS[id] || CHARACTER_STATS.striker;
}

function cpuCharacterId(index) {
  return Object.keys(CHARACTER_STATS)[index % Object.keys(CHARACTER_STATS).length];
}

function createPlayer(base) {
  const player = {
    id: base.id,
    team: base.team,
    controlSlot: base.controlSlot,
    isCpu: base.isCpu,
    x: base.x,
    y: base.y,
    radius: BASE_PLAYER_RADIUS,
    alive: true,
    minX: base.minX,
    maxX: base.maxX,
    up: base.up,
    down: base.down,
    left: base.left,
    right: base.right,
    throwKey: base.throwKey,
    cooldownUntil: 0,
    ammo: 0,
    characterId: base.characterId
  };

  const stats = getCharacter(player.characterId);
  player.color = stats.color;
  player.speed = BASE_PLAYER_SPEED * stats.speedMult;
  player.cooldownMs = 620 * stats.cooldownMult;
  return player;
}

function makeTeamPlayers() {
  const players = [];
  let id = 1;
  const { width, height, midX } = state.world;
  const yGap = height / (state.teamSize + 1);

  for (let i = 0; i < state.teamSize; i += 1) {
    players.push(
      createPlayer({
        id: id++,
        team: 1,
        controlSlot: i === 0 ? 1 : 0,
        isCpu: i !== 0,
        x: width * (0.12 + (i % 3) * 0.08),
        y: yGap * (i + 1),
        minX: BASE_PLAYER_RADIUS,
        maxX: midX - BASE_PLAYER_RADIUS - 10,
        up: 'KeyW',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        throwKey: 'KeyF',
        characterId: i === 0 ? state.selectedCharacter : cpuCharacterId(i)
      })
    );
  }

  for (let i = 0; i < state.teamSize; i += 1) {
    const humanP2 = state.mode === 'pvp' && i === 0;
    players.push(
      createPlayer({
        id: id++,
        team: 2,
        controlSlot: humanP2 ? 2 : 0,
        isCpu: !humanP2,
        x: width * (0.88 - (i % 3) * 0.08),
        y: yGap * (i + 1),
        minX: midX + BASE_PLAYER_RADIUS + 10,
        maxX: width - BASE_PLAYER_RADIUS,
        up: 'ArrowUp',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        throwKey: 'Slash',
        characterId: humanP2 ? 'frost' : cpuCharacterId(i + 3)
      })
    );
  }

  return players;
}

function makeFfaPlayers() {
  const players = [];
  const total = totalPlayers();
  const { width, height } = state.world;
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const xGap = (width - BASE_PLAYER_RADIUS * 4) / (cols + 1);
  const yGap = (height - BASE_PLAYER_RADIUS * 4) / (rows + 1);
  const humans = humanCount();

  for (let i = 0; i < total; i += 1) {
    const slot = i === 0 ? 1 : i === 1 ? 2 : 0;
    const isHuman = i < humans;

    players.push(
      createPlayer({
        id: i + 1,
        team: i + 1,
        controlSlot: isHuman ? slot : 0,
        isCpu: !isHuman,
        x: BASE_PLAYER_RADIUS * 2 + xGap * ((i % cols) + 1),
        y: BASE_PLAYER_RADIUS * 2 + yGap * (Math.floor(i / cols) + 1),
        minX: BASE_PLAYER_RADIUS,
        maxX: width - BASE_PLAYER_RADIUS,
        up: slot === 1 ? 'KeyW' : 'ArrowUp',
        down: slot === 1 ? 'KeyS' : 'ArrowDown',
        left: slot === 1 ? 'KeyA' : 'ArrowLeft',
        right: slot === 1 ? 'KeyD' : 'ArrowRight',
        throwKey: slot === 1 ? 'KeyF' : 'Slash',
        characterId: slot === 1 ? state.selectedCharacter : slot === 2 ? 'frost' : cpuCharacterId(i)
      })
    );
  }

  return players;
}

function makePlayers() {
  return state.format === 'team' ? makeTeamPlayers() : makeFfaPlayers();
}

function makeObstacles() {
  const { width, height } = state.world;
  const defs = [
    { x: width * 0.28, y: height * 0.30, w: 56, h: 34, type: 'bench', label: 'Bench' },
    { x: width * 0.28, y: height * 0.70, w: 48, h: 38, type: 'crate', label: 'Crate Stack' },
    { x: width * 0.5, y: height * 0.5, w: 62, h: 36, type: 'cart', label: 'Cart' },
    { x: width * 0.72, y: height * 0.30, w: 44, h: 40, type: 'bin', label: 'Trash Bin' },
    { x: width * 0.72, y: height * 0.70, w: 62, h: 32, type: 'couch', label: 'Couch' }
  ];

  return defs.map((d, index) => ({
    id: index + 1,
    ...d,
    active: true,
    fallen: false,
    respawnAt: 0,
    hideBy: {}
  }));
}

function courtBallTargetCount() {
  return Math.max(2, Math.min(12, Math.ceil(totalPlayers() * 0.75)));
}

function spawnCourtBall() {
  const { midX, height } = state.world;
  const angle = Math.random() * Math.PI * 2;
  const radius = 14 + Math.random() * 46;
  state.courtBalls.push({
    x: midX + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
    radius: BALL_RADIUS
  });
}

function refillCourtBalls(now, force = false) {
  const target = courtBallTargetCount();
  while (state.courtBalls.length < target) {
    if (!force && now < state.nextCourtBallSpawnAt) {
      return;
    }
    spawnCourtBall();
    state.nextCourtBallSpawnAt = now + COURT_BALL_RESPAWN_MS;
  }
}

function resetScores() {
  state.teamScores = { 1: 0, 2: 0 };
  state.ffaScores = {};
  for (let i = 1; i <= totalPlayers(); i += 1) {
    state.ffaScores[i] = 0;
  }
}

function resetRound() {
  state.players = makePlayers();
  state.balls = [];
  state.explosions = [];
  state.courtBalls = [];
  state.obstacles = makeObstacles();
  state.nextCourtBallSpawnAt = 0;
  refillCourtBalls(0, true);
  state.humanThrowRequest = { 1: false, 2: false };
}

function updateScoreUI() {
  if (state.format === 'team') {
    scoreALabelEl.textContent = 'Team Left';
    scoreBLabelEl.textContent = 'Team Right';
    scoreAValueEl.textContent = String(state.teamScores[1]);
    scoreBValueEl.textContent = String(state.teamScores[2]);
    return;
  }

  let leaderId = 1;
  let leaderScore = state.ffaScores[1] ?? 0;
  for (const [idText, score] of Object.entries(state.ffaScores)) {
    const id = Number(idText);
    if (score > leaderScore) {
      leaderId = id;
      leaderScore = score;
    }
  }

  scoreALabelEl.textContent = 'You';
  scoreAValueEl.textContent = String(state.ffaScores[1] ?? 0);
  scoreBLabelEl.textContent = `Leader P${leaderId}`;
  scoreBValueEl.textContent = String(leaderScore);
}

function updateMenuSelections() {
  modeOneBtn.classList.toggle('active', state.mode === 'cpu');
  modeTwoBtn.classList.toggle('active', state.mode === 'pvp');
  formatTeamBtn.classList.toggle('active', state.format === 'team');
  formatFfaBtn.classList.toggle('active', state.format === 'ffa');
  sizeLabelEl.textContent = state.format === 'team' ? 'Team Size' : 'FFA Size';

  for (const btn of sizeButtons) {
    const size = Number(btn.dataset.size);
    btn.classList.toggle('active', size === state.teamSize);
    btn.textContent = state.format === 'team' ? `${size}v${size}` : `${size * 2} FFA`;
  }

  for (const btn of roundButtons) {
    btn.classList.toggle('active', Number(btn.dataset.rounds) === state.winScore);
  }

  for (const btn of characterButtons) {
    btn.classList.toggle('active', btn.dataset.character === state.selectedCharacter);
  }

  for (const btn of backgroundButtons) {
    btn.classList.toggle('active', btn.dataset.background === state.selectedBackground);
  }

  p2LabelEl.textContent = state.mode === 'cpu' ? 'CPU' : 'Player 2';
  p2MoveEl.textContent = state.mode === 'cpu' ? 'Move: Automatic' : 'Move: Arrow Keys';
  p2ThrowEl.textContent = state.mode === 'cpu' ? 'Throw: Automatic' : 'Throw: / or Right Click';
}

function resetMatch() {
  state.running = false;
  state.gameOver = false;
  state.winner = null;
  hideWinnerScreen();
  resetScores();
  resetRound();
  updateScoreUI();
  statusEl.textContent = `${getConfigText()} ready. First to ${state.winScore} wins.`;
}

function showWinnerScreen(text) {
  winnerTitleEl.textContent = text;
  winnerSubtitleEl.textContent = 'Press R to restart or 0 to return to menu';
  winnerScreenEl.classList.remove('hidden');
}

function hideWinnerScreen() {
  winnerScreenEl.classList.add('hidden');
}

function nearestOpponent(player) {
  let nearest = null;
  let best = Infinity;

  for (const other of state.players) {
    if (!other.alive || other.id === player.id) continue;
    if (state.format === 'team' && other.team === player.team) continue;

    const d2 = (other.x - player.x) ** 2 + (other.y - player.y) ** 2;
    if (d2 < best) {
      best = d2;
      nearest = other;
    }
  }
  return nearest;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function obstacleCenter(obstacle) {
  return { cx: obstacle.x, cy: obstacle.y };
}

function playerNearObstacle(player, obstacle) {
  if (!obstacle.active) return false;
  const { cx, cy } = obstacleCenter(obstacle);
  const shelter = Math.max(obstacle.w, obstacle.h) * 0.55 + player.radius;
  return (player.x - cx) ** 2 + (player.y - cy) ** 2 <= shelter ** 2;
}

function ballHitsObstacle(ball, obstacle) {
  if (!obstacle.active) return false;
  const left = obstacle.x - obstacle.w / 2;
  const top = obstacle.y - obstacle.h / 2;
  const closestX = clamp(ball.x, left, left + obstacle.w);
  const closestY = clamp(ball.y, top, top + obstacle.h);
  return (ball.x - closestX) ** 2 + (ball.y - closestY) ** 2 <= ball.radius ** 2;
}

function nearestCourtBall(player) {
  let nearest = null;
  let best = Infinity;

  for (const ball of state.courtBalls) {
    const d2 = (ball.x - player.x) ** 2 + (ball.y - player.y) ** 2;
    if (d2 < best) {
      best = d2;
      nearest = ball;
    }
  }

  return nearest;
}

function aimAtOpponent(player) {
  const target = nearestOpponent(player);
  if (!target) {
    const dir = player.team === 2 ? -1 : 1;
    return { x: dir, y: 0 };
  }

  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function clampPlayer(player) {
  const { height } = state.world;
  player.x = Math.max(player.minX, Math.min(player.maxX, player.x));
  player.y = Math.max(player.radius, Math.min(height - player.radius, player.y));
}

function throwBall(player, now) {
  if (!player.alive || now < player.cooldownUntil || !state.running || state.gameOver) return;

  const aim = aimAtOpponent(player);
  player.cooldownUntil = now + player.cooldownMs;
  state.balls.push({
    ownerId: player.id,
    ownerTeam: player.team,
    x: player.x + aim.x * (player.radius + BALL_RADIUS + 2),
    y: player.y + aim.y * (player.radius + BALL_RADIUS + 2),
    vx: aim.x * BALL_SPEED,
    vy: aim.y * BALL_SPEED,
    radius: BALL_RADIUS,
    color: '#f8f8f8'
  });
}

function updateHumanPlayer(player, dt, now) {
  if (!player.alive) return;

  let dx = 0;
  let dy = 0;

  if (keys.has(player.up)) dy -= 1;
  if (keys.has(player.down)) dy += 1;
  if (keys.has(player.left)) dx -= 1;
  if (keys.has(player.right)) dx += 1;

  if (dx !== 0 && dy !== 0) {
    const n = Math.sqrt(2);
    dx /= n;
    dy /= n;
  }

  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;
  clampPlayer(player);

  const slot = player.controlSlot;
  if (keys.has(player.throwKey) || state.humanThrowRequest[slot]) {
    throwBall(player, now);
    state.humanThrowRequest[slot] = false;
  }
}

function updateCpuPlayer(player, dt, now) {
  if (!player.alive) return;

  let dx = 0;
  let dy = 0;
  const shouldHide = Math.random() < 0.18;

  const threat = state.balls.find((b) => {
    if (b.ownerId === player.id) return false;
    if (state.format === 'team' && b.ownerTeam === player.team) return false;
    const d2 = (b.x - player.x) ** 2 + (b.y - player.y) ** 2;
    return d2 < 250 ** 2;
  });

  if (threat) {
    dy = threat.y < player.y ? 1 : -1;
    dx = Math.random() < 0.5 ? -1 : 1;
  } else if (shouldHide) {
    let nearestObstacle = null;
    let nearestDist = Infinity;
    for (const obstacle of state.obstacles) {
      if (!obstacle.active) continue;
      const d2 = (obstacle.x - player.x) ** 2 + (obstacle.y - player.y) ** 2;
      if (d2 < nearestDist) {
        nearestDist = d2;
        nearestObstacle = obstacle;
      }
    }

    if (nearestObstacle) {
      if (Math.abs(nearestObstacle.x - player.x) > 8) dx = Math.sign(nearestObstacle.x - player.x);
      if (Math.abs(nearestObstacle.y - player.y) > 8) dy = Math.sign(nearestObstacle.y - player.y);
    }
  } else {
    const target = nearestOpponent(player);
    if (target) {
      if (Math.abs(target.x - player.x) > 16) dx = Math.sign(target.x - player.x);
      if (Math.abs(target.y - player.y) > 14) dy = Math.sign(target.y - player.y);

      if (state.format === 'team') {
        const edge = state.world.midX;
        if (player.team === 1 && player.x > edge - 20) dx = -1;
        if (player.team === 2 && player.x < edge + 20) dx = 1;
      }
    }
  }

  if (dx !== 0 && dy !== 0) {
    const n = Math.sqrt(2);
    dx /= n;
    dy /= n;
  }

  player.x += dx * player.speed * dt * 0.95;
  player.y += dy * player.speed * dt;
  clampPlayer(player);

  const target = nearestOpponent(player);
  if (!target) return;

  const close = (target.x - player.x) ** 2 + (target.y - player.y) ** 2 < 420 ** 2;
  const aligned = Math.abs(target.y - player.y) < 24;
  if ((close && aligned) || Math.random() < 0.009) {
    throwBall(player, now);
  }
}

function updatePlayers(dt, now) {
  for (const player of state.players) {
    if (player.isCpu) updateCpuPlayer(player, dt, now);
    else updateHumanPlayer(player, dt, now);
  }
}

function collapseObstacle(obstacle, now) {
  obstacle.active = false;
  obstacle.fallen = true;
  obstacle.respawnAt = now + OBSTACLE_RESPAWN_MS;
  obstacle.hideBy = {};

  let eliminated = 0;
  const killRadius = Math.max(obstacle.w, obstacle.h) * 1.85;
  const { cx, cy } = obstacleCenter(obstacle);
  for (const player of state.players) {
    if (!player.alive) continue;
    const hit = (player.x - cx) ** 2 + (player.y - cy) ** 2 <= killRadius ** 2;
    if (!hit) continue;
    player.alive = false;
    eliminated += 1;
  }

  if (eliminated > 0) {
    statusEl.textContent = `${obstacle.label} collapsed after 1 second of hiding!`;
  }
}

function updateObstacles(dt, now) {
  for (const obstacle of state.obstacles) {
    if (obstacle.fallen) {
      if (now >= obstacle.respawnAt) {
        obstacle.fallen = false;
        obstacle.active = true;
        obstacle.hideBy = {};
      }
      continue;
    }

    if (!obstacle.active) continue;
    let shouldCollapse = false;

    for (const player of state.players) {
      if (!player.alive) continue;
      const wasHiding = obstacle.hideBy[player.id] || 0;
      if (playerNearObstacle(player, obstacle)) {
        const nextHide = wasHiding + dt;
        obstacle.hideBy[player.id] = nextHide;
        if (nextHide >= HIDE_COLLAPSE_SECONDS) {
          shouldCollapse = true;
        }
      } else {
        obstacle.hideBy[player.id] = 0;
      }
    }

    if (shouldCollapse) {
      collapseObstacle(obstacle, now);
    }
  }
}

function updateCourtBallPickups() {
  for (let i = state.courtBalls.length - 1; i >= 0; i -= 1) {
    const ball = state.courtBalls[i];

    for (const player of state.players) {
      if (!player.alive) continue;

      const hit = (ball.x - player.x) ** 2 + (ball.y - player.y) ** 2 <= (ball.radius + player.radius + 2) ** 2;
      if (!hit) continue;

      player.ammo += 1;
      state.courtBalls.splice(i, 1);
      break;
    }
  }
}

function resolveRoundEnd() {
  if (state.format === 'team') {
    let left = 0;
    let right = 0;

    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.team === 1) left += 1;
      else right += 1;
    }

    if (left > 0 && right > 0) return;

    if (left === 0 && right === 0) {
      state.running = false;
      resetRound();
      statusEl.textContent = 'Round draw. Press Space for next round.';
      return;
    }

    const winner = left > 0 ? 1 : 2;
    state.teamScores[winner] += 1;
    updateScoreUI();

    if (state.teamScores[winner] >= state.winScore) {
      state.running = false;
      state.gameOver = true;
      state.winner = winner;
      statusEl.textContent = `${getConfigText()}: Team ${winner} wins the match. Press R or open menu.`;
      showWinnerScreen(`Team ${winner} Wins`);
      return;
    }

    state.running = false;
    resetRound();
    statusEl.textContent = `Team ${winner} scores. Press Space for next round.`;
    return;
  }

  const alive = state.players.filter((p) => p.alive);
  if (alive.length > 1) return;

  if (alive.length === 0) {
    state.running = false;
    resetRound();
    statusEl.textContent = 'Round draw. Press Space for next round.';
    return;
  }

  const winnerId = alive[0].id;
  state.ffaScores[winnerId] = (state.ffaScores[winnerId] ?? 0) + 1;
  updateScoreUI();

  if (state.ffaScores[winnerId] >= state.winScore) {
    state.running = false;
    state.gameOver = true;
    state.winner = winnerId;
    statusEl.textContent = `${getConfigText()}: Player ${winnerId} wins the match. Press R or open menu.`;
    showWinnerScreen(`Player ${winnerId} Wins`);
    return;
  }

  state.running = false;
  resetRound();
  statusEl.textContent = `Player ${winnerId} wins round. Press Space for next round.`;
}

function addExplosion(x, y, now) {
  state.explosions.push({
    x,
    y,
    startAt: now,
    lifeMs: 320
  });
}

function applyExplosionDamage(x, y, radius) {
  let hits = 0;
  for (const player of state.players) {
    if (!player.alive) continue;
    const inBlast = (player.x - x) ** 2 + (player.y - y) ** 2 <= radius ** 2;
    if (!inBlast) continue;
    player.alive = false;
    hits += 1;
  }
  return hits;
}

function updateBalls(dt, now) {
  if (!state.running) return;

  const toRemove = new Set();
  const { width, height } = state.world;

  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i];
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  for (let i = 0; i < state.balls.length; i += 1) {
    if (toRemove.has(i)) continue;
    const a = state.balls[i];
    for (let j = i + 1; j < state.balls.length; j += 1) {
      if (toRemove.has(j)) continue;
      const b = state.balls[j];
      const hit = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.radius + b.radius) ** 2;
      if (!hit) continue;
      toRemove.add(i);
      toRemove.add(j);
      const ex = (a.x + b.x) / 2;
      const ey = (a.y + b.y) / 2;
      addExplosion(ex, ey, now);
      playBoomSound(now);
      const blastHits = applyExplosionDamage(ex, ey, BALL_EXPLOSION_RADIUS);
      if (blastHits > 0) {
        statusEl.textContent = `Boom! Ball explosion eliminated ${blastHits} player${blastHits > 1 ? 's' : ''}!`;
      }
      break;
    }
  }

  for (let i = 0; i < state.balls.length; i += 1) {
    if (toRemove.has(i)) continue;
    const ball = state.balls[i];

    if (state.obstacles.some((obstacle) => ballHitsObstacle(ball, obstacle))) {
      toRemove.add(i);
      continue;
    }

    for (const player of state.players) {
      if (!player.alive || player.id === ball.ownerId) continue;
      if (state.format === 'team' && player.team === ball.ownerTeam) continue;

      const hit = (ball.x - player.x) ** 2 + (ball.y - player.y) ** 2 <= (ball.radius + player.radius) ** 2;
      if (!hit) continue;

      player.alive = false;
      toRemove.add(i);
      break;
    }

    if (ball.x < -32 || ball.x > width + 32 || ball.y < -32 || ball.y > height + 32) {
      toRemove.add(i);
    }
  }

  state.balls = state.balls.filter((_, i) => !toRemove.has(i));
  resolveRoundEnd();
}

function drawCourt() {
  const { width, height, midX } = state.world;
  const theme = BACKGROUND_THEMES[state.selectedBackground] || BACKGROUND_THEMES.gym;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.top);
  gradient.addColorStop(1, theme.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (state.format === 'team') {
    ctx.fillStyle = theme.line;
    ctx.fillRect(midX - 2, 0, 4, height);
  }

  ctx.fillStyle = theme.circle;
  ctx.beginPath();
  ctx.arc(midX, height / 2, Math.min(70, Math.max(44, height * 0.12)), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(midX, height / 2, Math.min(70, Math.max(44, height * 0.12)), 0, Math.PI * 2);
  ctx.stroke();
}

function drawObstacle(obstacle) {
  const x = obstacle.x;
  const y = obstacle.y;
  const w = obstacle.w;
  const h = obstacle.h;

  if (obstacle.fallen) {
    ctx.fillStyle = 'rgba(122, 94, 60, 0.7)';
    ctx.fillRect(x - w / 2, y + h * 0.2, w, Math.max(8, h * 0.25));
    ctx.strokeStyle = 'rgba(240, 205, 150, 0.5)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.4, y + h * 0.2);
    ctx.lineTo(x + w * 0.4, y + h * 0.45);
    ctx.stroke();
    return;
  }

  const maxHide = Math.max(0, ...Object.values(obstacle.hideBy));
  const warn = clamp(maxHide / HIDE_COLLAPSE_SECONDS, 0, 1);

  if (obstacle.type === 'bin') {
    ctx.fillStyle = `rgba(90, 110, 130, ${0.9 + warn * 0.1})`;
    ctx.fillRect(x - w * 0.35, y - h / 2, w * 0.7, h);
    ctx.strokeStyle = '#d9ebff';
    ctx.strokeRect(x - w * 0.35, y - h / 2, w * 0.7, h);
  } else if (obstacle.type === 'bench') {
    ctx.fillStyle = `rgba(114, 85, 52, ${0.9 + warn * 0.1})`;
    ctx.fillRect(x - w / 2, y - h * 0.15, w, h * 0.3);
    ctx.fillRect(x - w * 0.35, y - h / 2, w * 0.7, h * 0.18);
  } else if (obstacle.type === 'couch') {
    ctx.fillStyle = `rgba(76, 92, 122, ${0.9 + warn * 0.1})`;
    ctx.fillRect(x - w / 2, y - h * 0.2, w, h * 0.45);
    ctx.fillRect(x - w / 2, y - h / 2, w, h * 0.22);
  } else if (obstacle.type === 'cart') {
    ctx.fillStyle = `rgba(95, 106, 120, ${0.9 + warn * 0.1})`;
    ctx.fillRect(x - w / 2, y - h * 0.25, w, h * 0.5);
    ctx.fillStyle = '#3a2f23';
    ctx.beginPath();
    ctx.arc(x - w * 0.3, y + h * 0.28, 4, 0, Math.PI * 2);
    ctx.arc(x + w * 0.3, y + h * 0.28, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = `rgba(127, 84, 51, ${0.9 + warn * 0.1})`;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = '#f2d8b8';
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + w / 2, y);
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x, y + h / 2);
    ctx.stroke();
  }

  if (warn > 0.01) {
    ctx.fillStyle = 'rgba(255, 90, 90, 0.9)';
    ctx.fillRect(x - w / 2, y - h / 2 - 8, w * warn, 4);
  }
}

function drawObstacles() {
  for (const obstacle of state.obstacles) {
    drawObstacle(obstacle);
  }
}

function drawStickman(player) {
  const x = player.x;
  const y = player.y;
  const headR = 4;
  const headY = y - 10;
  const shoulderY = y - 5;
  const hipY = y + 4;
  const footY = y + 12;

  ctx.lineWidth = 2;
  ctx.strokeStyle = player.color;
  ctx.beginPath();
  ctx.arc(x, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, shoulderY);
  ctx.lineTo(x, hipY);
  ctx.moveTo(x - 6, shoulderY + 1);
  ctx.lineTo(x + 6, shoulderY + 1);
  ctx.moveTo(x, hipY);
  ctx.lineTo(x - 5, footY);
  ctx.moveTo(x, hipY);
  ctx.lineTo(x + 5, footY);
  ctx.stroke();

  ctx.fillStyle = '#f4f8ff';
  ctx.font = '700 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`P${player.id}`, x, y - 16);

}

function drawPlayers() {
  for (const p of state.players) {
    if (!p.alive) continue;
    drawStickman(p);
  }
}

function drawCourtBalls() {
  for (const b of state.courtBalls) {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBalls() {
  for (const b of state.balls) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawExplosions(now) {
  state.explosions = state.explosions.filter((e) => now - e.startAt < e.lifeMs);
  for (const e of state.explosions) {
    const t = (now - e.startAt) / e.lifeMs;
    const alpha = 1 - t;
    const r = 14 + t * 44;
    ctx.strokeStyle = `rgba(255, 214, 120, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 120, 80, ${alpha * 0.7})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 7 + t * 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOverlay() {
  if (state.running || state.menuOpen) return;

  const { width, height } = state.world;
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#f3f8ff';
  ctx.font = '700 28px sans-serif';
  ctx.textAlign = 'center';

  const label = state.gameOver
    ? state.format === 'team'
      ? `Team ${state.winner} Wins`
      : `Player ${state.winner} Wins`
    : 'Ready';

  ctx.fillText(label, width / 2, height / 2 - 10);
  ctx.font = '500 16px sans-serif';
  ctx.fillText(state.gameOver ? 'Press R or 0' : 'Press Space', width / 2, height / 2 + 20);
}

function startRound() {
  if (state.menuOpen || state.gameOver || state.running) return;
  state.running = true;
  statusEl.textContent = `Round live (${getConfigText()}).`;
}

function openMenu() {
  state.menuOpen = true;
  state.running = false;
  hideWinnerScreen();
  menuScreenEl.classList.remove('hidden');
  statusEl.textContent = 'Menu open. Choose settings and press Play Match.';
}

async function playFromMenu() {
  state.menuOpen = false;
  menuScreenEl.classList.add('hidden');
  resetMatch();
  startRound();

  if (!document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Ignore browser fullscreen permission failures.
    }
  }
}

let lastTs = 0;
function tick(ts) {
  const dt = Math.min((ts - lastTs) / 1000 || 0, 0.033);
  lastTs = ts;

  if (state.running && !state.gameOver && !state.menuOpen) {
    updatePlayers(dt, ts);
    updateObstacles(dt, ts);
    updateBalls(dt, ts);
  }

  drawCourt();
  drawObstacles();
  drawPlayers();
  drawBalls();
  drawExplosions(ts);
  drawOverlay();
  requestAnimationFrame(tick);
}

window.addEventListener('keydown', (event) => {
  keys.add(event.code);

  if (event.code === 'Space') {
    event.preventDefault();
    startRound();
  }

  if (event.code === 'KeyR') {
    event.preventDefault();
    resetMatch();
  }

  if (event.code === 'Digit0' || event.code === 'Numpad0') {
    event.preventDefault();
    openMenu();
  }
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

canvas.addEventListener('mousedown', (event) => {
  if (state.menuOpen || !state.running) return;

  if (event.button === 0) {
    state.humanThrowRequest[1] = true;
  }

  if (event.button === 2) {
    state.humanThrowRequest[2] = true;
  }
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

modeOneBtn.addEventListener('click', () => {
  state.mode = 'cpu';
  updateMenuSelections();
});

modeTwoBtn.addEventListener('click', () => {
  state.mode = 'pvp';
  updateMenuSelections();
});

formatTeamBtn.addEventListener('click', () => {
  state.format = 'team';
  updateMenuSelections();
});

formatFfaBtn.addEventListener('click', () => {
  state.format = 'ffa';
  updateMenuSelections();
});

for (const btn of sizeButtons) {
  btn.addEventListener('click', () => {
    const size = Number(btn.dataset.size);
    if (!TEAM_SIZES.includes(size)) return;
    state.teamSize = size;
    updateMenuSelections();
  });
}

for (const btn of roundButtons) {
  btn.addEventListener('click', () => {
    const rounds = Number(btn.dataset.rounds);
    if (!ROUND_TARGETS.includes(rounds)) return;
    state.winScore = rounds;
    updateMenuSelections();
  });
}

for (const btn of characterButtons) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.character;
    if (!CHARACTER_STATS[id]) return;
    state.selectedCharacter = id;
    updateMenuSelections();
  });
}

for (const btn of backgroundButtons) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.background;
    if (!BACKGROUND_THEMES[id]) return;
    state.selectedBackground = id;
    updateMenuSelections();
  });
}

playBtn.addEventListener('click', () => {
  playFromMenu();
});

window.addEventListener('resize', resizeCanvas);

updateMenuSelections();
resizeCanvas();
resetMatch();
requestAnimationFrame(tick);
