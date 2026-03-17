import json
import os
import time
import random
from typing import List, Dict, Any

def run_simulation(config_path: str, profiles_path: str, sim_dir: str, rounds: int = 30, platform: str = 'parallel') -> None:
    with open(config_path, 'r') as f:
        config = json.load(f)
    with open(profiles_path, 'r') as f:
        profiles = json.load(f)
    results_path = os.path.join(sim_dir, 'actions.jsonl')
    
    # Simulation header
    header = {
        'status': 'started',
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'config': config
    }
    with open(results_path, 'w') as f:
        f.write('{header: ' + json.dumps(header) + '}
')
    
    # Simulation loop
    sentiment_trend = []
    for round_num in range(1, rounds+1):
        print(f'Simulation round {round_num}/{rounds}')
        for agent, profile in profiles.items():
            old_sentiment = profile.get('personality', 'neutral')
            if random.random() < 0.25:
                opts = ['bullish', 'bearish', 'neutral']
                opts.remove(old_sentiment)
                profile['personality'] = random.choice(opts)
                action = {
                    'round': round_num,
                    'agent': agent,
                    'type': 'sentiment_change',
                    'from': old_sentiment,
                    'to': profile['personality'],
                    'timestamp': time.time()
                }
                with open(results_path, 'a') as f:
                    f.write('{action: ' + json.dumps(action) + '}
')
        
        # Record sentiment state
        counts = {'bullish':0, 'bearish':0, 'neutral':0}
        for p in profiles.values():
            counts[p.get('personality', 'neutral')] +=1
        
        state = {
            'round': round_num,
            'counts': counts,
            'timestamp': time.time()
        }
        with open(results_path, 'a') as f:
            f.write('{sentiment: ' + json.dumps(state) + '}
')
        sentiment_trend.append(counts)
        if round_num < rounds:
            time.sleep(0.5)
    
    # Write final state
    final = {
        'status': 'complete',
        'final_sentiment': sentiment_trend[-1],
        'trend': sentiment_trend,
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S')
    }
    with open(results_path, 'a') as f:
        f.write('{simulation_complete: ' + json.dumps(final) + '}
')
    
    print('Simulation completed successfully')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', '-c', type=str, required=True)
    parser.add_argument('--profiles', '-p', type=str, required=True)
    parser.add_argument('--sim-dir', '-d', type=str, required=True)
    parser.add_argument('--platform', '-t', type=str, default='parallel')
    parser.add_argument('--max-rounds', '-r', type=int, default=30)
    args = parser.parse_args()
    run_simulation(
        config_path=args.config,
        profiles_path=args.profiles,
        sim_dir=args.sim_dir,
        rounds=args.max_rounds,
        platform=args.platform
    )
