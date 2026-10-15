import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export function StudioSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  icon,
  wide = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
  icon?: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [keyboard, setKeyboard] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    id = useId();
  const selected = options.find((o) => o.value === value)??{value,label:String(value)};
  useLayoutEffect(() => {
    if(open) document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'});
  },[open,active,id]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        width = Math.min(
          Math.max(wide ? r.width : 220, 220),
          window.innerWidth - 24,
        );
      const height = menu.current?.offsetHeight || options.length * 55 + 40;
      setPosition({
        left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
        top: Math.max(
          12,
          r.bottom + height + 8 > window.innerHeight
            ? r.top - height - 8
            : r.bottom + 8,
        ),
        width,
      });
    };
    const outside = (e: PointerEvent) => {
      if (
        !trigger.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, wide, options.length]);
  const choose = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        data-value={String(value)}
        className={`studio-select ${wide ? "wide" : ""} ${open ? "is-open" : ""}`}
        onClick={() => {
          setKeyboard(false);
          setActive(options.findIndex((o) => o.value === value));
          setOpen(!open);
        }}
        onBlur={(e) => {
          if (!menu.current?.contains(e.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (
            ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
              e.key,
            )
          ) {
            e.preventDefault();
            setKeyboard(true);
            if (!open) {
              setActive(options.findIndex((o) => o.value === value));
              setOpen(true);
              return;
            }
            if (e.key === "Enter" || e.key === " ") choose(active);
            else if (e.key === "Home") setActive(0);
            else if (e.key === "End") setActive(options.length - 1);
            else
              setActive(
                (i) =>
                  (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                  options.length,
              );
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Tab") setOpen(false);
        }}
      >
        {icon}
        <span>{selected.label}</span>
        <ChevronDown size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={`studio-select-menu ${keyboard ? "instant" : ""}`}
            style={position}
          >
            <div className="select-heading">{label}</div>
            <div role="listbox" id={id} aria-label={label}>
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  id={`${id}-${i}`}
                  aria-selected={o.value === value}
                  tabIndex={-1}
                  className={`studio-select-option ${i === active ? "highlighted" : ""}`}
                  onPointerMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                >
                  <span>
                    <strong>{o.label}</strong>
                    {o.description && <small>{o.description}</small>}
                  </span>
                  {o.value === value && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
