from fastapi import FastAPI
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import asyncio
from pathlib import Path
import json
import time
import numpy as np
import os
import math

from .histo import fetch_data
from .analyze import analyze_dataframe
from .ml_model import trainer
from .advanced_analysis import get_advanced_analysis, generate_decision_signal

# SNAP-SAFE CACHE
CACHE_DIR = Path(
    os.environ.get("SNAP_USER_COMMON", Path("/tmp/tv-data-feed-cache").resolve())
)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

CACHE_FILE = CACHE_DIR / "data_cache.json"

app = FastAPI()

SNAP_ROOT = Path(os.environ.get("SNAP", Path(__file__).resolve().parents[1]))
TEMPLATES_DIR = SNAP_ROOT / "templates"
STATIC_DIR = SNAP_ROOT / "static"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

DATA_CACHE = {}
SEMAPHORE = asyncio.Semaphore(3)

def make_serializable(obj):
    if isinstance(obj, dict):
        return {k: make_serializable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [make_serializable(v) for v in obj]
    if isinstance(obj, tuple):
        return tuple(make_serializable(v) for v in obj)
    if isinstance(obj, np.ndarray):
        return make_serializable(obj.tolist())
    if isinstance(obj, (np.generic,)):
        obj = obj.item()
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
    return obj

def safe_response(data, status_code: int = 200):
    from fastapi.responses import JSONResponse
    try:
        prim = make_serializable(data)
    except Exception:
        prim = data
    return JSONResponse(prim, status_code=status_code)

def load_cache_from_disk():
    global DATA_CACHE
    if not CACHE_FILE.exists():
        return
    try:
        with CACHE_FILE.open("r") as f:
            DATA_CACHE.update(json.load(f))
            print(f"Loaded cache for {len(DATA_CACHE)} symbols from disk")
    except Exception as e:
        print(f"Failed to load cache from disk: {e}")

def save_cache_to_disk():
    try:
        serializable = make_serializable(DATA_CACHE)
        with CACHE_FILE.open("w") as f:
            json.dump(serializable, f, indent=2)
    except Exception as e:
        print(f"Failed to save cache to disk: {e}")


async def update_cache_for_symbol(symbol: str, exchange: str = "CSEMA"):
    async with SEMAPHORE:
        try:
            data = await asyncio.to_thread(fetch_data, symbol, exchange)
            entry = {
                "data": data,
                "last_updated": time.time(),
                "status": "ok",
                "analysis": {},
                "analysis_last_updated": {}
            }
            for rlabel, rdata in (data or {}).items():
                try:
                    ana = analyze_dataframe(rdata, rlabel)
                    entry['analysis'][rlabel] = ana
                    entry['analysis_last_updated'][rlabel] = time.time()
                except Exception as e:
                    entry['analysis'][rlabel] = {"error": str(e)}
                    entry['analysis_last_updated'][rlabel] = time.time()

            DATA_CACHE[symbol] = entry
            print(f"Cache updated for {symbol}")
        except Exception as e:
            prev = DATA_CACHE.get(symbol, {})
            prev["status"] = "error"
            prev["last_error"] = str(e)
            DATA_CACHE[symbol] = prev
            print(f"Cache update error for {symbol}:", e)

async def update_cache_loop():
    """Infinite loop to periodically update all cached symbols."""
    while True:
        symbols = list(DATA_CACHE.keys())
        for symbol in symbols:
            asyncio.create_task(update_cache_for_symbol(symbol))
        save_cache_to_disk()
        await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    load_cache_from_disk()
    print(f"Startup: loaded cache for {len(DATA_CACHE)} symbols from disk")

    async def warmup_cache():
        for symbol in list(DATA_CACHE.keys()):
            asyncio.create_task(update_cache_for_symbol(symbol))
        asyncio.create_task(update_cache_loop())

    asyncio.create_task(warmup_cache())

from .routes import *