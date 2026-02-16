// data.js
export let currentRange = "1d";
export let currentSymbol = "ATW";
export let currentExchange = "CSEMA";

// Analyzer settings
export function getAnalyzerSettings() {
    const defaults = { rsi: true, macd: true, fib: true, patterns: true };
    try {
        const stored = localStorage.getItem('analyzerSettings');
        return stored ? JSON.parse(stored) : defaults;
    } catch {
        return defaults;
    }
}

export function setAnalyzerSettings(settings) {
    localStorage.setItem('analyzerSettings', JSON.stringify(settings));
}

// Setters
export function setCurrentRange(range) {
    currentRange = range;
}

export function setCurrentSymbol(symbol) {
    currentSymbol = symbol.toUpperCase();
}

export function setCurrentExchange(exchange) {
    currentExchange = exchange.toUpperCase();
}

export async function getData() {
    const loading = document.getElementById('loadingIndicator');
    const progress = document.getElementById('fetchProgress');
    if (loading) loading.style.display = 'inline-flex';
    if (progress) progress.style.display = 'block';
    try {
        const params = new URLSearchParams({
            symbol: currentSymbol,
            exchange: currentExchange,
            range: currentRange
        });
        const res = await fetch('/data?' + params.toString());
        const data = await res.json();
        if (data.error) return { Time: [], Open: [], High: [], Low: [], Close: [], Volume: [], _meta: { status: 'error', message: data.error } };

        // server returns { <range>: {...}, meta: {...} }
        const payload = data[currentRange] || { Time: [], Open: [], High: [], Low: [], Close: [], Volume: [] };
        if (data.meta) payload._meta = data.meta;
        return payload;
    } catch (e) {
        console.error("Data fetch error:", e);
        return { Time: [], Open: [], High: [], Low: [], Close: [], Volume: [], _meta: { status: 'error', message: e.message } };
    } finally {
        if (loading) loading.style.display = 'none';
        if (progress) progress.style.display = 'none';
    }
}