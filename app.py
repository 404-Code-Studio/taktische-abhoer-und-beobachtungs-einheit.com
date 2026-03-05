# Führe das vorher einmal im Terminal aus:
# pip install
# dann zum starten, Terminal öffnen und: python app.py

import os
import json
from flask import Flask, send_from_directory, abort

app = Flask(__name__, static_folder='public')

DEBUG = 'debug' in os.sys.argv

with open('routes.json', 'r', encoding='utf-8') as f:
    routes_raw = json.load(f)
    routes = {k: v for k, v in routes_raw.items() if k != '_comment'}

@app.route('/<path:path>')
def serve(path):
    for route, file in routes.items():
        if route.strip('/') == path or route == '/' + path:
            return send_from_directory('public', file)
    
    if os.path.exists(os.path.join('public', path)):
        return send_from_directory('public', path)
    
    abort(404)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=DEBUG)
