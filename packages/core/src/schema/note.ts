import { createDefu } from "defu";
import type { Note } from "../types";

type MaybeGetter<T> = T | (() => T);

export interface DefineNoteOptions<T> {
    defaults?: MaybeGetter<CreateNoteOptions<T>>;
}

type CreateNoteOptions<T> = Partial<Omit<T, "kind">>;

const defuNote = createDefu((obj, key, value) => {
    if (Array.isArray(value) && Array.isArray(obj[key])) {
        obj[key] = value;
        return true;
    }
});

export function defineNote<T extends Note>(kind: string, options: DefineNoteOptions<T> = {}) {
    const {
        defaults: defs
    } = options;

    const defaults = typeof defs === "function" ? defs() : defs;

    function create(options: CreateNoteOptions<T>) {
        return {
            ...defuNote(options, defaults),
            get kind() {
                return kind;
            }
        } as T;
    }

    function is(note: Note): note is T {
        return note.kind === kind;
    }

    return {
        create,
        is
    };
}