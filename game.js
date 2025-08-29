// Retro Duel — integrated version (menu, AI, visuals, projectiles, knockback, i-frames, restart)
// + Sprite support via `character.image` (static draw with auto-mirror)

// ===== DOM =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const menuEl = document.getElementById("menu");
const diffEl = document.getElementById("difficulty");
const gameUI = document.getElementById("gameUI");
const hudEl = document.getElementById("hud");

const btnSingle = document.getElementById("btnSingle");
const btnMulti  = document.getElementById("btnMulti");
const btnEasy   = document.getElementById("btnEasy");
const btnHard   = document.getElementById("btnHard");
const btnBackFromDifficulty = document.getElementById("btnBackFromDifficulty");
const backToMenu = document.getElementById("backToMenu");
const restartBtn = document.getElementById("restartBtn");

const timerEl = document.getElementById("timer");
const p1hpEl = document.getElementById("p1hp");
const p2hpEl = document.getElementById("p2hp");
const announceEl = document.getElementById("announcement");

// ===== constants & state =====
const W = canvas.width, H = canvas.height;
const GRAVITY = 0.8;
const FLOOR = { y: H - 64, height: 24 };

let last = 0, acc = 0;
let paused = false;
let roundTime = 60;
let roundOver = false;

let gameMode = "menu"; // "menu" | "single" | "multi"
let aiDifficulty = "easy";

const COLORS = {
  p1: "#ff3ec9", p2: "#3ef9ff", sword: "#fffd38",
  fire1: "#ff6a00", fire2: "#ffdf3a", hurt: "#ff3e60", dust: "#a2ff5a"
};

// movement & balance knobs
const MOVE_ACCEL_GROUND = 0.9;
const MOVE_ACCEL_AIR    = 0.35;
theFRICTION_GROUND   = 0.88;
const DRAG_AIR          = 0.96;
const MAX_SPEED_GROUND  = 6.0;
const MAX_SPEED_AIR     = 3.4;

const SWORD_KB_X = 8, SWORD_KB_Y = -5;
const FIRE_KB_X  = 6, FIRE_KB_Y  = -3;
const HITSTOP_ON_HIT = 0.08;
const STUN_ON_HIT = 0.20;
const PER_HIT_IFRAMES = 0.25;
const LONG_IFRAMES = 1.0;
const COMBO_RESET_TIME = 1.5;

// input
const keys = new Set();
const Pressed = new Set();

// world
const particles = [];
const hitboxes = [];

// helpers
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rand = (a,b) => a + Math.random()*(b-a);

// ===== sprite (character.image) =====
// Put your image file beside index.html as "character.png"
// Or change the path below to "./assets/character.png" etc.
const character = { image: new Image() };
character.image.src = "./character.png";

// ===== Particle =====
class Particle {
  constructor(x,y,vx,vy,life,color){ this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.life=life;this.t=0;this.color=color; this.size=rand(2,4); }
  step(dt){ this.t+=dt; this.x+=this.vx*dt*60; this.y+=this.vy*dt*60; this.vy+=0.2; return this.t < this.life; }
  draw(){ ctx.fillStyle = this.color; ctx.fillRect(this.x|0, this.y|0, this.size, this.size); }
}

// ===== Hitbox (melee / projectile) =====
class Hitbox {
  constructor(owner,x,y,w,h,dmg,kb,stun,ttl,type){
    this.owner=owner; this.x=x; this.y=y; this.w=w; this.h=h; this.dmg=dmg; this.kb=kb; this.stun=stun; this.ttl=ttl; this.type=type;
    this.alive=true; this.vx=0; this.vy=0; this.pierce=false;
  }
  rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }
}

// ===== Fighter =====
class Fighter {
  constructor(x, color, controls, isAI=false){
    this.x=x; this.y=FLOOR.y-64; this.vx=0; this.vy=0; this.w=36; this.h=56;
    this.color=color; this.maxHP=100; this.hp=100;
    this.facing=1; this.onGround=false;
    this.cd={sword:0, fire:0, dash:0};
    this.invul=0; this.hitstop=0; this.stun=0;
    this.consecHits=0; this.comboTimer=0;
    this.controls=controls; this.isAI=isAI;
    this.aiTimer = 0;

    // sprite
    this.image = character.image; // <- per your request: use character.image
  }

  center(){ return { x: this.x + this.w/2, y: this.y + this.h/2 }; }
  get rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }

  input(){
    if (this.hitstop > 0) return;

    let ax = 0;
    const c = this.controls;
    if (c){
      if (keys.has(c.left)) ax -= 1;
      if (keys.has(c.right)) ax += 1;
    }

    if (ax !== 0) this.facing = ax;
    const accel = this.onGround ? MOVE_ACCEL_GROUND : MOVE_ACCEL_AIR;
    this.vx += ax * accel;
    const maxSpd = this.onGround ? MAX_SPEED_GROUND : MAX_SPEED_AIR;
    this.vx = clamp(this.vx, -maxSpd, maxSpd);

    if (c && pressing(c.jump) && this.onGround){
      this.vy = -12; this.onGround = false; burst(this.center().x, this.y+this.h, 8, COLORS.dust, -1, -6, 1.1);
    }

    if (c && pressing(c.sword) && this.cd.sword <= 0) this.sword();
    if (c && pressing(c.fire) && this.cd.fire <= 0) this.fireball();
    if (c && pressing(c.dash) && this.cd.dash <= 0) this.dash();
  }

  ai(opponent, difficulty){
    if (this.hitstop > 0) return;
    if (this.aiTimer > 0) this.aiTimer--;
    if (difficulty === "easy"){
      if (this.aiTimer <= 0){
        this.aiTimer = 30 + Math.floor(Math.random()*60);
        const r = Math.random();
        if (r < 0.36) this.sword();
        else if (r < 0.6) this.fireball();
        else if (r < 0.85) { this.vx = (opponent.x < this.x ? -2 : 2); this.facing = (opponent.x < this.x? -1 : 1); }
        else if (this.onGround && Math.random() < 0.5) this.vy = -10;
      }
    } else {
      // hard
      if (opponent.x < this.x - 40) { this.vx = -3; this.facing = -1; }
      else if (opponent.x > this.x + 40) { this.vx = 3; this.facing = 1; }
      else {
        this.vx = 0;
        if (Math.random() < 0.12) this.sword();
        if (Math.random() < 0.06) this.fireball();
      }
      if (this.onGround && Math.random() < 0.02) this.vy = -11;
    }
    if (!this.onGround) this.vx *= 0.92;
  }

  sword(){
    if (this.cd.sword > 0) return;
    this.cd.sword = 0.35;
    this.hitstop = 0.06;
    const arcW = 42, arcH = 28;
    const hx = this.facing === 1 ? this.x + this.w : this.x - arcW;
    const hy = this.y + 12;
    const hb = new Hitbox(this, hx, hy, arcW, arcH, 10, {x:SWORD_KB_X*this.facing, y:SWORD_KB_Y}, STUN_ON_HIT, 0.12, "melee");
    hitboxes.push(hb);
    burst(hx + arcW/2, hy + arcH/2, 12, COLORS.sword, 2*this.facing, -2, 0.2);
  }

  fireball(){
    if (this.cd.fire > 0) return;
    this.cd.fire = 0.9;
    const w = 18, h = 12;
    const hx = this.facing === 1 ? this.x + this.w + 2 : this.x - w - 2;
    const hy = this.y + 20;
    const hb = new Hitbox(this, hx, hy, w, h, 12, {x:FIRE_KB_X*this.facing, y:FIRE_KB_Y}, STUN_ON_HIT, 3.2, "fireball");
    hb.vx = 7 * this.facing; hb.vy = rand(-0.3,0.3);
    hitboxes.push(hb);
    for (let i=0;i<10;i++) particles.push(new Particle(hx, hy, rand(-1,1), rand(-1,1), rand(0.15,0.45), i%2?COLORS.fire1:COLORS.fire2));
  }

  dash(){
    if (this.cd.dash > 0) return;
    this.cd.dash = 2.0;
    this.vx = 14 * this.facing;
    burst(this.center().x - this.facing*18, this.y + this.h - 6, 12, '#ffffff', -this.facing*4, -1, 0.25);
  }

  takeHit(hb){
    if (this.invul > 0 || this.hitstop > 0) return;
    this.hp = clamp(this.hp - hb.dmg, 0, this.maxHP);
    this.stun = Math.max(this.stun, hb.stun);
    this.hitstop = HITSTOP_ON_HIT;
    this.vx += hb.kb.x;
    this.vy += hb.kb.y;
    burst(this.center().x, this.center().y, 12, COLORS.hurt, rand(-2,2), rand(-2,2), 0.2);

    this.comboTimer = COMBO_RESET_TIME;
    this.consecHits += 1;

    this.invul = Math.max(this.invul, PER_HIT_IFRAMES);
    if (this.consecHits >= 4){ this.invul = Math.max(this.invul, LONG_IFRAMES); this.consecHits = 0; this.comboTimer = 0; }

    if (this.hp <= 0) endRound(hb.owner === p1 ? "Player 2 Wins!" : "Player 1 Wins!");
  }

  step(dt){
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.invul = Math.max(0, this.invul - dt);
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.stun = Math.max(0, this.stun - dt);
    if (this.comboTimer > 0){ this.comboTimer -= dt; if (this.comboTimer <= 0) this.consecHits = 0; }

    // controls or AI
    if (this.stun <= 0){
      if (this.isAI) { /* handled externally via ai() */ }
      else this.input();
    }

    // physics (skip only during hitstop)
    if (this.hitstop <= 0){
      this.vy += GRAVITY;
      if (this.onGround) { this.vx *= theFRICTION_GROUND; this.vx = clamp(this.vx, -MAX_SPEED_GROUND, MAX_SPEED_GROUND); }
      else { this.vx *= DRAG_AIR; this.vx = clamp(this.vx, -MAX_SPEED_AIR, MAX_SPEED_AIR); }

      this.x += this.vx;
      this.y += this.vy;

      // ground collision
      if (this.y + this.h >= FLOOR.y){
        this.y = FLOOR.y - this.h; this.vy = 0;
        if (!this.onGround) burst(this.center().x, this.y + this.h, 8, COLORS.dust, -1, -4, 0.8);
        this.onGround = true;
      } else this.onGround = false;

      // walls
      if (this.x < 16){ this.x = 16; this.vx = 0; }
      if (this.x + this.w > W-16){ this.x = W-16 - this.w; this.vx = 0; }
    }
  }

  draw(){
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";// ==== SETUP ====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// UI elements
const menu = document.getElementById("menu");
const difficultyScreen = document.getElementById("difficulty");
const gameUI = document.getElementById("gameUI");
const hud = document.getElementById("hud");
const announcement = document.getElementById("announcement");
const p1hpBar = document.getElementById("p1hp");
const p2hpBar = document.getElementById("p2hp");
const timerEl = document.getElementById("timer");

// Buttons
const btnSingle = document.getElementById("btnSingle");
const btnMulti = document.getElementById("btnMulti");
const btnEasy = document.getElementById("btnEasy");
const btnHard = document.getElementById("btnHard");
const btnBackFromDifficulty = document.getElementById("btnBackFromDifficulty");
const backToMenuBtn = document.getElementById("backToMenu");
const restartBtn = document.getElementById("restartBtn");

// Sprites from HTML
const blueSprite = document.getElementById("blueSprite");
// const redSprite = document.getElementById("redSprite"); // later if added

// ==== GAME STATE ====
let gameRunning = false;
let gameTimer = 60;
let gameInterval;
let singlePlayer = false;
let aiDifficulty = "easy";

// ==== PLAYER CLASS ====
class Player {
  constructor(x, y, controls, sprite, flip=false, isAI=false) {
    this.x = x;
    this.y = y;
    this.width = 80;
    this.height = 80;
    this.velX = 0;
    this.velY = 0;
    this.onGround = false;
    this.hp = 100;
    this.controls = controls;
    this.sprite = sprite;
    this.flip = flip;
    this.isAI = isAI;
    this.attackCooldown = 0;
    this.projectiles = [];
  }

  draw() {
    if (this.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(this.sprite, -this.x - this.width, this.y, this.width, this.height);
      ctx.restore();
    } else {
      ctx.drawImage(this.sprite, this.x, this.y, this.width, this.height);
    }

    // Draw projectiles
    ctx.fillStyle = "orange";
    this.projectiles.forEach(fb => {
      ctx.beginPath();
      ctx.arc(fb.x, fb.y, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  update() {
    // Gravity
    this.velY += 0.5;
    this.y += this.velY;
    this.x += this.velX;

    // Floor
    if (this.y + this.height > canvas.height - 20) {
      this.y = canvas.height - this.height - 20;
      this.velY = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Bounds
    if (this.x < 0) this.x = 0;
    if (this.x + this.width > canvas.width) this.x = canvas.width - this.width;

    if (this.attackCooldown > 0) this.attackCooldown--;

    // Fireballs
    this.projectiles.forEach(fb => fb.x += fb.velX);
    this.projectiles = this.projectiles.filter(fb => fb.x > 0 && fb.x < canvas.width);
  }

  attack(opponent) {
    if (this.attackCooldown === 0) {
      this.attackCooldown = 30;
      const hitbox = {
        x: this.flip ? this.x - 30 : this.x + this.width,
        y: this.y + 20,
        w: 30, h: 40
      };
      if (rectCollision(hitbox, opponent)) opponent.hp -= 10;
    }
  }

  fireball() {
    if (this.attackCooldown === 0) {
      this.attackCooldown = 60;
      const dir = this.flip ? -8 : 8;
      this.projectiles.push({ x: this.x + this.width / 2, y: this.y + 40, velX: dir });
    }
  }

  dash() {
    if (this.attackCooldown === 0) {
      this.attackCooldown = 40;
      this.velX = this.flip ? -15 : 15;
    }
  }
}

// ==== CONTROLS ====
const keys = {};
document.addEventListener("keydown", e => {
  keys[e.key] = true;
  if (e.key === "r") startGame(); // reset
  if (e.key === "p") togglePause();
});
document.addEventListener("keyup", e => keys[e.key] = false);

const player1Controls = {
  left: "a", right: "d", jump: "w",
  attack: "f", fireball: "g", dash: "h"
};
const player2Controls = {
  left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp",
  attack: "k", fireball: "l", dash: ";"
};

let player1, player2;

// ==== COLLISION ====
function rectCollision(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + (a.w || a.width) > b.x &&
    a.y < b.y + b.height &&
    a.y + (a.h || a.height) > b.y
  );
}

// ==== GAME LOOP ====
function update() {
  // Controls for Player 1
  if (keys[player1.controls.left]) player1.velX = -5;
  else if (keys[player1.controls.right]) player1.velX = 5;
  else player1.velX = 0;
  if (keys[player1.controls.jump] && player1.onGround) player1.velY = -12;
  if (keys[player1.controls.attack]) player1.attack(player2);
  if (keys[player1.controls.fireball]) player1.fireball();
  if (keys[player1.controls.dash]) player1.dash();

  // Controls or AI for Player 2
  if (!player2.isAI) {
    if (keys[player2.controls.left]) player2.velX = -5;
    else if (keys[player2.controls.right]) player2.velX = 5;
    else player2.velX = 0;
    if (keys[player2.controls.jump] && player2.onGround) player2.velY = -12;
    if (keys[player2.controls.attack]) player2.attack(player1);
    if (keys[player2.controls.fireball]) player2.fireball();
    if (keys[player2.controls.dash]) player2.dash();
  } else {
    aiControl(player2, player1);
  }

  player1.update();
  player2.update();

  // Fireball hits
  player1.projectiles.forEach(fb => {
    if (rectCollision({ x: fb.x-4, y: fb.y-4, w: 8, h: 8 }, player2)) {
      player2.hp -= 8;
      fb.x = -999;
    }
  });
  player2.projectiles.forEach(fb => {
    if (rectCollision({ x: fb.x-4, y: fb.y-4, w: 8, h: 8 }, player1)) {
      player1.hp -= 8;
      fb.x = -999;
    }
  });

  // HUD
  p1hpBar.style.width = Math.max(player1.hp, 0) + "%";
  p2hpBar.style.width = Math.max(player2.hp, 0) + "%";

  if (player1.hp <= 0 || player2.hp <= 0) {
    endGame(player1.hp <= 0 ? "Player 2 Wins!" : "Player 1 Wins!");
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black";
  ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
  player1.draw();
  player2.draw();
}

function gameLoop() {
  if (!gameRunning) return;
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// ==== TIMER ====
function startTimer() {
  gameTimer = 60;
  timerEl.textContent = gameTimer;
  gameInterval = setInterval(() => {
    gameTimer--;
    timerEl.textContent = gameTimer;
    if (gameTimer <= 0) {
      clearInterval(gameInterval);
      if (player1.hp === player2.hp) endGame("Draw!");
      else if (player1.hp > player2.hp) endGame("Player 1 Wins!");
      else endGame("Player 2 Wins!");
    }
  }, 1000);
}

// ==== AI ====
function aiControl(ai, opponent) {
  ai.velX = 0;
  if (aiDifficulty === "easy") {
    if (Math.random() < 0.02) ai.attack(opponent);
  } else {
    if (opponent.x < ai.x) ai.velX = -3;
    else ai.velX = 3;
    if (Math.random() < 0.05) ai.attack(opponent);
    if (Math.random() < 0.02) ai.fireball();
  }
}

// ==== GAME STATE ====
function startGame() {
  hud.classList.remove("hidden");
  gameUI.classList.remove("hidden");
  menu.classList.add("hidden");
  difficultyScreen.classList.add("hidden");
  announcement.classList.add("hidden");

  player1 = new Player(100, 400, player1Controls, blueSprite, false);
  player2 = new Player(700, 400, player2Controls, blueSprite, true, singlePlayer);

  player1.hp = 100;
  player2.hp = 100;
  gameRunning = true;
  startTimer();
  gameLoop();
}

function endGame(text) {
  gameRunning = false;
  clearInterval(gameInterval);
  announcement.textContent = text;
  announcement.classList.remove("hidden");
}

function resetGame() {
  endGame("");
  startGame();
}

function togglePause() {
  gameRunning = !gameRunning;
  if (gameRunning) gameLoop();
}

// ==== MENU BUTTONS ====
btnSingle.addEventListener("click", () => {
  singlePlayer = true;
  menu.classList.add("hidden");
  difficultyScreen.classList.remove("hidden");
});
btnMulti.addEventListener("click", () => {
  singlePlayer = false;
  startGame();
});
btnEasy.addEventListener("click", () => {
  aiDifficulty = "easy";
  startGame();
});
btnHard.addEventListener("click", () => {
  aiDifficulty = "hard";
  startGame();
});
btnBackFromDifficulty.addEventListener("click", () => {
  difficultyScreen.classList.add("hidden");
  menu.classList.remove("hidden");
});
backToMenuBtn.addEventListener("click", () => {
  gameRunning = false;
  clearInterval(gameInterval);
  hud.classList.add("hidden");
  gameUI.classList.add("hidden");
  menu.classList.remove("hidden");
});
restartBtn.addEventListener("click", resetGame);


