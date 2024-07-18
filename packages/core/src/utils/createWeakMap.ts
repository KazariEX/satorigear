export interface SatoriWeakMap<K extends WeakKey, T extends object> extends Omit<WeakMap<K, T>, "get"> {
    get: (key: K, defaultValue: () => T) => T;
}

export function createWeakMap<K extends WeakKey, T extends object>() {
    const weakMap = new WeakMap<K, T>();

    const get = (key: K, defaultValue: () => T) => {
        if (weakMap.has(key)) {
            return weakMap.get(key);
        }
        else {
            const value = defaultValue();
            weakMap.set(key, value);
            return value;
        }
    };

    Object.defineProperty(weakMap, "get", {
        value: get
    });

    return weakMap as SatoriWeakMap<K, T>;
}