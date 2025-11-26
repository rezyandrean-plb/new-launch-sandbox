"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import Editor, {
  Toolbar,
  BtnBold,
  BtnItalic,
  BtnUnderline,
  BtnStrikeThrough,
  BtnBulletList,
  BtnNumberedList,
  BtnLink,
  BtnClearFormatting,
  BtnUndo,
  BtnRedo,
  createDropdown,
  EditorState,
  useEditorState,
  ContentEditableEvent,
} from "react-simple-wysiwyg";

type TextNoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

const FONT_SIZE_OPTIONS = ["8px", "10px", "11px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "40px"];
const COLOR_OPTIONS = [
  { code: "#000000", name: "Black" },
  { code: "#DC2626", name: "Red" },
  { code: "#2563EB", name: "Blue" },
  { code: "#16A34A", name: "Green" },
  { code: "#EA580C", name: "Orange" },
  { code: "#9333EA", name: "Purple" },
  { code: "#CA8A04", name: "Yellow" },
  { code: "#0F172A", name: "Dark Gray" },
];

function ColorPicker() {
  const editorState = useEditorState();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
  }, [isOpen]);

  const handleColorSelect = (color: string) => {
    if (!editorState?.$el) return;
    
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      document.execCommand("foreColor", false, color);
      editorState.$el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setIsOpen(false);
  };

  if (!editorState || editorState.htmlMode) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
        className="rsw-btn flex items-center justify-center gap-1.5"
        style={{ width: "auto", padding: "4px 8px" }}
        title="Font color"
      >
        <span
          className="inline-block w-4 h-4 border border-gray-400 rounded"
          style={{ backgroundColor: "#000000" }}
        />
        <span className="text-sm leading-none">Color</span>
      </button>
      {isOpen &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed bg-white border border-gray-300 rounded shadow-lg p-2 min-w-[180px]"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              zIndex: 99999,
            }}
          >
            {COLOR_OPTIONS.map((color) => (
              <button
                key={color.code}
                type="button"
                onClick={() => handleColorSelect(color.code)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-100 rounded text-left"
              >
                <span
                  className="inline-block w-5 h-5 border border-gray-300 rounded flex-shrink-0"
                  style={{ backgroundColor: color.code }}
                />
                <span className="flex-1 font-mono">{color.code}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

export default function TextNoteEditor({ value, onChange }: TextNoteEditorProps) {
  const [html, setHtml] = useState(value);

  useEffect(() => {
    setHtml(value);
  }, [value]);

  // Add CSS to style dropdowns
  useEffect(() => {
    const styleId = "text-note-editor-styles";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .rsw-dd {
        max-width: 120px;
        font-size: 13px;
        padding: 4px 8px;
      }
      .rsw-btn {
        font-size: 13px;
        padding: 6px 8px;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) existingStyle.remove();
    };
  }, []);

  const handleChange = (event: ContentEditableEvent) => {
    const nextValue = event.target.value;
    setHtml(nextValue);
    onChange(nextValue);
  };

  const FontSizeDropdown = useMemo(
    () =>
      createDropdown(
        "Font size",
        FONT_SIZE_OPTIONS.map<[string, (state: EditorState) => void, string]>((label) => [
          label,
          (state) => {
            const fontSize = label.replace("px", "");
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || !state.$el) return;

            const range = selection.getRangeAt(0);
            if (range.collapsed) return;

            // Check if selection is already wrapped in a span with font-size
            let container = range.commonAncestorContainer;
            if (container.nodeType === Node.TEXT_NODE) {
              container = container.parentElement!;
            }

            // If already in a span with font-size, update it
            if (container instanceof HTMLElement && container.style.fontSize) {
              container.style.fontSize = label;
              return;
            }

            // Wrap selection in a span with font-size
            const span = document.createElement("span");
            span.style.fontSize = label;
            try {
              range.surroundContents(span);
            } catch (e) {
              // If surroundContents fails, extract and wrap
              const contents = range.extractContents();
              span.appendChild(contents);
              range.insertNode(span);
            }

            // Update selection
            selection.removeAllRanges();
            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            selection.addRange(newRange);

            // Trigger input event to notify editor of change
            state.$el.dispatchEvent(new Event("input", { bubbles: true }));
          },
          label,
        ])
      ),
    []
  );


  return (
    <Editor
      value={html}
      onChange={handleChange}
      placeholder="Type the title, note, or caption you want to show"
      containerProps={{
        className: "rsw-wrapper rounded-lg border border-black/20 bg-white",
      }}
    >
      <Toolbar className="flex flex-wrap gap-1">
        <BtnUndo key="undo" />
        <BtnRedo key="redo" />
        <BtnBold key="bold" />
        <BtnItalic key="italic" />
        <BtnUnderline key="underline" />
        <BtnStrikeThrough key="strikethrough" />
        <BtnNumberedList key="numbered-list" />
        <BtnBulletList key="bullet-list" />
        <ColorPicker key="color-picker" />
        <FontSizeDropdown key="font-size-dropdown" />
        <BtnLink key="link" />
        <BtnClearFormatting key="clear-formatting" />
      </Toolbar>
    </Editor>
  );
}

