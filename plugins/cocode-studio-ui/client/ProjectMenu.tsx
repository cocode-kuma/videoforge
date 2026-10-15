import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function ProjectMenu({
  name,
  rendering,
  onAction,
}: {
  name: string;
  rendering: boolean;
  onAction: (action: "rename" | "delete") => void;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        height = menu.current?.offsetHeight || 110;
      setPosition({
        left: Math.max(12, Math.min(r.right - 190, innerWidth - 202)),
        top: Math.max(
          12,
          r.bottom + height + 8 > innerHeight
            ? r.top - height - 6
            : r.bottom + 6,
        ),
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
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`project-menu-trigger ${open ? "is-open" : ""}`}
        aria-label={`${name}的项目菜单`}
        title="项目操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={`${name}的操作`}
            className="project-action-menu"
            style={position}
            onBlur={(e) => {
              if (
                !menu.current?.contains(e.relatedTarget) &&
                !trigger.current?.contains(e.relatedTarget)
              )
                setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "Tab") close();
              else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
              ) {
                e.preventDefault();
                const items = Array.from(
                    menu.current!.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ),
                  i = items.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                items[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                        items.length
                ]?.focus();
              }
            }}
          >
            <div className="project-menu-heading" title={name}>
              {name}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onAction("rename");
              }}
            >
              <Pencil size={15} />
              重命名
            </button>
            <div className="project-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="delete-action"
              disabled={rendering}
              title={rendering ? "当前项目正在生成，完成后可删除" : undefined}
              onClick={() => {
                close();
                onAction("delete");
              }}
            >
              <Trash2 size={15} />
              删除项目
            </button>
            {rendering && <small>生成完成后可删除</small>}
          </div>,
          document.body,
        )}
    </>
  );
}
