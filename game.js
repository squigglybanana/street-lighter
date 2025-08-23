// Retro Duel — Full version with sprites

// DOM
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

// constants & state
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
const FRICTION_GROUND   = 0.88;
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

// Load character sprite
const characterSprite = new Image();
characterSprite.src = "https://github.com/squigglybanana/street-lighter/blob/main/character.png"; 
// Replace with your actual GitHub URL

// Particle
class Particle {
  constructor(x,y,vx,vy,life,color){ this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.life=life;this.t=0;this.color=color; this.size=rand(2,4); }
  step(dt){ this.t+=dt; this.x+=this.vx*dt*60; this.y+=this.vy*dt*60; this.vy+=0.2; return this.t < this.life; }
  draw(){ ctx.fillStyle = this.color; ctx.fillRect(this.x|0, this.y|0, this.size, this.size); }
}

// Hitbox (melee arc or projectile)
class Hitbox {
  constructor(owner,x,y,w,h,dmg,kb,stun,ttl,type){
    this.owner=owner; this.x=x; this.y=y; this.w=w; this.h=h; this.dmg=dmg; this.kb=kb; this.stun=stun; this.ttl=ttl; this.type=type;
    this.alive=true; this.vx=0; this.vy=0; this.pierce=false;
  }
  rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }
}

// Fighter
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
    this.image = characterSprite;
  }

  center(){ return { x: this.x + this.w/2, y: this.y + this.h/2 }; }
  get rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }

  input(opponent){
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

  sword(){ /* same as before */ }
  fireball(){ /* same as before */ }
  dash(){ /* same as before */ }
  takeHit(hb){ /* same as before */ }
  step(dt){ /* same as before */ }

  draw(){
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(this.center().x|0, (this.y+this.h+6)|0, 20, 6, 0, 0, Math.PI*2); ctx.fill();

    // sprite draw
    if (this.image && this.image.complete){
        ctx.drawImage(this.image, this.x, this.y, this.w, this.h);
    } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
    }

    // invul flash
    if (this.invul > 0) {
      ctx.globalAlpha = 0.55; ctx.fillStyle = "#fff"; ctx.fillRect(this.x, this.y, this.w, this.h); ctx.globalAlpha = 1;
    }
  }
}

// Rest of the code (hitboxes, particles, AI, resetRound(), UI bindings, main loop) remains the same as your working version
