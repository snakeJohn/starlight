const defaultArrayKeys = ['list', 'songs', 'data'];

export function asArray(value, keys = defaultArrayKeys) {
    if (Array.isArray(value)) return value;
    for (const key of keys) {
        const nested = value?.[key];
        if (Array.isArray(nested)) return nested;
    }
    return [];
}

export function resultCount(value) {
    return value?.total ?? value?.list?.length ?? asArray(value).length ?? 0;
}
