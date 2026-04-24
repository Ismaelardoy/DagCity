import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
import { State } from './State.js';

export class VFXManager {
  constructor(scene) {
    this.scene = scene;
    this.smokeTex = this.createCircleTexture('#555555');
    this.sparkTex = this.createCircleTexture('#ffffff');
    this.fireTex  = this.createFireTexture();
  }

  createCircleTexture(color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  createFireTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(64, 128, 64, 0);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.2, '#fff700');
    grad.addColorStop(0.5, '#ff6600');
    grad.addColorStop(0.8, '#ff3300');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.bezierCurveTo(90, 40, 110, 80, 100, 128);
    ctx.lineTo(28, 128);
    ctx.bezierCurveTo(18, 80, 38, 40, 64, 0);
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  }

  createThermalGroup(height) {
    const group = new THREE.Group();
    group.name = 'vfx_thermal';
    
    // Smoke System
    const smokeSystem = new THREE.Group();
    smokeSystem.name = 'vfx_smoke';
    for (let i = 0; i < 15; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0, blending: THREE.NormalBlending });
      const s = new THREE.Sprite(mat);
      s.userData = { 
        phase: Math.random() * Math.PI * 2, 
        speed: 0.2 + Math.random() * 0.3, 
        life: Math.random(),
        offset: new THREE.Vector3((Math.random()-0.5)*10, height, (Math.random()-0.5)*10)
      };
      smokeSystem.add(s);
    }
    group.add(smokeSystem);

    // Spark System
    const sparkSystem = new THREE.Group();
    sparkSystem.name = 'vfx_sparks';
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.sparkTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(mat);
      s.userData = { 
        vel: new THREE.Vector3((Math.random()-0.5)*40, 30 + Math.random()*50, (Math.random()-0.5)*40),
        life: 1.0,
        age: 1.0
      };
      sparkSystem.add(s);
    }
    group.add(sparkSystem);

    // Fire System
    const fireSystem = new THREE.Group();
    fireSystem.name = 'vfx_fire';
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.fireTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(mat);
      s.userData = { 
        phase: Math.random() * Math.PI * 2, 
        speed: 0.8 + Math.random() * 0.5,
        offset: new THREE.Vector2((Math.random()-0.5)*12, (Math.random()-0.5)*12)
      };
      fireSystem.add(s);
    }
    group.add(fireSystem);

    group.visible = false;
    return group;
  }

  update(meshes, t, dt, critSet) {
    const selectedNode = State.selectedNode;

    meshes.forEach(m => {
      const ud = m.userData;
      const n = ud.node;
      const vfx = m.children.find(c => c.name === 'vfx_thermal');
      if (!vfx) return;

      // 1. Calculate SLA Ratio (Robust check for 0s)
      let slaTarget = State.slaNodes[n.id];
      if (slaTarget === undefined) slaTarget = State.slaZones[n.layer];
      if (slaTarget === undefined) slaTarget = State.userDefinedSLA;
      
      const vfxThresholds = State.vfxThresholds || { smoke: 1.0, sparks: 1.2, fire: 1.5 };
      const ratio = (slaTarget <= 0) ? 999 : (n.execution_time / slaTarget);
      const isError = n.status === 'error' || n.state === 'error';
      const smoke  = vfx.children.find(c => c.name === 'vfx_smoke');
      const sparks = vfx.children.find(c => c.name === 'vfx_sparks');
      const fire   = vfx.children.find(c => c.name === 'vfx_fire');
      const currentH = ud.baseH * m.scale.y;
      
      // We only show thermal effects if Performance Mode is ON and Particles are enabled
      vfx.visible = State.perfMode && State.showParticles && (ratio >= vfxThresholds.smoke || isError);

      // ── Level 1: Smoke (Ratio >= smoke threshold) ─────────────────
      const showSmoke = State.perfMode && State.showParticles && (ratio >= vfxThresholds.smoke || isError);
      smoke.visible = showSmoke;
      if (showSmoke) {
        smoke.children.forEach(s => {
          const sud = s.userData;
          sud.life = (sud.life + dt * 0.4) % 1.0;
          const drift = sud.life * 60;
          s.position.set(
            sud.offset.x + Math.sin(t * 2 + sud.phase) * 4,
            (currentH + drift) / m.scale.y, 
            sud.offset.z + Math.cos(t * 2 + sud.phase) * 4
          );
          s.material.opacity = Math.sin(sud.life * Math.PI) * 0.45;
          const sScale = (8 + sud.life * 30);
          s.scale.set(sScale, sScale / m.scale.y, 1);
        });
      }

      // ── Level 2: Sparks & Pulse (Ratio >= sparks threshold) ────────
      const showSparks = State.perfMode && State.showParticles && (ratio >= vfxThresholds.sparks || isError);
      sparks.visible = showSparks;
      if (showSparks) {
        sparks.children.forEach(s => {
          const sud = s.userData;
          sud.age += dt * 2.5;
          if (sud.age > 1.0) {
             sud.age = 0;
             s.position.set((Math.random()-0.5)*12, currentH / m.scale.y, (Math.random()-0.5)*12);
             sud.vel.set((Math.random()-0.5)*120, 100 + Math.random()*150, (Math.random()-0.5)*120);
          }
          s.position.addScaledVector(sud.vel, dt / m.scale.y);
          sud.vel.y -= 350 * dt;
          s.material.opacity = (1.0 - sud.age) * 0.9;
          const spkScale = 2.0 * (1.0 - sud.age);
          s.scale.set(spkScale, spkScale / m.scale.y, 1);
        });
        // Breathing pulse
        const pulse = 0.5 + Math.sin(t * 4) * 0.5;
        m.material.forEach(mat => {
          mat.emissiveIntensity += ( (0.2 + pulse * 2.5) - mat.emissiveIntensity ) * 0.1;
        });
      } else {
        m.material.forEach(mat => { mat.emissiveIntensity += (0.15 - mat.emissiveIntensity) * 0.05; });
      }

      // ── Level 3: Fire (Ratio >= fire threshold) ───────────────────
      const showFire = State.perfMode && State.showParticles && (ratio >= vfxThresholds.fire || isError);
      fire.visible = showFire;
      if (showFire) {
        fire.children.forEach(f => {
          const fud = f.userData;
          const life = (t * fud.speed + fud.phase) % 1.0;
          const age = 1.0 - life;
          f.position.set(fud.offset.x * age, (currentH + life * 50) / m.scale.y, fud.offset.y * age);
          const fScale = 20 * age;
          f.scale.set(fScale, fScale / m.scale.y, 1);
          f.material.opacity = age * 0.9;
        });
      }
    });
  }
}
