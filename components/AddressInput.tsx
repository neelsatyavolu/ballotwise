"use client";

import { useEffect, useId, useState } from "react";
import type { AddressSuggestion } from "@/lib/ballot/suggest";

const DEBOUNCE_MS = 250;

/** A combobox: type part of an address, pick a full match. Typing a complete address by hand still works. */
export function AddressInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 4 || q === picked) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const json = (await res.json()) as { suggestions?: AddressSuggestion[] };
        setSuggestions(json.suggestions ?? []);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted by newer typing, or offline: the field still accepts a typed address.
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, picked]);

  function choose(s: AddressSuggestion) {
    setPicked(s.address);
    onChange(s.address);
    setOpen(false);
    setSuggestions([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && value.trim().length >= 4 && value.trim() !== picked;

  return (
    <div className="combo">
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={showList && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Start typing your street address"
        value={value}
        onChange={(e) => {
          setPicked(null);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showList && (
        <ul className="combo-list" id={listId} role="listbox" aria-label="Matching addresses">
          {suggestions.length === 0 ? (
            <li className="combo-empty" aria-live="polite">
              {loading ? "Looking up addresses…" : "No match yet. Keep typing, or enter the full address with city and state."}
            </li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.address}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="combo-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
              >
                <span className="combo-line1">{s.line1}</span>
                <span className="combo-line2">{s.line2}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
