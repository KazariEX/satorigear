import type { SatoriContext, SatoriTimer } from "../types";

export function createTimer(ctx: SatoriContext): SatoriTimer {
    const duration = 4;
    let timeout: NodeJS.Timeout | undefined = void 0;
    let start = 0;
    let last = 0;

    function next() {
        const now = update();
        const diff = now - last;
        timeout = setTimeout(next, diff % duration + duration);
        last = now;
    }

    function run() {
        ctx.hooks.callHook("timer:run");
        start ||= performance.now();
        last = performance.now() - duration;
        next();
    }

    function stop() {
        const now = performance.now();
        const diff = now - last;
        if (diff >= 1) {
            update();
        }
        clearTimeout(timeout);
        ctx.hooks.callHook("timer:stop");
    }

    function update() {
        const now = performance.now();
        const timestamp = now - start;
        ctx.hooks.callHook("timer:update", timestamp);
        return now;
    }

    return {
        run,
        stop
    };
}