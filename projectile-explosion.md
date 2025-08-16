# Vytvorenie projektilu s explóziou pri kolízii v TypeScript

## Prehľad

Vytvorenie projektilu, ktorý exploduje pri zásahu je jednou zo základných mechaník v hernom vývoji. Tento návod vám ukáže, ako implementovať takýto systém v TypeScript s použitím HTML5 Canvas.

## 1. Základná štruktúra projektilu

Začneme vytvorením základnej triedy pre projektil:

```typescript
class Projectile {
    x: number;
    y: number;
    vx: number; // rýchlosť v ose X
    vy: number; // rýchlosť v ose Y
    radius: number;
    damage: number;
    speed: number;
    isActive: boolean;
    
    constructor(x: number, y: number, targetX: number, targetY: number, speed: number = 5) {
        this.x = x;
        this.y = y;
        this.radius = 3;
        this.damage = 50;
        this.speed = speed;
        this.isActive = true;
        
        // Vypočítaj smer letu
        const dx = targetX - x;
        const dy = targetY - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        this.vx = (dx / distance) * speed;
        this.vy = (dy / distance) * speed;
    }
    
    update(): void {
        if (!this.isActive) return;
        
        this.x += this.vx;
        this.y += this.vy;
    }
    
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.isActive) return;
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffff00';
        ctx.fill();
        ctx.closePath();
    }
}
```

## 2. Systém kolíznej detekcie

Pre detekciu kolízií potrebujeme funkciu, ktorá skontroluje, či projektil narazil do cieľa:

```typescript
function checkCollision(projectile: Projectile, target: GameObject): boolean {
    if (!projectile.isActive || !target.isActive) return false;
    
    const dx = projectile.x - target.x;
    const dy = projectile.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance < (projectile.radius + target.radius);
}

// Pre kolíziu s obdĺžnikovými objektmi
function checkRectangleCollision(projectile: Projectile, rect: Rectangle): boolean {
    if (!projectile.isActive) return false;
    
    return projectile.x + projectile.radius > rect.x &&
           projectile.x - projectile.radius < rect.x + rect.width &&
           projectile.y + projectile.radius > rect.y &&
           projectile.y - projectile.radius < rect.y + rect.height;
}
```

## 3. Systém explózie

Vytvoríme triedu pre efekt explózie:

```typescript
class Explosion {
    x: number;
    y: number;
    maxRadius: number;
    currentRadius: number;
    damage: number;
    particles: Particle[];
    duration: number;
    elapsedTime: number;
    isActive: boolean;
    
    constructor(x: number, y: number, damage: number = 100) {
        this.x = x;
        this.y = y;
        this.maxRadius = 80;
        this.currentRadius = 0;
        this.damage = damage;
        this.duration = 500; // millisekúnd
        this.elapsedTime = 0;
        this.isActive = true;
        this.particles = this.createParticles();
    }
    
    createParticles(): Particle[] {
        const particles: Particle[] = [];
        const particleCount = 15;
        
        for (let i = 0; i < particleCount; i++) {
            const angle = (Math.PI * 2 / particleCount) * i + (Math.random() - 0.5);
            const speed = Math.random() * 3 + 2;
            
            particles.push({
                x: this.x,
                y: this.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 3 + 1,
                life: 1.0,
                decay: Math.random() * 0.02 + 0.01,
                color: `hsl(${Math.random() * 60 + 15}, 100%, 50%)` // oranžové/červené farby
            });
        }
        
        return particles;
    }
    
    update(deltaTime: number): void {
        if (!this.isActive) return;
        
        this.elapsedTime += deltaTime;
        const progress = this.elapsedTime / this.duration;
        
        if (progress >= 1) {
            this.isActive = false;
            return;
        }
        
        // Rozširuj radius explózie
        this.currentRadius = this.maxRadius * Math.sin(progress * Math.PI);
        
        // Aktualizuj častice
        this.particles.forEach(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += 0.1; // gravitácia
            particle.life -= particle.decay;
            particle.size *= 0.98;
        });
        
        // Odstráň "mŕtve" častice
        this.particles = this.particles.filter(p => p.life > 0 && p.size > 0.1);
    }
    
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.isActive) return;
        
        // Nakresli explózny kruh
        const progress = this.elapsedTime / this.duration;
        const alpha = Math.sin(progress * Math.PI) * 0.3;
        
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6600';
        ctx.fill();
        ctx.closePath();
        ctx.restore();
        
        // Nakresli častice
        this.particles.forEach(particle => {
            ctx.save();
            ctx.globalAlpha = particle.life;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fillStyle = particle.color;
            ctx.fill();
            ctx.closePath();
            ctx.restore();
        });
    }
    
    // Skontroluj, či explózia spôsobuje damage objektu
    checkDamage(target: GameObject): boolean {
        if (!this.isActive) return false;
        
        const dx = this.x - target.x;
        const dy = this.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance <= this.currentRadius;
    }
}
```

## 4. Game Manager - hlavná herná logika

```typescript
class Game {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    projectiles: Projectile[] = [];
    explosions: Explosion[] = [];
    targets: GameObject[] = [];
    lastTime: number = 0;
    
    constructor(canvasId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        
        this.setupEventListeners();
        this.gameLoop(0);
    }
    
    setupEventListeners(): void {
        this.canvas.addEventListener('click', (event) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            
            this.fireProjectile(50, 50, x, y); // vystrel z pozície [50,50]
        });
    }
    
    fireProjectile(fromX: number, fromY: number, toX: number, toY: number): void {
        const projectile = new Projectile(fromX, fromY, toX, toY);
        this.projectiles.push(projectile);
    }
    
    update(deltaTime: number): void {
        // Aktualizuj projektily
        this.projectiles.forEach(projectile => {
            if (!projectile.isActive) return;
            
            projectile.update();
            
            // Skontroluj kolízie s cieľmi
            this.targets.forEach(target => {
                if (checkCollision(projectile, target)) {
                    // Vytvor explóziu
                    this.explosions.push(new Explosion(projectile.x, projectile.y, projectile.damage));
                    
                    // Deaktivuj projektil
                    projectile.isActive = false;
                    
                    // Spôsob damage cieľu
                    target.takeDamage(projectile.damage);
                }
            });
            
            // Odstráň projektily mimo obrazovku
            if (projectile.x < 0 || projectile.x > this.canvas.width || 
                projectile.y < 0 || projectile.y > this.canvas.height) {
                projectile.isActive = false;
            }
        });
        
        // Aktualizuj explózie
        this.explosions.forEach(explosion => {
            explosion.update(deltaTime);
            
            // Skontroluj damage od explózií
            if (explosion.isActive) {
                this.targets.forEach(target => {
                    if (explosion.checkDamage(target)) {
                        target.takeDamage(explosion.damage * 0.1); // menší damage z explózie
                    }
                });
            }
        });
        
        // Odstráň neaktívne objekty
        this.projectiles = this.projectiles.filter(p => p.isActive);
        this.explosions = this.explosions.filter(e => e.isActive);
        this.targets = this.targets.filter(t => t.isActive);
    }
    
    draw(): void {
        // Vymaž canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Nakresli všetky objekty
        this.targets.forEach(target => target.draw(this.ctx));
        this.projectiles.forEach(projectile => projectile.draw(this.ctx));
        this.explosions.forEach(explosion => explosion.draw(this.ctx));
    }
    
    gameLoop(currentTime: number): void {
        const deltaTime = currentTime - this.lastTime;
        this.lastTime = currentTime;
        
        this.update(deltaTime);
        this.draw();
        
        requestAnimationFrame((time) => this.gameLoop(time));
    }
}
```

## 5. Pomocné typy a rozhrania

```typescript
interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    life: number;
    decay: number;
    color: string;
}

interface GameObject {
    x: number;
    y: number;
    radius: number;
    health: number;
    isActive: boolean;
    
    takeDamage(amount: number): void;
    draw(ctx: CanvasRenderingContext2D): void;
}

class Target implements GameObject {
    x: number;
    y: number;
    radius: number = 20;
    health: number = 100;
    isActive: boolean = true;
    
    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
    
    takeDamage(amount: number): void {
        this.health -= amount;
        if (this.health <= 0) {
            this.isActive = false;
        }
    }
    
    draw(ctx: CanvasRenderingContext2D): void {
        if (!this.isActive) return;
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${(this.health / 100) * 120}, 100%, 50%)`;
        ctx.fill();
        ctx.closePath();
        
        // Nakresli health bar
        ctx.fillStyle = 'black';
        ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, this.radius * 2, 5);
        ctx.fillStyle = 'red';
        ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, 
                    (this.radius * 2) * (this.health / 100), 5);
    }
}
```

## 6. Inicializácia hry

```typescript
// HTML
// <canvas id="gameCanvas" width="800" height="600"></canvas>

// Spustenie hry
const game = new Game('gameCanvas');

// Pridaj nejaké ciele
game.targets.push(new Target(200, 200));
game.targets.push(new Target(400, 300));
game.targets.push(new Target(600, 150));
```

## Kľúčové funkcie systému

### Kolízna detekcia
- **Kruhová kolízia**: Pre jednoduché objekty použitím vzdialenosti medzi centrami
- **Obdĺžniková kolízia**: Pre komplexnejšie tvary použitím AABB (Axis-Aligned Bounding Box)
- **Optimalizácia**: Systém automaticky odstraňuje neaktívne objekty

### Explózny efekt  
- **Vizuálny efekt**: Expandujúci kruh s částicami
- **Damage systém**: Explózia spôsobuje damage objektom v dosahu
- **Časovanie**: Explózia má definovanú dobu trvania a postupne mizne

### Performance optimalizácie
- **Object pooling**: Možno implementovať pre opakované použitie objektov
- **Culling**: Objekty mimo obrazovky sa automaticky odstránia
- **Efficient collision**: Kolízie sa kontrolujú len pre aktívne objekty

Tento systém poskytuje solídny základ pre implementáciu projektilu s explóziou v akejkoľvek TypeScript hre s možnosťou ďalšieho rozširovania a customizácie podľa potrieb.