import { createHooks } from "hookable";
import type { SatoriContext, SatoriHooks } from "../types";
import { createTimeline } from "./timeline";
import { createTimer } from "./timer";

export interface CreateContextOptions {}

export function createContext(options: CreateContextOptions = {}) {
    const ctx = {} as SatoriContext;
    ctx.hooks = createHooks<SatoriHooks>();
    ctx.timeline = createTimeline(ctx);
    ctx.timer = createTimer(ctx);

    return ctx;
}