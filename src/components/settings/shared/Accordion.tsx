import { useState } from "react";
import type { ReactNode } from "react";

interface AccordionProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Accordion({ label, children, defaultOpen = false }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="s-accordion">
      <button
        className="s-accordion-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        type="button"
      >
        <span className={`s-accordion-chevron${open ? " open" : ""}`}>▾</span>
        {label}
      </button>
      {open && <div className="s-accordion-body">{children}</div>}
    </div>
  );
}
