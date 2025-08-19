// Offscreen rendering worker (experimental)
// Receives lightweight frame snapshots and draws them to an OffscreenCanvas to bypass main thread jank in Electron.

interface EnemyLite { x:number; y:number; r:number; hp:number; max:number; }
interface BulletLite { x:number; y:number; r:number; }

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 0, height = 0;

function drawFrame(data: any){
  if(!ctx) return;
  const { camX, camY, scale=1, player, enemies, bullets } = data;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,width,height);
  // Background (flat fill for perf)
  ctx.fillStyle = '#101820';
  ctx.fillRect(0,0,width,height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-camX, -camY);
  // Enemies
  ctx.fillStyle = '#ff2d2d';
  for(let i=0;i<enemies.length;i++){
    const e: EnemyLite = enemies[i];
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
    ctx.fill();
    if(e.hp < e.max){
      const w = e.r*2;
      const h = 3;
      ctx.fillStyle = '#111';
      ctx.fillRect(e.x - e.r, e.y - e.r - 8, w, h);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(e.x - e.r, e.y - e.r - 8, (e.hp/e.max)*w, h);
      ctx.fillStyle = '#ff2d2d';
    }
  }
  // Bullets
  ctx.fillStyle = '#ffd400';
  for(let i=0;i<bullets.length;i++){
    const b: BulletLite = bullets[i];
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fill();
  }
  // Player
  if(player){
    ctx.fillStyle = '#00ffff';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

self.onmessage = (e: MessageEvent)=>{
  const msg = e.data;
  if(msg.type === 'init'){
    const canvas = msg.canvas as OffscreenCanvas;
    width = msg.width; height = msg.height;
    ctx = canvas.getContext('2d');
  } else if(msg.type === 'frame'){
    drawFrame(msg.payload);
  }
};
