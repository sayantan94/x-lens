import json
import os

def generate_profiles(scenario, count, output_path):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    profiles = {f'agent_{i}': {
        'personality': ['bullish', 'bearish', 'neutral'][i%3],
        'strategy': ['value', 'growth', 'quant', 'degen'][i%4],
        'history': []
    } for i in range(count)}
    
    with open(output_path, 'w') as f:
        json.dump(profiles, f, indent=2)
    print(f'Generated {count} profiles to {output_path}')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--scenario', '-s', type=str)
    parser.add_argument('--count', '-c', type=int)
    parser.add_argument('--output', '-o', type=str)
    args = parser.parse_args()
    generate_profiles(args.scenario, args.count, args.output)
