"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Terminal } from "xterm";

import { cn } from "@/lib/utils";

export type PtyTerminalHandle = {
  focus: () => void;
};

type PtyTerminalProps = {
  className?: string;
  output: string;
  onActivate?: () => void;
  onFocusChange?: (focused: boolean) => void;
  onInput: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
};

const TERMINAL_THEME = {
  background: "#f7f9fc",
  foreground: "#243042",
  cursor: "#2563eb",
  cursorAccent: "#f7f9fc",
  selectionBackground: "#bfdbfe",
  selectionInactiveBackground: "#dbeafe",
  black: "#1f2937",
  blue: "#2563eb",
  brightBlack: "#64748b",
  brightBlue: "#1d4ed8",
  brightCyan: "#0f766e",
  brightGreen: "#15803d",
  brightMagenta: "#7c3aed",
  brightRed: "#dc2626",
  brightWhite: "#0f172a",
  brightYellow: "#ca8a04",
  cyan: "#0f766e",
  green: "#15803d",
  magenta: "#7c3aed",
  red: "#dc2626",
  white: "#334155",
  yellow: "#ca8a04",
} as const;

const TERMINAL_FONT_FAMILY =
  '"SFMono-Regular", "SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TERMINAL_FONT_SIZE = 13;
const TERMINAL_LINE_HEIGHT = 1.45;
const TERMINAL_LETTER_SPACING = 0.2;

export const PtyTerminal = forwardRef<PtyTerminalHandle, PtyTerminalProps>(
  function PtyTerminal(
    { className, output, onActivate, onFocusChange, onInput, onResize },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const initTimerRef = useRef<number | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const terminalReadyRef = useRef(false);
    const pendingFocusRef = useRef(false);
    const previousOutputRef = useRef("");
    const lastReportedSizeRef = useRef({ cols: 0, rows: 0 });
    const onInputRef = useRef(onInput);
    const onResizeRef = useRef(onResize);
    const onActivateRef = useRef(onActivate);
    const onFocusChangeRef = useRef(onFocusChange);
    const [isReady, setIsReady] = useState(false);

    onInputRef.current = onInput;
    onResizeRef.current = onResize;
    onActivateRef.current = onActivate;
    onFocusChangeRef.current = onFocusChange;

    const focusTerminal = useCallback(() => {
      if (!terminalReadyRef.current) {
        pendingFocusRef.current = true;
        return;
      }
      terminalRef.current?.focus();
    }, []);

    const measureCellSize = useCallback(() => {
      const host = hostRef.current;
      if (!host) {
        return null;
      }

      const probe = document.createElement("span");
      probe.textContent = "WWWWWWWWWW";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.whiteSpace = "pre";
      probe.style.fontFamily = TERMINAL_FONT_FAMILY;
      probe.style.fontSize = `${TERMINAL_FONT_SIZE}px`;
      probe.style.lineHeight = String(TERMINAL_LINE_HEIGHT);
      host.appendChild(probe);

      const bounds = probe.getBoundingClientRect();
      probe.remove();

      if (bounds.width === 0 || bounds.height === 0) {
        return null;
      }

      return {
        width: bounds.width / 10 + TERMINAL_LETTER_SPACING,
        height: bounds.height,
      };
    }, []);

    const fitTerminal = useCallback(() => {
      const terminal = terminalRef.current;
      const host = hostRef.current;
      if (!terminal || !host) {
        return;
      }
      if (host.clientWidth < 20 || host.clientHeight < 20) {
        return;
      }
      const core = (
        terminal as Terminal & {
          _core?: {
            _renderService?: {
              _renderer?: {
                value?: {
                  dimensions?: unknown;
                };
              };
            };
          };
        }
      )._core;
      if (
        !terminalReadyRef.current ||
        !core?._renderService?._renderer?.value?.dimensions
      ) {
        return;
      }
      const terminalElement = host.querySelector<HTMLElement>(".xterm");
      const cell = measureCellSize();
      if (!terminalElement || !cell) {
        return;
      }
      const elementStyles = window.getComputedStyle(terminalElement);
      const paddingX =
        Number.parseFloat(elementStyles.paddingLeft) +
        Number.parseFloat(elementStyles.paddingRight);
      const paddingY =
        Number.parseFloat(elementStyles.paddingTop) +
        Number.parseFloat(elementStyles.paddingBottom);
      const nextSize = {
        cols: Math.max(
          2,
          Math.floor((host.clientWidth - paddingX) / cell.width),
        ),
        rows: Math.max(
          1,
          Math.floor((host.clientHeight - paddingY) / cell.height),
        ),
      };
      if (!Number.isFinite(nextSize.cols) || !Number.isFinite(nextSize.rows)) {
        return;
      }

      if (terminal.cols !== nextSize.cols || terminal.rows !== nextSize.rows) {
        terminal.resize(nextSize.cols, nextSize.rows);
      }

      if (
        nextSize.cols !== lastReportedSizeRef.current.cols ||
        nextSize.rows !== lastReportedSizeRef.current.rows
      ) {
        lastReportedSizeRef.current = nextSize;
        onResizeRef.current?.(nextSize.cols, nextSize.rows);
      }
    }, [measureCellSize]);

    const scheduleFit = useCallback(() => {
      if (resizeFrameRef.current !== null) {
        return;
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fitTerminal();
      });
    }, [fitTerminal]);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          focusTerminal();
        },
      }),
      [focusTerminal],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      let disposed = false;
      let terminal: Terminal | null = null;
      let firstRenderDisposable: { dispose: () => void } | null = null;
      let resizeObserver: ResizeObserver | null = null;

      const handlePointerDown = () => {
        onActivateRef.current?.();
        if (!terminalReadyRef.current || !terminal) {
          pendingFocusRef.current = true;
          return;
        }
        window.requestAnimationFrame(() => {
          terminal?.focus();
        });
      };
      const handleFocusIn = () => {
        onFocusChangeRef.current?.(true);
      };
      const handleFocusOut = () => {
        onFocusChangeRef.current?.(false);
      };

      host.addEventListener("pointerdown", handlePointerDown);
      host.addEventListener("focusin", handleFocusIn);
      host.addEventListener("focusout", handleFocusOut);

      initTimerRef.current = window.setTimeout(() => {
        if (disposed) {
          return;
        }

        terminal = new Terminal({
          allowProposedApi: false,
          convertEol: false,
          cursorBlink: true,
          cursorStyle: "block",
          drawBoldTextInBrightColors: true,
          fontFamily: TERMINAL_FONT_FAMILY,
          fontSize: TERMINAL_FONT_SIZE,
          lineHeight: TERMINAL_LINE_HEIGHT,
          letterSpacing: TERMINAL_LETTER_SPACING,
          macOptionClickForcesSelection: true,
          overviewRulerWidth: 0,
          scrollback: 5000,
          smoothScrollDuration: 0,
          theme: TERMINAL_THEME,
        });
        terminal.attachCustomKeyEventHandler((event) => {
          if (
            event.metaKey &&
            ["a", "c", "f", "r", "v", "x", "z"].includes(
              event.key.toLowerCase(),
            )
          ) {
            return false;
          }
          return true;
        });
        terminal.onData((data) => onInputRef.current(data));
        terminal.open(host);

        firstRenderDisposable = terminal.onRender(() => {
          if (terminalReadyRef.current) {
            return;
          }
          terminalReadyRef.current = true;
          setIsReady(true);
          scheduleFit();
          if (pendingFocusRef.current) {
            pendingFocusRef.current = false;
            window.requestAnimationFrame(() => {
              terminal?.focus();
            });
          }
          firstRenderDisposable?.dispose();
        });

        resizeObserver = new ResizeObserver(() => {
          scheduleFit();
        });
        resizeObserver.observe(host);

        terminalRef.current = terminal;
        terminalReadyRef.current = false;
        setIsReady(false);
        pendingFocusRef.current = false;
        previousOutputRef.current = "";
      }, 0);

      return () => {
        disposed = true;
        if (initTimerRef.current !== null) {
          window.clearTimeout(initTimerRef.current);
          initTimerRef.current = null;
        }
        host.removeEventListener("pointerdown", handlePointerDown);
        host.removeEventListener("focusin", handleFocusIn);
        host.removeEventListener("focusout", handleFocusOut);
        resizeObserver?.disconnect();
        firstRenderDisposable?.dispose();
        if (resizeFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        previousOutputRef.current = "";
        lastReportedSizeRef.current = { cols: 0, rows: 0 };
        terminalReadyRef.current = false;
        pendingFocusRef.current = false;
        setIsReady(false);
        terminalRef.current = null;
        onFocusChangeRef.current?.(false);
        terminal?.dispose();
      };
    }, [scheduleFit]);

    useEffect(() => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      const previousOutput = previousOutputRef.current;
      if (output === previousOutput) {
        return;
      }

      if (!previousOutput && output) {
        terminal.write(output);
      } else if (previousOutput && output.startsWith(previousOutput)) {
        terminal.write(output.slice(previousOutput.length));
      } else {
        terminal.reset();
        if (output) {
          terminal.write(output);
        }
      }

      previousOutputRef.current = output;
      if (terminalReadyRef.current) {
        scheduleFit();
      }
    }, [output, scheduleFit]);

    return (
      <div
        className={cn(
          "vibe-terminal relative size-full min-h-0 overflow-hidden bg-[#f7f9fc]",
          className,
        )}
      >
        <div ref={hostRef} className="size-full" />
        {!isReady && (
          <button
            type="button"
            onClick={() => onActivateRef.current?.()}
            className="absolute inset-0 z-10 cursor-text bg-transparent"
            aria-label="Prepare terminal"
          />
        )}
      </div>
    );
  },
);
