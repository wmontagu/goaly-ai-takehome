"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Voice for "Call mode". The agent's replies are read aloud with the
 * browser's speechSynthesis. The caller's speech is transcribed by Deepgram
 * through /api/transcribe when the server has a key (works in any modern
 * browser), or else by the browser's own SpeechRecognition (Chrome/Edge only,
 * and it depends on the browser vendor's cloud service).
 *
 * It only ever speaks the reply the client received, which the output filter
 * has already checked, and a transcript is sent like a typed message.
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
  stop(): void;
  abort(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
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

/** "speak" bit, then "rec" (browser recognition) and/or "media" (can record for the server). "" on the server render. */
function supportKey(): string {
  if (!("speechSynthesis" in window)) return "";
  const rec = recognitionCtor() ? "+rec" : "";
  const media = typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) ? "+media" : "";
  return `speak${rec}${media}`;
}
const noSubscribe = () => () => {};

// End-of-turn detection for recorded speech, by loudness.
const SPEECH_RMS = 0.015; // louder than this counts as talking
const END_SILENCE_MS = 1100; // this much quiet after talking ends the turn
const NO_SPEECH_MS = 8000; // give up if the caller never starts talking
const MAX_TURN_MS = 30000;

export type CallStatus = "idle" | "speaking" | "listening" | "transcribing";

export function useCallMode({
  onHeard,
  canListen,
  sessionId,
}: {
  onHeard: (text: string) => void;
  canListen: () => boolean;
  sessionId: string | undefined;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [serverStt, setServerStt] = useState(false);
  const support = useSyncExternalStore(noSubscribe, supportKey, () => "");
  const useServer = serverStt && support.includes("+media");
  const supported = {
    speak: support !== "",
    listen: useServer || support.includes("+rec"),
    engine: useServer ? ("deepgram" as const) : ("browser" as const),
  };

  const enabledRef = useRef(false);
  // Bumped on every stop, so callbacks from an older utterance, recording or
  // recognition session can tell they've been superseded.
  const generation = useRef(0);
  const recognition = useRef<Recognition | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  /** Ends the current recording: send it for transcription, or throw it away. */
  const endRecording = useRef<((send: boolean) => void) | null>(null);
  const latest = useRef({ onHeard, canListen, sessionId, useServer });
  useEffect(() => {
    latest.current = { onHeard, canListen, sessionId, useServer };
  });

  useEffect(() => {
    // Voices load asynchronously in Chrome; touching the list starts that.
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
    fetch("/api/transcribe")
      .then((r) => r.json())
      .then((d: { available?: boolean }) => setServerStt(Boolean(d.available)))
      .catch(() => {});
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    recognition.current?.abort();
    recognition.current = null;
    endRecording.current?.(false);
    endRecording.current = null;
    setStatus("idle");
  }, []);

  const releaseMic = useCallback(() => {
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }, []);

  const deliver = useCallback((gen: number, text: string) => {
    if (gen !== generation.current) return;
    setStatus("idle");
    if (text) latest.current.onHeard(text);
    else setError("Didn't catch that. Tap the mic to try again, or type.");
  }, []);

  /** Records one caller turn and transcribes it on the server (Deepgram). */
  const record = useCallback(async () => {
    stop(); // talking over the agent interrupts it
    const gen = generation.current;
    setError(null);
    setStatus("listening");

    try {
      micStream.current ??= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      if (gen === generation.current) {
        setError("Microphone access was blocked. Allow it in the browser to talk.");
        setStatus("idle");
      }
      return;
    }
    if (gen !== generation.current) return;

    const stream = micStream.current;
    const ctx = (audioCtx.current ??= new AudioContext());
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let send = false;
    let spoke = false;
    const startedAt = performance.now();
    let quietSince = startedAt;

    const end = (shouldSend: boolean) => {
      send = shouldSend;
      if (rec.state !== "inactive") rec.stop();
    };
    endRecording.current = end;

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      if (rms > SPEECH_RMS) {
        spoke = true;
        quietSince = now;
      }
      if (spoke && now - quietSince > END_SILENCE_MS) end(true);
      else if (!spoke && now - startedAt > NO_SPEECH_MS) end(false);
      else if (now - startedAt > MAX_TURN_MS) end(true);
    }, 100);

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      window.clearInterval(timer);
      source.disconnect();
      if (endRecording.current === end) endRecording.current = null;
      if (gen !== generation.current) return;
      if (!send) {
        setStatus("idle");
        return;
      }
      setStatus("transcribing");
      const type = rec.mimeType || "audio/webm";
      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": type, "x-session-id": latest.current.sessionId ?? "" },
          body: new Blob(chunks, { type }),
        });
        const data = (await res.json()) as { text?: string; error?: string };
        if (gen !== generation.current) return;
        if (!res.ok) {
          setStatus("idle");
          setError(data.error === "session_gone" ? "This session expired. Start a new call." : (data.error ?? "Speech-to-text failed."));
          return;
        }
        deliver(gen, data.text ?? "");
      } catch {
        if (gen !== generation.current) return;
        setStatus("idle");
        setError("Couldn't reach the server to transcribe. Please try again or type.");
      }
    };
    rec.start();
  }, [deliver, stop]);

  /** Fallback: the browser's own recognition (Chrome/Edge). */
  const recognize = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    stop();
    const gen = generation.current;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    r.continuous = false;
    let heard = "";
    let failed = false;
    r.onresult = (e) => {
      heard = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    r.onerror = (e) => {
      if (gen !== generation.current) return;
      failed = true;
      // "no-speech" and "aborted" are normal; anything else is worth showing.
      if (e.error === "not-allowed" || e.error === "service-not-allowed")
        setError("Microphone access was blocked. Allow it in the browser to talk.");
      else if (e.error === "network")
        setError("This browser couldn't reach its speech service (common outside Chrome and Edge, or behind a VPN). Type instead.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Speech recognition error: ${e.error}`);
    };
    r.onend = () => {
      if (gen !== generation.current) return;
      recognition.current = null;
      setStatus("idle");
      if (heard) latest.current.onHeard(heard);
      else if (!failed) setError("Didn't catch that. Tap the mic to try again, or type.");
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

  const listen = useCallback(() => {
    if (!enabledRef.current || !latest.current.canListen()) return;
    if (latest.current.useServer) void record();
    else recognize();
  }, [record, recognize]);

  /** Mic button while listening: end the caller's turn now and send it. */
  const finish = useCallback(() => {
    if (endRecording.current) endRecording.current(true);
    else recognition.current?.stop();
  }, []);

  /** Reads a reply aloud; then, unless the call is over, listens for the answer. */
  const speak = useCallback(
    (text: string) => {
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
            listen();
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
    if (next) {
      // Created inside the click so the browser lets it run (autoplay policy);
      // the loudness check needs it to detect when the caller stops talking.
      if (typeof AudioContext !== "undefined") audioCtx.current ??= new AudioContext();
    } else {
      stop();
      releaseMic();
    }
  }, [releaseMic, stop]);

  useEffect(
    () => () => {
      stop();
      releaseMic();
    },
    [releaseMic, stop],
  );

  return { enabled, toggle, status, error, supported, speak, listen, finish, stop };
}
