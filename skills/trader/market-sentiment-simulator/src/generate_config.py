import json
import os

def generate_config(profiles_path, scenario, sim_id, output_path):
    config = {
        'sim_id': sim_id,
        'scenario': scenario,
        'profiles': profiles_path,
        'platform': 'twitter_reddit',
        'max_rounds': 72,
        'timestamp': os.getenv('SIM_TIMESTAMP', '2026-03-13T12:00:00Z')
    }
    
    with open(output_path, 'w') as f:
        json.dump(config, f, indent=2)
    print(f'Generated config to {output_path}')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--profiles', '-p', type=str)
    parser.add_argument('--scenario', '-s', type=str)
    parser.add_argument('--sim-id', '-i', type=str)
    parser.add_argument('--output', '-o', type=str)
    args = parser.parse_args()
    generate_config(args.profiles, args.scenario, args.sim_id, args.output)
