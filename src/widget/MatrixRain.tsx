import { useEffect, useRef } from "react";

interface MatrixRainProps {
  /** Accent color for the rain characters — default is classic green */
  color?: string;
  /** Overall opacity of the rain effect */
  opacity?: number;
  /** Speed multiplier */
  speed?: number;
}

const CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF";

interface Drop {
  x: number;
  y: number;
  speed: number;
  chars: string[];
  length: number;
  opacity: number;
  delay: number;
}

export function MatrixRain({ color = "#00ff41", opacity = 0.12, speed = 1 }: MatrixRainProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let drops: Drop[] = [];
    let frame = 0;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      w = parent.offsetWidth;
      h = parent.offsetHeight;
      canvas!.width = w;
      canvas!.height = h;
      initDrops();
    }

    function initDrops() {
      drops = [];
      const fontSize = 10;
      const cols = Math.floor(w / fontSize) + 1;
      for (let i = 0; i < cols; i++) {
        const length = 4 + Math.floor(Math.random() * 12);
        const chars: string[] = [];
        for (let j = 0; j < length; j++) {
          chars.push(CHARS[Math.floor(Math.random() * CHARS.length)]);
        }
        drops.push({
          x: i * fontSize,
          y: -Math.random() * h * 2,
          speed: (0.3 + Math.random() * 0.7) * speed,
          chars,
          length,
          opacity: 0.3 + Math.random() * 0.7,
          delay: Math.random() * 200,
        });
      }
    }

    function draw() {
      frame++;
      ctx!.clearRect(0, 0, w, h);
      const fontSize = 10;

      for (const drop of drops) {
        if (frame < drop.delay) continue;

        // Occasionally change a random char in the stream
        if (Math.random() < 0.02) {
          const idx = Math.floor(Math.random() * drop.length);
          drop.chars[idx] = CHARS[Math.floor(Math.random() * CHARS.length)];
        }

        ctx!.font = `${fontSize}px "JetBrains Mono", monospace`;

        for (let j = 0; j < drop.length; j++) {
          const charY = drop.y - j * fontSize;
          if (charY < -fontSize || charY > h + fontSize) continue;

          // Head char is brightest, tail fades
          const fade = j === 0 ? 1 : Math.max(0, 1 - j / drop.length);
          const alpha = drop.opacity * fade * opacity;

          if (j === 0) {
            // Head: white-ish
            ctx!.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
          } else {
            // Parse the hex color and apply alpha
            const r = parseInt(color.slice(1, 3), 16) || 0;
            const g = parseInt(color.slice(3, 5), 16) || 255;
            const b = parseInt(color.slice(5, 7), 16) || 65;
            ctx!.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          }

          ctx!.fillText(drop.chars[j], drop.x, charY);
        }

        drop.y += drop.speed * 1.5;

        // Reset when fully off screen
        if (drop.y - drop.length * fontSize > h) {
          drop.y = -Math.random() * h * 0.5;
          drop.speed = (0.3 + Math.random() * 0.7) * speed;
          drop.opacity = 0.3 + Math.random() * 0.7;
          // Regenerate chars
          for (let j = 0; j < drop.length; j++) {
            drop.chars[j] = CHARS[Math.floor(Math.random() * CHARS.length)];
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    resize();
    animRef.current = requestAnimationFrame(draw);

    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement!);

    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, [color, opacity, speed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
