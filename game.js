// ===================== GAME.JS =====================

// Canvas setup
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Game state
let gameMode = null; // "single" or "multi"
let difficulty = "easy";
let isPaused = false;
let timer = 60;
let timerInterval;

// Constants
const GRAVITY = 0.6;
const FLOOR = canvas.height - 80;
const FRAME_SIZE = 32; // sprite size
const FRAME_SPEED = 8; // lower = faster animation

// Load sprites
const redSprite = new Image();
redSprite.src = "redsprite.png";
const blueSprite = new Image();
blueSprite.src = "bluesprite.png";

// Fireballs
let projectiles = [];

// Player class
class Player {
  constructor(x, color, controls, sprite, isAI = false) {
    this.x = x;
    this.y = FLOOR;
    this.vx = 0;
    this.vy = 0;
    this.width = FRAME_SIZE * 2;
    this.height = FRAME_SIZE * 2;
    this.hp = 100;
    this.color = color;
    this.controls = controls;
    this.sprite = sprite;
    this.isAI = isAI;

    this.keys = {};
    this.onGround = true;

    // Animation
    this.frame = 0;
    this.tick = 0;
    this.state = "idle"; // idle, walk, jump, sword, fireball, dash, hit

    // Attack cooldowns
    this.swordCooldown = 0;
    this.fireballCooldown = 0;
    this.dashCooldown = 0;

    // Hit stun
    this.hitStun = 0;
  }

  update() {
    if (this.hitStun > 0) {
      this.hitStun--;
      // While stunned, can't control, just physics apply
      this.x += this.vx;
      this.vy += GRAVITY;
      this.y += this.vy;
      if (this.y > FLOOR) {
        this.y = FLOOR;
        this.vy = 0;
        this.onGround = true;
      }
      return; // skip normal input update
    }

    // Horizontal
    this.x += this.vx;

    // Gravity
    this.vy += GRAVITY;
    this.y += this.vy;

    // Floor collision
    if (this.y > FLOOR) {
      this.y = FLOOR;
      this.vy = 0;
      this.onGround = true;
    }

    // Limit movement inside canvas
    if (this.x < 0) this.x = 0;
    if (this.x + this.width > canvas.width) this.x = canvas.width - this.width;

    // Reduce cooldowns
    if (this.swordCooldown > 0) this.swordCooldown--;
    if (this.fireballCooldown > 0) this.fireballCooldown--;
    if (this.dashCooldown > 0) this.dashCooldown--;

    // Animate
    this.animate();
  }

  animate() {
    this.tick++;
    if (this.tick >= FRAME_SPEED) {
      this.tick = 0;
      this.frame++;
    }

    // Define animation frames per state
    const animFrames = {
      idle: 4,
      walk: 6,
      jump: 2,
      sword: 4,
      fireball: 4,
      dash: 2,
      hit: 1, // single hurt frame
    };

    const maxFrame = animFrames[this.state] || 1;
    if (this.frame >= maxFrame) {
      this.frame = 0;

      // End attack animation → return to idle
      if (["sword", "fireball", "dash"].includes(this.state)) {
        this.state = "idle";
      }
    }
  }

  draw() {
    // sprite sheet row per state
    const rowMap = {
      idle: 0,
      walk: 1,
      jump: 2,
      sword: 3,
      fireball: 4,
      dash: 5,
      hit: 6, // add hurt row
    };

    const row = rowMap[this.state] || 0;
    const sx = this.frame * FRAME_SIZE;
    const sy = row * FRAME_SIZE;

    ctx.drawImage(
      this.sprite,
      sx,
      sy,
      FRAME_SIZE,
      FRAME_SIZE,
      this.x,
      this.y - this.height,
      this.width,
      this.height
    );

    // Draw HP bar
    ctx.fillStyle = "red";
    ctx.fillRect(this.x, this.y - this.height - 15, this.width, 6);
    ctx.fillStyle = "lime";
    ctx.fillRect(this.x, this.y - this.height - 15, (this.width * this.hp) / 100, 6);
  }

  handleInput() {
    if (this.isAI || this.hitStun > 0) return; // disabled during stun

    if (this.keys[this.controls.left]) {
      this.vx = -4;
      if (this.onGround) this.state = "walk";
    } else if (this.keys[this.controls.right]) {
      this.vx = 4;
      if (this.onGround) this.state = "walk";
    } else {
      this.vx = 0;
      if (this.onGround) this.state = "idle";
    }

    if (this.keys[this.controls.jump] && this.onGround) {
      this.vy = -12;
      this.onGround = false;
      this.state = "jump";
    }

    if (this.keys[this.controls.sword] && this.swordCooldown === 0) {
      this.state = "sword";
      this.swordAttack();
      this.swordCooldown = 30;
    }
    if (this.keys[this.controls.fireball] && this.fireballCooldown === 0) {
      this.state = "fireball";
      this.shootFireball();
      this.fireballCooldown = 60;
    }
    if (this.keys[this.controls.dash] && this.dashCooldown === 0) {
      this.state = "dash";
      this.vx *= 3; // burst of speed
      this.dashAttack();
      this.dashCooldown = 90;
    }
  }

  swordAttack() {
    let swordHitbox = {
      x: this.x + (this.color === "red" ? this.width : -20),
      y: this.y - this.height / 2,
      w: 20,
      h: this.height / 2,
    };
    checkDamage(this, swordHitbox, 15);
  }

  shootFireball() {
    let direction = this.color === "red" ? 1 : -1;
    projectiles.push({
      x: this.x + this.width / 2,
      y: this.y - this.height / 2,
      vx: 6 * direction,
      w: 16,
      h: 16,
      owner: this,
    });
  }

  dashAttack() {
    let dashHitbox = {
      x: this.x,
      y: this.y - this.height,
      w: this.width,
      h: this.height,
    };
    checkDamage(this, dashHitbox, 10);
  }
}

// Controls
const controlsP1 = {
  left: "a",
  right: "d",
  jump: "w",
  sword: "f",
  fireball: "g",
  dash: "h",
};
const controlsP2 = {
  left: "ArrowLeft",
  right: "ArrowRight",
  jump: "ArrowUp",
  sword: "k",
  fireball: "l",
  dash: ";",
};

// Players
let player1, player2;

// ===================== GAME LOOP =====================

function initGame(mode) {
  gameMode = mode;
  document.getElementById("menu").classList.add("hidden");
  document.getElementById("difficulty").classList.add("hidden");
  document.getElementById("gameUI").classList.remove("hidden");
  document.getElementById("hud").classList.remove("hidden");

  player1 = new Player(200, "red", controlsP1, redSprite);

  if (mode === "multi") {
    player2 = new Player(600, "blue", controlsP2, blueSprite);
  } else {
    // Single player → AI opponent
    player2 = new Player(600, "blue", controlsP2, blueSprite, true);
  }

  projectiles = [];

  timer = 60;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!isPaused) {
      timer--;
      document.getElementById("timer").innerText = timer;
      if (timer <= 0) endGame("Time’s up!");
    }
  }, 1000);

  requestAnimationFrame(gameLoop);
}

function gameLoop() {
  if (isPaused) {
    requestAnimationFrame(gameLoop);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  player1.handleInput();
  player1.update();
  player1.draw();

  if (player2) {
    if (player2.isAI && player2.hitStun === 0) runAI(player2, player1);
    player2.update();
    player2.draw();
  }

  // Update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    let p = projectiles[i];
    p.x += p.vx;

    ctx.fillStyle = "orange";
    ctx.fillRect(p.x, p.y, p.w, p.h);

    checkDamage(p.owner, p, 20, true);

    // Remove if off-screen
    if (p.x < 0 || p.x > canvas.width) projectiles.splice(i, 1);
  }

  requestAnimationFrame(gameLoop);
}

function endGame(message) {
  clearInterval(timerInterval);
  document.getElementById("announcement").innerText = message;
  document.getElementById("announcement").classList.remove("hidden");
}

// ===================== DAMAGE HANDLING =====================

function checkDamage(attacker, hitbox, damage, isProjectile = false) {
  let target = attacker === player1 ? player2 : player1;
  if (!target || target.hitStun > 0) return;

  if (
    hitbox.x < target.x + target.width &&
    hitbox.x + hitbox.w > target.x &&
    hitbox.y < target.y &&
    hitbox.y + hitbox.h > target.y - target.height
  ) {
    target.hp -= damage;
    target.state = "hit";
    target.hitStun = 20; // stunned for ~20 frames

    // Knockback (based on attacker's position)
    let dir = attacker.x < target.x ? 1 : -1;
    target.vx = 6 * dir;
    target.vy = -6; // bounce upward a bit

    if (target.hp <= 0) {
      endGame(`${attacker.color.toUpperCase()} wins!`);
    }

    if (isProjectile) {
      projectiles = projectiles.filter((p) => p !== hitbox);
    }
  }
}

// ===================== AI BEHAVIOR =====================

function runAI(ai, opponent) {
  // Reset keys
  ai.keys = {};

  if (difficulty === "easy") {
    if (Math.random() < 0.02) ai.vx = -3;
    if (Math.random() < 0.02) ai.vx = 3;
    if (Math.random() < 0.005 && ai.onGround) ai.vy = -10;
    if (Math.random() < 0.02 && ai.swordCooldown === 0) ai.swordAttack();
  }

  if (difficulty === "hard") {
    // Chase
    if (opponent.x < ai.x - 50) ai.vx = -4;
    else if (opponent.x > ai.x + 50) ai.vx = 4;
    else ai.vx = 0;

    if (Math.random() < 0.01 && ai.onGround) {
      ai.vy = -12;
      ai.state = "jump";
    }

    if (Math.random() < 0.03 && ai.swordCooldown === 0) ai.swordAttack();
    if (Math.random() < 0.02 && ai.fireballCooldown === 0) ai.shootFireball();
    if (Math.random() < 0.01 && ai.dashCooldown === 0) ai.dashAttack();
  }
}

// ===================== INPUT =====================

window.addEventListener("keydown", (e) => {
  if (player1) player1.keys[e.key] = true;
  if (player2 && !player2.isAI) player2.keys[e.key] = true;

  if (e.key.toLowerCase() === "p") isPaused = !isPaused;
  if (e.key.toLowerCase() === "r") initGame(gameMode);
});

window.addEventListener("keyup", (e) => {
  if (player1) player1.keys[e.key] = false;
  if (player2 && !player2.isAI) player2.keys[e.key] = false;
});

// ===================== MENU HANDLERS =====================

document.getElementById("btnSingle").onclick = () =>
  document.getElementById("difficulty").classList.remove("hidden");
document.getElementById("btnMulti").onclick = () => initGame("multi");

document.getElementById("btnEasy").onclick = () => {
  difficulty = "easy";
  initGame("single");
};
document.getElementById("btnHard").onclick = () => {
  difficulty = "hard";
  initGame("single");
};
document.getElementById("btnBackFromDifficulty").onclick = () => {
  document.getElementById("difficulty").classList.add("hidden");
};

document.getElementById("backToMenu").onclick = () => location.reload();
document.getElementById("restartBtn").onclick = () => initGame(gameMode);
