import type { Hookable } from "hookable";

export interface Note {
    time: number;
    get kind(): string;
}

export interface SatoriContext {
    hooks: Hookable<SatoriHooks>;
    timeline: SatoriTimeline;
    timer: SatoriTimer;
}

export interface SatoriHooks {
    "timer:run": () => any;
    "timer:stop": () => any;
    "timer:update": (timestamp: number) => any;
}

export interface SatoriTimeline {
    add: (note: Note, event: SatoriTimelineEvent) => void;
    get: (note: Note) => SatoriTimelineEvent[];
}

export interface SatoriTimelineEvent {
    name: string;
    time: number;
}

export interface SatoriTimer {
    run: () => void;
    stop: () => void;
}