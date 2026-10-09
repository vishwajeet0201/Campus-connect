"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Keyboard, Mic, MicOff, RotateCcw, Volume2, X } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { NAV_PLACES, isBackCommand, isNextCommand, isRepeatCommand, isStopCommand, matchPlaces, namesakes, normalizeSpeech, planRoute, resolvePlace, splitJourney, type NavPlace, type NavRoute } from "@/lib/navigation";

type Phase = "origin" | "destination" | "guiding" | "arrived";
type Expecting = "origin" | "destination" | "journey";

// The Web Speech API is not in TypeScript's DOM lib; this is the subset we use.
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
type RecognitionEvent = { results: { length: number; [index: number]: RecognitionResult } };
type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type RecognitionConstructor = new () => Recognition;
type Flow = {
  askOrigin: (session: number) => Promise<void>;
  askDestination: (session: number) => Promise<void>;
  guide: (session: number, route: NavRoute, index: number) => Promise<void>;
  handleAnswer: (session: number, texts: string[], expecting: Expecting) => Promise<void>;
};
const IDLE_FLOW: Flow = { askOrigin: async () => {}, askDestination: async () => {}, guide: async () => {}, handleAnswer: async () => {} };

function getRecognition(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function VoiceAssistant({ onRouteChange, onClose }: { onRouteChange: (route: NavRoute | null, stepIndex: number) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("origin");
  const [prompt, setPrompt] = useState("Where are you right now?");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [origin, setOrigin] = useState<NavPlace | null>(null);
  const [destination, setDestination] = useState<NavPlace | null>(null);
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<NavPlace[]>([]);
  const [typed, setTyped] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [canListen] = useState(() => getRecognition() !== null);
  const [showKeyboard, setShowKeyboard] = useState(() => getRecognition() === null);

  const recognitionRef = useRef<Recognition | null>(null);
  const sessionRef = useRef(0);
  const stateRef = useRef({ phase, origin, destination, route, stepIndex, suggestions });

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    setPrompt(text);
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang === "en-IN") ?? window.speechSynthesis.getVoices().find((item) => item.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? "en-IN";
    utterance.rate = 1;
    // Some browsers never fire `end` for long text, so cap the wait.
    const fallback = window.setTimeout(resolve, 1500 + text.length * 90);
    utterance.onend = () => { window.clearTimeout(fallback); resolve(); };
    utterance.onerror = () => { window.clearTimeout(fallback); resolve(); };
    window.speechSynthesis.speak(utterance);
  }), []);

  /** Listens for one phrase and resolves with every alternative the recognizer heard (empty on silence). */
  const listenOnce = useCallback(() => new Promise<string[]>((resolve) => {
    const RecognitionClass = getRecognition();
    if (!RecognitionClass) return resolve([]);
    recognitionRef.current?.abort();
    const recognition = new RecognitionClass();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.continuous = false;
    let finals: string[] = [];
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      setTranscript(result[0].transcript);
      if (result.isFinal) finals = Array.from({ length: result.length }, (_, index) => result[index].transcript);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError("Microphone access is blocked. Allow it in your browser, or type instead.");
        setShowKeyboard(true);
      } else if (event.error === "network") {
        setVoiceError("Voice recognition needs an internet connection. You can type instead.");
        setShowKeyboard(true);
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      resolve(finals);
    };
    recognitionRef.current = recognition;
    setVoiceError("");
    setTranscript("");
    setListening(true);
    recognition.start();
  }), []);

  /** Asks Claude to map a phrase onto a place when the local matcher can't. Null when the AI is unavailable. */
  const resolveWithAi = useCallback(async (utterance: string, expecting: Expecting) => {
    setThinking(true);
    try {
      const response = await fetch("/api/assistant/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ utterance, expecting }) });
      if (!response.ok) return null;
      const data = (await response.json()) as { origin: string | null; destination: string | null; clarification: string | null };
      const find = (id: string | null) => NAV_PLACES.find((place) => place.id === id) ?? null;
      return { origin: find(data.origin), destination: find(data.destination), clarification: data.clarification };
    } catch {
      return null;
    } finally {
      setThinking(false);
    }
  }, []);

  const publishStep = useCallback((nextRoute: NavRoute | null, index: number) => {
    setStepIndex(index);
    onRouteChange(nextRoute, index);
  }, [onRouteChange]);

  // The conversation steps call each other, so they live in a ref that is refreshed after every render.
  const flow = useRef<Flow>({ ...IDLE_FLOW });

  const listenAndHandle = useCallback(async (session: number, expecting: Expecting) => {
    const texts = await listenOnce();
    if (sessionRef.current !== session || !texts.length) return;
    await flow.current.handleAnswer(session, texts, expecting);
  }, [listenOnce]);

  const close = useCallback(() => {
    sessionRef.current += 1;
    stopListening();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    onRouteChange(null, 0);
    onClose();
  }, [onClose, onRouteChange, stopListening]);

  const startRoute = useCallback(async (session: number, from: NavPlace, to: NavPlace) => {
    if (from.id === to.id) {
      setDestination(null);
      setPhase("destination");
      await speak(`You're already at ${to.name}. Where would you like to go instead?`);
      if (sessionRef.current === session) await listenAndHandle(session, "destination");
      return;
    }
    const nextRoute = planRoute(from, to);
    if (!nextRoute) {
      setPhase("destination");
      await speak(`Sorry, I couldn't find a walking route from ${from.name} to ${to.name}. Try another destination.`);
      return;
    }
    setRoute(nextRoute);
    setDestination(nextRoute.to);
    setPhase("guiding");
    setSuggestions([]);
    await speak(`Okay, from ${from.label} to ${nextRoute.to.label}. ${nextRoute.steps.length - 1} steps. The first direction is as seen on the map; after that, left and right are as you walk.`);
    if (sessionRef.current === session) await flow.current.guide(session, nextRoute, 1);
  }, [listenAndHandle, speak]);

  useLayoutEffect(() => {
    stateRef.current = { phase, origin, destination, route, stepIndex, suggestions };
    flow.current.askOrigin = async (session) => {
      setPhase("origin");
      await speak("Where are you right now?");
      if (sessionRef.current === session) await listenAndHandle(session, "origin");
    };

    flow.current.askDestination = async (session) => {
      setPhase("destination");
      await speak("Where do you want to go?");
      if (sessionRef.current === session) await listenAndHandle(session, "destination");
    };

    flow.current.guide = async (session, activeRoute, index) => {
      const bounded = Math.max(1, Math.min(index, activeRoute.steps.length - 1));
      publishStep(activeRoute, bounded);
      const isLast = bounded === activeRoute.steps.length - 1;
      if (isLast) setPhase("arrived");
      else setPhase("guiding");
      await speak(isLast ? activeRoute.steps[bounded].text : `${activeRoute.steps[bounded].text} Say "next" when you get there.`);
      if (sessionRef.current !== session || isLast) return;
      const texts = await listenOnce();
      if (sessionRef.current !== session || !texts.length) return;
      const said = texts[0];
      if (isStopCommand(said)) return close();
      if (isBackCommand(said)) return flow.current.guide(session, activeRoute, bounded - 1);
      if (isNextCommand(said)) return flow.current.guide(session, activeRoute, bounded + 1);
      if (isRepeatCommand(said)) return flow.current.guide(session, activeRoute, bounded);
      await speak(`Say "next", "back", "repeat" or "stop".`);
    };

    flow.current.handleAnswer = async (session, texts, expecting) => {
      const first = texts[0];
      setTranscript(first);
      if (isStopCommand(first) && !resolvePlace(first)) return close();
      const { origin: currentOrigin } = stateRef.current;

      // "I'm at X and want to go to Y" fills both answers at once.
      if (expecting === "origin") {
        const journey = splitJourney(first);
        const from = journey.from ? resolvePlace(journey.from) : null;
        const to = journey.to ? resolvePlace(journey.to) : null;
        if (from && to) {
          setOrigin(from);
          setDestination(to);
          return startRoute(session, from, to);
        }
      }

      // Answering "which one?": match the reply against each candidate's "near ..." hint first.
      const pending = stateRef.current.suggestions;
      if (pending.length > 1 && pending.every((option) => option.name === pending[0].name)) {
        const said = normalizeSpeech(texts.join(" "));
        const picked = pending.find((option) => {
          const hint = option.label.match(/\(near (.+)\)$/)?.[1];
          return hint && ` ${said} `.includes(` ${normalizeSpeech(hint)} `);
        });
        if (picked) {
          setSuggestions([]);
          setOrigin(picked);
          await speak(`Got it, you're at ${picked.label}.`);
          if (sessionRef.current === session) await flow.current.askDestination(session);
          return;
        }
      }

      let place = texts.map((text) => resolvePlace(text)).find(Boolean) ?? null;
      let clarification: string | null = null;
      if (!place) {
        const ai = await resolveWithAi(first, expecting);
        if (sessionRef.current !== session) return;
        if (ai) {
          place = expecting === "origin" ? ai.origin : ai.destination;
          clarification = ai.clarification;
          if (expecting === "origin" && ai.origin && ai.destination) {
            setOrigin(ai.origin);
            setDestination(ai.destination);
            return startRoute(session, ai.origin, ai.destination);
          }
        }
      }

      if (!place) {
        const candidates = matchPlaces(first).map((match) => match.place);
        setSuggestions(candidates);
        const question = clarification ?? (candidates.length > 1
          ? `Did you mean ${candidates.slice(0, -1).map((item) => item.name).join(", ")} or ${candidates.at(-1)!.name}?`
          : candidates.length === 1 ? `Did you mean ${candidates[0].name}?` : `Sorry, I couldn't find "${first}". Please say a room name, like Canteen or Auditorium.`);
        await speak(question);
        if (sessionRef.current === session) await listenAndHandle(session, expecting);
        return;
      }

      // "I'm at the boys washroom" could be either of two: ask which one.
      const twins = namesakes(place);
      if (expecting === "origin" && twins.length) {
        const options = [place, ...twins];
        setSuggestions(options);
        await speak(`There's more than one ${place.name}. Which one are you at: ${options.map((option) => option.label.replace(`${place.name} `, "the one ").replace(/[()]/g, "")).join(", or ")}?`);
        return;
      }
      setSuggestions([]);
      if (expecting === "destination" || (expecting === "journey" && currentOrigin)) {
        setDestination(place);
        if (currentOrigin) return startRoute(session, currentOrigin, place);
        return;
      }
      setOrigin(place);
      await speak(`Got it, you're at ${place.label}.`);
      if (sessionRef.current === session) await flow.current.askDestination(session);
    };
  });

  const restart = () => {
    sessionRef.current += 1;
    stopListening();
    setOrigin(null);
    setDestination(null);
    setRoute(null);
    setSuggestions([]);
    setTranscript("");
    publishStep(null, 0);
    void flow.current.askOrigin(sessionRef.current);
  };

  const expectingNow = (): Expecting => stateRef.current.phase === "destination" ? "destination" : "origin";

  /** Feeds a typed phrase or a tapped suggestion into the same conversation as speech. */
  const submitText = (text: string) => {
    if (!text.trim()) return;
    sessionRef.current += 1;
    stopListening();
    const session = sessionRef.current;
    const { phase: currentPhase, route: currentRoute, stepIndex: currentStep } = stateRef.current;
    if ((currentPhase === "guiding" || currentPhase === "arrived") && currentRoute) {
      if (isNextCommand(text)) void flow.current.guide(session, currentRoute, currentStep + 1);
      else if (isBackCommand(text)) void flow.current.guide(session, currentRoute, currentStep - 1);
      else if (isStopCommand(text)) close();
      else void flow.current.guide(session, currentRoute, currentStep);
      return;
    }
    void flow.current.handleAnswer(session, [text], expectingNow());
  };

  // A tapped chip is unambiguous, even for places that share a name.
  const choose = (place: NavPlace) => {
    sessionRef.current += 1;
    stopListening();
    const session = sessionRef.current;
    setSuggestions([]);
    const { origin: currentOrigin, phase: currentPhase } = stateRef.current;
    if (currentPhase === "destination" && currentOrigin) {
      setDestination(place);
      void startRoute(session, currentOrigin, place);
      return;
    }
    setOrigin(place);
    void speak(`Got it, you're at ${place.label}.`).then(() => { if (sessionRef.current === session) void flow.current.askDestination(session); });
  };

  const micTap = () => {
    if (listening) return stopListening();
    sessionRef.current += 1;
    const session = sessionRef.current;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const { phase: currentPhase, route: currentRoute } = stateRef.current;
    if ((currentPhase === "guiding" || currentPhase === "arrived") && currentRoute) {
      void listenOnce().then((texts) => { if (texts.length && sessionRef.current === session) submitText(texts[0]); });
      return;
    }
    void listenAndHandle(session, expectingNow());
  };

  const goToStep = (index: number) => {
    if (!route) return;
    sessionRef.current += 1;
    stopListening();
    void flow.current.guide(sessionRef.current, route, index);
  };

  // Greet once on open; stop talking and listening when the assistant unmounts.
  useEffect(() => {
    const session = ++sessionRef.current;
    const timer = window.setTimeout(() => void flow.current.askOrigin(session), 150);
    return () => {
      window.clearTimeout(timer);
      sessionRef.current += 1;
      recognitionRef.current?.abort();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const steps = route?.steps ?? [];
  return <motion.section initial={{ y: 140, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 140, opacity: 0 }} transition={{ type: "spring", stiffness: 280, damping: 26 }} className="voice-assistant-container" aria-label="Campus voice guide">
    <div className="voice-assistant surface-material">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">Campus guide · Ground floor</p>
          <p className="voice-route-summary">{origin ? origin.label : "Start?"} <ArrowRight className="inline h-3.5 w-3.5" /> {destination ? destination.label : "Destination?"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="voice-icon-button" aria-label="Start over" onClick={restart}><RotateCcw className="h-4 w-4" /></button>
          <button type="button" className="voice-icon-button" aria-label="Close guide" onClick={close}><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="voice-prompt" aria-live="polite"><Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" /><p>{thinking ? "Thinking…" : prompt}</p></div>
      {transcript && <p className="voice-transcript">You said: “{transcript}”</p>}
      {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}

      {suggestions.length > 0 && phase !== "guiding" && <div className="mt-3 flex flex-wrap gap-2">{suggestions.map((place) => <button key={place.id} type="button" className="filter-chip" onClick={() => choose(place)}>{place.label}</button>)}</div>}

      {route && <ol className="voice-steps">{steps.slice(1).map((step, index) => <li key={`${step.start}-${index}`} data-active={index + 1 === stepIndex} data-done={index + 1 < stepIndex}><button type="button" onClick={() => goToStep(index + 1)}>{step.text}</button></li>)}</ol>}

      <div className="voice-controls">
        {route ? <GlassButton type="button" className="voice-nav-button" aria-label="Previous step" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex <= 1}><ChevronLeft className="h-5 w-5" /></GlassButton> : <span className="voice-nav-spacer" />}
        {canListen ? <button type="button" className="voice-mic" data-listening={listening} aria-label={listening ? "Stop listening" : "Speak"} onClick={micTap}>{listening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}</button> : <span className="voice-unsupported">Voice input isn&apos;t supported in this browser</span>}
        {route ? <GlassButton type="button" className="voice-nav-button" aria-label="Next step" onClick={() => goToStep(stepIndex + 1)} disabled={phase === "arrived"}><ChevronRight className="h-5 w-5" /></GlassButton> : <button type="button" className="voice-icon-button" aria-label="Type instead" onClick={() => setShowKeyboard((open) => !open)}><Keyboard className="h-4 w-4" /></button>}
      </div>

      {canListen && !listening && !thinking && <p className="voice-hint">{route ? "Tap the mic and say “next”, “back”, “repeat” or “stop”." : "Tap the mic and say a room name."}</p>}

      {showKeyboard && phase !== "guiding" && phase !== "arrived" && <form className="voice-type-form" onSubmit={(event) => { event.preventDefault(); submitText(typed); setTyped(""); }}>
        <input className="glass-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={phase === "destination" ? "Where to? e.g. Auditorium" : "Where are you? e.g. Canteen"} aria-label="Type a place" />
        <button type="submit" className="voice-send">Go</button>
      </form>}
    </div>
  </motion.section>;
}
