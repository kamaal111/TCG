import json
from pathlib import Path

path = Path('/etc/docker/daemon.json')
config = json.loads(path.read_text()) if path.exists() else {}
mirrors = config.get('registry-mirrors', [])
config['registry-mirrors'] = list(dict.fromkeys(['https://mirror.gcr.io', *mirrors]))
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(config))
