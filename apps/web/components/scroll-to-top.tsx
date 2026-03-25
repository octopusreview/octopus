"use client";

import { useEffect, useState } from "react";
import { IconArrowUp } from "@tabler/icons-react";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      className={`fixed bottom-6 right-6 z-40 flex size-10 items-center justify-center rounded-full border border-[#10D8BE]/50 bg-[#161616] text-[#10D8BE] shadow-lg shadow-[#10D8BE]/10 transition-all hover:border-[#10D8BE] hover:text-white hover:bg-[#10D8BE]/20 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
      }`}
    >
      <IconArrowUp className="size-4" />
    </button>
  );
}
