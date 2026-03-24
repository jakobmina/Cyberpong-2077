import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Play, Pause, ChevronUp, ChevronDown, Settings, X, Volume2, VolumeX } from 'lucide-react';

/* ── Constants ────────────────────────────────────────── */
const WIN_SCORE = 7;
const PW = 10;   // paddle width
const PH = 75;   // paddle height
const BALL_R = 7;
const BALL_SPEED0 = 5;
const BALL_MAX = 13;
const ACCEL = 1.04; // per-hit multiplier
const SPECIAL_SPEED = 18; // Speed for special shot
const MAX_ENERGY = 100;

const DIFFICULTIES = {
  easy: { aiSpeed: 2.4, aiError: 22, specialChance: 0.01 },
  medium: { aiSpeed: 4.0, aiError: 10, specialChance: 0.05 },
  hard: { aiSpeed: 6.2, aiError: 3, specialChance: 0.15 }
};

const C = {
  bg: '#04060d',
  grid: 'rgba(0,255,136,0.04)',
  pri: '#00ff88',
  acc: '#ff0055',
  blue: '#00c8ff',
  dim: 'rgba(0,255,136,0.3)',
  ball: '#ffe600',
  ballGlow: '#ff8800',
  special: '#ff00ff'
};

type GameState = 'start' | 'playing' | 'paused' | 'won';
type Difficulty = 'easy' | 'medium' | 'hard';

interface PaddleState {
  x: number;
  y: number;
  score: number;
  energy: number;
  isSpecialReady: boolean;
  isSpecialActive: boolean;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('start');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [playerScore, setPlayerScore] = useState(0);
  const [computerScore, setComputerScore] = useState(0);
  const [playerEnergy, setPlayerEnergy] = useState(0);
  const [computerEnergy, setComputerEnergy] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [winner, setWinner] = useState<'player' | 'cpu' | null>(null);

  // Game state refs to avoid re-renders
  const playerRef = useRef<PaddleState>({ x: 18, y: 0, score: 0, energy: 0, isSpecialReady: false, isSpecialActive: false });
  const computerRef = useRef<PaddleState>({ x: 0, y: 0, score: 0, energy: 0, isSpecialReady: false, isSpecialActive: false });
  const ballRef = useRef({ x: 0, y: 0, dx: 0, dy: 0, isSpecial: false });
  const particlesRef = useRef<any[]>([]);
  const trailRef = useRef<any[]>([]);
  const inputRef = useRef({ up: false, down: false, special: false });
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestRef = useRef<number>(0);

  const W = 700; // Wider field
  const H = 380;

  /* ── Audio ────────────────────────────────────────── */
  const initAudio = () => {
    if (audioContextRef.current) return;
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  };

  const beep = (freq: number, dur: number, type: OscillatorType = 'square', vol = 0.25) => {
    if (!audioContextRef.current || isMuted) return;
    try {
      const ac = audioContextRef.current;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + dur);
    } catch (e) {
      console.error('Audio error', e);
    }
  };

  const sndPaddle = () => beep(440, 0.06, 'square', 0.2);
  const sndWall = () => beep(260, 0.05, 'triangle', 0.15);
  const sndScore = () => {
    beep(880, 0.08, 'sine', 0.35);
    setTimeout(() => beep(660, 0.12, 'sine', 0.25), 90);
  };
  const sndSpecial = () => {
    beep(120, 0.2, 'sawtooth', 0.3);
    setTimeout(() => beep(240, 0.2, 'sawtooth', 0.2), 100);
    setTimeout(() => beep(480, 0.3, 'sawtooth', 0.1), 200);
  };

  const sndWin = () => {
    beep(440, 0.1, 'sine', 0.3);
    setTimeout(() => beep(554, 0.1, 'sine', 0.3), 100);
    setTimeout(() => beep(659, 0.1, 'sine', 0.3), 200);
    setTimeout(() => beep(880, 0.3, 'sine', 0.4), 300);
  };

  /* ── Game Logic ────────────────────────────────────────── */
  const spawnParticles = (x: number, y: number, color: string, n = 12, isSpecial = false) => {
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (Math.random() * 4 + 1) * (isSpecial ? 2 : 1);
      particlesRef.current.push({
        x, y,
        dx: Math.cos(angle) * spd,
        dy: Math.sin(angle) * spd,
        life: 1,
        decay: Math.random() * 0.04 + 0.03,
        r: (Math.random() * 3 + 1) * (isSpecial ? 1.5 : 1),
        color
      });
    }
  };

  const resetBall = (towards: 'player' | 'cpu' | null) => {
    ballRef.current.x = W / 2;
    ballRef.current.y = H / 2;
    ballRef.current.isSpecial = false;
    const dir = towards === 'player' ? -1 : (towards === 'cpu' ? 1 : (Math.random() > 0.5 ? 1 : -1));
    const angle = (Math.random() * 0.6 - 0.3);
    ballRef.current.dx = dir * BALL_SPEED0 * Math.cos(angle);
    ballRef.current.dy = BALL_SPEED0 * Math.sin(angle + (Math.random() - 0.5) * 0.4);
    trailRef.current = [];
  };

  const startGame = () => {
    playerRef.current.score = 0;
    computerRef.current.score = 0;
    playerRef.current.energy = 0;
    computerRef.current.energy = 0;
    playerRef.current.isSpecialReady = false;
    computerRef.current.isSpecialReady = false;
    setPlayerScore(0);
    setComputerScore(0);
    setPlayerEnergy(0);
    setComputerEnergy(0);
    playerRef.current.y = H / 2 - PH / 2;
    computerRef.current.y = H / 2 - PH / 2;
    resetBall(null);
    setGameState('playing');
    setWinner(null);
  };

  const triggerSpecial = () => {
    if (playerRef.current.energy >= MAX_ENERGY) {
      playerRef.current.isSpecialActive = true;
      playerRef.current.energy = 0;
      setPlayerEnergy(0);
      sndSpecial();
    }
  };

  const togglePause = () => {
    initAudio();
    if (gameState === 'playing') setGameState('paused');
    else if (gameState === 'paused') setGameState('playing');
    else if (gameState === 'start' || gameState === 'won') startGame();
  };

  const anyPress = () => {
    initAudio();
    if (gameState === 'start' || gameState === 'won') startGame();
    else if (gameState === 'paused') setGameState('playing');
  };

  /* ── Drawing ────────────────────────────────────────── */
  const draw = (ctx: CanvasRenderingContext2D) => {
    // BG
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    const gs = 36;
    for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Centre line
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(0,255,136,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);

    // Trail
    trailRef.current.forEach((t, i) => {
      const alpha = (i / trailRef.current.length) * 0.5;
      const r = (BALL_R * (i / trailRef.current.length) * 0.8) * (t.isSpecial ? 2 : 1);
      ctx.fillStyle = t.isSpecial ? `rgba(255,0,255,${alpha})` : `rgba(255,200,0,${alpha})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Paddles
    const glowRect = (x: number, y: number, w: number, h: number, fill: string, glow: string, blur = 12, isSpecial = false) => {
      ctx.shadowColor = isSpecial ? C.special : glow;
      ctx.shadowBlur = isSpecial ? 25 : blur;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      if (isSpecial) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
      ctx.shadowBlur = 0;
    };
    glowRect(playerRef.current.x, playerRef.current.y, PW, PH, C.pri, C.pri, 14, playerRef.current.isSpecialActive);
    glowRect(computerRef.current.x, computerRef.current.y, PW, PH, C.blue, C.blue, 14, computerRef.current.isSpecialActive);

    // Ball
    const glowCircle = (x: number, y: number, r: number, fill: string, glow: string, blur = 18, isSpecial = false) => {
      ctx.shadowColor = isSpecial ? C.special : glow;
      ctx.shadowBlur = isSpecial ? 30 : blur;
      ctx.fillStyle = isSpecial ? C.special : fill;
      ctx.beginPath();
      ctx.arc(x, y, isSpecial ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fill();
      if (isSpecial) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    };
    glowCircle(ballRef.current.x, ballRef.current.y, BALL_R, C.ball, C.ballGlow, 22, ballRef.current.isSpecial);

    // Overlays
    if (gameState !== 'playing') {
      ctx.fillStyle = 'rgba(4,6,13,0.82)';
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';
      ctx.shadowBlur = 20;

      if (gameState === 'start') {
        ctx.font = 'bold 900 32px Orbitron, sans-serif';
        ctx.fillStyle = C.pri;
        ctx.shadowColor = C.pri;
        ctx.fillText('QUANTUM PONG', W / 2, H / 2 - 10);
        ctx.shadowBlur = 0;
        ctx.font = '14px "Share Tech Mono", monospace';
        ctx.fillStyle = C.dim;
        ctx.fillText('Pulsa cualquier tecla, toca o', W / 2, H / 2 + 30);
        ctx.fillText('arrastra en el canvas para iniciar', W / 2, H / 2 + 50);
      } else if (gameState === 'paused') {
        ctx.font = 'bold 900 32px Orbitron, sans-serif';
        ctx.fillStyle = C.blue;
        ctx.shadowColor = C.blue;
        ctx.fillText('PAUSA', W / 2, H / 2);
        ctx.shadowBlur = 0;
        ctx.font = '14px "Share Tech Mono", monospace';
        ctx.fillStyle = C.dim;
        ctx.fillText('Pulsa P o el botón para continuar', W / 2, H / 2 + 40);
      } else if (gameState === 'won') {
        const isPlayer = winner === 'player';
        ctx.font = 'bold 900 32px Orbitron, sans-serif';
        ctx.fillStyle = isPlayer ? C.pri : C.acc;
        ctx.shadowColor = isPlayer ? C.pri : C.acc;
        ctx.fillText(isPlayer ? '¡VICTORIA!' : 'CPU GANA', W / 2, H / 2 - 20);
        ctx.shadowBlur = 0;
        ctx.font = '20px Orbitron, sans-serif';
        ctx.fillStyle = C.blue;
        ctx.fillText(`${playerRef.current.score} — ${computerRef.current.score}`, W / 2, H / 2 + 20);
        ctx.font = '14px "Share Tech Mono", monospace';
        ctx.fillStyle = C.dim;
        ctx.fillText('Pulsa cualquier tecla o toca para jugar de nuevo', W / 2, H / 2 + 60);
      }
    }
  };

  const update = () => {
    if (gameState !== 'playing') return;

    // Player paddle
    const pSpeed = 7;
    if (inputRef.current.up && playerRef.current.y > 0) playerRef.current.y -= pSpeed;
    if (inputRef.current.down && playerRef.current.y < H - PH) playerRef.current.y += pSpeed;

    // AI paddle
    const diff = DIFFICULTIES[difficulty];
    const target = ballRef.current.y - PH / 2 + diff.aiError * (Math.random() * 2 - 1);
    const delta = target - computerRef.current.y;
    computerRef.current.y += Math.sign(delta) * Math.min(Math.abs(delta), diff.aiSpeed);
    computerRef.current.y = Math.max(0, Math.min(H - PH, computerRef.current.y));

    // Trail
    trailRef.current.push({ x: ballRef.current.x, y: ballRef.current.y, isSpecial: ballRef.current.isSpecial });
    if (trailRef.current.length > 9) trailRef.current.shift();

    // Ball movement
    ballRef.current.x += ballRef.current.dx;
    ballRef.current.y += ballRef.current.dy;

    // Wall bounce
    if (ballRef.current.y - BALL_R <= 0) {
      ballRef.current.y = BALL_R;
      ballRef.current.dy = Math.abs(ballRef.current.dy);
      sndWall();
      spawnParticles(ballRef.current.x, 0, C.dim, 6, ballRef.current.isSpecial);
    }
    if (ballRef.current.y + BALL_R >= H) {
      ballRef.current.y = H - BALL_R;
      ballRef.current.dy = -Math.abs(ballRef.current.dy);
      sndWall();
      spawnParticles(ballRef.current.x, H, C.dim, 6, ballRef.current.isSpecial);
    }

    // Paddle collision
    const clampBall = () => {
      const spd = Math.hypot(ballRef.current.dx, ballRef.current.dy);
      if (spd > BALL_MAX && !ballRef.current.isSpecial) {
        ballRef.current.dx = (ballRef.current.dx / spd) * BALL_MAX;
        ballRef.current.dy = (ballRef.current.dy / spd) * BALL_MAX;
      }
      if (Math.abs(ballRef.current.dy) < 0.8) ballRef.current.dy = ballRef.current.dy >= 0 ? 0.8 : -0.8;
    };

    // Player paddle
    if (ballRef.current.dx < 0 &&
      ballRef.current.x - BALL_R <= playerRef.current.x + PW &&
      ballRef.current.x + BALL_R >= playerRef.current.x &&
      ballRef.current.y + BALL_R >= playerRef.current.y &&
      ballRef.current.y - BALL_R <= playerRef.current.y + PH) {
      ballRef.current.x = playerRef.current.x + PW + BALL_R;
      const rel = (ballRef.current.y - (playerRef.current.y + PH / 2)) / (PH / 2);
      const angle = rel * 1.1;
      
      let spd = Math.hypot(ballRef.current.dx, ballRef.current.dy) * ACCEL;
      if (playerRef.current.isSpecialActive) {
        spd = SPECIAL_SPEED;
        ballRef.current.isSpecial = true;
        playerRef.current.isSpecialActive = false;
      } else {
        ballRef.current.isSpecial = false;
        playerRef.current.energy = Math.min(MAX_ENERGY, playerRef.current.energy + 15);
        setPlayerEnergy(playerRef.current.energy);
      }

      ballRef.current.dx = Math.abs(Math.cos(angle) * spd);
      ballRef.current.dy = Math.sin(angle) * spd;
      clampBall();
      sndPaddle();
      spawnParticles(ballRef.current.x, ballRef.current.y, ballRef.current.isSpecial ? C.special : C.pri, 10, ballRef.current.isSpecial);
    }

    // CPU paddle
    if (ballRef.current.dx > 0 &&
      ballRef.current.x + BALL_R >= computerRef.current.x &&
      ballRef.current.x - BALL_R <= computerRef.current.x + PW &&
      ballRef.current.y + BALL_R >= computerRef.current.y &&
      ballRef.current.y - BALL_R <= computerRef.current.y + PH) {
      ballRef.current.x = computerRef.current.x - BALL_R;
      const rel = (ballRef.current.y - (computerRef.current.y + PH / 2)) / (PH / 2);
      const angle = rel * 1.1;
      
      let spd = Math.hypot(ballRef.current.dx, ballRef.current.dy) * ACCEL;
      
      // AI logic for special
      if (computerRef.current.energy >= MAX_ENERGY && Math.random() < diff.specialChance) {
        computerRef.current.isSpecialActive = true;
        computerRef.current.energy = 0;
        setComputerEnergy(0);
        sndSpecial();
      }

      if (computerRef.current.isSpecialActive) {
        spd = SPECIAL_SPEED;
        ballRef.current.isSpecial = true;
        computerRef.current.isSpecialActive = false;
      } else {
        ballRef.current.isSpecial = false;
        computerRef.current.energy = Math.min(MAX_ENERGY, computerRef.current.energy + 15);
        setComputerEnergy(computerRef.current.energy);
      }

      ballRef.current.dx = -(Math.abs(Math.cos(angle) * spd));
      ballRef.current.dy = Math.sin(angle) * spd;
      clampBall();
      sndPaddle();
      spawnParticles(ballRef.current.x, ballRef.current.y, ballRef.current.isSpecial ? C.special : C.blue, 10, ballRef.current.isSpecial);
    }

    // Scoring
    if (ballRef.current.x + BALL_R < 0) {
      computerRef.current.score++;
      setComputerScore(computerRef.current.score);
      sndScore();
      spawnParticles(0, ballRef.current.y, C.acc, 18);
      if (computerRef.current.score >= WIN_SCORE) {
        setWinner('cpu');
        setGameState('won');
        sndWin();
        return;
      }
      resetBall('player');
    }
    if (ballRef.current.x - BALL_R > W) {
      playerRef.current.score++;
      setPlayerScore(playerRef.current.score);
      sndScore();
      spawnParticles(W, ballRef.current.y, C.acc, 18);
      if (playerRef.current.score >= WIN_SCORE) {
        setWinner('player');
        setGameState('won');
        sndWin();
        return;
      }
      resetBall('cpu');
    }

    // Particles
    particlesRef.current.forEach(p => {
      p.x += p.dx; p.y += p.dy;
      p.dy += 0.12;
      p.life -= p.decay;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);
  };

  const gameLoop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    update();
    draw(ctx);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    computerRef.current.x = W - 18 - PW;
    playerRef.current.y = H / 2 - PH / 2;
    computerRef.current.y = H / 2 - PH / 2;
    requestRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [gameState, difficulty]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { inputRef.current.up = true; e.preventDefault(); }
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { inputRef.current.down = true; e.preventDefault(); }
      if (e.code === 'Space') { triggerSpecial(); e.preventDefault(); }
      if (e.key.toLowerCase() === 'p') { togglePause(); return; }
      if (!['w', 'W', 's', 'S'].includes(e.key) && !e.key.startsWith('Arrow') && e.code !== 'Space') anyPress();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') inputRef.current.up = false;
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') inputRef.current.down = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const handleCanvasTouch = (e: TouchEvent) => {
    e.preventDefault();
    anyPress();
  };

  const handleCanvasTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleY = H / rect.height;
    const touchY = (e.nativeEvent.touches[0].clientY - rect.top) * scaleY;
    playerRef.current.y = Math.max(0, Math.min(H - PH, touchY - PH / 2));
    anyPress();
  };

  return (
    <div className="min-h-screen bg-[#04060d] flex items-center justify-center p-4">
      <div id="qpong-wrap" className="w-full max-w-[700px] border border-[#00ff8833] shadow-[0_0_40px_#00ff8815,0_0_0_1px_#ffffff08] relative select-none overflow-hidden">
        
        {/* Header */}
        <div id="qpong-header" className="flex items-center justify-between px-4 py-2 border-b border-[#00ff8822]">
          <div id="qpong-title" className="font-orbitron font-black tracking-widest text-[#00ff88] shadow-[0_0_18px_#00ff8866]">
            QUANTUM<span className="text-[#00c8ff]">PONG</span>
          </div>
          <div id="qpong-tag" className="text-[0.6em] text-[#00ff8859] tracking-widest">
            smokApp Lab · v2.1
          </div>
        </div>

        {/* Score HUD */}
        <div id="qpong-hud" className="grid grid-cols-[1fr_auto_1fr] items-center px-5 py-2 border-b border-[#00ff8818]">
          <div className="flex flex-col gap-1">
            <div className="text-[0.65em] tracking-widest text-[#00ff8859]">JUGADOR</div>
            <div className="w-full h-2 bg-[#00ff8820] border border-[#00ff8830] overflow-hidden">
              <div 
                className="h-full bg-[#00ff88] transition-all duration-300" 
                style={{ width: `${playerEnergy}%`, boxShadow: playerEnergy >= 100 ? '0 0 10px #00ff88' : 'none' }}
              />
            </div>
          </div>
          <div className="text-center px-8">
            <div className="font-orbitron text-3xl font-black tracking-widest text-[#00ff88] shadow-[0_0_18px_#00ff8866]">
              {playerScore}
              <span className="text-[#00ff8859] text-xl px-2">:</span>
              {computerScore}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[0.65em] tracking-widest text-[#00ff8859] text-right">CPU</div>
            <div className="w-full h-2 bg-[#00c8ff20] border border-[#00c8ff30] overflow-hidden">
              <div 
                className="h-full bg-[#00c8ff] transition-all duration-300 ml-auto" 
                style={{ width: `${computerEnergy}%`, boxShadow: computerEnergy >= 100 ? '0 0 10px #00c8ff' : 'none' }}
              />
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div id="qpong-canvas-wrap" className="relative leading-[0]">
          <canvas
            ref={canvasRef}
            id="gameCanvas"
            width={W}
            height={H}
            className="block w-full bg-[#04060d] cursor-crosshair"
            onTouchStart={handleCanvasTouch}
            onTouchMove={handleCanvasTouchMove}
            onClick={anyPress}
          />

          {/* Overlays */}
          {gameState === 'start' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#04060d/60] backdrop-blur-[2px] cursor-pointer" onClick={anyPress}>
              <div className="font-orbitron text-4xl font-black text-[#00ff88] animate-pulse mb-4 drop-shadow-[0_0_15px_#00ff88]">
                READY?
              </div>
              <div className="text-[#00ff8880] tracking-[0.3em] text-xs uppercase">
                Click para empezar
              </div>
            </div>
          )}

          {gameState === 'paused' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#04060d/60] backdrop-blur-[2px]">
              <div className="font-orbitron text-4xl font-black text-[#00c8ff] mb-4 drop-shadow-[0_0_15px_#00c8ff]">
                PAUSA
              </div>
              <button onClick={togglePause} className="px-6 py-2 border border-[#00c8ff] text-[#00c8ff] text-xs tracking-widest uppercase hover:bg-[#00c8ff20]">
                Continuar
              </button>
            </div>
          )}

          {gameState === 'won' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#04060d/80] backdrop-blur-[4px]">
              <div className={`font-orbitron text-5xl font-black mb-2 drop-shadow-[0_0_20px_currentColor] ${winner === 'player' ? 'text-[#00ff88]' : 'text-[#ff0055]'}`}>
                {winner === 'player' ? 'VICTORIA' : 'DERROTA'}
              </div>
              <div className="text-white/60 tracking-widest text-xs mb-6 uppercase">
                {winner === 'player' ? 'Has dominado el Quantum' : 'La CPU ha ganado esta vez'}
              </div>
              <button onClick={startGame} className="px-8 py-3 bg-[#00ff88] text-[#04060d] font-bold text-sm tracking-[0.2em] uppercase hover:scale-105 transition-transform">
                Jugar de nuevo
              </button>
            </div>
          )}
        </div>

        {/* Arcade Controls */}
        <div id="qpong-arcade" className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] items-center gap-6 px-6 py-6 border-t border-[#00ff8818] bg-[#0a0c14]">
          
          {/* Joystick Area */}
          <div className="flex flex-col items-center gap-2">
            <div className="text-[0.5em] text-[#00ff8859] uppercase tracking-tighter">Joystick</div>
            <div className="relative w-24 h-24 rounded-full border-4 border-[#00ff8830] flex items-center justify-center bg-[#00ff8805]">
              <div className="absolute inset-0 flex flex-col justify-between items-center py-1">
                <ChevronUp className={`transition-colors ${inputRef.current.up ? 'text-[#00ff88]' : 'text-[#00ff8820]'}`} size={16} />
                <ChevronDown className={`transition-colors ${inputRef.current.down ? 'text-[#00ff88]' : 'text-[#00ff8820]'}`} size={16} />
              </div>
              <div 
                className={`w-10 h-10 rounded-full bg-[#00ff88] shadow-[0_0_15px_#00ff88] transition-transform duration-75
                  ${inputRef.current.up ? '-translate-y-4' : ''} ${inputRef.current.down ? 'translate-y-4' : ''}`}
              />
              {/* Touch areas for joystick */}
              <div 
                className="absolute top-0 left-0 w-full h-1/2 cursor-pointer"
                onMouseDown={() => { inputRef.current.up = true; anyPress(); }}
                onMouseUp={() => { inputRef.current.up = false; }}
                onMouseLeave={() => { inputRef.current.up = false; }}
                onTouchStart={(e) => { e.preventDefault(); inputRef.current.up = true; anyPress(); }}
                onTouchEnd={(e) => { e.preventDefault(); inputRef.current.up = false; }}
              />
              <div 
                className="absolute bottom-0 left-0 w-full h-1/2 cursor-pointer"
                onMouseDown={() => { inputRef.current.down = true; anyPress(); }}
                onMouseUp={() => { inputRef.current.down = false; }}
                onMouseLeave={() => { inputRef.current.down = false; }}
                onTouchStart={(e) => { e.preventDefault(); inputRef.current.down = true; anyPress(); }}
                onTouchEnd={(e) => { e.preventDefault(); inputRef.current.down = false; }}
              />
            </div>
          </div>

          {/* Difficulty (Center) */}
          <div className="flex flex-col gap-1">
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <button
                key={d}
                onClick={() => { setDifficulty(d); initAudio(); if (gameState === 'playing') resetBall(null); }}
                className={`font-share text-[0.6em] tracking-widest px-2 py-0.5 border border-[#00ff8830] cursor-pointer transition-all uppercase
                  ${difficulty === d ? 'bg-[#00ff88] text-[#04060d] border-[#00ff88]' : 'text-[#00ff8859] hover:text-[#00ff88] hover:border-[#00ff88]'}`}
              >
                {d === 'easy' ? 'FÁCIL' : d === 'medium' ? 'NORMAL' : 'DIFÍCIL'}
              </button>
            ))}
          </div>

          {/* Arcade Buttons */}
          <div className="flex gap-4 justify-end">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[0.5em] text-[#00ff8859] uppercase tracking-tighter">Settings</div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="w-16 h-16 rounded-full bg-[#333] border-4 border-[#666] shadow-[0_0_10px_rgba(255,255,255,0.1)] flex items-center justify-center cursor-pointer active:scale-95"
              >
                <Settings className="text-white" size={24} />
              </button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-[0.5em] text-[#ff00ff59] uppercase tracking-tighter">Special</div>
              <button
                onClick={triggerSpecial}
                disabled={playerEnergy < 100}
                className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all active:scale-95
                  ${playerEnergy >= 100 
                    ? 'bg-[#ff00ff] border-[#fff] shadow-[0_0_20px_#ff00ff] cursor-pointer' 
                    : 'bg-[#ff00ff20] border-[#ff00ff40] cursor-not-allowed'}`}
              >
                <div className={`w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center font-orbitron text-xs font-black
                  ${playerEnergy >= 100 ? 'text-white' : 'text-[#ff00ff40]'}`}>
                  S
                </div>
              </button>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-[0.5em] text-[#00c8ff59] uppercase tracking-tighter">Pause</div>
              <button
                onClick={togglePause}
                className="w-16 h-16 rounded-full bg-[#00c8ff] border-4 border-[#fff] shadow-[0_0_20px_#00c8ff] flex items-center justify-center cursor-pointer active:scale-95"
              >
                <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center font-orbitron text-xs font-black text-white">
                  {gameState === 'playing' ? 'P' : 'R'}
                </div>
              </button>
            </div>
          </div>

        </div>

        {/* Settings Overlay */}
        {showSettings && (
          <div className="absolute inset-0 z-50 bg-[#04060d/95] backdrop-blur-sm flex items-center justify-center p-6">
            <div className="w-full max-w-xs bg-[#0a0c14] border border-[#00ff8833] p-6 shadow-[0_0_30px_#00ff8820]">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-orbitron text-lg text-[#00ff88]">SETTINGS</h2>
                <button onClick={() => setShowSettings(false)} className="text-[#00ff8859] hover:text-[#00ff88]">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[0.6em] text-[#00ff8859] tracking-widest uppercase">Audio</label>
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    className="w-full py-2 border border-[#00ff8830] flex items-center justify-center gap-2 text-[#00ff88] hover:bg-[#00ff8810]"
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    <span className="text-xs tracking-widest uppercase">{isMuted ? 'Muted' : 'Sound On'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.6em] text-[#00ff8859] tracking-widest uppercase">Difficulty</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['easy', 'medium', 'hard'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={`text-[0.5em] py-2 border tracking-widest uppercase transition-all
                          ${difficulty === d ? 'bg-[#00ff88] text-[#04060d] border-[#00ff88]' : 'text-[#00ff8859] border-[#00ff8830]'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => { setPlayerScore(0); setComputerScore(0); setShowSettings(false); resetBall(null); }}
                    className="w-full py-2 bg-[#ff005520] border border-[#ff005550] text-[#ff0055] text-xs tracking-widest uppercase hover:bg-[#ff005540]"
                  >
                    Reset Score
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hint */}
        <div id="qpong-hint" className="text-center text-[0.58em] text-[#00ff8840] tracking-widest px-4 py-2 border-t border-[#00ff8810] bg-[#04060d]">
          W/S · ↑↓ · Táctil en joystick &nbsp;|&nbsp; ESPACIO = Disparo Especial &nbsp;|&nbsp; P = Pausa
        </div>

      </div>
    </div>
  );
}

