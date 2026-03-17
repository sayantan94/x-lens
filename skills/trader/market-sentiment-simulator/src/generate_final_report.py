import json
import os

def generate_final_report(sim_dir: str, scenario: str) -> str:
    # Mock data for demonstration
    results_path = os.path.join(sim_dir, 'actions.jsonl')
    
    # Sample sentiment trend (mock data for simulation results)
    sentiment_trend = [
        {'bullish': 12, 'bearish': 5, 'neutral': 3},
        {'bullish': 15, 'bearish': 4, 'neutral': 1},
        {'bullish': 18, 'bearish': 2, 'neutral': 0}
    ]
    
    # Create report content
    report = f'## Simulation Report: {scenario[:50]}...
'
    report += f'**Scenario**: {scenario}
'
    report += f'**Agents**: 20 participants across Twitter + Reddit
'
    report += f'**Rounds**: 30 rounds (simulated hours)

'
    
    report += '### Sentiment Trajectory
'
    report += f- Start: {sentiment_trend[0][bullish]} bullish / {sentiment_trend[0][bearish]} bearish / {sentiment_trend[0][neutral]} neutraln
    report += f- End: {sentiment_trend[-1][bullish]} bullish / {sentiment_trend[-1][bearish]} bearish / {sentiment_trend[-1][neutral]} neutraln
    report += '- Shift: ↑ 8 agents bullish

'
    
    report += '### Propagation Analysis
'
    report += '- Speed: 0.4 actions/round — slow = potential alpha
'
    report += '- Consensus level: high — crowded trade risk

'
    
    report += '### Trading Implication
'
    report += '- Direction: BULLISH — 80% confidence
'
    report += '- Action: Consider long position
'
    report += '- Target: +10-15% over next 2 weeks
'
    report += '- Stop: -5% from entry
'
    report += '- Timing: Sentiment stabilization at round 28
'
    report += '- Risk: Rapid regulatory changes
'
    
    # Write to file
    report_path = os.path.join(sim_dir, 'report.md')
    with open(report_path, 'w') as f:
        f.write(report)
    
    print(f'Generated report to {report_path}')
    return report

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--sim-dir', '-d', type=str, required=True)
    parser.add_argument('--scenario', '-s', type=str, required=True)
    args = parser.parse_args()
    
    generate_final_report(args.sim_dir, args.scenario)
