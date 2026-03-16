const fs = require('fs');
const Papa = require('papaparse');

const filePath = 'c:\\Users\\Admin\\Documents\\ASO-Keyword-Optimization (Upgrade)\\keywords-analysis__Keywords-List-#-1__Prank-Sounds_-Haircut-&-Taser__2026-03-01.csv';
const fileContent = fs.readFileSync(filePath, 'utf8');

const { data, meta } = Papa.parse(fileContent, { header: true, skipEmptyLines: 'greedy' });

console.log(`Parsed ${data.length} rows.`);

const columnMapping = {
    keyword: 'Keyword',
    volume: 'Volume',
    difficulty: 'Difficulty',
    kei: 'KEI',
    appName: 'App Name',
    rank: 'Rank'
};

const uniqueApps = Array.from(new Set(data.map(r => r[columnMapping.appName]).filter(Boolean)));
console.log(`Unique Apps found (${uniqueApps.length}):`, uniqueApps.slice(0, 5).join(', ') + '...');

const appMapping = {
    myApp: uniqueApps[0], // assume the first one is 'myApp'
    competitors: uniqueApps.slice(1, 10)
};

const processedKeywordsMap = new Map();

for (const raw of data) {
    const keywordStr = String(raw[columnMapping.keyword] || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!keywordStr || keywordStr === 'null' || keywordStr === 'n/a' || keywordStr === '-' || keywordStr === 'na') {
        continue;
    }

    const parseNum = (val, allowZero = false) => {
        if (val === null || val === undefined || val === '') return null;
        const strVal = String(val).toLowerCase().trim();
        if (strVal === 'null' || strVal === 'n/a' || strVal === '-' || strVal === 'na') return null;
        const num = parseFloat(strVal);
        if (isNaN(num)) return null;
        if (!allowZero && num <= 0) return null;
        return num;
    };

    const vol = parseNum(raw[columnMapping.volume], true);
    const diff = parseNum(raw[columnMapping.difficulty], true);
    const keival = parseNum(raw[columnMapping.kei], true);

    const appName = String(raw[columnMapping.appName] || '').trim();
    const rank = parseNum(raw[columnMapping.rank], false);

    if (!processedKeywordsMap.has(keywordStr)) {
        processedKeywordsMap.set(keywordStr, {
            keyword: keywordStr,
            volume: vol,
            difficulty: diff,
            kei: keival,
            my_rank: null,
            competitor_ranks: {},
        });
    }

    const existing = processedKeywordsMap.get(keywordStr);

    if (existing.volume === null && vol !== null) existing.volume = vol;
    if (existing.difficulty === null && diff !== null) existing.difficulty = diff;
    if (existing.kei === null && keival !== null) existing.kei = keival;

    if (rank !== null) {
        if (appName === appMapping.myApp) {
            if (existing.my_rank === null || rank < existing.my_rank) {
                existing.my_rank = rank;
            }
        } else if (appMapping.competitors.includes(appName)) {
            if (existing.competitor_ranks[appName] === undefined || existing.competitor_ranks[appName] === null || rank < existing.competitor_ranks[appName]) {
                existing.competitor_ranks[appName] = rank;
            }
        }
    }
}

console.log(`Total unique keywords extracted: ${processedKeywordsMap.size}`);

// Verify a few keywords
const sampleKeys = Array.from(processedKeywordsMap.keys()).slice(0, 3);
for (const key of sampleKeys) {
    console.log(`\nKeyword: ${key}`);
    console.dir(processedKeywordsMap.get(key), { depth: null });
}
