(function () {
  if (customElements.get('cyberline-3d')) return;
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? t : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Explode vector (3MF coords, mm: x side, y front, z up) + stagger delay
  function plan(p) {
    if (p.ex) return { v: p.ex, d: p.d || 0 };
    const n = p.name.toLowerCase(), c = p.c, sx = Math.sign(c[0]) || 1;
    if (p.tag === 'bille') return { v: [0, 0, -43], d: 0.3 };
    if (p.tag === 'interrupteur') return { v: [0, -58, -34], d: 0.3 };
    if (p.tag === 'carte') return { v: [0, 22, -60], d: 0.28 };
    if (/^(fenetre|pare-brise)/.test(n)) return { v: [n.startsWith('fenetre ') && !n.includes('haut') ? sx * 10 : 0, 0, 90], d: 0 };
    if (/^(carrosserie|sup caro|supp caro|sup cao3)/.test(n)) return { v: [0, 0, 60], d: 0.06 };
    if (/^gardeboue (d|g)$/.test(n)) return { v: [sx * 30, 0, 10], d: 0.12 };
    if (n === 'rueda' || n === 'corps22') return { v: [sx * 50, 0, 0], d: 0.16 };
    if (/^(calandre|gardeboue avant)/.test(n)) return { v: [0, 46, 6], d: 0.14 };
    if (n === 'gardeboue arrière') return { v: [0, -44, 10], d: 0.14 };
    if (/^sup inerup/.test(n)) return { v: [0, 0, -34], d: 0.26 };
    if (n === 'chassie') return { v: [0, 0, 0], d: 0.2 };
    if (c[2] > -13) return { v: [0, 0, 30], d: 0.22 };
    return { v: [0, c[1] > 40 ? 22 : 0, -34], d: 0.26 };
  }

  class Cyberline3D extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      const compact = this.hasAttribute('compact');
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host{display:block;position:relative;width:100%;height:100%;-webkit-tap-highlight-color:transparent}
          canvas{display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;outline:none}
          canvas.drag{cursor:grabbing}
          .ui{position:absolute;left:0;right:0;bottom:${compact ? 12 : 20}px;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
          button{pointer-events:auto;font:500 ${compact ? 14 : 15}px/1 'Geist',-apple-system,Helvetica,Arial,sans-serif;letter-spacing:-0.01em;height:${compact ? 40 : 44}px;padding:0 ${compact ? 18 : 22}px;border:0;border-radius:999px;background:#0b0b0c;color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:10px;transition:transform .12s ease-out,background-color .2s}
          button:hover{background:#2e2e33}
          button:active{transform:scale(.96)}
          .ic{width:14px;height:14px;position:relative;display:inline-block}
          .ic i{position:absolute;left:5px;top:5px;width:4px;height:4px;border-radius:1px;background:#fff;transition:transform .45s cubic-bezier(.32,.72,0,1)}
          .hint{font:500 11px/1 'Geist Mono',ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#6b6b70}
          .load{position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;font:500 12px/1 'Geist Mono',ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#8e8e96;transition:opacity .4s}
          img.fb{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:24px;box-sizing:border-box}
        </style>
        <canvas tabindex="-1" aria-label="${this.getAttribute('label') || 'Modèle 3D'} — glisser pour faire pivoter"></canvas>
        <div class="load">Chargement du modèle 3D…</div>
        <div class="ui" hidden>
          <button type="button"><span class="ic"><i></i><i></i><i></i><i></i></span><span class="lb">Éclater</span></button>
        </div>`;
      this.$ = (s) => root.querySelector(s);
      this.canvas = this.$('canvas');
      this.btn = this.$('button');
      this.icons = [...root.querySelectorAll('.ic i')];
      this.btn.addEventListener('click', () => {
        const to = this.x > 0.5 ? 0 : 1;
        this.manual = { target: to, y: window.scrollY };
        this.kick();
      });
      this.boot().catch((e) => this.fail(e));
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.raf);
      this.running = false;
      if (this.io) this.io.disconnect();
      if (this.ro) this.ro.disconnect();
      if (this.onScroll) window.removeEventListener('scroll', this.onScroll);
      if (this.renderer) this.renderer.dispose();
    }

    fail(e) {
      console.warn('cyberline-3d:', e);
      const fb = this.getAttribute('fallback');
      this.$('.load').style.opacity = '0';
      if (fb) { const i = document.createElement('img'); i.className = 'fb'; i.src = fb; i.alt = 'Rendu 3D complet'; this.shadowRoot.appendChild(i); }
    }

    async boot() {
      const base = this.getAttribute('src') || 'assets/cyberline';
      const [THREE, manifest, bin] = await Promise.all([
        import(THREE_URL),
        fetch(base + '.json?v=13').then((r) => r.json()),
        fetch(base + '.bin?v=3').then((r) => r.arrayBuffer()),
      ]);
      this.T = THREE;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const coarse = this.hasAttribute('compact') || !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      this.renderer = renderer;

      const scene = new THREE.Scene();
      this.scene = scene;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9aa2, 1.9));
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.4, 2.2, 1.6); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-1.6, 0.8, -1.4); scene.add(rim);
      const under = new THREE.DirectionalLight(0xffffff, 1.3); under.position.set(0.4, -2, 0.6); scene.add(under);
      this.camera = new THREE.PerspectiveCamera(28, 1, 1, 5000);

      // pivot (user rotation) > model (z-up → y-up)
      this.pivot = new THREE.Group(); scene.add(this.pivot);
      const model = new THREE.Group(); model.rotation.x = -Math.PI / 2; this.pivot.add(model);
      const mats = {};
      const mat = (hex, glass) => {
        const k = hex + (glass ? 'g' : '');
        if (!mats[k]) mats[k] = new THREE.MeshStandardMaterial(glass
          ? { color: 0x15161a, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.82, flatShading: true }
          : { color: new THREE.Color(hex), roughness: 0.58, metalness: 0.06, flatShading: true });
        return mats[k];
      };
      const s = manifest.scale;
      this.parts = [];
      for (const p of manifest.parts) {
        if (!p.sub.length || !p.pos[1]) continue;
        const ints = new Int16Array(bin, p.pos[0], p.pos[1] * 3);
        const pos = new Float32Array(ints.length);
        for (let i = 0; i < ints.length; i++) pos[i] = ints[i] * s;
        const posAttr = new THREE.BufferAttribute(pos, 3);
        const g = new THREE.Group();
        const glass = /^(fenetre|pare-brise)/i.test(p.name);
        for (const sub of p.sub) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', posAttr);
          geo.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, sub.idx[0], sub.idx[1]), 1));
          geo.computeVertexNormals();
          g.add(new THREE.Mesh(geo, mat(sub.color, glass)));
        }
        model.add(g);
        const pl = plan(p);
        this.parts.push({ g, v: pl.v, d: pl.d });
      }

      // contact shadow
      const sc = document.createElement('canvas'); sc.width = sc.height = 128;
      const cx = sc.getContext('2d'), gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.34)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry((manifest.bbox[1][0] - manifest.bbox[0][0]) * 1.8, (manifest.bbox[1][1] - manifest.bbox[0][1]) * 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2;
      this.minY = manifest.bbox[0][2];
      sh.position.y = this.minY - 1;
      this.pivot.add(sh); this.shadow = sh;

      this.rAssembled = manifest.rA || 120; this.rExploded = manifest.rE || 175;
      this.look = manifest.look || null; this.shadowDrop = manifest.shadowDrop || 36;
      this.yaw = this.yawGoal = Math.PI - 0.65; this.pitch = 0.42; this.vy = 0; this.vp = 0;
      this.x = 0; this.v = 0; this.lastT = 0; this.idle = 0;
      this.bindInput(); this.bindScroll();
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this);
      this.io = new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; if (this.visible) this.kick(); }, { rootMargin: '120px' });
      this.io.observe(this);
      this.resize();
      this.$('.load').remove();
      this.$('.ui').hidden = false;
      this.kick();
    }

    resize() {
      const w = this.clientWidth || 1, h = this.clientHeight || 1;
      if (w === this._w && h === this._h) return;
      this._w = w; this._h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.kick();
    }

    bindScroll() {
      this.onScroll = () => {
        if (this.manual && Math.abs(window.scrollY - this.manual.y) > 140) this.manual = null;
        this.kick();
      };
      window.addEventListener('scroll', this.onScroll, { passive: true });
    }

    scrollTarget() {
      const r = this.getBoundingClientRect(), vh = window.innerHeight || 800;
      return clamp((vh * 0.82 - r.top) / (vh * 0.55), 0, 1);
    }

    bindInput() {
      const c = this.canvas;
      let drag = null;
      const rot = (dx, dy, dt) => {
        this.yaw += dx * 0.0075;
        this.pitch = clamp(this.pitch + dy * 0.005, -1.25, 1.25);
        this.vy = (dx * 0.0075) / dt * 16; this.vp = (dy * 0.005) / dt * 16;
        this.kick();
      };
      this.touchOnly = this.hasAttribute('compact') || !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
      if (this.touchOnly) { c.style.cursor = 'default'; this.dragging = () => false; this.lastSY = window.scrollY; return; }
      // Mouse / pen
      c.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        drag = { x: e.clientX, y: e.clientY, t: performance.now() };
        c.setPointerCapture(e.pointerId); c.classList.add('drag');
        this.vy = this.vp = 0; this.idle = 0; this.kick();
      });
      c.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerType === 'touch') return;
        const now = performance.now();
        rot(e.clientX - drag.x, e.clientY - drag.y, Math.max(8, now - drag.t));
        drag = { x: e.clientX, y: e.clientY, t: now };
      });
      const end = () => { drag = null; c.classList.remove('drag'); this.idle = 0; };
      c.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') end(); });
      c.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'touch') end(); });
      let tg = null;
      // Touch: lock each gesture to ONE intent on its first movement (model-viewer "pan-y" pattern).
      // Starts horizontal → the model owns the whole gesture (free rotation, page frozen).
      // Starts vertical → the page scrolls, the model ignores it entirely.
      c.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tg = null; return; }
        const p = e.touches[0];
        tg = { x0: p.clientX, y0: p.clientY, x: p.clientX, y: p.clientY, t: performance.now(), mode: null };
        this.vy = this.vp = 0; this.idle = 0;
      }, { passive: true });
      c.addEventListener('touchmove', (e) => {
        if (!tg || e.touches.length !== 1) { tg = null; return; }
        const p = e.touches[0];
        if (!tg.mode) {
          const dx = p.clientX - tg.x0, dy = p.clientY - tg.y0;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
          tg.mode = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'rotate' : 'scroll';
          if (tg.mode === 'scroll') return;
          c.classList.add('drag');
        }
        if (tg.mode !== 'rotate') return;
        if (e.cancelable) e.preventDefault();
        const now = performance.now();
        rot(p.clientX - tg.x, p.clientY - tg.y, Math.max(8, now - tg.t));
        tg.x = p.clientX; tg.y = p.clientY; tg.t = now;
      }, { passive: false });
      const tend = () => { if (tg && tg.mode === 'rotate') { c.classList.remove('drag'); this.idle = 0; } tg = null; };
      c.addEventListener('touchend', tend); c.addEventListener('touchcancel', tend);
      this.dragging = () => !!drag || !!(tg && tg.mode === 'rotate');
    }

    kick() {
      if (this.running || !this.renderer) return;
      this.running = true; this.lastT = performance.now();
      const loop = (t) => {
        const dt = Math.min(0.05, (t - this.lastT) / 1000); this.lastT = t;
        const busy = this.step(dt);
        this.render();
        if ((busy || this.visible) && !document.hidden && this.visible !== false) this.raf = requestAnimationFrame(loop);
        else this.running = false;
      };
      this.raf = requestAnimationFrame(loop);
    }

    step(dt) {
      const target = this.manual ? this.manual.target : this.scrollTarget();
      const k = 90, c = 2 * Math.sqrt(k) * (this.manual ? 0.72 : 1);
      if (this.reduced) { this.x = target; this.v = 0; }
      else { const a = k * (target - this.x) - c * this.v; this.v += a * dt; this.x += this.v * dt; }
      const settled = Math.abs(target - this.x) < 0.0005 && Math.abs(this.v) < 0.0005;
      // touch devices: no manual rotation — the model turns on its own and with the page scroll
      if (this.touchOnly) {
        const sy = window.scrollY, d = sy - this.lastSY; this.lastSY = sy;
        if (!this.reduced) {
          // iOS livre le défilement par à-coups (0 px une image, 40 px la suivante) :
          // on accumule dans un objectif et on le rejoint en douceur au lieu de l'appliquer brut.
          this.yawGoal += dt * 0.35 + clamp(d, -120, 120) * 0.006;
          this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-dt * 7));
        }
        return true;
      }
      // rotation: inertia, then gentle auto-turn when idle
      if (!this.dragging()) {
        this.yaw += this.vy; this.pitch = clamp(this.pitch + this.vp, -1.25, 1.25);
        this.vy *= 0.93; this.vp *= 0.9;
        this.idle += dt;
        if (!this.reduced && this.idle > 2.2) this.yaw += dt * 0.16 * Math.min(1, (this.idle - 2.2) / 1.5);
      }
      return !settled || Math.abs(this.vy) > 1e-4;
    }

    render() {
      const x = this.x;
      for (const p of this.parts) {
        const l = Math.max(0, (x - p.d) / (1 - 0.26)), e = ease(l);
        p.g.position.set(p.v[0] * e, p.v[1] * e, p.v[2] * e);
      }
      const ex = ease(clamp(x, 0, 1));
      this.shadow.position.y = this.minY - 1 - this.shadowDrop * ex;
      this.shadow.material.opacity = (1 - 0.45 * ex) * clamp(this.pitch / 0.12, 0, 1);
      this.shadow.visible = this.pitch > 0.01;
      this.pivot.rotation.set(0, this.yaw, 0);
      const r = this.rAssembled + (this.rExploded - this.rAssembled) * ex;
      const cam = this.camera, half = (cam.fov * Math.PI) / 360;
      const fitV = r / Math.sin(half), fitH = r / Math.sin(Math.atan(Math.tan(half) * cam.aspect));
      const dist = Math.max(fitV, fitH) * 1.08;
      const py = this.pitch;
      cam.position.set(0, Math.sin(py) * dist, Math.cos(py) * dist);
      if (this.look) cam.lookAt(0, this.look[0] + (this.look[1] - this.look[0]) * ex - r * 0.12, 0);
      else cam.lookAt(0, 26 * ex - 16, 0);
      const lb = this.btn.querySelector('.lb'), want = x > 0.5 ? 'Assembler' : 'Éclater';
      if (lb.textContent !== want) lb.textContent = want;
      const o = Math.round(3 * ex * 10) / 10;
      if (o === this._o) { this.renderer.render(this.scene, cam); return; }
      this._o = o;
      this.icons[0].style.transform = `translate(${-o}px,${-o}px)`; this.icons[1].style.transform = `translate(${o}px,${-o}px)`;
      this.icons[2].style.transform = `translate(${-o}px,${o}px)`; this.icons[3].style.transform = `translate(${o}px,${o}px)`;
      this.renderer.render(this.scene, cam);
    }
  }
  customElements.define('cyberline-3d', Cyberline3D);
})();
