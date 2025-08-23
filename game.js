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
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(this.center().x|0, (this.y+this.h+6)|0, 20, 6, 0, 0, Math.PI*2); ctx.fill();

    // sprite (mirror when facing left)
    if (this.image && this.image.complete && this.image.naturalWidth){
      const dw = this.w, dh = this.h;
      if (this.facing === -1){
        ctx.save();
        ctx.translate(this.x + dw/2, this.y);
        ctx.scale(-1, 1);
        ctx.drawImage(this.image, 0, 0, this.image.naturalWidth, this.image.naturalHeight, -dw/2, 0, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(this.image, this.x, this.y, dw, dh);
      }
    } else {
      // fallback body
      ctx.fillStyle = "#000000"; ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.fillStyle = this.color; ctx.fillRect(this.x+4, this.y+4, this.w-8, this.h-8);
      ctx.fillStyle = "#fff"; ctx.fillRect(this.x+6, this.y+10, this.w-12, 6);
      if (this.facing === 1) ctx.fillRect(this.x+this.w-6, this.y+22, 6,6); else ctx.fillRect(this.x, this.y+22, 6,6);
      ctx.globalAlpha = 0.12; ctx.fillStyle = this.color; ctx.fillRect(this.x-2,this.y-2,this.w+4,this.h+4); ctx.globalAlpha = 1;
    }

    // invul flash overlay
    if (this.invul > 0) {
      ctx.globalAlpha = 0.55; ctx.fillStyle = "#fff"; ctx.fillRect(this.x, this.y, this.w, this.h); ctx.globalAlpha = 1;
    }
  }
}

// ===== global fighters =====
let p1 = null, p2 = null;

// ===== helpers =====
function burst(x,y,n,color,vx=0,vy=0,spread=1){
  for (let i=0;i<n;i++) particles.push(new Particle(x,y, Math.cos(Math.random()*Math.PI*2)*rand(0.5,2.5)*spread + vx, Math.sin(Math.random()*Math.PI*2)*rand(0.5,2.5)*spread + vy, rand(0.15,0.6), color ));
}
function pressing(code){ if (Pressed.has(code)){ Pressed.delete(code); return true; } return false; }
function overlap(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

// ===== reset / round handling =====
function resetRound(){
  roundTime = 60; roundOver = false; paused = false;
  announce("");
  if (!p1 || !p2) return;
  p1.x = 200; p1.y = FLOOR.y - p1.h; p1.vx = p1.vy = 0; p1.hp = p1.maxHP; p1.stun = p1.hitstop = p1.invul = 0; p1.consecHits = 0; p1.comboTimer = 0; p1.facing = 1;
  p2.x = W-260; p2.y = FLOOR.y - p2.h; p2.vx = p2.vy = 0; p2.hp = p2.maxHP; p2.stun = p2.hitstop = p2.invul = 0; p2.consecHits = 0; p2.comboTimer = 0; p2.facing = -1;
  hitboxes.length = 0; particles.length = 0;
  timerEl.textContent = roundTime;
  updateHPBars();
}
function endRound(text){
  if (roundOver) return;
  roundOver = true;
  announce(text);
}
function announce(text){
  if (!text){ announceEl.classList.add("hidden"); announceEl.textContent=""; return; }
  announceEl.textContent = text; announceEl.classList.remove("hidden");
}
function updateHPBars(){
  if (!p1 || !p2) return;
  p1hpEl.style.width = (100 * p1.hp / p1.maxHP) + "%";
  p2hpEl.style.width = (100 * p2.hp / p2.maxHP) + "%";
}

// ===== safe UI bindings =====
function bindUI(){
  btnSingle.addEventListener("click", ()=>{ menuEl.classList.add("hidden"); diffEl.classList.remove("hidden"); });
  btnMulti.addEventListener("click", ()=> startMatch("multi"));
  btnEasy.addEventListener("click", ()=> startMatch("single","easy"));
  btnHard.addEventListener("click", ()=> startMatch("single","hard"));
  btnBackFromDifficulty.addEventListener("click", ()=>{ diffEl.classList.add("hidden"); menuEl.classList.remove("hidden"); });
  backToMenu.addEventListener("click", ()=>{ menuEl.classList.remove("hidden"); diffEl.classList.add("hidden"); gameUI.classList.add("hidden"); hudEl.classList.add("hidden"); p1 = p2 = null; announce(""); roundOver = true; gameMode = "menu"; });
  restartBtn.addEventListener("click", ()=>{ paused = false; resetRound(); });
}
if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", bindUI); else bindUI();

// ===== Start match (create fighters, show UI) =====
function startMatch(mode, difficulty){
  gameMode = mode;
  aiDifficulty = difficulty;
  menuEl.classList.add("hidden"); diffEl.classList.add("hidden"); gameUI.classList.remove("hidden"); hudEl.classList.remove("hidden");

  p1 = new Fighter(200, COLORS.p1, { left:"KeyA", right:"KeyD", jump:"KeyW", sword:"KeyF", fire:"KeyG", dash:"KeyH" }, false);

  if (mode === "multi")
    p2 = new Fighter(W-260, COLORS.p2, { left:"ArrowLeft", right:"ArrowRight", jump:"ArrowUp", sword:"KeyK", fire:"KeyL", dash:"Semicolon" }, false);
  else
    p2 = new Fighter(W-260, COLORS.p2, {}, true);

  // ensure both use the sprite reference (character.image)
  p1.image = character.image;
  p2.image = character.image;

  resetRound();
}

// ===== main loop =====
function step(ts){
  const dt = Math.min(0.033, (ts-last)/1000 || 0);
  last = ts;
  if (paused) { requestAnimationFrame(step); return; }

  // timer
  acc += dt;
  if (!roundOver && acc >= 1){
    acc -= 1;
    roundTime = Math.max(0, roundTime - 1);
    timerEl.textContent = roundTime;
    if (roundTime===0){
      const t = p1.hp === p2.hp ? "Draw!" : (p1.hp > p2.hp ? "Time! Player 1 Wins!" : "Time! Player 2 Wins!");
      endRound(t);
    }
  }

  // logic
  if (!roundOver && p1 && p2){
    // input & AI
    if (p1) p1.input(p2);
    if (p2) {
      if (p2.isAI) p2.ai(p1, aiDifficulty);
      else p2.input(p1);
    }

    p1.step(dt); p2.step(dt);

    // hitboxes
    for (const hb of hitboxes){
      if (!hb.alive) continue;
      hb.ttl -= dt;

      if (hb.type === "fireball"){
        hb.x += hb.vx; hb.y += hb.vy;
        if (hb.y + hb.h > FLOOR.y || hb.x < 0 || hb.x + hb.w > W) hb.ttl = 0;
        particles.push(new Particle(hb.x+hb.w/2, hb.y+hb.h/2, rand(-0.6,0.6), rand(-0.6,0.6), 0.12, Math.random()<0.5?COLORS.fire1:COLORS.fire2));
      }

      if (hb.ttl <= 0) hb.alive = false;

      const target = hb.owner === p1 ? p2 : p1;
      if (overlap(hb.rect(), target.rect)) {
        target.takeHit(hb);
        if (!hb.pierce) hb.alive = false;
        updateHPBars();
      }
    }
    for (let i=hitboxes.length-1;i>=0;i--) if (!hitboxes[i].alive) hitboxes.splice(i,1);
    for (let i=particles.length-1;i>=0;i--) if (!particles[i].step(dt)) particles.splice(i,1);
  }

  // draw
  ctx.clearRect(0,0,W,H);
  drawBackground();

  // ground
  ctx.fillStyle = "#0b1035"; ctx.fillRect(0,FLOOR.y,W,FLOOR.height);
  ctx.fillStyle = "#000"; ctx.fillRect(0,FLOOR.y+FLOOR.height,W,8);

  // draw hitboxes (fireballs + melee arcs)
  for (const hb of hitboxes){
    if (!hb.alive) continue;
    if (hb.type === "fireball"){
      ctx.beginPath(); ctx.fillStyle = COLORS.fire1; ctx.ellipse(hb.x + hb.w/2, hb.y + hb.h/2, hb.w/2, hb.h/2, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.fillStyle = COLORS.fire2; ctx.fillRect(hb.x-4, hb.y-4, hb.w+8, hb.h+8); ctx.globalAlpha = 1;
    } else if (hb.type === "melee"){
      ctx.globalAlpha = 0.85; ctx.fillStyle = COLORS.sword; ctx.fillRect(hb.x, hb.y, hb.w, hb.h); ctx.globalAlpha = 1;
    }
  }

  // fighters & particles
  if (p1) p1.draw(); if (p2) p2.draw();
  for (const p of particles) p.draw();

  requestAnimationFrame(step);
}

// ===== background =====
function drawBackground(){
  const stripes = 10;
  for (let i=0;i<stripes;i++){
    const t=i/(stripes-1);
    const y = t*H*0.9 + 10;
    ctx.fillStyle = `rgba(62,249,255,${0.05 + 0.05*Math.sin((performance.now()/600)+i)})`;
    ctx.fillRect(0,y,W,4);
  }
  ctx.beginPath(); ctx.arc(W/2,160,80,0,Math.PI*2); ctx.fillStyle="#ff3ec9"; ctx.fill();
  ctx.fillStyle="#10173a";
  ctx.beginPath();
  ctx.moveTo(0,H*0.7);
  for(let x=0;x<=W;x+=32){
    const y=H*0.7 - Math.abs(Math.sin(x*0.01))*40 - (x%64===0?30:0);
    ctx.lineTo(x,y);
  }
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill();
}

// ===== input handling =====
window.addEventListener("keydown",(e)=>{
  if (e.repeat) return;
  keys.add(e.code); Pressed.add(e.code);
  if (e.code === "KeyP") paused = !paused;
  if (e.code === "KeyR") { paused = false; resetRound(); }
});
window.addEventListener("keyup",(e)=>{ keys.delete(e.code); });

// ===== start =====
requestAnimationFrame(step);
