"use client";

import { useEffect, useState } from "react";

interface RotatingHeroTextProps {
  texts: string[];
  interval?: number;
}

export function RotatingHeroText({
  texts,
  interval = 3000,
}: RotatingHeroTextProps) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false);

      setTimeout(() => {
        setIndex((prev) => (prev + 1) % texts.length);
        setVisible(true);
      }, 500);
    }, interval);

    return () => clearInterval(timer);
  }, [texts.length, interval]);

  return (
    <>
      <span
        className="inline-block transition-all duration-500 ease-in-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(12px)",
          filter: visible ? "blur(0px)" : "blur(4px)",
        }}
      >
        {texts[index].split("\n").map((line, i, arr) => (
          <span key={i}>
            {line}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </span>
      <noscript>{texts[0]}</noscript>
    </>
  );
}
