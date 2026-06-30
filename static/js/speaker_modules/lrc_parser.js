export function parseLrc(lrcText) {
    if (!lrcText) return [];

    const lyrics = [];
    const lines = String(lrcText).split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

    for (const line of lines) {
        if (!line.trim()) continue;
        timeRegex.lastIndex = 0;

        const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
        if (!text) continue;

        let match;
        while ((match = timeRegex.exec(line)) !== null) {
            const minutes = Number(match[1]);
            const seconds = Number(match[2]);
            const fraction = match[3] || '0';
            const millis = Number(fraction.padEnd(3, '0'));
            lyrics.push({ time: minutes * 60 + seconds + millis / 1000, text });
        }
    }

    lyrics.sort((left, right) => left.time - right.time);
    return lyrics;
}

export function getCurrentLyricIndex(lyrics, position) {
    if (!Array.isArray(lyrics) || lyrics.length === 0 || position < 0) return -1;

    let currentIndex = -1;
    for (let index = 0; index < lyrics.length; index += 1) {
        if (position >= lyrics[index].time) {
            currentIndex = index;
        } else {
            break;
        }
    }
    return currentIndex;
}
