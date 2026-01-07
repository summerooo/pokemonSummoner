
import { Hands, HAND_CONNECTIONS, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import './style.css';

const videoElement = document.getElementById('webcam') as HTMLVideoElement;
const canvasElement = document.getElementById('canvas-output') as HTMLCanvasElement;
const canvasDrawing = document.getElementById('canvas-drawing') as HTMLCanvasElement;
const statusElement = document.getElementById('status') as HTMLElement;
const powerFill = document.getElementById('power-fill') as HTMLElement;
const summoningCircle = document.getElementById('summoning-circle') as HTMLElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLElement;

const ctx = canvasElement.getContext('2d')!;
const drawCtx = canvasDrawing.getContext('2d')!;

let hands: Hands;
let camera: Camera;
let isDrawing = false;
let lastPoint: { x: number, y: number } | null = null;
let powerLevel = 0;
let isSummoning = false;

const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const loadingText = document.getElementById('loading-text') as HTMLElement;

const progressFill = document.getElementById('loading-progress-fill') as HTMLElement;

function updateProgress(percent: number, text?: string) {
    progressFill.style.width = `${percent}%`;
    if (text) loadingText.innerText = text;
}

async function initHands() {
    updateProgress(10, '正在初始化神经网络...');
    
    hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, 
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    hands.onResults((results) => {
        // First result means model is ready
        if (loadingScreen.style.display !== 'none') {
            updateProgress(100, '连接成功！');
            setTimeout(() => {
                loadingScreen.style.display = 'none';
                statusElement.innerText = '系统就绪：请伸出食指画符';
                const videoContainer = document.getElementById('video-container');
                if (videoContainer) videoContainer.style.opacity = '0.4';
            }, 500);
        }
        onResults(results);
    });

    const closeInstructions = document.getElementById('close-instructions');
    const instructionsPanel = document.getElementById('instructions');
    if (closeInstructions && instructionsPanel) {
        closeInstructions.onclick = () => {
            instructionsPanel.classList.add('hidden');
        };
    }

    updateProgress(30, '感应器准备就绪');
    startBtn.classList.remove('hidden');
    
    startBtn.onclick = async () => {
        startBtn.disabled = true;
        updateProgress(50, '正在启动摄像头...');
        
        camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });

        try {
            await camera.start();
            updateProgress(70, '正在加载手势模型 (首次约10秒)...');
            // Success call will happen in onResults
        } catch (err) {
            console.error("Camera error:", err);
            updateProgress(70, `启动失败: 请检查摄像头权限`);
            startBtn.disabled = false;
        }
    };
}

function onResults(results: Results) {
    if (canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = canvasDrawing.width = videoElement.videoWidth;
        canvasElement.height = canvasDrawing.height = videoElement.videoHeight;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // IMPORTANT: Mirror the context to match the mirrored CSS video
    ctx.translate(canvasElement.width, 0);
    ctx.scale(-1, 1);
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        
        // Use mirrored landmarks for drawing logic
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00f2ff', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: '#7000ff', lineWidth: 1, radius: 2 });

        handleDrawing(landmarks);
        checkSummonGesture(landmarks);
    } else {
        lastPoint = null;
        isDrawing = false;
    }
    
    ctx.restore();
}

const countdownElement = document.getElementById('countdown') as HTMLElement;
let countdownTimer: number | null = null;
let isCountingDown = false;
let canDraw = false;
let lostPointingCounter = 0; // Number of frames pointing was lost
const GRACE_PERIOD_FRAMES = 10; // Allow 10 frames of jitter/loss

function handleDrawing(landmarks: any) {
    const indexTip = landmarks[8];
    const indexMCP = landmarks[5];
    const indexPIP = landmarks[6];
    
    // Improved "Pointing" detection: tip is higher than joint and MCP
    const isPointingNow = indexTip.y < indexPIP.y - 0.05 && indexTip.y < indexMCP.y - 0.1;

    if (isPointingNow) {
        lostPointingCounter = 0; // Reset lost counter
    } else {
        lostPointingCounter++;
    }

    const effectivelyPointing = lostPointingCounter < GRACE_PERIOD_FRAMES;

    if (effectivelyPointing && !isSummoning) {
        if (!canDraw && !isCountingDown) {
            startCountdown();
            return;
        }

        if (!canDraw) return;

        // x is [0,1], mirrored for draw layer
        const x = (1 - indexTip.x) * canvasDrawing.width;
        const y = indexTip.y * canvasDrawing.height;

        // Draw brush on status canvas
        ctx.beginPath();
        ctx.arc(indexTip.x * canvasElement.width, indexTip.y * canvasElement.height, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#00f2ff';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00f2ff';
        ctx.fill();

        if (!isDrawing) {
            isDrawing = true;
            drawCtx.beginPath();
            drawCtx.moveTo(x, y);
        } else {
            drawCtx.strokeStyle = '#00f2ff';
            drawCtx.lineWidth = 4; // Thinner stroke
            drawCtx.lineCap = 'round';
            drawCtx.lineJoin = 'round';
            drawCtx.shadowBlur = 10;
            drawCtx.shadowColor = '#00f2ff';
            drawCtx.lineTo(x, y);
            drawCtx.stroke();
            
            if (lastPoint) {
                const dist = Math.sqrt(Math.pow(x - lastPoint.x, 2) + Math.pow(y - lastPoint.y, 2));
                // Only count dist if hand was actually seen this frame (prevent jumps across gaps)
                if (isPointingNow) updatePower(dist);
            }
        }
        lastPoint = { x, y };
    } else {
        // If we really lost the hand for more than 10 frames
        if (isDrawing) {
            isDrawing = false;
            lastPoint = null;
        }
        
        // Only cancel countdown, don't reset canDraw. 
        // canDraw stays true until summon or explicit reset.
        if (isCountingDown) {
            cancelCountdown();
        }
    }
}

function startCountdown() {
    if (isCountingDown || canDraw) return;
    isCountingDown = true;
    let count = 2;
    countdownElement.innerText = count.toString();
    countdownElement.classList.remove('hidden');
    
    countdownTimer = window.setInterval(() => {
        count--;
        if (count > 0) {
            countdownElement.innerText = count.toString();
        } else if (count === 0) {
            countdownElement.innerText = "GO!";
            canDraw = true;
            isCountingDown = false;
            if (countdownTimer) clearInterval(countdownTimer);
            setTimeout(() => {
                countdownElement.classList.add('hidden');
            }, 500);
        }
    }, 1000);
}

function cancelCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownElement.classList.add('hidden');
    isCountingDown = false;
    // Note: We do NOT reset canDraw here anymore.
}

function updatePower(dist: number) {
    powerLevel = Math.min(powerLevel + dist * 0.08, 100);
    powerFill.style.height = `${powerLevel}%`;
    
    if (powerLevel > 80) {
        statusElement.innerText = '能量充盈！比出 👌 召唤！';
        statusElement.style.color = '#ffd700';
    }
}


function startSummoning() {
    isSummoning = true;
    statusElement.innerText = '正在感应时空... 召唤！';
    summoningCircle.classList.add('active');
    
    setTimeout(() => {
        performSummon();
    }, 2000);
}

function performSummon() {
    let rarity: 'common' | 'holo' | 'gold' = 'common';
    let rarityPower = 1;
    
    if (powerLevel > 90) {
        rarity = 'gold';
        rarityPower = 3;
    } else if (powerLevel > 60) {
        rarity = 'holo';
        rarityPower = 2;
    }
    
    const pools = {
        1: [ { name: 'Bulbasaur', id: 1 }, { name: 'Charmander', id: 4 }, { name: 'Squirtle', id: 7 }, { name: 'Pikachu', id: 25 }, { name: 'Eevee', id: 133 } ],
        2: [ { name: 'Charizard', id: 6 }, { name: 'Blastoise', id: 9 }, { name: 'Venusaur', id: 3 }, { name: 'Gengar', id: 94 }, { name: 'Dragonite', id: 149 } ],
        3: [ { name: 'Mewtwo', id: 150 }, { name: 'Mew', id: 151 }, { name: 'Lugia', id: 249 }, { name: 'Rayquaza', id: 384 }, { name: 'Arceus', id: 493 } ]
    };

    //@ts-ignore
    const selectedPool = pools[rarityPower];
    const selectedCard = selectedPool[Math.floor(Math.random() * selectedPool.length)];

    (window as any)._currentRarity = rarity; // Store rarity for collection
    injectCardUI(selectedCard, rarity);
}

function injectCardUI(card: any, rarity: string, isPreview: boolean = false) {
    const area = document.getElementById('card-summon-area')!;
    
    // Create card with official structure
    area.innerHTML = `
        <div class="pokemon-card-container">
            <div class="card-rarity-label">${rarity.toUpperCase()}</div>
            <div class="card-mockup" id="summoned-card">
                <div class="foil-layer"></div>
                <div class="card-header">
                    <span>BASIC ${card.name}</span>
                    <span>70 HP ⚡</span>
                </div>
                <div class="card-image-container">
                    <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${card.id}.png" alt="${card.name}">
                </div>
                <div class="card-info">
                    <h2>${card.name}</h2>
                    <p class="desc">Wild Charge: This Pokemon also does 30 damage to itself.</p>
                </div>
            </div>
            ${isPreview ? '<button id="close-preview">返回</button>' : ''}
        </div>
    `;

    // Trigger appearance
    setTimeout(() => {
        area.querySelector('.pokemon-card-container')?.classList.add('appear');
    }, 100);
    
    if (!isPreview) {
        statusElement.innerText = `成功召唤：${card.name} (${rarity})`;
    }
    
    // Close preview handler
    if (isPreview) {
        const closeBtn = document.getElementById('close-preview');
        if (closeBtn) closeBtn.onclick = () => resetSystem();
    }

    // Add interactive tilt effect
    const cardEl = document.getElementById('summoned-card');
    if (cardEl) {
        const moveHandler = (e: any) => handleTilt(e, cardEl);
        const touchHandler = (e: any) => {
            if (e.touches[0]) handleTilt(e.touches[0], cardEl);
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('touchmove', touchHandler, { passive: true });
        
        // Store for cleanup
        (cardEl as any)._cleanup = () => {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('touchmove', touchHandler);
        };
    }
    
    if (!isPreview) {
        // Auto reset if not collected
        (window as any)._summonTimeout = setTimeout(() => {
            resetSystem();
        }, 15000);
        (window as any)._currentSummonedCard = card;
    }
}

function handleTilt(e: any, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = (centerY - y) / 10;
    const rotateY = (x - centerX) / 10;
    
    el.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    
    // Update glare position for image window
    const imageContainer = el.querySelector('.card-image-container') as HTMLElement;
    if (imageContainer) {
        imageContainer.style.setProperty('--mx', `${(x / rect.width) * 100}%`);
        imageContainer.style.setProperty('--my', `${(y / rect.height) * 100}%`);
    }
}

let inventory: any[] = [];

function checkSummonGesture(landmarks: any) {
    if (isSummoning) {
        // Check for ✋🏻 (Open Palm) to collect
        const tipIndices = [8, 12, 16, 20];
        const baseIndices = [5, 9, 13, 17];
        
        const isOpenPalm = tipIndices.every((index, i) => landmarks[index].y < landmarks[baseIndices[i]].y - 0.1);

        if (isOpenPalm && (window as any)._currentSummonedCard) {
            collectCard();
        }
        return;
    }

    if (powerLevel < 30) return;
    
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    
    const distance = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 2) + 
        Math.pow(thumbTip.y - indexTip.y, 2)
    );

    const isOk = distance < 0.06 && middleTip.y < landmarks[9].y;

    if (isOk) {
        startSummoning();
    }
}

function collectCard() {
    const card = (window as any)._currentSummonedCard;
    if (!card) return;
    const rarity = (window as any)._currentRarity || 'common';
    (window as any)._currentSummonedCard = null;
    clearTimeout((window as any)._summonTimeout);

    const container = document.querySelector('.pokemon-card-container') as HTMLElement;
    if (container) {
        container.classList.add('flying');
    }

    statusElement.innerText = `已将 ${card.name} 收入卡槽！`;
    
    setTimeout(() => {
        addToInventory(card, rarity);
        resetSystem();
    }, 1000);
}

function addToInventory(card: any, rarity: string) {
    if (inventory.length >= 5) {
        inventory.shift(); // Remove oldest if full
    }
    inventory.push({ ...card, rarity });
    updateInventoryUI();
}

function updateInventoryUI() {
    const slotsList = document.getElementById('slots-list')!;
    slotsList.innerHTML = '';
    
    for (let i = 0; i < 5; i++) {
        const item = inventory[i];
        if (item) {
            const slot = document.createElement('div');
            slot.className = 'filled-slot';
            slot.innerHTML = `<img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${item.id}.png" alt="${item.name}">`;
            slot.onclick = () => {
                if (!isSummoning) {
                    injectCardUI(item, item.rarity || 'common', true);
                    statusElement.innerText = `查看收藏：${item.name}`;
                }
            };
            slotsList.appendChild(slot);
        } else {
            const slot = document.createElement('div');
            slot.className = 'empty-slot';
            slotsList.appendChild(slot);
        }
    }
}

function resetSystem() {
    const cardEl = document.getElementById('summoned-card');
    if (cardEl && (cardEl as any)._cleanup) (cardEl as any)._cleanup();

    isSummoning = false;
    canDraw = false; // Reset drawing readiness
    powerLevel = 0;
    powerFill.style.height = '0%';
    summoningCircle.classList.remove('active');
    statusElement.innerText = '准备就绪：请伸出食指画符';
    statusElement.style.color = '#fff';
    drawCtx.clearRect(0, 0, canvasDrawing.width, canvasDrawing.height);
    
    // Clear the card area
    const area = document.getElementById('card-summon-area')!;
    area.innerHTML = '<div id="summoning-circle"></div>';
}

initHands();
