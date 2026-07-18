"use client";

import {
  cleanNumericDisplay,
  isPartialNumericString,
  numericStringFromValue,
  parseNumericString,
} from "@/lib/numeric-input";
import { useEffect, useState } from "react";

type Props = {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  onBlur?: () => void;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
};

/**
 * Text-based decimal input — keeps what the user types while focused and only
 * normalizes on blur (no valueAsNumber / type=number float glitches).
 */
export function NumericInput({
  value,
  onChange,
  onBlur,
  id,
  className,
  placeholder,
  disabled,
  readOnly,
}: Props) {
  const [text, setText] = useState(() => numericStringFromValue(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(numericStringFromValue(value));
  }, [value, focused]);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      value={text}
      className={className}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseNumericString(text);
        onChange(parsed);
        if (parsed != null) {
          setText(cleanNumericDisplay(parsed));
        } else {
          setText("");
        }
        onBlur?.();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!isPartialNumericString(raw)) return;
        setText(raw);
        onChange(parseNumericString(raw));
      }}
    />
  );
}
