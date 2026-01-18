/* Version: #8 - More Math Edition */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- KONFIGURASJON ---
const GRID_SIZE = 50;

// --- STATE ---
let gameState = 'MENU';
let mathMode = null;
let selectedMap = null;
let lives = 20, wave = 1, gold = 100, gems = 0;
let frameCount = 0;
let waveActive = false;
let speedMultiplier = 1;

// Math & Logic State
let mathTasksLeft = 0; 
let pendingActionFunc = null; 

// Difficulty State
let perfectWaveStreak = 0; 
let hardModeActive = false;
let waveEnemiesCrossedHalfway = false;

// Entities
let mapBackgroundImage = null;
let towers = [], enemies = [], projectiles = [], floatingTexts = []; 
let currentPath = [];
let pathSegments = []; 
let pendingBuildPos = null, pendingTowerType = null;
let selectedTower = null; 
let currentMathAnswer = null;
let currentAction = ''; // 'BUILD', 'UPGRADE', 'GEM', 'START_WAVE', 'BOOST'
let audioCtx = null;
let waveEnemiesSpawned = 0;

// Mouse State
let mouseX = 0, mouseY = 0;

// --- DATA ---
const maps = {
    forest: { baseColor: '#2ecc71', pathColor: '#95a5a6', difficultyMult: 1.0, path: [ {x:0, y:100}, {x:700, y:100}, {x:700, y:250}, {x:100, y:250}, {x:100, y:400}, {x:700, y:400}, {x:700, y:550}, {x:800, y:550} ] },
    desert: { baseColor: '#f1c40f', pathColor: '#d35400', difficultyMult: 1.5, path: [ {x:0, y:50}, {x:100, y:50}, {x:100, y:500}, {x:250, y:500}, {x:250, y:100}, {x:400, y:100}, {x:400, y:500}, {x:550, y:500}, {x:550, y:100}, {x:700, y:100}, {x:700, y:400}, {x:800, y:400} ] },
    volcano: { baseColor: '#2c3e50', pathColor: '#333', difficultyMult: 2.0, path: [ {x:0, y:550}, {x:100, y:550}, {x:100, y:100}, {x:300, y:100}, {x:300, y:450}, {x:500, y:450}, {x:500, y:100}, {x:700, y:100}, {x:700, y:500}, {x:800, y:500} ] }
};

const TOWER_STATS = {
    normal: { cost: 25, dmg: 15, range: 150, rate: 40, emoji: '🏹', upgrade: {dmg: 1.2, range: 1.1, cost_base: 50} },
    sniper: { cost: 100, dmg: 65, range: 350, rate: 150, emoji: '🔭', upgrade: {dmg: 1.35, range: 1.1, cost_base: 100} }, 
    rapid:  { cost: 150, dmg: 6, range: 120, rate: 8, emoji: '⚔️', upgrade: {dmg: 1.1, rate_mult: 0.9, cost_base: 125} },
    flame:  { cost: 175, dmg: 3, range: 90, rate: 5, emoji: '🔥', upgrade: {dmg: 1.2, range: 1.05, cost_base: 140} }, 
    ice:    { cost: 125, dmg: 0, range: 150, rate: 50, emoji: '❄️', freeze_duration: 300, upgrade: {freeze_duration_mult: 1.2, cost_base: 80} },
    mine:   { cost: 200, dmg: 0, range: 0, rate: 300, emoji: '⛏️', base_income: 10, upgrade: {income_add: 5, cost_base: 150} } 
};

// --- START LOGIKK ---

function generateMapTexture(mapData) {
    const offCanvas = document.createElement('canvas'); offCanvas.width = 800; offCanvas.height = 600; const oCtx = offCanvas.getContext('2d');
    oCtx.fillStyle = mapData.baseColor; oCtx.fillRect(0, 0, 800, 600);
    return offCanvas;
}

function initGame() {
    if (!selectedMap || !mathMode) return;
    try {
        lives = 20; gold = 100; gems = 0; wave = 1; frameCount = 0;
        towers = []; enemies = []; projectiles = []; floatingTexts = [];
        currentPath = maps[selectedMap].path; 
        
        pathSegments = [];
        for(let i=0; i<currentPath.length-1; i++) {
            pathSegments.push({p1: currentPath[i], p2: currentPath[i+1]});
        }

        mapBackgroundImage = generateMapTexture(maps[selectedMap]);
        
        perfectWaveStreak = 0;
        hardModeActive = false;
        waveEnemiesCrossedHalfway = false;
        
        gameState = 'PLAYING'; 
        waveActive = false; 
        speedMultiplier = 1;
        
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('next-wave-container').classList.remove('hidden');
        document.getElementById('next-wave-num').innerText = wave;
        
        updateUI();
        initAudio(); 
        gameLoop();
    } catch(e) {
        alert("Feil ved oppstart: " + e.message);
    }
}

function gameLoop() {
    if (gameState !== 'PLAYING') return;
    for(let i=0; i<speedMultiplier; i++) updateGame();
    drawGame();
    requestAnimationFrame(gameLoop);
}

function updateGame() {
    if(waveActive) frameCount++;
    
    // Passive Income
    if (waveActive && frameCount % (300 / speedMultiplier) === 0) {
        towers.filter(t => t.type === 'mine').forEach(mine => {
            gold += mine.income;
            if (Math.random() < 0.10) { gems += 1; }
        });
    }

    // Boss Paralyze Check
    const bossPresent = enemies.some(e => e.type === 'boss');
    if (bossPresent && frameCount % (240 / speedMultiplier) === 0) paralyzeTowers();

    // Spawn Logic
    if(waveActive) {
        let enemiesToSpawn = 5 + (wave * 2);
        if (wave % 5 === 0) enemiesToSpawn += 1; 

        let spawnRate = Math.max(20, 80 - (wave * 3)); // Raskere spawn ved høyere waves
        
        if (waveEnemiesSpawned < enemiesToSpawn) { 
            if (frameCount % spawnRate === 0) { 
                spawnEnemy(); 
                waveEnemiesSpawned++; 
            } 
        }
        
        if (enemies.length === 0 && waveEnemiesSpawned >= enemiesToSpawn) endWave();
    }

    // Entities Update
    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];
        e.update();
        if (e.type === 'boss') {
            for (let tIdx = towers.length - 1; tIdx >= 0; tIdx--) {
                let t = towers[tIdx];
                if (Math.hypot(t.x - e.x, t.y - e.y) < 40) {
                    towers.splice(tIdx, 1);
                    floatingTexts.push(new FloatingText(t.x, t.y, "KNUST!", '#ff0000'));
                }
            }
        }
        if (e.finished) {
            lives -= 1; enemies.splice(i, 1);
            if (lives <= 0) { alert("GAME OVER"); gameState = 'MENU'; location.reload(); }
        } else if (e.health <= 0) {
            gold += e.reward; enemies.splice(i, 1);
        }
    }
    
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.update();
        if (p.active === false) projectiles.splice(i, 1);
    }

    towers.forEach(t => t.update());
    
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].update();
        if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
    }

    updateUI();
}

function endWave() {
    waveActive = false; 
    
    if (!waveEnemiesCrossedHalfway) perfectWaveStreak++;
    else perfectWaveStreak = 0;

    if (perfectWaveStreak >= 5 && !hardModeActive) {
        hardModeActive = true;
        alert("HARD MODE AKTIVERT! Monstrene blir sterkere! 💪");
    }

    wave++; 
    waveEnemiesSpawned = 0;
    frameCount = 0;
    
    document.getElementById('next-wave-container').classList.remove('hidden'); 
    document.getElementById('next-wave-num').innerText = wave;
    speedMultiplier = 1; 
    updateSpeedBtn();
}

// NY FUNKSJON FOR Å STARTE BØLGE
function initiateStartWave() {
    currentAction = 'START_WAVE';
    mathTasksLeft = 1;
    openMathModal(`LØS FOR Å STARTE BØLGE ${wave}`);
}

function startNextWave() {
    waveActive = true;
    waveEnemiesSpawned = 0;
    frameCount = 0;
    waveEnemiesCrossedHalfway = false; 
    document.getElementById('next-wave-container').classList.add('hidden');
}

function spawnEnemy() {
    let type = 'normal';
    if (wave % 5 === 0 && waveEnemiesSpawned === (5 + (wave * 2))) type = 'boss';
    else {
        let r = Math.random();
        if (r < 0.25) type = 'tank';
        else if (r < 0.50) type = 'rapid'; 
    }
    enemies.push(new Enemy(type));
}

function paralyzeTowers() {
    towers.forEach(t => t.paralyzed = 0);
    const activeTowers = towers.filter(t => t.type !== 'ice' && t.type !== 'mine');
    const numToParalyze = Math.floor(activeTowers.length / 2);
    const shuffled = activeTowers.sort(() => 0.5 - Math.random());
    shuffled.slice(0, numToParalyze).forEach(t => {
        t.paralyzed = 180; 
    });
}

function toggleSpeed() {
    speedMultiplier = (speedMultiplier === 1) ? 3 : 1;
    updateSpeedBtn();
}

function updateSpeedBtn() {
    const btn = document.getElementById('speed-btn');
    btn.innerText = `⏩ ${speedMultiplier}x`;
    btn.classList.toggle('btn-speed-active', speedMultiplier === 3);
}

// --- GRID & PATH LOGIKK ---
function isPointOnPath(x, y) {
    const pathWidth = 40; 
    for (let seg of pathSegments) {
        let A = x - seg.p1.x, B = y - seg.p1.y, C = seg.p2.x - seg.p1.x, D = seg.p2.y - seg.p1.y;
        let dot = A * C + B * D;
        let len_sq = C * C + D * D;
        let param = -1;
        if (len_sq != 0) param = dot / len_sq;
        let xx, yy;
        if (param < 0) { xx = seg.p1.x; yy = seg.p1.y; }
        else if (param > 1) { xx = seg.p2.x; yy = seg.p2.y; }
        else { xx = seg.p1.x + param * C; yy = seg.p1.y + param * D; }
        let dx = x - xx, dy = y - yy;
        if (Math.hypot(dx, dy) < pathWidth) return true;
    }
    return false;
}

function snapToGrid(x, y) {
    let gx = Math.floor(x / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2;
    let gy = Math.floor(y / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2;
    return {x: gx, y: gy};
}

// --- DRAWING ---
function drawGame() {
    if(mapBackgroundImage) ctx.drawImage(mapBackgroundImage, 0, 0); else ctx.clearRect(0,0,canvas.width,canvas.height);

    let mapData = maps[selectedMap]; 
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; 
    
    // Path
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 55; ctx.beginPath(); ctx.moveTo(mapData.path[0].x, mapData.path[0].y + 5); 
    mapData.path.forEach(p => ctx.lineTo(p.x, p.y + 5)); ctx.stroke(); 
    ctx.strokeStyle = mapData.pathColor; ctx.lineWidth = 45; ctx.beginPath(); ctx.moveTo(mapData.path[0].x, mapData.path[0].y); 
    mapData.path.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    
    // Grid & Hover
    if (gameState === 'PLAYING') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 1;
        for (let x = 0; x <= canvas.width; x += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
        for (let y = 0; y <= canvas.height; y += GRID_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
        
        if (document.getElementById('tower-select-overlay').classList.contains('hidden')) {
            let snapped = snapToGrid(mouseX, mouseY);
            let onPath = isPointOnPath(snapped.x, snapped.y);
            let hasTower = towers.some(t => t.x === snapped.x && t.y === snapped.y);
            
            // Fargeindikator for grid: Rød hvis opptatt/vei, Grønn hvis ledig, Blå hvis oppgradering (når du holder over tårn)
            if (hasTower) ctx.fillStyle = 'rgba(0, 0, 255, 0.3)';
            else if (onPath) ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            else ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            
            ctx.fillRect(snapped.x - GRID_SIZE/2, snapped.y - GRID_SIZE/2, GRID_SIZE, GRID_SIZE);
        }
    }

    towers.forEach(t => t.draw());
    enemies.forEach(e => e.draw());
    projectiles.forEach(p => p.draw());
    
    ctx.font = 'bold 14px Arial';
    floatingTexts.forEach(t => {
        ctx.fillStyle = t.color || `rgba(255, 255, 255, ${t.life / 30})`;
        ctx.fillText(t.text, t.x, t.y);
    });
}

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

// --- KLASSER ---
class Enemy {
    constructor(type) {
        this.pathIdx = 0; this.x = currentPath[0].x; this.y = currentPath[0].y;
        this.type = type; this.finished = false; this.frozen = 0;
        
        let difficultyBoost = hardModeActive ? 1.3 : 1.0;
        // Økt HP skalering for å balansere spillet
        const HP_SCALE = (1 + (wave * 0.25)) * difficultyBoost; 
        const SPEED_SCALE = 1 + (wave * 0.05);
        
        if (type === 'normal') { this.baseSpeed=1.5 * SPEED_SCALE; this.maxHp=35*HP_SCALE; this.emoji='👾'; this.reward=5; }
        if (type === 'tank')   { this.baseSpeed=0.8 * SPEED_SCALE; this.maxHp=120*HP_SCALE; this.emoji='🐗'; this.reward=15; }
        if (type === 'rapid')  { this.baseSpeed=3.0 * SPEED_SCALE; this.maxHp=20*HP_SCALE; this.emoji='🦇'; this.reward=8; }
        if (type === 'boss')   { this.baseSpeed=0.6 * SPEED_SCALE; this.maxHp=400*HP_SCALE; this.emoji='👹'; this.reward=50; }
        
        this.speed = this.baseSpeed;
        this.health = this.maxHp;
        
        this.totalDist = 0;
        for(let i=0; i<currentPath.length-1; i++) this.totalDist += Math.hypot(currentPath[i+1].x-currentPath[i].x, currentPath[i+1].y-currentPath[i].y);
        this.traveledDist = 0;
    }
    update() {
        if (this.frozen > 0) { this.frozen--; this.speed = 0; return; }
        this.speed = this.baseSpeed; 
        
        let target = currentPath[this.pathIdx + 1]; 
        if (!target) { this.finished = true; return; }
        
        let dx = target.x - this.x; let dy = target.y - this.y; 
        let dist = Math.hypot(dx, dy); 
        let moveDist = Math.min(dist, this.speed);
        this.x += (dx/dist) * moveDist;
        this.y += (dy/dist) * moveDist;
        this.traveledDist += moveDist;

        if (this.traveledDist / this.totalDist > 0.5) waveEnemiesCrossedHalfway = true;
        if (dist < this.speed) { this.x = target.x; this.y = target.y; this.pathIdx++; } 
    }
    draw() {
        if (this.frozen > 0) {
            ctx.fillStyle = 'rgba(0, 191, 255, 0.4)'; 
            ctx.beginPath(); ctx.arc(this.x, this.y, 15, 0, Math.PI * 2); ctx.fill();
        }
        ctx.font = (this.type === 'boss') ? '36px Arial' : '24px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff'; ctx.fillText(this.emoji, this.x, this.y);
        
        let hpPct = this.health / this.maxHp;
        ctx.fillStyle = 'red'; ctx.fillRect(this.x - 10, this.y - 20, 20, 4);
        ctx.fillStyle = 'lime'; ctx.fillRect(this.x - 10, this.y - 20, 20 * hpPct, 4);
    }
}

class Tower {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.type = type;
        this.level = 1; this.cooldown = 0; this.paralyzed = 0;
        this.hasGem = false; 
        this.boostTimer = 0; // Ny funksjon: Boost fra matte
        const stats = TOWER_STATS[type];
        this.dmg = stats.dmg; this.range = stats.range; this.rate = stats.rate; this.emoji = stats.emoji;
        
        if (type === 'ice') this.freeze_duration = stats.freeze_duration;
        if (type === 'mine') this.income = stats.base_income;
    }
    update() {
        if (this.paralyzed > 0) { this.paralyzed--; return; } 
        if (this.boostTimer > 0) this.boostTimer--; // Tell ned boost

        if(this.type === 'mine') return; 

        if (this.cooldown > 0) this.cooldown--;
        if (this.cooldown <= 0) {
            let target = null, minDst = Infinity;
            for (let e of enemies) {
                let d = Math.hypot(e.x - this.x, e.y - this.y);
                if (d <= this.range && d < minDst) { minDst = d; target = e; }
            }
            if (target) {
                projectiles.push(new Projectile(this.x, this.y, target, this.type, this.dmg * (this.hasGem ? 1.5 : 1), this.freeze_duration));
                // Hvis boostet: Halv cooldown (dobbelt så rask)
                this.cooldown = (this.boostTimer > 0) ? this.rate / 2 : this.rate;
            }
        }
    }
    draw() {
        // Visuell effekt for boost
        if (this.boostTimer > 0) {
            ctx.shadowBlur = 15; ctx.shadowColor = "#39ff14"; // Neon green glow
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = this.paralyzed > 0 ? '#444' : (this.type === 'mine' ? '#f1c40f' : '#7f8c8d');
        ctx.fillRect(this.x - 15, this.y - 15, 30, 30);
        ctx.shadowBlur = 0; // Reset glow

        ctx.font = '24px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.emoji, this.x, this.y);
        
        if (this.hasGem) {
            ctx.fillStyle = 'purple';
            ctx.beginPath(); ctx.arc(this.x + 10, this.y - 10, 5, 0, Math.PI * 2); ctx.fill();
        }
        if (this.boostTimer > 0) {
            ctx.fillStyle = '#39ff14'; ctx.font = 'bold 10px Arial';
            ctx.fillText("BOOST!", this.x, this.y - 20);
        }
        
        ctx.fillStyle = 'yellow'; ctx.font = '10px Courier New';
        ctx.fillText("Lvl " + this.level, this.x + 15, this.y + 15);
        if(this.type === 'mine') {
            ctx.fillStyle = 'white'; ctx.font = '8px Courier New'; ctx.fillText(`+${this.income} G`, this.x, this.y + 15);
        }
    }
}

class Projectile {
    constructor(x, y, target, type, dmg, freeze_duration = 0) {
        this.x = x; this.y = y; this.target = target; this.type = type; this.dmg = dmg;
        this.speed = 15; this.active = true; this.freeze_duration = freeze_duration;
    }
    update() {
        if (!this.target || this.target.health <= 0) { this.active = false; return; }
        let dx = this.target.x - this.x, dy = this.target.y - this.y;
        let dist = Math.hypot(dx, dy);
        if (dist < this.speed) {
            this.active = false;
            if (this.type === 'ice') this.target.frozen = this.freeze_duration;
            else {
                this.target.health -= this.dmg;
                floatingTexts.push(new FloatingText(this.target.x, this.target.y, Math.round(this.dmg)));
            }
        } else { this.x += (dx/dist)*this.speed; this.y += (dy/dist)*this.speed; }
    }
    draw() {
        if (this.type === 'ice') ctx.fillStyle = '#00ffff';
        else if (this.type === 'flame') ctx.fillStyle = '#ff4500';
        else ctx.fillStyle = '#ffff00';
        ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI * 2); ctx.fill();
    }
}

class FloatingText {
    constructor(x, y, text, color) {
        this.x = x; this.y = y - 10;
        this.text = text.toString().startsWith("KNUST") ? text : "-" + text;
        this.life = 30; this.vy = -1; this.color = color;
    }
    update() { this.y += this.vy; this.life--; }
}

// --- UI FUNKSJONER ---
function updateUI() {
    document.getElementById('lives-display').innerText = lives;
    document.getElementById('wave-display').innerText = wave;
    document.getElementById('gold-display').innerText = gold;
    document.getElementById('gems-display').innerText = gems;
}

function selectMap(btn, mapName) { 
    selectedMap = mapName; 
    [...btn.parentElement.children].forEach(c => {if(c.tagName==='BUTTON') c.classList.remove('selected-btn')}); 
    btn.classList.add('selected-btn'); checkStartReady(); 
}
function setMathMode(btn, mode) { 
    mathMode = mode; 
    [...btn.parentElement.children].forEach(c => {if(c.tagName==='BUTTON') c.classList.remove('selected-btn')}); 
    btn.classList.add('selected-btn'); checkStartReady(); 
}
function checkStartReady() { document.getElementById('start-btn').disabled = !(selectedMap && mathMode); }
function backToMenu() {
    if(!confirm("Avslutte til meny?")) return;
    gameState = 'MENU';
    document.getElementById('start-screen').classList.remove('hidden');
    document.getElementById('next-wave-container').classList.add('hidden');
}

// INTERAKSJON LOGIKK
document.getElementById('gameCanvas').addEventListener('mousedown', function(e) {
    if (gameState !== 'PLAYING') return;
    
    let clickedTower = towers.find(t => Math.hypot(t.x - mouseX, t.y - mouseY) < 30);
    
    // NY LOGIKK: Hvis bølge er aktiv, aktiver SUPER-BOOST istedenfor oppgradering
    if (clickedTower) {
        if (waveActive && clickedTower.type !== 'mine') {
            selectedTower = clickedTower;
            initiateBoost(clickedTower);
        } else {
            // Hvis bølge ikke er aktiv (eller det er en gruve), åpne vanlig meny
            selectedTower = clickedTower;
            openUpgradeMenu();
        }
        return;
    }

    if (waveActive) return; // Kan ikke bygge nye tårn mens bølgen går

    let snapped = snapToGrid(mouseX, mouseY);
    if (isPointOnPath(snapped.x, snapped.y)) { alert("Kan ikke bygge på veien!"); return; }
    if (towers.some(t => t.x === snapped.x && t.y === snapped.y)) return; 

    pendingBuildPos = snapped;
    document.getElementById('tower-select-overlay').classList.remove('hidden');
});

function selectTowerType(type) {
    const cost = TOWER_STATS[type].cost;
    if (gold < cost) { alert("TRENGER MER GULL! (" + cost + " G)"); return; }
    pendingTowerType = type; 
    currentAction = 'BUILD';
    mathTasksLeft = 1; 
    closeTowerMenu(); 
    openMathModal("BYGG " + (type === 'mine' ? 'GRUVE' : type.toUpperCase()));
}

function openUpgradeMenu() {
    const stats = TOWER_STATS[selectedTower.type];
    const base_cost = stats.cost;
    
    let cost;
    if (selectedTower.type === 'mine') {
        cost = selectedTower.level * stats.upgrade.cost_base;
        document.getElementById('mine-income-display').style.display = 'block';
        document.getElementById('mine-income-value').innerText = selectedTower.income;
    } else {
        cost = selectedTower.level * stats.upgrade.cost_base;
        document.getElementById('mine-income-display').style.display = 'none';
    }

    const sellValue = Math.floor((base_cost + ((selectedTower.level - 1) * cost)) / 2); 
    document.getElementById('selected-tower-level').innerText = selectedTower.level;
    document.getElementById('upgrade-cost').innerText = cost;
    document.getElementById('sell-value').innerText = sellValue;
    document.getElementById('upgrade-title').innerText = selectedTower.type.toUpperCase() + (selectedTower.type === 'mine' ? '' : ' TÅRN');
    
    const gemBtn = document.getElementById('btn-insert-gem');
    if (selectedTower.type !== 'mine' && selectedTower.hasGem !== true && gems > 0) gemBtn.classList.remove('hidden');
    else gemBtn.classList.add('hidden');

    document.getElementById('tower-upgrade-overlay').classList.remove('hidden');
}

function initiateUpgrade() {
    const stats = TOWER_STATS[selectedTower.type];
    let cost = selectedTower.level * stats.upgrade.cost_base;
    if (gold < cost) { alert("TRENGER MER GULL! (" + cost + " G)"); return; }
    currentAction = 'UPGRADE'; mathTasksLeft = 2; 
    closeUpgradeMenu();
    openMathModal("OPPGRADER " + selectedTower.type.toUpperCase() + " (1/2)");
}

function initiateGem() {
    if (gems < 1) return;
    currentAction = 'GEM'; mathTasksLeft = 1;
    closeUpgradeMenu(); openMathModal("FORSTERK TÅRN");
}

function initiateBoost(tower) {
    currentAction = 'BOOST';
    mathTasksLeft = 1;
    openMathModal("BOOST TÅRN (Dobbel fart 5s)!");
}

function sellTower() {
    const sellValue = parseInt(document.getElementById('sell-value').innerText);
    gold += sellValue;
    const index = towers.indexOf(selectedTower);
    if (index > -1) towers.splice(index, 1);
    closeUpgradeMenu();
}

function closeTowerMenu() { document.getElementById('tower-select-overlay').classList.add('hidden'); }
function closeUpgradeMenu() { document.getElementById('tower-upgrade-overlay').classList.add('hidden'); }

// --- MATTE MODAL FUNKSJONER ---
function performAction() {
    if (currentAction === 'START_WAVE') {
        startNextWave();
    } else if (currentAction === 'BOOST') {
        // Boost effekten: Dobbel skuddtakt (halv cooldown) i 300 frames (ca 5 sekunder ved 60fps)
        selectedTower.boostTimer = 300; 
        floatingTexts.push(new FloatingText(selectedTower.x, selectedTower.y, "BOOST!", "#39ff14"));
    } else if (currentAction === 'BUILD') {
        const stats = TOWER_STATS[pendingTowerType];
        const t = new Tower(pendingBuildPos.x, pendingBuildPos.y, pendingTowerType);
        towers.push(t);
        gold -= stats.cost;
    } else if (currentAction === 'UPGRADE') {
        const t = selectedTower;
        const stats = TOWER_STATS[t.type];
        let cost = t.level * stats.upgrade.cost_base;
        t.level++; gold -= cost;
        
        if (t.type === 'mine') t.income += stats.upgrade.income_add;
        else if (t.type === 'ice') t.freeze_duration = Math.round(t.freeze_duration * stats.upgrade.freeze_duration_mult);
        else if (t.type === 'rapid') { t.rate = Math.round(t.rate * stats.upgrade.rate_mult); t.dmg = Math.round(t.dmg * stats.upgrade.dmg); }
        else { t.dmg = Math.round(t.dmg * stats.upgrade.dmg); t.range = Math.round(t.range * stats.upgrade.range); }
    } else if (currentAction === 'GEM') {
        selectedTower.hasGem = true;
        selectedTower.dmg = Math.round(selectedTower.dmg * 1.5); 
        gems -= 1;
    }
}

function generateQuestion() {
    const r = (max) => Math.floor(Math.random() * max) + 1;
    let diffFactor = maps[selectedMap].difficultyMult + (wave * 0.5); 
    let q, a;
    
    if(mathMode==='add_sub'){ 
        let range = 20 + Math.floor(diffFactor * 5); 
        let n1=r(range), n2=r(range); 
        if(Math.random()>0.5){q=`${n1} + ${n2}`;a=n1+n2} else{if(n1<n2)[n1,n2]=[n2,n1];q=`${n1} - ${n2}`;a=n1-n2}
    }
    else if(mathMode==='mult_div'){ 
        let range = Math.min(12, 5 + Math.ceil(diffFactor/2)); 
        let n1=r(range)+1, n2=r(range)+1; 
        if(Math.random()>0.5){q=`${n1} × ${n2}`;a=n1*n2} else{let p=n1*n2;q=`${p} : ${n1}`;a=n2}
    }
    else if(mathMode==='frac_add_sub'){ 
        let d= (r(3)+2)*2, n1=r(d-1), n2=r(d-1); 
        if(Math.random()>0.5){q=`${n1}/${d} + ${n2}/${d}`;a=`${n1+n2}/${d}`} else{if(n1<n2)[n1,n2]=[n2,n1];q=`${n1}/${d} - ${n2}/${d}`;a=`${n1-n2}/${d}`}} 
    else if(mathMode==='frac_mult_div'){ 
        let range = 3 + Math.floor(diffFactor/3);
        let n1=r(range),d1=r(range)+1,n2=r(range),d2=r(range)+1; 
        q=`${n1}/${d1} × ${n2}/${d2}`; a=`${n1*n2}/${d1*d2}`; 
    }
    return {question:q, answer:a};
}

function checkAnswer() {
    const input = document.getElementById('math-answer');
    const userVal = input.value.trim();
    let isCorrect = false;
    
    if (String(currentMathAnswer).includes('/')) {
         if (!userVal.includes('/')) isCorrect = (parseFloat(userVal) == eval(currentMathAnswer)); 
         else { 
             const [uN, uD] = userVal.split('/').map(Number); 
             const [cN, cD] = currentMathAnswer.split('/').map(Number); 
             if (uD && cD && (uN * cD === cN * uD)) isCorrect = true; 
         }
    } else { if (parseInt(userVal) === parseInt(currentMathAnswer)) isCorrect = true; }

    if (isCorrect) {
        mathTasksLeft--;
        if (mathTasksLeft > 0) {
            document.getElementById('math-feedback').innerText = "RIKTIG! EN TIL... 🧠";
            document.getElementById('math-header').innerText = `OPPGRADER ${selectedTower.type.toUpperCase()} (2/2)`;
            let qa = generateQuestion();
            document.getElementById('math-question').innerText = qa.question;
            currentMathAnswer = qa.answer;
            input.value = ''; input.focus();
        } else {
            performAction(); closeModal();
        }
    } else {
        input.style.borderColor = 'red';
        document.getElementById('math-feedback').innerText = "FEIL! PRØV IGJEN.";
        setTimeout(() => { input.style.borderColor = '#bdc3c7'; }, 500);
    }
}

function openMathModal(title) { 
    gameState = 'MODAL'; 
    document.getElementById('math-overlay').classList.remove('hidden'); 
    document.getElementById('math-header').innerText = title; 
    document.getElementById('math-feedback').innerText = ""; 
    let qa = generateQuestion(); 
    document.getElementById('math-question').innerText = qa.question; 
    currentMathAnswer = qa.answer; 
    let input = document.getElementById('math-answer'); 
    input.value = ''; input.focus(); 
}

function closeModal() { 
    document.getElementById('math-overlay').classList.add('hidden'); 
    gameState = 'PLAYING'; gameLoop(); 
}

function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
document.getElementById('math-answer').addEventListener("keypress", function(e) { if (e.key === "Enter") checkAnswer(); });
