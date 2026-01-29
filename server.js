/**
 * CREDIT CARD RISK SIMULATION v9.0 - ASTRAL MISSION LOG
 * - Feature: Full-screen Deep Space Charting Interface
 * - Feature: Dual-Axis Graph (ROE vs RAROC)
 * - Visual: Pulsing "Satellite" Data Points
 * - Logic: Cumulative RAROC tracked per round for graphing
 * - Port: 3000
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "admin"; 

// --- 1. DATA ASSETS ---
const NEWS_DB = {
    'A': [ 
        "BBG: Consumer confidence index hits 98.2",
        "CNBC: Tech sector hiring spree continues",
        "WSJ: Housing starts beat expectations by 15%",
        "RTRS: Retail sales surge in Q3",
        "FT: Global trade tensions ease",
        "BBG: Banks report record low delinquency rates",
        "CNBC: Millennial home ownership drives boom",
        "WSJ: Luxury spending index hits all-time high",
        "RTRS: Small business optimism at record levels",
        "FT: Corporate profits soar, S&P 500 rallies",
        "BBG: Credit card utilization ticks up",
        "CNBC: Fintech unicorn enters 'Buy Now Pay Later'",
        "WSJ: Auto sales hit annualized rate of 18M",
        "RTRS: Tourism rebound: Airlines full",
        "FT: Construction employment grows"
    ],
    'B': [ 
        "BBG: Inflation ticks up to 4.2%",
        "CNBC: Housing market shows signs of cooling",
        "WSJ: Auto loan delinquencies rise",
        "RTRS: Retailers report inventory buildup",
        "FT: Tech layoffs announced",
        "BBG: Credit card roll-rates deteriorate",
        "CNBC: Consumer confidence dips",
        "WSJ: Bond yield curve flattens",
        "RTRS: Small business borrowing costs rise",
        "FT: Corporate debt levels concern regulators",
        "BBG: Used car prices begin to fall",
        "CNBC: 'Soft landing' still possible",
        "WSJ: Mortgage applications drop 10%",
        "RTRS: Personal savings rate hits 10-year low",
        "FT: Manufacturing orders stall"
    ],
    'C': [ 
        "ALERT: MARKET CRASH - S&P 500 PLUNGES 15%",
        "BBG: Unemployment spikes to 7.5%",
        "CNBC: Major retailer files Chapter 11",
        "WSJ: Housing bubble bursts? Prices down 10%",
        "RTRS: Credit card charge-offs soar",
        "FT: Liquidity crunch in bond markets",
        "BBG: Central bank cuts rates to zero",
        "CNBC: Banks freeze credit lines",
        "WSJ: 'Cash is King' - Investors flee",
        "RTRS: Global recession confirmed",
        "FT: Auto industry seeks bailout",
        "BBG: Consumer sentiment hits lowest level",
        "CNBC: Supply chains paralyzed",
        "WSJ: Foreclosure filings double",
        "RTRS: Student loan default crisis"
    ]
};

const SCENARIOS = {
    'A': { id: 'A', name: 'Expansion', severity: 0.8, tail_weight: 0.3 },
    'B': { id: 'B', name: 'Late Cycle', severity: 1.2, tail_weight: 0.8 }, 
    'C': { id: 'C', name: 'Shock', severity: 2.2, tail_weight: 1.5 } 
};

const INITIAL_TEAM_STATE = {
    receivables: 100, 
    capital_ratio: 14.0, 
    roe: 12.0,
    loss_rate: 2.5,
    provisions: 2.5, 
    risk_history: [2.5], 
    decisions: {}, 
    history_log: [],
    cumulative_profit: 0,
    cumulative_capital_usage: 0,
    roe_history: [],
    raroc_history: [], // Added for graph
    final_score: 0,
    raroc: 0
};

// --- 2. STATE ---
let gameState = {
    round: 0,
    scenario: 'A',
    status: 'LOBBY',
    teams: {},
    news_feed: ["SYSTEM: Waiting for market open...", "NEWS: Global markets stable"] 
};

app.get('/', (req, res) => res.send(frontendCode));

io.on('connection', (socket) => {
    socket.on('login', (data) => {
        if (data.role === 'admin') {
            if (data.password === ADMIN_PASSWORD) {
                socket.join('admin');
                socket.emit('auth_success', { role: 'admin', state: gameState });
            } else { socket.emit('auth_fail', "Invalid Password"); }
        } else {
            const teamName = data.teamName || "Team-" + socket.id.substr(0,4);
            socket.join('teams');
            socket.teamName = teamName;
            if (!gameState.teams[teamName]) gameState.teams[teamName] = JSON.parse(JSON.stringify(INITIAL_TEAM_STATE));
            socket.emit('auth_success', { role: 'team', teamName: teamName, teamData: gameState.teams[teamName], state: gameState });
            io.to('admin').emit('admin_update', gameState);
        }
    });

    socket.on('admin_action', (action) => {
        if (action.type === 'START_ROUND') {
            if (gameState.status === 'ENDGAME') return; 
            if (gameState.round >= 9) {
                 gameState.status = 'ENDGAME';
                 calculateFinalScores();
                 io.emit('state_update', gameState);
                 return;
            }
            gameState.round++;
            gameState.status = 'OPEN';
            
            if (gameState.round <= 3) gameState.scenario = 'A';
            else if (gameState.round <= 6) gameState.scenario = 'B';
            else gameState.scenario = 'C';

            const pool = NEWS_DB[gameState.scenario];
            gameState.news_feed = pool.sort(() => 0.5 - Math.random()).slice(0, 15);
            io.emit('state_update', gameState);
        }
        
        if (action.type === 'END_ROUND') {
            gameState.status = 'CLOSED';
            runSimulationEngine();
            io.emit('state_update', gameState);
            Object.keys(gameState.teams).forEach(name => {
                io.emit('team_data_update', { name: name, data: gameState.teams[name] });
            });
            io.to('admin').emit('admin_update', gameState);
        }
    });

    socket.on('submit_decision', (decision) => {
        if (gameState.status !== 'OPEN') return;
        const team = gameState.teams[socket.teamName];
        if (!team) return;
        team.decisions[gameState.round] = decision;
        socket.emit('decision_ack', "Locked");
        io.to('admin').emit('admin_update', gameState);
    });
});

// --- 3. MATH ENGINE ---
function runSimulationEngine() {
    const sc = SCENARIOS[gameState.scenario];
    Object.keys(gameState.teams).forEach(teamName => {
        const team = gameState.teams[teamName];
        const dec = team.decisions[gameState.round] || {
            vol: 3, line: 'Balanced', cli: 3, bt: 1, freeze: 'None', coll: 3
        };

        // INPUTS
        let volMult = 1 + ((dec.vol - 3) * 0.08); 
        let lineRisk = 1.0; 
        if(dec.line==='Conservative') {lineRisk=0.85; volMult-=0.04;} 
        if(dec.line==='Aggressive') {lineRisk=1.3; volMult+=0.08;}
        
        let cliBal = 1 + ((dec.cli - 1) * 0.03); 
        let cliRisk = 1 + ((dec.cli - 1) * 0.07);
        let btBal = 1 + ((dec.bt - 1) * 0.04);
        let freezeImpact = 1.0; 
        if(dec.freeze==='Selective') freezeImpact=0.97; 
        if(dec.freeze==='Reactive') freezeImpact=0.92;
        let collBenefit = dec.coll * 0.15; 
        let collCost = dec.coll * 0.25;

        // RISK
        const baseRisk = (dec.vol * 0.6) + (cliRisk * 0.4);
        const tailRisk = (lineRisk * 1.8) + (dec.cli * 0.3);
        const currentRiskIndex = (0.3 * baseRisk) + (sc.tail_weight * tailRisk);
        team.risk_history.push(currentRiskIndex);

        let acqCost = 0;
        if(dec.vol > 3) acqCost += (dec.vol - 3) * 0.5; 
        if(dec.bt > 2) acqCost += (dec.bt - 2) * 0.3;   

        // GROWTH
        const growth = volMult * cliBal * btBal * freezeImpact;
        const macro = sc.id === 'C' ? 0.85 : 1.04; 
        team.receivables = team.receivables * growth * macro;

        // LOSSES
        const lagIndex = team.risk_history.length - 2; 
        const histRisk = team.risk_history[Math.max(0, lagIndex)];
        let rawLoss = (0.5 * histRisk * histRisk * 0.4) * sc.severity; 
        team.loss_rate = Math.max(0.5, rawLoss - collBenefit);
        
        // PROVISIONS
        team.provisions = currentRiskIndex * (sc.id === 'C' ? 1.8 : 1.1) * 0.8; 
        
        const revenue = team.receivables * 0.14; 
        const opEx = team.receivables * 0.02; 
        const collEx = team.receivables * (collCost / 100);
        const acqEx = team.receivables * (acqCost / 100);
        
        const profit = revenue - (team.receivables * (team.loss_rate/100)) 
                             - (team.receivables * (team.provisions/100)) 
                             - opEx - collEx - acqEx;
        
        team.roe = (profit / (team.receivables * 0.12)) * 100;
        
        team.cumulative_profit += profit;
        const economicCapital = (team.receivables * 0.14) * (histRisk/2); 
        team.cumulative_capital_usage += economicCapital;
        team.roe_history.push(team.roe);

        // Calculate Round RAROC (Cumulative)
        const currentRaroc = (team.cumulative_profit / team.cumulative_capital_usage) * 100;
        team.raroc_history.push(currentRaroc);

        if(profit < 0) team.capital_ratio += (profit / team.receivables) * 100;
        else team.capital_ratio += 0.2;

        team.history_log.unshift({
            round: gameState.round,
            scenario: gameState.scenario,
            dec_summ: "V:"+dec.vol+" L:"+dec.line.substring(0,4)+" BT:"+dec.bt,
            met_summ: "ROE:"+team.roe.toFixed(1)+"% L:"+team.loss_rate.toFixed(1)+"%",
            decision: "Vol:"+dec.vol+" | Line:"+dec.line+" | CLI:"+dec.cli,
            impact: "ROE: "+team.roe.toFixed(1)+"% | Loss: "+team.loss_rate.toFixed(1)+"%"
        });
    });
}

function calculateFinalScores() {
    Object.keys(gameState.teams).forEach(teamName => {
        const team = gameState.teams[teamName];
        const raroc = (team.cumulative_profit / team.cumulative_capital_usage) * 100;
        team.raroc = raroc;
        const avgRoe = team.roe_history.reduce((a,b)=>a+b, 0) / team.roe_history.length;
        let score = (raroc * 0.7) + (avgRoe * 0.3);
        if(team.capital_ratio < 8.0) score -= 50;
        team.final_score = Math.round(score * 10) / 10;
    });
}

http.listen(PORT, () => console.log(`v9.0 Running on http://localhost:${PORT}`));

// --- 4. FRONTEND ---
const frontendCode = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>CRO Cockpit v9.0</title>
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root { --bg: #0b0f19; --glass: rgba(16, 24, 40, 0.95); --blue: #00f3ff; --green: #00ff9d; --red: #ff0055; --amber: #ffaa00; }
        body { background: #000; color: #e0e6ed; font-family: 'Segoe UI', monospace; margin: 0; height: 100vh; overflow: hidden; display:flex; flex-direction:column; }
        #main-container { flex: 1; position: relative; overflow: hidden; display:flex; flex-direction:column; }
        #ticker-bar { height: 35px; background: #050505; border-bottom: 1px solid #333; overflow: hidden; white-space: nowrap; display:flex; align-items:center; flex-shrink:0; }
        .ticker-wrap { width: 100%; overflow: hidden; }
        .ticker-move { display: inline-block; white-space: nowrap; padding-right: 100%; animation: ticker-anim 45s linear infinite; }
        .ticker-item { display: inline-block; padding: 0 30px; color: var(--amber); font-family: 'Courier New', monospace; font-size: 0.95em; }
        @keyframes ticker-anim { 0% { transform: translate3d(0, 0, 0); } 100% { transform: translate3d(-100%, 0, 0); } }
        
        .screen { width: 100%; height: 100%; display:none; flex-direction:column; }
        .screen.active { display:flex; }
        .glass { background: var(--glass); border: 1px solid #333; box-shadow: 0 0 20px rgba(0,0,0,0.8); border-radius: 4px; padding: 15px; display:flex; flex-direction:column; }
        
        /* HUD & Controls */
        #hud { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 10px; }
        .metric { text-align: center; border-top: 2px solid var(--blue); padding: 10px; } 
        .val { font-size: 1.8em; font-weight: bold; letter-spacing: 1px; }
        .control-scroll-area { flex:1; overflow-y:auto; padding-right:5px; margin-bottom:10px; border-bottom:1px solid #333; }
        .control-row { margin-bottom: 15px; border-bottom: 1px dashed #333; padding-bottom: 10px; position:relative; }
        .control-row label { display: block; color: var(--blue); margin-bottom: 5px; font-weight: bold; text-transform:uppercase; font-size:0.8em; }
        
        .btn-group { display: flex; gap: 2px; margin-top:5px; background:#111; padding:2px; }
        .btn-opt { flex: 1; background: #222; color: #666; padding: 8px; cursor: pointer; text-align: center; font-size:0.8em; border:1px solid #333; transition:0.2s; }
        .btn-opt:hover { background: #333; }
        .btn-opt.selected { background: var(--blue); color: #000; font-weight: bold; border-color:var(--blue); box-shadow: 0 0 10px var(--blue); }
        input[type=range] { width: 100%; accent-color: var(--blue); margin-top:5px; cursor:pointer; }
        
        /* SENSITIVITY PANEL */
        .sens-btn { background:none; border:none; color:#666; font-size:0.8em; cursor:pointer; margin-top:5px; }
        .sens-btn:hover { color:var(--blue); }
        .sens-panel { background:#111; border-top:1px solid #333; padding:10px; margin-top:5px; display:none; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.8em; }
        .sens-panel.open { display:grid; }
        .sens-item { color:#aaa; }
        .sens-val { color:var(--green); font-weight:bold; float:right; }
        .sens-val.neg { color:var(--red); }

        /* MISSION LOG (ASTRAL GRAPH) */
        #mission-control {
            position: fixed; top:0; left:0; width:100vw; height:100vh; z-index:2000;
            background: radial-gradient(circle at center, #0B1021 0%, #000000 100%);
            display:none; flex-direction:column; padding:20px; box-sizing:border-box;
        }
        #mission-control.open { display:flex; }
        
        /* SATELLITE POINTS (Overlay on Chart) */
        .chart-container { position:relative; flex:1; width:100%; margin-top:20px; }
        .satellite-point {
            position: absolute; width: 12px; height: 12px; border-radius: 50%;
            background: white; transform: translate(-50%, -50%);
            box-shadow: 0 0 10px var(--blue), 0 0 20px var(--blue);
            animation: pulse 3s infinite ease-in-out;
            cursor: pointer; z-index:10;
        }
        .sat-label-top {
            position:absolute; bottom:15px; left:50%; transform:translateX(-50%);
            white-space:nowrap; font-size:0.75em; color:var(--blue); 
            background:rgba(0,0,0,0.7); padding:2px 5px; border-radius:3px;
            border:1px solid #333; pointer-events:none;
        }
        .sat-label-btm {
            position:absolute; top:15px; left:50%; transform:translateX(-50%);
            white-space:nowrap; font-size:0.75em; color:var(--green); 
            background:rgba(0,0,0,0.7); padding:2px 5px; border-radius:3px;
            border:1px solid #333; pointer-events:none;
        }

        @keyframes pulse {
            0% { opacity: 0.4; transform: translate(-50%, -50%) scale(0.8); }
            50% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); box-shadow: 0 0 20px var(--blue), 0 0 40px var(--blue); }
            100% { opacity: 0.4; transform: translate(-50%, -50%) scale(0.8); }
        }

        /* LAYOUT HELPERS */
        #lock-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center; z-index:10; backdrop-filter:blur(3px); flex-direction:column; }
        #lock-stamp { border: 5px solid var(--green); color: var(--green); font-size: 2.5em; font-weight: bold; padding: 20px; transform: rotate(-10deg); text-transform: uppercase; letter-spacing: 5px; text-shadow: 0 0 20px var(--green); }
        #endgame-screen { position:absolute; top:0; left:0; width:100%; height:100%; background:black; z-index:999; display:none; flex-direction:column; align-items:center; justify-content:center; }
        .score-card { width: 60%; background: #111; border: 2px solid var(--amber); padding: 40px; text-align: center; max-height:80vh; overflow-y:auto; }

        button.main-btn { width: 100%; padding: 15px; background: #111; border: 1px solid var(--blue); color: var(--blue); font-size: 1.2em; cursor: pointer; font-weight: bold; letter-spacing: 2px; text-transform:uppercase; transition: 0.2s; flex-shrink:0; }
        button.main-btn:hover:not(:disabled) { background: var(--blue); color: #000; box-shadow: 0 0 20px var(--blue); }
        button.main-btn:disabled { border-color: #444; color: #555; cursor: not-allowed; }
        .hidden { display:none !important; }
    </style>
</head>
<body>
    <div id="ticker-bar">
        <div style="background:#222; color:white; padding:0 10px; height:100%; display:flex; align-items:center; z-index:2; border-right:1px solid #444;">MARKET WIRE</div>
        <div class="ticker-wrap">
            <div id="news-feed" class="ticker-move">
                <div class="ticker-item">SYSTEM CONNECTED... WAITING FOR ROUND 1...</div>
            </div>
        </div>
    </div>
    <div id="main-container">
        <div id="login-screen" class="screen active" style="justify-content:center; align-items:center; background:black;">
            <div class="glass" style="width: 300px; text-align: center;">
                <h2 style="color:var(--blue); margin-top:0;">RISK SIMULATOR v9.0</h2>
                <input id="tName" placeholder="ENTER CALLSIGN" style="padding:15px; width:85%; margin-bottom:15px; background:#111; border:1px solid #444; color:var(--green); font-family:monospace; font-size:1.1em; text-transform:uppercase;">
                <button onclick="login('team')" class="main-btn">INITIATE UPLINK</button>
                <div style="margin-top:20px; border-top:1px solid #333; padding-top:10px;">
                    <input id="aPass" type="password" placeholder="ADMIN KEY" style="padding:5px; background:#111; border:1px solid #444; color:white;">
                    <button onclick="login('admin')" style="background:none; border:1px solid #666; color:#666; cursor:pointer; padding:5px;">AUTH</button>
                </div>
            </div>
        </div>
        <div id="admin-ui" class="screen" style="padding:20px; overflow-y:auto; background:#111;">
            <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                <h2 style="color:white; margin:0;">FACILITATOR COMMAND</h2>
                <div>
                    <span id="adm-rd" style="font-size:2em; margin-right:20px; font-weight:bold; color:var(--amber)">LOBBY</span>
                    <button onclick="sEmit('admin_action', {type:'START_ROUND'})" style="padding:10px 20px; background:green; color:white; border:none; cursor:pointer; font-weight:bold;">START ROUND</button>
                    <button onclick="sEmit('admin_action', {type:'END_ROUND'})" style="padding:10px 20px; background:red; color:white; border:none; cursor:pointer; font-weight:bold;">CLOSE MARKET</button>
                </div>
            </div>
            <div id="adm-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:15px;"></div>
        </div>
        <div id="team-ui" class="screen" style="background: radial-gradient(circle at center, #1a2c4e 0%, #000 100%);">
            <div style="padding: 10px 20px;">
                <div id="hud">
                    <div class="glass metric"><div>ROE</div><div id="d-roe" class="val" style="color:var(--green)">0%</div></div>
                    <div class="glass metric"><div>LOSS RATE</div><div id="d-loss" class="val" style="color:var(--red)">0%</div></div>
                    <div class="glass metric"><div>PROVISIONS</div><div id="d-prov" class="val" style="color:var(--amber)">0%</div></div>
                    <div class="glass metric"><div>CAPITAL</div><div id="d-cap" class="val">0%</div></div>
                    <div class="glass metric"><div>RECEIVABLES</div><div id="d-rec" class="val">0</div></div>
                </div>
            </div>
            <div style="flex:1; display:flex; padding:0 20px 20px 20px; gap:20px; overflow:hidden;">
                <div class="glass" style="flex:1; position:relative; overflow:hidden;">
                    <div id="lock-overlay" class="hidden">
                        <div id="lock-stamp">DECISION LOCKED</div>
                        <div style="color:white; margin-top:20px;">Waiting for Round End...</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--blue); padding-bottom:10px; margin-bottom:15px; flex-shrink:0;">
                        <h3 style="margin:0; color:white;">DECISION DECK</h3>
                        <div id="rd-ind" style="color:var(--amber); font-weight:bold;">ROUND 0</div>
                    </div>
                    <div class="control-scroll-area">
                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;">
                                <label>1. ACQUISITION VOLUME</label><span id="ctx-vol" style="color:var(--blue); font-size:0.8em;">Balanced</span>
                            </div>
                            <input type="range" id="i-vol" min="1" max="5" value="3" oninput="updContext()">
                            <button class="sens-btn" onclick="toggleSens('sens-vol')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-vol" class="sens-panel">
                                <div class="sens-item">Return Growth <span class="sens-val">+8.0%</span></div>
                                <div class="sens-item">Prov Impact <span class="sens-val neg">+0.3%</span></div>
                                <div class="sens-item">Cap Usage <span class="sens-val neg">+2.0%</span></div>
                                <div class="sens-item">OpEx (Cost) <span class="sens-val neg">+0.5%</span></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <label>2. INITIAL LINE ASSIGNMENT</label>
                            <div class="btn-group" id="grp-line">
                                <div class="btn-opt" onclick="selBtn('grp-line', 'Conservative')">Conservative</div>
                                <div class="btn-opt selected" onclick="selBtn('grp-line', 'Balanced')">Balanced</div>
                                <div class="btn-opt" onclick="selBtn('grp-line', 'Aggressive')">Aggressive</div>
                            </div>
                            <button class="sens-btn" onclick="toggleSens('sens-line')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-line" class="sens-panel">
                                <div class="sens-item">Return Growth <span class="sens-val">+8.0%</span></div>
                                <div class="sens-item">Tail Risk <span class="sens-val neg">HIGH</span></div>
                                <div class="sens-item">Cap Usage <span class="sens-val neg">+5.0%</span></div>
                                <div class="sens-item">Cost Impact <span class="sens-val">None</span></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <label>3. UPSELL AGGRESSION</label>
                            <input type="range" id="i-cli" min="1" max="5" value="3" oninput="updContext()">
                            <button class="sens-btn" onclick="toggleSens('sens-cli')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-cli" class="sens-panel">
                                <div class="sens-item">Return Growth <span class="sens-val">+3.0%</span></div>
                                <div class="sens-item">Prov Impact <span class="sens-val neg">+0.2%</span></div>
                                <div class="sens-item">Cap Usage <span class="sens-val neg">+1.5%</span></div>
                                <div class="sens-item">Loss Lag <span class="sens-val neg">Med</span></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <label>4. BALANCE TRANSFER PUSH</label>
                            <input type="range" id="i-bt" min="1" max="5" value="1" oninput="updContext()">
                            <button class="sens-btn" onclick="toggleSens('sens-bt')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-bt" class="sens-panel">
                                <div class="sens-item">Return Growth <span class="sens-val">+4.0%</span></div>
                                <div class="sens-item">Churn Risk <span class="sens-val neg">High</span></div>
                                <div class="sens-item">Acq Cost <span class="sens-val neg">+0.3%</span></div>
                                <div class="sens-item">Prov Impact <span class="sens-val">Low</span></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <label>5. PORTFOLIO ACTIONS</label>
                            <div class="btn-group" id="grp-frz">
                                <div class="btn-opt selected" onclick="selBtn('grp-frz', 'None')">None</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Selective')">Selective</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Reactive')">Reactive</div>
                            </div>
                            <button class="sens-btn" onclick="toggleSens('sens-frz')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-frz" class="sens-panel">
                                <div class="sens-item">Return Impact <span class="sens-val neg">-5.0%</span></div>
                                <div class="sens-item">Loss Reduction <span class="sens-val">+0.5%</span></div>
                                <div class="sens-item">Cap Relief <span class="sens-val">+2.0%</span></div>
                                <div class="sens-item">Cost Impact <span class="sens-val">Low</span></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <label>6. COLLECTIONS INTENSITY</label>
                            <input type="range" id="i-coll" min="1" max="5" value="3" oninput="updContext()">
                            <button class="sens-btn" onclick="toggleSens('sens-coll')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-coll" class="sens-panel">
                                <div class="sens-item">Loss Reduction <span class="sens-val">+0.2%</span></div>
                                <div class="sens-item">OpEx (Cost) <span class="sens-val neg">+0.3%</span></div>
                                <div class="sens-item">Return Impact <span class="sens-val neg">None</span></div>
                                <div class="sens-item">Cap Usage <span class="sens-val">Neutral</span></div>
                            </div>
                        </div>
                    </div>
                    <button id="sub-btn" class="main-btn" onclick="submit()" disabled>WAITING FOR MARKET...</button>
                </div>
                
                <div class="glass" style="width: 30%; display:flex; flex-direction:column;">
                    <h4 style="color:var(--red); margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">CEO PRIORITY</h4>
                    <div id="ceo-msg" style="font-style:italic; margin-bottom:20px; font-size:1.1em; color:#ddd; flex:1; overflow-y:auto;">"System Initializing..."</div>
                    <button class="main-btn" onclick="showMissionLog()" style="border-color:var(--amber); color:var(--amber); margin-bottom:20px; font-size:1em;">> VIEW MISSION LOG</button>
                    <div style="margin-top:auto;">
                        <div style="font-size:0.8em; color:#666;">CURRENT SCENARIO</div>
                        <div id="scen-nm" style="font-size:1.5em; color:var(--blue); font-weight:bold;">-</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div id="mission-control">
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2 style="color:var(--blue); margin:0; text-transform:uppercase; letter-spacing:2px;">Strategic Trajectory</h2>
            <button onclick="closeMissionLog()" style="background:none; border:1px solid var(--red); color:var(--red); padding:5px 15px; cursor:pointer;">CLOSE LINK</button>
        </div>
        <div class="chart-container" id="chart-wrapper">
            <canvas id="missionChart"></canvas>
            </div>
    </div>

    <div id="endgame-screen">
        <div class="score-card">
            <h1 style="color:var(--amber); font-size:3em; margin:0;">SIMULATION COMPLETE</h1>
            <p>MARKET CLOSED PERMANENTLY</p>
            <div id="final-scores" style="text-align:left; margin-top:30px;"></div>
            <button onclick="location.reload()" style="margin-top:30px; padding:10px; background:#333; color:white; border:none; cursor:pointer;">RESET SYSTEM</button>
        </div>
    </div>

    <script>
        const socket = io();
        let myTeam = "";
        let teamDataRef = null;
        let decisions = { line: 'Balanced', freeze: 'None' };
        let missionChart = null;

        function sEmit(ev, data) { socket.emit(ev, data); }
        function login(role) {
            if(role==='team') sEmit('login', {role, teamName: document.getElementById('tName').value.toUpperCase()});
            else sEmit('login', {role, password: document.getElementById('aPass').value});
        }
        function selBtn(grp, val) {
            document.querySelectorAll('#'+grp+' .btn-opt').forEach(b => b.classList.remove('selected'));
            event.target.classList.add('selected');
            if(grp === 'grp-line') decisions.line = val;
            if(grp === 'grp-frz') decisions.freeze = val;
            updContext();
        }
        function toggleSens(id) { document.getElementById(id).classList.toggle('open'); }
        function updContext() {
            const v = document.getElementById('i-vol').value;
            document.getElementById('ctx-vol').innerText = v==1?"Low Risk": (v==5?"High Risk":"Balanced");
        }
        function submit() {
            const data = {
                vol: document.getElementById('i-vol').value,
                line: decisions.line,
                cli: document.getElementById('i-cli').value,
                bt: document.getElementById('i-bt').value,
                freeze: decisions.freeze,
                coll: document.getElementById('i-coll').value
            };
            sEmit('submit_decision', data);
            document.getElementById('lock-overlay').classList.remove('hidden');
        }

        // --- GRAPHING LOGIC ---
        function showMissionLog() {
            document.getElementById('mission-control').classList.add('open');
            renderChart();
        }
        function closeMissionLog() {
            document.getElementById('mission-control').classList.remove('open');
        }

        function renderChart() {
            if(!teamDataRef) return;
            // Process Data: Reverse chronological log to linear arrays
            const sortedLog = [...teamDataRef.history_log].reverse();
            const roeData = teamDataRef.roe_history;
            const rarocData = teamDataRef.raroc_history;
            const rounds = sortedLog.map(l => "R" + l.round);

            const ctx = document.getElementById('missionChart').getContext('2d');
            if(missionChart) missionChart.destroy();

            missionChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: rounds,
                    datasets: [
                        { label: 'ROE %', data: roeData, borderColor: '#00ff9d', backgroundColor: 'rgba(0,255,157,0.1)', yAxisID: 'y', tension: 0.4 },
                        { label: 'RAROC %', data: rarocData, borderColor: '#00f3ff', backgroundColor: 'rgba(0,243,255,0.1)', yAxisID: 'y1', tension: 0.4 }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#00ff9d' } },
                        y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#00f3ff' } },
                        x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#ccc' } }
                    },
                    animation: {
                        onComplete: () => { updateSatellites(sortedLog); }
                    }
                }
            });
        }

        function updateSatellites(logData) {
            // Remove old sats
            document.querySelectorAll('.satellite-point, .sat-label-top, .sat-label-btm').forEach(e => e.remove());
            const wrapper = document.getElementById('chart-wrapper');
            const meta = missionChart.getDatasetMeta(0); // Use ROE line for position reference
            
            meta.data.forEach((point, index) => {
                // Create Satellite
                const sat = document.createElement('div');
                sat.className = 'satellite-point';
                sat.style.left = point.x + 'px';
                sat.style.top = point.y + 'px';
                wrapper.appendChild(sat);

                // Create Top Label (Decisions)
                const topLab = document.createElement('div');
                topLab.className = 'sat-label-top';
                topLab.innerText = logData[index].dec_summ;
                topLab.style.left = point.x + 'px';
                topLab.style.bottom = (wrapper.clientHeight - point.y + 15) + 'px';
                wrapper.appendChild(topLab);

                // Create Bottom Label (Outcomes)
                const btmLab = document.createElement('div');
                btmLab.className = 'sat-label-btm';
                btmLab.innerText = logData[index].met_summ;
                btmLab.style.left = point.x + 'px';
                btmLab.style.top = (point.y + 15) + 'px';
                wrapper.appendChild(btmLab);
            });
        }

        socket.on('auth_success', (res) => {
            document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
            if(res.role === 'admin') {
                document.getElementById('admin-ui').classList.add('active');
                updAdmin(res.state);
            } else {
                myTeam = res.teamName;
                teamDataRef = res.teamData;
                document.getElementById('team-ui').classList.add('active');
                updTeam(res.teamData, res.state);
            }
        });
        socket.on('state_update', (s) => {
            if(s.status === 'ENDGAME') {
                document.getElementById('endgame-screen').style.display = 'flex';
                const list = document.getElementById('final-scores');
                list.innerHTML = '';
                const sorted = Object.keys(s.teams).sort((a,b) => s.teams[b].final_score - s.teams[a].final_score);
                sorted.forEach((t, i) => {
                    list.innerHTML += '<div style="font-size:1.5em; padding:10px; border-bottom:1px solid #333; color:'+(i==0?'var(--green)':'white')+'">#'+(i+1)+' '+t+' : '+s.teams[t].final_score+' PTS <span style="font-size:0.5em">(RAROC '+s.teams[t].raroc.toFixed(1)+'%)</span></div>';
                });
                return;
            }
            document.getElementById('rd-ind').innerText = "ROUND " + s.round;
            document.getElementById('scen-nm').innerText = s.scenario === 'A' ? "EXPANSION" : (s.scenario === 'B' ? "LATE CYCLE" : "SHOCK");
            const tDiv = document.getElementById('news-feed');
            tDiv.innerHTML = "";
            s.news_feed.forEach(n => {
                tDiv.innerHTML += '<div class="ticker-item">'+n+'</div>';
            });
            let ceo = "Grow the book! Competitors are moving fast.";
            if(s.scenario === 'B') ceo = "I'm seeing red flags. Keep growing but watch the quality.";
            if(s.scenario === 'C') ceo = "WE ARE BLEEDING! Protect Capital at all costs!";
            document.getElementById('ceo-msg').innerText = '"' + ceo + '"';
            const btn = document.getElementById('sub-btn');
            if(s.status === 'OPEN') {
                document.getElementById('lock-overlay').classList.add('hidden'); 
                btn.disabled = false;
                btn.innerText = "SUBMIT DECISION";
            } else {
                btn.disabled = true;
                btn.innerText = "MARKET CLOSED";
            }
            const adminDiv = document.getElementById('admin-ui');
            if(adminDiv.classList.contains('active')) updAdmin(s);
        });
        socket.on('team_data_update', (msg) => {
            if(msg.name === myTeam) {
                teamDataRef = msg.data;
                updTeam(msg.data, null);
            }
        });
        function updTeam(d, s) {
            document.getElementById('d-roe').innerText = d.roe.toFixed(1) + "%";
            document.getElementById('d-loss').innerText = d.loss_rate.toFixed(1) + "%";
            document.getElementById('d-prov').innerText = d.provisions.toFixed(1) + "%";
            document.getElementById('d-cap').innerText = d.capital_ratio.toFixed(1) + "%";
            document.getElementById('d-rec').innerText = Math.round(d.receivables);
        }
        function updAdmin(s) {
            document.getElementById('adm-rd').innerText = s.round;
            const l = document.getElementById('adm-list');
            l.innerHTML = '';
            Object.keys(s.teams).forEach(t => {
                const team = s.teams[t];
                let decStatus = '<span style="color:var(--red)">WAITING...</span>';
                let decDetail = '';
                if(team.decisions[s.round]) {
                    const d = team.decisions[s.round];
                    decStatus = '<span style="color:var(--green)">LOCKED</span>';
                    decDetail = '<div style="margin-top:5px; font-size:0.8em; color:#aaa; border-top:1px solid #333; padding-top:5px;">' +
                        'Vol: <b style="color:white">'+d.vol+'</b> | Line: <b style="color:white">'+d.line+'</b><br>' +
                        'CLI: <b>'+d.cli+'</b> | BT: <b>'+d.bt+'</b> | Frz: <b>'+d.freeze+'</b>' +
                        '</div>';
                }
                l.innerHTML += '<div class="glass" style="padding:10px;"><div style="display:flex; justify-content:space-between;"><div style="color:var(--blue); font-weight:bold; font-size:1.2em;">'+t+'</div><div>'+decStatus+'</div></div><div style="font-size:0.9em; margin-top:5px;">ROE: '+team.roe.toFixed(1)+'% | Cap: '+team.capital_ratio.toFixed(1)+'%</div>'+decDetail+'</div>';
            });
        }
    </script>
</body>
</html>
`;
