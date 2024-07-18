import { createWeakMap } from "../utils/createWeakMap";
import type { Note, SatoriContext, SatoriTimeline, SatoriTimelineEvent } from "../types";

export function createTimeline(ctx: SatoriContext): SatoriTimeline {
    const loads = createWeakMap<Note, SatoriTimelineEvent[]>();

    function add(note: Note, event: SatoriTimelineEvent) {
        const events = get(note);
        events.push(event);
        ctx.hooks.callHook(`timeline:${event.name}` as any, event);
    }

    function get(note: Note) {
        return loads.get(note, () => []);
    }

    return {
        add,
        get
    };
}