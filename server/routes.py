# server/routes.py
from fastapi import Request
from . import app, templates, DATA_CACHE, update_cache_for_symbol, safe_response, load_cache_from_disk
from .analyze import analyze_dataframe, score_trade
from .advanced_analysis import get_advanced_analysis, generate_decision_signal
from .ml_model import trainer
import time
import pandas as pd
import asyncio

@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/data")
async def data(symbol: str = "ATW", exchange: str = "CSEMA", range: str = "1d"):
    if symbol not in DATA_CACHE:
        DATA_CACHE[symbol] = {"status": "loading", "data": {}}
        asyncio.create_task(update_cache_for_symbol(symbol, exchange))

    entry = DATA_CACHE.get(symbol, {})
    if entry.get("status") == "loading":
        return safe_response({"status": "loading", "message": f"Data for {symbol} is being fetched..."})

    data = entry.get("data") or {}
    if range not in data:
        return safe_response({"error": f"Invalid range: {range} or no data for symbol: {symbol}"}, status_code=404)

    return safe_response({
        range: data[range],
        "meta": {
            "symbol": symbol,
            "exchange": exchange,
            "last_updated": entry.get("last_updated"),
            "status": entry.get("status")
        }
    })

@app.get("/analyze")
async def analyze(symbol: str = "ATW", exchange: str = "CSEMA", range: str = "1d"):
    if symbol not in DATA_CACHE:
        DATA_CACHE[symbol] = {"status": "loading", "data": {}}
        asyncio.create_task(update_cache_for_symbol(symbol, exchange))
        return safe_response({"status": "loading", "message": f"Analysis for {symbol} will be ready soon."})

    entry = DATA_CACHE.get(symbol, {})
    data = entry.get("data") or {}
    if range not in data:
        return safe_response({'error': f'No data for range {range} for {symbol}'}, status_code=404)

    try:
        df_dict = data[range]
        result = analyze_dataframe(df_dict, range)
        return safe_response({'symbol': symbol, 'exchange': exchange, 'range': range, 'analysis': result})
    except Exception as e:
        return safe_response({'error': str(e)}, status_code=500)
    
@app.get('/analyze_cached')
async def analyze_cached(symbol: str = "ATW", exchange: str = "CSEMA", range: str = "1d", rsi: bool = True, macd: bool = True, fib: bool = True, patterns: bool = True):
    """Return cached analysis if present, otherwise compute, cache, and return it. Filters by enabled detectors."""
    if symbol not in DATA_CACHE:
        await update_cache_for_symbol(symbol, exchange)
    entry = DATA_CACHE.get(symbol, {})
    if entry.get('status') == 'error' and not entry.get('data'):
        return safe_response({'error': f'No data available for {symbol}. Last error: {entry.get("last_error")}'}, status_code=503)
    data = entry.get('data') or {}
    if range not in data:
        return safe_response({'error': f'No data for range {range} for {symbol}'}, status_code=404)
    if entry.get('analysis') and range in entry.get('analysis'):
        ana = entry['analysis'][range]
        filtered = filter_analysis(ana, rsi, macd, fib, patterns)
        return safe_response({'symbol': symbol, 'exchange': exchange, 'range': range, 'analysis': filtered, 'analysis_last_updated': entry.get('analysis_last_updated', {}).get(range)})
    try:
        df_dict = data[range]
        result = analyze_dataframe(df_dict, range)
        filtered = filter_analysis(result, rsi, macd, fib, patterns)
        entry.setdefault('analysis', {})[range] = result
        entry.setdefault('analysis_last_updated', {})[range] = time.time()
        DATA_CACHE[symbol] = entry
        return safe_response({'symbol': symbol, 'exchange': exchange, 'range': range, 'analysis': filtered})
    except Exception as e:
        return safe_response({'error': str(e)}, status_code=500)


def filter_analysis(analysis: dict, rsi: bool, macd: bool, fib: bool, patterns: bool) -> dict:
    """Filter analysis results based on enabled detectors. Recompute score."""
    filtered = dict(analysis)
    if 'error' in filtered:
        return filtered
    
    if not rsi:
        filtered.pop('rsi', None)
    if not macd:
        filtered.pop('macd', None)
    if not fib:
        filtered.pop('fibonacci', None)
    if not patterns:
        filtered.pop('patterns', None)
    
    score = 0.5
    count = 0
    if rsi and 'rsi' in filtered:
        rsi_val = filtered['rsi']
        if rsi_val < 30:
            score += 0.15
        elif rsi_val > 70:
            score -= 0.15
        count += 1
    if macd and 'macd' in filtered and filtered['macd'].get('macd_cross'):
        score += 0.10
        count += 1
    if fib and 'fibonacci' in filtered and filtered['fibonacci'].get('at_level'):
        score += 0.08
        count += 1
    if patterns and 'patterns' in filtered and len(filtered['patterns']) > 0:
        score += 0.10
        count += 1
    
    if 'trend' in filtered:
        trend = filtered['trend']
        if trend == 'bull':
            score += 0.15
        elif trend == 'bear':
            score -= 0.15
    
    filtered['score'] = max(0, min(1, score))
    return filtered


@app.get("/advanced_analysis")
async def advanced_analysis_endpoint(symbol: str = "ATW", exchange: str = "CSEMA", range: str = "1d"):
    """Get advanced technical analysis with decision signals."""
    load_cache_from_disk()
    
    if symbol not in DATA_CACHE:
        return safe_response({'error': 'Symbol not in cache'}, status_code=404)
    
    entry = DATA_CACHE.get(symbol, {})
    data = entry.get("data") or {}
    
    if range not in data:
        return safe_response({'error': f'Range {range} not available'}, status_code=404)
    
    try:
        df_dict = data[range]
        df = pd.DataFrame(df_dict)
        
        advanced = get_advanced_analysis(df)
        decision = generate_decision_signal(advanced)
        
        basic = entry.get('analysis', {}).get(range, {})
        
        return safe_response({
            'symbol': symbol,
            'exchange': exchange,
            'range': range,
            'advanced': advanced,
            'decision': decision,
            'basic': basic
        })
    except Exception as e:
        return safe_response({'error': str(e)}, status_code=500)


@app.get("/correlation_analysis")
async def correlation_analysis_endpoint(symbols: str = "ATW,GTM,CIH", range: str = "1d"):
    """Get correlation matrix between multiple symbols."""
    load_cache_from_disk()
    symbol_list = [s.strip() for s in symbols.split(',')]
    
    try:
        data = {}
        for symbol in symbol_list:
            if symbol not in DATA_CACHE:
                continue
            entry = DATA_CACHE[symbol]
            if range in entry.get('data', {}):
                df_dict = entry['data'][range]
                df = pd.DataFrame(df_dict)
                data[symbol] = df['close'].values
        
        if not data:
            return safe_response({'error': 'No data available'}, status_code=404)
        
        min_len = min(len(v) for v in data.values())
        aligned_data = {k: v[-min_len:] for k, v in data.items()}
        
        corr_df = pd.DataFrame(aligned_data).corr()
        correlation_dict = corr_df.to_dict()
        
        return safe_response({
            'symbols': symbol_list,
            'range': range,
            'correlation': correlation_dict
        })
    except Exception as e:
        return safe_response({'error': str(e)}, status_code=500)

    if not macd:
        macd_info = filtered.get('macd', {})
        macd_info.pop('macd_cross', None)
        macd_info.pop('direction', None)
    if not fib:
        filtered.pop('fib', None)
    if not patterns:
        filtered.pop('patterns', None)
    
    signals = {k: v for k, v in filtered.items() if k not in ['error']}
    from analyze import score_trade
    filtered['score'] = score_trade(signals)
    return filtered


@app.get('/scan')
async def scan(range: str = "1d", rsi: bool = True, macd: bool = True, fib: bool = True, patterns: bool = True):
    """Scan all symbols in cache and return scores. Does NOT fetch new data (fast response)."""
    results = []
    for symbol, entry in DATA_CACHE.items():
        if entry.get('analysis') and range in entry.get('analysis'):
            ana = entry['analysis'][range]
            filtered = filter_analysis(ana, rsi, macd, fib, patterns)
            results.append({
                'symbol': symbol,
                'score': filtered.get('score'),
                'trend': filtered.get('trend', {}).get('trend'),
                'patterns': filtered.get('patterns', []),
                'rsi': filtered.get('rsi'),
                'macd_cross': filtered.get('macd', {}).get('macd_cross'),
                'last_updated': entry.get('analysis_last_updated', {}).get(range)
            })
    results.sort(key=lambda x: x.get('score', 0), reverse=True)
    return safe_response({'range': range, 'results': results, 'cached_symbols': len(results)})

@app.post('/scan_warmup')
async def scan_warmup():
    """Pre-load all symbols into cache (non-blocking). Call once at startup."""
    symbols_list = [
        "MUT",
        "AKT",
        "HPS",
        "CDM",
        "ARD",
        "CIH",
        "ATW",
        "CMG",
        "BCP",
        "GTM",
        "TGC"
    ]
    for symbol in symbols_list:
        if symbol not in DATA_CACHE:
            asyncio.create_task(update_cache_for_symbol(symbol))
    return safe_response({'status': 'warmup_started', 'symbols': len(symbols_list)})


@app.post("/train_model")
async def train_model():
    """Train ML model on accumulated cache data and labels."""
    load_cache_from_disk()
    result = trainer.train(DATA_CACHE)
    return safe_response(result)

@app.get("/model_info")
async def model_info():
    """Get ML model info and metrics."""
    info = trainer.get_model_info()
    info['label_count'] = sum(len(v) for v in trainer.labels.values())
    return safe_response(info)

@app.post("/predict/{symbol}")
async def predict_trade(symbol: str, range: str = "1d"):
    """Get ML prediction for a symbol using latest analysis."""
    if symbol in DATA_CACHE and range in DATA_CACHE[symbol].get('analyses', {}):
        analysis = DATA_CACHE[symbol]['analyses'][range]
    else:
        ohlcv = await asyncio.to_thread(fetch_data, symbol, range)
        analysis = await asyncio.to_thread(analyze_dataframe, ohlcv, symbol)
    
    ml_pred = trainer.predict(analysis)
    
    return safe_response({
        'symbol': symbol,
        'range': range,
        'heuristic_score': analysis.get('score'),
        'heuristic_trend': analysis.get('trend'),
        'ml_prediction': ml_pred['prediction'],
        'ml_confidence': ml_pred['confidence'],
        'ml_available': ml_pred['model_available'],
        'ml_details': ml_pred,
    })

@app.post("/label_trade/{symbol}")
async def label_trade(symbol: str, request: Request):
    """Record trade outcome label for training."""
    body = await request.json()
    date = body.get('date')
    outcome = body.get('outcome', 0)
    
    trainer.add_label(symbol, date, outcome)
    
    return safe_response({
        'status': 'labeled',
        'symbol': symbol,
        'date': date,
        'outcome': outcome,
        'total_labels': sum(len(v) for v in trainer.labels.values())
    })

@app.get("/scan_with_ml")
async def scan_with_ml(range: str = "1d", rsi: bool = True, macd: bool = True, 
                        fib: bool = True, patterns: bool = True):
    """Scan all symbols with both heuristic and ML scores."""
    load_cache_from_disk()
    results = []
    
    for symbol, entry in DATA_CACHE.items():
        if range not in entry.get('analyses', {}):
            continue
        
        analysis = entry['analyses'][range]
        filtered = filter_analysis(analysis, rsi, macd, fib, patterns)
        
        ml_pred = trainer.predict(filtered)
        
        results.append({
            'symbol': symbol,
            'score': filtered.get('score', 0),
            'ml_prediction': ml_pred['prediction'],
            'ml_confidence': ml_pred['confidence'],
            'combined_score': (filtered.get('score', 0.5) * 0.6 + 
                             (ml_pred.get('probability_good', 0.5) if ml_pred['model_available'] else 0.5) * 0.4),
            'trend': filtered.get('trend', 'flat'),
            'rsi': filtered.get('rsi'),
            'macd_cross': filtered.get('macd', {}).get('macd_cross'),
            'patterns': filtered.get('patterns', []),
        })
    
    results.sort(key=lambda x: x.get('combined_score', 0), reverse=True)
    return safe_response({'range': range, 'results': results})