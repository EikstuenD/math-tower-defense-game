/* Version: #13 - Initialization Fix */

// Globale variabler
let canvas = null;
let ctx = null;

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
let currentAction = ''; 
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
    if (!selectedMap || !mathMode) { alert("Velg kart og tema først!"); return; }
    
    // Hent canvas på nytt for sikkerhets skyld
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

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
        
        requestAnimationFrame(gameLoop);
    } catch(e) {
        console.error(e);
        alert("Feil ved oppstart: " + e.message);
    }
}

function gameLoop() {
    if (gameState !== 'PLAYING') return;

    const overlay = document.getElementById('tower-select-overlay');
    const isBuildMenuOpen = overlay && !overlay.classList.contains('hidden');
    
    if (!isBuildMenuOpen) {
        for(let i=0; i<speedMultiplier; i++) updateGame();
    }
    
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

    const bossPresent = enemies.some(e => e.type === 'boss');
    if (bossPresent && frameCount % (240 / speedMultiplier) === 0) paralyzeTowers();

    if(waveActive) {
        let enemiesToSpawn = 5 + (wave * 2);
        if (wave % 5 === 0) enemiesToSpawn += 1; 

        let spawnRate = Math.max(20, 80 - (wave * 3)); 
        
        if (waveEnemiesSpawned < enemiesToSpawn) { 
            if (frameCount % spawnRate === 0) { 
                spawnEnemy(); 
                waveEnemiesSpawned++; 
            } 
        }
        
        if (enemies.length === 0 && waveEnemiesSpawned >= enemiesToSpawn) endWave();
    }

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
    if (!waveEnemiesCrossedHalfway) perfectWaveStreak++; else perfectWaveStreak = 0;
    if (perfectWaveStreak >= 5 && !hardModeActive) { hardModeActive = true; alert("HARD MODE AKTIVERT! Monstrene blir sterkere! 💪"); }

    wave++; waveEnemiesSpawned = 0; frameCount = 0;
    document.getElementById('next-wave-container').classList.remove('hidden'); 
    document.getElementById('next-wave-num').innerText = wave;
    speedMultiplier = 1; updateSpeedBtn();
}

function initiateStartWave() {
    currentAction = 'START_WAVE'; mathTasksLeft = 1;
    openMathModal(`LØS FOR Å STARTE BØLGE ${wave}`);
}

function startNextWave() {
    waveActive = true; waveEnemiesSpawned = 0; frameCount = 0; waveEnemiesCrossedHalfway = false; 
    document.getElementById('next-wave-container').classList.add('hidden');
}

function spawnEnemy() {
    let type = 'normal';
    if (wave % 5 === 0 && waveEnemiesSpawned === (5 + (wave * 2))) type = 'boss';
    else { let r = Math.random(); if (r < 0.25) type = 'tank'; else if (r < 0.50) type = 'rapid'; }
    enemies.push(new Enemy(type));
}

function paralyzeTowers() {
    towers.forEach(t => t.paralyzed = 0);
    const activeTowers = towers.filter(t => t.type !== 'ice' && t.type !== 'mine');
    const numToParalyze = Math.floor(activeTowers.length / 2);
    const shuffled = activeTowers.sort(() => 0.5 - Math.random());
    shuffled.slice(0, numToParalyze).forEach(t => { t.paralyzed = 180; });
}

function toggleSpeed() {
    speedMultiplier = (speedMultiplier === 1) ? 3 : 1;
    updateSpeedBtn();
}

function updateSpeedBtn() {
    const btn = document.getElementById('speed-btn');
    if(btn) { btn.innerText = `⏩ ${speedMultiplier}x`; btn.classList.toggle('btn-speed-active', speedMultiplier === 3); }
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
    if (!ctx || !
