// Keyboard + mouse with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, l: false, r: false, m: false, lPressed: false, rPressed: false, mPressed: false, wheel: 0 };
    this.locked = false;
    this.enabled = true;
    this.sens = 1;
    this.invertY = false;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.l = true; this.mouse.lPressed = true; }
      if (e.button === 2) { this.mouse.r = true; this.mouse.rPressed = true; }
      if (e.button === 1) { this.mouse.m = true; this.mouse.mPressed = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
      if (e.button === 1) this.mouse.m = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockerror', () => { this.fallback = true; this.setFallbackLock(true); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.fallback && this.locked) this.setFallbackLock(false); });
    document.addEventListener('pointerlockchange', () => {
      if (this.fallback && !document.pointerLockElement) return;
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  // Pointer lock can be unavailable inside embedded frames; fall back to free mouse-look.
  lock() {
    if (this.locked) return;
    if (this.fallback) { this.setFallbackLock(true); return; }
    const fail = () => { this.fallback = true; this.setFallbackLock(true); };
    try {
      if (!this.canvas.requestPointerLock) { fail(); return; }
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(fail);
      clearTimeout(this._lockT);
      this._lockT = setTimeout(() => { if (!document.pointerLockElement && !this.locked) fail(); }, 600);
    } catch { fail(); }
  }
  // Grab the mouse again (the L key): when the pointer is loose, or when the browser refused pointer
  // lock earlier and the cursor has wandered off the crosshair, try a real pointer lock once more.
  recapture() {
    if (document.pointerLockElement === this.canvas) return;
    if (this.fallback) { this.fallback = false; this.locked = false; document.body.style.cursor = ''; }
    this.lock();
  }
  setFallbackLock(v) {
    this.locked = v;
    document.body.style.cursor = v ? 'crosshair' : '';
    if (this.onLockChange) this.onLockChange(v);
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
    else if (this.fallback && this.locked) this.setFallbackLock(false);
  }
  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  up(code) { return this.released.has(code); }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.lPressed = this.mouse.rPressed = this.mouse.mPressed = false;
  }
}
