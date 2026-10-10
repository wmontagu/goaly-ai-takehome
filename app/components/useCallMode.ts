"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Browser-only voice for "Call mode": speechSynthesis reads the agent's
 * replies, and SpeechRecognition (Chrome, Edge, Safari) turns the caller's
 * speech into a message. No server changes: it only ever speaks the reply the
 * client received, which the output filter has already checked.
 */

// SpeechRecognition isn't in TypeScript's DOM lib yet; this is the slice we use.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Markdown and list markers read badly aloud. */
function speakable(text: string): string {
  return text
    .replace(/[*_#`]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chrome cuts off utterances after ~15s, so speak sentence by sentence. */
function sentences(text: string): string[] {
  return (
    text
      .match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const preferred = [/natural/i, /google us english/i, /samantha/i, /aria|jenny/i];
  for (const re of preferred) {
    const v = voices.find((x) => re.test(x.name));
    if (v) return v;
  }
  return voices.find((v) => v.lang === "en-US") ?? voices[0] ?? null;
}

/** What this browser can do: "speak", "speak+listen", or "" (also the server render). */
function supportKey(): string {
  if (!("speechSynthesis" in window)) return "";
  return recognitionCtor() ? "speak+listen" : "speak";
}
const noSubscribe = () => () => {};

export type CallStatus = "idle" | "speaking" | "listening";

export function useCallMode({ onHeard, canListen }: { onHeard: (text: string) => void; canListen: () => boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const support = useSyncExternalStore(noSubscribe, supportKey, () => "");
  const supported = {
    speak: support !== "",
    listen: support === "speak+listen",
  };
  const recognition = useRef<Recognition | null>(null);
  const enabledRef = useRef(false);
  // Bumped on every stop, so callbacks from an older utterance or
  // recognition session can tell they've been superseded.
  const generation = useRef(0);
  const onHeardRef = useRef(onHeard);
  const canListenRef = useRef(canListen);
  useEffect(() => {
    onHeardRef.current = onHeard;
    canListenRef.current = canListen;
  });

  useEffect(() => {
    // Voices load asynchronously in Chrome; touching the list starts that.
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.getVoices();
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    recognition.current?.abort();
    recognition.current = null;
    setStatus("idle");
  }, []);

  const listen = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || !enabledRef.current || !canListenRef.current()) return;
    stop(); // talking over the agent interrupts it
    const gen = generation.current;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    r.onerror = (e) => {
      if (gen !== generation.current) return;
      // "no-speech" and "aborted" are normal; anything else is worth showing.
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        setError("Microphone access was blocked. Allow it in the browser to talk.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Speech recognition error: ${e.error}`);
    };
    r.onend = () => {
      if (gen !== generation.current) return;
      recognition.current = null;
      setStatus("idle");
      if (heard) onHeardRef.current(heard);
    };
    recognition.current = r;
    setError(null);
    setStatus("listening");
    try {
      r.start();
    } catch {
      setStatus("idle");
    }
  }, [stop]);

  /** Reads a reply aloud; then, unless the call is over, listens for the answer. */
  const speak = useCallback(
    (text: string, { thenListen = true }: { thenListen?: boolean } = {}) => {
      if (!enabledRef.current || !("speechSynthesis" in window)) return;
      stop();
      const gen = generation.current;
      const parts = sentences(speakable(text));
      if (!parts.length) return;
      const voice = pickVoice();
      setStatus("speaking");
      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        if (voice) u.voice = voice;
        u.rate = 1.05;
        if (i === parts.length - 1) {
          u.onend = () => {
            if (gen !== generation.current) return;
            setStatus("idle");
            if (thenListen) listen();
          };
        }
        u.onerror = () => {
          if (gen === generation.current) setStatus("idle");
        };
        speechSynthesis.speak(u);
      });
    },
    [listen, stop],
  );

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    setError(null);
    if (!next) stop();
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { enabled, toggle, status, error, supported, speak, listen, stop };
}
