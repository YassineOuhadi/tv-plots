import { getData, setCurrentRange, setCurrentSymbol, setCurrentExchange, currentRange as rangeRef, currentSymbol as symbolRef, currentExchange as exchangeRef, getAnalyzerSettings, setAnalyzerSettings } from "./data.js";
import { calculateSMA, calculateEMA, calculateRSI, calculateBB, calculateMACD } from "./indicators.js";

let chartInitialized = false;
let indicators = [];
let currentTab = null;
const tabLayouts = {};
const tabNames = {}; 
let theme = "dark";

function renderActiveIndicators() {
    const container = document.getElementById("activeIndicators");
    container.innerHTML = "";
    indicators.forEach(ind => {
        const div = document.createElement("div");
        const left = document.createElement('div');
        left.textContent = `${ind.type} (period: ${ind.period})`;
        const btn = document.createElement("button");
        btn.textContent = "Remove";
        btn.onclick = () => removeIndicator(ind.id);
        div.appendChild(left);
        div.appendChild(btn);
        container.appendChild(div);
    });
}

function addIndicator(type) {
    const id = `${type}_${Date.now()}`;
    let period = 20;
    if (["SMA", "EMA", "RSI", "BB"].includes(type)) {
        period = parseInt(prompt(`Enter period for ${type} (default 20)`)) || 20;
    }
    indicators.push({ id, type, period });
    tabLayouts[currentTab].indicators = [...indicators];
    renderActiveIndicators();
    plotChart();
}

function removeIndicator(id) {
    indicators = indicators.filter(ind => ind.id !== id);
    tabLayouts[currentTab].indicators = [...indicators];
    renderActiveIndicators();
    plotChart();
}

function switchTab(tab) {
    const prev = currentTab;
    if (prev && document.getElementById(prev + 'Btn')) {
        document.getElementById(prev + 'Btn').classList.remove('active');
    }

    currentTab = tab;
    const tabData = tabLayouts[tab];
    indicators = [...(tabData.indicators || [])];

    const btn = document.getElementById(tab + 'Btn');
    if (btn) btn.classList.add('active');

    setCurrentSymbol(tabData.symbol);
    setCurrentExchange(tabData.exchange);
    document.getElementById("symbolSelect").value = tabData.symbol;
    document.getElementById("exchangeSelect").value = tabData.exchange;

    renderActiveIndicators();
    plotChart();
}

function _sanitizeId(s) {
    return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function createTab(symbol, exchange) {
    const base = `tab_${_sanitizeId(symbol)}_${_sanitizeId(exchange)}`;
    let id = base;
    let i = 1;
    while (tabLayouts[id]) {
        id = `${base}_${i++}`;
    }

    const tabsContainer = document.getElementById('tabs');
    const btn = document.createElement('button');
    btn.id = id + 'Btn';
    btn.textContent = `${symbol}/${exchange}`;
    btn.classList.add('tab-btn');
    // accessibility
    btn.title = `Open ${symbol} on ${exchange}`;
    btn.addEventListener('click', () => switchTab(id));
    tabsContainer.appendChild(btn);

    tabLayouts[id] = { indicators: [], symbol: symbol, exchange: exchange };

    // immediately switch to the newly created tab
    switchTab(id);
}

function applyPreset(name) {
    switch (name) {
        case "Default": indicators = []; break;
        case "MA+RSI":
            indicators = [
                { id: 'SMA_20', type: 'SMA', period: 20 },
                { id: 'RSI_14', type: 'RSI', period: 14 }
            ]; break;
        case "Full":
            indicators = [
                { id: 'SMA_20', type: 'SMA', period: 20 },
                { id: 'EMA_20', type: 'EMA', period: 20 },
                { id: 'RSI_14', type: 'RSI', period: 14 },
                { id: 'BB_20', type: 'BB', period: 20 }
            ]; break;
    }
    tabLayouts[currentTab].indicators = [...indicators];
    renderActiveIndicators();
    plotChart();
}

function setTheme(newTheme) {
    theme = newTheme;
    if (newTheme === 'auto') {
        document.body.classList.remove('light', 'dark');
        try {
            if (!window.__themeListenerAdded) {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                const handler = () => { if (theme === 'auto') plotChart(); };
                if (mq.addEventListener) mq.addEventListener('change', handler);
                else if (mq.addListener) mq.addListener(handler);
                window.__themeListenerAdded = true;
            }
        } catch (e) { /* ignore */ }
    } else {
        document.body.classList.remove('light', 'dark');
        document.body.classList.add(newTheme);
    }
    plotChart(); // replot chart with new theme
}

export async function plotChart() {
    const data = await getData();
    if (!data || !data.Close || data.Close.length === 0) {
        const statusSymbol = document.getElementById('statusSymbol');
        const statusMeta = document.getElementById('statusMeta');
        const statusTime = document.getElementById('statusTime');
        if (statusSymbol) statusSymbol.textContent = `${symbolRef}/${exchangeRef}`;
        if (statusMeta) { statusMeta.textContent = '(no data)'; statusMeta.className = 'status-error'; }
        if (statusTime) statusTime.textContent = '';
        return;
    }

    const meta = data._meta || {};
    const statusSymbol = document.getElementById('statusSymbol');
    const statusMeta = document.getElementById('statusMeta');
    const statusTime = document.getElementById('statusTime');
    if (statusSymbol) statusSymbol.textContent = `${symbolRef}/${exchangeRef}`;
    if (statusMeta) {
        if (meta.status === 'ok' || !meta.status) {
            statusMeta.textContent = 'OK';
            statusMeta.className = 'status-ok';
        } else if (meta.status === 'error') {
            statusMeta.textContent = meta.last_error || meta.message || 'Error';
            statusMeta.className = 'status-error';
        } else {
            statusMeta.textContent = meta.status;
            statusMeta.className = '';
        }
    }
    if (statusTime) {
        let t = '';
        if (meta && meta.last_updated) {
            try {
                const v = Number(meta.last_updated);
                if (!Number.isNaN(v)) {
                    // assume seconds since epoch if reasonably large, otherwise show as date
                    const date = v > 1e12 ? new Date(v) : new Date(v * 1000);
                    t = `Updated: ${date.toLocaleString()}`;
                }
            } catch (e) {
                t = '';
            }
        }
        if (!t) t = `Fetched: ${new Date().toLocaleString()}`;
        statusTime.textContent = t;
    }

    const traces = [];

    // Candlestick
    traces.push({
        x: data.Time,
        open: data.Open,
        high: data.High,
        low: data.Low,
        close: data.Close,
        type: 'candlestick',
        name: 'Price',
        yaxis: 'y1',
        increasing: { line: { color: 'green' } },
        decreasing: { line: { color: 'red' } },
        customdata: data.Volume,
        hovertemplate:
            '<b>Time:</b> %{x}<br><b>O:</b>%{open}<br><b>H:</b>%{high}<br><b>L:</b>%{low}<br><b>C:</b>%{close}<br><b>Vol:</b>%{customdata}<extra></extra>'
    });

    // Volume bars
    const volumeColors = data.Close.map((c, i) => c >= data.Open[i] ? 'green' : 'red');
    traces.push({
        x: data.Time,
        y: data.Volume,
        type: 'bar',
        name: 'Volume',
        marker: { color: volumeColors },
        yaxis: 'y2',
        hoverinfo: 'skip'
    });

    // Add indicators
    indicators.forEach(ind => {
        switch (ind.type) {
            case 'SMA':
                traces.push({ x: data.Time, y: calculateSMA(data.Close, ind.period), type: 'scatter', mode: 'lines', name: `SMA(${ind.period})` });
                break;
            case 'EMA':
                traces.push({ x: data.Time, y: calculateEMA(data.Close, ind.period), type: 'scatter', mode: 'lines', name: `EMA(${ind.period})` });
                break;
            case 'BB':
                const bb = calculateBB(data.Close, ind.period);
                traces.push({ x: data.Time, y: bb.upper, type: 'scatter', mode: 'lines', name: `BB Upper(${ind.period})`, line: { dash: 'dot' } });
                traces.push({ x: data.Time, y: bb.lower, type: 'scatter', mode: 'lines', name: `BB Lower(${ind.period})`, line: { dash: 'dot' } });
                break;
            case 'RSI':
                const rsi = calculateRSI(data.Close, ind.period);
                traces.push({ x: data.Time, y: rsi, type: 'scatter', mode: 'lines', name: `RSI(${ind.period})`, yaxis: 'y3', line: { color: 'purple' } });
                break;
            case 'MACD':
                const macdData = calculateMACD(data.Close);
                traces.push({ x: data.Time, y: macdData.macd, type: 'scatter', mode: 'lines', name: 'MACD', line: { color: 'orange' }, yaxis: 'y4' });
                traces.push({ x: data.Time, y: macdData.signalLine, type: 'scatter', mode: 'lines', name: 'Signal', line: { color: 'blue' }, yaxis: 'y4' });
                break;
        }
    });

    const layout = {
        title: `TV Plot - ${symbolRef}/${exchangeRef} (${rangeRef})`,
        plot_bgcolor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
        paper_bgcolor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
        font: { color: theme === 'dark' ? '#e0e0e0' : '#000000' },
        xaxis: { title: 'Time', rangeslider: { visible: !["1d", "1w"].includes(rangeRef) }, showspikes: true, spikemode: 'across', spikecolor: 'grey', spikesnap: 'cursor' },
        yaxis4: { title: 'MACD', domain: [0.02, 0.12], anchor: 'x', automargin: true },
        yaxis3: {
            title: 'RSI',
            domain: [0.16, 0.26],
            showgrid: true,
            zeroline: false,
            range: [0, 100],
            tickmode: 'auto',
            automargin: true
        },
        // increased gap between RSI (y3) and Volume (y2) for breathing room
        yaxis2: { title: 'Volume', domain: [0.36, 0.50], showgrid: false, automargin: true },
        yaxis: { title: 'Price', domain: [0.56, 1], automargin: true },
        margin: { t: 64, l: 72, r: 64, b: 80 },
        hovermode: 'x unified',
        showlegend: true
    };

    try {
        const settings = getAnalyzerSettings();
        const anaRes = await fetch(`/analyze_cached?symbol=${symbolRef}&exchange=${exchangeRef}&range=${rangeRef}&rsi=${settings.rsi}&macd=${settings.macd}&fib=${settings.fib}&patterns=${settings.patterns}`);
        if (anaRes.ok) {
            const anaJson = await anaRes.json();
            const analysis = anaJson.analysis || anaJson;
            if (analysis) {
                // update status with score/patterns
                if (analysis.score !== undefined && statusMeta) {
                    statusMeta.textContent = `Score: ${Number(analysis.score).toFixed(2)}`;
                    statusMeta.className = analysis.score > 0.6 ? 'status-ok' : (analysis.score < 0.4 ? 'status-error' : 'status-stale');
                }
                if (analysis.patterns && analysis.patterns.length && statusTime) {
                    statusTime.textContent = `Patterns: ${analysis.patterns.join(', ')}`;
                }

                // draw fibonacci levels on price axis if available
                if (analysis.fib && analysis.fib.levels) {
                    layout.shapes = layout.shapes || [];
                    const levels = analysis.fib.levels;
                    const x0 = data.Time[0];
                    const x1 = data.Time[data.Time.length - 1];
                    Object.keys(levels).forEach((k, idx) => {
                        const val = levels[k];
                        layout.shapes.push({
                            type: 'line', xref: 'x', yref: 'y', x0: x0, x1: x1, y0: val, y1: val,
                            line: { color: idx % 2 === 0 ? '#ffcc00' : '#ff9f00', width: 1, dash: 'dot' }
                        });
                    });
                }

                // add top-right annotation for score
                if (analysis.score !== undefined) {
                    layout.annotations = layout.annotations || [];
                    layout.annotations.push({
                        xref: 'paper', yref: 'paper', x: 0.99, y: 0.98,
                        xanchor: 'right', yanchor: 'top', showarrow: false,
                        bgcolor: theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)',
                        text: `Score: ${Number(analysis.score).toFixed(2)}`,
                        font: { color: theme === 'dark' ? '#fff' : '#111' }
                    });
                }
            }
        }
    } catch (e) {
        console.warn('Analysis fetch failed', e);
    }

    if (!chartInitialized) {
        Plotly.newPlot('chart', traces, layout, { responsive: true });
        chartInitialized = true;
    } else {
        Plotly.react('chart', traces, layout, { responsive: true });
    }
}

document.getElementById("rangeSelect").addEventListener("change", (e) => {
    setCurrentRange(e.target.value);
    plotChart();
});

function _onSymbolExchangeChange() {
    const loadingIndicator = document.getElementById("loadingIndicator");
    loadingIndicator.style.display = "inline";
    const symbol = document.getElementById("symbolSelect").value;
    const exchange = document.getElementById("exchangeSelect").value;

    try {
        createTab(symbol, exchange);
    } catch (err) {
        console.error("Error loading symbol/exchange:", err);
        alert("Error loading symbol/exchange");
    } finally {
        loadingIndicator.style.display = "none";
    }
}

document.getElementById("symbolSelect").addEventListener("change", _onSymbolExchangeChange);
document.getElementById("exchangeSelect").addEventListener("change", _onSymbolExchangeChange);

document.getElementById("themeSelect").addEventListener("change", (e) => setTheme(e.target.value));

try {
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.value = theme;
        setTheme(theme);
    }
} catch (e) {
    console.warn('Theme init failed', e);
}

const settingsBtn = document.getElementById('settingsBtn');
const settingsMenu = document.getElementById('settingsMenu');
if (settingsBtn && settingsMenu) {
    settingsBtn.addEventListener('click', (e) => {
        const visible = settingsMenu.getAttribute('aria-hidden') === 'false';
        settingsMenu.setAttribute('aria-hidden', visible ? 'true' : 'false');
        settingsBtn.setAttribute('aria-expanded', visible ? 'false' : 'true');
    });

    document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (!settingsMenu.contains(target) && !settingsBtn.contains(target)) {
            settingsMenu.setAttribute('aria-hidden', 'true');
            settingsBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

try {
    const settings = getAnalyzerSettings();
    document.getElementById('analyzerRSI').checked = settings.rsi;
    document.getElementById('analyzerMACD').checked = settings.macd;
    document.getElementById('analyzerFib').checked = settings.fib;
    document.getElementById('analyzerPatterns').checked = settings.patterns;

    ['analyzerRSI', 'analyzerMACD', 'analyzerFib', 'analyzerPatterns'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const key = e.target.id.replace('analyzer', '').toLowerCase();
                const newSettings = getAnalyzerSettings();
                newSettings[key] = e.target.checked;
                setAnalyzerSettings(newSettings);
                plotChart();
            });
        }
    });
} catch (e) {
    console.warn('Analyzer settings init failed', e);
}

document.getElementById("addSMA").addEventListener("click", () => addIndicator("SMA"));
document.getElementById("addEMA").addEventListener("click", () => addIndicator("EMA"));
document.getElementById("addBB").addEventListener("click", () => addIndicator("BB"));
document.getElementById("addRSI").addEventListener("click", () => addIndicator("RSI"));
document.getElementById("addMACD").addEventListener("click", () => addIndicator("MACD"));

document.getElementById("presetDefault").addEventListener("click", () => applyPreset("Default"));
document.getElementById("presetMA").addEventListener("click", () => applyPreset("MA+RSI"));
document.getElementById("presetFull").addEventListener("click", () => applyPreset("Full"));

document.getElementById("downloadJSON").addEventListener("click", async () => {
    try {
        const data = await getData();
        const exportData = {
            symbol: symbolRef,
            exchange: exchangeRef,
            range: rangeRef,
            timestamp: new Date().toISOString(),
            data: data
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `data_${symbolRef}_${rangeRef}_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Error exporting data:", err);
        alert("Error exporting data");
    }
});

setInterval(plotChart, 10000);
try {
    const symEl = document.getElementById('symbolSelect');
    const exEl = document.getElementById('exchangeSelect');
    if (symEl && exEl) {
        createTab(symEl.value, exEl.value);
    } else {
        createTab(symbolRef, exchangeRef);
    }
} catch (e) {
    console.warn('Could not create initial tab:', e);
}

plotChart();

(function(){
    const splitter = document.getElementById('splitter');
    const container = document.querySelector('.mainContent');
    if (!splitter || !container) return;
    let dragging = false;
    let startX = 0;
    let startLeftWidth = 0;

    const leftPanel = document.getElementById('leftPanel');
    const onDown = (clientX) => {
        dragging = true;
        startX = clientX;
        startLeftWidth = leftPanel.getBoundingClientRect().width;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    const onMove = (clientX) => {
        if (!dragging) return;
        const dx = clientX - startX;
        let newLeft = startLeftWidth + dx;
        const min = 140;
        const max = window.innerWidth - 320;
        if (newLeft < min) newLeft = min;
        if (newLeft > max) newLeft = max;
        container.style.gridTemplateColumns = `${newLeft}px 8px 1fr`;
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    };

    splitter.addEventListener('mousedown', (e) => onDown(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onUp);

    splitter.addEventListener('touchstart', (e) => onDown(e.touches[0].clientX), {passive:false});
    window.addEventListener('touchmove', (e) => { if (e.touches && e.touches[0]) onMove(e.touches[0].clientX); }, {passive:false});
    window.addEventListener('touchend', onUp);
})();
async function loadScannerResults(range = "1d") {
    const settings = getAnalyzerSettings();
    const loading = document.getElementById('scannerLoading');
    const resultsDiv = document.getElementById('scannerResults');
    
    if (loading) loading.style.display = 'inline-flex';
    try {
        const res = await fetch(`/scan?range=${range}&rsi=${settings.rsi}&macd=${settings.macd}&fib=${settings.fib}&patterns=${settings.patterns}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const results = json.results || [];
        
        let html = '<table class="scanner-table"><thead><tr>';
        html += '<th onclick="sortScannerBy(this, \'symbol\')">Symbol</th>';
        html += '<th onclick="sortScannerBy(this, \'score\')">Score</th>';
        html += '<th onclick="sortScannerBy(this, \'trend\')">Trend</th>';
        html += '<th>RSI</th><th>MACD Cross</th><th>Patterns</th>';
        html += '</tr></thead><tbody>';
        
        results.forEach(r => {
            const scoreClass = r.score > 0.6 ? 'scanner-score-high' : (r.score < 0.4 ? 'scanner-score-low' : 'scanner-score-mid');
            const trendClass = `scanner-trend-${r.trend || 'flat'}`;
            html += `<tr style="cursor:pointer;" onclick="selectSymbolAndSwitch('${r.symbol}')">`;
            html += `<td><strong>${r.symbol}</strong></td>`;
            html += `<td class="${scoreClass}">${(r.score || 0).toFixed(2)}</td>`;
            html += `<td class="${trendClass}">${(r.trend || 'flat').toUpperCase()}</td>`;
            html += `<td>${r.rsi ? r.rsi.toFixed(1) : '—'}</td>`;
            html += `<td>${r.macd_cross ? '✓' : '—'}</td>`;
            html += `<td>${r.patterns && r.patterns.length ? r.patterns.join(', ') : '—'}</td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        resultsDiv.innerHTML = html;
    } catch (e) {
        console.error('Scanner failed:', e);
        resultsDiv.innerHTML = `<p style="color:var(--danger);">Error: ${e.message}</p>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function selectSymbolAndSwitch(symbol) {
    document.getElementById('symbolSelect').value = symbol;
    createTab(symbol, 'CSEMA');
    document.getElementById('viewChartBtn').click();
}

function sortScannerBy(th, field) {
    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const ascending = !th.dataset.ascending;
    th.dataset.ascending = ascending;
    const idx = ['symbol', 'score', 'trend'].indexOf(field);
    rows.sort((a, b) => {
        const aVal = a.children[idx].textContent;
        const bVal = b.children[idx].textContent;
        const cmp = field === 'score' ? parseFloat(bVal) - parseFloat(aVal) : aVal.localeCompare(bVal);
        return ascending ? cmp : -cmp;
    });
    rows.forEach(r => tbody.appendChild(r));
}

document.querySelectorAll('.viewTab').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        const view = e.target.dataset.view;
        document.querySelectorAll('.viewTab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.viewContent').forEach(v => v.style.display = 'none');
        e.target.classList.add('active');
        if (view === 'chart') {
            document.getElementById('chartView').style.display = 'block';
        } else if (view === 'scanner') {
            document.getElementById('scannerView').style.display = 'block';
            try {
                await fetch('/scan_warmup', { method: 'POST' });
            } catch (e) {
                console.warn('Warmup request failed (non-critical):', e);
            }
            loadScannerResults(document.getElementById('scannerRangeSelect').value);
        } else if (view === 'analysis') {
            document.getElementById('analysisView').style.display = 'block';
        }
    });
});

async function loadAdvancedAnalysis() {
    const symbol = symbolRef || document.getElementById('symbolSelect').value || 'ATW';
    const range = document.getElementById('advAnalysisRange').value || '1d';
    const loading = document.getElementById('analysisLoading');
    const errDiv = document.getElementById('analysisError');
    
    loading.style.display = 'block';
    errDiv.style.display = 'none';
    
    try {
        const res = await fetch(`/advanced_analysis?symbol=${symbol}&range=${range}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        
        displayAdvancedAnalysis(data);
    } catch (e) {
        console.error('Advanced analysis failed:', e);
        errDiv.textContent = `Error: ${e.message}`;
        errDiv.style.display = 'block';
    } finally {
        loading.style.display = 'none';
    }
}

function displayAdvancedAnalysis(data) {
    const adv = data.advanced || {};
    const decision = data.decision || {};
    
    const decisionCard = document.getElementById('decisionCard');
    if (decision.recommendation) {
        decisionCard.style.display = 'block';
        document.getElementById('recommendationBadge').textContent = decision.recommendation.toUpperCase();
        document.getElementById('recommendationBadge').style.background = 
            decision.recommendation.includes('buy') ? 'var(--success)' :
            decision.recommendation.includes('sell') ? 'var(--danger)' : 'var(--muted)';
        document.getElementById('recommendationBadge').style.color = 'white';
        document.getElementById('signalStrength').textContent = (decision.signal * 100).toFixed(0) + '%';
        document.getElementById('signalConfidence').textContent = (decision.confidence * 100).toFixed(0) + '%';
        
        const components = decision.components || {};
        const compsList = document.getElementById('componentsList');
        const compsGrid = document.getElementById('componentsGrid');
        if (components && Object.keys(components).length > 0) {
            compsList.style.display = 'block';
            compsGrid.innerHTML = '';
            Object.entries(components).forEach(([key, val]) => {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const color = val > 0.6 ? 'var(--success)' : (val < 0.4 ? 'var(--danger)' : 'var(--muted)');
                compsGrid.innerHTML += `<div style="display:flex; justify-content:space-between;"><span>${label}:</span> <strong style="color:${color};">${(val*100).toFixed(0)}%</strong></div>`;
            });
        }
    }
    
    // Volatility
    if (adv.volatility) {
        document.getElementById('volCard').style.display = 'block';
        document.getElementById('volAnnual').textContent = (adv.volatility.volatility * 100).toFixed(2) + '%';
        document.getElementById('volRolling').textContent = (adv.volatility.rolling_volatility * 100).toFixed(2) + '%';
        document.getElementById('volPercentile').textContent = adv.volatility.vol_percentile.toFixed(0) + '%';
    }
    
    // Momentum
    if (adv.momentum) {
        document.getElementById('momCard').style.display = 'block';
        document.getElementById('momPercent').textContent = adv.momentum.momentum_pct.toFixed(2) + '%';
        document.getElementById('momDir').textContent = adv.momentum.momentum_direction.toUpperCase();
        document.getElementById('momAvg').textContent = adv.momentum.momentum.toFixed(2);
    }
    
    // Stochastic
    if (adv.stochastic) {
        document.getElementById('stochCard').style.display = 'block';
        document.getElementById('stochK').textContent = adv.stochastic.stochastic_k.toFixed(1);
        document.getElementById('stochD').textContent = adv.stochastic.stochastic_d.toFixed(1);
        document.getElementById('stochSignal').textContent = adv.stochastic.stochastic_signal.toUpperCase();
    }
    
    // ADX
    if (adv.adx) {
        document.getElementById('adxCard').style.display = 'block';
        document.getElementById('adxValue').textContent = adv.adx.adx.toFixed(1);
        document.getElementById('adxStrength').textContent = adv.adx.adx_strength.toUpperCase();
        document.getElementById('adxPdi').textContent = adv.adx['+di'].toFixed(1);
        document.getElementById('adxNdi').textContent = adv.adx['-di'].toFixed(1);
    }
    
    // Support/Resistance
    if (adv.support_resistance) {
        document.getElementById('srCard').style.display = 'block';
        const sr = adv.support_resistance;
        document.getElementById('srPrice').textContent = sr.current_price.toFixed(2);
        document.getElementById('srSupport').textContent = sr.support.toFixed(2);
        document.getElementById('srResist').textContent = sr.resistance.toFixed(2);
        document.getElementById('srDistS').textContent = sr.distance_to_support.toFixed(2) + '%';
    }
    
    // MA Cross
    if (adv.ma_cross) {
        document.getElementById('maCard').style.display = 'block';
        document.getElementById('maSignal').textContent = adv.ma_cross.signal.toUpperCase();
        document.getElementById('maDistance').textContent = adv.ma_cross.distance.toFixed(3) + '%';
        document.getElementById('maFast').textContent = adv.ma_cross.fast_ma.toFixed(2);
        document.getElementById('maSlow').textContent = adv.ma_cross.slow_ma.toFixed(2);
    }
}

if (document.getElementById('loadAdvAnalysisBtn')) {
    document.getElementById('loadAdvAnalysisBtn').addEventListener('click', loadAdvancedAnalysis);
}

if (document.getElementById('scannerRangeSelect')) {
    document.getElementById('scannerRangeSelect').addEventListener('change', (e) => {
        loadScannerResults(e.target.value);
    });
}
if (document.getElementById('scanRefreshBtn')) {
    document.getElementById('scanRefreshBtn').addEventListener('click', () => {
        loadScannerResults(document.getElementById('scannerRangeSelect').value);
    });
}

async function trainMLModel() {
    const btn = document.getElementById('trainMLBtn');
    const status = document.getElementById('mlStatus');
    const metrics = document.getElementById('mlMetrics');
    
    btn.disabled = true;
    btn.textContent = 'Training...';
    status.textContent = 'Training...';
    
    try {
        const res = await fetch('/train_model', { method: 'POST' });
        const json = await res.json();
        
        if (json.status === 'success') {
            status.textContent = '✓ Trained';
            status.style.color = 'var(--success)';
            
            const m = json.metrics;
            let metricsText = `Accuracy: ${(m.accuracy*100).toFixed(1)}%\n`;
            metricsText += `Precision: ${(m.precision*100).toFixed(1)}%\n`;
            metricsText += `Recall: ${(m.recall*100).toFixed(1)}%\n`;
            metricsText += `F1 Score: ${(m.f1*100).toFixed(1)}%\n`;
            metricsText += `Train: ${m.train_size} samples | Test: ${m.test_size} samples`;
            metrics.textContent = metricsText;
            metrics.style.maxHeight = '200px';
        } else if (json.status === 'insufficient_data') {
            status.textContent = `⚠ Need ${json.min_required} labels (have ${json.samples})`;
            status.style.color = 'var(--warning)';
        } else {
            status.textContent = '✗ Training failed';
            status.style.color = 'var(--danger)';
        }
    } catch (e) {
        console.error('Training error:', e);
        status.textContent = '✗ Error';
        status.style.color = 'var(--danger)';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Train Model';
    }
}

async function addTradeLabel() {
    const symbol = document.getElementById('labelSymbolInput').value.trim().toUpperCase();
    const outcome = parseInt(document.getElementById('labelOutcomeSelect').value);
    
    if (!symbol) {
        alert('Enter symbol');
        return;
    }
    
    const date = new Date().toISOString().split('T')[0];
    
    try {
        const res = await fetch(`/label_trade/${symbol}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, outcome })
        });
        const json = await res.json();
        
        alert(`Labeled: ${symbol} on ${date} as ${outcome ? 'Good' : 'Bad'}\nTotal labels: ${json.total_labels}`);
        document.getElementById('labelSymbolInput').value = '';
    } catch (e) {
        console.error('Labeling error:', e);
        alert('Failed to add label');
    }
}

async function toggleMLScanner() {
    const useML = document.getElementById('toggleMLScannerBtn').dataset.useML !== 'true';
    
    if (useML) {
        document.getElementById('toggleMLScannerBtn').dataset.useML = 'true';
        document.getElementById('toggleMLScannerBtn').style.background = 'var(--accent)';
        document.getElementById('toggleMLScannerBtn').style.color = 'var(--accent-contrast)';
        
        await loadMLScannerResults(document.getElementById('scannerRangeSelect').value);
    } else {
        document.getElementById('toggleMLScannerBtn').data.useML = 'false';
        document.getElementById('toggleMLScannerBtn').style.background = 'var(--panel-bg)';
        document.getElementById('toggleMLScannerBtn').style.color = 'var(--text)';
        
        await loadScannerResults(document.getElementById('scannerRangeSelect').value);
    }
}

async function loadMLScannerResults(range = "1d") {
    const loading = document.getElementById('scannerLoading');
    const resultsDiv = document.getElementById('scannerResults');
    
    if (loading) loading.style.display = 'inline-flex';
    try {
        const res = await fetch(`/scan_with_ml?range=${range}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const results = json.results || [];
        
        let html = '<table class="scanner-table"><thead><tr>';
        html += '<th onclick="sortScannerBy(this, \'symbol\')">Symbol</th>';
        html += '<th>Heuristic</th><th>ML Pred</th><th>ML Conf</th><th>Combined</th>';
        html += '<th>Trend</th><th>RSI</th><th>Patterns</th>';
        html += '</tr></thead><tbody>';
        
        results.forEach(r => {
            const heurClass = r.score > 0.6 ? 'ml-score-good' : (r.score < 0.4 ? 'ml-score-bad' : 'ml-score-neutral');
            const mlPredClass = r.ml_prediction === 1 ? 'ml-score-good' : (r.ml_prediction === 0 ? 'ml-score-bad' : 'ml-score-neutral');
            const combClass = r.combined_score > 0.6 ? 'ml-score-good' : (r.combined_score < 0.4 ? 'ml-score-bad' : 'ml-score-neutral');
            const trendClass = `scanner-trend-${r.trend || 'flat'}`;
            
            html += `<tr style="cursor:pointer;" onclick="selectSymbolAndSwitch('${r.symbol}')">`;
            html += `<td><strong>${r.symbol}</strong></td>`;
            html += `<td class="${heurClass}">${(r.score || 0).toFixed(2)}</td>`;
            html += `<td>${r.ml_prediction === 1 ? '✓' : (r.ml_prediction === 0 ? '✗' : '—')}</td>`;
            html += `<td>${r.ml_confidence ? (r.ml_confidence * 100).toFixed(0) + '%' : '—'}</td>`;
            html += `<td class="${combClass}">${(r.combined_score || 0).toFixed(2)}</td>`;
            html += `<td class="${trendClass}">${(r.trend || 'flat').toUpperCase()}</td>`;
            html += `<td>${r.rsi ? r.rsi.toFixed(1) : '—'}</td>`;
            html += `<td>${r.patterns && r.patterns.length ? r.patterns.join(', ') : '—'}</td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        resultsDiv.innerHTML = html;
    } catch (e) {
        console.error('ML Scanner failed:', e);
        resultsDiv.innerHTML = `<p style="color:var(--danger);">Error: ${e.message}</p>`;
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

if (document.getElementById('trainMLBtn')) {
    document.getElementById('trainMLBtn').addEventListener('click', trainMLModel);
}
if (document.getElementById('addLabelBtn')) {
    document.getElementById('addLabelBtn').addEventListener('click', addTradeLabel);
}
if (document.getElementById('toggleMLScannerBtn')) {
    document.getElementById('toggleMLScannerBtn').addEventListener('click', toggleMLScanner);
}

(async () => {
    try {
        const res = await fetch('/model_info');
        const json = await res.json();
        const status = document.getElementById('mlStatus');
        if (json.status === 'trained' && json.metrics) {
            status.textContent = `✓ Trained (${(json.metrics.f1*100).toFixed(0)}% F1)`;
            status.style.color = 'var(--success)';
        }
    } catch (e) {
        console.error('Failed to load model info:', e);
    }
})();

