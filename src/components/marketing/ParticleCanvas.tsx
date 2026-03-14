'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

const CONFIG = {
  particleCount: 50,
  particleSpeed: 0.5,
  connectionDistance: 120,
  particleSize: 2,
  lineOpacity: 0.2,
  colors: ['rgba(0, 240, 255, 0.5)', 'rgba(217, 70, 239, 0.5)', 'rgba(139, 92, 246, 0.5)'],
  mouseRadius: 100,
};

export default function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const mouse = { x: 0, y: 0 };
    let particles: Particle[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const createParticles = () => {
      particles = Array.from({ length: CONFIG.particleCount }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * CONFIG.particleSpeed,
        vy: (Math.random() - 0.5) * CONFIG.particleSpeed,
        size: CONFIG.particleSize,
        color: CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)],
      }));
    };

    const updateParticle = (p: Particle) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CONFIG.mouseRadius) {
        const force = (CONFIG.mouseRadius - dist) / CONFIG.mouseRadius;
        p.x -= (dx / dist) * force * 2;
        p.y -= (dy / dist) * force * 2;
      }
    };

    const drawConnections = () => {
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONFIG.connectionDistance) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(0, 240, 255, ${CONFIG.lineOpacity * (1 - dist / CONFIG.connectionDistance)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        updateParticle(p);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });
      drawConnections();
      animationId = requestAnimationFrame(animate);
    };

    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    resize();
    createParticles();
    animate();
    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', onMouseMove);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
      aria-hidden="true"
    />
  );
}
