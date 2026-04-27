const ASSETS = {
  BTCUSDT: { name: "Bitcoin", keywords: ["bitcoin", "btc", "bitcoin etf", "satoshi"] },
  ETHUSDT: { name: "Ethereum", keywords: ["ethereum", "eth", "ether", "ethereum etf"] },
  BNBUSDT: { name: "BNB", keywords: ["bnb", "binance coin", "binance"] },
  SOLUSDT: { name: "Solana", keywords: ["solana", "sol", "solana etf"] },
  XRPUSDT: { name: "XRP", keywords: ["xrp", "ripple"] }
};

const assetKeys = Object.keys(ASSETS);
const storageKeys = {
  trades: "ta_trades_v4",
  lastAsset: "ta_last_asset_v4",
  history: "ta_history_store_v4"
};

let activeSymbol = localStorage.getItem(storageKeys.lastAsset) || "BTCUSDT";
let livePrices = {};
let chartPrices = [];
let chartVolumes = [];
let historyStore = {};
let trades = [];

try { historyStore = JSON.parse(localStorage.getItem(storageKeys.history) || "{}"); } catch { historyStore = {}; }
try { trades = JSON.parse(localStorage.getItem(storageKeys.trades) || "[]"); } catch { trades = []; }

let newsBias = 0;
let marketLive = false;
let marketTimer = null;
let watchlistTimer = null;
let newsTimer = null;
let newsScanRunning = false;
let lastNotificationAt = 0;

const els = {
  assetSelect: document.getElementById("assetSelect"),
  tradeAsset: document.getElementById("tradeAsset"),
  heroName: document.getElementById("heroName"),
  heroPrice: document.getElementById("heroPrice"),
  heroChange: document.getElementById("heroChange"),
  signalChip: document.getElementById("signalChip"),
  confidenceChip: document.getElementById("confidenceChip"),
  signalVerdict: document.getElementById("signalVerdict"),
  signalMeta: document.getElementById("signalMeta"),
  signalReasons: document.getElementById("signalReasons"),
  watchlist: document.getElementById("watchlist"),
  marketState: document.getElementById("marketState"),
  lastUpdate: document.getElementById("lastUpdate"),
  chartCanvas: document.getElementById("priceChart"),
  chartHigh: document.getElementById("chartHigh"),
  chartLow: document.getElementById("chartLow"),
  chartPoints: document.getElementById("chartPoints"),
  rsiValue: document.getElementById("rsiValue"),
  emaFastValue: document.getElementById("emaFastValue"),
  emaSlowValue: document.getElementById("emaSlowValue"),
  momentumValue: document.getElementById("momentumValue"),
  volumeValue: document.getElementById("volumeValue"),
  dayChangeValue: document.getElementById("dayChangeValue"),
  aiAction: document.getElementById("aiAction"),
  aiExplanation: document.getElementById("aiExplanation"),
  confidenceFill: document.getElementById("confidenceFill"),
  confidenceText: document.getElementById("confidenceText"),
  scanBtn: document.getElementById("scanBtn"),
  scanStatus: document.getElementById("scanStatus"),
  scanProgress: document.getElementById("scanProgress"),
  scanStage: document.getElementById("scanStage"),
  scanLog: document.getElementById("scanLog"),
  newsBias: document.getElementById("newsBias"),
  newsSummary: document.getElementById("newsSummary"),
  newsFeed: document.getElementById("newsFeed"),
  journalList: document.getElementById("journalList"),
  sysMarket: document.getElementById("sysMarket"),
  sysChart: document.getElementById("sysChart"),
  sysNews: document.getElementById("sysNews"),
  sysJournal: document.getElementById("sysJournal"),
  sysSignal: document.getElementById("sysSignal"),
  tradeForm: document.getElementById("tradeForm"),
  tradeSide: document.getElementById("tradeSide"),
  tradeEntry: document.getElementById("tradeEntry"),
  tradeQty: document.getElementById("tradeQty"),
  tradeTarget: document.getElementById("tradeTarget"),
  tradeStop: document.getElementById("tradeStop"),
  tradeNotes: document.getElementById("tradeNotes"),
  tradeCoach: document.getElementById("tradeCoach"),
  notifyBtn: document.getElementById("notifyBtn")
};

const canvas = els.chartCanvas;
const ctx = canvas.getContext("2d");

function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

function assetName(sym) {
  return ASSETS[sym]?.name || sym;
}

function round(n, d = 2) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

function stddev(values) {
  if (!values.length) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

function setStatus(el, text, good = false, warn = false) {
  el.textContent = text;
  el.style.color = good ? "#7ff0d6" : warn ? "#f4c15d" : "#eaf1ff";
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("bad response");
    return await res.json();
  } catch {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res2 = await fetch(proxy);
    if (!res2.ok) throw new Error("proxy failed");
    return await res2.json();
  }
}

async function fetchKlines(symbol, interval = "1m", limit = 60) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url);
  return {
    closes: data.map(k => parseFloat(k[4])),
    volumes: data.map(k => parseFloat(k[5])),
    opens: data.map(k => parseFloat(k[1])),
    high: data.map(k => parseFloat(k[2])),
    low: data.map(k => parseFloat(k[3]))
  };
}

async function fetch24h(symbol) {
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  return await fetchJson(url);
}

async function fetchPrice(symbol) {
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
  const data = await fetchJson(url);
  return parseFloat(data.price);
}

function initControls() {
  assetKeys.forEach(sym => {
    const opt1 = document.createElement("option");
    opt1.value = sym;
    opt1.textContent = `${ASSETS[sym].name} (${sym.replace("USDT", "")})`;
    els.assetSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = sym;
    opt2.textContent = ASSETS[sym].name;
    els.tradeAsset.appendChild(opt2);
  });

  els.assetSelect.value = activeSymbol;
  els.tradeAsset.value = activeSymbol;

  els.assetSelect.addEventListener("change", async () => {
    activeSymbol = els.assetSelect.value;
    els.tradeAsset.value = activeSymbol;
    localStorage.setItem(storageKeys.lastAsset, activeSymbol);
    chartPrices = (historyStore[activeSymbol]?.closes || []).slice();
    chartVolumes = (historyStore[activeSymbol]?.volumes || []).slice();
    renderWatchlist();
    renderSignal();
    drawChart();
    renderTradeCoach();
    await refreshActiveMarket();
    runNewsScan(true);
  });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById(btn.dataset.tab);
      panel.classList.add("active");
      if (btn.dataset.tab === "chart") setTimeout(drawChart, 40);
    });
  });
}

function initCanvas() {
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(320, rect.width) * dpr;
    canvas.height = 320 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart();
  }
  window.addEventListener("resize", resize);
  setTimeout(resize, 0);
}

function computeSignal(prices, volumes, ticker) {
  if (prices.length < 8) {
    return {
      verdict: "WAIT",
      confidence: 42,
      reasons: ["Collecting enough live candles."],
      rsi: null,
      emaFast: null,
      emaSlow: null,
      momentum: null,
      volRatio: null,
      explanation: "The engine is warming up."
    };
  }

  const r = rsi(prices, Math.min(14, Math.max(7, prices.length - 1)));
  const fast = ema(prices.slice(-20), 9);
  const slow = ema(prices.slice(-30), 21);
  const now = prices[prices.length - 1];
  const ago = prices[Math.max(0, prices.length - 8)];
  const momentum = ((now - ago) / ago) * 100;
  const returnSeries = [];
  for (let i = 1; i < prices.length; i++) {
    returnSeries.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const vol = stddev(returnSeries) * 100;

  const latestVol = volumes[volumes.length - 1] || 0;
  const avgVol = mean(volumes.slice(-20)) || 1;
  const volRatio = latestVol / avgVol;
  const dayChange = parseFloat(ticker?.priceChangePercent || "0");

  let score = 0;
  const reasons = [];

  if (r < 30) { score += 1.8; reasons.push("RSI is oversold."); }
  else if (r > 70) { score -= 1.8; reasons.push("RSI is overbought."); }
  else { reasons.push("RSI is neutral."); }

  if (fast > slow) { score += 1.6; reasons.push("Short EMA is above long EMA."); }
  else { score -= 1.6; reasons.push("Short EMA is below long EMA."); }

  if (momentum > 0.25) { score += 1.1; reasons.push("Momentum is positive."); }
  else if (momentum < -0.25) { score -= 1.1; reasons.push("Momentum is negative."); }

  if (volRatio > 1.25) {
    score += momentum >= 0 ? 0.9 : -0.6;
    reasons.push("Volume is expanding.");
  } else if (volRatio < 0.8) {
    score -= 0.5;
    reasons.push("Volume is weak.");
  }

  if (dayChange > 1) { score += 0.9; reasons.push("24h change is positive."); }
  else if (dayChange < -1) { score -= 0.9; reasons.push("24h change is negative."); }

  if (newsBias > 0.6) { score += 1; reasons.push("News bias is positive."); }
  else if (newsBias < -0.6) { score -= 1; reasons.push("News bias is negative."); }

  const verdict = score > 1.4 ? "BUY" : score < -1.4 ? "SELL" : "HOLD";
  const confidence = Math.max(48, Math.min(97, Math.round(54 + Math.abs(score) * 11 + Math.min(8, vol * 2))));

  return {
    verdict, confidence, reasons,
    rsi: round(r, 1),
    emaFast: round(fast, 4),
    emaSlow: round(slow, 4),
    momentum: round(momentum, 2),
    volRatio: round(volRatio, 2),
    dayChange: round(dayChange, 2),
    explanation:
      verdict === "BUY" ? "Trend, momentum, volume, and news are leaning up." :
      verdict === "SELL" ? "Trend, momentum, volume, and news are leaning down." :
      "Signals are mixed. The engine prefers patience."
  };
}

function notify(title, body) {
  const now = Date.now();
  if (now - lastNotificationAt < 90000) return;
  lastNotificationAt = now;
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body }); return; } catch {}
  }
  alert(`${title}\n\n${body}`);
}

function renderSignal() {
  const sig = computeSignal(chartPrices, chartVolumes, historyStore[activeSymbol]?.ticker || null);

  els.signalVerdict.textContent = sig.verdict;
  els.signalMeta.textContent = sig.explanation;
  els.signalChip.textContent = sig.verdict;
  els.confidenceChip.textContent = `Confidence: ${sig.confidence}%`;
  els.aiAction.textContent = sig.verdict;
  els.aiExplanation.textContent = sig.explanation;
  els.confidenceFill.style.width = `${sig.confidence}%`;
  els.confidenceText.textContent = `${sig.confidence}%`;

  els.rsiValue.textContent = sig.rsi ?? "—";
  els.emaFastValue.textContent = sig.emaFast ?? "—";
  els.emaSlowValue.textContent = sig.emaSlow ?? "—";
  els.momentumValue.textContent = sig.momentum == null ? "—" : `${sig.momentum}%`;
  els.volumeValue.textContent = sig.volRatio == null ? "—" : `${sig.volRatio}x`;
  els.dayChangeValue.textContent = sig.dayChange == null ? "—" : `${sig.dayChange}%`;

  els.signalReasons.innerHTML = "";
  sig.reasons.forEach(text => {
    const div = document.createElement("div");
    div.className = "reason-item";
    div.textContent = text;
    els.signalReasons.appendChild(div);
  });

  if (sig.verdict === "BUY") els.signalChip.classList.add("live");
  else els.signalChip.classList.remove("live");

  setStatus(els.sysSignal, `${sig.verdict} / ${sig.confidence}%`, sig.verdict === "BUY", sig.verdict === "HOLD");

  if (sig.verdict === "BUY") {
    notify(`${assetName(activeSymbol)} buy signal`, `Confidence ${sig.confidence}% • ${sig.explanation}`);
  } else if (sig.verdict === "SELL") {
    notify(`${assetName(activeSymbol)} sell signal`, `Confidence ${sig.confidence}% • ${sig.explanation}`);
  }
}

function drawChart() {
  const w = canvas.clientWidth;
  const h = 320;
  if (!w) return;

  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(255,255,255,0.06)");
  bg.addColorStop(1, "rgba(255,255,255,0.015)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (chartPrices.length < 2) {
    ctx.fillStyle = "rgba(234,241,255,.6)";
    ctx.font = "600 14px Inter, sans-serif";
    ctx.fillText("Waiting for live price data…", 20, 34);
    setStatus(els.sysChart, "Waiting", false, true);
    return;
  }

  const padding = 26;
  const values = chartPrices;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1e-6, max - min);

  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = padding + ((h - padding * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  const stepX = (w - padding * 2) / Math.max(1, values.length - 1);
  const yFor = v => h - padding - ((v - min) / range) * (h - padding * 2);

  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, "rgba(124,156,255,.24)");
  grd.addColorStop(1, "rgba(124,156,255,0)");
  ctx.beginPath();
  ctx.moveTo(padding, yFor(values[0]));
  values.forEach((v, i) => {
    ctx.lineTo(padding + i * stepX, yFor(v));
  });
  ctx.lineTo(w - padding, h - padding);
  ctx.lineTo(padding, h - padding);
  ctx.closePath();
  ctx.fillStyle = grd;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = padding + i * stepX;
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#7c9cff";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const lx = padding + (values.length - 1) * stepX;
  const ly = yFor(values[values.length - 1]);
  ctx.beginPath();
  ctx.arc(lx, ly, 4.8, 0, Math.PI * 2);
  ctx.fillStyle = "#7ff0d6";
  ctx.fill();

  ctx.fillStyle = "rgba(234,241,255,.85)";
  ctx.font = "700 12px Inter, sans-serif";
  ctx.fillText(`High ${max.toFixed(2)}`, 20, 20);
  ctx.fillText(`Low ${min.toFixed(2)}`, 20, h - 12);

  els.chartHigh.textContent = max.toFixed(2);
  els.chartLow.textContent = min.toFixed(2);
  els.chartPoints.textContent = values.length;
  setStatus(els.sysChart, "Live", true, false);
}

function saveHistory() {
  historyStore[activeSymbol] = {
    closes: chartPrices.slice(-240),
    volumes: chartVolumes.slice(-240),
    ticker: historyStore[activeSymbol]?.ticker || null
  };
  try { localStorage.setItem(storageKeys.history, JSON.stringify(historyStore)); } catch {}
}

function updateLastUpdate() {
  els.lastUpdate.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function setMarketLive(state) {
  marketLive = state;
  setStatus(els.sysMarket, state ? "Connected" : "Reconnecting…", state, !state);
  els.marketState.textContent = state ? "Connected" : "Reconnecting…";
}

async function refreshActiveMarket() {
  try {
    const [klineData, ticker] = await Promise.all([
      fetchKlines(activeSymbol, "1m", 60),
      fetch24h(activeSymbol)
    ]);

    chartPrices = klineData.closes.slice();
    chartVolumes = klineData.volumes.slice();
    livePrices[activeSymbol] = chartPrices[chartPrices.length - 1];
    historyStore[activeSymbol] = { closes: chartPrices.slice(), volumes: chartVolumes.slice(), ticker };

    const current = livePrices[activeSymbol];
    const changePct = parseFloat(ticker.priceChangePercent || "0");

    els.heroName.textContent = assetName(activeSymbol);
    els.heroPrice.textContent = `$${current.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
    els.heroChange.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}% • 24h`;
    els.volumeValue.textContent = `${fmt(parseFloat(ticker.quoteVolume || "0"), 2)}`;
    els.dayChangeValue.textContent = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;

    updateLastUpdate();
    setMarketLive(true);
    renderWatchlist();
    renderSignal();
    renderTradeCoach();
    drawChart();
    checkTrades(current);
    saveHistory();
    setStatus(els.sysChart, "Live", true, false);
  } catch {
    setMarketLive(false);
  }
}

async function refreshWatchlist() {
  try {
    const results = await Promise.all(
      assetKeys.map(async sym => {
        const price = await fetchPrice(sym);
        return [sym, price];
      })
    );
    results.forEach(([sym, price]) => (livePrices[sym] = price));
    renderWatchlist();
  } catch {}
}

function renderWatchlist() {
  els.watchlist.innerHTML = "";
  assetKeys.forEach(sym => {
    const price = livePrices[sym];
    const card = document.createElement("button");
    card.className = `asset-card ${sym === activeSymbol ? "active" : ""}`;
    card.type = "button";
    card.innerHTML = `
      <div class="asset-top">
        <div>
          <div class="asset-name">${ASSETS[sym].name}</div>
          <div class="asset-symbol">${sym}</div>
        </div>
        <div class="asset-change">${sym === activeSymbol ? "Active" : "Live"}</div>
      </div>
      <div class="asset-price">${price ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : "—"}</div>
    `;
    card.addEventListener("click", async () => {
      activeSymbol = sym;
      els.assetSelect.value = sym;
      els.tradeAsset.value = sym;
      localStorage.setItem(storageKeys.lastAsset, sym);
      chartPrices = (historyStore[sym]?.closes || []).slice();
      chartVolumes = (historyStore[sym]?.volumes || []).slice();
      renderWatchlist();
      renderSignal();
      drawChart();
      renderTradeCoach();
      await refreshActiveMarket();
      runNewsScan(true);
    });
    els.watchlist.appendChild(card);
  });
}

function renderJournal() {
  els.journalList.innerHTML = "";
  if (!trades.length) {
    const empty = document.createElement("div");
    empty.className = "trade-item";
    empty.textContent = "No saved trades yet.";
    els.journalList.appendChild(empty);
    setStatus(els.sysJournal, "Empty", false, true);
    return;
  }

  const current = livePrices[activeSymbol] || chartPrices[chartPrices.length - 1] || 0;

  trades.forEach(trade => {
    const pnlRaw = trade.side === "Short"
      ? (trade.entry - current) * trade.qty
      : (current - trade.entry) * trade.qty;
    const pnlClass = pnlRaw > 0 ? "good" : pnlRaw < 0 ? "bad" : "warn";
    const pnlText = `${pnlRaw >= 0 ? "+" : ""}${fmt(pnlRaw, 2)}`;

    const item = document.createElement("div");
    item.className = "trade-item";
    item.innerHTML = `
      <div class="trade-item-top">
        <div>
          <h4>${ASSETS[trade.asset]?.name || trade.asset} · ${trade.side}</h4>
          <div class="trade-meta">
            <span>Entry: ${fmt(trade.entry, 4)}</span>
            <span>Qty: ${fmt(trade.qty, 4)}</span>
            <span>Target: ${fmt(trade.target, 4)}</span>
            <span>Stop: ${fmt(trade.stop, 4)}</span>
          </div>
        </div>
        <div class="trade-pnl ${pnlClass}">${pnlText}</div>
      </div>
      <div class="trade-meta">${trade.notes ? trade.notes : "No notes added."}</div>
    `;
    els.journalList.appendChild(item);
  });

  setStatus(els.sysJournal, `${trades.length} saved`, true, false);
}

function saveTrades() {
  try { localStorage.setItem(storageKeys.trades, JSON.stringify(trades.slice(-100))); } catch {}
  renderJournal();
}

function checkTrades(price) {
  trades.forEach(trade => {
    const longTarget = trade.side === "Long" && price >= trade.target;
    const longStop = trade.side === "Long" && price <= trade.stop;
    const shortTarget = trade.side === "Short" && price <= trade.target;
    const shortStop = trade.side === "Short" && price >= trade.stop;

    if ((longTarget || shortTarget) && !trade.notifiedTarget) {
      trade.notifiedTarget = true;
      notify(`Target reached`, `${trade.asset} ${trade.side} target has been hit.`);
      saveTrades();
    }
    if ((longStop || shortStop) && !trade.notifiedStop) {
      trade.notifiedStop = true;
      notify(`Stop reached`, `${trade.asset} ${trade.side} stop has been hit.`);
      saveTrades();
    }
  });
}

function scoreHeadline(text) {
  const lower = text.toLowerCase();
  const positive = ["surge", "rally", "beat", "approval", "inflow", "adoption", "gain", "gains", "bullish", "launch", "partnership", "upgrade", "record", "jump", "strength"];
  const negative = ["hack", "lawsuit", "ban", "probe", "crash", "drop", "selloff", "fall", "fraud", "exploit", "warning", "risk", "fear", "decline"];
  const keywords = ASSETS[activeSymbol].keywords;
  let s = 0;
  if (keywords.some(k => lower.includes(k))) s += 0.9;
  positive.forEach(w => { if (lower.includes(w)) s += 0.6; });
  negative.forEach(w => { if (lower.includes(w)) s -= 0.8; });
  return Math.max(-3, Math.min(3, s));
}

function renderNewsFeed(items) {
  els.newsFeed.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "news-item";
    empty.textContent = "No headlines found yet.";
    els.newsFeed.appendChild(empty);
    return;
  }
  items.forEach(item => {
    const chipClass = item.score > 0.5 ? "pos" : item.score < -0.5 ? "neg" : "neu";
    const chipText = item.score > 0.5 ? "Bullish" : item.score < -0.5 ? "Bearish" : "Neutral";
    const el = document.createElement("div");
    el.className = "news-item";
    el.innerHTML = `
      <div class="news-item-top">
        <span class="chip ${chipClass}">${chipText}</span>
        <span class="chip neu">${item.source}</span>
      </div>
      <h4>${item.title}</h4>
      <p>${item.snippet || "Live headline pulled from the news feed."}</p>
    `;
    els.newsFeed.appendChild(el);
  });
}

function renderTradeCoach() {
  const current = livePrices[activeSymbol] || chartPrices[chartPrices.length - 1];
  const sig = computeSignal(chartPrices, chartVolumes, historyStore[activeSymbol]?.ticker || null);
  const latestTrade = trades.find(t => t.asset === activeSymbol) || trades[0];

  if (!latestTrade || !Number.isFinite(current)) {
    els.tradeCoach.textContent = "Add a trade to get live hold / sell guidance.";
    return;
  }

  const isLong = latestTrade.side === "Long";
  const targetGap = isLong ? ((latestTrade.target - current) / current) * 100 : ((current - latestTrade.target) / current) * 100;
  const stopGap = isLong ? ((current - latestTrade.stop) / current) * 100 : ((latestTrade.stop - current) / current) * 100;
  const profitNow = isLong ? current - latestTrade.entry : latestTrade.entry - current;
  const volRatio = sig.volRatio || 1;
  let horizon = "short-term";
  if (Math.abs(sig.momentum || 0) > 0.9 && volRatio > 1.2) horizon = "fast move (minutes to 1 hour)";
  else if (Math.abs(sig.momentum || 0) > 0.35) horizon = "intraday";
  else horizon = "watch for 1-3 sessions";

  let advice = "Hold for now.";
  if ((isLong && current >= latestTrade.target) || (!isLong && current <= latestTrade.target)) {
    advice = "Take profit. Target is already reached.";
  } else if ((isLong && current <= latestTrade.stop) || (!isLong && current >= latestTrade.stop)) {
    advice = "Exit now. Stop level is broken.";
  } else if (sig.verdict === "BUY" && profitNow >= 0) {
    advice = "Hold. Trend and momentum still support the trade.";
  } else if (sig.verdict === "SELL" && profitNow < 0) {
    advice = "Reduce risk. The move is weakening.";
  } else {
    advice = "Hold with a tight stop until the next signal confirms.";
  }

  els.tradeCoach.textContent =
    `${advice} Signal horizon: ${horizon}. ` +
    `Target gap: ${round(targetGap, 2)}%. Stop buffer: ${round(stopGap, 2)}%. ` +
    `Confidence: ${sig.confidence}%.`;
}

async function runNewsScan(silent = false) {
  if (newsScanRunning) return;
  newsScanRunning = true;

  const stages = [
    "Reading live sources.",
    "Filtering headlines by asset.",
    "Scoring bullish and bearish language.",
    "Feeding results into the signal engine."
  ];

  els.scanProgress.style.width = "0%";
  els.scanLog.innerHTML = "";
  els.scanStage.textContent = "Starting scan…";
  els.scanStatus.textContent = "Scanning";
  setStatus(els.sysNews, "Scanning", false, true);

  const addLine = (title, note) => {
    const row = document.createElement("div");
    row.className = "scan-line";
    row.innerHTML = `<span>${title}</span><small>${note}</small>`;
    els.scanLog.prepend(row);
  };

  for (let i = 0; i < stages.length; i++) {
    els.scanStage.textContent = stages[i];
    els.scanProgress.style.width = `${Math.round(((i + 1) / stages.length) * 35)}%`;
    addLine(`Step ${i + 1}`, stages[i]);
    await sleep(220);
  }

  const queries = [
    `(${ASSETS[activeSymbol].keywords.join(" OR ")}) crypto market`,
    `(${ASSETS[activeSymbol].keywords.join(" OR ")}) price volume`,
    `bitcoin ethereum crypto market risk regulation`
  ];

  try {
    const fetched = await Promise.all(
      queries.map(async q => {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=8&sort=hybridrel`;
        const data = await fetchJson(url);
        return (data.articles || data.results || data.documents || []).map(a => ({
          title: a.title || a.heading || "Untitled headline",
          snippet: a.snippet || a.description || "",
          source: a.domain || a.source || "Live feed",
          score: scoreHeadline(`${a.title || ""} ${a.snippet || ""}`)
        }));
      })
    );

    const combined = fetched.flat();
    const deduped = [];
    const seen = new Set();
    for (const item of combined) {
      const key = (item.title || "").toLowerCase();
      if (!seen.has(key)) { seen.add(key); deduped.push(item); }
    }

    deduped.sort((a, b) => b.score - a.score);
    const selected = deduped.slice(0, 10);

    newsBias = selected.length ? selected.reduce((acc, item) => acc + item.score, 0) / selected.length : 0;

    const biasText = newsBias > 0.6 ? "Bullish" : newsBias < -0.6 ? "Bearish" : "Neutral";
    els.newsBias.textContent = biasText;
    els.newsSummary.textContent = `Net headline bias for ${assetName(activeSymbol)} is ${biasText.toLowerCase()}.`;
    renderNewsFeed(selected);

    els.scanProgress.style.width = "100%";
    els.scanStage.textContent = `Finished. ${selected.length} live headlines analyzed for ${assetName(activeSymbol)}.`;
    setStatus(els.sysNews, "Live", true, false);
    renderSignal();
    renderTradeCoach();
  } catch {
    els.scanStage.textContent = "News fetch failed. Market data still works.";
    els.newsBias.textContent = "Unavailable";
    els.newsSummary.textContent = "Could not reach the live news source from this device.";
    renderNewsFeed([]);
    setStatus(els.sysNews, "Unavailable", false, true);
  } finally {
    newsScanRunning = false;
    if (!silent) addLine("Complete", "Scan finished.");
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) { alert("Browser notifications are not supported here."); return; }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    notify("Alerts enabled", "Browser alerts are now active.");
  } else {
    alert("Alerts stay in-page only because permission was not granted.");
  }
}

function initJournalForm() {
  els.tradeForm.addEventListener("submit", e => {
    e.preventDefault();
    const entry = parseFloat(els.tradeEntry.value);
    const qty = parseFloat(els.tradeQty.value);
    const target = parseFloat(els.tradeTarget.value);
    const stop = parseFloat(els.tradeStop.value);

    if (![entry, qty, target, stop].every(Number.isFinite)) {
      alert("Please fill all trade fields with numbers.");
      return;
    }

    const trade = {
      id: Date.now(),
      asset: els.tradeAsset.value,
      side: els.tradeSide.value,
      entry, qty, target, stop,
      notes: els.tradeNotes.value.trim(),
      notifiedTarget: false,
      notifiedStop: false,
      createdAt: new Date().toISOString()
    };

    trades.unshift(trade);
    trades = trades.slice(0, 100);
    saveTrades();
    els.tradeForm.reset();
    els.tradeAsset.value = activeSymbol;
    els.tradeSide.value = "Long";
    renderTradeCoach();
    els.tradeEntry.focus();
  });
}

async function boot() {
  initControls();
  initTabs();
  initCanvas();
  initJournalForm();

  els.notifyBtn.addEventListener("click", requestNotifications);
  els.scanBtn.addEventListener("click", () => runNewsScan(false));

  renderJournal();
  renderWatchlist();
  renderSignal();
  renderTradeCoach();

  const stored = historyStore[activeSymbol];
  if (stored?.closes?.length) {
    chartPrices = stored.closes.slice();
    chartVolumes = stored.volumes?.slice() || [];
  }

  await refreshWatchlist();
  await refreshActiveMarket();

  marketTimer = setInterval(refreshActiveMarket, 5000);
  watchlistTimer = setInterval(refreshWatchlist, 14000);
  newsTimer = setInterval(() => runNewsScan(true), 50000);

  runNewsScan(true);

  setStatus(els.sysMarket, "Connected", true, false);
  setStatus(els.sysChart, chartPrices.length ? "Live" : "Waiting", !!chartPrices.length, !chartPrices.length);
  setStatus(els.sysNews, "Live", true, false);
  setStatus(els.sysJournal, trades.length ? `${trades.length} saved` : "Empty", !!trades.length, !trades.length);
  setStatus(els.sysSignal, "Live", true, false);
}

boot();
