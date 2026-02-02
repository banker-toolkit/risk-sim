/**
 * CREDIT CARD RISK SIMULATION v22.2 - FAIR PLAY
 * - Math Fix: Reduced Provisioning impact in Crash (prevents double-counting).
 * - Math Fix: Added Capital Dilution (Growth lowers ratio).
 * - Tuning: "Sensible Strategy" now scores ~20-22.
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
    1: "Welcome to Q1. I promised the Street a 'transformational' year. My reputation—and my stock options—are riding on this growth narrative. I don't want to hear about 'risk appetite' or 'prudence.' I want to see market share being stolen. If we miss the volume targets, I will find a management team that can hit them. Get aggressive.",
    2: "The stock is up 5% because *I* convinced the analysts we're a growth machine. Don't screw this up for me. Risk is complaining about 'quality,' but they always complain. I want you to double down. If we slow down now, the Board will ask questions I don't want to answer. Push the line assignments. Make the numbers look good.",
    3: "I just saw the numbers from BigBank Corp. Their CEO is bragging about their balance transfer volume in the FT. I will not be outmaneuvered by that amateur. Go aggressive on BTs. I don't care if the margins are thin; I want the headline number to look massive for the shareholder letter. Feed the ego, feed the stock price.",
    4: "Okay, listen. I'm seeing some ugly inflation numbers. If this goes south, I need to know who to blame. Keep growing—we need the revenue to cover up any cracks—but start tightening the back-end criteria silently. If NPLs spike, I’m going to tell the Board it was 'execution error' at the desk level. Don't let that be you.",
    5: "Why are the provision numbers creeping up? I explicitly told you to manage quality *while* growing! It feels like you aren't listening to my strategy. Fix the collections efficiency. If we miss the EPS target by a cent, I'm clawing back your bonuses to save face with the investors. Fix it, or I'm bringing in consultants.",
    6: "The stock took a hit this morning. The Board is getting nervous, but they still want their dividend. We cannot afford a capital raise right now—it would dilute *my* holdings. Your mandate is simple: Maintain profitability to protect the share price. If you have to burn OpEx to chase collections, do it. Just don't let the delinquencies spike before my earnings call.",
    7: "EMERGENCY MEETING. The market is crashing. Who modeled this stress test? Obviously, *your* models were wrong. I'm telling the Board this is a 'systemic event' nobody could foresee, but internally, I know you let the credit quality slip. Freeze everything. If we breach regulatory minimums, the Feds will step in, and I am not going to jail for your incompetence.",
    8: "I'm fighting for my life in these Board meetings. They are looking for a fall guy. Don't give them a reason to look at this desk. Cut the customers off. I don't care about 'brand damage'—I care about solvency. Hoard cash. Make the balance sheet look bulletproof so I can survive the AGM next month.",
    9: "We might survive this, barely. If we do, it's because of my steady hand at the wheel. If we don't, well, I've noted who pushed for volume back in Q1. Clear the bad debt off the books so we can start fresh next year. Don't expect bonuses; be grateful you have a badge to swipe tomorrow."
};

const NEWS_DB = {
    'A': [ "BBG: Consumer confidence hits 5-year high", "CNBC: Tech sector hiring spree continues", "WSJ: Retail sales beat expectations" ],
    'B': [ "BBG: Inflation ticks up to 4.2%", "CNBC: Credit card roll-rates deteriorate", "FT: Bond yield curve flattens" ],
    'C': [ "ALERT: MARKET CRASH - S&P 500 PLUNGES 15%", "BBG: Liquidity freeze in inter-bank markets", "WSJ: Unemployment spikes to 7.5%" ]
};

const CRO_INTEL_DB = {
    1: { vital: "Vintage Analysis: Clean.", cof: "Swap Curve: Flat/Stable.", liq: "Excess Capital Deployment Rec." },
    2: { vital: "FICO Bands: 700+ strong.", cof: "Spreads: Tight (Cheap).", liq: "Buffer: Healthy." },
    3: { vital: "Early Warning: 30DPD uptick in sub-prime.", cof: "Treasury: 2Y Yields creeping +10bps.", liq: "Inter-bank: Slight tightening." },
    4: { vital: "Forecast: Payment shock risk if rates rise.", cof: "Market Pricing: +50bps hike likely.", liq: "Stress Test: Margins thinning." },
    5: { vital: "Roll-Rates: 30->60 bucket accelerating.", cof: "Margin Squeeze: Liability costs rising.", liq: "Rec: Preserve Capital." },
    6: { vital: "Vintage Decay: Recent books performing poorly.", cof: "Wholesale Funding: Expensive.", liq: "ALM Mismatch: High Risk." },
    7: { vital: "Shock Model: Predicting 8% NPLs.", cof: "Credit Freeze: New debt prohibitive.", liq: "CRITICAL: Protect Tier 1 Ratio." },
    8: { vital: "Write-offs: Accelerating.", cof: "External Markets: Closed.", liq: "Insolvency Risk: High." },
    9: { vital: "Stabilization: Toxic debt clearing?", cof: "Fed Intervention: Rates flooring.", liq: "Position: Fragile but surviving." }
};

const SCENARIOS = {
    'A': { id: 'A', name: 'Expansion', severity: 0.8, tail_weight: 0.3 },
    'B': { id: 'B', name: 'Late Cycle', severity: 1.2, tail_weight: 0.8 }, 
    'C': { id: 'C', name: 'Shock', severity: 2.2, tail_weight: 1.5 } 
};

const INITIAL_TEAM_STATE = {
    receivables: 1000, 
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
            gameState.cro_data = { vital: "-", cof: "-", liq: "-" };
            
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
            gameState.cro_data = CRO_INTEL_DB[gameState.round] || { vital: "No Data", cof: "No Data", liq: "No Data" };
            
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

// --- 3. MATH ENGINE (CALIBRATED) ---
function runSimulationEngine() {
    const sc = SCENARIOS[gameState.scenario];
    Object.keys(gameState.teams).forEach(teamName => {
        const team = gameState.teams[teamName];
        const dec = team.decisions[gameState.round] || { vol: 3, line: 'Balanced', cli: 3, bt: 1, freeze: 'None', coll: 3 };

        if (team.is_zombie) {
            dec.vol = 1; 
            dec.line = 'Conservative'; 
        }

        // 1. ANALOG INPUTS
        let volMult = 1 + ((dec.vol - 3) * 0.125); 
        
        let lineRisk = 1.0; let ecFactor = 1.0; 
        if(dec.line==='Conservative') { lineRisk=0.80; volMult-=0.05; ecFactor=0.85; } 
        if(dec.line==='Aggressive') { lineRisk=1.4; volMult+=0.10; ecFactor=1.5; }
        
        let cliBal = 1 + ((dec.cli - 1) * 0.04); 
        let cliRisk = 1 + ((dec.cli - 1) * 0.09);
        let btBal = 1 + ((dec.bt - 1) * 0.06);
        
        let freezeImpact = 1.0; 
        if(dec.freeze==='Selective') freezeImpact=0.97; 
        if(dec.freeze==='Reactive') freezeImpact=0.92;
        
        let collBenefit = dec.coll * 0.20; 
        
        const growth = volMult * cliBal * btBal * freezeImpact;
        const macro = sc.id === 'C' ? 0.92 : 1.04; 
        team.receivables = team.receivables * growth * macro;

        const volRisk = dec.vol > 4 ? (dec.vol * 0.8) : (dec.vol * 0.6);
        const baseRisk = volRisk + (cliRisk * 0.4);
        
        const tailRisk = (lineRisk * 1.8) + (dec.cli * 0.3);
        const currentRiskIndex = (0.3 * baseRisk) + (sc.tail_weight * tailRisk);
        team.risk_history.push(currentRiskIndex);

        const lagIndex = team.risk_history.length - 2; 
        const histRisk = team.risk_history[Math.max(0, lagIndex)];
        let rawLoss = (0.5 * histRisk * histRisk * 0.4) * sc.severity; 
        team.loss_rate = Math.max(0.5, rawLoss - collBenefit);
        
        // 2. P&L (FAIR PLAY CALIBRATION)
        let grossYield = 0.18 - (dec.bt * 0.006); 
        let cof = 0.045; if(sc.id==='B') cof=0.06; if(sc.id==='C') cof=0.085;
        let opExRate = 0.07 - (dec.vol * 0.01); 
        opExRate += (dec.coll * 0.003);

        const grossRevenue = team.receivables * grossYield;
        const intExp = team.receivables * cof;
        const opExp = team.receivables * opExRate;
        const creditCost = team.receivables * (team.loss_rate/100);
        
        // FIX: Provisioning Cap in Crisis.
        // In Scenario C, we shouldn't provision full forward risk if we are already taking massive losses.
        let provMultiplier = sc.id === 'C' ? 0.9 : 0.8; // Lowered from 1.5 in C
        team.provisions = currentRiskIndex * provMultiplier;
        const provCost = team.receivables * (team.provisions/100);

        const profit = grossRevenue - intExp - opExp - creditCost - provCost;
        
        // 3. CAPITAL DYNAMICS (NEW REALISM)
        // Profit adds to ratio, but Growth DILUTES ratio.
        // Approx: 10% Growth drops ratio by ~1.0%.
        const growthImpact = (growth - 1.0) * 12.0; // Dilution Factor
        const profitImpact = (profit / team.receivables) * 100;
        
        team.capital_ratio = team.capital_ratio + profitImpact - growthImpact;

        // 4. ZOMBIE PROTOCOL
        let finalEquity = team.receivables * (team.capital_ratio / 100);
        
        // Lowered Threshold to 9.0 to allow "Sensible Strategy" survival
        if (team.capital_ratio < 9.0) {
            const requiredEquity = team.receivables * 0.09;
            const deficit = requiredEquity - finalEquity;
            finalEquity = finalEquity + (deficit * 1.5); 
            team.capital_ratio = 9.0; 
            team.is_zombie = true; 
        }

        team.roe = (profit / finalEquity) * 100;
        team.cumulative_profit += profit;
        
        const riskPenalty = team.is_zombie ? 1.5 : 1.0;
        const economicCapital = finalEquity * ecFactor * riskPenalty; 
        team.cumulative_capital_usage += economicCapital;
        
        team.roe_history.push(team.roe);
        const currentRaroc = (team.cumulative_profit / team.cumulative_capital_usage) * 100;
        team.raroc_history.push(currentRaroc);
        team.rev_history.push(grossRevenue);
        team.bal_history.push(team.receivables);

        let labelChanges = [];
        const prevDec = team.decisions[gameState.round - 1];
        if(!prevDec) labelChanges.push("Initial Deployment");
        else {
            const check = (name, curr, prev, type) => {
                let c = Number(curr); let p = Number(prev);
                if(type === 'line') { const s = (l) => l==='Aggressive'?3:(l==='Balanced'?2:1); c=s(curr); p=s(prev); }
                if(type === 'freeze') { const s = (f) => f==='Reactive'?3:(f==='Selective'?2:1); c=s(curr); p=s(prev); }
                if(c > p) labelChanges.push(`↑ ${name}`);
                if(c < p) labelChanges.push(`↓ ${name}`);
            };
            check("Vol", dec.vol, prevDec.vol, 'num'); check("Line", dec.line, prevDec.line, 'line');
            check("Upsell", dec.cli, prevDec.cli, 'num'); check("BT", dec.bt, prevDec.bt, 'num');
            check("Action", dec.freeze, prevDec.freeze, 'freeze'); check("Coll", dec.coll, prevDec.coll, 'num');
        }
        
        let finalLabel = "Steady State";
        if (team.is_zombie && gameState.round > 1) finalLabel = "⚠️ LENDING FROZEN";
        else if (labelChanges.length > 0) finalLabel = labelChanges.slice(0, 2).join(" | ");
        
        team.history_log.unshift({
            round: gameState.round, scenario: gameState.scenario,
            dec_summ: finalLabel,
            met_summ: `Loss:${team.loss_rate.toFixed(1)}% | Cap:${team.capital_ratio.toFixed(1)}%`,
            decision: `Vol:${dec.vol}`, impact: `ROE: ${team.roe.toFixed(1)}%`
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
        let good = "You survived the cycle.";
        let bad = "But you merely existed, you didn't lead.";

        if (score > 28 && !team.is_zombie) {
            title = "THE GRANDMASTER"; color = "#00ff9d";
            good = "Surgical precision. Perfect timing.";
            bad = "Honestly? Nothing. You made the rest of us look bad.";
        } else if (team.is_zombie) {
            title = "THE ZOMBIE BANK"; color = "#ff0055";
            good = "You kept the lights on (barely).";
            bad = "Stockholder value was wiped out. You spent years in 'Regulatory Freeze'.";
        } else if (avgRoe > 18 && raroc < 15) {
            title = "THE ADRENALINE JUNKIE"; color = "#ffaa00";
            good = "You generated massive revenue.";
            bad = "But risk-adjusted returns were poor. You got lucky.";
        } else if (avgRoe < 12 && team.capital_ratio > 15) {
            title = "THE VAULT KEEPER"; color = "#00f3ff";
            good = "Your balance sheet is bulletproof.";
            bad = "Shareholders fell asleep. You missed the growth bus completely.";
        } 

        team.final_score = Math.round(score * 10) / 10;
        team.archetype = { title, color };
        team.commentary = { good, bad };
    });
}

http.listen(PORT, () => console.log(`v22.2 Running on http://localhost:${PORT}`));

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
        .sens-btn { background:none; border:none; color:#666; font-size:0.8em; cursor:pointer; margin-top:5px; }
        .sens-panel { background:#111; border-top:1px solid #333; padding:10px; margin-top:5px; display:none; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.8em; }
        .sens-panel.open { display:grid; }
        .sens-val { color:var(--green); font-weight:bold; float:right; }
        .sens-val.neg { color:var(--red); }

        #mission-control { position: fixed; top:0; left:0; width:100vw; height:100vh; z-index:2000; background: #050810; display:none; flex-direction:column; padding:20px; box-sizing:border-box; overflow:hidden; }
        #mission-control.open { display:flex; }
        .celestial-body { position: absolute; z-index: 1; pointer-events: none; mix-blend-mode: screen; }
        #milky-way { top: 0; left: 0; width: 100%; height: 100%; background: url('https://images.unsplash.com/photo-1534849144158-97256c645fc3?q=80&w=2000') no-repeat center/cover; opacity: 0.3; z-index:0; position:absolute; }
        #saturn { bottom: -5%; left: 50%; transform: translateX(-50%) rotate(10deg); width: 700px; height: 500px; background: url('https://upload.wikimedia.org/wikipedia/commons/c/c7/Saturn_during_Equinox.jpg') no-repeat center/contain; opacity: 0.3; z-index: 0; position:absolute; }

        .chart-container { position:relative; flex:1; width:100%; margin-top:20px; z-index:10; }
        .satellite { position: absolute; width: 12px; height: 12px; border-radius: 50%; transform: translate(-50%, -50%); cursor: pointer; z-index: 20; background:white; }
        .sat-green { box-shadow: 0 0 15px #00ff9d; animation: pulse-g 3s infinite; }
        .sat-blue { box-shadow: 0 0 15px #00f3ff; animation: pulse-b 4s infinite reverse; }
        
        .data-label { position:absolute; transform:translateX(-50%); white-space:nowrap; font-size:0.8em; font-weight:bold; letter-spacing:1px; z-index:15; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 2px 2px 4px black; }
        .lbl-decision { bottom: 25px; color: #FFD700; }
        .lbl-metric { top: 25px; color: #00F3FF; }
        .guide-line { position: absolute; width: 1px; background: rgba(255,255,255,0.4); transform: translateX(-50%); z-index:12; }

        #ceo-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.95); z-index: 3000; display: none; justify-content: center; align-items: center; flex-direction: column; backdrop-filter: blur(5px); }
        #ceo-overlay.active { display: flex; }
        .transmission-box { width: 70%; max-width: 800px; border: 2px solid var(--red); background: #110505; padding: 40px; box-shadow: 0 0 50px rgba(255, 0, 85, 0.3); text-align: center; position: relative; }
        .trans-header { color: var(--red); font-size: 1.5em; letter-spacing: 5px; margin-bottom: 20px; font-weight: bold; border-bottom: 1px solid var(--red); padding-bottom: 10px; }
        .trans-body { color: #fff; font-size: 1.2em; line-height: 1.6; font-family: 'Courier New', monospace; margin-bottom: 30px; text-align: left; }
        .ack-btn { background: var(--red); color: white; border: none; padding: 15px 30px; font-size: 1.2em; cursor: pointer; font-weight: bold; letter-spacing: 2px; }
        .ack-btn:hover { background: #ff3366; }

        #lock-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center; z-index:10; backdrop-filter:blur(3px); flex-direction:column; }
        #lock-stamp { border: 5px solid var(--green); color: var(--green); font-size: 2.5em; font-weight: bold; padding: 20px; transform: rotate(-10deg); text-transform: uppercase; letter-spacing: 5px; text-shadow: 0 0 20px var(--green); }
        #endgame-screen { position:absolute; top:0; left:0; width:100%; height:100%; background:black; z-index:999; display:none; flex-direction:column; align-items:center; justify-content:center; overflow-y:auto; padding:20px; }
        .score-card { width: 70%; background: #111; border: 2px solid var(--amber); padding: 40px; text-align: center; }
        button.main-btn { width: 100%; padding: 15px; background: #111; border: 1px solid var(--blue); color: var(--blue); font-size: 1.2em; cursor: pointer; font-weight: bold; letter-spacing: 2px; text-transform:uppercase; transition: 0.2s; flex-shrink:0; }
        button.main-btn:disabled { border-color: #444; color: #555; cursor: not-allowed; }
        .hidden { display:none !important; }
        
        .cro-box { margin-bottom:15px; border:1px solid #333; padding:10px; background:rgba(0,0,0,0.3); }
        .cro-row { display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.9em; }
        .cro-lbl { color:#aaa; }
        .cro-val { color:var(--blue); font-weight:bold; }
        
        .rank-card { background:#1a1a1a; margin-bottom:15px; padding:15px; text-align:left; border-left:5px solid #555; }
        .rank-title { font-size:1.4em; font-weight:bold; margin-bottom:5px; text-transform:uppercase; }
        .rank-stats { font-size:0.9em; color:#888; margin-bottom:10px; }
        .feedback-box { background:#000; padding:10px; border:1px dashed #444; font-size:0.9em; color:#ddd; }
        .fb-good { color:#00ff9d; margin-bottom:5px; }
        .fb-bad { color:#ff0055; }
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
            <div class="glass" style="width: 320px; text-align: center;">
                <h2 style="color:var(--blue); margin-top:0; border-bottom:1px solid #333; padding-bottom:10px;">CAPTAIN'S ROOM // TERMINAL ACCESS</h2>
                <input id="tName" placeholder="ENTER CALLSIGN" style="padding:15px; width:85%; margin-bottom:15px; background:#111; border:1px solid #444; color:var(--green); font-family:monospace; font-size:1.1em; text-transform:uppercase; text-align:center;">
                <button onclick="login('team')" class="main-btn">INITIATE UPLINK</button>
                <div style="margin-top:20px; border-top:1px solid #333; padding-top:10px;">
                    <input id="aPass" type="password" placeholder="ADMIN KEY" style="padding:5px; background:#111; border:1px solid #444; color:white; text-align:center;">
                    <button onclick="login('admin')" style="background:none; border:1px solid #666; color:#666; cursor:pointer; padding:5px;">AUTH</button>
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
                            <div style="display:flex; justify-content:space-between;"><label>1. ACQUISITION VOLUME</label><span id="ctx-vol" style="color:var(--blue); font-size:0.8em;">Balanced</span></div>
                            <input type="range" id="i-vol" min="1" max="5" value="3" step="0.5" oninput="updContext('i-vol', 'ctx-vol')">
                            <button class="sens-btn" onclick="toggleSens('sens-vol')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-vol" class="sens-panel"><div class="sens-item">Return Growth <span class="sens-val">Linear Scale</span></div><div class="sens-item">Prov Impact <span class="sens-val neg">Linear Scale</span></div></div>
                        </div>
                        <div class="control-row">
                            <label>2. INITIAL LINE ASSIGNMENT</label>
                            <div class="btn-group" id="grp-line">
                                <div class="btn-opt" onclick="selBtn('grp-line', 'Conservative')">Conservative</div>
                                <div class="btn-opt selected" onclick="selBtn('grp-line', 'Balanced')">Balanced</div>
                                <div class="btn-opt" onclick="selBtn('grp-line', 'Aggressive')">Aggressive</div>
                            </div>
                            <button class="sens-btn" onclick="toggleSens('sens-line')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-line" class="sens-panel"><div class="sens-item">Return Growth <span class="sens-val">+8.0%</span></div><div class="sens-item">Tail Risk <span class="sens-val neg">HIGH</span></div></div>
                        </div>
                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;"><label>3. UPSELL AGGRESSION</label><span id="ctx-cli" style="color:var(--blue); font-size:0.8em;">3.0</span></div>
                            <input type="range" id="i-cli" min="1" max="5" value="3" step="0.5" oninput="updContext('i-cli', 'ctx-cli')">
                            <button class="sens-btn" onclick="toggleSens('sens-cli')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-cli" class="sens-panel"><div class="sens-item">Return Growth <span class="sens-val">+3.0%</span></div><div class="sens-item">Prov Impact <span class="sens-val neg">+0.2%</span></div></div>
                        </div>
                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;"><label>4. BALANCE TRANSFER PUSH</label><span id="ctx-bt" style="color:var(--blue); font-size:0.8em;">1.0</span></div>
                            <input type="range" id="i-bt" min="1" max="5" value="1" step="0.5" oninput="updContext('i-bt', 'ctx-bt')">
                            <button class="sens-btn" onclick="toggleSens('sens-bt')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-bt" class="sens-panel"><div class="sens-item">Return Growth <span class="sens-val">+4.0%</span></div><div class="sens-item">Yield Impact <span class="sens-val neg">-0.6% / pt</span></div></div>
                        </div>
                        <div class="control-row">
                            <label>5. PORTFOLIO ACTIONS</label>
                            <div class="btn-group" id="grp-frz">
                                <div class="btn-opt selected" onclick="selBtn('grp-frz', 'None')">None</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Selective')">Selective</div>
                                <div class="btn-opt" onclick="selBtn('grp-frz', 'Reactive')">Reactive</div>
                            </div>
                            <button class="sens-btn" onclick="toggleSens('sens-frz')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-frz" class="sens-panel"><div class="sens-item">Return Impact <span class="sens-val neg">-5.0%</span></div><div class="sens-item">Loss Reduction <span class="sens-val">+0.5%</span></div></div>
                        </div>
                        <div class="control-row">
                            <div style="display:flex; justify-content:space-between;"><label>6. COLLECTIONS INTENSITY</label><span id="ctx-coll" style="color:var(--blue); font-size:0.8em;">3.0</span></div>
                            <input type="range" id="i-coll" min="1" max="5" value="3" step="0.5" oninput="updContext('i-coll', 'ctx-coll')">
                            <button class="sens-btn" onclick="toggleSens('sens-coll')">[?] IMPACT ANALYSIS</button>
                            <div id="sens-coll" class="sens-panel"><div class="sens-item">Loss Reduction <span class="sens-val">+0.2% / pt</span></div><div class="sens-item">OpEx (Cost) <span class="sens-val neg">+0.3% / pt</span></div></div>
                        </div>
                    </div>
                    <button id="sub-btn" class="main-btn" onclick="submit()" disabled>WAITING FOR MARKET...</button>
                </div>
                <div class="glass" style="width: 30%; display:flex; flex-direction:column;">
                    <h4 style="color:var(--red); margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">CEO PRIORITY</h4>
                    <div id="ceo-msg" style="font-style:italic; margin-bottom:20px; font-size:1.1em; color:#ddd; flex:1; overflow-y:auto;">"System Initializing..."</div>
                    
                    <h4 style="color:var(--blue); margin-top:0; border-bottom:1px solid #333; padding-bottom:5px;">CRO INTELLIGENCE</h4>
                    <div class="cro-box">
                        <div class="cro-row"><span class="cro-lbl">BUREAU VITALS:</span><span id="cro-vit" class="cro-val">-</span></div>
                        <div class="cro-row"><span class="cro-lbl">COST OF FUNDS:</span><span id="cro-cof" class="cro-val">-</span></div>
                        <div class="cro-row"><span class="cro-lbl">LIQUIDITY:</span><span id="cro-liq" class="cro-val">-</span></div>
                    </div>

                    <div style="margin-top:auto;">
                        <button class="main-btn" onclick="showMissionLog()" style="border-color:var(--amber); color:var(--amber); font-size:1em;">> VIEW MISSION LOG</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div id="mission-control">
        <div id="milky-way" class="celestial-body"></div>
        <div id="saturn" class="celestial-body"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; z-index:10; width:100%;">
            <h2 style="color:var(--blue); margin:0; text-transform:uppercase; letter-spacing:2px; text-shadow:0 0 10px var(--blue);">Strategic Trajectory</h2>
            <button onclick="closeMissionLog()" style="background:none; border:1px solid var(--red); color:var(--red); padding:5px 15px; cursor:pointer;">CLOSE LINK</button>
        </div>
        <div class="chart-container" id="chart-wrapper">
            <canvas id="missionChart"></canvas>
        </div>
    </div>

    <div id="ceo-overlay">
        <div class="transmission-box">
            <div class="trans-header">INCOMING SECURE TRANSMISSION</div>
            <div id="trans-text" class="trans-body">DECODING...</div>
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
        }
        function toggleSens(id) { document.getElementById(id).classList.toggle('open'); }
        function updContext(id, labelId) {
            const v = document.getElementById(id).value;
            document.getElementById(labelId).innerText = v;
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

        function showMissionLog() { document.getElementById('mission-control').classList.add('open'); renderChart(); }
        function closeMissionLog() { document.getElementById('mission-control').classList.remove('open'); }
        function closeCeo() { document.getElementById('ceo-overlay').classList.remove('active'); }

        function renderChart() {
            if(!teamDataRef) return;
            const sortedLog = [...teamDataRef.history_log].reverse();
            const roeData = teamDataRef.roe_history;
            const rarocData = teamDataRef.raroc_history;
            const revData = teamDataRef.rev_history;
            const balData = teamDataRef.bal_history;
            const rounds = sortedLog.map(l => "R" + l.round);

            const ctx = document.getElementById('missionChart').getContext('2d');
            if(missionChart) missionChart.destroy();

            missionChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: rounds,
                    datasets: [
                        { label: 'ROE %', data: roeData, borderColor: '#00ff9d', backgroundColor: '#00ff9d', type: 'line', yAxisID: 'y', tension: 0.4 },
                        { label: 'RAROC %', data: rarocData, borderColor: '#00f3ff', backgroundColor: '#00f3ff', type: 'line', yAxisID: 'y', tension: 0.4 },
                        { label: 'Receivables (Cr)', data: balData, backgroundColor: 'rgba(255,255,255,0.1)', yAxisID: 'y1' },
                        { label: 'Revenue (Cr)', data: revData, backgroundColor: 'rgba(255,215,0,0.2)', yAxisID: 'y1' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { left: 80, right: 80, top: 20, bottom: 20 } },
                    scales: {
                        y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#fff' }, title:{display:true, text:'PERCENT %', color:'#aaa'} },
                        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#ccc' }, title:{display:true, text:'VALUE (Cr)', color:'#aaa'} },
                        x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#ccc' } }
                    },
                    animation: { onComplete: () => { updateSatellites(sortedLog); } }
                }
            });
        }

        function updateSatellites(logData) {
            document.querySelectorAll('.satellite, .data-label, .guide-line').forEach(e => e.remove());
            const wrapper = document.getElementById('chart-wrapper');
            const metaROE = missionChart.getDatasetMeta(0);
            
            metaROE.data.forEach((point, i) => {
                createSat(wrapper, point.x, point.y, 'sat-green');
                const stagger = (i % 2 === 0) ? 40 : 70; 
                createLabel(wrapper, point.x, point.y - stagger, logData[i].dec_summ, 'lbl-decision');
                createLine(wrapper, point.x, point.y, point.x, point.y - stagger + 15);
                
                createLabel(wrapper, point.x, point.y + stagger, logData[i].met_summ, 'lbl-metric');
                createLine(wrapper, point.x, point.y, point.x, point.y + stagger - 5);
            });
        }

        function createSat(parent, x, y, cls) {
            const el = document.createElement('div'); el.className = \`satellite \${cls}\`;
            el.style.left = x + 'px'; el.style.top = y + 'px'; parent.appendChild(el);
        }
        function createLabel(parent, x, y, text, cls) {
            const el = document.createElement('div'); el.className = \`data-label \${cls}\`;
            el.innerText = text; el.style.left = x + 'px'; el.style.top = y + 'px'; parent.appendChild(el);
        }
        function createLine(parent, x1, y1, x2, y2) {
            const height = Math.abs(y2 - y1);
            const el = document.createElement('div'); el.className = 'guide-line';
            el.style.height = height + 'px'; el.style.left = x1 + 'px'; el.style.top = Math.min(y1, y2) + 'px';
            parent.appendChild(el);
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
                const sorted = Object.keys(s.teams).sort((a,b) => s.teams[b].final_score - s.teams[a].final_score);
                sorted.forEach((t, i) => {
                    const tm = s.teams[t];
                    list.innerHTML += \`
                    <div class="rank-card" style="border-left-color: \${tm.archetype.color}">
                        <div class="rank-title" style="color:\${tm.archetype.color}">#\${i+1} \${t} : \${tm.archetype.title}</div>
                        <div class="rank-stats">
                            SCORE: \${tm.final_score} | 
                            RAROC: \${tm.raroc.toFixed(1)}% | 
                            ROE: \${(tm.roe_history.reduce((a,b)=>a+b,0)/tm.roe_history.length).toFixed(1)}% | 
                            <span style="color:\${tm.capital_ratio < 10 ? '#ff0055' : '#fff'}">
                                CAPITAL: \${tm.capital_ratio.toFixed(1)}%
                            </span>
                        </div>
                        <div class="feedback-box">
                            <div class="fb-good">✓ \${tm.commentary.good}</div>
                            <div class="fb-bad">⚠ \${tm.commentary.bad}</div>
                        </div>
                    </div>\`;
                });
                return;
            }
            document.getElementById('rd-ind').innerText = "ROUND " + s.round;
            const tDiv = document.getElementById('news-feed');
            tDiv.innerHTML = "";
            s.news_feed.forEach(n => { tDiv.innerHTML += \`<div class="ticker-item">\${n}</div>\`; });
            
            // UPDATE CRO INTEL
            document.getElementById('cro-vit').innerText = s.cro_data.vital;
            document.getElementById('cro-cof').innerText = s.cro_data.cof;
            document.getElementById('cro-liq').innerText = s.cro_data.liq;

            const btn = document.getElementById('sub-btn');
            if(s.status === 'OPEN') {
                document.getElementById('lock-overlay').classList.add('hidden'); 
                btn.disabled = false; btn.innerText = "SUBMIT DECISION";
            } else {
                btn.disabled = true; btn.innerText = "MARKET CLOSED";
            }
            if(document.getElementById('admin-ui').classList.contains('active')) updAdmin(s);
        });
        
        socket.on('reload_client', () => { location.reload(); });

        socket.on('team_data_update', (msg) => {
            if(msg.name === myTeam) { teamDataRef = msg.data; updTeam(msg.data, null); }
        });
        function updTeam(d, s) {
            document.getElementById('d-roe').innerText = d.roe.toFixed(1) + "%";
            document.getElementById('d-loss').innerText = d.loss_rate.toFixed(1) + "%";
            document.getElementById('d-prov').innerText = d.provisions.toFixed(1) + "%";
            document.getElementById('d-cap').innerText = d.capital_ratio.toFixed(1) + "%";
            document.getElementById('d-rec').innerText = "₹" + Math.round(d.receivables) + " Cr";
        }
        function updAdmin(s) {
            document.getElementById('adm-rd').innerText = s.round;
            const l = document.getElementById('adm-list');
            l.innerHTML = \`\`;
            Object.keys(s.teams).forEach(t => {
                const team = s.teams[t];
                let decStatus = '<span style="color:var(--red)">WAITING...</span>';
                let decDetail = '';
                if(team.decisions[s.round]) {
                    const d = team.decisions[s.round];
                    decStatus = '<span style="color:var(--green)">LOCKED</span>';
                    decDetail = \`<div style="margin-top:5px; font-size:0.8em; color:#aaa; border-top:1px solid #333; padding-top:5px;">
                        Vol: <b style="color:white">\${d.vol}</b> | Line: <b style="color:white">\${d.line}</b><br>
                        CLI: <b>\${d.cli}</b> | BT: <b>\${d.bt}</b> | Frz: <b>\${d.freeze}</b>
                        </div>\`;
                }
                l.innerHTML += \`<div class="glass" style="padding:10px;">
                    <div style="display:flex; justify-content:space-between;">
                        <div style="color:var(--blue); font-weight:bold; font-size:1.2em;">\${t}</div>
                        <div>\${decStatus}</div>
                    </div>
                    <div style="font-size:0.9em; margin-top:5px;">ROE: \${team.roe.toFixed(1)}% | Cap: \${team.capital_ratio.toFixed(1)}%</div>
                    <div style="font-size:0.9em;">Receivables: ₹\${Math.round(team.receivables)} Cr</div>
                    \${decDetail}
                </div>\`;
            });
        }
        window.addEventListener('resize', () => { if(missionChart) { missionChart.resize(); renderOverlay(); } });
    </script>
</body>
</html>
`;
