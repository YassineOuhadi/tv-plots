try:
    from tvDatafeed import TvDatafeed, Interval
except ImportError:
    try:
        from tvdatafeed import TvDatafeed, Interval
    except ImportError:
        TvDatafeed = None
        Interval = None
        print("WARNING: tvDatafeed not installed. Data fetching will not work.")

import os
from dotenv import load_dotenv
import pandas as pd

load_dotenv()
USERNAME = os.getenv("TV_USERNAME")
PASSWORD = os.getenv("TV_PASSWORD")

RANGE_CONFIG = {
    "1d": {"interval": Interval.in_30_minute if Interval else None, "n_bars": 24},
    "1w": {"interval": Interval.in_daily if Interval else None, "n_bars": 7},
    "1m": {"interval": Interval.in_daily if Interval else None, "n_bars": 30},
    "6m": {"interval": Interval.in_daily if Interval else None, "n_bars": 180},
    "1y": {"interval": Interval.in_daily if Interval else None, "n_bars": 365},
    "2y": {"interval": Interval.in_daily if Interval else None, "n_bars": 730},
}

tv = TvDatafeed(USERNAME, PASSWORD) if TvDatafeed and USERNAME and PASSWORD else (TvDatafeed() if TvDatafeed else None)

def _safe_get_hist(symbol, exchange, interval, n_bars, retries=3, backoff=1.5):
    """Call tv.get_hist with retries and exponential backoff."""
    if not tv:
        raise RuntimeError("tvDatafeed not available - cannot fetch data")
    
    last_exc = None
    for attempt in range(retries):
        try:
            df = tv.get_hist(symbol, exchange, interval=interval, n_bars=n_bars)
            return df
        except Exception as e:
            last_exc = e
            try:
                import time
                time.sleep(backoff * (2 ** attempt))
            except Exception:
                pass
    if last_exc:
        raise last_exc


def fetch_data(symbol: str = "ATW", exchange: str = "CSEMA"):
    """Fetch historical data for a given symbol and exchange.

    This function will retry transient errors and only include ranges
    which returned non-empty data. It raises exceptions for fatal failures.
    """
    if not tv:
        raise RuntimeError("tvDatafeed not available - cannot fetch data")
    
    data_dict = {}
    try:
        probe = _safe_get_hist(symbol, exchange, interval=RANGE_CONFIG["1d"]["interval"], n_bars=1, retries=2)
    except Exception:
        raise

    for label, cfg in RANGE_CONFIG.items():
        try:
            df = _safe_get_hist(symbol, exchange, interval=cfg["interval"], n_bars=cfg["n_bars"])
        except Exception:
            continue

        if df is not None and not df.empty:
            df = df.reset_index().rename(columns={
                'datetime': 'Time',
                'open': 'Open',
                'high': 'High',
                'low': 'Low',
                'close': 'Close',
                'volume': 'Volume'
            }).sort_values('Time')
            df['Time'] = df['Time'].astype(str)
            data_dict[label] = df.to_dict(orient='list')
    return data_dict