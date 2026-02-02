/**
 * CREDIT CARD RISK SIMULATION v23.0 - RWA EDITION
 * - Feature: Split Portfolio (Prime vs Sub-Prime Balances).
 * - Feature: RWA (Risk Weighted Asset) Logic. Sub-Prime costs 3x more Capital than Prime.
 * - Feature: Line Strategy (Reactive vs Proactive) drives Utilization & RWA.
 * - Deleted: Collections Slider.
 * - Math: Solvency Floor 9.0%.
 * - Theme: Captain's Room.
 * - Port: 3000
 */

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "admin"; 

// --- 1. DATABASES ---

const CEO_SCRIPTS = {
    1: "Welcome to Q1. The Board wants 'Efficient Growth.' That means high ROE. The Sub-Prime book yields 24%—that's where the money is. I want you to ramp up the 'High Yield' acquisition engine. Don't worry about capital charges yet; we have plenty of buffer.",
    2: "Revenue is looking good, but our loan utilization is too low. We have too many customers sitting on empty credit lines. Switch to a 'Proactive' Line Strategy. Push the limits. Make them spend.",
    3: "Analysts are asking about our Asset Mix. They say we look too heavy on the risky side. Ignore them. As long as the economy holds, that Sub-Prime book is a gold mine. Keep the pedal down.",
    4: "Inflation is ticking up. I'm seeing early stress in the Sub-Prime vintage. I'm not saying stop, but... maybe start layering in some Prime volume to dilute the risk? Just don't kill the yield.",
    5: "Okay, the RWA (Risk Weighted Assets) number is getting ugly. We are burning capital too fast. Every dollar of Sub-Prime you book is eating 3x the capital of a Prime dollar. You need to balance the mix before we hit the regulatory floor.",
    6: "Market turns are unpredictable. If we enter a recession with a Sub-Prime heavy book and Proactive lines, we are dead. The 'Unused Exposure' will kill us. Consider switching the Line Strategy to Reactive to save capital.",
    7: "CRASH. UNEMPLOYMENT 8%. The Sub-Prime book is melting down. Losses are skyrocketing. If you have Prime assets, they might save us. If you are 100% Sub-Prime... well, it was nice knowing you.",
    8: "Capital Preservation Mode. We are fighting for solvency. Stop booking high-RWA assets immediately. Only book Prime if you must. We need to shrink the denominator (RWA) to survive.",
    9: "We are crawling out of the wreckage. Look at the survivors. The ones who balanced their RWA are buying the ones who chased yield. Let's see which one you are."
};

const NEWS_DB = {
    'A': [ "BBG: Investors hungry for High-Yield asset backed securities", "CNBC: Consumer spending robust across all segments", "WSJ: Regulatory capital requirements stable" ],
    'B': [ "BBG: Regulators eyeing 'Unused Credit Lines' risk", "CNBC: Sub-prime delinquencies tick up", "FT: Tier 1 Capital ratios under pressure" ],
    'C': [ "ALERT: RECESSION - RISK WEIGHTS SPIKE", "BBG: Banks scramble to raise equity", "WSJ: Sub-prime sector faces liquidity freeze" ]
};

const SCENARIOS = {
    'A': { id: 'A', name: 'Expansion', severity: 0.8 },
    'B': { id: 'B', name: 'Late Cycle', severity: 1.2 }, 
    'C': { id: 'C', name: 'Shock', severity: 2.2 } 
};

// Initial State now tracks TWO portfolios
const INITIAL_TEAM_STATE = {
    prime_bal: 700,         // Safe, Low Yield
    sub_bal: 300,           // Risky, High Yield
    receivables: 1000,      // Total
    rwa: 1275,              // Risk Weighted Assets (700*0.75 + 300*2.5)
    capital_ratio: 14.0,    // Equity / RWA
    roe: 12.0,
    loss_rate: 2.0,
    provisions: 2.0,
    decisions: {}, 
    history_log: [],
    cumulative_profit: 0,
    cumulative_capital_usage: 0,
    roe_history: [],
    raroc_history: [],
    rev_history: [],
    bal_history: [],
    final_score: 0,
    raroc: 0,
    archetype: {}, 
    commentary: {},
    is_zombie: false 
};

// --- 2. STATE ---
let gameState = {
    round: 0,
    scenario: 'A',
    status: 'LOBBY',
    teams: {},
    news_feed: ["SYSTEM: Waiting for market open..."],
    cro_data: { vital: "-", cof: "-", liq: "-" }
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
        if (action.type === 'RESET_GAME') {
            gameState.round = 0;
            gameState.scenario = 'A';
            gameState.status = 'LOBBY';
            gameState.teams = {}; 
            gameState.news_feed = ["SYSTEM: Waiting for market open..."];
            
            io.emit('state_update', gameState);
            io.emit('reload_client'); 
            return;
        }

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

            gameState.news_feed = NEWS_DB[gameState.scenario].sort(() => 0.5 - Math.random()).slice(0, 3);
            
            // INTELLIGENCE
            let intel = { vital: "Stable", cof: "Low", liq: "High" };
            if (gameState.round > 3) intel = { vital: "Sub-Prime Stress", cof: "Rising", liq: "Tightening" };
            if (gameState.round > 6) intel = { vital: "CRASH", cof: "Spiking", liq: "FROZEN" };
            gameState.cro_data = intel;
            
            io.emit('state_update', gameState);
        }
        
        if (action.type === 'PUSH_CEO') {
            const text = CEO_SCRIPTS[gameState.round] || "No directive available.";
            io.emit('ceo_transmission', { text: text, round: gameState.round });
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

// --- 3. MATH ENGINE (RWA EDITION) ---
function runSimulationEngine() {
    const sc = SCENARIOS[gameState.scenario];
    Object.keys(gameState.teams).forEach(teamName => {
        const team = gameState.teams[teamName];
        const dec = team.decisions[gameState.round] || { vol_p: 3, vol_s: 1, line: 'Reactive', bt: 1, freeze: 'None' };

        if (team.is_zombie) {
            dec.vol_p = 1; dec.vol_s = 0; dec.line = 'Reactive';
        }

        // 1. RUNOFF (Existing books decay)
        team.prime_bal *= 0.90; 
        team.sub_bal *= 0.88;   // Sub-prime churns faster

        // 2. NEW BOOKINGS (Based on Sliders)
        // Prime: Volume 1-5 => 20cr to 100cr
        const new_prime = dec.vol_p * 25 * (sc.id==='C'?0.5:1.0);
        // Sub: Volume 1-5 => 20cr to 100cr
        const new_sub = dec.vol_s * 25 * (sc.id==='C'?0.3:1.0); // Harder to find subprime in crash

        team.prime_bal += new_prime;
        team.sub_bal += new_sub;

        // 3. LINE STRATEGY IMPACT (Utilization & RWA)
        let utilBoost = 1.0; 
        let rwaPenalty = 1.0; 

        if (dec.line === 'Proactive') {
            utilBoost = 1.08;   // +8% Balances (Revenue)
            rwaPenalty = 1.15;  // +15% RWA (Capital Hit due to Unused Exposure)
        } else {
            // Reactive
            utilBoost = 1.02;   // +2% Balances
            rwaPenalty = 1.0;   // No Penalty
        }

        team.prime_bal *= utilBoost;
        team.sub_bal *= utilBoost;

        // FREEZE IMPACT
        if(dec.freeze !== 'None') {
            const cut = dec.freeze === 'Reactive' ? 0.90 : 0.95;
            team.sub_bal *= cut; // Freeze hits Sub-prime hardest
            team.prime_bal *= 0.98;
        }

        team.receivables = team.prime_bal + team.sub_bal;

        // 4. CALCULATE RWA (THE KEY METRIC)
        // Prime Weight: 75%
        // Sub Weight: 250%
        const prime_rwa = team.prime_bal * 0.75;
        const sub_rwa = team.sub_bal * 2.50;
        
        team.rwa = (prime_rwa + sub_rwa) * rwaPenalty;

        // 5. BLENDED METRICS
        const mix_prime = team.prime_bal / team.receivables;
        const mix_sub = team.sub_bal / team.receivables;

        // YIELD
        // Prime: 8%, Sub: 24%
        const yield_rate = (mix_prime * 0.08) + (mix_sub * 0.24);
        
        // LOSS RATES (Scenario Dependent)
        let loss_p = 0.01; let loss_s = 0.05;
        if(sc.id === 'B') { loss_p = 0.015; loss_s = 0.08; }
        if(sc.id === 'C') { loss_p = 0.025; loss_s = 0.16; } // Crash hits Sub-prime hard
        
        // Freeze Benefit
        if(dec.freeze === 'Selective') loss_s *= 0.85;
        if(dec.freeze === 'Reactive') loss_s *= 0.70;

        const w_loss = (mix_prime * loss_p) + (mix_sub * loss_s);
        team.loss_rate = w_loss * 100;

        // 6. P&L
        const grossRev = team.receivables * yield_rate;
        const intExp = team.receivables * (sc.id==='A'?0.04 : 0.06);
        const opEx = team.receivables * 0.025; // Fixed OpEx 2.5%
        const credCost = team.receivables * w_loss;
        
        // Provisions (Forward looking)
        let prov_factor = sc.id === 'C' ? 0.5 : 1.0; // Don't double count in crash
        const provCost = credCost * prov_factor; 

        const profit = grossRev - intExp - opEx - credCost - provCost;

        // 7. CAPITAL LOGIC (Equity / RWA)
        let equity = team.receivables * (team.capital_ratio / 100); // Old Equity
        // Wait, Capital Ratio is Equity/RWA now. So get old Equity from old RWA?
        // Let's simplify: Maintain Equity Value.
        // Recover equity from previous ratio? No, let's track Cumulative Profit.
        // Re-calculate Equity:
        // Start Equity was 1000 * 14% = 140. 
        // We will just accumulate profit into a hidden 'equity_val' tracking var?
        // To keep it stateless compatible with existing array structure:
        // We will approximate change.
        
        // Better: We need to track actual Equity value to handle the denominator change properly.
        // Let's reverse engineer for this round:
        // Current Equity ~= Old RWA * Old Ratio... let's just add profit to "implied equity"
        // Let's assume current equity is `team.rwa * (team.capital_ratio/100)` BEFORE this round updates? 
        // No, that's recursive.
        
        // FIX: We will estimate Previous Equity = (Previous Receivables * Prev Ratio? No RWA change).
        // Let's just say: Equity += Profit.
        // New Ratio = New Equity / New RWA.
        
        // We need a stored 'equity' value in the state. I didn't add it to INITIAL_TEAM_STATE.
        // Hack: We will derive it.
        // Implied Previous Equity = (team.cumulative_profit + 180); // 180 is starting equity (1275 * 14%)
        let implied_equity = 180 + team.cumulative_profit; 
        
        implied_equity += profit; 
        
        // ZOMBIE CHECK (9.0% Floor)
        team.capital_ratio = (implied_equity / team.rwa) * 100;

        if (team.capital_ratio < 9.0) {
            const req_equity = team.rwa * 0.09;
            const injection = req_equity - implied_equity;
            // Penalty: Equity dilution
            // We don't track stock price, so we mark them Zombie.
            implied_equity += injection; // Bailout
            team.capital_ratio = 9.0;
            team.is_zombie = true;
        }

        team.roe = (profit / implied_equity) * 100;
        team.cumulative_profit += profit;
        team.cumulative_capital_usage += (team.rwa * 0.12); // Cost of Capital charge
        
        team.provisions = (provCost / team.receivables) * 100;

        team.roe_history.push(team.roe);
        const currentRaroc = (team.cumulative_profit / team.cumulative_capital_usage) * 100;
        team.raroc_history.push(currentRaroc);
        team.rev_history.push(grossRev);
        team.bal_history.push(team.receivables);

        let finalLabel = `P:${dec.vol_p} | S:${dec.vol_s}`;
        if (team.is_zombie) finalLabel = "⚠️ ZOMBIE";
        
        team.history_log.unshift({
            round: gameState.round, scenario: gameState.scenario,
            dec_summ: finalLabel,
            met_summ: `Loss:${team.loss_rate.toFixed(1)}% | RWA:${Math.round(team.rwa)}`,
            decision: `Strat:${dec.line}`, impact: `Cap:${team.capital_ratio.toFixed(1)}%`
        });
    });
}

function calculateFinalScores() {
    Object.keys(gameState.teams).forEach(teamName => {
        const team = gameState.teams[teamName];
        const raroc = (team.cumulative_profit / team.cumulative_capital_usage) * 100;
        team.raroc = raroc;
        const avgRoe = team.roe_history.reduce((a,b)=>a+b, 0) / team.roe_history.length;
        
        let score = (raroc * 0.6) + (avgRoe * 0.4);
        
        let title = "THE PASSENGER";
        let color = "#aaa";
        let good = "You survived.";
        let bad = "Average performance.";

        if (score > 18 && !team.is_zombie) {
            title = "THE ARCHITECT"; color = "#00ff9d";
            good = "Perfect RWA Optimization.";
            bad = "You mastered the capital equation.";
        } else if (team.is_zombie) {
            title = "THE ZOMBIE BANK"; color = "#ff0055";
            good = "You generated revenue.";
            bad = "But you ignored Capital Consumption (RWA).";
        } else if (team.capital_ratio > 20) {
            title = "THE HOARDER"; color = "#00f3ff";
            good = "Safe.";
            bad = "Inefficient. You sat on cash.";
        } 

        team.final_score = Math.round(score * 10) / 10;
        team.archetype = { title, color };
        team.commentary = { good, bad };
    });
}

http.listen(PORT, () => console.log(`v23.0 Running on http://localhost:${PORT}`));

// --- 4. FRONTEND ---
const frontendCode = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Captain's Room</title>
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
        
        #hud { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 10px; }
        .metric { text-align: center; border-top: 2px solid var(--blue); padding: 10px; } 
        .val { font-size: 1.8em; font-weight: bold; letter-spacing: 1px; }
        .control-scroll-area { flex:1; overflow-y:auto; padding-right:5px; margin-bottom:10px; border-bottom:1px solid #333; }
        .control-row { margin-bottom: 15px; border-bottom: 1px dashed #333; padding-bottom: 10px; position:relative; }
        .control-row label { display: block; color: var(--blue); margin-bottom: 5px; font-weight: bold; text-transform:uppercase; font-size:0.8em; }
        .btn-group { display: flex; gap: 2px; margin-top:5px; background:#111; padding:2px; }
        .btn-opt { flex: 1; background: #222; color: #666; padding: 8px; cursor: pointer; text-align: center; font-size:0.8em; border:1px solid #333; transition:0.2s; }
        .btn-opt.selected { background: var(--blue); color: #000; font-weight: bold; border-color:var(--blue); box-shadow: 0 0 10px var(--blue); }
        input[type=range] { width: 100%; accent-color: var(--blue); margin-top:5px; cursor:pointer; }
        
        /* New RWA Meter */
        .rwa-meter { height: 10px; background: #333; width: 100%; margin-top:5px; position:relative; }
        .rwa-fill { height:100%; background: linear-gradient(90deg, #00ff9d, #ffaa00, #ff0055); width: 0%; transition: 0.5s; }

        #mission-control { position: fixed; top:0; left:0; width:100vw; height:100vh; z-index:2000; background: #050810; display:none; flex-direction:column; padding:20px; box-sizing:border-box; overflow:hidden; }
        #mission-control.open { display:flex; }
        
        .chart-container { position:relative; flex:1; width:100%; margin-top:20px; z-index:10; }
        #ceo-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.95); z-index: 3000; display: none; justify-content: center; align-items: center; flex-direction: column; backdrop-filter: blur(5px); }
        #ceo-overlay.active { display: flex; }
        .transmission-box { width: 70%; max-width: 800px; border: 2px solid var(--red); background: #110505; padding: 40px; box-shadow: 0 0 50px rgba(255, 0, 85, 0.3); text-align: center; position: relative; }
        .ack-btn { background: var(--red); color: white; border: none; padding: 15px 30px; font-size: 1.2em; cursor: pointer; font-weight: bold; letter-spacing: 2px; }
        
        #lock-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center; z-index:10; backdrop-filter:blur(3px); flex-direction:column; }
        #endgame-screen { position:absolute; top:0; left:0; width:100%; height:100%; background:black; z-index:999; display:none; flex-direction:column; align-items:center; justify-content:center; overflow-y:auto; padding:20px; }
        .score-card { width: 70%; background: #111; border: 2px solid var(--amber); padding: 40px; text-align: center; }
        button.main-btn { width: 100%; padding: 15px; background: #111; border: 1px solid var(--blue); color: var(--blue); font-size: 1.2em; cursor: pointer; font-weight: bold; letter-spacing: 2px; text-transform:uppercase; transition: 0.2s; flex-shrink:0; }
        .hidden { display:none !important; }
        
        .rank-card { background:#1a1a1a; margin-bottom:15px; padding:15px; text-align:left; border-left:5px solid #555; color:#ddd; }
    </style>
</head>
<body>
    <div id="ticker-bar">
        <div style="background:#222; color:white; padding:0 10px; height:100%; display:flex; align-items:center; z-index:2; border-right:1px solid #444;">MARKET WIRE</div>
        <div class="ticker-wrap"><div id="news-feed" class="ticker-move"><div class="ticker-item">...</div></div></div>
    </div>
    <div id="main-container">
        <div id="login-screen" class="screen active" style="justify-content:center; align-items:center; background:black;">
            <div class="glass" style="width: 320px; text-align: center;">
                <h2 style="color:var(--blue); margin-top:0; border-bottom:1px solid #333; padding-bottom:10px;">CAPTAIN'S ROOM // RWA EDITION</h2>
                <input id="tName" placeholder="ENTER CALLSIGN" style="padding:15px; width:85%; margin-bottom:15px; background:#111; border:1px solid #444; color:var(--green); font-family:monospace; font-size:1.1em; text-transform:uppercase; text-align:center;">
                <button onclick="login('team')" class="main-btn">INITIATE UPLINK</button>
                <div style="margin-top:20px; border-top:1px solid #333; padding-top:10px;">
                    <input id="aPass" type="password" placeholder="ADMIN KEY" style="padding:5px; background:#111; border:1px solid #444; color:white; text-align:center;">
                    <button onclick="login('admin')" style="background:none; border:1px solid #666; color:#666; cursor:pointer; padding:5px;">AUTH</button>
                </div>
            </div>
        </div>
        <div id="team-ui" class="screen" style="background: radial-gradient(circle at center, #1a2c4e 0%, #000 100%);">
            <div style="padding: 10px 20px;">
                <div id="hud">
                    <div class="glass metric"><div>ROE</div><div id="d-roe" class="val" style="color:var(--green)">0%</div></div>
                    <div class="glass metric"><div>CAPITAL RATIO</div><div id="d-cap" class="val" style="color:var(--amber)">0%</div></div>
                    <div class="glass metric"><div>LOSS RATE</div><div id="d-loss" class="val" style="color:var(--red)">0%</div></div>
                    <div class="glass metric"><div>RWA</div><div id="d-rwa" class="val">0</div></div>
                    <div class="glass metric"><div>RECEIVABLES</div><div id="d-rec" class="val">0</div></div>
                </div>
            </div>
            <div style="flex:1; display:flex; padding:0 20px 20px 20px; gap:20px; overflow:hidden;">
                <div class="glass" style="flex:1; position:relative; overflow:hidden;">
                    <div id="lock-overlay" class="hidden">
                        <div id="lock-stamp">LOCKED</div>
                        <div style="color:white; margin-top:20px;">Computing RWA...</div>
                    </div>
                    <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--blue); padding-bottom:10px; margin-bottom:15px; flex-shrink:0;">
                        <h3 style="margin:0; color:white;">ASSET GENERATION</h3>
                        <div id="rd-ind" style="color:var(--amber); font-weight:bold;">ROUND 0</div>
                    </div>
                    <div class="control-scroll-area">
                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;">
                                <label style="color:var(--green)">1. PRIME / SUPER-PRIME BOOKING</label>
                                <span id="ctx-vp" style="color:var(--green); font-weight:bold;">3.0</span>
                            </div>
                            <div style="font-size:0.8em; color:#888;">Low Yield (8%) | Low Risk | <span style="color:#00ff9d">RWA: 75%</span></div>
                            <input type="range" id="i-vp" min="0" max="5" value="3" step="0.5" oninput="updContext('i-vp', 'ctx-vp')">
                        </div>

                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;">
                                <label style="color:var(--red)">2. SUB-PRIME / HIGH YIELD BOOKING</label>
                                <span id="ctx-vs" style="color:var(--red); font-weight:bold;">1.0</span>
                            </div>
                            <div style="font-size:0.8em; color:#888;">High Yield (24%) | High Risk | <span style="color:#ff0055">RWA: 250%</span></div>
                            <input type="range" id="i-vs" min="0" max="5" value="1" step="0.5" oninput="updContext('i-vs', 'ctx-vs')">
                        </div>

                        <div class="control-row">
                            <label>3. LINE ASSIGNMENT STRATEGY</label>
                            <div class="btn-group" id="grp-line">
                                <div class="btn-opt selected" onclick="selBtn('grp-line', 'Reactive')">REACTIVE</div>
                                <div class="btn-opt" onclick="selBtn('grp-line', 'Proactive')">PROACTIVE</div>
                            </div>
                            <div style="font-size:0.8em; color:#888; margin-top:5px;">
                                <span id="txt-line">Low RWA Impact. Slow Utilization.</span>
                            </div>
                        </div>

                        <div class="control-row">
                             <div style="display:flex; justify-content:space-between;">
                                <label>4. PORTFOLIO ACTIONS (FREEZE)</label>
                            </div>
                            <div class="btn-group" id="grp-frz">
                                <div class="btn-opt selected" onclick="selBtn('grp-frz', 'None')">None</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Selective')">Selective</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Reactive')">Reactive</div>
                            </div>
                        </div>
                    </div>
                    <button id="sub-btn" class="main-btn" onclick="submit()" disabled>WAITING FOR MARKET...</button>
                </div>
                <div class="glass" style="width: 30%; display:flex; flex-direction:column;">
                    <h4 style="color:var(--red); margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">CEO PRIORITY</h4>
                    <div id="ceo-msg" style="font-style:italic; margin-bottom:20px; font-size:1.1em; color:#ddd; flex:1; overflow-y:auto;">"System Initializing..."</div>
                    
                    <h4 style="color:var(--blue); margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">CRO INTELLIGENCE</h4>
                    <div class="cro-box">
                        <div class="cro-row"><span class="cro-lbl">MARKET PHASE:</span><span id="cro-vit" class="cro-val">-</span></div>
                        <div class="cro-row"><span class="cro-lbl">LIQUIDITY:</span><span id="cro-liq" class="cro-val">-</span></div>
                    </div>
                    
                    <div style="margin-top:auto;">
                        <button class="main-btn" onclick="showMissionLog()" style="border-color:var(--amber); color:var(--amber); font-size:1em;">> VIEW MISSION LOG</button>
                    </div>
                </div>
            </div>
        </div>
        <div id="admin-ui" class="screen" style="padding:20px; overflow-y:auto; background:#111;">
             <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                <h2 style="color:white; margin:0;">FACILITATOR COMMAND</h2>
                <div>
                    <span id="adm-rd" style="font-size:2em; margin-right:20px; font-weight:bold; color:var(--amber)">LOBBY</span>
                    <button onclick="sEmit('admin_action', {type:'RESET_GAME'})" style="padding:10px 20px; background:#333; color:white; border:1px solid #666; cursor:pointer; font-weight:bold; margin-right:10px;">HARD RESET</button>
                    <button onclick="sEmit('admin_action', {type:'START_ROUND'})" style="padding:10px 20px; background:green; color:white; border:none; cursor:pointer; font-weight:bold;">START ROUND</button>
                    <button onclick="sEmit('admin_action', {type:'PUSH_CEO'})" style="padding:10px 20px; background:orange; color:white; border:none; cursor:pointer; font-weight:bold;">TRANSMIT CEO ORDERS</button>
                    <button onclick="sEmit('admin_action', {type:'END_ROUND'})" style="padding:10px 20px; background:red; color:white; border:none; cursor:pointer; font-weight:bold;">CLOSE MARKET</button>
                </div>
            </div>
            <div id="adm-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:15px;"></div>
        </div>
    </div>
    
    <div id="mission-control">
        <div style="display:flex; justify-content:space-between; align-items:center; z-index:10; width:100%;">
            <h2 style="color:var(--blue); margin:0;">STRATEGIC TRAJECTORY</h2>
            <button onclick="closeMissionLog()" style="background:none; border:1px solid var(--red); color:var(--red); padding:5px 15px; cursor:pointer;">CLOSE</button>
        </div>
        <div class="chart-container"><canvas id="missionChart"></canvas></div>
    </div>

    <div id="ceo-overlay">
        <div class="transmission-box">
            <div class="trans-header">INCOMING SECURE TRANSMISSION</div>
            <div id="trans-text" class="trans-body">...</div>
            <button class="ack-btn" onclick="closeCeo()">ACKNOWLEDGE</button>
        </div>
    </div>

    <div id="endgame-screen">
        <div class="score-card">
            <h1 style="color:var(--amber); font-size:3em; margin:0;">SIMULATION COMPLETE</h1>
            <div id="final-scores" style="text-align:left; margin-top:30px;"></div>
            <button onclick="sEmit('admin_action', {type:'RESET_GAME'})" style="margin-top:30px; padding:10px; background:#333; color:white; border:none; cursor:pointer;">RESET SYSTEM</button>
        </div>
    </div>

    <script>
        const socket = io();
        let myTeam = "";
        let teamDataRef = null;
        let decisions = { line: 'Reactive', freeze: 'None' };
        let missionChart = null;

        function sEmit(ev, data) { socket.emit(ev, data); }
        function login(role) {
            if(role==='team') sEmit('login', {role, teamName: document.getElementById('tName').value.toUpperCase()});
            else sEmit('login', {role, password: document.getElementById('aPass').value});
        }
        function selBtn(grp, val) {
            document.querySelectorAll('#'+grp+' .btn-opt').forEach(b => b.classList.remove('selected'));
            event.target.classList.add('selected');
            if(grp === 'grp-line') {
                decisions.line = val;
                document.getElementById('txt-line').innerText = val==='Proactive' ? "High RWA Impact! (+15%). High Utilization." : "Low RWA Impact. Slow Utilization.";
                document.getElementById('txt-line').style.color = val==='Proactive' ? "#ff0055" : "#888";
            }
            if(grp === 'grp-frz') decisions.freeze = val;
        }
        function updContext(id, labelId) { document.getElementById(labelId).innerText = document.getElementById(id).value; }
        function submit() {
            const data = {
                vol_p: document.getElementById('i-vp').value,
                vol_s: document.getElementById('i-vs').value,
                line: decisions.line,
                freeze: decisions.freeze,
                bt: 1, cli: 1, coll: 3 // Defaults for now
            };
            sEmit('submit_decision', data);
            document.getElementById('lock-overlay').classList.remove('hidden');
        }

        function showMissionLog() { document.getElementById('mission-control').classList.add('open'); renderChart(); }
        function closeMissionLog() { document.getElementById('mission-control').classList.remove('open'); }
        function closeCeo() { document.getElementById('ceo-overlay').classList.remove('active'); }

        function renderChart() {
            if(!teamDataRef) return;
            const sortedLog = [...teamDataRef.history_log].reverse();
            const roeData = teamDataRef.roe_history;
            const rarocData = teamDataRef.raroc_history;
            const rounds = sortedLog.map(l => "R" + l.round);

            const ctx = document.getElementById('missionChart').getContext('2d');
            if(missionChart) missionChart.destroy();
            missionChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: rounds,
                    datasets: [
                        { label: 'ROE %', data: roeData, borderColor: '#00ff9d', backgroundColor: '#00ff9d', type: 'line', yAxisID: 'y' },
                        { label: 'RAROC %', data: rarocData, borderColor: '#00f3ff', backgroundColor: '#00f3ff', type: 'line', yAxisID: 'y' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { type: 'linear', position: 'left', ticks: { color: '#fff' } } }
                }
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
                updTeam(res.teamData);
            }
        });
        
        socket.on('ceo_transmission', (msg) => {
            document.getElementById('trans-text').innerText = msg.text;
            document.getElementById('ceo-overlay').classList.add('active');
            document.getElementById('ceo-msg').innerText = '"' + msg.text + '"'; 
        });

        socket.on('state_update', (s) => {
            if(s.status === 'ENDGAME') {
                document.getElementById('endgame-screen').style.display = 'flex';
                const list = document.getElementById('final-scores');
                list.innerHTML = '';
                Object.keys(s.teams).forEach(t => {
                    const tm = s.teams[t];
                    list.innerHTML += \`<div class="rank-card"><b>\${t}</b>: \${tm.final_score} (\${tm.archetype.title})</div>\`;
                });
                return;
            }
            document.getElementById('rd-ind').innerText = "ROUND " + s.round;
            document.getElementById('news-feed').innerHTML = s.news_feed.map(n=>\`<div class="ticker-item">\${n}</div>\`).join('');
            document.getElementById('cro-vit').innerText = s.cro_data.vital;
            document.getElementById('cro-liq').innerText = s.cro_data.liq;
            
            const btn = document.getElementById('sub-btn');
            if(s.status === 'OPEN') {
                document.getElementById('lock-overlay').classList.add('hidden'); 
                btn.disabled = false; btn.innerText = "SUBMIT STRATEGY";
            } else {
                btn.disabled = true; btn.innerText = "MARKET CLOSED";
            }
            if(document.getElementById('admin-ui').classList.contains('active')) updAdmin(s);
        });
        
        socket.on('reload_client', () => { location.reload(); });
        socket.on('team_data_update', (msg) => { if(msg.name === myTeam) { teamDataRef = msg.data; updTeam(msg.data); } });
        
        function updTeam(d) {
            document.getElementById('d-roe').innerText = d.roe.toFixed(1) + "%";
            document.getElementById('d-loss').innerText = d.loss_rate.toFixed(1) + "%";
            document.getElementById('d-cap').innerText = d.capital_ratio.toFixed(1) + "%";
            document.getElementById('d-rwa').innerText = "₹" + Math.round(d.rwa);
            document.getElementById('d-rec').innerText = "₹" + Math.round(d.receivables);
        }
        function updAdmin(s) {
            const l = document.getElementById('adm-list');
            l.innerHTML = \`\`;
            Object.keys(s.teams).forEach(t => {
                const team = s.teams[t];
                l.innerHTML += \`<div class="glass" style="padding:10px;">
                    <div><b>\${t}</b></div>
                    <div style="font-size:0.9em;">Cap: \${team.capital_ratio.toFixed(1)}% | RWA: \${Math.round(team.rwa)}</div>
                </div>\`;
            });
        }
    </script>
</body>
</html>
`;
