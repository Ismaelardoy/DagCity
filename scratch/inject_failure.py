import json
import os

path = r'c:\Users\ismae\Desktop\3d dataengineer\jaffle_shop_duckdb\target\run_results.json'

with open(path, 'r') as f:
    data = json.load(f)

slow_nodes = {
    'model.jaffle_shop.customers': 12.55,
    'model.jaffle_shop.orders': 9.82,
    'model.jaffle_shop.fct_marketing_roi': 7.21,
    'model.jaffle_shop.stg_orders': 4.5,
}

for result in data['results']:
    uid = result.get('unique_id')
    if uid in slow_nodes:
        result['execution_time'] = slow_nodes[uid]
        print(f"Updated {uid} to {slow_nodes[uid]}s")

with open(path, 'w') as f:
    json.dump(data, f)
