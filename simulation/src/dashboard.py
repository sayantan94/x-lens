#!/usr/bin/env python3
"""Lightweight dashboard server for monitoring simulation progress."""

import argparse
import json
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs


class DashboardHandler(SimpleHTTPRequestHandler):
    sim_dir: str = ""
    sims_root: str = ""

    @classmethod
    def resolve_active_sim(cls) -> str:
        """Return the most recently modified incomplete sim, or fall back to sim_dir."""
        root = Path(cls.sims_root)
        if not root.exists():
            return cls.sim_dir
        best, best_mtime = cls.sim_dir, 0.0
        for d in root.iterdir():
            if not d.is_dir():
                continue
            actions_path = d / "actions.jsonl"
            if not actions_path.exists():
                continue
            # Prefer sims that are still running (no report yet)
            report_path = d / "report.md"
            mtime = actions_path.stat().st_mtime
            if not report_path.exists() and mtime > best_mtime:
                best, best_mtime = str(d), mtime
        return best

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/simulations":
            self._serve_simulations_list()
        elif path.startswith("/api/simulations/"):
            self._serve_past_sim(path)
        elif path == "/api/actions":
            self._serve_jsonl("actions.jsonl")
        elif path == "/api/profiles":
            self._serve_json("profiles.json")
        elif path == "/api/config":
            self._serve_json("simulation_config.json")
        elif path == "/api/report":
            self._serve_text("report.md")
        elif path == "/api/seeds":
            self._serve_json("seed_posts.json")
        elif path == "/api/context":
            self._serve_text("context.md")
        elif path == "/api/status":
            self._serve_status()
        elif path == "/" or path == "/index.html":
            self._serve_dashboard()
        else:
            self.send_error(404)

    def _serve_simulations_list(self):
        """List all past simulations with metadata."""
        root = Path(self.sims_root)
        sims = []
        if root.exists():
            for d in sorted(root.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if not d.is_dir():
                    continue
                meta_path = d / "metadata.json"
                report_path = d / "report.md"
                config_path = d / "simulation_config.json"
                actions_path = d / "actions.jsonl"
                running = actions_path.exists() and not report_path.exists()
                entry = {
                    "id": d.name,
                    "has_report": report_path.exists(),
                    "has_config": config_path.exists(),
                    "running": running,
                    "modified": d.stat().st_mtime,
                }
                if meta_path.exists():
                    try:
                        entry["metadata"] = json.loads(meta_path.read_text())
                    except Exception:
                        pass
                elif config_path.exists():
                    try:
                        cfg = json.loads(config_path.read_text())
                        entry["metadata"] = {"scenario": cfg.get("scenario", "")[:200]}
                    except Exception:
                        pass
                sims.append(entry)
        self._json_response(sims)

    def _serve_past_sim(self, path: str):
        """Serve data from a past simulation: /api/simulations/<id>/<file>"""
        parts = path.replace("/api/simulations/", "").split("/", 1)
        if len(parts) != 2:
            self.send_error(404)
            return
        sim_id, resource = parts
        sim_path = Path(self.sims_root) / sim_id
        if not sim_path.exists():
            self.send_error(404)
            return
        file_map = {
            "actions": ("actions.jsonl", "jsonl"),
            "profiles": ("profiles.json", "json"),
            "config": ("simulation_config.json", "json"),
            "report": ("report.md", "text"),
            "seeds": ("seed_posts.json", "json"),
            "context": ("context.md", "text"),
            "status": (None, "status"),
        }
        if resource not in file_map:
            self.send_error(404)
            return
        filename, ftype = file_map[resource]
        if ftype == "status":
            old_sim_dir = self.sim_dir
            self.sim_dir = str(sim_path)
            self._serve_status()
            self.sim_dir = old_sim_dir
        elif ftype == "jsonl":
            filepath = sim_path / filename
            if not filepath.exists():
                self._json_response([])
                return
            actions = []
            for line in filepath.read_text().strip().split("\n"):
                if line.strip():
                    try:
                        actions.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
            self._json_response(actions)
        elif ftype == "json":
            filepath = sim_path / filename
            if not filepath.exists():
                self._json_response({})
                return
            self._json_response(json.loads(filepath.read_text()))
        elif ftype == "text":
            filepath = sim_path / filename
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(filepath.read_text().encode() if filepath.exists() else b"No report.")

    @property
    def active_sim_dir(self) -> str:
        return self.resolve_active_sim()

    def _serve_jsonl(self, filename):
        filepath = Path(self.active_sim_dir) / filename
        if not filepath.exists():
            self._json_response([])
            return
        actions = []
        for line in filepath.read_text().strip().split("\n"):
            if line.strip():
                try:
                    actions.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        self._json_response(actions)

    def _serve_json(self, filename):
        filepath = Path(self.active_sim_dir) / filename
        if not filepath.exists():
            self._json_response({})
            return
        self._json_response(json.loads(filepath.read_text()))

    def _serve_text(self, filename):
        filepath = Path(self.active_sim_dir) / filename
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if filepath.exists():
            self.wfile.write(filepath.read_text().encode())
        else:
            self.wfile.write(b"Report not generated yet.")

    def _serve_status(self):
        sim_dir = Path(self.active_sim_dir)
        actions_path = sim_dir / "actions.jsonl"
        complete = False
        action_count = 0
        max_round = 0
        platforms = set()
        agents_seen = set()
        action_types = {}
        if actions_path.exists():
            for line in actions_path.read_text().strip().split("\n"):
                if line.strip():
                    try:
                        data = json.loads(line)
                        if data.get("event") == "simulation_complete":
                            complete = True
                        else:
                            action_count += 1
                            r = data.get("round", 0)
                            if r > max_round:
                                max_round = r
                            if data.get("platform"):
                                platforms.add(data["platform"])
                            if data.get("agent_name"):
                                agents_seen.add(data["agent_name"])
                            atype = (data.get("action_type") or "").lower()
                            if atype and atype not in ("sign_up", "signup"):
                                action_types[atype] = action_types.get(atype, 0) + 1
                    except json.JSONDecodeError:
                        pass

        has_profiles = (sim_dir / "profiles.json").exists()
        has_config = (sim_dir / "simulation_config.json").exists()
        has_report = (sim_dir / "report.md").exists()

        # Determine pipeline stage
        if complete and has_report:
            stage = "done"
        elif complete:
            stage = "generating_report"
        elif action_count > 0:
            stage = "simulating"
        elif has_config:
            stage = "ready"
        elif has_profiles:
            stage = "configuring"
        else:
            stage = "waiting"

        # Get total rounds — prefer .max_rounds file (actual cap) over config
        total_rounds = 0
        max_rounds_file = sim_dir / ".max_rounds"
        if max_rounds_file.exists():
            try:
                total_rounds = int(max_rounds_file.read_text().strip())
            except Exception:
                pass
        if not total_rounds and has_config:
            try:
                cfg = json.loads((sim_dir / "simulation_config.json").read_text())
                tc = cfg.get("time_config", {})
                h = tc.get("total_simulation_hours", 0)
                m = tc.get("minutes_per_round", 60)
                if h and m:
                    total_rounds = h * 60 // m
            except Exception:
                pass

        self._json_response({
            "complete": complete,
            "action_count": action_count,
            "has_profiles": has_profiles,
            "has_config": has_config,
            "has_report": has_report,
            "stage": stage,
            "current_round": max_round,
            "total_rounds": total_rounds,
            "platforms": sorted(platforms),
            "agents_active": len(agents_seen),
            "action_breakdown": action_types,
        })

    def _serve_dashboard(self):
        html_path = Path(__file__).parent.parent / "dashboard" / "index.html"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html_path.read_bytes())

    def _json_response(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # Suppress request logs


def main():
    parser = argparse.ArgumentParser(description="Simulation dashboard server")
    parser.add_argument("--sim-dir", default="", help="Simulation directory to monitor (auto-detects latest if omitted)")
    parser.add_argument("--port", type=int, default=5050, help="Port (default: 5050)")
    args = parser.parse_args()

    sims_root = str(Path.home() / ".x-lens" / "simulations")
    DashboardHandler.sim_dir = args.sim_dir or sims_root
    DashboardHandler.sims_root = sims_root

    server = HTTPServer(("0.0.0.0", args.port), DashboardHandler)
    print(f"Dashboard → http://localhost:{args.port}", file=sys.stderr)
    if args.sim_dir:
        print(f"Monitoring: {args.sim_dir}", file=sys.stderr)
    else:
        print(f"Monitoring: {sims_root} (auto-detect latest)", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()


if __name__ == "__main__":
    main()
